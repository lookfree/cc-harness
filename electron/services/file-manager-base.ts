import fs from 'fs/promises'
import path from 'path'
import { watch, FSWatcher } from 'chokidar'
import os from 'os'
import type { InstalledPluginEntry, ProjectContext, ConfigFile } from '../../shared/types'
import { isMissing } from './glob-scan'

export abstract class FileManagerBase {
  protected projectPath: string = process.cwd()
  protected userConfigPath: string = path.join(os.homedir(), '.claude')
  protected watcher: FSWatcher | null = null
  protected changeCallbacks: Array<(files: ConfigFile[]) => void> = []

  // Logger with levels - wrapped to handle EPIPE errors gracefully
  protected logger = {
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

  protected setupFileWatcher() {
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

  protected notifyFileChanges(context: ProjectContext) {
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

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  protected async readJSONFile<T>(filePath: string): Promise<T | null> {
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

  protected async writeJSONFile(filePath: string, data: unknown): Promise<void> {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  protected async scanDirectory(dirPath: string, extension: string): Promise<string[]> {
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
  protected async readInstalledPlugins(): Promise<InstalledPluginEntry[]> {
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
  protected async readEnabledPlugins(): Promise<Record<string, unknown>> {
    const data = await this.readJSONFile<{ enabledPlugins?: Record<string, unknown> }>(
      path.join(this.userConfigPath, 'settings.json')
    )
    return data?.enabledPlugins ?? {}
  }

  /** version 字符串转可比较 key（与 markSkillOverrides 同口径）。 */
  protected semverKey(v?: string): string {
    return (v ?? '0').split('.').map((n) => String(parseInt(n, 10) || 0).padStart(6, '0')).join('.')
  }

  /**
   * 通用同名覆盖检测：优先级 user > project > plugin；同为 plugin 时 user-scope > project-scope，再版本号高者。
   * winner 正常显示，其余标 overriddenBy=winner 的 uid（不丢，供 UI 灰显）。skills/commands 共用（spec004/006）。
   */
  protected markOverrides<
    T extends { name: string; source?: string; pluginScope?: 'user' | 'project'; version?: string; overriddenBy?: string }
  >(items: T[], computeUid: (t: T) => string): void {
    const rankTuple = (s: T): [number, number, string] => [
      s.source === 'user' ? 3 : s.source === 'project' ? 2 : 1,
      s.pluginScope === 'user' ? 1 : 0,
      this.semverKey(s.version),
    ]
    const gt = (a: T, b: T): boolean => {
      const ta = rankTuple(a), tb = rankTuple(b)
      for (let i = 0; i < 3; i++) if (ta[i] !== tb[i]) return ta[i] > tb[i]
      return false
    }
    const byName = new Map<string, T[]>()
    for (const s of items) {
      const g = byName.get(s.name)
      if (g) g.push(s)
      else byName.set(s.name, [s])
    }
    for (const group of byName.values()) {
      if (group.length < 2) continue
      const winner = group.reduce((a, b) => (gt(b, a) ? b : a))
      const winnerUid = computeUid(winner)
      for (const s of group) if (s !== winner) s.overriddenBy = winnerUid
    }
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
