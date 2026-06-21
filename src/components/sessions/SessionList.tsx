import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionSummary, SessionLiveStatus } from '@shared/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Search, Network, Check } from 'lucide-react'
import { STATUS_META, shortCwd, relativeTime, compactNum } from './sessionStatus'

interface Props {
  summaries: SessionSummary[]
  selectedIds: string[]
  compareMode: boolean
  onSelect: (id: string) => void
  onToggleCompare: (id: string) => void
}

const STATUS_FILTERS: Array<'all' | SessionLiveStatus> = ['all', 'active', 'waiting', 'idle']

export function SessionList({ summaries, selectedIds, compareMode, onSelect, onToggleCompare }: Props) {
  const { t } = useTranslation('sessions')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | SessionLiveStatus>('all')
  const nowMs = Date.now()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return summaries
      .filter((s) => (statusFilter === 'all' ? true : s.status === statusFilter))
      .filter((s) =>
        !q ? true : (s.title ?? '').toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q)
      )
      // pinned 置顶（暂无数据源，留作未来）；其次最近活跃
      .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
  }, [summaries, search, statusFilter])

  return (
    <div className="flex flex-col h-full border-r border-border">
      <div className="p-3 space-y-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                'px-2 py-0.5 rounded text-xs',
                statusFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              )}
            >
              {f === 'all' ? t('filter.all') : t(`status.${f}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">{t('empty')}</div>
        )}
        {filtered.map((s) => {
          const selected = selectedIds.includes(s.sessionId)
          return (
            <button
              key={s.sessionId}
              onClick={() => (compareMode ? onToggleCompare(s.sessionId) : onSelect(s.sessionId))}
              className={cn(
                'w-full text-left px-3 py-2 border-b border-border/50 hover:bg-muted/50 transition-colors',
                selected && 'bg-muted'
              )}
            >
              <div className="flex items-center gap-2">
                {compareMode && (
                  <span
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                      selected ? 'bg-primary border-primary' : 'border-border'
                    )}
                  >
                    {selected && <Check className="w-3 h-3 text-primary-foreground" />}
                  </span>
                )}
                <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_META[s.status].dot)} />
                <span className="flex-1 truncate text-sm font-medium">
                  {s.title || shortCwd(s.cwd)}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {relativeTime(s.lastActivityAt, nowMs)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 pl-4 text-xs text-muted-foreground">
                <span className="truncate flex-1">{shortCwd(s.cwd)}</span>
                {s.waitingFor && (
                  <Badge variant="outline" className="text-yellow-600 border-yellow-500/40">
                    {t('waitingFor', { tool: s.waitingFor })}
                  </Badge>
                )}
                <span>{compactNum(s.totalTokens.totalTokens)} tok</span>
                {s.hasSubagents && <Network className="w-3 h-3" />}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
