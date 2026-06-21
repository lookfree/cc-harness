export * from './skill'
export * from './agent'
export * from './hook'
export * from './mcp'
export * from './command'
export * from './claudemd'
export * from './provider'
export * from './plugin'
export * from './permission'
export * from './settings'

export interface ConfigFile {
  path: string
  type: 'skill' | 'agent' | 'hook' | 'mcp' | 'command' | 'claudemd'
  location: 'user' | 'project'
  lastModified: string
  valid: boolean
  errors?: string[]
}

export interface DependencyNode {
  id: string
  type: 'skill' | 'agent' | 'hook' | 'mcp' | 'command'
  name: string
  data: unknown
}

export interface DependencyEdge {
  id: string
  source: string
  target: string
  type: 'depends-on' | 'calls' | 'triggers' | 'uses'
  label?: string
}

export interface ProjectContext {
  projectPath: string
  userConfigPath: string
  skills: ConfigFile[]
  agents: ConfigFile[]
  hooks: ConfigFile[]
  mcpServers: ConfigFile[]
  commands: ConfigFile[]
  claudeMD?: ConfigFile
}
