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
import type { UsageReport, UsageBucket } from '@shared/types'

interface Props {
  sessionId: string
  sessionFilePath: string
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

export function SessionUsage({ sessionId, sessionFilePath }: Props) {
  const { t } = useTranslation('sessions')
  const [report, setReport] = useState<UsageReport | null>(null)
  const [loading, setLoading] = useState(true)

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

  // 累计烧钱时间序列（必要时降采样到 ~400 点）
  const cumSeries = useMemo(() => {
    if (!report) return []
    let cum = 0
    const pts = report.breakdown.series.map((p, i) => {
      cum += p.costUsd
      return { i, cum: Math.round(cum * 100) / 100 }
    })
    if (pts.length <= 400) return pts
    const step = Math.ceil(pts.length / 400)
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
  }, [report])

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
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="bucket" cx="50%" cy="50%" outerRadius={70} label={(e) => `${t(`usage.bucket.${e.bucket}`)} ${usd(e.value)}`}>
                {pieData.map((d) => (
                  <Cell key={d.bucket} fill={BUCKET_COLOR[d.bucket]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => usd(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* 累计烧钱 */}
        <div className="border border-border rounded p-3">
          <div className="text-xs font-medium mb-1">{t('usage.spendTitle')}</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={cumSeries}>
              <XAxis dataKey="i" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip formatter={(v: number) => usd(v)} labelFormatter={(l) => t('usage.turnN', { n: l })} />
              <Area type="monotone" dataKey="cum" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

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
