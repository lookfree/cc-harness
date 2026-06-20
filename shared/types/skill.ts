export interface SkillTrigger {
  commands?: string[]
  contexts?: string[]
  patterns?: string[]
}

export interface SkillMetadata {
  name: string
  author?: string
  version?: string
  tags?: string[]
  requires?: string[]
}

export interface SkillImplementation {
  type: 'hook' | 'agent' | 'command' | 'inline'
  handler?: string
  instructions?: string
  code?: string
}

export interface SkillReference {
  type: 'file' | 'package' | 'api' | 'tool'
  path: string
  description?: string
}

export interface SkillScript {
  name: string
  command: string
  description?: string
  content?: string // Script file content
}

export interface Skill {
  name: string
  type: 'skill'
  description: string
  enabled?: boolean
  triggers?: SkillTrigger
  implementation: SkillImplementation
  metadata?: SkillMetadata
  references?: SkillReference[]
  scripts?: SkillScript[]
  dependencies?: string[]
  filePath?: string // Actual file path on disk
  location?: 'user' | 'project' // Where the skill is defined（保留兼容旧 UI）
  content?: string // Full markdown content for trigger analysis
  // 三层来源元数据（spec003 起；plugin 来源时 marketplace/pluginName/version/pluginScope 有值）
  source?: SkillSource
  marketplace?: string
  pluginName?: string
  version?: string // plugin 版本（非 skill 自身 metadata.version）
  pluginScope?: 'user' | 'project'
  overriddenBy?: string // spec004 覆盖检测填：被哪个 skill uid 覆盖
}

export type SkillSource = 'user' | 'project' | 'plugin'

/** skill 稳定唯一标识：source==='plugin' 时含 marketplace/plugin/version，否则 source:name */
export type SkillUid = string

/** installed_plugins.json（schema v2）解析后的单条安装记录。spec003 引入，spec004/005/006 共用。 */
export interface InstalledPluginEntry {
  pluginName: string // 'superpowers'
  marketplace: string // 'claude-plugins-official'
  scope: 'user' | 'project'
  version: string // '6.0.3'
  installPath: string // 绝对路径，指向版本目录
}

export interface SkillStats {
  totalLines: number
  totalReferences: number
  totalScripts: number
  totalTriggers: number
  lastModified?: string
}
