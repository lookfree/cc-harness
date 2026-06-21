export interface MarketplaceSource {
  source: 'github' | 'git' | 'local' | string
  repo?: string
  url?: string
}

export interface Marketplace {
  name: string // 'claude-plugins-official'
  source: MarketplaceSource
  installLocation?: string
  lastUpdated?: string
}

export interface PluginManifest {
  name: string
  description?: string
  version?: string
  author?: { name?: string; email?: string } | string
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
}

export interface PluginComponentCount {
  skills: number
  commands: number
  agents: number
  hooks: number
}

export interface PluginVersion {
  version: string
  scope: 'user' | 'project'
  projectPath?: string
  installPath: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
  enabled: boolean // 该 plugin 在 enabledPlugins 是否为 true（plugin 级，非版本级）
  isCurrent: boolean // 是否当前生效版本（见 pickCurrent）
  manifest?: PluginManifest
  components?: PluginComponentCount
}

export interface Plugin {
  key: string // '<plugin>@<marketplace>'
  name: string // 'superpowers'
  marketplace: string // 'claude-plugins-official'
  enabled: boolean // enabledPlugins[key] === true
  versions: PluginVersion[] // 已装的所有版本（多 scope/多版本）
  currentVersion?: string // isCurrent 那条的 version
}

export interface PluginCliResult {
  ok: boolean
  cliAvailable: boolean // claude CLI 是否在 PATH
  stdout?: string
  stderr?: string
  message: string
}
