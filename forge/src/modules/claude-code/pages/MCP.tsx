import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api, McpServer } from '../../../lib/tauri'

const s = {
  container: { padding: 24, color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif', maxWidth: 900 },
  heading: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 12, color: '#6b7280', marginBottom: 20 },
  card: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: 20, marginBottom: 16 },
  label: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 },
  input: { width: '100%', boxSizing: 'border-box' as const, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px', color: '#e5e5e5', fontSize: 13 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: '#1f2937', color: '#9ca3af', fontSize: 11, border: '1px solid #374151' },
  btn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnDanger: { padding: '6px 14px', background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnGhost: { padding: '6px 14px', background: 'transparent', color: '#a3a3a3', border: '1px solid #374151', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
}

interface EnvRow { key: string; value: string }

function sourceBadge(source: string) {
  if (source === 'legacy') {
    return (
      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: '#451a03', color: '#f97316', fontSize: 11, border: '1px solid #ea580c' }}>
        legacy
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: '#1e3a5f', color: '#3b82f6', fontSize: 11, border: '1px solid #3b82f6' }}>
      settings
    </span>
  )
}

export default function MCP() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [expandedServer, setExpandedServer] = useState<string | null>(null)

  // Add form
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newArgs, setNewArgs] = useState('')
  const [envRows, setEnvRows] = useState<EnvRow[]>([])
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.mcp.getAll()
      setServers(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    let unlisten: (() => void) | undefined
    listen('files:changed', load).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  const handleDelete = async (name: string) => {
    await api.mcp.delete(name)
    await load()
  }

  const handleTest = async (name: string) => {
    const ok = await api.mcp.testConnection(name)
    alert(ok ? `${name}: reachable` : `${name}: not reachable`)
  }

  const addEnvRow = () => setEnvRows(r => [...r, { key: '', value: '' }])
  const removeEnvRow = (i: number) => setEnvRows(r => r.filter((_, idx) => idx !== i))
  const updateEnvRow = (i: number, field: 'key' | 'value', val: string) =>
    setEnvRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row))

  const handleAdd = async () => {
    if (!newName.trim() || !newCommand.trim()) { setError('Name and command are required'); return }
    setSaving(true)
    setError(null)
    try {
      const args = newArgs.trim() ? newArgs.split(',').map(a => a.trim()) : []
      const env: Record<string, string> = {}
      for (const row of envRows) {
        if (row.key.trim()) env[row.key.trim()] = row.value
      }
      const config: Record<string, unknown> = { command: newCommand, args }
      if (Object.keys(env).length > 0) config.env = env
      await api.mcp.save(newName, config)
      setNewName(''); setNewCommand(''); setNewArgs(''); setEnvRows([])
      setShowAdd(false)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={s.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <div style={s.heading}>MCP Servers</div>
          <div style={s.sub}>Manage Model Context Protocol servers</div>
        </div>
        <button style={s.btn} onClick={() => setShowAdd(!showAdd)}>+ Add Server</button>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {showAdd && (
        <div style={s.card}>
          <div style={s.label}>New MCP Server</div>
          <div style={s.row}>
            <span style={{ minWidth: 80, fontSize: 13, color: '#9ca3af' }}>Name</span>
            <input style={s.input} value={newName} onChange={e => setNewName(e.target.value)} placeholder="my-mcp-server" />
          </div>
          <div style={s.row}>
            <span style={{ minWidth: 80, fontSize: 13, color: '#9ca3af' }}>Command</span>
            <input style={s.input} value={newCommand} onChange={e => setNewCommand(e.target.value)} placeholder="npx" />
          </div>
          <div style={s.row}>
            <span style={{ minWidth: 80, fontSize: 13, color: '#9ca3af' }}>Args</span>
            <input style={s.input} value={newArgs} onChange={e => setNewArgs(e.target.value)} placeholder="-y, @my/mcp-server (comma-separated)" />
          </div>

          {/* Env key-value rows */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>环境变量</span>
              <button style={{ ...s.btnGhost, padding: '2px 8px', fontSize: 11 }} onClick={addEnvRow}>+ 添加</button>
            </div>
            {envRows.map((row, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input
                  style={{ ...s.input, flex: 1 }}
                  value={row.key}
                  onChange={e => updateEnvRow(i, 'key', e.target.value)}
                  placeholder="KEY"
                />
                <span style={{ color: '#6b7280' }}>=</span>
                <input
                  style={{ ...s.input, flex: 2 }}
                  value={row.value}
                  onChange={e => updateEnvRow(i, 'value', e.target.value)}
                  placeholder="value"
                />
                <button style={{ ...s.btnDanger, padding: '3px 8px', fontSize: 12 }} onClick={() => removeEnvRow(i)}>✕</button>
              </div>
            ))}
          </div>

          <button style={s.btn} onClick={handleAdd} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
      ) : servers.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          No MCP servers configured
        </div>
      ) : servers.map(srv => {
        const cfg = srv.config as Record<string, unknown>
        const cfgDesc = cfg.description ? String(cfg.description) : ''
        const isExpanded = expandedServer === srv.name
        const alwaysAllow = Array.isArray(cfg.alwaysAllow) ? (cfg.alwaysAllow as string[]) : []
        const timeout = cfg.timeout != null ? cfg.timeout : null
        const envVars = cfg.env && typeof cfg.env === 'object' ? (cfg.env as Record<string, string>) : null

        return (
          <div key={srv.name} style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{srv.name}</div>
                  {sourceBadge(srv.source)}
                </div>
                {cfgDesc && (
                  <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{cfgDesc}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={s.btnGhost} onClick={() => setExpandedServer(isExpanded ? null : srv.name)}>
                  {isExpanded ? '收起' : '详情'}
                </button>
                <button style={s.btnGhost} onClick={() => handleTest(srv.name)}>Test</button>
                <button style={s.btnDanger} onClick={() => handleDelete(srv.name)}>Delete</button>
              </div>
            </div>
            <div style={{ fontSize: 12 }}>
              {!!cfg.command && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: '#6b7280' }}>Command: </span>
                  <code style={{ background: '#1f1f1f', padding: '1px 6px', borderRadius: 4 }}>{String(cfg.command)}</code>
                </div>
              )}
              {Array.isArray(cfg.args) && cfg.args.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: '#6b7280' }}>Args: </span>
                  {(cfg.args as string[]).map((a, i) => (
                    <code key={i} style={{ background: '#1f1f1f', padding: '1px 6px', borderRadius: 4, marginRight: 4 }}>{a}</code>
                  ))}
                </div>
              )}
              {!!cfg.disabled && <span style={s.badge}>Disabled</span>}
            </div>

            {/* Detail panel */}
            {isExpanded && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #1f1f1f' }}>
                {alwaysAllow.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={s.label}>alwaysAllow</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {alwaysAllow.map(perm => (
                        <span key={perm} style={{ padding: '2px 8px', borderRadius: 4, background: '#064e3b', color: '#10b981', fontSize: 11, border: '1px solid #10b981' }}>{perm}</span>
                      ))}
                    </div>
                  </div>
                )}
                {timeout != null && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={s.label}>Timeout</div>
                    <span style={{ fontSize: 13, color: '#9ca3af' }}>{String(timeout)}ms</span>
                  </div>
                )}
                {envVars && Object.keys(envVars).length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={s.label}>环境变量</div>
                    {Object.entries(envVars).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', gap: 8, fontSize: 12, marginBottom: 4, fontFamily: 'monospace' }}>
                        <span style={{ color: '#3b82f6' }}>{k}</span>
                        <span style={{ color: '#6b7280' }}>=</span>
                        <span style={{ color: '#a3a3a3' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={s.label}>完整配置</div>
                <pre style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 6, padding: 10, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, color: '#9ca3af' }}>
                  {JSON.stringify(cfg, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
