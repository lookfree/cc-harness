import fs from 'fs/promises'
import path from 'path'
import type { InstalledPluginEntry, Marketplace, MarketplaceSource, Plugin, PluginVersion, PluginManifest, PluginComponentCount } from '../../shared/types'
import { globScan, isMissing } from './glob-scan'
import { FileManagerBase } from './file-manager-base'

export class FileManagerPlugins extends FileManagerBase {
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
}
