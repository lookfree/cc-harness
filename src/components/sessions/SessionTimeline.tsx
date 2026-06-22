import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionEvent } from '@shared/types'
import { cn } from '@/lib/utils'
import { KIND_COLOR, formatClock, formatDuration } from './sessionStatus'

type TFn = (k: string, o?: Record<string, unknown>) => string

interface Domain {
  minMs: number
  maxMs: number
}

interface Props {
  events: SessionEvent[]
  /** 比对模式传入全局共享时间轴；单 session 不传则自算 */
  domain?: Domain
  onSeek?: (seq: number) => void
  label?: string
}

/** 直方图分桶数（固定，使比对模式各 session 在同一时间域下桶对齐）。 */
const BUCKETS = 60

/** 参与堆叠统计的事件类型（按从底到顶的堆叠顺序）；meta/system 视为噪声不计。 */
const STACK_KINDS: Array<'user_turn' | 'assistant_turn' | 'tool_use' | 'tool_result'> = [
  'user_turn',
  'assistant_turn',
  'tool_use',
  'tool_result',
]

interface Bucket {
  counts: Record<string, number>
  total: number
  /** 桶内最早事件 seq，点击跳回放用 */
  firstSeq?: number
  startMs: number
  endMs: number
}

/** 给每个事件赋"有效时间"：自身 timestamp，缺失则沿用上一个已知时间（meta 行常无 ts，spec014 已知）。 */
function effectiveTimes(events: SessionEvent[]): Array<{ event: SessionEvent; ms: number }> {
  let last = 0
  const out: Array<{ event: SessionEvent; ms: number }> = []
  for (const e of events) {
    const parsed = e.timestamp ? Date.parse(e.timestamp) : NaN
    if (!Number.isNaN(parsed)) last = parsed
    out.push({ event: e, ms: last })
  }
  // 开头若无 ts，用首个有效时间回填
  const firstValid = out.find((o) => o.ms > 0)?.ms ?? 0
  for (const o of out) if (o.ms === 0) o.ms = firstValid
  return out
}

export function SessionTimeline({ events, domain, onSeek, label }: Props) {
  const { t } = useTranslation('sessions')
  const { buckets, maxCount, min, max, eventCount } = useMemo(() => {
    const timed = effectiveTimes(events)
    const min = domain?.minMs ?? (timed.length ? Math.min(...timed.map((o) => o.ms)) : 0)
    const max = domain?.maxMs ?? (timed.length ? Math.max(...timed.map((o) => o.ms)) : 1)
    const span = max - min || 1
    const buckets: Bucket[] = Array.from({ length: BUCKETS }, (_, i) => ({
      counts: {},
      total: 0,
      startMs: min + (span * i) / BUCKETS,
      endMs: min + (span * (i + 1)) / BUCKETS,
    }))
    let eventCount = 0
    for (const { event, ms } of timed) {
      if (!STACK_KINDS.includes(event.kind as (typeof STACK_KINDS)[number])) continue
      const i = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((ms - min) / span) * BUCKETS)))
      const b = buckets[i]
      b.counts[event.kind] = (b.counts[event.kind] ?? 0) + 1
      b.total++
      eventCount++
      if (b.firstSeq === undefined) b.firstSeq = event.seq
    }
    const maxCount = Math.max(1, ...buckets.map((b) => b.total))
    return { buckets, maxCount, min, max, eventCount }
  }, [events, domain])

  if (eventCount === 0) {
    return (
      <div className="py-2 text-xs text-muted-foreground">
        {label ? `${label} · ` : ''}
        {t('timeline.empty')}
      </div>
    )
  }

  return (
    <div className="py-2">
      {label && <div className="text-xs font-medium mb-1 truncate">{label}</div>}
      {/* 密度直方图：按时间分桶，柱高=该桶事件数，按类型堆叠；空桶留白=活动间隙 */}
      <div className="flex items-end gap-px h-24 bg-muted/30 rounded border border-border/50 p-1">
        {buckets.map((b, i) => (
          <button
            key={i}
            disabled={b.total === 0}
            onClick={() => b.firstSeq !== undefined && onSeek?.(b.firstSeq)}
            title={bucketTitle(b, t)}
            className="flex-1 h-full flex flex-col-reverse hover:opacity-70 disabled:pointer-events-none"
          >
            {STACK_KINDS.map((k) =>
              b.counts[k] ? (
                <div key={k} className={KIND_COLOR[k]} style={{ height: `${(b.counts[k] / maxCount) * 100}%` }} />
              ) : null
            )}
          </button>
        ))}
      </div>
      {/* 时间轴：起止时刻 + 跨度 */}
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{formatClock(min)}</span>
        <span>{t('timeline.span', { d: formatDuration(max - min) })}</span>
        <span>{formatClock(max)}</span>
      </div>
    </div>
  )
}

/** STACK_KINDS → sessions namespace 下 card.* 标签 key。 */
const CARD_KEY: Record<(typeof STACK_KINDS)[number], string> = {
  user_turn: 'user',
  assistant_turn: 'assistant',
  tool_use: 'toolUse',
  tool_result: 'toolResult',
}

/** 桶 tooltip：时间区间 + 各类型计数。 */
function bucketTitle(b: Bucket, t: TFn): string {
  const range = `${formatClock(b.startMs)}–${formatClock(b.endMs)}`
  if (b.total === 0) return range
  const parts = STACK_KINDS.filter((k) => b.counts[k]).map((k) => `${t(`card.${CARD_KEY[k]}`)} ${b.counts[k]}`)
  return `${range} · ${parts.join(', ')}`
}

/** 图例：颜色 ↔ 事件类型。Sessions 页在直方图上方渲染一次。 */
export function TimelineLegend() {
  const { t } = useTranslation('sessions')
  const items: Array<[(typeof STACK_KINDS)[number], string]> = [
    ['user_turn', t('card.user')],
    ['assistant_turn', t('card.assistant')],
    ['tool_use', t('card.toolUse')],
    ['tool_result', t('card.toolResult')],
  ]
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap mb-2">
      {items.map(([k, lbl]) => (
        <span key={k} className="flex items-center gap-1">
          <span className={cn('w-2.5 h-2.5 rounded-sm', KIND_COLOR[k])} />
          {lbl}
        </span>
      ))}
    </div>
  )
}

/** 跨多个 session 算共享时间域（比对模式用）。 */
export function sharedDomain(eventLists: SessionEvent[][]): Domain {
  let minMs = Infinity
  let maxMs = -Infinity
  for (const list of eventLists) {
    for (const e of list) {
      if (!e.timestamp) continue
      const ms = Date.parse(e.timestamp)
      if (Number.isNaN(ms)) continue
      if (ms < minMs) minMs = ms
      if (ms > maxMs) maxMs = ms
    }
  }
  if (!Number.isFinite(minMs)) return { minMs: 0, maxMs: 1 }
  return { minMs, maxMs }
}
