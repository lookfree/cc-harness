import type { IpcMain } from 'electron'
import type { FileManager } from '../services/file-manager'
import type { Hook, HookExecutionLog, HookSettingsMatcher, HookSimInput } from '../../shared/types'
import { validateHook } from '../services/hook-validation'
import { dryRunHook } from '../services/hook-sandbox'
import { spawn } from 'child_process'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'

// In-memory storage for execution logs (limited to last 100 entries)
let executionLogs: HookExecutionLog[] = []
const MAX_LOGS = 100

// Log file path - can persist logs across sessions
const HOOK_LOG_FILE = path.join(os.homedir(), '.claude', 'hook-execution-logs.json')

async function loadPersistedLogs(): Promise<HookExecutionLog[]> {
  try {
    const content = await fs.readFile(HOOK_LOG_FILE, 'utf-8')
    return JSON.parse(content)
  } catch {
    return []
  }
}

async function persistLogs() {
  try {
    await fs.writeFile(HOOK_LOG_FILE, JSON.stringify(executionLogs.slice(0, MAX_LOGS), null, 2))
  } catch (error) {
    console.error('[Hooks IPC] Failed to persist logs:', error)
  }
}

function addExecutionLog(log: HookExecutionLog) {
  executionLogs.unshift(log)
  if (executionLogs.length > MAX_LOGS) {
    executionLogs.pop()
  }
  // Persist logs asynchronously
  persistLogs()
}

function generateLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// Initialize: load persisted logs on startup
loadPersistedLogs().then(logs => {
  executionLogs = logs
  console.log('[Hooks IPC] Loaded', logs.length, 'persisted execution logs')
})

// Claude Code debug log directory
const CLAUDE_DEBUG_DIR = path.join(os.homedir(), '.claude', 'debug')

// Parse Claude Code debug log entry
interface ClaudeDebugLogEntry {
  timestamp: string
  level: string
  category?: string
  message: string
  raw: string
}

// Parse a single debug log line
function parseDebugLogLine(line: string): ClaudeDebugLogEntry | null {
  // Format: 2025-11-29T08:08:33.503Z [DEBUG] Getting matching hook commands...
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+\[(\w+)\]\s+(.*)$/)
  if (!match) return null

  const [, timestamp, level, message] = match

  // Extract category if present (e.g., [LSP MANAGER] message)
  const categoryMatch = message.match(/^\[([^\]]+)\]\s+(.*)$/)
  const category = categoryMatch ? categoryMatch[1] : undefined
  const cleanMessage = categoryMatch ? categoryMatch[2] : message

  return {
    timestamp,
    level,
    category,
    message: cleanMessage,
    raw: line,
  }
}

// Parse a single debug log file and return hook execution logs
async function parseDebugLogFile(filePath: string): Promise<HookExecutionLog[]> {
  const logs: HookExecutionLog[] = []

  try {
    const debugContent = await fs.readFile(filePath, 'utf-8')
    const lines = debugContent.split('\n')

    let currentHookEvent: {
      type: string
      query: string
      timestamp: string
      matched: number
    } | null = null

    // Track the last hook log for appending output/errors
    let lastHookLog: HookExecutionLog | null = null

    for (const line of lines) {
      const entry = parseDebugLogLine(line)
      if (!entry) continue

      // Parse hook-related log entries
      // Pattern: "Getting matching hook commands for SessionStart with query: startup"
      const hookMatchStart = entry.message.match(/Getting matching hook commands for (\w+) with query: (.+)/)
      if (hookMatchStart) {
        currentHookEvent = {
          type: hookMatchStart[1],
          query: hookMatchStart[2],
          timestamp: entry.timestamp,
          matched: 0,
        }
        continue
      }

      // Pattern: "Matched 1 unique hooks for query "startup" (1 before deduplication)"
      const hookMatchResult = entry.message.match(/Matched (\d+) unique hooks for query "([^"]+)"/)
      if (hookMatchResult && currentHookEvent) {
        currentHookEvent.matched = parseInt(hookMatchResult[1], 10)

        // Create log entry for hooks that matched (executed)
        if (currentHookEvent.matched > 0) {
          const log: HookExecutionLog = {
            id: `debug_${new Date(currentHookEvent.timestamp).getTime()}_${Math.random().toString(36).substr(2, 6)}`,
            hookName: `${currentHookEvent.type}`,
            hookType: currentHookEvent.type as HookExecutionLog['hookType'],
            trigger: currentHookEvent.query,
            timestamp: currentHookEvent.timestamp,
            duration: 0,
            status: 'success',
            command: `query: ${currentHookEvent.query}`,
            output: `Matched ${currentHookEvent.matched} hook(s)`,
            location: 'user',
          }

          logs.push(log)
          lastHookLog = log
        }
        currentHookEvent = null
        continue
      }

      // Pattern: "Running hook command: xxx" - indicates actual hook execution
      const runningHookMatch = entry.message.match(/Running hook command:\s*(.+)/)
      if (runningHookMatch) {
        const command = runningHookMatch[1]
        const log: HookExecutionLog = {
          id: `debug_${new Date(entry.timestamp).getTime()}_${Math.random().toString(36).substr(2, 6)}`,
          hookName: 'HookCommand',
          hookType: 'PreToolUse' as HookExecutionLog['hookType'],
          trigger: 'command',
          timestamp: entry.timestamp,
          duration: 0,
          status: 'success',
          command: command,
          location: 'user',
        }
        logs.push(log)
        lastHookLog = log
        continue
      }

      // Pattern: "Hook output does not start with {, treating as plain text" or "Hook returned:"
      // This indicates a hook executed and produced output
      const hookOutputMatch = entry.message.match(/Hook (output|returned)/)
      if (hookOutputMatch && lastHookLog) {
        lastHookLog.output = (lastHookLog.output || '') + '\n' + entry.message
        continue
      }

      // Pattern: Hook errors - look for ERROR level logs related to hooks
      if (entry.level === 'ERROR' && lastHookLog) {
        // Check if this error is related to hooks
        if (entry.message.toLowerCase().includes('hook') ||
            entry.message.includes('command') ||
            entry.message.includes('spawn') ||
            entry.message.includes('ENOENT') ||
            entry.message.includes('exit code') ||
            entry.message.includes('timed out')) {
          lastHookLog.status = 'failed'
          lastHookLog.error = entry.message
          lastHookLog.output = (lastHookLog.output || '') + '\n[ERROR] ' + entry.message
        }
      }

      // Pattern: Hook execution failed with exit code
      const exitCodeMatch = entry.message.match(/exit(?:ed)?\s+(?:with\s+)?code[:\s]+(\d+)/i)
      if (exitCodeMatch && lastHookLog) {
        const exitCode = parseInt(exitCodeMatch[1], 10)
        if (exitCode !== 0) {
          lastHookLog.status = 'failed'
          lastHookLog.exitCode = exitCode
          lastHookLog.error = `Hook exited with code ${exitCode}`
        } else {
          lastHookLog.exitCode = exitCode
        }
        continue
      }

      // Pattern: Hook timed out
      const timeoutMatch = entry.message.match(/hook.*timed?\s*out|timeout.*hook/i)
      if (timeoutMatch && lastHookLog) {
        lastHookLog.status = 'timeout'
        lastHookLog.error = 'Hook execution timed out'
        lastHookLog.output = (lastHookLog.output || '') + '\n[TIMEOUT] ' + entry.message
        continue
      }
    }

    return logs
  } catch (error) {
    console.error('[Hooks IPC] Failed to parse debug log file:', filePath, error)
    return []
  }
}

// Parse execution logs from Claude Code debug files
async function parseClaudeDebugLogs(): Promise<HookExecutionLog[]> {
  const allLogs: HookExecutionLog[] = []

  try {
    // Check if debug directory exists
    try {
      await fs.access(CLAUDE_DEBUG_DIR)
    } catch {
      console.log('[Hooks IPC] Debug directory does not exist:', CLAUDE_DEBUG_DIR)
      return allLogs
    }

    // Get all debug log files
    const files = await fs.readdir(CLAUDE_DEBUG_DIR)
    const txtFiles = files.filter(f => f.endsWith('.txt') && f !== 'latest')

    if (txtFiles.length === 0) {
      console.log('[Hooks IPC] No debug log files found')
      return allLogs
    }

    // Get file stats for sorting by modification time
    const fileStats = await Promise.all(
      txtFiles.map(async f => {
        const filePath = path.join(CLAUDE_DEBUG_DIR, f)
        try {
          const stat = await fs.stat(filePath)
          return { file: f, path: filePath, mtime: stat.mtime.getTime() }
        } catch {
          return null
        }
      })
    )

    // Filter out nulls and sort by modification time (newest first)
    const validFiles = fileStats.filter((f): f is NonNullable<typeof f> => f !== null)
    validFiles.sort((a, b) => b.mtime - a.mtime)

    // Read the most recent files (limit to 10 to avoid reading too many)
    const recentFiles = validFiles.slice(0, 10)
    console.log('[Hooks IPC] Reading', recentFiles.length, 'debug log files')

    // Parse each file
    for (const fileInfo of recentFiles) {
      const fileLogs = await parseDebugLogFile(fileInfo.path)
      allLogs.push(...fileLogs)
    }

    // Sort all logs by timestamp (newest first)
    allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Deduplicate logs by timestamp + hookType + trigger
    const seen = new Set<string>()
    const uniqueLogs = allLogs.filter(log => {
      const key = `${log.hookType}-${log.trigger}-${log.timestamp}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    console.log('[Hooks IPC] Found', uniqueLogs.length, 'unique debug log entries')
    return uniqueLogs.slice(0, 100) // Return most recent 100 entries
  } catch (error) {
    console.error('[Hooks IPC] Failed to parse Claude debug logs:', error)
    return allLogs
  }
}

export function registerHookHandlers(ipcMain: IpcMain, fileManager: FileManager) {
  ipcMain.handle('hooks:getAll', async () => {
    return await fileManager.getHooks()
  })

  ipcMain.handle('hooks:get', async (_event, name: string) => {
    return await fileManager.getHook(name)
  })

  ipcMain.handle('hooks:save', async (_event, hook: Hook) => {
    await fileManager.saveHook(hook)
  })

  ipcMain.handle('hooks:saveRaw', async (_event, name: string, content: string, filePath: string) => {
    await fileManager.saveHookRaw(name, content, filePath)
  })

  // Save hook to Claude Code settings.json format
  ipcMain.handle('hooks:saveToSettings', async (
    _event,
    hookType: string,
    hookConfig: HookSettingsMatcher,
    location: 'user' | 'project',
    projectPath?: string,
    matcherIndex?: number
  ) => {
    await fileManager.saveHookToSettings(hookType, hookConfig, location, projectPath, matcherIndex)
  })

  // ajv 校验 hook（前端保存前调；服务端 saveHookToSettings 也会再校验一遍）
  ipcMain.handle('hooks:validate', async (_event, hook: Hook) => {
    return validateHook(hook)
  })

  ipcMain.handle('hooks:delete', async (_event, name: string) => {
    await fileManager.deleteHook(name)
  })

  // Delete hook from settings.json
  ipcMain.handle('hooks:deleteFromSettings', async (
    _event,
    hookType: string,
    matcherIndex: number,
    location: 'user' | 'project',
    projectPath?: string
  ) => {
    await fileManager.deleteHookFromSettings(hookType, matcherIndex, location, projectPath)
  })

  // Create hook shell script file
  ipcMain.handle('hooks:createScript', async (
    _event,
    scriptPath: string,
    content: string,
    location: 'user' | 'project',
    projectPath?: string
  ) => {
    return await fileManager.createHookScript(scriptPath, content, location, projectPath)
  })

  // Read hook script content
  ipcMain.handle('hooks:readScript', async (
    _event,
    scriptPath: string,
    location: 'user' | 'project',
    projectPath?: string
  ) => {
    return await fileManager.readHookScript(scriptPath, location, projectPath)
  })

  // Get execution logs (manual test logs)
  ipcMain.handle('hooks:getLogs', async () => {
    return executionLogs
  })

  // Get Claude Code debug logs (real execution logs from ~/.claude/debug/)
  ipcMain.handle('hooks:getDebugLogs', async () => {
    try {
      const debugLogs = await parseClaudeDebugLogs()
      console.log('[Hooks IPC] Parsed', debugLogs.length, 'entries from Claude debug logs')
      return debugLogs
    } catch (error) {
      console.error('[Hooks IPC] Failed to get debug logs:', error)
      return []
    }
  })

  // Clear execution logs
  ipcMain.handle('hooks:clearLogs', async () => {
    executionLogs.length = 0
    return true
  })

  // Launch Claude Code in debug mode to test hooks
  // Opens Claude Code in an external terminal window for proper TTY support
  ipcMain.handle('hooks:launchDebugSession', async (
    _event,
    hookType: string,
    projectPath?: string
  ): Promise<{ success: boolean; message: string; pid?: number }> => {
    console.log('[Hooks IPC] Launching Claude Code in debug mode for hook type:', hookType)

    try {
      // Determine working directory
      const workingDir = projectPath || process.cwd()

      // Build the claude command with debug flag
      let claudeArgs = '--debug'
      let testPrompt = ''

      // For SessionStart, we want interactive mode to properly trigger the hook
      // For other hook types, we use one-shot mode with specific prompts
      switch (hookType) {
        case 'SessionStart':
          // Session start triggers when Claude begins a new session
          // Interactive mode - just open claude --debug
          break
        case 'SessionEnd':
          // Session end triggers when the session is ending
          testPrompt = 'Say goodbye'
          break
        case 'PreToolUse':
        case 'PostToolUse':
          // Need to trigger a tool use - ask to read a file
          testPrompt = 'Read the file package.json and tell me the project name'
          break
        case 'UserPromptSubmit':
          // UserPromptSubmit triggers after user submits their prompt
          testPrompt = 'Hello, this is a test prompt for UserPromptSubmit hook'
          break
        case 'Notification':
          // Notification triggers when Claude displays a notification
          testPrompt = 'Search for any TODO comments in this project'
          break
        case 'Stop':
          // Stop triggers right before Claude concludes its response
          testPrompt = 'Count from 1 to 5'
          break
        case 'SubagentStart':
        case 'SubagentStop':
          // Subagent hooks trigger when Task tool is used
          testPrompt = 'Use the Task tool to search for README files in this project'
          break
        case 'PreCompact':
        case 'PostCompact':
          // Compaction hooks trigger before/after conversation compaction（需较长对话手动触发更可靠）
          testPrompt = 'This is a test for compaction hooks. Please respond briefly.'
          break
        case 'MessageDisplay':
          // 输出显示前转换/隐藏：任意回复都会触发
          testPrompt = 'Reply with a short sentence to test MessageDisplay hook'
          break
        case 'StopFailure':
          // Stop 失败：需 Stop hook 阻断失败才触发，dry-run 仅识别类型
          testPrompt = 'Count from 1 to 5 (StopFailure requires a blocking Stop hook to trigger)'
          break
        case 'PermissionRequest':
          // 权限请求：触发一次需授权的工具
          testPrompt = 'Run the shell command: echo hello'
          break
        case 'ConfigChange':
        case 'Elicitation':
        case 'ElicitationResult':
        case 'PostSession':
          // 这些事件由配置变更/交互征询/会话生命周期触发，dry-run 仅识别类型，需手动触发
          testPrompt = 'Hello, this hook type needs a real trigger; this is a type-recognition test'
          break
        default:
          // Fallback for any unhandled hook types
          testPrompt = 'Hello, this is a hook test'
      }

      // If there's a test prompt, add -p flag
      if (testPrompt) {
        // Escape single quotes in the prompt for shell safety
        const escapedPrompt = testPrompt.replace(/'/g, "'\\''")
        claudeArgs += ` -p '${escapedPrompt}'`
      }

      const isMac = process.platform === 'darwin'
      const isWindows = process.platform === 'win32'

      // definite-assignment：下面 macOS/Windows/Linux 分支必赋值，且 !launched 时已提前 return，
      // 到达使用处时 terminalProc 一定已赋值（TS 无法跨分支推断，用 ! 断言）。
      let terminalProc!: ReturnType<typeof spawn>

      if (isMac) {
        // On macOS, open Terminal.app with the claude command
        // Use osascript to open Terminal and run the command
        const script = `
          tell application "Terminal"
            activate
            do script "cd '${workingDir}' && claude ${claudeArgs}"
          end tell
        `
        console.log('[Hooks IPC] Opening Terminal.app with script:', script)
        terminalProc = spawn('osascript', ['-e', script], {
          detached: true,
          stdio: 'ignore',
        })
      } else if (isWindows) {
        // On Windows, open cmd.exe with the claude command
        const cmdArgs = `/c start cmd /k "cd /d "${workingDir}" && claude.cmd ${claudeArgs}"`
        console.log('[Hooks IPC] Opening cmd.exe with args:', cmdArgs)
        terminalProc = spawn('cmd.exe', [cmdArgs], {
          detached: true,
          stdio: 'ignore',
          shell: true,
        })
      } else {
        // On Linux, try common terminal emulators
        // Try gnome-terminal, then xterm
        const terminals = [
          { cmd: 'gnome-terminal', args: ['--', 'bash', '-c', `cd '${workingDir}' && claude ${claudeArgs}; exec bash`] },
          { cmd: 'xterm', args: ['-e', `cd '${workingDir}' && claude ${claudeArgs}; exec bash`] },
          { cmd: 'konsole', args: ['-e', 'bash', '-c', `cd '${workingDir}' && claude ${claudeArgs}; exec bash`] },
        ]

        let launched = false
        for (const terminal of terminals) {
          try {
            console.log('[Hooks IPC] Trying terminal:', terminal.cmd)
            terminalProc = spawn(terminal.cmd, terminal.args, {
              detached: true,
              stdio: 'ignore',
            })
            terminalProc.unref()
            launched = true
            break
          } catch {
            continue
          }
        }

        if (!launched) {
          return {
            success: false,
            message: 'Could not find a terminal emulator. Please install gnome-terminal, xterm, or konsole.',
          }
        }
      }

      // Detach the terminal process so it runs independently
      terminalProc.unref()

      const pid = terminalProc.pid

      console.log('[Hooks IPC] External terminal launched, PID:', pid)

      // Build user instructions based on hook type
      let instructions = ''
      if (hookType === 'SessionStart') {
        instructions = 'Claude Code is now running in debug mode. The SessionStart hook should trigger immediately. '
        instructions += 'After testing, type /exit or close the terminal, then click Refresh to see the debug logs.'
      } else if (testPrompt) {
        instructions = `Claude Code is running with test prompt: "${testPrompt}". `
        instructions += 'After the response completes, the hook should trigger. Close the terminal and click Refresh to see the logs.'
      } else {
        instructions = 'Claude Code is now running in debug mode. '
        instructions += 'Interact with it to trigger hooks, then close the terminal and click Refresh to see the debug logs.'
      }

      return {
        success: true,
        message: instructions,
        pid,
      }
    } catch (error) {
      console.error('[Hooks IPC] Failed to launch debug session:', error)
      return {
        success: false,
        message: `Failed to start Claude Code: ${(error as Error).message}`,
      }
    }
  })

  // Stop a running debug session
  ipcMain.handle('hooks:stopDebugSession', async (_event, pid: number): Promise<boolean> => {
    console.log('[Hooks IPC] Stopping debug session:', pid)
    try {
      process.kill(pid, 'SIGTERM')
      return true
    } catch (error) {
      console.error('[Hooks IPC] Failed to stop session:', error)
      return false
    }
  })

  // Test hook execution
  ipcMain.handle('hooks:test', async (
    _event,
    hookName: string,
    command: string,
    hookType: string,
    location: 'user' | 'project',
    projectPath?: string,
    timeout?: number
  ): Promise<HookExecutionLog> => {
    const startTime = Date.now()
    const logId = generateLogId()
    const timeoutMs = timeout || 60000

    // Determine the working directory
    const userConfigPath = path.join(os.homedir(), '.claude')
    const workingDir = location === 'user'
      ? userConfigPath
      : (projectPath || process.cwd())

    // Resolve the command path
    let resolvedCommand = command
    if (command.startsWith('.claude/')) {
      // Relative path from .claude directory
      resolvedCommand = path.join(workingDir, command)
    } else if (!path.isAbsolute(command) && (command.endsWith('.sh') || command.endsWith('.py') || command.endsWith('.js'))) {
      // Script file without full path
      resolvedCommand = path.join(workingDir, command)
    }

    console.log('[Hooks IPC] Testing hook:', hookName, 'command:', resolvedCommand, 'workingDir:', workingDir)

    return new Promise((resolve) => {
      let output = ''
      let error = ''
      let timedOut = false

      // Determine shell and args based on OS
      const isWindows = process.platform === 'win32'
      const shell = isWindows ? 'cmd.exe' : '/bin/bash'
      const shellArgs = isWindows ? ['/c', resolvedCommand] : ['-c', resolvedCommand]

      const proc = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: {
          ...process.env,
          HOOK_NAME: hookName,
          HOOK_TYPE: hookType,
          CLAUDE_CODE_DEBUG: 'true',
        },
        timeout: timeoutMs,
      })

      proc.stdout?.on('data', (data) => {
        output += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        error += data.toString()
      })

      const timeoutHandle = setTimeout(() => {
        timedOut = true
        proc.kill('SIGTERM')
      }, timeoutMs)

      proc.on('close', (code) => {
        clearTimeout(timeoutHandle)
        const duration = Date.now() - startTime

        let status: HookExecutionLog['status'] = 'success'
        if (timedOut) {
          status = 'timeout'
        } else if (code !== 0) {
          status = 'failed'
        }

        const log: HookExecutionLog = {
          id: logId,
          hookName,
          hookType: hookType as HookExecutionLog['hookType'],
          trigger: 'manual_test',
          timestamp: new Date().toISOString(),
          duration,
          status,
          command: resolvedCommand,
          output: output.trim() || undefined,
          error: error.trim() || undefined,
          exitCode: code ?? undefined,
          location,
          filePath: projectPath,
        }

        addExecutionLog(log)
        console.log('[Hooks IPC] Test completed:', log.status, 'exitCode:', code, 'duration:', duration, 'ms')
        resolve(log)
      })

      proc.on('error', (err) => {
        clearTimeout(timeoutHandle)
        const duration = Date.now() - startTime

        const log: HookExecutionLog = {
          id: logId,
          hookName,
          hookType: hookType as HookExecutionLog['hookType'],
          trigger: 'manual_test',
          timestamp: new Date().toISOString(),
          duration,
          status: 'failed',
          command: resolvedCommand,
          error: err.message,
          location,
          filePath: projectPath,
        }

        addExecutionLog(log)
        console.log('[Hooks IPC] Test failed:', err.message)
        resolve(log)
      })
    })
  })

  // Sandbox dry-run (spec018): 不启真 session，只执行单个 action 并回报结果
  ipcMain.handle('hooks:dryRun', async (_e, hook: Hook, actionIndex: number, input: HookSimInput) => {
    const action = hook.actions?.[actionIndex]
    if (!action) throw new Error(`No action at index ${actionIndex}`)
    console.log('[Hooks IPC] dryRun', hook.name, 'action', actionIndex, 'type', action.type)
    return dryRunHook(hook, action, input)
  })
}
