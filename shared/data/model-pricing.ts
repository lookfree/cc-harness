import type { TokenUsage } from '../types/session'

/**
 * 模型单价表（USD / 百万 token）。⚠ 估算值，会过时——模型与定价频繁变。
 * 集中此一处维护；理想接 claude-api skill 的权威单价。更新于下方 PRICING_UPDATED。
 * cache_read 通常约 0.1× input、cache_write 约 1.25× input（分开计费，别用一个单价）。
 */
export const PRICING_UPDATED = '2026-07-16'

export interface ModelPrice {
  inputPerM: number
  outputPerM: number
  cacheWritePerM: number
  cacheReadPerM: number
}

/** Sonnet 5 促销价 $2/$10 至 2026-08-31（官方公告），2026-09-01 起恢复 $3/$15。 */
const SONNET5_PROMO_ACTIVE = Date.now() < Date.parse('2026-09-01T00:00:00Z')

/**
 * 按模型串关键字匹配（保留原串做分组，仅匹配时小写）。靠前优先——sonnet-5 必须排在 sonnet 之前。
 * 价格源：claude-api skill 权威模型表（cacheWrite=1.25×input 5m TTL，cacheRead=0.1×input）。
 */
const TABLE: Array<{ match: RegExp; price: ModelPrice }> = [
  // Fable 5 / Mythos 5：2026-07-07 官方公布 $10/$50（此前未公布、曾按 sonnet 档估）
  { match: /fable|mythos/i, price: { inputPerM: 10, outputPerM: 50, cacheWritePerM: 12.5, cacheReadPerM: 1 } },
  {
    match: /sonnet-5/i,
    price: SONNET5_PROMO_ACTIVE
      ? { inputPerM: 2, outputPerM: 10, cacheWritePerM: 2.5, cacheReadPerM: 0.2 }
      : { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.3 },
  },
  // Opus 4.6/4.7/4.8 全系 $5/$25（$15/$75 是 Opus 3 时代旧价，勿回退）
  { match: /opus/i, price: { inputPerM: 5, outputPerM: 25, cacheWritePerM: 6.25, cacheReadPerM: 0.5 } },
  { match: /sonnet/i, price: { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.3 } },
  { match: /haiku/i, price: { inputPerM: 1, outputPerM: 5, cacheWritePerM: 1.25, cacheReadPerM: 0.1 } },
]

export function priceFor(model: string): ModelPrice | undefined {
  return TABLE.find((t) => t.match.test(model))?.price
}

/** 按单价表估算一段用量的成本（USD）；未知模型返回 undefined。 */
export function estimateCostUsd(u: Pick<TokenUsage, 'inputTokens' | 'outputTokens' | 'cacheCreationInputTokens' | 'cacheReadInputTokens'>, model: string): number | undefined {
  const p = priceFor(model)
  if (!p) return undefined
  return (
    (u.inputTokens * p.inputPerM +
      u.outputTokens * p.outputPerM +
      u.cacheCreationInputTokens * p.cacheWritePerM +
      u.cacheReadInputTokens * p.cacheReadPerM) /
    1_000_000
  )
}

/** 对 byModel 映射求总成本（逐 model 用各自单价，未知模型跳过）。 */
export function estimateCostByModel(byModel: Record<string, TokenUsage>): number {
  let cost = 0
  for (const [model, u] of Object.entries(byModel)) {
    cost += estimateCostUsd(u, model) ?? 0
  }
  return cost
}
