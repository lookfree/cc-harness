import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionSummary, SessionLiveStatus } from '@shared/types'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Search, Network, Check, Trash2 } from 'lucide-react'
import { STATUS_META, shortCwd, relativeTime, compactNum } from './sessionStatus'

interface Props {
  summaries: SessionSummary[]
  selectedIds: string[]
  compareMode: boolean
  onSelect: (id: string) => void
  onToggleCompare: (id: string) => void
  onDelete?: (id: string, filePath: string) => Promise<void>
}

const STATUS_FILTERS: Array<'all' | SessionLiveStatus> = ['all', 'active', 'waiting', 'idle', 'completed']

export function SessionList({ summaries, selectedIds, compareMode, onSelect, onToggleCompare, onDelete }: Props) {
  const { t } = useTranslation('sessions')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | SessionLiveStatus>('all')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const nowMs = Date.now()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return summaries
      .filter((s) => (statusFilter === 'all' ? true : s.status === statusFilter))
      .filter((s) =>
        !q ? true : (s.title ?? '').toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q)
      )
      .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false))
  }, [summaries, search, statusFilter])

  async function handleConfirmDelete(s: SessionSummary) {
    setConfirmId(null)
    try {
      await onDelete?.(s.sessionId, s.filePath)
    } catch (err) {
      console.error('[API] delete failed:', err)
      setConfirmId(s.sessionId)
    }
  }

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
          const isConfirming = confirmId === s.sessionId
          const handleActivate = () => {
            if (isConfirming) return
            compareMode ? onToggleCompare(s.sessionId) : onSelect(s.sessionId)
          }
          return (
            <div
              key={s.sessionId}
              role="button"
              tabIndex={0}
              className={cn(
                'group relative w-full text-left px-3 py-2 border-b border-border/50 hover:bg-muted/50 transition-colors cursor-pointer',
                selected && 'bg-muted'
              )}
              onClick={handleActivate}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActivate() }
              }}
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
                {onDelete && (
                  isConfirming ? (
                    <span className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="text-xs text-destructive hover:text-destructive/80 px-1.5 py-0.5 rounded border border-destructive/30 hover:border-destructive/60"
                        onClick={() => handleConfirmDelete(s)}
                      >
                        {t('deleteConfirm')}
                      </button>
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground px-1 py-0.5"
                        onClick={() => setConfirmId(null)}
                      >
                        {t('cancel')}
                      </button>
                    </span>
                  ) : (
                    <button
                      className="invisible group-hover:visible shrink-0 p-0.5 rounded text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setConfirmId(s.sessionId) }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 pl-4 text-xs text-muted-foreground">
                <span className="truncate flex-1">{shortCwd(s.cwd)}</span>
                {s.waitingFor && (
                  <Badge variant="outline" className="text-yellow-600 border-yellow-500/40">
                    {t('waitingFor', { tool: s.waitingFor })}
                  </Badge>
                )}
                {/* PERM-08：非 manual（原 default）的权限模式才显示——bypass/plan/acceptEdits 才是要注意的 */}
                {s.permissionMode && s.permissionMode !== 'default' && s.permissionMode !== 'manual' && (
                  <Badge
                    variant="outline"
                    className={
                      s.permissionMode === 'bypassPermissions'
                        ? 'text-red-500 border-red-500/40'
                        : 'text-blue-600 border-blue-500/40'
                    }
                  >
                    {t('permissionMode', { mode: s.permissionMode })}
                  </Badge>
                )}
                <span>{t('tokens', { n: compactNum(s.totalTokens.totalTokens) })}</span>
                {s.hasSubagents && <Network className="w-3 h-3" />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
