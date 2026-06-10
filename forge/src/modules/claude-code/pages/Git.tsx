import { useState, useEffect } from 'react'
import { api, GitStatus, BranchInfo, CommitInfo } from '../../../lib/tauri'
import { listen } from '@tauri-apps/api/event'

const s = {
  container: { padding: 24, maxWidth: 900, color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  heading: { fontSize: 18, fontWeight: 700, marginBottom: 16 },
  section: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: 16, marginBottom: 16 },
  label: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1 },
  btn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnGhost: { padding: '6px 14px', background: 'transparent', color: '#a3a3a3', border: '1px solid #374151', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  input: { flex: 1, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 12px', color: '#e5e5e5', fontSize: 13 },
}

export default function Git() {
  const [repoPath, setRepoPath] = useState('')
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [log, setLog] = useState<CommitInfo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [commitMsg, setCommitMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!repoPath) return
    setLoading(true)
    setError(null)
    try {
      const [s, b, l] = await Promise.all([
        api.git.getStatus(repoPath),
        api.git.getBranches(repoPath),
        api.git.getLog(repoPath, 20),
      ])
      setStatus(s)
      setBranches(b)
      setLog(l)
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
  }, [repoPath])

  const handleStage = async () => {
    await api.git.stage(repoPath, selected)
    await load()
    setSelected([])
  }

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    if (!status || status.staged.length === 0) {
      setError('没有已暂存的变更')
      return
    }
    try {
      await api.git.commit(repoPath, commitMsg)
      setCommitMsg('')
      setError(null)
      await load()
    } catch (e) {
      setError(String(e))
    }
  }

  const handlePush = async () => {
    await api.git.push(repoPath).catch(e => setError(String(e)))
    await load()
  }

  const handleCheckout = async (branch: string) => {
    await api.git.checkout(repoPath, branch)
    await load()
  }

  return (
    <div style={s.container}>
      <div style={s.heading}>Git</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input
          value={repoPath}
          onChange={e => setRepoPath(e.target.value)}
          placeholder="Repository path (e.g. ~/projects/myapp)"
          style={s.input}
        />
        <button style={s.btnGhost} onClick={load}>Refresh</button>
      </div>
      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: '#6b7280', marginBottom: 12 }}>Loading...</div>}
      {status && (
        <div style={s.section}>
          <div style={s.label}>Status</div>
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Branch: <strong>{status.branch}</strong>
            {status.ahead > 0 && <span style={{ marginLeft: 8, color: '#10b981' }}>↑{status.ahead}</span>}
            {status.behind > 0 && <span style={{ marginLeft: 8, color: '#f59e0b' }}>↓{status.behind}</span>}
          </div>
        </div>
      )}
      {status && (status.staged.length + status.unstaged.length + status.untracked.length > 0) && (
        <div style={s.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={s.label}>Changes</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={s.btnGhost} onClick={() => setSelected([...status.unstaged, ...status.untracked])}>Select All</button>
              <button style={s.btn} onClick={handleStage} disabled={selected.length === 0}>Stage Selected</button>
            </div>
          </div>
          {[
            ...status.staged.map(p => ({ p, state: 'S' })),
            ...status.unstaged.map(p => ({ p, state: 'M' })),
            ...status.untracked.map(p => ({ p, state: '?' })),
          ].map(({ p, state }) => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={selected.includes(p)}
                onChange={e => setSelected(prev => e.target.checked ? [...prev, p] : prev.filter(x => x !== p))}
              />
              <span style={{ color: state === '?' ? '#f59e0b' : state === 'S' ? '#10b981' : '#e5e5e5', fontFamily: 'monospace', fontSize: 12 }}>{state}</span>
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}
      <div style={s.section}>
        <div style={s.label}>Commit</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="Commit message"
            style={s.input}
            onKeyDown={e => e.key === 'Enter' && handleCommit()}
          />
          <button style={s.btn} onClick={handleCommit}>Commit</button>
          <button style={s.btnGhost} onClick={handlePush}>Push</button>
        </div>
      </div>
      {branches.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>Branches</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {branches.filter(b => !b.is_remote).map(b => (
              <button
                key={b.name}
                onClick={() => handleCheckout(b.name)}
                style={{ padding: '4px 12px', background: b.is_current ? '#1e3a5f' : '#1f1f1f', color: b.is_current ? '#3b82f6' : '#a3a3a3', border: `1px solid ${b.is_current ? '#3b82f6' : '#374151'}`, borderRadius: 20, fontSize: 13, cursor: 'pointer' }}
              >
                {b.name} {b.is_current && '✓'}
              </button>
            ))}
          </div>
        </div>
      )}
      {log.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>Recent Commits</div>
          {log.map(c => (
            <div key={c.hash} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #1f1f1f', fontSize: 13 }}>
              <span style={{ fontFamily: 'monospace', color: '#6b7280', fontSize: 12 }}>{c.short_hash}</span>
              <span style={{ flex: 1 }}>{c.message}</span>
              <span style={{ color: '#6b7280' }}>{c.author}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
