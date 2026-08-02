/** 配置健康分（spec028）：只读体检，后端只给 id+params，文案在前端 i18n。 */
export type HealthSeverity = 'warn' | 'suggest' | 'info'

export type HealthCheckId =
  | 'thinking-budget-unset'
  | 'subagent-model-unset'
  | 'autocompact-off'
  | 'mcp-heavy'
  | 'surface-heavy'
  | 'opus-pinned'

export interface HealthCheck {
  /** i18n：health.check.<id>.title / .detail */
  id: HealthCheckId
  severity: HealthSeverity
  params?: Record<string, string | number>
  /** 扣分权重（UI 可展示"修好 +N 分"） */
  penalty: number
}

export interface ConfigHealth {
  /** 0–100，100 = 无待办 */
  score: number
  /** 已按 penalty 降序 */
  checks: HealthCheck[]
  /** 参与计算的规模数（UI 展示口径，别让用户猜） */
  counts: { mcpServers: number; skills: number; commands: number; agents: number }
}
