import type {
  SessionEvent,
  SessionSummary,
  SessionLiveStatus,
  TokenUsageRollup,
} from './types/session'

/** 把 mtime 之于"现在"的新鲜窗口：此窗口内有写入即认为会话仍 active。 */
const RECENT_MS = 30_000

/** summarizeEvents 的输入元信息（纯数据，不含 fs/electron 依赖，故前后端共用）。 */
export interface SummaryMeta {
  sessionId: string
  filePath: string
  /** 文件名/编码反推的 cwd 占位，会被行内 cwd 覆盖 */
  cwd: string
  hasSubagents: boolean
  /** 文件 mtime（ms）；前端 live 更新时传 Date.now() */
  mtimeMs: number
  /** "现在"（ms）；显式传入避免 shared 层用 Date.now()，也便于测试 */
  nowMs: number
}

const emptyRollup = (): TokenUsageRollup => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalTokens: 0,
})

/** 视为"对话推进"的事件（meta/system 是噪声，不参与状态判定）。 */
const SIGNIFICANT = new Set<SessionEvent['kind']>(['user_turn', 'assistant_turn', 'tool_use', 'tool_result'])

/**
 * 从全量事件推断会话概要 + 实时状态（启发式，非 CLI 权威）。
 * 前后端共用：后端 list() 读文件后调用；前端 store 收到 push 增量后用累积事件重算 live 状态。
 */
export function summarizeEvents(events: SessionEvent[], meta: SummaryMeta): SessionSummary {
  let title: string | undefined
  let lastModelUsed: string | undefined
  let permissionMode: string | undefined
  let startedAt: string | undefined
  let lastTs: string | undefined
  let inlineCwd: string | undefined
  let turnCount = 0
  let toolUseCount = 0
  const roll = emptyRollup()
  const resultIds = new Set<string>()

  for (const e of events) {
    if (e.cwd && !inlineCwd) inlineCwd = e.cwd
    if (e.timestamp) {
      if (!startedAt) startedAt = e.timestamp
      lastTs = e.timestamp
    }
    switch (e.kind) {
      case 'user_turn':
        turnCount++
        break
      case 'assistant_turn':
        turnCount++
        if (e.model) lastModelUsed = e.model
        if (e.usage) {
          roll.inputTokens += e.usage.inputTokens
          roll.outputTokens += e.usage.outputTokens
          roll.cacheCreationInputTokens += e.usage.cacheCreationInputTokens
          roll.cacheReadInputTokens += e.usage.cacheReadInputTokens
        }
        break
      case 'tool_use':
        toolUseCount++
        break
      case 'tool_result':
        resultIds.add(e.toolUseId)
        break
      case 'meta':
        // ai-title 事件的标题在 raw.aiTitle（spec014 把未知 type 收进 meta.raw）
        if (e.metaType === 'ai-title' && e.raw && typeof e.raw.aiTitle === 'string') title = e.raw.aiTitle
        // permission-mode 事件（PERM-08）：取最后一条为会话当前权限模式
        if (e.metaType === 'permission-mode' && e.raw && typeof e.raw.permissionMode === 'string') {
          permissionMode = e.raw.permissionMode
        }
        break
    }
  }
  roll.totalTokens =
    roll.inputTokens + roll.outputTokens + roll.cacheCreationInputTokens + roll.cacheReadInputTokens

  const { status, waitingFor } = inferStatus(events, meta, resultIds)

  return {
    sessionId: meta.sessionId,
    cwd: inlineCwd ?? meta.cwd,
    filePath: meta.filePath,
    title,
    lastModelUsed,
    status,
    waitingFor,
    turnCount,
    toolUseCount,
    totalTokens: roll,
    startedAt,
    lastActivityAt: lastTs ?? new Date(meta.mtimeMs).toISOString(),
    hasSubagents: meta.hasSubagents,
    permissionMode,
  }
}

/** 状态推断规则（诚实标注：启发式）。 */
function inferStatus(
  events: SessionEvent[],
  meta: SummaryMeta,
  resultIds: Set<string>
): { status: SessionLiveStatus; waitingFor?: string } {
  if (events.length === 0) return { status: 'unknown' }
  const ageMs = meta.nowMs - meta.mtimeMs
  const recent = ageMs >= 0 && ageMs < RECENT_MS

  // 最后一条"有意义"事件（跳过 meta/system 噪声）
  let sig: SessionEvent | undefined
  for (let i = events.length - 1; i >= 0; i--) {
    if (SIGNIFICANT.has(events[i].kind)) {
      sig = events[i]
      break
    }
  }

  if (sig?.kind === 'tool_use' && !resultIds.has(sig.toolUseId)) {
    // 末尾是未拿到结果的 tool_use → 在等这个工具（如等 Bash 权限）
    return { status: 'waiting', waitingFor: sig.toolName || undefined }
  }
  if (sig?.kind === 'user_turn') {
    // 人刚说完：近期 → 模型在干活(active)，久了没动静 → 卡在等模型
    return recent ? { status: 'active' } : { status: 'waiting' }
  }
  if (recent) return { status: 'active' }
  return { status: 'idle' }
}
