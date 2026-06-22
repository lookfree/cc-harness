import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { LoopTask } from '@shared/types/loop'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Timer, RefreshCw, ChevronDown, ChevronRight, Info } from 'lucide-react'

type StatusFilter = 'all' | LoopTask['status']

const STATUS_CLASS: Record<LoopTask['status'], string> = {
  pending: 'text-blue-600 border-blue-400',
  fired: 'text-green-600 border-green-400',
  expired: 'text-muted-foreground border-border',
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

function fireCountdown(fireAt: string, t: (k: string, opts?: Record<string, unknown>) => string): string {
  const diff = new Date(fireAt).getTime() - Date.now()
  if (diff > 0) {
    return t('fireIn', { time: formatDuration(Math.round(diff / 1000)) })
  }
  return t('fireAgo', { time: formatDuration(Math.round(-diff / 1000)) })
}

function LoopRow({ task }: { task: LoopTask }) {
  const { t } = useTranslation('loops')
  const [open, setOpen] = useState(false)
  const shortSession = task.sessionId.slice(0, 8)
  const shortCwd = task.cwd.split('/').pop() ?? task.cwd

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-xs', STATUS_CLASS[task.status])}>
              {t(`status.${task.status}`)}
            </Badge>
            <span className="text-sm truncate font-medium">{task.description || task.prompt}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
            <span className="font-mono">{shortSession}…</span>
            <span>{shortCwd}</span>
            <span>{t('delayValue', { seconds: formatDuration(task.delaySeconds) })}</span>
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground space-y-0.5">
          <div>{new Date(task.scheduledAt).toLocaleString()}</div>
          <div className={task.status === 'pending' ? 'text-blue-600 font-medium' : ''}>
            {task.status === 'fired' && task.firedAt
              ? t('firedAt', { time: new Date(task.firedAt).toLocaleTimeString() })
              : fireCountdown(task.fireAt, t)}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t px-4 py-3 space-y-2 text-xs bg-muted/20">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
            <span className="font-medium">{t('cols.session')}</span>
            <span className="font-mono break-all">{task.sessionId}</span>
            <span className="font-medium">CWD</span>
            <span className="break-all">{task.cwd}</span>
            <span className="font-medium">{t('cols.scheduledAt')}</span>
            <span>{new Date(task.scheduledAt).toLocaleString()}</span>
            <span className="font-medium">{t('cols.fireAt')}</span>
            <span>{new Date(task.fireAt).toLocaleString()}</span>
            {task.firedAt && (
              <>
                <span className="font-medium">{t('firedAt', { time: '' }).replace(' ', '')}</span>
                <span>{new Date(task.firedAt).toLocaleString()}</span>
              </>
            )}
            {task.description && task.description !== task.prompt && (
              <>
                <span className="font-medium">{t('reason')}</span>
                <span className="break-words">{task.description}</span>
              </>
            )}
            {task.prompt && (
              <>
                <span className="font-medium">{t('prompt')}</span>
                <span className="break-words">{task.prompt}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Loops() {
  const { t } = useTranslation('loops')
  const [tasks, setTasks] = useState<LoopTask[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('all')

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true)
    try {
      setTasks(await api.loop.list())
    } catch (e) {
      console.error('[Loops] load failed:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  const filters: StatusFilter[] = ['all', 'pending', 'fired', 'expired']
  const visible = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)

  if (loading) return (
    <div className="h-full flex flex-col">
      <PageHeader />
      <div className="py-12 text-center text-muted-foreground">{t('loading')}</div>
    </div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1">
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1 text-xs rounded-md border transition-colors',
                  filter === f
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground border-border hover:bg-muted/60',
                )}
              >
                {t(`filter.${f}`)}
                {f !== 'all' && (
                  <span className="ml-1.5 opacity-70">
                    {tasks.filter((t) => t.status === f).length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {tasks.length} total
          </span>
          <Button size="sm" variant="outline" onClick={() => load()} disabled={refreshing}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', refreshing && 'animate-spin')} />
            {t('refresh')}
          </Button>
        </div>

        {/* Read-only notice */}
        <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground bg-muted/30">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{t('readOnlyNote')}</span>
        </div>

        {/* List */}
        {visible.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <p className="text-muted-foreground">{t('empty')}</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">{t('emptyHint')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((task) => <LoopRow key={task.id} task={task} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function PageHeader() {
  const { t } = useTranslation('loops')
  return (
    <div className="border-b border-border px-6 py-4 flex items-center gap-2 shrink-0">
      <Timer className="w-5 h-5" />
      <div>
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>
    </div>
  )
}
