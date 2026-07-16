import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { BackgroundAgentsSnapshot, BgAgentItem } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Bot, Terminal, RefreshCw, Radar, CircleAlert, CircleDot, CircleCheck, CirclePause, Pin, Copy, Check } from 'lucide-react'

/**
 * 后台 agent / 活跃会话观测面（ORCH-01/02/12、OBS-06）。
 * 数据源：claude agents --json --all（权威 roster）+ jobs/<id>/state.json + daemon/roster.json。
 * 分组镜像官方 agent view：Needs input / Working / Idle / Done。
 */
type Group = 'needsInput' | 'working' | 'idle' | 'done'

const GROUP_ORDER: Group[] = ['needsInput', 'working', 'idle', 'done']

const GROUP_STYLE: Record<Group, { icon: typeof CircleDot; class: string }> = {
  needsInput: { icon: CircleAlert, class: 'text-amber-500' },
  working: { icon: CircleDot, class: 'text-green-600' },
  idle: { icon: CirclePause, class: 'text-muted-foreground' },
  done: { icon: CircleCheck, class: 'text-muted-foreground' },
}

/** status/state 是开放字符串（spec 风险节）——default 一律落 idle/done 兜底。 */
function groupOf(item: BgAgentItem): Group {
  if (item.waitingFor || item.status === 'waiting') return 'needsInput'
  if (item.status === 'busy') return 'working'
  if (item.kind === 'background') {
    // CLI（claude agents --json）是权威 roster；磁盘 jobs/state.json 可能过期（崩溃/滞后），
    // 只在 CLI 没给 state 时退回磁盘，否则会把已结束的 job 误报成"干活中"
    const s = item.state ?? item.job?.state
    if (s === 'working' || s === 'running' || s === 'active') return 'working'
    if (s === 'failed' || s === 'completed' || s === 'killed' || s === 'cancelled' || s === 'done') return 'done'
    return 'idle'
  }
  return 'idle'
}

function AgentRow({ item }: { item: BgAgentItem }) {
  const { t } = useTranslation('bgagents')
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(copyTimer.current), []) // 卸载时清定时器，避免对已卸载组件 setState
  const KindIcon = item.kind === 'background' ? Bot : Terminal
  const stateText = item.waitingFor ?? item.status ?? item.state ?? item.job?.state
  const failed = (item.state ?? item.job?.state) === 'failed' // CLI 权威优先（同 groupOf）
  // ORCH-04 增量：后台 job 给出 attach 命令一键复制（在终端 attach，Ctrl+Z 回 shell）
  const attachCmd = item.kind === 'background' && item.id ? `claude attach ${item.id}` : null

  async function copyAttach() {
    if (!attachCmd) return
    try {
      await navigator.clipboard?.writeText(attachCmd)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用则不响应 */
    }
  }

  return (
    <div className="border rounded-lg px-4 py-3 bg-card">
      <div className="flex items-center gap-3">
        <KindIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{item.name}</span>
            {item.pinned && <Pin className="h-3 w-3 text-blue-500" aria-label={t('pinned')} />}
            <Badge variant="outline" className="text-xs font-normal">{t(`kind.${item.kind}`)}</Badge>
            {stateText && (
              <Badge
                variant="outline"
                className={cn(
                  'text-xs font-normal',
                  item.waitingFor && 'text-amber-600 border-amber-400',
                  failed && 'text-red-500 border-red-400'
                )}
              >
                {item.waitingFor ? t('waitingFor', { what: item.waitingFor }) : stateText}
              </Badge>
            )}
            {item.job?.attempt != null && item.job.attempt > 1 && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">
                {t('attempt', { n: item.job.attempt })}
              </Badge>
            )}
            {item.job?.cliVersion && (
              <Badge variant="secondary" className="text-xs font-mono">v{item.job.cliVersion}</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {item.cwd} · {new Date(item.startedAt).toLocaleString()}
          </div>
          {item.job?.detail && (
            <p className="text-xs mt-1 text-foreground/80 line-clamp-2">{item.job.detail}</p>
          )}
          {item.job?.intent && (
            <p className="text-xs mt-0.5 text-muted-foreground truncate">
              {t('intent')}: {item.job.intent}
            </p>
          )}
        </div>
        {attachCmd && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0 font-mono" onClick={copyAttach}>
            {copied ? <Check className="h-3.5 w-3.5 mr-1 text-green-600" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
            {attachCmd}
          </Button>
        )}
      </div>
    </div>
  )
}

export default function BgAgents() {
  const { t } = useTranslation('bgagents')
  const [snap, setSnap] = useState<BackgroundAgentsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true)
    try {
      setSnap(await api.bgAgents.list())
    } catch (e) {
      console.error('[BgAgents] load failed:', e)
      setSnap({ available: false, error: e instanceof Error ? e.message : String(e), fetchedAt: Date.now(), items: [] })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  const groups = new Map<Group, BgAgentItem[]>()
  for (const item of snap?.items ?? []) {
    const g = groupOf(item)
    groups.set(g, [...(groups.get(g) ?? []), item])
  }

  return (
    <div className="h-full flex flex-col overflow-auto">
      <div className="border-b border-border px-6 py-4 flex items-center gap-2">
        <Radar className="w-5 h-5" />
        <div className="flex-1">
          <h1 className="text-xl font-bold">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load()} disabled={refreshing}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', refreshing && 'animate-spin')} />
          {t('refresh')}
        </Button>
      </div>

      <div className="p-6 space-y-5">
        {loading && <div className="py-12 text-center text-muted-foreground">{t('loading')}</div>}

        {!loading && snap && !snap.available && (
          <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground bg-muted/40">
            {snap.error === 'desktop_only' ? t('desktopOnly') : t('cliError', { error: snap.error ?? 'unknown' })}
          </div>
        )}

        {!loading && snap?.available && snap.items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">{t('empty')}</div>
        )}

        {GROUP_ORDER.map((g) => {
          const items = groups.get(g)
          if (!items?.length) return null
          const { icon: GIcon, class: gClass } = GROUP_STYLE[g]
          return (
            <div key={g} className="space-y-2">
              <div className="flex items-center gap-2">
                <GIcon className={cn('h-4 w-4', gClass)} />
                <h2 className="text-sm font-semibold">{t(`groups.${g}`)}</h2>
                <Badge variant="secondary" className="text-xs">{items.length}</Badge>
              </div>
              {items.map((item, i) => (
                // pid/id 都缺失时用组内下标兜底，避免同 sessionId 多行 key 碰撞导致 copied 状态串行
                <AgentRow key={`${item.kind}:${item.sessionId}:${item.pid ?? item.id ?? i}`} item={item} />
              ))}
            </div>
          )
        })}

        {snap?.available && (
          <p className="text-xs text-muted-foreground">
            {t('fetchedAt', { time: new Date(snap.fetchedAt).toLocaleTimeString() })}
            {snap.rosterUpdatedAt != null &&
              ` · ${t('rosterUpdatedAt', { time: new Date(snap.rosterUpdatedAt).toLocaleString() })}`}
          </p>
        )}
      </div>
    </div>
  )
}
