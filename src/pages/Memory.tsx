import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { MemoryStore, MemoryTopic, MemorySnapshot, DreamChange } from '@shared/types/memory'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Brain, Camera, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'

// ── Topic card ──────────────────────────────────────────────────────────────

function TopicCard({ topic, dir }: { topic: MemoryTopic; dir: string }) {
  const { t } = useTranslation('memory')
  const [open, setOpen] = useState(false)
  const fullPath = `${dir}/${topic.file}`
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen(!open)}
        title={fullPath}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="font-medium text-sm flex-1 truncate">{topic.title ?? topic.file}</span>
        <span className="text-xs font-mono text-muted-foreground ml-2 shrink-0" title={fullPath}>{topic.file}</span>
        {!topic.referenced && (
          <Badge variant="secondary" className="text-xs ml-1 shrink-0" title={t('orphanDesc')}>{t('orphanBadge')}</Badge>
        )}
      </button>
      {open && (
        <div className="border-t px-4 py-3 space-y-2">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>{t('sizeBytes', { size: topic.sizeBytes.toLocaleString() })}</span>
            <span>{t('modifiedAt', { time: new Date(topic.modifiedAt).toLocaleString() })}</span>
          </div>
          <pre className="text-xs bg-muted/50 rounded p-3 overflow-auto max-h-96 whitespace-pre-wrap font-mono leading-relaxed">{topic.content}</pre>
        </div>
      )}
    </div>
  )
}

// ── Diff view ────────────────────────────────────────────────────────────────

const CHANGE_COLORS: Record<DreamChange['type'], string> = {
  added: 'text-green-600',
  deleted: 'text-red-500',
  modified: 'text-blue-500',
  merged: 'text-purple-600',
  'resolved-conflict': 'text-orange-500',
}

function DiffCard({ change }: { change: DreamChange }) {
  const { t } = useTranslation('memory')
  const [open, setOpen] = useState(false)
  const color = CHANGE_COLORS[change.type] ?? 'text-muted-foreground'
  const hasDetail = change.beforeText != null || change.afterText != null

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => hasDetail && setOpen(!open)}
        disabled={!hasDetail}
      >
        {hasDetail ? (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />) : <span className="w-3.5 h-3.5 shrink-0 inline-block" />}
        <span className={cn('text-xs font-semibold w-20 shrink-0', color)}>{t(`changeTypes.${change.type}` as Parameters<typeof t>[0])}</span>
        <span className="font-mono text-sm flex-1 truncate">{change.file}</span>
        <span className="text-xs text-muted-foreground ml-2 shrink-0">{change.detail}</span>
      </button>
      {open && hasDetail && (
        <div className="border-t grid grid-cols-2 divide-x text-xs font-mono">
          {change.beforeText != null && (
            <div className="p-3">
              <div className="text-muted-foreground mb-1 font-sans font-medium">{t('diffBefore')}</div>
              <pre className="whitespace-pre-wrap leading-relaxed text-red-700 bg-red-50 dark:bg-red-950/20 rounded p-2 overflow-auto max-h-64">{change.beforeText}</pre>
            </div>
          )}
          {change.afterText != null && (
            <div className="p-3">
              <div className="text-muted-foreground mb-1 font-sans font-medium">{t('diffAfter')}</div>
              <pre className="whitespace-pre-wrap leading-relaxed text-green-700 bg-green-50 dark:bg-green-950/20 rounded p-2 overflow-auto max-h-64">{change.afterText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Snapshot select ──────────────────────────────────────────────────────────

function SnapshotSelect({ value, onChange, snapshots }: {
  value: string
  onChange: (id: string) => void
  snapshots: MemorySnapshot[]
}) {
  return (
    <select
      className="text-xs border rounded px-2 py-1 bg-background"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {snapshots.map((s) => (
        <option key={s.id} value={s.id}>{new Date(s.takenAt).toLocaleString()} ({s.files.length}f)</option>
      ))}
    </select>
  )
}

// ── Dream panel ───────────────────────────────────────────────────────────────

function DreamPanel({ encodedCwd }: { encodedCwd: string }) {
  const { t } = useTranslation('memory')
  const [snapshots, setSnapshots] = useState<MemorySnapshot[]>([])
  const [taking, setTaking] = useState(false)
  const [beforeId, setBeforeId] = useState('')
  const [afterId, setAfterId] = useState('')
  const [changes, setChanges] = useState<DreamChange[] | null>(null)
  const [comparing, setComparing] = useState(false)
  const [takenMsg, setTakenMsg] = useState('')

  const loadSnapshots = useCallback(async () => {
    const list = await api.memory.listSnapshots(encodedCwd)
    setSnapshots(list)
    setAfterId((prev) => (list.length >= 1 && !prev) ? list[0].id : prev)
    setBeforeId((prev) => (list.length >= 2 && !prev) ? list[1].id : prev)
  }, [encodedCwd])

  useEffect(() => { loadSnapshots() }, [loadSnapshots])

  async function handleSnapshot() {
    setTaking(true)
    setTakenMsg('')
    try {
      await api.memory.snapshot(encodedCwd)
      setTakenMsg(t('snapshotDone'))
      await loadSnapshots()
    } finally {
      setTaking(false)
    }
  }

  async function handleDelete(id: string) {
    await api.memory.deleteSnapshot(id)
    setChanges(null)
    if (beforeId === id) setBeforeId('')
    if (afterId === id) setAfterId('')
    await loadSnapshots()
  }

  async function handleCompare() {
    if (!beforeId || !afterId || beforeId === afterId) return
    setComparing(true)
    try {
      const result = await api.memory.diff(beforeId, afterId)
      setChanges(result)
    } finally {
      setComparing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Dream banner */}
      <div className="rounded-md border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-200">
        {t('dreamBanner')}
      </div>

      {api.isElectron() && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={handleSnapshot} disabled={taking}>
            <Camera className={cn('h-3.5 w-3.5 mr-1.5', taking && 'animate-pulse')} />
            {t('snapshotBtn')}
          </Button>
          {takenMsg && <span className="text-xs text-green-600">{takenMsg}</span>}
        </div>
      )}

      {snapshots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noSnapshots')}</p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t('snapshots')}</p>
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-xs border rounded px-3 py-2">
                <span className="text-muted-foreground">{t('snapshotTakenAt', { time: new Date(s.takenAt).toLocaleString() })}</span>
                <span className="text-muted-foreground">·</span>
                <span>{t('snapshotFiles', { count: s.files.length })}</span>
                <span className="ml-auto text-muted-foreground font-mono truncate max-w-[160px]">{s.id.split('__')[1]}</span>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(s.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {api.isElectron() && snapshots.length >= 2 && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">{t('selectBefore')}</label>
                <SnapshotSelect value={beforeId} onChange={(id) => { setBeforeId(id); setChanges(null) }} snapshots={snapshots} />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">{t('selectAfter')}</label>
                <SnapshotSelect value={afterId} onChange={(id) => { setAfterId(id); setChanges(null) }} snapshots={snapshots} />
              </div>
              <Button size="sm" onClick={handleCompare} disabled={comparing || !beforeId || !afterId || beforeId === afterId}>
                {t('compareBtn')}
              </Button>
            </div>
          )}

          {changes !== null && (
            changes.length === 0
              ? <p className="text-sm text-muted-foreground">{t('noChanges')}</p>
              : <div className="space-y-2">{changes.map((c, i) => <DiffCard key={i} change={c} />)}</div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Memory() {
  const { t } = useTranslation('memory')
  const [stores, setStores] = useState<MemoryStore[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<MemoryStore | null>(null)

  useEffect(() => {
    api.memory.list()
      .then((list) => {
        setStores(list)
        if (list.length > 0) setSelected(list[0])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const shortCwd = (cwd: string) => {
    const home = typeof process !== 'undefined' ? (process as NodeJS.Process & { env: { HOME?: string } }).env.HOME ?? '' : ''
    return cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd
  }

  if (loading) return (
    <div className="h-full flex flex-col">
      <PageHeader />
      <div className="py-12 text-center text-muted-foreground">{t('loading')}</div>
    </div>
  )

  if (stores.length === 0) return (
    <div className="h-full flex flex-col">
      <PageHeader />
      <div className="p-6 py-12 text-center text-muted-foreground text-sm">{t('empty')}</div>
    </div>
  )

  const indexedTopics = selected?.topics.filter((tp) => tp.referenced) ?? []
  const orphans = selected?.topics.filter((tp) => !tp.referenced) ?? []

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader />
      <div className="flex flex-1 overflow-hidden">
        {/* Project list */}
        <div className="w-56 border-r flex-shrink-0 overflow-y-auto p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground px-2 pb-1">{t('projectList')}</p>
          {stores.map((s) => (
            <button
              key={s.encodedCwd}
              onClick={() => setSelected(s)}
              title={s.cwd}
              className={cn(
                'w-full text-left px-2 py-2 rounded-md text-sm transition-colors',
                selected?.encodedCwd === s.encodedCwd
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted/60 text-muted-foreground'
              )}
            >
              <div className="font-medium truncate">{s.cwd.split('/').pop()}</div>
              <div className="text-[10px] truncate opacity-70">{shortCwd(s.cwd)}</div>
              <div className="text-[10px] opacity-60 mt-0.5">{t('topicsCount', { count: s.topics.length })}</div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!selected ? (
            <p className="text-muted-foreground text-sm">{t('noProject')}</p>
          ) : selected.topics.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noMemory')}</p>
          ) : (
            <>
              {/* Index section */}
              {selected.index.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold mb-3">{t('indexSection')}</h2>
                  <div className="space-y-1">
                    {selected.index.map((entry) => (
                      <div
                        key={entry.file}
                        className="flex items-start gap-2 text-sm rounded px-2 py-1.5"
                      >
                        <span className="font-medium text-primary">{entry.title}</span>
                        {entry.summary && <span className="text-muted-foreground text-xs">— {entry.summary}</span>}
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground shrink-0" title={`${selected.dir}/${entry.file}`}>{entry.file}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Topics */}
              <section>
                <h2 className="text-sm font-semibold mb-3">{t('topicsSection')}</h2>
                <div className="space-y-2">
                  {indexedTopics.map((tp) => <TopicCard key={tp.file} topic={tp} dir={selected.dir} />)}
                  {orphans.map((tp) => <TopicCard key={tp.file} topic={tp} dir={selected.dir} />)}
                </div>
              </section>

              {/* Dream section */}
              <section>
                <h2 className="text-sm font-semibold mb-3">{t('dreamSection')}</h2>
                <DreamPanel encodedCwd={selected.encodedCwd} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PageHeader() {
  const { t } = useTranslation('memory')
  return (
    <div className="border-b border-border px-6 py-4 flex items-center gap-2 shrink-0">
      <Brain className="w-5 h-5" />
      <div>
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>
    </div>
  )
}
