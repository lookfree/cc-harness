import { spawn } from 'child_process'
import os from 'os'
import path from 'path'
import type { Hook, HookAction, HookSimInput, HookDryRunResult } from '../../shared/types'
import { resolveActionType } from '../../shared/types'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 1024 * 1024 // 1 MB
const HOME = os.homedir()
const TMPDIR = os.tmpdir()

/**
 * hook 的工作目录：真实 Claude Code 在**项目目录**下跑 hook，`.claude/hooks/x.sh` 这类
 * 相对命令才解析得到。早期版本用空临时目录，导致任何项目 hook 都 exit 127。
 * project hook 的 filePath 形如 `<project>/.claude/settings.json` → 上溯两级即项目根。
 */
function resolveWorkDir(hook: Hook, input: HookSimInput): string {
  if (input.cwd) return input.cwd
  if (hook.location === 'project' && hook.filePath) {
    const dir = path.dirname(hook.filePath) // <project>/.claude
    if (path.basename(dir) === '.claude') return path.dirname(dir)
    return dir
  }
  return HOME
}

/** 构造 Claude Code 传给 hook 的 stdin JSON */
function buildInputJson(hook: Hook, input: HookSimInput): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    session_id: input.sessionId ?? 'dryrun-session',
    transcript_path: '/dev/null',
    hook_event_name: hook.type,
    cwd: input.cwd ?? HOME,
  }
  if (input.toolName !== undefined) obj.tool_name = input.toolName
  if (input.toolInput !== undefined) obj.tool_input = input.toolInput
  if (input.toolOutput !== undefined) obj.tool_response = input.toolOutput
  if (input.prompt !== undefined) obj.prompt = input.prompt
  if (input.message !== undefined) obj.message = input.message
  if (input.extra) Object.assign(obj, input.extra)
  return obj
}

/** 解析 hook stdout/exitCode → 语义决策 */
function parseDecision(
  stdout: string,
  exitCode: number | null
): Pick<HookDryRunResult, 'decision' | 'blockReason' | 'transformedOutput'> {
  const trimmed = stdout.trim()
  if (trimmed.startsWith('{')) {
    try {
      const p = JSON.parse(trimmed) as Record<string, unknown>
      const d = (p.decision ?? p.action) as string | undefined
      if (d === 'block') return { decision: 'block', blockReason: (p.reason ?? p.message) as string | undefined }
      if (p.updatedInput !== undefined || p.additionalContext !== undefined) {
        return { decision: 'transform', transformedOutput: p.updatedInput ?? p.additionalContext }
      }
      if (d === 'allow') return { decision: 'allow' }
    } catch { /* not JSON */ }
  }
  // exit 2 = block per Claude Code hook convention
  if (exitCode === 2) return { decision: 'block', blockReason: trimmed || undefined }
  if (exitCode !== null && exitCode !== 0) return { decision: 'block', blockReason: `exit ${exitCode}` }
  if (exitCode === 0) return { decision: 'allow' }
  return { decision: 'none' }
}

async function runCommand(
  action: HookAction,
  inputJson: Record<string, unknown>,
  timeoutMs: number,
  startMs: number,
  base: Omit<HookDryRunResult, 'decision' | 'blockReason' | 'transformedOutput' | 'durationMs' | 'timedOut'>,
  workDir: string
): Promise<HookDryRunResult> {
  if (!action.command) {
    return { ...base, exitCode: null, stdout: '', stderr: '', decision: 'none', error: 'no_command', durationMs: Date.now() - startMs, timedOut: false }
  }

  // 白名单 env：只透传 PATH/HOME/TMPDIR，不透传 token/key。
  // CLAUDE_PROJECT_DIR 是 Claude Code 传给 hook 的标准变量，脚本常用它拼路径，必须给。
  const safeEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME,
    TMPDIR,
    TERM: 'dumb',
    CLAUDE_PROJECT_DIR: workDir,
    HOOK_EVENT_NAME: base.hookType,
    HOOK_NAME: base.hookName,
    HOOK_TYPE: base.hookType,
  }

  const command = action.command
  return new Promise<HookDryRunResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let totalBytes = 0

    const proc = action.args
      ? spawn(command, action.args, { shell: false, cwd: workDir, env: safeEnv })
      : spawn(command, { shell: true, cwd: workDir, env: safeEnv })

    const timer = setTimeout(() => {
      timedOut = true
      try { proc.kill('SIGKILL') } catch { /* already gone */ }
    }, timeoutMs)

    // stdin: hook input JSON
    try { proc.stdin?.write(JSON.stringify(inputJson) + '\n'); proc.stdin?.end() } catch { /* pipe closed */ }

    const onData = (chunk: Buffer, target: 'out' | 'err') => {
      totalBytes += chunk.length
      if (totalBytes > MAX_OUTPUT_BYTES) { try { proc.kill('SIGKILL') } catch { /* */ } return }
      if (target === 'out') stdout += chunk.toString()
      else stderr += chunk.toString()
    }
    proc.stdout?.on('data', (c: Buffer) => onData(c, 'out'))
    proc.stderr?.on('data', (c: Buffer) => onData(c, 'err'))

    // ⚠ 不再建/删工作目录：cwd 现在是用户的项目目录，任何 rm 都会误删真实文件
    proc.on('close', (exitCode) => {
      clearTimeout(timer)
      const { decision, blockReason, transformedOutput } = parseDecision(stdout, exitCode)
      resolve({ ...base, exitCode, stdout, stderr, decision, blockReason, transformedOutput, durationMs: Date.now() - startMs, timedOut })
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ...base, exitCode: null, stdout, stderr, decision: 'none', error: err.message, durationMs: Date.now() - startMs, timedOut })
    })
  })
}

async function runHttp(
  action: HookAction,
  inputJson: Record<string, unknown>,
  timeoutMs: number,
  startMs: number,
  base: Omit<HookDryRunResult, 'decision' | 'blockReason' | 'transformedOutput' | 'durationMs' | 'timedOut'>
): Promise<HookDryRunResult> {
  const url = action.url ?? ''
  const method = action.method ?? 'POST'
  const headers = { 'Content-Type': 'application/json', ...(action.headers ?? {}) }
  let body = action.body ?? JSON.stringify(inputJson)
  body = body.replace(/\$\{([^}]+)\}/g, (_, k) => {
    const v = (inputJson as Record<string, unknown>)[k]
    return v !== undefined ? String(v) : ''
  })
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { method, headers, body: method !== 'GET' ? body : undefined, signal: ctrl.signal })
    clearTimeout(timer)
    const responseBody = await res.text()
    if (!res.ok) {
      // Non-2xx is a transport/server error, not a deliberate block — don't feed to parseDecision
      let decision: HookDryRunResult['decision'] = 'none'
      let blockReason: string | undefined
      const trimmed = responseBody.trim()
      if (trimmed.startsWith('{')) {
        try {
          const p = JSON.parse(trimmed) as Record<string, unknown>
          if (p.decision === 'block') { decision = 'block'; blockReason = (p.reason ?? p.message) as string | undefined }
        } catch { /* not JSON */ }
      }
      const httpErr = decision === 'none' ? `HTTP ${res.status}` : undefined
      return { ...base, exitCode: res.status, stdout: responseBody, stderr: '', decision, blockReason, transformedOutput: undefined, durationMs: Date.now() - startMs, timedOut: false, httpStatus: res.status, httpResponseBody: responseBody, error: httpErr }
    }
    const { decision, blockReason, transformedOutput } = parseDecision(responseBody, 0)
    return { ...base, exitCode: res.status, stdout: responseBody, stderr: '', decision, blockReason, transformedOutput, durationMs: Date.now() - startMs, timedOut: false, httpStatus: res.status, httpResponseBody: responseBody }
  } catch (err) {
    const e = err as Error
    return { ...base, exitCode: null, stdout: '', stderr: '', decision: 'none', error: e.message, durationMs: Date.now() - startMs, timedOut: e.name === 'AbortError' }
  }
}

/**
 * 沙箱 dry-run 一个 hook action。
 * 安全边界：spawn + 临时 cwd + env 白名单 + 超时硬杀 + 输出上限 + 网络默认关。
 * ⚠ 仍是真实执行，hook 本身的副作用（写文件等）不可被拦截，UI 必须显著警示。
 */
export async function dryRunHook(hook: Hook, action: HookAction, input: HookSimInput): Promise<HookDryRunResult> {
  const actionType = resolveActionType(action)
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS)
  const startMs = Date.now()

  const base = {
    hookName: hook.name,
    hookType: hook.type,
    actionType,
    exitCode: null as number | null,
    stdout: '',
    stderr: '',
  }

  if (actionType === 'prompt') {
    // prompt hook 交给 LLM 执行，dry-run 只展示模板
    return { ...base, decision: 'none', durationMs: 0, timedOut: false, stdout: action.prompt ?? '' }
  }

  const inputJson = buildInputJson(hook, input)

  if (actionType === 'http') {
    if (!input.allowNetwork) {
      return { ...base, decision: 'none', error: 'network_disabled', durationMs: Date.now() - startMs, timedOut: false }
    }
    return runHttp(action, inputJson, timeoutMs, startMs, base)
  }

  return runCommand(action, inputJson, timeoutMs, startMs, base, resolveWorkDir(hook, input))
}
