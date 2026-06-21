import fs from 'fs/promises'
import path from 'path'
import type { Hook, HookAction, HookSettingsMatcher } from '../../shared/types'
import { validateAction } from './hook-validation'
import { FileManagerAgents } from './file-manager-agents'

export class FileManagerHooks extends FileManagerAgents {
  // Hooks
  /** settings.json 内层 hook → domain HookAction：按 type 分流，旧抽象动词映射为 command/http/prompt。 */
  private hookActionFromSettings(raw: Record<string, unknown>): HookAction {
    const type = this.resolveActionType(raw as { type?: string; url?: string; prompt?: string; command?: string })
    const action: HookAction = { type }
    if (type === 'command') {
      if (typeof raw.command === 'string') action.command = raw.command
      if (Array.isArray(raw.args)) action.args = raw.args as string[]
    } else if (type === 'http') {
      if (typeof raw.url === 'string') action.url = raw.url
      if (raw.method === 'GET' || raw.method === 'POST' || raw.method === 'PUT') action.method = raw.method
      if (raw.headers && typeof raw.headers === 'object') action.headers = raw.headers as Record<string, string>
      if (typeof raw.body === 'string') action.body = raw.body
    } else {
      if (typeof raw.prompt === 'string') action.prompt = raw.prompt
    }
    if (typeof raw.timeout === 'number') action.timeout = raw.timeout
    if (typeof raw.continueOnError === 'boolean') action.continueOnError = raw.continueOnError
    if (typeof raw.continueOnBlock === 'boolean') action.continueOnBlock = raw.continueOnBlock
    if (typeof raw.terminalSequence === 'string') action.terminalSequence = raw.terminalSequence
    return action
  }

  /** 归一 action.type：command/http/prompt 直取；legacy 动词/缺失按字段推断（有 url→http，有 prompt 无 command→prompt，否则 command）。 */
  private resolveActionType(a: { type?: string; url?: string; prompt?: string; command?: string }): 'command' | 'http' | 'prompt' {
    if (a.type === 'http' || a.type === 'prompt' || a.type === 'command') return a.type
    if (a.url) return 'http'
    if (a.prompt && !a.command) return 'prompt'
    return 'command'
  }

  /** domain HookAction → settings.json 内层 hook：只写该 type 相关字段，legacy 动词归一。 */
  private hookActionToSettings(a: HookAction): Record<string, unknown> {
    const type = this.resolveActionType(a)
    const out: Record<string, unknown> = { type }
    if (type === 'command') {
      if (a.command) out.command = a.command
      if (a.args?.length) out.args = a.args
    } else if (type === 'http') {
      if (a.url) out.url = a.url
      if (a.method) out.method = a.method
      if (a.headers && Object.keys(a.headers).length) out.headers = a.headers
      if (a.body) out.body = a.body
    } else {
      if (a.prompt) out.prompt = a.prompt
    }
    if (typeof a.timeout === 'number') out.timeout = a.timeout
    if (a.continueOnError) out.continueOnError = a.continueOnError
    if (a.continueOnBlock) out.continueOnBlock = a.continueOnBlock
    if (a.terminalSequence) out.terminalSequence = a.terminalSequence
    return out
  }

  async getHooks(): Promise<Hook[]> {
    const hooks: Hook[] = []

    // 1. Read hooks from settings.json files (Claude Code's native format)
    const settingsFiles = [
      { path: path.join(this.userConfigPath, 'settings.json'), location: 'user' as const },
      { path: path.join(this.projectPath, '.claude', 'settings.json'), location: 'project' as const },
      { path: path.join(this.projectPath, '.claude', 'settings.local.json'), location: 'project' as const },
    ]

    for (const { path: settingsPath, location } of settingsFiles) {
      try {
        const settings = await this.readJSONFile<{
          hooks?: Record<string, Array<Record<string, unknown>>>
        }>(settingsPath)

        if (settings?.hooks) {
          // Convert Claude Code settings.json hooks format to our Hook format
          for (const [eventType, matchers] of Object.entries(settings.hooks)) {
            for (let i = 0; i < matchers.length; i++) {
              const matcher = matchers[i] || {}
              const matcherStr = typeof matcher.matcher === 'string' ? matcher.matcher : ''
              const hookName = `${eventType}${matcherStr ? `-${matcherStr.replace(/[|*]/g, '_')}` : ''}-${i}`

              const rawHooks = Array.isArray(matcher.hooks) ? (matcher.hooks as Array<Record<string, unknown>>) : []
              const actions = rawHooks.map((h) => this.hookActionFromSettings(h))

              const hookObj: Hook = {
                name: hookName,
                type: eventType as Hook['type'],
                enabled: true,
                description: `${eventType} hook${matcherStr ? ` for ${matcherStr}` : ''}`,
                pattern: matcherStr,
                actions,
                filePath: settingsPath,
                location,
                matcherIndex: i, // Track the index for editing/deleting
              }
              // matcher 级扩展字段（spec007）
              if (typeof matcher.reloadSkills === 'boolean' || typeof matcher.sessionTitle === 'string') {
                hookObj.sessionStart = {
                  ...(typeof matcher.reloadSkills === 'boolean' ? { reloadSkills: matcher.reloadSkills } : {}),
                  ...(typeof matcher.sessionTitle === 'string' ? { sessionTitle: matcher.sessionTitle } : {}),
                }
              }
              if (typeof matcher.replaceToolOutput === 'boolean') hookObj.replaceToolOutput = matcher.replaceToolOutput
              if (typeof matcher.maxBlocks === 'number') hookObj.maxBlocks = matcher.maxBlocks
              this.logger.info('Loaded hook with matcherIndex:', hookName, 'matcherIndex:', i)
              hooks.push(hookObj)
            }
          }
        }
      } catch {
        // Settings file doesn't exist or is invalid, continue
      }
    }

    // 2. Also read hooks from legacy .claude/hooks/ directories (for backwards compatibility)
    const projectHooks = await this.scanDirectory(
      path.join(this.projectPath, '.claude', 'hooks'),
      '.json'
    )
    const userHooks = await this.scanDirectory(
      path.join(this.userConfigPath, 'hooks'),
      '.json'
    )

    const allHookPaths = [
      ...projectHooks.map((p) => ({ path: p, location: 'project' as const })),
      ...userHooks.map((p) => ({ path: p, location: 'user' as const })),
    ]

    for (const { path: hookPath, location } of allHookPaths) {
      const hook = await this.readJSONFile<Hook>(hookPath)
      if (hook) {
        hooks.push({ ...hook, filePath: hookPath, location })
      }
    }

    return hooks
  }

  async getHook(name: string): Promise<Hook | null> {
    const hooks = await this.getHooks()
    return hooks.find((h) => h.name === name) || null
  }

  async saveHook(hook: Hook): Promise<void> {
    const location = hook.location || 'project'
    const dir = location === 'project'
      ? path.join(this.projectPath, '.claude', 'hooks')
      : path.join(this.userConfigPath, 'hooks')

    const filePath = path.join(dir, `${hook.name}.json`)
    await this.writeJSONFile(filePath, hook)
  }

  async saveHookRaw(_name: string, content: string, filePath: string): Promise<void> {
    if (!filePath) {
      throw new Error('File path is required for saving raw hook content')
    }

    // 验证 JSON 格式
    try {
      JSON.parse(content)
    } catch (error) {
      throw new Error('Invalid JSON content: ' + (error as Error).message)
    }

    // 确保目录存在
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    this.logger.info('Saving raw hook content to:', filePath)
    await fs.writeFile(filePath, content, 'utf-8')
    this.logger.info('Saved raw hook to:', filePath)
  }

  async deleteHook(name: string): Promise<void> {
    const hook = await this.getHook(name)
    if (hook?.filePath) {
      await fs.unlink(hook.filePath)
    }
  }

  // Save hook to Claude Code settings.json format
  async saveHookToSettings(
    hookType: string,
    hookConfig: HookSettingsMatcher,
    location: 'user' | 'project',
    projectPath?: string,
    matcherIndex?: number // If provided, update existing hook at this index; otherwise add new
  ): Promise<void> {
    const settingsPath = location === 'user'
      ? path.join(this.userConfigPath, 'settings.json')
      : path.join(projectPath || this.projectPath, '.claude', 'settings.json')

    this.logger.info('Saving hook to settings:', settingsPath, 'matcherIndex:', matcherIndex)

    // 按 action.type 序列化内层 hook，并逐个 ajv 校验（绕过前端也拦得住，spec007）
    const innerHooks = (hookConfig.hooks || []).map((a) => this.hookActionToSettings(a))
    for (const h of innerHooks) {
      const { valid, errors } = validateAction(h)
      if (!valid) throw new Error(`Invalid hook action: ${errors.join('; ')}`)
    }

    // 读现有 hooks 子树（统一走 SettingsWriter；其余顶层 key 由 writeKeyAtPath 保留，spec009）
    const snap = await this.settingsWriter.readAtPath(settingsPath, location)
    if (snap.parseError) throw new Error(`settings.json 解析失败，未写入：${snap.parseError}`)
    const rawHooks = snap.raw.hooks
    const hooksObj: Record<string, unknown[]> =
      rawHooks && typeof rawHooks === 'object' && !Array.isArray(rawHooks)
        ? (rawHooks as Record<string, unknown[]>)
        : {}

    // Initialize this hook type array if it doesn't exist
    if (!hooksObj[hookType]) {
      hooksObj[hookType] = []
    }

    const updating = matcherIndex !== undefined && matcherIndex >= 0 && matcherIndex < hooksObj[hookType].length
    // 编辑时以原 matcher 对象为底，保留本工具未建模的未知字段（spec009 铁律：不丢用户字段）
    const existing = updating ? (hooksObj[hookType][matcherIndex] as Record<string, unknown>) : {}

    // 建模的 matcher 级字段为权威：present 则写、absent 则删（让用户能清掉之前设过的值）
    const matcherObj: Record<string, unknown> = { ...existing, hooks: innerHooks }
    const setOrDelete = (key: string, val: unknown) => {
      if (val === undefined) delete matcherObj[key]
      else matcherObj[key] = val
    }
    setOrDelete('matcher', hookConfig.matcher || undefined)
    setOrDelete('reloadSkills', typeof hookConfig.reloadSkills === 'boolean' ? hookConfig.reloadSkills : undefined)
    setOrDelete('sessionTitle', hookConfig.sessionTitle || undefined)
    setOrDelete('replaceToolOutput', typeof hookConfig.replaceToolOutput === 'boolean' ? hookConfig.replaceToolOutput : undefined)
    setOrDelete('maxBlocks', typeof hookConfig.maxBlocks === 'number' ? hookConfig.maxBlocks : undefined)

    // Update existing or add new hook config
    if (updating) {
      hooksObj[hookType][matcherIndex] = matcherObj
      this.logger.info('Updated existing hook at index:', matcherIndex)
    } else {
      hooksObj[hookType].push(matcherObj)
      this.logger.info('Added new hook config')
    }

    await this.settingsWriter.writeKeyAtPath(settingsPath, 'hooks', hooksObj)
    this.logger.info('Saved hook to settings:', settingsPath)
  }

  // Delete hook from settings.json
  async deleteHookFromSettings(
    hookType: string,
    matcherIndex: number,
    location: 'user' | 'project',
    projectPath?: string
  ): Promise<void> {
    const settingsPath = location === 'user'
      ? path.join(this.userConfigPath, 'settings.json')
      : path.join(projectPath || this.projectPath, '.claude', 'settings.json')

    this.logger.info('Deleting hook from settings:', settingsPath, 'type:', hookType, 'index:', matcherIndex)

    // Read existing settings（统一走 SettingsWriter）
    const snap = await this.settingsWriter.readAtPath(settingsPath, location)
    if (!snap.exists) {
      this.logger.warn('Settings file not found:', settingsPath)
      return
    }
    const hooksObj = snap.raw.hooks as Record<string, Array<{
      matcher?: string
      hooks?: Array<{
        type: string
        command?: string
        prompt?: string
        timeout?: number
      }>
    }>> | undefined
    if (!hooksObj || !hooksObj[hookType]) {
      this.logger.warn('Hook type not found:', hookType)
      return
    }

    // Get the hook config before deleting to find script files
    const hookConfig = hooksObj[hookType][matcherIndex]
    if (hookConfig?.hooks) {
      // Delete associated script files
      const basePath = location === 'user'
        ? this.userConfigPath
        : (projectPath || this.projectPath)

      for (const hook of hookConfig.hooks) {
        const command = hook.command || hook.prompt || ''
        // Check if it's a script file (ends with .sh or starts with .claude/)
        if (command && (command.endsWith('.sh') || command.startsWith('.claude/'))) {
          const fullPath = path.join(basePath, command)
          try {
            await fs.unlink(fullPath)
            this.logger.info('Deleted script file:', fullPath)
          } catch (error) {
            // Script file doesn't exist, that's fine
            this.logger.warn('Failed to delete script file (may not exist):', fullPath, error)
          }
        }
      }
    }

    // Remove the hook at the specified index
    hooksObj[hookType].splice(matcherIndex, 1)

    // Remove the hook type if empty
    if (hooksObj[hookType].length === 0) {
      delete hooksObj[hookType]
    }

    // hooks 子树空了就整 key unset，否则写回；其余顶层 key 由 writeKeyAtPath 保留
    const emptied = Object.keys(hooksObj).length === 0
    await this.settingsWriter.writeKeyAtPath(settingsPath, 'hooks', emptied ? undefined : hooksObj)
    this.logger.info('Deleted hook from settings:', settingsPath)
  }

  // Create hook shell script file
  async createHookScript(
    scriptPath: string,
    content: string,
    location: 'user' | 'project',
    projectPath?: string
  ): Promise<string> {
    // Determine base path
    const basePath = location === 'user'
      ? this.userConfigPath
      : (projectPath || this.projectPath)

    // Full path to the script
    const fullPath = path.join(basePath, scriptPath)

    this.logger.info('Creating hook script at:', fullPath)

    // Ensure directory exists
    const dir = path.dirname(fullPath)
    await fs.mkdir(dir, { recursive: true })

    // Write the script content
    await fs.writeFile(fullPath, content, { encoding: 'utf-8', mode: 0o755 })

    this.logger.info('Created hook script:', fullPath)
    return fullPath
  }

  // Read hook script content
  async readHookScript(
    scriptPath: string,
    location: 'user' | 'project',
    projectPath?: string
  ): Promise<string | null> {
    const basePath = location === 'user'
      ? this.userConfigPath
      : (projectPath || this.projectPath)

    const fullPath = path.join(basePath, scriptPath)

    try {
      const content = await fs.readFile(fullPath, 'utf-8')
      return content
    } catch {
      return null
    }
  }
}
