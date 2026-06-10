export type HookType =
  | 'PreToolUse'      // Before a tool is invoked
  | 'PostToolUse'     // After a tool has completed
  | 'Notification'    // When a notification is displayed
  | 'UserPromptSubmit' // After the user submits their prompt
  | 'Stop'            // Right before Claude concludes its response
  | 'SubagentStart'   // When a subagent (Task tool call) is started
  | 'SubagentStop'    // Right before a subagent concludes its response
  | 'PreCompact'      // Before conversation compaction
  | 'SessionStart'    // When Claude Code starts a new session
  | 'SessionEnd'      // When a session is ending
  // Legacy types (for backwards compatibility)
  | 'pre-tool'
  | 'post-tool'
  | 'pre-command'
  | 'post-command'
  | 'pre-commit'
  | 'post-commit'

export type HookActionType =
  | 'validate'
  | 'transform'
  | 'notify'
  | 'block'
  | 'execute'

export interface HookConditions {
  commands?: string[]
  branches?: string[]
  filePatterns?: string[]
  tools?: string[]
  customCondition?: string // JS expression
}

export interface HookAction {
  type: HookActionType
  handler?: string
  command?: string
  timeout?: number
  continueOnError?: boolean
}

export interface Hook {
  name: string
  type: HookType
  enabled: boolean
  description: string
  pattern?: string // Glob pattern for matching
  conditions?: HookConditions
  actions: HookAction[]
  stopOnError?: boolean
  priority?: number // Lower number = higher priority
  filePath?: string
  location?: 'user' | 'project'
  matcherIndex?: number // Index in the settings.json hooks array for this type
}

export interface HookExecution {
  id: string
  hookName: string
  trigger: string
  startTime: string
  endTime?: string
  status: 'running' | 'passed' | 'failed' | 'blocked'
  actions: HookActionExecution[]
}

export interface HookActionExecution {
  action: HookAction
  status: 'pending' | 'running' | 'passed' | 'failed'
  output?: string
  error?: string
  duration?: number
}

// Hook execution log entry for debugging
export interface HookExecutionLog {
  id: string
  hookName: string
  hookType: HookType
  trigger: string
  timestamp: string
  duration: number
  status: 'success' | 'failed' | 'timeout' | 'blocked'
  command: string
  output?: string
  error?: string
  exitCode?: number
  location: 'user' | 'project'
  filePath?: string
}
