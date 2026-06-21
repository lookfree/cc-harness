import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionEvent } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Brain, Lock, Unlock } from 'lucide-react'

interface Props {
  events: SessionEvent[]
  /** 时间线点击 → 滚到对应 seq 卡片 */
  scrollToSeq?: number
  live?: boolean
}

function inputSummary(input: Record<string, unknown>): string {
  const s = JSON.stringify(input)
  return s.length > 220 ? s.slice(0, 220) + '…' : s
}

export function ConversationReplay({ events, scrollToSeq, live }: Props) {
  const { t } = useTranslation('sessions')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // 新事件到达自动滚到底（除非锁定）
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events.length, autoScroll])

  // 时间线跳转：滚到对应卡片
  useEffect(() => {
    if (scrollToSeq == null) return
    const el = scrollRef.current?.querySelector(`[data-seq="${scrollToSeq}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [scrollToSeq])

  // 回放只展示对话卡片，跳过 meta（ai-title/mode 等噪声）
  const cards = events.filter((e) => e.kind !== 'meta')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border text-xs text-muted-foreground">
        <span>{t('replay.count', { count: cards.length })}</span>
        <button
          onClick={() => setAutoScroll((v) => !v)}
          className="flex items-center gap-1 hover:text-foreground"
          title={t(autoScroll ? 'replay.locked' : 'replay.unlocked')}
        >
          {autoScroll ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
          {t(autoScroll ? 'replay.following' : 'replay.paused')}
          {live && <span className="ml-1 w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {cards.map((e) => (
          <EventCard key={`${e.uuid}-${e.seq}`} event={e} t={t} />
        ))}
      </div>
    </div>
  )
}

function EventCard({ event: e, t }: { event: SessionEvent; t: (k: string, o?: Record<string, unknown>) => string }) {
  const base = 'rounded border px-3 py-2 text-sm'
  switch (e.kind) {
    case 'user_turn':
      return (
        <div data-seq={e.seq} className={cn(base, 'border-sky-500/30 bg-sky-500/5')}>
          <div className="text-xs font-medium text-sky-600 mb-1">{t('card.user')}</div>
          <div className="whitespace-pre-wrap break-words">{e.text || <em className="text-muted-foreground">{t('card.noText')}</em>}</div>
        </div>
      )
    case 'assistant_turn':
      return (
        <div data-seq={e.seq} className={cn(base, 'border-violet-500/30 bg-violet-500/5')}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-violet-600">{t('card.assistant')}</span>
            {e.model && <Badge variant="outline" className="text-xs">{e.model}</Badge>}
            {e.hasThinking && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Brain className="w-3 h-3" />
                {t('card.thinking', { chars: e.thinkingChars })}
              </span>
            )}
          </div>
          <div className="whitespace-pre-wrap break-words">{e.text}</div>
        </div>
      )
    case 'tool_use':
      return (
        <div data-seq={e.seq} className={cn(base, 'border-amber-500/30 bg-amber-500/5')}>
          <div className="text-xs font-medium text-amber-600 mb-1">
            {t('card.toolUse')}: <span className="font-mono">{e.toolName}</span>
            {e.subagentType && <Badge variant="outline" className="ml-1 text-xs">{e.subagentType}</Badge>}
          </div>
          <code className="block text-xs text-muted-foreground break-all">{inputSummary(e.input)}</code>
        </div>
      )
    case 'tool_result':
      return (
        <div data-seq={e.seq} className={cn(base, e.isError ? 'border-red-500/40 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
          <details>
            <summary className={cn('text-xs font-medium cursor-pointer', e.isError ? 'text-red-600' : 'text-emerald-600')}>
              {t(e.isError ? 'card.toolError' : 'card.toolResult')}
            </summary>
            <pre className="mt-1 text-xs whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{e.contentText}</pre>
          </details>
        </div>
      )
    case 'system':
      return (
        <div data-seq={e.seq} className="text-xs text-muted-foreground px-3">
          {t('card.system')}{e.subtype ? `: ${e.subtype}` : ''}
        </div>
      )
    default:
      return null
  }
}
