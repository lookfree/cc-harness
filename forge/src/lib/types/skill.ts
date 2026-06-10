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
  location?: 'user' | 'project' // Where the skill is defined
  content?: string // Full markdown content for trigger analysis
}

export interface SkillStats {
  totalLines: number
  totalReferences: number
  totalScripts: number
  totalTriggers: number
  lastModified?: string
}
