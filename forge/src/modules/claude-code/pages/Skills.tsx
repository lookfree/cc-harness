import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api, Skill } from '../../../lib/tauri'

const s = {
  container: { padding: 24, display: 'flex', gap: 24, height: '100%', overflow: 'hidden', color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  panel: { width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: 12 },
  main: { flex: 1, overflowY: 'auto' as const },
  heading: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 12, color: '#6b7280' },
  input: { width: '100%', boxSizing: 'border-box' as const, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px', color: '#e5e5e5', fontSize: 13 },
  list: { flex: 1, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 6 },
  item: (active: boolean) => ({ padding: '8px 12px', borderRadius: 6, border: `1px solid ${active ? '#3b82f6' : '#1f1f1f'}`, background: active ? '#1e3a5f' : '#141414', cursor: 'pointer', textAlign: 'left' as const, color: active ? '#3b82f6' : '#e5e5e5', fontSize: 13, fontWeight: active ? 600 : 400 }),
  card: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: 20, marginBottom: 16 },
  label: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 8 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: '#1f2937', color: '#9ca3af', fontSize: 11, border: '1px solid #374151' },
  pre: { background: '#0d0d0d', border: '1px solid #1f1f1f', borderRadius: 6, padding: 16, overflowX: 'auto' as const, fontSize: 12, fontFamily: 'monospace', lineHeight: 1.6, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const },
  btn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
}

interface FrontmatterMeta {
  author?: string
  version?: string
  'allowed-tools'?: string | string[]
  license?: string
  [key: string]: unknown
}

/** Parse YAML-ish frontmatter from ---\n...\n--- blocks. Returns parsed key-values. */
function parseFrontmatter(content: string): FrontmatterMeta | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  const block = match[1]
  const result: FrontmatterMeta = {}
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim()
    if (!key) continue
    // Handle simple list values like `- item`
    if (val === '' && block.includes(`${key}:\n`)) {
      // multi-line list — skip for now, handled below
      continue
    }
    // Strip quotes
    result[key] = val.replace(/^['"]|['"]$/g, '')
  }
  // Handle allowed-tools as array if value contains commas
  if (typeof result['allowed-tools'] === 'string' && (result['allowed-tools'] as string).includes(',')) {
    result['allowed-tools'] = (result['allowed-tools'] as string).split(',').map(s => s.trim())
  }
  return Object.keys(result).length > 0 ? result : null
}

const META_KEYS: Array<keyof FrontmatterMeta> = ['author', 'version', 'allowed-tools', 'license']

export default function Skills() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [selected, setSelected] = useState<Skill | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.skills.getAll()
      setSkills(data)
      if (data.length > 0 && !selected) setSelected(data[0])
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

  const filtered = skills.filter(sk =>
    sk.name.toLowerCase().includes(search.toLowerCase()) ||
    sk.description.toLowerCase().includes(search.toLowerCase()),
  )

  const meta = selected?.content ? parseFrontmatter(selected.content) : null
  const hasMeta = meta && META_KEYS.some(k => meta[k] != null)

  return (
    <div style={s.container}>
      <div style={s.panel}>
        <div>
          <div style={s.heading}>Skills</div>
          <div style={s.sub}>Browse and manage Claude skills</div>
        </div>
        <input
          style={s.input}
          placeholder="Search skills..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={s.sub}>{filtered.length} / {skills.length} skills</div>
        <div style={s.list}>
          {loading ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>No skills found</div>
          ) : filtered.map(skill => (
            <button
              key={skill.name}
              style={s.item(selected?.name === skill.name)}
              onClick={() => setSelected(skill)}
            >
              <div>{skill.name}</div>
              <span style={s.badge}>{skill.location}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={s.main}>
        {selected ? (
          <>
            <div style={{ ...s.card, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{selected.name}</div>
                <div style={{ color: '#9ca3af', marginTop: 4, fontSize: 14 }}>{selected.description}</div>
              </div>
              <span style={s.badge}>{selected.location}</span>
            </div>

            {/* Frontmatter metadata panel */}
            {hasMeta && (
              <div style={s.card}>
                <div style={s.label}>元数据</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {META_KEYS.map(key => {
                      const val = meta![key]
                      if (val == null) return null
                      return (
                        <tr key={key}>
                          <td style={{ padding: '4px 0', color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, width: 120, verticalAlign: 'top', paddingRight: 16 }}>{key}</td>
                          <td style={{ padding: '4px 0', color: '#e5e5e5', verticalAlign: 'top' }}>
                            {Array.isArray(val) ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {val.map((v, i) => (
                                  <span key={i} style={{ padding: '2px 8px', borderRadius: 4, background: '#1e3a5f', color: '#3b82f6', fontSize: 11, border: '1px solid #3b82f6' }}>{v}</span>
                                ))}
                              </div>
                            ) : (
                              <span style={{ color: '#a3a3a3' }}>{String(val)}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selected.dependencies && selected.dependencies.length > 0 && (
              <div style={s.card}>
                <div style={s.label}>Dependencies</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selected.dependencies.map(dep => (
                    <span key={dep} style={s.badge}>{dep}</span>
                  ))}
                </div>
              </div>
            )}
            {selected.content && (
              <div style={s.card}>
                <div style={s.label}>Content</div>
                <pre style={s.pre}>{selected.content}</pre>
              </div>
            )}
            {selected.file_path && (
              <div style={s.card}>
                <div style={s.label}>File Path</div>
                <code style={{ fontSize: 12, color: '#9ca3af' }}>{selected.file_path}</code>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
            Select a skill to view details
          </div>
        )}
      </div>
    </div>
  )
}
