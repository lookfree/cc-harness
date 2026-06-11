import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { api, SlashCommand } from '../../../lib/tauri'

const s = {
  container: { padding: 24, display: 'flex', gap: 24, height: '100%', overflow: 'hidden', color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  panel: { width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: 12 },
  main: { flex: 1, overflowY: 'auto' as const },
  heading: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 12, color: '#6b7280' },
  input: { width: '100%', boxSizing: 'border-box' as const, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px', color: '#e5e5e5', fontSize: 13 },
  textarea: { width: '100%', boxSizing: 'border-box' as const, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '8px 10px', color: '#e5e5e5', fontSize: 12, fontFamily: 'monospace', resize: 'vertical' as const, minHeight: 200 },
  list: { flex: 1, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 6 },
  item: (active: boolean) => ({ padding: '8px 12px', borderRadius: 6, border: `1px solid ${active ? '#3b82f6' : '#1f1f1f'}`, background: active ? '#1e3a5f' : '#141414', cursor: 'pointer', textAlign: 'left' as const, color: active ? '#3b82f6' : '#e5e5e5', fontSize: 13, fontWeight: active ? 600 : 400 }),
  card: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: 20, marginBottom: 16 },
  label: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 },
  badge: (color?: string) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: color ?? '#1f2937', color: '#9ca3af', fontSize: 11, border: '1px solid #374151' }),
  btn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnDanger: { padding: '6px 14px', background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnGhost: { padding: '6px 14px', background: 'transparent', color: '#a3a3a3', border: '1px solid #374151', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
}

export default function Commands() {
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [selected, setSelected] = useState<SlashCommand | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Project path selector
  const [projectPath, setProjectPath] = useState('')

  // New command modal state
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newContent, setNewContent] = useState('# New command\n')
  const [newDescError, setNewDescError] = useState<string | null>(null)
  const [newSaving, setNewSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.commands.getAll(projectPath.trim() || undefined)
      setCommands(data)
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

  // Reload when project path changes
  useEffect(() => {
    load()
  }, [projectPath])

  const filtered = commands.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description ?? '').toLowerCase().includes(search.toLowerCase()),
  )

  const handleSelect = (cmd: SlashCommand) => {
    setSelected(cmd)
    setEditContent(cmd.content)
    setEditing(false)
    setError(null)
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      await api.commands.save({ ...selected, content: editContent })
      await load()
      setEditing(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    await api.commands.delete(selected.name)
    setSelected(null)
    await load()
  }

  const handleBrowseProject = async () => {
    const sel = await open({ directory: true, multiple: false })
    if (sel) setProjectPath(sel as string)
  }

  const handleNewSubmit = async () => {
    if (!newName.trim()) { setNewDescError('Name is required'); return }
    if (!newDesc.trim()) { setNewDescError('Description is required'); return }
    setNewDescError(null)
    setNewSaving(true)
    try {
      const cmd: SlashCommand = {
        name: newName.trim(),
        description: newDesc.trim(),
        content: newContent,
        location: projectPath.trim() ? 'project' : 'user',
      }
      await api.commands.save(cmd)
      await load()
      setSelected(cmd)
      setEditContent(cmd.content)
      setEditing(false)
      setShowNew(false)
      setNewName('')
      setNewDesc('')
      setNewContent('# New command\n')
    } catch (e) {
      setNewDescError(String(e))
    } finally {
      setNewSaving(false)
    }
  }

  const locationBadgeColor = (loc: string) => {
    if (loc === 'project') return { background: '#064e3b', color: '#10b981', border: '1px solid #10b981' }
    return { background: '#1f2937', color: '#9ca3af', border: '1px solid #374151' }
  }

  return (
    <div style={s.container}>
      <div style={s.panel}>
        <div>
          <div style={s.heading}>Commands</div>
          <div style={s.sub}>Slash commands</div>
        </div>

        {/* Project path selector */}
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>项目路径</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ ...s.input, flex: 1, fontSize: 11, fontFamily: 'monospace' }}
              value={projectPath}
              onChange={e => setProjectPath(e.target.value)}
              placeholder="(user scope)"
            />
            <button
              style={{ ...s.btnGhost, padding: '4px 8px', fontSize: 11 }}
              onClick={handleBrowseProject}
              title="浏览项目目录"
            >
              浏览
            </button>
            {projectPath && (
              <button
                style={{ ...s.btnGhost, padding: '4px 8px', fontSize: 11 }}
                onClick={() => setProjectPath('')}
                title="清除"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <input
          style={s.input}
          placeholder="Search commands..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={s.sub}>{filtered.length} / {commands.length} commands</div>
        <div style={s.list}>
          {loading ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>No commands found</div>
          ) : filtered.map(cmd => (
            <button
              key={`${cmd.location}:${cmd.name}`}
              style={s.item(selected?.name === cmd.name && selected?.location === cmd.location)}
              onClick={() => handleSelect(cmd)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>/{cmd.name}</span>
                {cmd.rel_path && cmd.rel_path !== cmd.name + '.md' && (
                  <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>({cmd.rel_path})</span>
                )}
              </div>
              <span style={{ ...s.badge(undefined), ...locationBadgeColor(cmd.location), marginTop: 4, display: 'inline-block' }}>{cmd.location}</span>
            </button>
          ))}
        </div>
        <button style={s.btn} onClick={() => { setShowNew(true); setNewDescError(null) }}>+ New Command</button>
      </div>

      <div style={s.main}>
        {/* New command inline form */}
        {showNew && (
          <div style={s.card}>
            <div style={{ ...s.label, marginBottom: 12 }}>新建命令</div>
            {newDescError && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{newDescError}</div>}
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...s.label }}>命令名称</div>
              <input
                style={s.input}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="command-name (无斜杠)"
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ ...s.label }}>描述 <span style={{ color: '#ef4444' }}>*</span></div>
              <input
                style={s.input}
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Brief description of what this command does"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...s.label }}>内容</div>
              <textarea
                style={{ ...s.textarea, minHeight: 120 }}
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={s.btn} onClick={handleNewSubmit} disabled={newSaving}>
                {newSaving ? '保存中...' : '创建'}
              </button>
              <button style={s.btnGhost} onClick={() => setShowNew(false)}>取消</button>
            </div>
          </div>
        )}

        {selected ? (
          <>
            <div style={{ ...s.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>/{selected.name}</div>
                {selected.description && <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 4 }}>{selected.description}</div>}
                {selected.rel_path && (
                  <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', marginTop: 4 }}>{selected.rel_path}</div>
                )}
                <span style={{ ...s.badge(undefined), ...locationBadgeColor(selected.location), marginTop: 6, display: 'inline-block' }}>{selected.location}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {editing ? (
                  <>
                    <button style={s.btn} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                    <button style={s.btnGhost} onClick={() => { setEditing(false); setEditContent(selected.content) }}>Cancel</button>
                  </>
                ) : (
                  <button style={s.btnGhost} onClick={() => setEditing(true)}>Edit</button>
                )}
                <button style={s.btnDanger} onClick={handleDelete}>Delete</button>
              </div>
            </div>
            {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{error}</div>}
            <div style={s.card}>
              <div style={s.label}>Content</div>
              {editing ? (
                <textarea
                  style={s.textarea}
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                />
              ) : (
                <pre style={{ background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 6, padding: 16, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                  {selected.content}
                </pre>
              )}
            </div>
          </>
        ) : !showNew ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
            Select a command to view details
          </div>
        ) : null}
      </div>
    </div>
  )
}
