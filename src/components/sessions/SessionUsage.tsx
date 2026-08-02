import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { compactNum } from './sessionStatus'
import { estimateCostUsd } from '@shared/data/model-pricing'
import { Button } from '@/components/ui/button'
import type { UsageReport, UsageBucket } from '@shared/types'

interface Props {
  sessionId: string
  sessionFilePath: string
  /** 下钻跳 Replay（spec026）；不传则纯展示 */
  onSeek?: (seq: number) => void
  /** subagents bucket 无主会话 seq，改跳拓扑页签 */
  onOpenTopology?: () => void
}

const BUCKETS: UsageBucket[] = ['base', 'skills', 'subagents', 'mcp', 'plugins']
const BUCKET_COLOR: Record<UsageBucket, string> = {
  base: '#64748b',
  skills: '#0ea5e9',
  subagents: '#8b5cf6',
  mcp: '#f59e0b',
  plugins: '#10b981',
}

const usd = (x: number | undefined) => `$${(x ?? 0).toFixed(2)}`
const ADVICE_SEV: Record<string, string> = {
  warn: 'border-red-500/40 bg-red-500/5',
  suggest: 'border-amber-500/40 bg-amber-500/5',
  info: 'border-border bg-muted/30',
}

export function SessionUsage({ sessionId, sessionFilePath, onSeek, onOpenTopology }: Props) {
  const { t } = useTranslation('sessions')
  const [report, setReport] = useState<UsageReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [drillBucket, setDrillBucket] = useState<UsageBucket | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.session
      .usage(sessionId, sessionFilePath)
      .then((r) => alive && setReport(r))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [sessionId, sessionFilePath])

  // 成本饼图（按 bucket 估算成本——比 token 数有意义，避开 cacheRead 失真）
  const pieData = useMemo(
    () =>
      report
        ? BUCKETS.map((b) => ({ bucket: b, value: report.breakdown.byBucket[b].estimatedCostUsd ?? 0 })).filter(
            (d) => d.value > 0
          )
        : [],
    [report]
  )

  // 累计烧钱时间序列（必要时降采样到 ~400 点）；seq 透传供点击下钻（spec026）
  const cumSeries = useMemo(() => {
    if (!report) return []
    let cum = 0
    const pts = report.breakdown.series.map((p, i) => {
      cum += p.costUsd
      return { i, cum: Math.round(cum * 100) / 100, seq: p.seq }
    })
    if (pts.length <= 400) return pts
    const step = Math.ceil(pts.length / 400)
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
  }, [report])

  // 下钻榜单：当前 bucket 最贵 Top-10 turn（spec026）
  const topTurns = useMemo(() => {
    if (!report || !drillBucket) return []
    return report.breakdown.series
      .filter((p) => p.bucket === drillBucket)
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 10)
  }, [report, drillBucket])

  if (loading) return <div className="p-4 text-sm text-muted-foreground">{t('usage.loading')}</div>
  if (!report || report.breakdown.turnCount === 0) {
    return <div className="p-4 text-sm text-muted-foreground">{t('usage.empty')}</div>
  }

  const b = report.breakdown
  const total = b.total
  const models = Object.entries(total.byModel ?? {})

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label={t('usage.cost')} value={usd(total.estimatedCostUsd)} hint={t('usage.estimated', { date: report.pricingUpdated })} />
        <Kpi label={t('usage.output')} value={compactNum(total.outputTokens)} />
        <Kpi label={t('usage.cacheRead')} value={compactNum(total.cacheReadInputTokens)} hint={t('usage.cacheNote')} />
        <Kpi label={t('usage.turns')} value={String(b.turnCount)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 成本饼图 */}
        <div className="border border-border rounded p-3">
          <div className="text-xs font-medium mb-1">{t('usage.pieTitle')}</div>
          <ResponsiveContainer width="100%" height={168}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="bucket"
                cx="50%"
                cy="50%"
                outerRadius={70}
                cursor="pointer"
                onClick={(_, idx) => {
                  const b = pieData[idx]?.bucket
                  if (b) setDrillBucket((prev) => (prev === b ? null : b))
                }}
              >
                {pieData.map((d) => (
                  <Cell key={d.bucket} fill={BUCKET_COLOR[d.bucket]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => usd(v)} />
            </PieChart>
          </ResponsiveContainer>
          {/* 图例代替扇区外挂标签：卡片只有半栏宽，外挂标签必被裁 */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            {pieData.map((d) => (
              <button
                key={d.bucket}
                onClick={() => setDrillBucket((prev) => (prev === d.bucket ? null : d.bucket))}
                className={cn(
                  'flex items-center gap-1 text-[11px] rounded px-1 hover:bg-muted/50',
                  drillBucket === d.bucket && 'bg-muted'
                )}
              >
                <span className="w-2 h-2 rounded-sm" style={{ background: BUCKET_COLOR[d.bucket] }} />
                {t(`usage.bucket.${d.bucket}`)}
                <span className="text-muted-foreground">{usd(d.value)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 累计烧钱 */}
        <div className="border border-border rounded p-3">
          <div className="text-xs font-medium mb-1">{t('usage.spendTitle')}</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart
              data={cumSeries}
              onClick={(st) => {
                const seq = (st?.activePayload?.[0]?.payload as { seq?: number } | undefined)?.seq
                if (seq != null && onSeek) onSeek(seq)
              }}
            >
              <XAxis dataKey="i" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip formatter={(v: number) => usd(v)} labelFormatter={(l) => t('usage.turnN', { n: l })} />
              <Area type="monotone" dataKey="cum" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 下钻榜单：bucket 最贵 turns → 点行跳 Replay（spec026） */}
      {drillBucket && (
        <div className="border border-border rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium flex items-center gap-2">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: BUCKET_COLOR[drillBucket] }} />
              {t('usage.drill.title', { bucket: t(`usage.bucket.${drillBucket}`) })}
            </div>
            {drillBucket === 'subagents' && onOpenTopology && (
              <Button variant="outline" size="sm" onClick={onOpenTopology}>
                {t('usage.drill.viewInTopology')}
              </Button>
            )}
          </div>
          {topTurns.length === 0 ? (
            <div className="text-xs text-muted-foreground">{t('usage.drill.empty')}</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1">{t('usage.drill.col.turn')}</th>
                  <th>{t('usage.drill.col.time')}</th>
                  <th>{t('usage.model')}</th>
                  <th>{t('usage.drill.col.output')}</th>
                  <th>{t('usage.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {topTurns.map((p, i) => {
                  const clickable = p.seq != null && !!onSeek
                  return (
                    <tr
                      key={`${p.seq ?? p.ts}-${i}`}
                      className={cn('border-t border-border/40', clickable && 'cursor-pointer hover:bg-muted/40')}
                      onClick={clickable ? () => onSeek?.(p.seq as number) : undefined}
                    >
                      <td className="py-1 font-mono">{p.seq != null ? `#${p.seq}` : '–'}</td>
                      <td>{p.ts ? new Date(p.ts).toLocaleTimeString() : '–'}</td>
                      <td className="font-mono">{p.model || '–'}</td>
                      <td>{compactNum(p.output)}</td>
                      <td>{usd(p.costUsd)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {drillBucket !== 'subagents' && onSeek && (
            <p className="text-[10px] text-muted-foreground mt-1">{t('usage.drill.clickHint')}</p>
          )}
        </div>
      )}

      {/* 按 model 表 */}
      <div className="border border-border rounded p-3">
        <div className="text-xs font-medium mb-2">{t('usage.modelTable')}</div>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1">{t('usage.model')}</th>
              <th>{t('usage.col.in')}</th>
              <th>{t('usage.col.out')}</th>
              <th>{t('usage.col.cacheRead')}</th>
              <th>{t('usage.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {models.map(([m, u]) => (
              <tr key={m} className="border-t border-border/40">
                <td className="py-1 font-mono">{m}</td>
                <td>{compactNum(u.inputTokens)}</td>
                <td>{compactNum(u.outputTokens)}</td>
                <td>{compactNum(u.cacheReadInputTokens)}</td>
                <td>{usd(estimateCostUsd(u, m) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ECC 建议 */}
      {report.advice.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium">{t('usage.adviceTitle')}</div>
          {report.advice.map((a) => (
            <div key={a.id} className={cn('rounded border px-3 py-2', ADVICE_SEV[a.severity])}>
              <div className="text-sm font-medium">{t(`advice.${a.id}.title`, a.params)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{t(`advice.${a.id}.detail`, a.params)}</div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">{t('usage.estimated', { date: report.pricingUpdated })}</p>
    </div>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border rounded px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground truncate">{hint}</div>}
    </div>
  )
}
