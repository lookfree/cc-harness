// forge/src/modules/dashboard/pages/Dashboard.tsx
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { api, DashboardSummary, DailyUsage, RunningTool } from '../../../lib/tauri'

const s = {
  container: { padding: 24, color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif', height: '100%', overflow: 'auto' as const },
  heading: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
  sectionHead: { fontSize: 13, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 10, marginTop: 24 },
  cardRow: { display: 'flex', gap: 12, marginBottom: 4 },
  card: { flex: 1, background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: '14px 16px' },
  cardLabel: { fontSize: 11, color: '#6b7280', marginBottom: 6 },
  cardVal: { fontSize: 22, fontWeight: 700, color: '#e5e5e5' },
  cardSub: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '6px 10px', color: '#6b7280', borderBottom: '1px solid #1f1f1f', fontWeight: 500 },
  td: { padding: '8px 10px', borderBottom: '1px solid #1a1a1a', color: '#a3a3a3', verticalAlign: 'middle' as const },
  dot: (c: string) => ({ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: c, marginRight: 6 }),
  refreshBtn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, marginBottom: 20 },
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

function fmtCost(usd: number): string {
  return usd > 0 ? `$${usd.toFixed(3)}` : '$0.000'
}

function fmtTs(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [daily, setDaily] = useState<DailyUsage[]>([])
  const [running, setRunning] = useState<RunningTool[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [sumData, dailyData, runData] = await Promise.all([
        api.usage.getDashboard(),
        api.usage.getDailyUsage(30),
        api.usage.getRunningTools(),
      ])
      setSummary(sumData)
      setDaily(dailyData)
      setRunning(runData)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setSyncing(true)
    try {
      await api.usage.sync()
      await load()
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    load()
    // Listen for tools:status event (5s polling from Rust)
    let unlisten: (() => void) | undefined
    listen<RunningTool[]>('tools:status', ({ payload }) => {
      setRunning(payload)
    }).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  // Chart data: map DailyUsage to recharts format
  const chartData = daily.map(d => ({
    date: d.date.slice(5), // "MM-DD"
    'Claude Code': Math.round(d.claude_tokens / 1000),
    'Codex CLI':   Math.round(d.codex_tokens / 1000),
  }))

  return (
    <div style={s.container}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={s.heading}>Dashboard</div>
        <button style={s.refreshBtn} onClick={handleRefresh} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {/* Today's totals */}
      <div style={s.sectionHead}>今日</div>
      {summary ? (
        <div style={s.cardRow}>
          <div style={s.card}>
            <div style={s.cardLabel}>总 Token</div>
            <div style={s.cardVal}>{fmtTokens(summary.today_input_tokens + summary.today_output_tokens)}</div>
            <div style={s.cardSub}>输入 {fmtTokens(summary.today_input_tokens)} · 输出 {fmtTokens(summary.today_output_tokens)}</div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>预估费用</div>
            <div style={s.cardVal}>{fmtCost(summary.today_cost_usd)}</div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>Claude Code</div>
            <div style={s.cardVal}>{fmtTokens(summary.claude_today_tokens)}</div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>Codex CLI</div>
            <div style={s.cardVal}>{fmtTokens(summary.codex_today_tokens)}</div>
          </div>
        </div>
      ) : loading ? (
        <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
      ) : null}

      {/* 30-day chart */}
      <div style={s.sectionHead}>30 天 Token 用量（k）</div>
      <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: '16px 8px', marginBottom: 4 }}>
        {chartData.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 12, padding: '20px', textAlign: 'center' as const }}>暂无历史数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
              <Tooltip
                contentStyle={{ background: '#141414', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#e5e5e5' }}
                itemStyle={{ color: '#a3a3a3' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
              <Bar dataKey="Claude Code" stackId="a" fill="#3b82f6" radius={[0,0,0,0]} />
              <Bar dataKey="Codex CLI"   stackId="a" fill="#10b981" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Running tools */}
      <div style={s.sectionHead}>工具运行状态</div>
      <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: '12px 16px', marginBottom: 4 }}>
        {(['claude-code', 'codex-cli'] as const).map(toolId => {
          const procs = running.filter(r => r.tool === toolId)
          const isRunning = procs.length > 0
          return (
            <div key={toolId} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
              <span style={s.dot(isRunning ? '#22c55e' : '#4b5563')} />
              <span style={{ fontSize: 13, color: '#e5e5e5', width: 120 }}>
                {toolId === 'claude-code' ? 'Claude Code' : 'Codex CLI'}
              </span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {isRunning
                  ? procs.map(p => `PID ${p.pid}${p.working_dir ? `  ${p.working_dir}` : ''}`).join(' | ')
                  : '空闲'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Recent sessions */}
      <div style={s.sectionHead}>最近会话（全部工具）</div>
      <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, overflow: 'hidden' as const }}>
        {summary && summary.recent_sessions.length > 0 ? (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>工具</th>
                <th style={s.th}>目录</th>
                <th style={s.th}>时间</th>
                <th style={s.th}>Token</th>
                <th style={s.th}>费用</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent_sessions.map(sess => (
                <tr key={sess.id}>
                  <td style={s.td}>
                    <span style={{ ...s.dot(sess.tool === 'claude-code' ? '#3b82f6' : '#10b981') }} />
                    {sess.tool === 'claude-code' ? 'Claude Code' : 'Codex CLI'}
                  </td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>
                    {sess.working_dir?.replace(/.*\//, '~/.../')?.slice(0, 40) || '—'}
                  </td>
                  <td style={s.td}>{fmtTs(sess.started_at)}</td>
                  <td style={s.td}>{fmtTokens(sess.input_tokens + sess.output_tokens)}</td>
                  <td style={s.td}>{fmtCost(sess.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ color: '#6b7280', fontSize: 12, padding: 16 }}>暂无会话</div>
        )}
      </div>

      {/* Original env detection table (kept at bottom) */}
      <div style={s.sectionHead}>环境检测</div>
      <EnvTable />
    </div>
  )
}

// Keep existing env detection inline
function EnvTable() {
  const [tools, setTools] = useState<{ name: string; installed: boolean; path: string | null; version: string | null }[]>([])
  useEffect(() => {
    invoke<typeof tools>('detect_tools').then(setTools).catch(() => {})
  }, [])
  return (
    <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, overflow: 'hidden' as const }}>
      <table style={s.table}>
        <tbody>
          {tools.map(t => (
            <tr key={t.name} style={{ borderBottom: '1px solid #1a1a1a' }}>
              <td style={{ ...s.td, display: 'flex', alignItems: 'center' }}>
                <span style={s.dot(t.installed ? '#22c55e' : '#6b7280')} />
                {t.name}
              </td>
              <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>{t.path ?? 'not installed'}</td>
              <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>{t.version ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
