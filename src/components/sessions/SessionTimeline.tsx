import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionEvent } from '@shared/types'
import { cn } from '@/lib/utils'
import { KIND_COLOR } from './sessionStatus'

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

interface Placed {
  event: SessionEvent
  ms: number
  /** 0..100 百分比横坐标 */
  x: number
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
  const { placed, resultX } = useMemo(() => {
    const timed = effectiveTimes(events)
    const min = domain?.minMs ?? Math.min(...timed.map((o) => o.ms))
    const max = domain?.maxMs ?? Math.max(...timed.map((o) => o.ms))
    const span = max - min || 1
    const placed: Placed[] = timed.map(({ event, ms }) => ({ event, ms, x: ((ms - min) / span) * 100 }))
    // tool_result 的 x，按 toolUseId 索引，给 tool_use 连线用
    const resultX = new Map<string, number>()
    for (const p of placed) if (p.event.kind === 'tool_result') resultX.set(p.event.toolUseId, p.x)
    return { placed, resultX }
  }, [events, domain])

  return (
    <div className="py-3">
      {label && <div className="text-xs text-muted-foreground mb-1 truncate">{label}</div>}
      <div className="relative h-8 bg-muted/30 rounded">
        {/* tool_use → tool_result 连线（表"用了多久"） */}
        {placed.map((p) => {
          if (p.event.kind !== 'tool_use') return null
          const rx = resultX.get(p.event.toolUseId)
          if (rx == null) return null
          const left = Math.min(p.x, rx)
          const width = Math.abs(rx - p.x)
          return (
            <div
              key={`line-${p.event.toolUseId}`}
              className="absolute top-1/2 h-px bg-amber-400/60"
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          )
        })}
        {/* 事件刻度点 */}
        {placed.map((p) => (
          <button
            key={`tick-${p.event.uuid}`}
            onClick={() => onSeek?.(p.event.seq)}
            title={tickTitle(p.event, t)}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full hover:ring-2 hover:ring-offset-1 hover:ring-foreground/30',
              KIND_COLOR[p.event.kind]
            )}
            style={{ left: `${p.x}%` }}
          />
        ))}
      </div>
    </div>
  )
}

function tickTitle(e: SessionEvent, t: TFn): string {
  switch (e.kind) {
    case 'tool_use':
      return `${t('card.toolUse')}: ${e.toolName}`
    case 'tool_result':
      return t(e.isError ? 'card.toolError' : 'card.toolResult')
    case 'assistant_turn':
      return `${t('card.assistant')}${e.model ? ` · ${e.model}` : ''}`
    case 'user_turn':
      return t('card.user')
    default:
      return e.kind
  }
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
