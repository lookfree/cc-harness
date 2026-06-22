import type {
  SessionEvent,
  ToolUseEvent,
  TokenUsage,
  TokenUsageRollup,
  UsageBreakdown,
  UsageBucket,
  AgentTopology,
} from '../../../shared/types'
import { estimateCostByModel, estimateCostUsd } from '../../../shared/data/model-pricing'

const BUCKETS: UsageBucket[] = ['base', 'skills', 'subagents', 'mcp', 'plugins']

const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
})

const emptyRollup = (): TokenUsageRollup => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  totalTokens: 0,
  byModel: {},
})

function addUsage(roll: TokenUsageRollup, u: TokenUsage, model: string): void {
  roll.inputTokens += u.inputTokens
  roll.outputTokens += u.outputTokens
  roll.cacheCreationInputTokens += u.cacheCreationInputTokens
  roll.cacheReadInputTokens += u.cacheReadInputTokens
  roll.totalTokens =
    roll.inputTokens + roll.outputTokens + roll.cacheCreationInputTokens + roll.cacheReadInputTokens
  if (model) {
    const m = (roll.byModel ??= {})[model] ?? emptyUsage()
    m.inputTokens += u.inputTokens
    m.outputTokens += u.outputTokens
    m.cacheCreationInputTokens += u.cacheCreationInputTokens
    m.cacheReadInputTokens += u.cacheReadInputTokens
    roll.byModel[model] = m
  }
}

function seriesPoint(ts: string, bucket: UsageBucket, model: string, u: TokenUsage): UsageBreakdown['series'][number] {
  return {
    ts,
    bucket,
    model,
    output: u.outputTokens,
    inputBillable: u.inputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens,
    costUsd: estimateCostUsd(u, model) ?? 0,
  }
}

/** 把一个 assistant turn 按其 tool_use 归类（启发式，见 spec017）。plugins 需外部 tool 名单。 */
function classifyTurn(tools: ToolUseEvent[], pluginToolNames?: Set<string>): UsageBucket {
  if (pluginToolNames && tools.some((t) => pluginToolNames.has(t.toolName))) return 'plugins'
  if (tools.some((t) => t.toolName === 'Skill')) return 'skills'
  // 前缀判定即可分桶；别用 mcp__(\w+)__（\w 不含连字符，漏 mcp__claude-in-chrome__…）
  if (tools.some((t) => t.toolName.startsWith('mcp__'))) return 'mcp'
  return 'base'
}

/**
 * 自算 token 分项归因（/usage 官方明细无本地契约，见 spec017 风险节——UI 须标注"估算"）。
 * - 主会话 assistant turn：按其 tool_use 归 base/skills/mcp/plugins。
 * - subagents bucket：取 topology 各 agent 的 token 汇总（归到其 workflow 的 defaultModel）。
 * total = 全部 bucket 之和：无 subagent 的会话即等于主 jsonl 的 usage 累加。
 */
export function computeUsageBreakdown(
  events: SessionEvent[],
  topology?: AgentTopology,
  pluginToolNames?: Set<string>
): UsageBreakdown {
  const byBucket = Object.fromEntries(BUCKETS.map((b) => [b, emptyRollup()])) as Record<UsageBucket, TokenUsageRollup>
  const total = emptyRollup()
  const series: UsageBreakdown['series'] = []
  const toolCounts: Record<string, number> = {}
  let thinkingChars = 0
  let turnCount = 0

  // assistant turn uuid → 它发起的 tool_use 们
  const toolsByTurn = new Map<string, ToolUseEvent[]>()
  for (const e of events) {
    if (e.kind === 'tool_use') {
      const arr = toolsByTurn.get(e.parentTurnUuid) ?? []
      arr.push(e)
      toolsByTurn.set(e.parentTurnUuid, arr)
      toolCounts[e.toolName] = (toolCounts[e.toolName] ?? 0) + 1
    }
  }

  for (const e of events) {
    if (e.kind !== 'assistant_turn') continue
    turnCount++
    thinkingChars += e.thinkingChars
    if (!e.usage) continue
    const tools = toolsByTurn.get(e.uuid) ?? []
    const bucket: UsageBucket = e.isSidechain ? 'subagents' : classifyTurn(tools, pluginToolNames)
    const model = e.model ?? ''
    addUsage(byBucket[bucket], e.usage, model)
    addUsage(total, e.usage, model)
    series.push(seriesPoint(e.timestamp ?? '', bucket, model, e.usage))
  }

  // subagents：从拓扑取每个 agent 的 token（归到 workflow 的 defaultModel）
  if (topology) {
    const wfModel = new Map(topology.workflows.map((w) => [w.runId, w.defaultModel ?? '']))
    for (const a of topology.agents) {
      if (!a.tokens) continue
      const model = (a.workflowRunId ? wfModel.get(a.workflowRunId) : '') || ''
      const u: TokenUsage = {
        inputTokens: a.tokens.inputTokens,
        outputTokens: a.tokens.outputTokens,
        cacheCreationInputTokens: a.tokens.cacheCreationInputTokens,
        cacheReadInputTokens: a.tokens.cacheReadInputTokens,
      }
      addUsage(byBucket.subagents, u, model)
      addUsage(total, u, model)
      if (a.startedAt) series.push(seriesPoint(a.startedAt, 'subagents', model, u))
    }
  }

  // 成本估算（逐 bucket + 总）
  for (const b of BUCKETS) byBucket[b].estimatedCostUsd = estimateCostByModel(byBucket[b].byModel ?? {})
  total.estimatedCostUsd = estimateCostByModel(total.byModel ?? {})

  series.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))

  return { byBucket, series, total, thinkingChars, toolCounts, turnCount }
}
