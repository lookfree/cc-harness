import fs from 'fs/promises'
import path from 'path'
import { watch, FSWatcher } from 'chokidar'
import os from 'os'
import type { Skill, SkillSource, SkillUid, InstalledPluginEntry, Agent, Hook, MCPServers, SlashCommand, ProjectContext, ConfigFile, Marketplace, MarketplaceSource, Plugin, PluginVersion, PluginManifest, PluginComponentCount } from '../../shared/types'
import { globScan, isMissing } from './glob-scan'

export class FileManager {
  private static instance: FileManager
  private projectPath: string = process.cwd()
  private userConfigPath: string = path.join(os.homedir(), '.claude')
  private watcher: FSWatcher | null = null
  private changeCallbacks: Array<(files: ConfigFile[]) => void> = []

  // Constants for security and performance
  private readonly MAX_SCAN_DEPTH = 3
  private readonly MAX_FILES_TO_SCAN = 1000
  private readonly SCAN_TIMEOUT_MS = 10000 // 10 seconds
  private readonly ALLOWED_SCAN_ROOTS = [
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Projects'),
    path.join(os.homedir(), 'Developer'),
    path.join(os.homedir(), 'dev'),
    path.join(os.homedir(), 'workspace'),
    path.join(os.homedir(), 'code'),
    path.join(os.homedir(), 'src'),
  ]

  // Skip these directories for security and performance
  private readonly SKIP_DIRECTORIES = new Set([
    'node_modules',
    'vendor',
    'dist',
    'build',
    'out',
    'target',
    '__pycache__',
    'venv',
    'env',
    '.git',
    '.svn',
    '.hg',
    'bower_components',
  ])

  // Cache for parsed skills
  private skillCache = new Map<string, { skill: Skill; mtime: number }>()

  // Logger with levels - wrapped to handle EPIPE errors gracefully
  private logger = {
    info: (msg: string, ...args: unknown[]) => {
      try {
        console.log(`[FileManager][INFO]`, msg, ...args)
      } catch {
        // Ignore EPIPE errors when stdout is closed
      }
    },
    warn: (msg: string, ...args: unknown[]) => {
      try {
        console.warn(`[FileManager][WARN]`, msg, ...args)
      } catch {
        // Ignore EPIPE errors when stderr is closed
      }
    },
    error: (msg: string, ...args: unknown[]) => {
      try {
        console.error(`[FileManager][ERROR]`, msg, ...args)
      } catch {
        // Ignore EPIPE errors when stderr is closed
      }
    },
  }

  private constructor() {}

  static getInstance(): FileManager {
    if (!FileManager.instance) {
      FileManager.instance = new FileManager()
    }
    return FileManager.instance
  }

  initialize() {
    this.setupFileWatcher()
  }

  cleanup() {
    if (this.watcher) {
      this.watcher.close()
    }
  }

  setProjectPath(newPath: string) {
    this.projectPath = newPath
    this.setupFileWatcher()
  }

  private setupFileWatcher() {
    if (this.watcher) {
      this.watcher.close()
    }

    const watchPaths = [
      path.join(this.projectPath, '.claude'),
      path.join(this.userConfigPath),
    ]

    this.watcher = watch(watchPaths, {
      ignored: /(^|[/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    })

    this.watcher.on('change', async (filePath) => {
      this.logger.info(`File changed: ${filePath}`)
      const context = await this.getProjectContext()
      this.notifyFileChanges(context)
    })

    this.watcher.on('add', async (filePath) => {
      this.logger.info(`File added: ${filePath}`)
      const context = await this.getProjectContext()
      this.notifyFileChanges(context)
    })

    this.watcher.on('unlink', async (filePath) => {
      this.logger.info(`File removed: ${filePath}`)
      const context = await this.getProjectContext()
      this.notifyFileChanges(context)
    })
  }

  private notifyFileChanges(context: ProjectContext) {
    const allFiles = [
      ...context.skills,
      ...context.agents,
      ...context.hooks,
      ...context.mcpServers,
      ...context.commands,
    ]
    this.changeCallbacks.forEach((callback) => callback(allFiles))
  }

  onFilesChanged(callback: (files: ConfigFile[]) => void) {
    this.changeCallbacks.push(callback)
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async readJSONFile<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(content) as T
    } catch (error) {
      if (isMissing(error)) {
        // 文件不存在是正常状态（如未配置 MCP），静默返回 null
        return null
      }
      // 真错误：权限不足 / 是目录 / JSON 解析失败等，保留 error 以便排查
      this.logger.error(`Error reading JSON file ${filePath}:`, error)
      return null
    }
  }

  private async writeJSONFile(filePath: string, data: unknown): Promise<void> {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  private async scanDirectory(dirPath: string, extension: string): Promise<string[]> {
    try {
      const exists = await this.fileExists(dirPath)
      if (!exists) return []

      const files = await fs.readdir(dirPath)
      return files
        .filter((file) => file.endsWith(extension))
        .map((file) => path.join(dirPath, file))
    } catch {
      return []
    }
  }

  /**
   * 读 ~/.claude/plugins/installed_plugins.json（schema v2），解析成安装记录数组。
   * 这是「已安装/激活版本」的真相源——不盲扫 cache 目录（cache 里可能残留废弃版本）。
   * spec003 引入，spec004/005/006 共用。文件缺失/损坏由 readJSONFile 静默处理（返回 []）。
   */
  private async readInstalledPlugins(): Promise<InstalledPluginEntry[]> {
    const file = path.join(this.userConfigPath, 'plugins', 'installed_plugins.json')
    const data = await this.readJSONFile<{
      plugins?: Record<string, Array<{ scope?: string; version?: string; installPath?: string }>>
    }>(file)
    if (!data?.plugins) return []

    const out: InstalledPluginEntry[] = []
    for (const [key, entries] of Object.entries(data.plugins)) {
      // key 形如 'superpowers@claude-plugins-official'；marketplace 在最后一个 '@' 之后
      const at = key.lastIndexOf('@')
      const pluginName = at >= 0 ? key.slice(0, at) : key
      const marketplace = at >= 0 ? key.slice(at + 1) : ''
      for (const e of entries || []) {
        if (!e.installPath || !e.version) continue
        out.push({
          pluginName,
          marketplace,
          scope: e.scope === 'project' ? 'project' : 'user',
          version: e.version,
          installPath: e.installPath,
        })
      }
    }
    return out
  }

  /** 读 settings.json 的 enabledPlugins（"plugin 是否启用"真相源）。值为 false 表示显式禁用。ENOENT→{}。 */
  private async readEnabledPlugins(): Promise<Record<string, unknown>> {
    const data = await this.readJSONFile<{ enabledPlugins?: Record<string, unknown> }>(
      path.join(this.userConfigPath, 'settings.json')
    )
    return data?.enabledPlugins ?? {}
  }

  // ---- Plugins / Marketplaces (spec005) ----

  /** 读 known_marketplaces.json（{<name>:{source,installLocation,lastUpdated}}），map 成数组。ENOENT→[]。 */
  async getMarketplaces(): Promise<Marketplace[]> {
    const data = await this.readJSONFile<Record<string, { source?: MarketplaceSource; installLocation?: string; lastUpdated?: string }>>(
      path.join(this.userConfigPath, 'plugins', 'known_marketplaces.json')
    )
    if (!data) return []
    return Object.entries(data).map(([name, v]) => ({
      name,
      source: v.source ?? { source: 'unknown' },
      installLocation: v.installLocation,
      lastUpdated: v.lastUpdated,
    }))
  }

  /** 统计一个 plugin 安装目录下的组件数。目录不存在记 0。 */
  private async countPluginComponents(installPath: string): Promise<PluginComponentCount> {
    const skills = (await globScan(path.join(installPath, 'skills'), '*/SKILL.md', { maxDepth: 3 })).length
    const commands = (await this.scanDirectory(path.join(installPath, 'commands'), '.md')).length
    const agents = (await this.scanDirectory(path.join(installPath, 'agents'), '.md')).length
    let hooks = 0
    try {
      hooks = (await fs.readdir(path.join(installPath, 'hooks'))).length
    } catch (error) {
      if (!isMissing(error)) throw error // 目录不存在记 0
    }
    return { skills, commands, agents, hooks }
  }

  /** version 字符串转可比较 key（与 markSkillOverrides 同口径）。 */
  private semverKey(v?: string): string {
    return (v ?? '0').split('.').map((n) => String(parseInt(n, 10) || 0).padStart(6, '0')).join('.')
  }

  /**
   * 当前生效版本判定：enabled 且 user-scope 的最高 version；
   * 无 user-scope 取 enabled 的最高 version；都没有取最高 version。
   */
  private pickCurrent(versions: PluginVersion[]): PluginVersion | undefined {
    if (versions.length === 0) return undefined
    const best = (list: PluginVersion[]) =>
      list.length ? list.reduce((a, b) => (this.semverKey(b.version) > this.semverKey(a.version) ? b : a)) : undefined
    const enabledUser = versions.filter((v) => v.enabled && v.scope === 'user')
    const enabled = versions.filter((v) => v.enabled)
    return best(enabledUser) ?? best(enabled) ?? best(versions)
  }

  /** 列出所有已装 plugin：按 plugin@marketplace 分组，带版本/manifest/组件计数/当前版本。 */
  async getPlugins(): Promise<Plugin[]> {
    const enabled = await this.readEnabledPlugins()
    const byKey = new Map<string, InstalledPluginEntry[]>()
    for (const e of await this.readInstalledPlugins()) {
      const key = `${e.pluginName}@${e.marketplace}`
      const g = byKey.get(key)
      if (g) g.push(e)
      else byKey.set(key, [e])
    }

    const out: Plugin[] = []
    for (const [key, entries] of byKey) {
      const name = entries[0].pluginName
      const marketplace = entries[0].marketplace
      const isEnabled = enabled[key] === true
      const versions: PluginVersion[] = []
      for (const e of entries) {
        const manifest = await this.readJSONFile<PluginManifest>(
          path.join(e.installPath, '.claude-plugin', 'plugin.json')
        )
        versions.push({
          version: e.version,
          scope: e.scope,
          installPath: e.installPath,
          enabled: isEnabled,
          isCurrent: false,
          manifest: manifest ?? undefined,
          components: await this.countPluginComponents(e.installPath),
        })
      }
      const current = this.pickCurrent(versions)
      if (current) current.isCurrent = true
      out.push({ key, name, marketplace, enabled: isEnabled, versions, currentVersion: current?.version })
    }
    return out
  }

  /** 改 settings.json 的 enabledPlugins[key]=val，保留其他字段。ENOENT 新建。 */
  async setEnabledPlugin(key: string, val: boolean): Promise<void> {
    const file = path.join(this.userConfigPath, 'settings.json')
    let raw: Record<string, unknown> = {}
    try {
      raw = JSON.parse(await fs.readFile(file, 'utf-8'))
    } catch (error) {
      if (!isMissing(error)) throw error // 非缺失（JSON 损坏等）不静默吞，避免覆盖坏文件
    }
    const enabledPlugins = { ...((raw.enabledPlugins as Record<string, unknown>) ?? {}), [key]: val }
    const next = { ...raw, enabledPlugins }
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
    await fs.rename(tmp, file)
  }

  /** skill 稳定唯一标识：plugin 含 marketplace/plugin/version，否则 source:name。 */
  private computeSkillUid(s: Skill): SkillUid {
    return s.source === 'plugin'
      ? `plugin:${s.marketplace}/${s.pluginName}@${s.version}/${s.name}`
      : `${s.source ?? 'user'}:${s.name}`
  }

  /**
   * 扫一个 skill 根目录下的 <name>/SKILL.md，解析后用 opts 装饰（source + plugin 元信息）推入 out。
   * 统一 user/project/plugin 三层的扫描+解析+装饰，消除重复循环。dir 不存在静默跳过。
   */
  private async scanSkillDir(
    dir: string,
    opts: { source: SkillSource; marketplace?: string; pluginName?: string; version?: string; pluginScope?: 'user' | 'project' },
    out: Skill[]
  ): Promise<void> {
    const hits = await globScan(dir, '*/SKILL.md', { maxDepth: 3, maxResults: 2000 })
    const location = opts.source === 'project' ? 'project' : 'user' // 兼容旧 location 字段（plugin/user→'user'）
    for (const skillMdPath of hits) {
      const skill = await this.parseSkillMD(skillMdPath, location)
      if (skill) out.push({ ...skill, ...opts })
    }
  }

  /**
   * 同名 skill 覆盖检测：优先级 user > project > plugin；同为 plugin 时 user-scope > project-scope，再版本号高者。
   * winner 正常显示，其余标 overriddenBy=winner 的 uid（不丢，供 UI 灰显）。
   */
  private markSkillOverrides(skills: Skill[]): void {
    const rankTuple = (s: Skill): [number, number, string] => [
      s.source === 'user' ? 3 : s.source === 'project' ? 2 : 1,
      s.pluginScope === 'user' ? 1 : 0,
      this.semverKey(s.version),
    ]
    const gt = (a: Skill, b: Skill): boolean => {
      const ta = rankTuple(a), tb = rankTuple(b)
      for (let i = 0; i < 3; i++) if (ta[i] !== tb[i]) return ta[i] > tb[i]
      return false
    }
    const byName = new Map<string, Skill[]>()
    for (const s of skills) {
      const g = byName.get(s.name)
      if (g) g.push(s)
      else byName.set(s.name, [s])
    }
    for (const group of byName.values()) {
      if (group.length < 2) continue
      const winner = group.reduce((a, b) => (gt(b, a) ? b : a))
      const winnerUid = this.computeSkillUid(winner)
      for (const s of group) if (s !== winner) s.overriddenBy = winnerUid
    }
  }

  // Skills
  async getSkills(): Promise<Skill[]> {
    const out: Skill[] = []

    // 1) user：~/.claude/skills/<name>/SKILL.md
    await this.scanSkillDir(path.join(this.userConfigPath, 'skills'), { source: 'user' }, out)

    // 2) project：<cwd>/.claude/skills/<name>/SKILL.md
    await this.scanSkillDir(path.join(this.projectPath, '.claude', 'skills'), { source: 'project' }, out)

    // 2b) project 旧 JSON 格式 skills（非 Claude Code 标准格式，但本项目历史支持，保留兼容）
    const projectJson = await this.scanDirectory(path.join(this.projectPath, '.claude', 'skills'), '.json')
    for (const p of projectJson) {
      const skill = await this.readJSONFile<Skill>(p)
      if (skill) out.push({ ...skill, filePath: p, location: 'project', source: 'project' })
    }

    // 3) plugin：installed_plugins.json 为准只扫激活版本，按 enabledPlugins 跳过显式禁用的
    const enabled = await this.readEnabledPlugins()
    for (const pl of await this.readInstalledPlugins()) {
      if (enabled[`${pl.pluginName}@${pl.marketplace}`] === false) continue
      await this.scanSkillDir(path.join(pl.installPath, 'skills'), {
        source: 'plugin',
        marketplace: pl.marketplace,
        pluginName: pl.pluginName,
        version: pl.version,
        pluginScope: pl.scope,
      }, out)
    }

    // 4) 同名覆盖检测：winner 正常、其余标 overriddenBy
    this.markSkillOverrides(out)

    this.logger.info('getSkills() returning', out.length, 'skills')
    return out
  }

  private async parseSkillMD(filePath: string, location: 'user' | 'project'): Promise<Skill | null> {
    try {
      // Check cache first
      const stats = await fs.stat(filePath)
      const cached = this.skillCache.get(filePath)

      if (cached && cached.mtime === stats.mtime.getTime()) {
        this.logger.info(`Using cached skill: ${path.basename(filePath)}`)
        return cached.skill
      }

      const content = await fs.readFile(filePath, 'utf-8')

      // Parse YAML frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!frontmatterMatch) {
        this.logger.warn(`No frontmatter found, skipping: ${filePath}`)
        return null
      }

      const frontmatter = frontmatterMatch[1]
      const lines = frontmatter.split('\n')
      const metadata: Record<string, string> = {}

      for (const line of lines) {
        const colonIndex = line.indexOf(':')
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim()
          const value = line.slice(colonIndex + 1).trim()
          metadata[key] = value
        }
      }

      const name = metadata.name || path.basename(path.dirname(filePath))
      const description = metadata.description || ''

      // Extract instructions (everything after frontmatter)
      const instructions = content.slice(frontmatterMatch[0].length).trim()

      // Get skill directory
      const skillDir = path.dirname(filePath)

      // Scan for references directory
      const references: Array<{ type: 'file' | 'package' | 'api' | 'tool'; path: string; description?: string }> = []
      const referencesDir = path.join(skillDir, 'references')
      if (await this.fileExists(referencesDir)) {
        try {
          const refFiles = await fs.readdir(referencesDir)
          for (const file of refFiles) {
            references.push({
              type: 'file',
              path: `references/${file}`,
            })
          }
        } catch (error) {
          // Ignore errors reading references
        }
      }

      // Scan for scripts directory
      const scripts: Array<{ name: string; command: string; description?: string; content?: string }> = []
      const scriptsDir = path.join(skillDir, 'scripts')
      if (await this.fileExists(scriptsDir)) {
        try {
          const scriptFiles = await fs.readdir(scriptsDir)
          for (const file of scriptFiles) {
            const ext = path.extname(file)
            if (ext === '.py' || ext === '.sh' || ext === '.js' || ext === '.ts') {
              const scriptPath = path.join(scriptsDir, file)
              let content: string | undefined
              let description: string | undefined

              try {
                // Read script content
                const scriptContent = await fs.readFile(scriptPath, 'utf-8')
                content = scriptContent

                // Extract description from first comment block
                if (ext === '.py') {
                  // Match Python docstrings
                  const docMatch = scriptContent.match(/(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/)
                  if (docMatch) {
                    description = (docMatch[1] || docMatch[2]).trim().split('\n')[0]
                  }
                } else if (ext === '.sh') {
                  // Match shell script comments
                  const lines = scriptContent.split('\n')
                  for (const line of lines) {
                    if (line.startsWith('#') && !line.startsWith('#!')) {
                      description = line.slice(1).trim()
                      break
                    }
                  }
                }

                // Count lines
                const lineCount = scriptContent.split('\n').length
                description = description || `${lineCount} lines`
              } catch (err) {
                // Ignore errors reading individual files
              }

              const commandPrefix = ext === '.py' ? 'python' : ext === '.sh' ? 'bash' : 'node'
              scripts.push({
                name: file,
                command: `${commandPrefix} scripts/${file}`,
                description,
                content,
              })
            }
          }
        } catch (error) {
          // Ignore errors reading scripts
        }
      }

      // Extract triggers from content with more detail
      const triggers: {
        commands?: string[]
        contexts?: string[]
        keywords?: {
          actions?: Array<{ word: string; type: string }>
          formats?: Array<{ word: string; type: string }>
          topics?: Array<{ word: string; type: string }>
          technologies?: Array<{ word: string; type: string }>
        }
        examples?: string[]
      } = {}

      // Extract action keywords
      const actionWords = new Set<string>()
      const actionMatches = instructions.match(/\b(create|generate|convert|export|update|delete|add|remove|edit|modify|analyze|process|extract|validate|build|make|design|develop|implement|test|deploy|fix)\b/gi)
      if (actionMatches) {
        actionMatches.forEach(w => actionWords.add(w.toLowerCase()))
      }

      // Extract format keywords
      const formatWords = new Set<string>()
      const formatMatches = instructions.match(/\b(json|yaml|xml|csv|markdown|html|pdf|png|svg|jpg|jpeg|gif|webp|mp4|avi|zip|tar|gz)\b/gi)
      if (formatMatches) {
        formatMatches.forEach(w => formatWords.add(w.toLowerCase()))
      }

      // Extract topic keywords
      const topicWords = new Set<string>()
      const topicMatches = instructions.match(/\b(diagram|chart|graph|visualization|report|documentation|test|analysis|workflow|pipeline|architecture|design|model)\b/gi)
      if (topicMatches) {
        topicMatches.forEach(w => topicWords.add(w.toLowerCase()))
      }

      // Extract technology keywords
      const techWords = new Set<string>()
      const techMatches = instructions.match(/\b(plantuml|uml|python|javascript|typescript|react|node|docker|kubernetes|aws|gcp|azure|git|github)\b/gi)
      if (techMatches) {
        techMatches.forEach(w => techWords.add(w.toLowerCase()))
      }

      // Extract example queries from markdown code blocks or quoted text
      const examples: string[] = []
      const exampleMatches = instructions.match(/(?:"([^"]+)"|`([^`]+)`|Example:\s*(.+?)(?:\n|$))/gi)
      if (exampleMatches) {
        exampleMatches.slice(0, 5).forEach(match => {
          const cleaned = match.replace(/^["'`]|["'`]$/g, '').replace(/^Example:\s*/i, '').trim()
          if (cleaned.length > 10 && cleaned.length < 100) {
            examples.push(cleaned)
          }
        })
      }

      if (actionWords.size > 0 || formatWords.size > 0 || topicWords.size > 0 || techWords.size > 0) {
        triggers.keywords = {
          actions: actionWords.size > 0 ? Array.from(actionWords).map(w => ({ word: w, type: 'action' })) : undefined,
          formats: formatWords.size > 0 ? Array.from(formatWords).map(w => ({ word: w, type: 'format' })) : undefined,
          topics: topicWords.size > 0 ? Array.from(topicWords).map(w => ({ word: w, type: 'topic' })) : undefined,
          technologies: techWords.size > 0 ? Array.from(techWords).map(w => ({ word: w, type: 'technology' })) : undefined,
        }

        this.logger.info(`Extracted triggers for ${name}:`, {
          actions: actionWords.size,
          formats: formatWords.size,
          topics: topicWords.size,
          technologies: techWords.size,
          examples: examples.length
        })
      }

      if (examples.length > 0) {
        triggers.examples = examples
      }

      // Also keep simple commands list for backward compatibility
      if (actionWords.size > 0) {
        triggers.commands = Array.from(actionWords)
      }

      const skill: Skill = {
        name,
        type: 'skill',
        description,
        enabled: true,
        implementation: {
          type: 'inline',
          instructions,
        },
        filePath,
        location,
        references: references.length > 0 ? references : undefined,
        scripts: scripts.length > 0 ? scripts : undefined,
        triggers: Object.keys(triggers).length > 0 ? triggers : undefined,
        content, // Add full markdown content for frontend analysis
      }

      // Cache the parsed skill
      this.skillCache.set(filePath, {
        skill,
        mtime: stats.mtime.getTime()
      })

      return skill
    } catch (error) {
      this.logger.error(`Error parsing SKILL.md at ${filePath}:`, error)
      return null
    }
  }

  async getSkill(name: string): Promise<Skill | null> {
    const skills = await this.getSkills()
    // 同名多条时确定性地返回 winner（未被覆盖的生效那条），而非任意首个，
    // 避免 save/delete 命中被覆盖的旧版本（code-review #3）。
    return (
      skills.find((s) => s.name === name && !s.overriddenBy) ??
      skills.find((s) => s.name === name) ??
      null
    )
  }

  async saveSkill(skill: Skill): Promise<void> {
    // 插件 skill 只读：由插件系统管理，不能通过本工具保存（否则会错写一个同名 user skill）。
    if (skill.source === 'plugin') {
      throw new Error(`插件 skill「${skill.name}」由插件管理，是只读的，不能保存`)
    }
    const location = skill.location || 'project'
    const dir = location === 'project'
      ? path.join(this.projectPath, '.claude', 'skills')
      : path.join(this.userConfigPath, 'skills')

    const filePath = path.join(dir, `${skill.name}.json`)
    await this.writeJSONFile(filePath, skill)
  }

  async deleteSkill(name: string): Promise<void> {
    const skill = await this.getSkill(name)
    if (!skill) return
    // 插件 skill 只读护栏（关键）：其 filePath 指向插件安装目录里的真实 SKILL.md，
    // 且 getSkill 按 name 解析可能命中插件那条 —— 误删会直接损坏已装插件。一律拦截。
    if (skill.source === 'plugin') {
      throw new Error(`插件 skill「${name}」由插件管理，是只读的，不能删除`)
    }
    if (skill.filePath) {
      await fs.unlink(skill.filePath)
    }
  }

  // Agents
  async getAgents(): Promise<Agent[]> {
    const projectAgents = await this.scanDirectory(
      path.join(this.projectPath, '.claude', 'agents'),
      '.json'
    )
    const userAgents = await this.scanDirectory(
      path.join(this.userConfigPath, 'agents'),
      '.json'
    )

    const allAgentPaths = [
      ...projectAgents.map((p) => ({ path: p, location: 'project' as const })),
      ...userAgents.map((p) => ({ path: p, location: 'user' as const })),
    ]

    const agents: Agent[] = []
    for (const { path: agentPath, location } of allAgentPaths) {
      const agent = await this.readJSONFile<Agent>(agentPath)
      if (agent) {
        agents.push({ ...agent, filePath: agentPath, location })
      }
    }

    return agents
  }

  async getAgent(name: string): Promise<Agent | null> {
    const agents = await this.getAgents()
    return agents.find((a) => a.name === name) || null
  }

  async saveAgent(agent: Agent): Promise<void> {
    const location = agent.location || 'project'
    const dir = location === 'project'
      ? path.join(this.projectPath, '.claude', 'agents')
      : path.join(this.userConfigPath, 'agents')

    const filePath = path.join(dir, `${agent.name}.json`)
    await this.writeJSONFile(filePath, agent)
  }

  async deleteAgent(name: string): Promise<void> {
    const agent = await this.getAgent(name)
    if (agent?.filePath) {
      await fs.unlink(agent.filePath)
    }
  }

  // Hooks
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
          hooks?: Record<string, Array<{
            matcher?: string
            hooks?: Array<{
              type: string
              command?: string
              prompt?: string
              timeout?: number
            }>
          }>>
        }>(settingsPath)

        if (settings?.hooks) {
          // Convert Claude Code settings.json hooks format to our Hook format
          for (const [eventType, matchers] of Object.entries(settings.hooks)) {
            for (let i = 0; i < matchers.length; i++) {
              const matcher = matchers[i]
              const hookName = `${eventType}${matcher.matcher ? `-${matcher.matcher.replace(/[|*]/g, '_')}` : ''}-${i}`

              const actions = (matcher.hooks || []).map(h => ({
                type: 'execute' as const,
                command: h.command || h.prompt || '',
                timeout: h.timeout,
                continueOnError: false,
              }))

              const hookObj = {
                name: hookName,
                type: eventType as Hook['type'],
                enabled: true,
                description: `${eventType} hook${matcher.matcher ? ` for ${matcher.matcher}` : ''}`,
                pattern: matcher.matcher || '',
                actions,
                filePath: settingsPath,
                location,
                matcherIndex: i, // Track the index for editing/deleting
              }
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
    hookConfig: { matcher?: string; hooks: Array<{ type: string; command?: string; prompt?: string; timeout?: number }> },
    location: 'user' | 'project',
    projectPath?: string,
    matcherIndex?: number // If provided, update existing hook at this index; otherwise add new
  ): Promise<void> {
    const settingsPath = location === 'user'
      ? path.join(this.userConfigPath, 'settings.json')
      : path.join(projectPath || this.projectPath, '.claude', 'settings.json')

    this.logger.info('Saving hook to settings:', settingsPath, 'matcherIndex:', matcherIndex)

    // Read existing settings
    let settings: Record<string, unknown> = {}
    try {
      const content = await fs.readFile(settingsPath, 'utf-8')
      settings = JSON.parse(content)
    } catch {
      // File doesn't exist or is invalid, start with empty settings
    }

    // Initialize hooks object if it doesn't exist
    if (!settings.hooks) {
      settings.hooks = {}
    }

    const hooksObj = settings.hooks as Record<string, unknown[]>

    // Initialize this hook type array if it doesn't exist
    if (!hooksObj[hookType]) {
      hooksObj[hookType] = []
    }

    // Update existing or add new hook config
    if (matcherIndex !== undefined && matcherIndex >= 0 && matcherIndex < hooksObj[hookType].length) {
      // Update existing hook at the specified index
      hooksObj[hookType][matcherIndex] = hookConfig
      this.logger.info('Updated existing hook at index:', matcherIndex)
    } else {
      // Add new hook config
      hooksObj[hookType].push(hookConfig)
      this.logger.info('Added new hook config')
    }

    // Ensure directory exists
    const dir = path.dirname(settingsPath)
    await fs.mkdir(dir, { recursive: true })

    // Write back settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
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

    // Read existing settings
    let settings: Record<string, unknown> = {}
    try {
      const content = await fs.readFile(settingsPath, 'utf-8')
      settings = JSON.parse(content)
    } catch {
      this.logger.warn('Settings file not found:', settingsPath)
      return
    }

    const hooksObj = settings.hooks as Record<string, Array<{
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

    // Remove hooks object if empty
    if (Object.keys(hooksObj).length === 0) {
      delete settings.hooks
    }

    // Write back settings
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
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

  // MCP Servers
  async getMCPServers(): Promise<MCPServers> {
    this.logger.info('getMCPServers() called')

    // Try claude_mcp_config.json first (the actual file Claude uses)
    const userMCPPath = path.join(this.userConfigPath, 'claude_mcp_config.json')
    this.logger.info('Checking user MCP config at:', userMCPPath)
    const userMCP = await this.readJSONFile<{ mcpServers: MCPServers }>(userMCPPath)

    // Also check for mcpServers.json in project
    const projectMCPPath = path.join(this.projectPath, '.claude', 'mcpServers.json')
    this.logger.info('Checking project MCP config at:', projectMCPPath)
    const projectMCP = await this.readJSONFile<{ mcpServers: MCPServers }>(projectMCPPath)

    const servers = {
      ...(userMCP?.mcpServers || {}),
      ...(projectMCP?.mcpServers || {}),
    }

    this.logger.info('Found', Object.keys(servers).length, 'MCP servers')
    return servers
  }

  async saveMCPServers(servers: MCPServers, location: 'user' | 'project' = 'project'): Promise<void> {
    const filePath = location === 'project'
      ? path.join(this.projectPath, '.claude', 'mcpServers.json')
      : path.join(this.userConfigPath, 'mcpServers.json')

    await this.writeJSONFile(filePath, { mcpServers: servers })
  }

  // Commands
  async getCommands(): Promise<SlashCommand[]> {
    this.logger.info('getCommands() called')

    const commands: SlashCommand[] = []

    // Scan project commands
    const projectCommandsPath = path.join(this.projectPath, '.claude', 'commands')
    this.logger.info('Scanning project commands at:', projectCommandsPath)
    try {
      const projectDirs = await fs.readdir(projectCommandsPath)
      for (const dir of projectDirs) {
        const cmdDir = path.join(projectCommandsPath, dir)
        const stat = await fs.stat(cmdDir).catch(() => null)
        if (stat?.isDirectory()) {
          const mdPath = path.join(cmdDir, `${dir}.md`)
          try {
            const content = await fs.readFile(mdPath, 'utf-8')
            const command = this.parseCommandMarkdown(mdPath, content, 'project')
            if (command) {
              this.logger.info('Parsed project command:', command.name)
              commands.push(command)
            }
          } catch (error) {
            if (!isMissing(error)) {
              this.logger.error(`Error reading command file ${mdPath}:`, error)
            }
            // 命令目录里 .md 文件名与目录名不一致时，按缺失静默跳过（spec006 修正约定）
          }
        }
      }
    } catch (error) {
      this.logger.info('No project commands found:', error)
    }

    // Scan user commands
    const userCommandsPath = path.join(this.userConfigPath, 'commands')
    this.logger.info('Scanning user commands at:', userCommandsPath)
    try {
      const userDirs = await fs.readdir(userCommandsPath)
      for (const dir of userDirs) {
        const cmdDir = path.join(userCommandsPath, dir)
        const stat = await fs.stat(cmdDir).catch(() => null)
        if (stat?.isDirectory()) {
          const mdPath = path.join(cmdDir, `${dir}.md`)
          try {
            const content = await fs.readFile(mdPath, 'utf-8')
            const command = this.parseCommandMarkdown(mdPath, content, 'user')
            if (command) {
              this.logger.info('Parsed user command:', command.name)
              commands.push(command)
            }
          } catch (error) {
            if (!isMissing(error)) {
              this.logger.error(`Error reading command file ${mdPath}:`, error)
            }
            // 命令目录里 .md 文件名与目录名不一致时，按缺失静默跳过（spec006 修正约定）
          }
        }
      }
    } catch (error) {
      this.logger.info('No user commands found:', error)
    }

    this.logger.info('Returning', commands.length, 'commands')
    return commands
  }

  private parseCommandMarkdown(
    filePath: string,
    content: string,
    location: 'user' | 'project'
  ): SlashCommand | null {
    try {
      // Extract frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      const frontmatter: Record<string, string> = {}

      if (frontmatterMatch) {
        const frontmatterContent = frontmatterMatch[1]
        frontmatterContent.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split(':')
          if (key && valueParts.length > 0) {
            frontmatter[key.trim()] = valueParts.join(':').trim()
          }
        })
      }

      const commandName = path.basename(path.dirname(filePath))
      const description = frontmatter.description || 'No description'

      // Extract instructions (everything after frontmatter)
      // Also strip any additional frontmatter blocks that might exist
      let instructions = content
      const instructionsMatch = content.match(/^---[\s\S]*?---\n([\s\S]*)$/)
      if (instructionsMatch) {
        instructions = instructionsMatch[1].trim()
        // Check for and remove any additional frontmatter blocks
        const additionalFrontmatterMatch = instructions.match(/^---\s*\n[\s\S]*?\n---\s*\n?/)
        if (additionalFrontmatterMatch) {
          instructions = instructions.slice(additionalFrontmatterMatch[0].length).trim()
          this.logger.warn('Stripped additional frontmatter from instructions in:', filePath)
        }
      }

      return {
        name: commandName,
        description,
        usage: `/${commandName}`,
        type: 'plugin',
        pattern: `^/${commandName}`,
        handler: {
          type: 'inline',
          code: instructions
        },
        instructions,
        rawContent: content,
        scope: location === 'user' ? 'global' : 'project',
        enabled: true,
        filePath,
        location
      }
    } catch (error) {
      this.logger.error('Error parsing command markdown:', error)
      return null
    }
  }

  async getCommand(name: string): Promise<SlashCommand | null> {
    const commands = await this.getCommands()
    return commands.find((c) => c.name === name) || null
  }

  async saveCommand(command: SlashCommand): Promise<void> {
    // Validate command format
    const validationErrors: string[] = []

    // Validate name
    if (!command.name || !command.name.trim()) {
      validationErrors.push('Command name is required')
    } else {
      const name = command.name.trim()
      if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        validationErrors.push('Command name can only contain lowercase letters, numbers, and hyphens, and must start with a letter')
      }
      if (name.length > 50) {
        validationErrors.push('Command name cannot exceed 50 characters')
      }
    }

    // Validate description
    if (!command.description || !command.description.trim()) {
      validationErrors.push('Description is required')
    } else if (command.description.length > 200) {
      validationErrors.push('Description cannot exceed 200 characters')
    }

    // Validate instructions
    if (!command.instructions || !command.instructions.trim()) {
      validationErrors.push('Instructions content is required')
    }

    // If there are validation errors, throw an error
    if (validationErrors.length > 0) {
      const error = new Error('Command validation failed: ' + validationErrors.join('; '))
      this.logger.error('Command validation failed:', validationErrors)
      throw error
    }

    const location = command.location || 'project'

    // 确定基础目录
    // 如果是 project 并且提供了 filePath（包含项目路径），则使用它
    // 否则使用默认的 projectPath 或 userConfigPath
    let baseDir: string
    if (location === 'project') {
      if (command.filePath) {
        // filePath 可能是完整路径或只是项目根目录
        // 如果是项目根目录，需要添加 .claude/commands
        if (command.filePath.includes('/.claude/commands/')) {
          // 从完整路径提取项目根目录
          const match = command.filePath.match(/^(.+)\/\.claude\/commands\//)
          baseDir = match ? path.join(match[1], '.claude', 'commands') : path.join(this.projectPath, '.claude', 'commands')
        } else {
          // filePath 是项目根目录
          baseDir = path.join(command.filePath, '.claude', 'commands')
        }
      } else {
        baseDir = path.join(this.projectPath, '.claude', 'commands')
      }
    } else {
      baseDir = path.join(this.userConfigPath, 'commands')
    }

    // Command files are stored as: commands/<name>/<name>.md
    const commandDir = path.join(baseDir, command.name)
    const filePath = path.join(commandDir, `${command.name}.md`)

    // Ensure directory exists
    await fs.mkdir(commandDir, { recursive: true })

    // Build markdown content with frontmatter
    const frontmatter = [
      '---',
      `description: ${command.description || 'No description'}`,
    ]

    // Add allowed-tools if specified in handler
    if (command.handler?.allowedTools) {
      frontmatter.push(`allowed-tools: ${command.handler.allowedTools}`)
    }

    frontmatter.push('---')

    // Strip existing frontmatter from instructions if present
    let instructions = command.instructions || ''
    const frontmatterMatch = instructions.match(/^---\s*\n[\s\S]*?\n---\s*\n?/)
    if (frontmatterMatch) {
      instructions = instructions.slice(frontmatterMatch[0].length).trim()
      this.logger.info('Stripped existing frontmatter from instructions')
    }

    const content = frontmatter.join('\n') + '\n\n' + instructions

    await fs.writeFile(filePath, content, 'utf-8')
    this.logger.info('Saved command to:', filePath)
  }

  async saveCommandRaw(_name: string, content: string, filePath: string): Promise<void> {
    if (!filePath) {
      throw new Error('File path is required for saving raw command content')
    }

    // 确保目录存在
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    this.logger.info('Saving raw command content to:', filePath)
    await fs.writeFile(filePath, content, 'utf-8')
    this.logger.info('Saved raw command to:', filePath)
  }

  async deleteCommand(name: string): Promise<void> {
    const command = await this.getCommand(name)
    if (command?.filePath) {
      // 删除命令文件
      await fs.unlink(command.filePath)

      // 同时删除命令目录（如果目录为空）
      const commandDir = path.dirname(command.filePath)
      try {
        const files = await fs.readdir(commandDir)
        if (files.length === 0) {
          await fs.rmdir(commandDir)
          this.logger.info('Deleted empty command directory:', commandDir)
        }
      } catch (error) {
        // 目录可能不存在或无法删除，忽略错误
        this.logger.warn('Could not remove command directory:', error)
      }

      this.logger.info('Deleted command:', name)
    }
  }

  // CLAUDE.md
  async getClaudeMDFiles(): Promise<Array<{ content: string; location: 'user' | 'project' | 'global'; filePath: string; exists: boolean; projectName?: string }>> {
    this.logger.info('getClaudeMDFiles() called')
    const files = []

    // Global CLAUDE.md (in user config)
    const globalPath = path.join(this.userConfigPath, 'CLAUDE.md')
    this.logger.info('Checking global CLAUDE.md at:', globalPath)
    try {
      const content = await fs.readFile(globalPath, 'utf-8')
      this.logger.info('Global CLAUDE.md exists, length:', content.length)
      files.push({ content, location: 'global' as const, filePath: globalPath, exists: true })
    } catch (error) {
      this.logger.info('Global CLAUDE.md does not exist')
      files.push({ content: '', location: 'global' as const, filePath: globalPath, exists: false })
    }

    // Auto-discover all project CLAUDE.md files
    const projectClaudeMdFiles = await this.discoverProjectClaudeMDs()
    this.logger.info('Discovered', projectClaudeMdFiles.length, 'project CLAUDE.md files')
    files.push(...projectClaudeMdFiles)

    this.logger.info('Returning', files.length, 'CLAUDE.md files')
    return files
  }

  private async discoverProjectClaudeMDs(): Promise<Array<{ content: string; location: 'project'; filePath: string; exists: boolean; projectName: string }>> {
    const discovered = []
    const homeDir = os.homedir()

    this.logger.info('Auto-discovering CLAUDE.md files in development directories...')

    // Use timeout to prevent hanging
    const scanPromises = this.ALLOWED_SCAN_ROOTS.map(async (root) => {
      try {
        await fs.access(root)

        // Verify root is within allowed paths (security check)
        const resolvedRoot = await fs.realpath(root).catch(() => null)
        if (!resolvedRoot) {
          this.logger.warn(`Skipping invalid path: ${root}`)
          return []
        }

        // Check if path is still within home directory after resolving symlinks
        if (!resolvedRoot.startsWith(homeDir)) {
          this.logger.warn(`Security: Skipping path outside home directory: ${resolvedRoot}`)
          return []
        }

        const foundFiles = await this.scanForClaudeMD(resolvedRoot, this.MAX_SCAN_DEPTH)
        return foundFiles
      } catch (error) {
        // Directory doesn't exist or no permission, skip
        return []
      }
    })

    // Apply timeout to entire scan operation
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Scan timeout')), this.SCAN_TIMEOUT_MS)
    )

    try {
      const results = await Promise.race([
        Promise.all(scanPromises),
        timeoutPromise
      ])

      for (const files of results) {
        discovered.push(...files)
      }
    } catch (error) {
      this.logger.error('Scan timeout or error:', error)
    }

    // Remove duplicates based on filePath
    const uniqueFiles = new Map<string, typeof discovered[0]>()
    for (const file of discovered) {
      if (!uniqueFiles.has(file.filePath)) {
        uniqueFiles.set(file.filePath, file)
      }
    }

    this.logger.info(`Discovered ${uniqueFiles.size} unique CLAUDE.md files`)
    return Array.from(uniqueFiles.values())
  }

  private async scanForClaudeMD(
    dir: string,
    maxDepth: number,
    currentDepth = 0,
    scannedCount = { count: 0 }
  ): Promise<Array<{ content: string; location: 'project'; filePath: string; exists: boolean; projectName: string }>> {
    const results: Array<{ content: string; location: 'project'; filePath: string; exists: boolean; projectName: string }> = []

    // Stop if max depth exceeded
    if (currentDepth > maxDepth) {
      return results
    }

    // Stop if scanned too many directories (performance protection)
    if (scannedCount.count >= this.MAX_FILES_TO_SCAN) {
      this.logger.warn(`Reached max scan limit of ${this.MAX_FILES_TO_SCAN} files`)
      return results
    }

    try {
      scannedCount.count++

      // Security: Detect and skip symbolic links to prevent path traversal
      const dirStat = await fs.lstat(dir)
      if (dirStat.isSymbolicLink()) {
        this.logger.warn(`Skipping symbolic link for security: ${dir}`)
        return results
      }

      const entries = await fs.readdir(dir, { withFileTypes: true })

      // Check if CLAUDE.md exists in current directory
      const claudeMdPath = path.join(dir, 'CLAUDE.md')
      try {
        const content = await fs.readFile(claudeMdPath, 'utf-8')
        const projectName = path.basename(dir)
        this.logger.info(`Found CLAUDE.md in: ${dir}`)
        results.push({
          content,
          location: 'project' as const,
          filePath: claudeMdPath,
          exists: true,
          projectName
        })
      } catch {
        // No CLAUDE.md in this directory
      }

      // Recursively scan subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const entryName = entry.name

          // Skip directories that start with . or are in skip list
          if (entryName.startsWith('.') || this.SKIP_DIRECTORIES.has(entryName)) {
            continue
          }

          // Check for max files limit before recursing
          if (scannedCount.count >= this.MAX_FILES_TO_SCAN) {
            break
          }

          const subDir = path.join(dir, entryName)

          // Security: Check if subdirectory is a symbolic link
          try {
            const subDirStat = await fs.lstat(subDir)
            if (subDirStat.isSymbolicLink()) {
              this.logger.warn(`Skipping symbolic link: ${subDir}`)
              continue
            }
          } catch {
            continue // Skip if can't stat
          }

          const subResults = await this.scanForClaudeMD(subDir, maxDepth, currentDepth + 1, scannedCount)
          results.push(...subResults)
        }
      }
    } catch (error) {
      // Permission denied or other error, skip this directory
      this.logger.warn(`Error scanning directory ${dir}:`, error instanceof Error ? error.message : 'Unknown error')
    }

    return results
  }

  async getClaudeMD(): Promise<string> {
    const projectPath = path.join(this.projectPath, 'CLAUDE.md')
    const userPath = path.join(this.userConfigPath, 'CLAUDE.md')

    try {
      return await fs.readFile(projectPath, 'utf-8')
    } catch {
      try {
        return await fs.readFile(userPath, 'utf-8')
      } catch {
        return ''
      }
    }
  }

  async saveClaudeMD(content: string, location: 'user' | 'project' = 'project'): Promise<void> {
    const filePath = location === 'project'
      ? path.join(this.projectPath, 'CLAUDE.md')
      : path.join(this.userConfigPath, 'CLAUDE.md')

    await fs.writeFile(filePath, content, 'utf-8')
  }

  // Project Context
  async getProjectContext(): Promise<ProjectContext> {
    const getConfigFiles = async (
      dirName: string,
      type: ConfigFile['type']
    ): Promise<ConfigFile[]> => {
      const projectDir = path.join(this.projectPath, '.claude', dirName)
      const userDir = path.join(this.userConfigPath, dirName)

      const projectFiles = await this.scanDirectory(projectDir, '.json')
      const userFiles = await this.scanDirectory(userDir, '.json')

      const allFiles = [
        ...projectFiles.map((p) => ({ path: p, location: 'project' as const })),
        ...userFiles.map((p) => ({ path: p, location: 'user' as const })),
      ]

      const configFiles: ConfigFile[] = []
      for (const { path: filePath, location } of allFiles) {
        try {
          const stat = await fs.stat(filePath)
          configFiles.push({
            path: filePath,
            type,
            location,
            lastModified: stat.mtime.toISOString(),
            valid: true,
          })
        } catch {
          configFiles.push({
            path: filePath,
            type,
            location,
            lastModified: new Date().toISOString(),
            valid: false,
            errors: ['File not found or not accessible'],
          })
        }
      }

      return configFiles
    }

    return {
      projectPath: this.projectPath,
      userConfigPath: this.userConfigPath,
      skills: await getConfigFiles('skills', 'skill'),
      agents: await getConfigFiles('agents', 'agent'),
      hooks: await getConfigFiles('hooks', 'hook'),
      mcpServers: [],
      commands: await getConfigFiles('commands', 'command'),
    }
  }
}
