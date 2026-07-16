import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { MCPHealth } from '@shared/types/mcp-health'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CheckCircle2, XCircle, AlertCircle, HelpCircle, RefreshCw, ChevronDown, ChevronRight, ShieldAlert
} from 'lucide-react'

const STATE_CONFIG = {
  connected:  { icon: CheckCircle2, class: 'text-green-600',  label: 'health.state.connected'  },
  failed:     { icon: XCircle,      class: 'text-red-500',    label: 'health.state.failed'      },
  'needs-auth': { icon: AlertCircle, class: 'text-yellow-500', label: 'health.state.needsAuth'  },
  unknown:    { icon: HelpCircle,   class: 'text-muted-foreground', label: 'health.state.unknown' },
  // 项目级 stdio 不自动 spawn（2.1.196 供应链姿态），等用户点"确认探测"
  'pending-approval': { icon: ShieldAlert, class: 'text-amber-500', label: 'health.state.pendingApproval' },
}

function StatPill({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-3 py-1.5 rounded-md bg-muted/50 min-w-[56px]', className)}>
      <span className="text-[10px] text-muted-foreground leading-none">{label}</span>
      <span className="text-sm font-semibold mt-0.5 leading-none">{value}</span>
    </div>
  )
}

function ServerCard({ health, onProbe }: { health: MCPHealth; onProbe: (name: string) => void }) {
  const { t } = useTranslation('mcp')
  const [expanded, setExpanded] = useState(false)
  const [probing, setProbing] = useState(false)

  const cfg = STATE_CONFIG[health.state] ?? STATE_CONFIG.unknown
  const Icon = cfg.icon
  const s = health.callStats
  const successRate = s.total > 0 ? Math.round((s.success / s.total) * 100) : null

  async function handleProbe() {
    if (!api.isElectron()) return
    setProbing(true)
    try { await onProbe(health.name) } finally { setProbing(false) }
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-card">
        <Icon className={cn('h-4 w-4 shrink-0', cfg.class)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{health.name}</span>
            <Badge variant="outline" className="text-xs font-normal">{health.transport}</Badge>
            {health.needsAuth && (
              <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-400">{t('health.needsAuth')}</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{t(cfg.label)}{health.error && ` — ${health.error}`}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {health.handshakeMs != null && (
            <span className="text-xs text-muted-foreground">{health.handshakeMs}ms</span>
          )}
          {health.toolCount != null && (
            <Badge variant="secondary" className="text-xs">{health.toolCount} {t('health.tools')}</Badge>
          )}
          {api.isElectron() && health.state === 'pending-approval' ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleProbe} disabled={probing}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1', probing && 'animate-spin')} />
              {t('health.confirmProbe')}
            </Button>
          ) : api.isElectron() && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleProbe} disabled={probing}>
              <RefreshCw className={cn('h-3.5 w-3.5', probing && 'animate-spin')} />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Stats row */}
      {s.total > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/20 border-t flex-wrap">
          <StatPill label={t('health.stats.calls')} value={s.total} />
          {successRate !== null && (
            <StatPill
              label={t('health.stats.ok')}
              value={`${successRate}%`}
              className={successRate < 80 ? 'text-red-600' : 'text-green-600'}
            />
          )}
          {s.latencyMsP50 != null && <StatPill label={t('health.stats.p50')} value={`${Math.round(s.latencyMsP50)}ms`} />}
          {s.latencyMsP95 != null && <StatPill label={t('health.stats.p95')} value={`${Math.round(s.latencyMsP95)}ms`} />}
          {s.lastCallAt && (
            <span className="text-xs text-muted-foreground ml-auto">
              {t('health.stats.last')}: {new Date(s.lastCallAt).toLocaleString()}
              {s.lastCallOk != null && (
                <span className={cn('ml-1', s.lastCallOk ? 'text-green-600' : 'text-red-500')}>
                  {s.lastCallOk ? '✓' : '✗'}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Expanded: tool list + byTool stats */}
      {expanded && (
        <div className="border-t divide-y text-xs">
          {health.toolNames && health.toolNames.length > 0 && (
            <div className="px-4 py-3 space-y-1">
              <p className="text-muted-foreground font-medium mb-2">{t('health.toolList')}</p>
              <div className="flex flex-wrap gap-1">
                {health.toolNames.map((tn) => (
                  <Badge key={tn} variant="outline" className="font-mono text-[10px]">{tn}</Badge>
                ))}
              </div>
            </div>
          )}
          {Object.keys(s.byTool).length > 0 && (
            <div className="px-4 py-3">
              <p className="text-muted-foreground font-medium mb-2">{t('health.byTool')}</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="text-left font-normal pb-1">{t('health.cols.tool')}</th>
                    <th className="text-right font-normal pb-1">{t('health.cols.calls')}</th>
                    <th className="text-right font-normal pb-1">{t('health.cols.failed')}</th>
                    <th className="text-right font-normal pb-1">{t('health.cols.avgMs')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(s.byTool).map(([tool, stats]) => (
                    <tr key={tool} className="border-t border-border/50">
                      <td className="py-1 font-mono pr-4 max-w-[200px] truncate">{tool}</td>
                      <td className="text-right">{stats.total}</td>
                      <td className={cn('text-right', stats.failed > 0 && 'text-red-500')}>{stats.failed}</td>
                      <td className="text-right">{Math.round(stats.avgMs)}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {health.toolNames == null && Object.keys(s.byTool).length === 0 && (
            <div className="px-4 py-3 text-muted-foreground">{t('health.noDetail')}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function MCPHealthTab() {
  const { t } = useTranslation('mcp')
  const [healthList, setHealthList] = useState<MCPHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true)
    try {
      const results = await api.mcp.health()
      setHealthList(results)
    } catch (e) {
      console.error('[MCPHealth] load failed:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  async function handleProbe(name: string) {
    setProbeError(null)
    try {
      const result = await api.mcp.probe(name)
      setHealthList((prev) => prev.map((h) => h.name === name ? { ...result, callStats: h.callStats } : h))
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading) return <div className="py-12 text-center text-muted-foreground">{t('loading')}</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('health.desc')}</p>
        <Button size="sm" variant="outline" onClick={() => load()} disabled={refreshing}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', refreshing && 'animate-spin')} />
          {t('health.refresh')}
        </Button>
      </div>

      {!api.isElectron() && (
        <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground bg-muted/40">
          {t('health.probeDesktopOnly')}
        </div>
      )}
      {probeError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t('health.probeError', { error: probeError })}
        </div>
      )}

      {healthList.length === 0
        ? <div className="py-12 text-center text-muted-foreground">{t('empty')}</div>
        : healthList.map((h) => <ServerCard key={h.name} health={h} onProbe={handleProbe} />)
      }
    </div>
  )
}
