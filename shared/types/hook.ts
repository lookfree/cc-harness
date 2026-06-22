export type HookType =
  | 'PreToolUse'      // Before a tool is invoked
  | 'PostToolUse'     // After a tool has completed
  | 'MessageDisplay'  // 2.1.152 输出显示前转换/隐藏
  | 'Notification'    // When a notification is displayed
  | 'UserPromptSubmit' // After the user submits their prompt
  | 'Stop'            // Right before Claude concludes its response
  | 'StopFailure'     // 2.1.78 Stop 失败
  | 'SubagentStart'   // When a subagent (Task tool call) is started
  | 'SubagentStop'    // Right before a subagent concludes its response
  | 'PreCompact'      // Before conversation compaction
  | 'PostCompact'     // 2.1.76 压缩之后
  | 'SessionStart'    // When Claude Code starts a new session
  | 'SessionEnd'      // When a session is ending
  | 'ConfigChange'    // 2.1.49 配置变更审计
  | 'Elicitation'     // 2.1.76 交互征询
  | 'ElicitationResult' // 2.1.76 征询结果
  | 'PermissionRequest' // 2.0.45 权限请求自动化
  | 'PostSession'     // 2.1.169 post-session 生命周期
  // Legacy types (for backwards compatibility)
  | 'pre-tool'
  | 'post-tool'
  | 'pre-command'
  | 'post-command'
  | 'pre-commit'
  | 'post-commit'

/** 与 Claude Code settings.json 的 hooks[].hooks[].type 对齐 */
export type HookActionType = 'command' | 'http' | 'prompt'
/** 兼容旧抽象动词（迁移期保留，读取时映射到 command/http/prompt） */
export type LegacyHookActionType = 'validate' | 'transform' | 'notify' | 'block' | 'execute'

export interface HookConditions {
  commands?: string[]
  branches?: string[]
  filePatterns?: string[]
  tools?: string[]
  customCondition?: string // JS expression
}

export interface HookAction {
  type: HookActionType | LegacyHookActionType
  handler?: string
  // ---- command (exec) form ----
  command?: string
  /** exec form：直接传 argv 数组，不经 shell（2.1.134-143） */
  args?: string[]
  // ---- prompt form ----
  prompt?: string
  // ---- http form (type:'http', 2.1.63) ----
  url?: string
  method?: 'POST' | 'GET' | 'PUT'
  headers?: Record<string, string>
  /** http body 模板，支持 ${...} 占位；省略则发完整 hook input JSON */
  body?: string
  timeout?: number
  continueOnError?: boolean
  /** 被 block 后是否继续后续 hook（2.1.134-143） */
  continueOnBlock?: boolean
  /** 触发后向终端写入的转义序列（2.1.134-143） */
  terminalSequence?: string
}

/** SessionStart 专属配置（2.1.152） */
export interface SessionStartHookConfig {
  /** 启动时重新加载 skills */
  reloadSkills?: boolean
  /** 预设会话标题 */
  sessionTitle?: string
}

/** 部分 hook 事件可携带 effort 级别透传（2.1.133，只读展示） */
export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

/**
 * settings.json 中单个 matcher 级配置（前端→后端写入契约）。
 * hooks 用 domain HookAction[]，由 FileManager.hookActionToSettings 负责按 type 序列化。
 */
export interface HookSettingsMatcher {
  matcher?: string
  hooks: HookAction[]
  reloadSkills?: boolean      // SessionStart
  sessionTitle?: string       // SessionStart
  replaceToolOutput?: boolean // PostToolUse
  maxBlocks?: number          // Stop / StopFailure
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
  /** SessionStart 专属（reloadSkills / sessionTitle） */
  sessionStart?: SessionStartHookConfig
  /** hook 拿到的 effort 透传（只读展示；2.1.133） */
  effort?: EffortLevel
  /** PostToolUse：是否替换工具输出让 Claude 看到处理过的版本（2.1.121） */
  replaceToolOutput?: boolean
  /** Stop hook 阻断计数上限（2.1.143，默认 8） */
  maxBlocks?: number
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

/** dry-run 时构造的模拟 hook 输入（按 HookType 不同字段不同）。 */
export interface HookSimInput {
  hookType: HookType
  sessionId?: string
  cwd?: string
  /** PreToolUse/PostToolUse */
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: unknown
  /** UserPromptSubmit */
  prompt?: string
  /** MessageDisplay */
  message?: string
  /** 超时（ms），最大 30000 */
  timeoutMs?: number
  /** http hook 才放行；command 类默认不出网 */
  allowNetwork?: boolean
  /** 高级模式：直接补充任意字段 */
  extra?: Record<string, unknown>
}

/** dry-run 执行结果。 */
export interface HookDryRunResult {
  hookName: string
  hookType: HookType
  actionType: HookActionType
  exitCode: number | null
  stdout: string
  stderr: string
  /** 解析 hook 输出/退出码后的语义决策 */
  decision: 'allow' | 'block' | 'transform' | 'none'
  blockReason?: string
  /** transform：替换/注入内容 */
  transformedOutput?: unknown
  durationMs: number
  timedOut: boolean
  /** http hook */
  httpStatus?: number
  httpResponseBody?: string
  /** 执行或网络错误消息 */
  error?: string
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
