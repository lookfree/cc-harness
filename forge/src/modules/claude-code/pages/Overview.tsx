import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { api, DashboardSummary, ProjectRow } from '../../../lib/tauri'
import { launchStore } from '../../../lib/launchStore'

const S = {
  page: { padding: 24 },
  heading: { fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#e5e5e5' },
  card: {
    background: '#141414',
    border: '1px solid #262626',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 10 },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13, color: '#e5e5e5' },
  label: { color: '#6b7280', minWidth: 110, fontSize: 12 },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#a3a3a3' },
  dot: (ok: boolean) => ({ color: ok ? '#22c55e' : '#ef4444', marginRight: 4 }),
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: '#1a3a2f', color: '#fff' },
  installGuide: {
    background: '#450a0a',
    border: '1px solid #b91c1c',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    color: '#fca5a5',
    fontSize: 13,
  },
  btn: {
    padding: '5px 12px',
    borderRadius: 4,
    border: '1px solid #374151',
    background: '#3b82f6',
    color: '#fff',
    fontSize: 12,
    cursor: 'pointer',
    marginRight: 8,
  },
  btnSec: {
    padding: '5px 12px',
    borderRadius: 4,
    border: '1px solid #374151',
    background: 'transparent',
    color: '#a3a3a3',
    fontSize: 12,
    cursor: 'pointer',
    marginRight: 8,
  },
  table: { borderCollapse: 'collapse' as const, width: '100%' },
  th: { padding: '6px 10px', textAlign: 'left' as const, fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1, borderBottom: '1px solid #262626' },
  td: { padding: '8px 10px', fontSize: 13, color: '#e5e5e5', borderBottom: '1px solid #1f1f1f' },
  tdMono: { padding: '8px 10px', fontSize: 11, fontFamily: 'monospace', color: '#a3a3a3', borderBottom: '1px solid #1f1f1f' },
}

interface ToolStatus {
  name: string
  installed: boolean
  path: string | null
  version: string | null
}

interface Props {
  onNavigate?: (id: string) => void
}

export default function ClaudeCodeOverview({ onNavigate }: Props) {
  const [claudeStatus, setClaudeStatus] = useState<ToolStatus | null>(null)
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null)
  const [pinnedProjects, setPinnedProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      invoke<ToolStatus[]>('detect_tools').then(tools => tools.find(t => t.name === 'claude') ?? null),
      api.usage.getDashboard(),
      api.usage.getProjects('claude-code'),
    ])
      .then(([status, dash, projs]) => {
        setClaudeStatus(status)
        setDashboard(dash)
        setPinnedProjects(projs.filter((p) => p.pinned))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ ...S.page, color: '#6b7280' }}>加载中…</div>

  return (
    <div style={S.page}>
      <h1 style={S.heading}>Claude Code — Overview</h1>

      {/* 安装状态卡片 */}
      {claudeStatus && !claudeStatus.installed && (
        <div style={S.installGuide}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>⚠ Claude Code 未安装</div>
          <div style={{ marginBottom: 8 }}>请先安装 Claude Code，然后重启 Forge 以刷新状态。</div>
          <div style={{ fontFamily: 'monospace', background: '#1a0a0a', padding: '8px 12px', borderRadius: 4, fontSize: 12 }}>
            npm install -g @anthropic-ai/claude-code
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>
            安装后运行 <code>claude --version</code> 确认安装成功。
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={S.cardTitle}>工具状态</div>
        {claudeStatus && (
          <>
            <div style={S.row}>
              <span style={S.label}>安装状态</span>
              <span style={S.dot(claudeStatus.installed)}>{claudeStatus.installed ? '●' : '●'}</span>
              <span>{claudeStatus.installed ? '已安装' : '未安装'}</span>
              {claudeStatus.version && <span style={{ ...S.badge, marginLeft: 8 }}>{claudeStatus.version}</span>}
            </div>
            {claudeStatus.path && (
              <div style={S.row}>
                <span style={S.label}>路径</span>
                <span style={S.mono}>{claudeStatus.path}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* 今日用量卡片 */}
      <div style={S.card}>
        <div style={S.cardTitle}>今日用量</div>
        <div style={S.row}>
          <span style={S.label}>Token 用量</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#3b82f6' }}>
            {dashboard ? (dashboard.claude_today_tokens / 1000).toFixed(1) + 'k' : '—'}
          </span>
        </div>
      </div>

      {/* 固定项目快捷启动 */}
      {pinnedProjects.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>固定项目</div>
          <table style={S.table}>
            <thead>
              <tr>
                {['目录', '会话数', '操作'].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pinnedProjects.map((p) => (
                <tr key={p.directory}>
                  <td style={S.tdMono}>{p.directory}</td>
                  <td style={S.td}>{p.session_count}</td>
                  <td style={S.td}>
                    <button
                      style={S.btn}
                      onClick={() => {
                        launchStore.set({ tool: 'claude-code', workingDir: p.directory })
                        onNavigate?.('runner')
                      }}
                      title={`在 Runner 中启动 claude-code（目录: ${p.directory}）`}
                    >
                      在 Runner 启动
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 快捷导航 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button style={S.btn} onClick={() => onNavigate?.('cc_sessions')}>查看 Sessions</button>
        <button style={S.btn} onClick={() => onNavigate?.('cc_projects')}>查看 Projects</button>
        <button style={S.btnSec} onClick={() => onNavigate?.('cc_environment')}>环境配置</button>
      </div>
    </div>
  )
}
