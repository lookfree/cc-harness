import type { UsageBreakdown, UsageAdvice, TokenUsage } from '../../../shared/types'
import { estimateCostUsd } from '../../../shared/data/model-pricing'

const tokensOf = (u: TokenUsage): number =>
  u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens

const pct1 = (x: number): number => Math.round(x * 1000) / 10 // 一位小数百分比
const usd2 = (x: number): number => Math.round(x * 100) / 100

/**
 * 基于 breakdown 生成 ECC 调优建议（数值由单价比/占比算出，非写死）。
 * 返回结构化 id+params，前端 i18n 渲染（见 spec017）。
 */
export function adviseUsage(b: UsageBreakdown): UsageAdvice[] {
  const out: UsageAdvice[] = []
  const total = b.total
  const byModel = total.byModel ?? {}
  const totalTok = total.totalTokens
  if (totalTok === 0) return out

  // 1) 主力 opus → 换 sonnet 可省（按单价比 × 实际用量算）
  const opus = Object.entries(byModel).filter(([m]) => /opus/i.test(m))
  const opusTok = opus.reduce((s, [, u]) => s + tokensOf(u), 0)
  if (opusTok / totalTok > 0.5) {
    let cur = 0
    let alt = 0
    for (const [m, u] of opus) {
      cur += estimateCostUsd(u, m) ?? 0
      // 2.1.197 起 Claude Code 默认模型为 claude-sonnet-5（促销期更便宜），省钱建议以它为基准
      alt += estimateCostUsd(u, 'claude-sonnet-5') ?? 0
    }
    const saving = cur - alt
    const reads = (b.toolCounts.Read ?? 0) + (b.toolCounts.Grep ?? 0) + (b.toolCounts.Glob ?? 0)
    const toolTotal = Object.values(b.toolCounts).reduce((a, c) => a + c, 0)
    const readHeavy = toolTotal > 0 && reads / toolTotal > 0.5
    if (saving > 0) {
      const savingPct = total.estimatedCostUsd ? pct1(saving / total.estimatedCostUsd) : 0
      out.push({
        id: 'switch-sonnet',
        severity: 'suggest',
        params: { pct: savingPct, usd: usd2(saving), readHeavy: readHeavy ? 1 : 0 },
        estimatedSavingUsd: usd2(saving),
        estimatedSavingPct: savingPct || undefined,
      })
    }
  }

  // 2) thinking 重（thinkingChars≈4 字/token）→ 降 MAX_THINKING_TOKENS
  const thinkTok = b.thinkingChars / 4
  if (total.outputTokens > 0 && thinkTok / total.outputTokens > 0.3) {
    const excessPct = pct1(thinkTok / total.outputTokens)
    out.push({
      id: 'thinking-budget',
      severity: 'suggest',
      params: { pct: excessPct },
      estimatedSavingPct: excessPct,
    })
  }

  // 3) 缓存命中率低（cacheRead 占输入侧比例低）→ 查 system prompt 稳定性
  const inputSide = total.inputTokens + total.cacheCreationInputTokens + total.cacheReadInputTokens
  if (inputSide > 0) {
    const cacheRatio = total.cacheReadInputTokens / inputSide
    if (cacheRatio < 0.3) {
      out.push({ id: 'low-cache', severity: 'info', params: { pct: pct1(cacheRatio) } })
    }
  }

  // 4) token 集中在子代理（subagents bucket 占比高）
  const subTok = b.byBucket.subagents.totalTokens
  if (subTok / totalTok > 0.6) {
    out.push({ id: 'subagents-heavy', severity: 'info', params: { pct: pct1(subTok / totalTok) } })
  }

  return out
}
