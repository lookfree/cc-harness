import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { api, HookEntry, HookExecutionLog, HookTestResult, HookDebugEntry } from '../../../lib/tauri'

const HOOK_TYPES = [
  'PreToolUse', 'PostToolUse', 'Notification', 'UserPromptSubmit',
  'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'SessionStart', 'SessionEnd',
]

const s = {
  container: { padding: 24, display: 'flex', gap: 24, height: '100%', overflow: 'hidden', color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  panel: { width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: 12 },
  main: { flex: 1, overflowY: 'auto' as const },
  heading: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 12, color: '#6b7280' },
  input: { width: '100%', boxSizing: 'border-box' as const, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px', color: '#e5e5e5', fontSize: 13 },
  textarea: { width: '100%', boxSizing: 'border-box' as const, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '8px 10px', color: '#e5e5e5', fontSize: 12, fontFamily: 'monospace', resize: 'vertical' as const, minHeight: 120 },
  list: { flex: 1, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 6 },
  item: (active: boolean) => ({ padding: '8px 12px', borderRadius: 6, border: `1px solid ${active ? '#3b82f6' : '#1f1f1f'}`, background: active ? '#1e3a5f' : '#141414', cursor: 'pointer', textAlign: 'left' as const, color: active ? '#3b82f6' : '#e5e5e5', fontSize: 13, fontWeight: active ? 600 : 400 }),
  card: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: 20, marginBottom: 16 },
  label: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 },
  badge: (color?: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: color ?? '#1f2937', color: '#9ca3af', fontSize: 11, border: '1px solid #374151' }),
  btn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnGhost: { padding: '6px 14px', background: 'transparent', color: '#a3a3a3', border: '1px solid #374151', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnDanger: { padding: '6px 14px', background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnSmall: { padding: '3px 10px', background: '#1e3a5f', color: '#3b82f6', border: '1px solid #3b82f6', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  selectStyle: { background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px', color: '#e5e5e5', fontSize: 13, width: '100%' },
}

export default function Hooks() {
  const [hooks, setHooks] = useState<HookEntry[]>([])
  const [selected, setSelected] = useState<HookEntry | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<HookExecutionLog[]>([])
  const [debugLogs, setDebugLogs] = useState<HookDebugEntry[]>([])
  const [activeTab, setActiveTab] = useState<'hooks' | 'logs' | 'debug'>('hooks')

  // New hook form
  const [hookType, setHookType] = useState('PreToolUse')
  const [hookCommand, setHookCommand] = useState('')
  const [matcher, setMatcher] = useState('')
  const [timeoutSecs, setTimeoutSecs] = useState('')
  const [scriptMode, setScriptMode] = useState(false)
  const [scriptContent, setScriptContent] = useState('#!/bin/bash\n# Hook script\n')
  const [location, setLocation] = useState<'user' | 'project'>('user')
  const [projectPath, setProjectPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Per-hook test
  const [testingHook, setTestingHook] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<HookTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  // Debug session
  const [debugPid, setDebugPid] = useState<number | null>(null)
  const [debugMsg, setDebugMsg] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.hooks.getAll()
      setHooks(data)
    } finally {
      setLoading(false)
    }
  }

  const loadLogs = async () => {
    const data = await api.hooks.getLogs()
    setLogs(data)
  }

  const loadDebugLogs = async () => {
    try {
      const data = await api.hooks.getDebugLogs()
      setDebugLogs(data)
    } catch {
      setDebugLogs([])
    }
  }

  useEffect(() => {
    load()
    loadLogs()
    loadDebugLogs()
    let unlisten: (() => void) | undefined
    listen('files:changed', load).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  const filtered = hooks.filter(h =>
    h.name.toLowerCase().includes(search.toLowerCase()) ||
    h.hook_type.toLowerCase().includes(search.toLowerCase()),
  )

  const handleBrowseProject = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected) setProjectPath(selected as string)
  }

  const handleSave = async () => {
    if (!scriptMode && !hookCommand.trim()) { setError('Command is required'); return }
    if (location === 'project' && !projectPath.trim()) { setError('Project path is required for project scope'); return }
    setSaving(true)
    setError(null)
    try {
      let finalCommand = hookCommand

      if (scriptMode) {
        // Create script file and use its path as command
        const scriptName = `hook_${hookType.toLowerCase()}_${Date.now()}.sh`
        const homeDir = location === 'project' ? projectPath : '~'
        const scriptPath = `${homeDir}/.claude/hooks/${scriptName}`
        const savedPath = await api.hooks.createScript(scriptPath, scriptContent)
        finalCommand = savedPath
      }

      const timeoutVal = timeoutSecs.trim() ? parseInt(timeoutSecs, 10) : undefined
      const hookConfig: Record<string, unknown> = {
        matcher: matcher || undefined,
        hooks: [{ type: 'command', command: finalCommand, ...(timeoutVal ? { timeout: timeoutVal } : {}) }],
      }
      await api.hooks.saveToSettings(
        hookType,
        hookConfig,
        location,
        undefined,
        location === 'project' ? projectPath : undefined,
      )
      setHookCommand('')
      setMatcher('')
      setTimeoutSecs('')
      setScriptContent('#!/bin/bash\n# Hook script\n')
      setScriptMode(false)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (hook: HookEntry) => {
    const idx = parseInt(hook.name.split('-').pop() ?? '0', 10)
    await api.hooks.deleteFromSettings(hook.hook_type, idx, 'user')
    setSelected(null)
    await load()
  }

  const handleTestHook = async (command: string) => {
    setTestingHook(command)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await api.hooks.testHook(command, timeoutSecs.trim() ? parseInt(timeoutSecs, 10) : undefined)
      setTestResult(result)
    } catch (e) {
      setTestError(String(e))
    } finally {
      setTestingHook(null)
    }
  }

  const handleLaunchDebug = async () => {
    setDebugMsg('Launching...')
    try {
      const res = await api.hooks.launchDebugSession(hookType)
      setDebugPid(res.pid ?? null)
      setDebugMsg(res.message)
    } catch (e) {
      setDebugMsg(String(e))
    }
  }

  const handleStopDebug = async () => {
    if (debugPid) {
      await api.hooks.stopDebugSession(debugPid)
      setDebugPid(null)
      setDebugMsg('Session stopped')
    }
  }

  const handleClearLogs = async () => {
    await api.hooks.clearLogs()
    setLogs([])
  }

  const statusColor = (status: string) => {
    if (status === 'success' || status === 'matched') return '#10b981'
    if (status === 'error' || status === 'failed') return '#ef4444'
    return '#f59e0b'
  }

  return (
    <div style={s.container}>
      {/* Left Panel */}
      <div style={s.panel}>
        <div>
          <div style={s.heading}>Hooks</div>
          <div style={s.sub}>Manage Claude Code hooks</div>
        </div>
        <input
          style={s.input}
          placeholder="Search hooks..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={s.sub}>{filtered.length} / {hooks.length} hooks</div>
        <div style={s.list}>
          {loading ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>No hooks configured</div>
          ) : filtered.map(hook => (
            <button
              key={hook.name}
              style={s.item(selected?.name === hook.name)}
              onClick={() => setSelected(hook)}
            >
              <div style={{ fontSize: 12 }}>{hook.hook_type}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{hook.name}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Main */}
      <div style={s.main}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #1f1f1f', paddingBottom: 8 }}>
          {(['hooks', 'logs', 'debug'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{ padding: '6px 16px', background: activeTab === tab ? '#1e3a5f' : 'transparent', color: activeTab === tab ? '#3b82f6' : '#a3a3a3', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tab ? 600 : 400, textTransform: 'capitalize' as const }}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'hooks' && (
          <>
            {/* Selected hook detail */}
            {selected && (
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <span style={s.badge()}>{selected.hook_type}</span>
                    <span style={{ marginLeft: 8, fontSize: 13, color: '#9ca3af' }}>{selected.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      style={s.btnSmall}
                      disabled={!!testingHook}
                      onClick={() => {
                        // Extract command from content if possible
                        let cmd = selected.content ?? ''
                        try {
                          const parsed = JSON.parse(cmd)
                          if (parsed?.hooks?.[0]?.command) cmd = parsed.hooks[0].command
                        } catch { /* use raw */ }
                        handleTestHook(cmd)
                      }}
                    >
                      {testingHook ? '测试中...' : '测试运行'}
                    </button>
                    <button style={s.btnDanger} onClick={() => handleDelete(selected)}>Delete</button>
                  </div>
                </div>
                {selected.content && (
                  <>
                    <div style={s.label}>Config</div>
                    <pre style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 6, padding: 12, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const }}>
                      {selected.content}
                    </pre>
                  </>
                )}
                {/* Test result panel */}
                {(testResult || testError) && (
                  <div style={{ marginTop: 12, background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 6, padding: 12 }}>
                    <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>测试结果</div>
                    {testError && <div style={{ color: '#ef4444', fontSize: 13 }}>{testError}</div>}
                    {testResult && (
                      <>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, background: (testResult.exit_code ?? 0) === 0 ? '#064e3b' : '#450a0a', color: (testResult.exit_code ?? 0) === 0 ? '#10b981' : '#ef4444', fontSize: 12, fontWeight: 600 }}>
                            exit {testResult.exit_code ?? 0}
                          </span>
                          <span style={{ fontSize: 12, color: '#6b7280' }}>{testResult.duration_ms}ms</span>
                          {testResult.timed_out && <span style={{ padding: '2px 8px', borderRadius: 4, background: '#451a03', color: '#f97316', fontSize: 12 }}>超时</span>}
                        </div>
                        {testResult.stdout && (
                          <div style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>stdout</div>
                            <pre style={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: 4, padding: '6px 10px', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, color: '#a3a3a3' }}>{testResult.stdout}</pre>
                          </div>
                        )}
                        {testResult.stderr && (
                          <div>
                            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>stderr</div>
                            <pre style={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: 4, padding: '6px 10px', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, color: '#ef4444' }}>{testResult.stderr}</pre>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* New hook form */}
            <div style={s.card}>
              <div style={s.label}>Add Hook</div>
              {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{error}</div>}
              <div style={s.row}>
                <span style={{ fontSize: 13, color: '#9ca3af', minWidth: 80 }}>Hook Type</span>
                <select style={s.selectStyle} value={hookType} onChange={e => setHookType(e.target.value)}>
                  {HOOK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={s.row}>
                <span style={{ fontSize: 13, color: '#9ca3af', minWidth: 80 }}>Matcher</span>
                <input style={s.input} value={matcher} onChange={e => setMatcher(e.target.value)} placeholder="Tool pattern (optional, e.g. Bash)" />
              </div>
              <div style={s.row}>
                <span style={{ fontSize: 13, color: '#9ca3af', minWidth: 80 }}>超时(秒)</span>
                <input
                  style={{ ...s.input, width: 100 }}
                  type="number"
                  min={1}
                  value={timeoutSecs}
                  onChange={e => setTimeoutSecs(e.target.value)}
                  placeholder="默认"
                />
              </div>
              {/* Script mode toggle */}
              <div style={{ ...s.row, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, color: '#9ca3af', minWidth: 80, paddingTop: 2 }}>脚本文件</span>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: scriptMode ? 8 : 0 }}>
                    <input type="checkbox" checked={scriptMode} onChange={e => setScriptMode(e.target.checked)} />
                    <span style={{ fontSize: 13, color: '#a3a3a3' }}>使用脚本文件模式</span>
                  </label>
                  {scriptMode && (
                    <textarea
                      style={s.textarea}
                      value={scriptContent}
                      onChange={e => setScriptContent(e.target.value)}
                      placeholder="#!/bin/bash&#10;# Script content"
                    />
                  )}
                </div>
              </div>
              {!scriptMode && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ ...s.label, marginBottom: 6 }}>Command</div>
                  <input style={s.input} value={hookCommand} onChange={e => setHookCommand(e.target.value)} placeholder="e.g. echo hook executed" />
                </div>
              )}
              {/* Scope selector */}
              <div style={s.row}>
                <span style={{ fontSize: 13, color: '#9ca3af', minWidth: 80 }}>作用域</span>
                <select style={{ ...s.selectStyle, width: 120 }} value={location} onChange={e => setLocation(e.target.value as 'user' | 'project')}>
                  <option value="user">用户全局</option>
                  <option value="project">项目</option>
                </select>
              </div>
              {location === 'project' && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ ...s.label, marginBottom: 6 }}>项目路径</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      style={{ ...s.input, flex: 1 }}
                      value={projectPath}
                      onChange={e => setProjectPath(e.target.value)}
                      placeholder="/path/to/project"
                    />
                    <button style={s.btnGhost} onClick={handleBrowseProject}>浏览…</button>
                  </div>
                </div>
              )}
              <button style={s.btn} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Add Hook'}
              </button>
            </div>
          </>
        )}

        {activeTab === 'logs' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={s.label}>Execution Logs ({logs.length})</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={s.btnGhost} onClick={loadLogs}>Refresh</button>
                <button style={s.btnGhost} onClick={handleClearLogs}>Clear</button>
              </div>
            </div>
            {logs.length === 0 ? (
              <div style={{ color: '#6b7280', fontSize: 13 }}>No logs yet</div>
            ) : logs.map(log => (
              <div key={log.id} style={{ padding: '8px 0', borderBottom: '1px solid #1f1f1f', fontSize: 13 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ color: log.success ? '#10b981' : '#ef4444', fontSize: 12 }}>
                    {log.success ? '✓' : '✗'}
                  </span>
                  <span style={{ color: '#9ca3af' }}>{log.hook_type}</span>
                  <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}>{log.command}</span>
                  <span style={{ color: '#6b7280', fontSize: 12 }}>{log.duration_ms}ms</span>
                </div>
                {log.stdout && <pre style={{ color: '#9ca3af', fontSize: 11, margin: '4px 0 0 20px', fontFamily: 'monospace' }}>{log.stdout}</pre>}
                {log.stderr && <pre style={{ color: '#ef4444', fontSize: 11, margin: '2px 0 0 20px', fontFamily: 'monospace' }}>{log.stderr}</pre>}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'debug' && (
          <>
            <div style={s.card}>
              <div style={s.label}>Debug Session</div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 8 }}>
                  Launch <code style={{ background: '#1f1f1f', padding: '1px 6px', borderRadius: 4 }}>claude --debug</code> in Terminal with the selected hook type trigger
                </div>
                <div style={s.row}>
                  <span style={{ fontSize: 13, color: '#9ca3af', minWidth: 80 }}>Hook Type</span>
                  <select style={s.selectStyle} value={hookType} onChange={e => setHookType(e.target.value)}>
                    {HOOK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button style={s.btn} onClick={handleLaunchDebug} disabled={!!debugPid}>
                  Launch Debug Session
                </button>
                {debugPid && (
                  <button style={s.btnDanger} onClick={handleStopDebug}>
                    Stop (PID {debugPid})
                  </button>
                )}
              </div>
              {debugMsg && (
                <div style={{ fontSize: 13, color: '#a3a3a3', padding: '8px 12px', background: '#0d0d0d', borderRadius: 6 }}>
                  {debugMsg}
                </div>
              )}
            </div>

            {/* Structured debug log entries */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={s.label}>调试日志 ({debugLogs.length})</div>
                <button style={s.btnGhost} onClick={loadDebugLogs}>刷新</button>
              </div>
              {debugLogs.length === 0 ? (
                <div style={{ color: '#6b7280', fontSize: 13 }}>暂无调试日志</div>
              ) : debugLogs.map((entry, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #1f1f1f', fontSize: 13 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ color: '#6b7280', fontSize: 11, fontFamily: 'monospace' }}>{entry.timestamp}</span>
                    <span style={{ padding: '1px 6px', borderRadius: 4, background: '#1f2937', color: '#3b82f6', fontSize: 11 }}>{entry.hook_type}</span>
                    <span style={{ padding: '1px 6px', borderRadius: 4, background: '#0d0d0d', color: statusColor(entry.status), fontSize: 11 }}>{entry.status}</span>
                    <span style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>{entry.file}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#a3a3a3', paddingLeft: 4 }}>{entry.message}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
