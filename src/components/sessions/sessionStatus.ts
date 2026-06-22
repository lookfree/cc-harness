import type { SessionLiveStatus, SessionEvent } from '@shared/types'

/** 状态 → 状态点颜色类 + i18n 标签 key（在 sessions namespace 下 status.<key>）。 */
export const STATUS_META: Record<SessionLiveStatus, { dot: string; key: string }> = {
  active: { dot: 'bg-green-500', key: 'active' },
  waiting: { dot: 'bg-yellow-500', key: 'waiting' },
  idle: { dot: 'bg-gray-400', key: 'idle' },
  completed: { dot: 'bg-blue-500', key: 'completed' },
  unknown: { dot: 'bg-gray-300', key: 'unknown' },
}

/** 事件 kind → 时间线刻度上色（与回放卡片配色一致）。 */
export const KIND_COLOR: Record<SessionEvent['kind'], string> = {
  user_turn: 'bg-sky-500',
  assistant_turn: 'bg-violet-500',
  tool_use: 'bg-amber-500',
  tool_result: 'bg-emerald-500',
  system: 'bg-gray-400',
  meta: 'bg-gray-300',
}

/** cwd 末段短名（列表/标题展示）。 */
export function shortCwd(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] || cwd
}

/** ISO/ms → 相对时间（粗粒度，免引第三方）。 */
export function relativeTime(iso: string | undefined, nowMs: number): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const diff = Math.max(0, nowMs - ms)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** ms 时间戳 → 本地时钟（HH:MM:SS），时间轴端点用。 */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleTimeString()
}

/** 时长（ms）→ 紧凑跨度（45s / 12m 30s / 2h 13m / 1d 3h）。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** token 数 → 紧凑展示（1.2k / 3.4M）。 */
export function compactNum(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
