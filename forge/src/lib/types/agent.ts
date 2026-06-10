export type AgentTriggerType = 'manual' | 'automatic' | 'scheduled'

export type AgentEvent =
  | 'on-session-start'
  | 'on-feature-complete'
  | 'on-refactor'
  | 'on-dependency-update'
  | 'on-commit'
  | 'on-error'

export interface AgentTrigger {
  type: AgentTriggerType
  events?: AgentEvent[]
  schedule?: string // cron expression
  conditions?: Record<string, unknown>
}

export interface AgentCapabilities {
  canModifyFiles: boolean
  canRunCommands: boolean
  canCommit: boolean
  scope: 'global' | 'project'
  allowedTools?: string[]
}

export interface Agent {
  name: string
  type: 'subagent'
  description: string
  enabled: boolean
  trigger: AgentTrigger
  instructions: string
  capabilities: AgentCapabilities
  interruptible?: boolean
  maxRuntime?: number // milliseconds
  dependencies?: string[]
  filePath?: string
  location?: 'user' | 'project'
}

export interface AgentExecution {
  id: string
  agentName: string
  startTime: string
  endTime?: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  logs: AgentLog[]
  performance?: {
    duration: number
    tokensUsed?: number
    filesModified?: number
    commandsRun?: number
  }
}

export interface AgentLog {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}
