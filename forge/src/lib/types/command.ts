export type CommandType = 'skill' | 'agent' | 'plugin' | 'hook' | 'builtin'
export type CommandScope = 'global' | 'project'

export interface CommandArgument {
  name: string
  type: 'string' | 'number' | 'boolean' | 'array'
  required: boolean
  description?: string
  default?: unknown
}

export interface CommandHandler {
  type: 'inline' | 'external' | 'skill' | 'agent'
  code?: string // JavaScript/TypeScript code for inline handlers
  path?: string // Path to external handler
  skillName?: string
  agentName?: string
  allowedTools?: string // Comma-separated list of allowed tools
}

export interface SlashCommand {
  name: string
  description: string
  usage: string
  type: CommandType
  pattern: string
  arguments?: CommandArgument[]
  handler: CommandHandler
  instructions?: string // Instructions for Claude
  rawContent?: string // Raw markdown file content
  aliases?: string[]
  scope: CommandScope
  enabled: boolean
  filePath?: string
  location?: 'user' | 'project'
}

export interface CommandExecution {
  id: string
  commandName: string
  input: string
  args: Record<string, unknown>
  startTime: string
  endTime?: string
  status: 'running' | 'completed' | 'failed'
  output?: string
  error?: string
  duration?: number
}
