/** 规范化后的 session 事件基类（隔离上游字段漂移，下游只认这层） */
export interface SessionEventBase {
  /** 行内 uuid（assistant/user 行有；mode/system 等元事件可能无，则用 `${seq}` 兜底） */
  uuid: string
  /** 父事件 uuid，构对话链/sidechain 链用；null = 根 */
  parentUuid: string | null
  sessionId?: string
  /** ISO 时间戳；部分元事件无 */
  timestamp?: string
  cwd?: string
  /** Claude Code 版本，如 '2.1.152' */
  version?: string
  /** 是否 subagent sidechain（来自 isSidechain） */
  isSidechain?: boolean
  /** sidechain agent 标识（仅 subagents/*.jsonl 有） */
  agentId?: string
  /** 非空记录序号（解析时单调递增，作稳定排序键；注意是「非空行计数」而非物理文件行号——空行不占号） */
  seq: number
}

export interface UserTurnEvent extends SessionEventBase {
  kind: 'user_turn'
  /** 纯文本 prompt（从 message.content 抽文本块拼接） */
  text: string
  entrypoint?: string
  gitBranch?: string
}

export interface AssistantTurnEvent extends SessionEventBase {
  kind: 'assistant_turn'
  /** 纯透传，实测如 'claude-opus-4-8[1m]'（可能带 [1m] 等后缀） */
  model?: string
  /** 文本块拼接 */
  text: string
  /** thinking 块是否存在（内容常被签名遮蔽，只标存在 + 长度） */
  hasThinking: boolean
  thinkingChars: number
  stopReason?: string
  usage?: TokenUsage
}

export interface ToolUseEvent extends SessionEventBase {
  kind: 'tool_use'
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  /** Task 工具时抽出的 subagent 类型（input.subagent_type），供 spec016 */
  subagentType?: string
  /** 所属 assistant 行 uuid（同一 assistant message 可含多个 tool_use 块） */
  parentTurnUuid: string
}

export interface ToolResultEvent extends SessionEventBase {
  kind: 'tool_result'
  toolUseId: string
  isError: boolean
  /** content 文本化（截断到 maxResultChars） */
  contentText: string
  /** 顶层 toolUseResult 结构化结果原样保留 */
  structured?: unknown
}

export interface SystemEvent extends SessionEventBase {
  kind: 'system'
  subtype?: string
  level?: string
  content?: string
}

/** mode / permission-mode / ai-title / last-prompt / queue-operation / file-history-snapshot / attachment / 未知 */
export interface MetaEvent extends SessionEventBase {
  kind: 'meta'
  metaType: string
  raw?: Record<string, unknown>
}

export type SessionEvent =
  | UserTurnEvent | AssistantTurnEvent | ToolUseEvent
  | ToolResultEvent | SystemEvent | MetaEvent

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  serviceTier?: string
  /** server_tool_use（web_search/web_fetch 计数），原样保留 */
  serverToolUse?: Record<string, number>
}

export interface SessionFileMeta {
  encodedCwd: string
  /** decodeCwd 占位，UI 显示后用行内 cwd 校正 */
  cwd: string
  sessionId: string
  filePath: string
  sizeBytes: number
  /** 排序：最近活跃在前 */
  mtimeMs: number
  /** 是否含 subagents/ 子目录（spec016 用） */
  hasSubagents: boolean
}

/**
 * token 用量小计（spec015 列表展示用，spec017 token 面板会扩展更细粒度）。
 * total = input + output + cacheCreation + cacheRead（含缓存命中，便于看真实上下文规模）。
 */
export interface TokenUsageRollup {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  /** 全部相加，UI 小计直接用 */
  totalTokens: number
}

/** 主→渲染推流 payload（session:events channel，spec015）。 */
export interface SessionEventsPush {
  sessionId: string
  events: SessionEvent[]
  /** 首屏全量批（订阅瞬间）为 true，后续增量为 false */
  initial: boolean
  /** 文件被截断/轮转重置 */
  truncated?: boolean
}

/** 会话实时状态（启发式推断，非 CLI 权威——见 spec015 风险节）。 */
export type SessionLiveStatus = 'active' | 'idle' | 'waiting' | 'completed' | 'unknown'

/** 一个 session 的概要（左栏列表项 + 状态推断结果）。 */
export interface SessionSummary {
  sessionId: string
  cwd: string
  filePath: string
  /** 来自 ai-title 元事件（最后一条）；无则前端回落 cwd 短名 */
  title?: string
  lastModelUsed?: string
  status: SessionLiveStatus
  /** 推断的"在等什么"：最后一条若是无匹配 tool_result 的 tool_use → 工具名 */
  waitingFor?: string
  turnCount: number
  toolUseCount: number
  totalTokens: TokenUsageRollup
  startedAt?: string
  /** = 最后事件 timestamp 或文件 mtime（ISO） */
  lastActivityAt: string
  hasSubagents: boolean
  /** ORCH-05 pinned——本地无稳定契约，暂留空不展示（见 spec015 风险节） */
  pinned?: boolean
}
