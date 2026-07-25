import type { TokenUsage } from '../types/session'

/**
 * 模型单价表（USD / 百万 token）。⚠ 估算值，会过时——模型与定价频繁变。
 * 集中此一处维护；理想接 claude-api skill 的权威单价。更新于下方 PRICING_UPDATED。
 * cache_read 通常约 0.1× input、cache_write 约 1.25× input（分开计费，别用一个单价）。
 */
export const PRICING_UPDATED = '2026-07-25'

export interface ModelPrice {
  inputPerM: number
  outputPerM: number
  cacheWritePerM: number
  cacheReadPerM: number
}

const SONNET5_PROMO_END = Date.parse('2026-09-01T00:00:00Z') // 促销价 $2/$10 截止（官方公告）
const SONNET5_PROMO: ModelPrice = { inputPerM: 2, outputPerM: 10, cacheWritePerM: 2.5, cacheReadPerM: 0.2 }
const SONNET5_LIST: ModelPrice = { inputPerM: 3, outputPerM: 15, cacheWritePerM: 3.75, cacheReadPerM: 0.3 }

/**
 * 按模型串关键字匹配（保留原串做分组，仅匹配时小写）。靠前优先——具体串排在通用串之前。
 * 价格源：claude-api skill 权威模型表（cacheWrite=1.25×input 5m TTL，cacheRead=0.1×input）。
 * sonnet-5 的促销/原价按查询时刻决定，见 priceFor（不在模块加载时定死）。
 */
const TABLE: Array<{ match: RegExp; price: ModelPrice }> = [
  // Fable 5 / Mythos 5：2026-07-07 官方公布 $10/$50（此前未公布、曾按 sonnet 档估）
  { match: /fable|mythos/i, price: { inputPerM: 10, outputPerM: 50, cacheWritePerM: 12.5, cacheReadPerM: 1 } },
  // 旧 Opus（4.1 / 4.0 / Opus 3）仍是 $15/$75——必须排在通用 /opus/ 之前，否则被误算成 $5/$25 的三分之一
  {
    match: /claude-3-opus|opus-4-1(\b|-)|opus-4-0\b|opus-4-20250514/i,
    price: { inputPerM: 15, outputPerM: 75, cacheWritePerM: 18.75, cacheReadPerM: 1.5 },
  },
  // fast mode 溢价档 $10/$50（Opus 5 官方价）。2.1.219 起 /fast 只作用于 Opus 5 与 Opus 4.8，
  // 且 fast 已从模型串（claude-opus-4-6-fast 这种）改成请求参数 speed:"fast"——
  // 只有落盘模型串仍带 -fast 后缀时这条才命中；参数式 fast 在 transcript 里与标准档同名，无法区分，会按 $5/$25 低估。
  { match: /opus.*-fast\b/i, price: { inputPerM: 10, outputPerM: 50, cacheWritePerM: 12.5, cacheReadPerM: 1 } },
  // Opus 4.5/4.6/4.7/4.8/5 全系 $5/$25（Opus 5 于 2026-07-24 上线，与 4.8 同价；
  // claude-opus-5 与带上下文后缀的 claude-opus-5[1m] 都走这条）
  { match: /opus/i, price: { inputPerM: 5, outputPerM: 25, cacheWritePerM: 6.25, cacheReadPerM: 0.5 } },
  { match: /haiku/i, price: { inputPerM: 1, outputPerM: 5, cacheWritePerM: 1.25, cacheReadPerM: 0.1 } },
  // 其余 sonnet 统一 $3/$15（sonnet-5 已在 priceFor 前置处理，不会走到这里）
  { match: /sonnet/i, price: SONNET5_LIST },
]

/**
 * @param model 模型串
 * @param atMs 用量发生的时刻（epoch ms），用于 sonnet-5 促销价判定；缺省用当前时刻。
 *             传 session 时间戳可让历史会话按当时价格计（否则跨越促销截止点后会被重新定价）。
 */
export function priceFor(model: string, atMs: number = Date.now()): ModelPrice | undefined {
  if (/sonnet-5/i.test(model)) return atMs < SONNET5_PROMO_END ? SONNET5_PROMO : SONNET5_LIST
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
