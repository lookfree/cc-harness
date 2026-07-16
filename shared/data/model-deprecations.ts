/**
 * 模型废弃/退役目录（MODEL-03，对齐 Claude Code 2.1.183 起的"废弃/自动切换模型警告"）。
 * 数据源：claude-api skill 权威模型表（2026-07-16 校对）。配置里还挂着这些 id 的，UI 给警告。
 */
export interface ModelDeprecation {
  /** 官方建议的替代模型 */
  replacement: string
  /** retired：已 404；retiring：已宣布退役日期；deprecated：已废弃未定日期；fastSunset：fast 变体停用 */
  status: 'retired' | 'retiring' | 'deprecated' | 'fastSunset'
  /** 退役日期（ISO，retiring/retired 时填） */
  date?: string
}

export const MODEL_DEPRECATIONS: Record<string, ModelDeprecation> = {
  // 已宣布退役
  'claude-opus-4-1': { replacement: 'claude-opus-4-8', status: 'retiring', date: '2026-08-05' },
  'claude-opus-4-1-20250805': { replacement: 'claude-opus-4-8', status: 'retiring', date: '2026-08-05' },
  // 已废弃（退役日期 TBD）
  'claude-opus-4-0': { replacement: 'claude-opus-4-8', status: 'deprecated' },
  'claude-opus-4-20250514': { replacement: 'claude-opus-4-8', status: 'deprecated' },
  'claude-sonnet-4-0': { replacement: 'claude-sonnet-5', status: 'deprecated' },
  'claude-sonnet-4-20250514': { replacement: 'claude-sonnet-5', status: 'deprecated' },
  'claude-3-haiku-20240307': { replacement: 'claude-haiku-4-5', status: 'retiring', date: '2026-04-19' },
  // 已退役（请求会 404）
  'claude-3-7-sonnet-20250219': { replacement: 'claude-sonnet-5', status: 'retired', date: '2026-02-19' },
  'claude-3-5-haiku-20241022': { replacement: 'claude-haiku-4-5', status: 'retired', date: '2026-02-19' },
  'claude-3-opus-20240229': { replacement: 'claude-opus-4-8', status: 'retired', date: '2026-01-05' },
  'claude-3-5-sonnet-20241022': { replacement: 'claude-sonnet-5', status: 'retired', date: '2025-10-28' },
  'claude-3-5-sonnet-20240620': { replacement: 'claude-sonnet-5', status: 'retired', date: '2025-10-28' },
  // fast 变体：4.6 已静默回落标准档，4.7 fast 计划 2026-07-25 前后移除（改用 Opus 4.8 + speed:fast）
  'claude-opus-4-6-fast': { replacement: 'claude-opus-4-8', status: 'fastSunset' },
  'claude-opus-4-7-fast': { replacement: 'claude-opus-4-8', status: 'fastSunset', date: '2026-07-25' },
}

export function modelDeprecation(modelId: string): ModelDeprecation | undefined {
  return MODEL_DEPRECATIONS[modelId]
}
