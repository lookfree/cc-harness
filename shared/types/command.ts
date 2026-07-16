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
  /** frontmatter argument-hint（如 "[pr-number] [focus?]"） */
  argumentHint?: string
  /** 正文引用了 $ARGUMENTS / $1..$9（2.1.210 起未匹配的占位符原样保留，不再静默剥离） */
  usesArguments?: boolean
  aliases?: string[]
  scope: CommandScope
  enabled: boolean
  filePath?: string
  /** @deprecated 用 source。plugin→'user' 兼容映射（spec006） */
  location?: 'user' | 'project'
  source?: CommandSource
  marketplace?: string // 仅 plugin
  pluginName?: string // 仅 plugin
  version?: string // 仅 plugin
  pluginScope?: 'user' | 'project' // 仅 plugin
  /** 被同名更高优先级来源覆盖时，记覆盖者 uid（spec006） */
  overriddenBy?: string
  /** 实际调用名：plugin 命令为 `${pluginName}:${name}`，否则 = name */
  invokeName?: string
  /** disallowed-tools frontmatter，由 spec008 正式解析，这里先占类型位 */
  disallowedTools?: string[]
}

export type CommandSource = 'user' | 'project' | 'plugin'

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
