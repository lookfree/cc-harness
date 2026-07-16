import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { MCPServers, MCPServerConfig } from '@shared/types'
import { isRemoteMCP } from '@shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KeyValueRows } from '@/components/KeyValueRows'
import { MCPHealthTab } from '@/pages/mcp/MCPHealthTab'
import { Server, Globe, Plus, Pencil, Trash2, Save, X, Zap, Info, MessageCircleQuestion } from 'lucide-react'

type Transport = 'stdio' | 'http' | 'sse'
type TargetFile = 'user' | 'project'
interface HeaderRow { key: string; value: string }
interface FormState {
  name: string
  type: Transport
  command: string
  args: string
  url: string
  headers: HeaderRow[]
  alwaysLoad: boolean
  elicitation: boolean
  disabled: boolean
  timeout: string
  description: string
  target: TargetFile
}

const emptyForm = (): FormState => ({
  name: '', type: 'stdio', command: '', args: '', url: '', headers: [], alwaysLoad: false,
  elicitation: false, disabled: false, timeout: '', description: '', target: 'user',
})

export default function MCP() {
  const { t } = useTranslation('mcp')
  const [servers, setServers] = useState<MCPServers>({})
  const [sources, setSources] = useState<Record<string, 'user' | 'project'>>({})
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())

  const load = async () => {
    try {
      const [all, src] = await Promise.all([api.mcp.getAll(), api.mcp.getSources()])
      setServers(all)
      setSources(src)
    } catch (e) {
      console.error('[MCP] load failed:', e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const { local, remote } = useMemo(() => {
    const local: Array<[string, MCPServerConfig]> = []
    const remote: Array<[string, MCPServerConfig]> = []
    for (const e of Object.entries(servers)) (isRemoteMCP(e[1]) ? remote : local).push(e)
    return { local, remote }
  }, [servers])

  const openAdd = () => { setEditingName(null); setForm(emptyForm()); setDialogOpen(true) }
  const openEdit = (name: string, c: MCPServerConfig) => {
    setEditingName(name)
    setForm({
      name,
      type: c.type ?? (isRemoteMCP(c) ? 'http' : 'stdio'),
      command: c.command ?? '',
      args: (c.args ?? []).join(', '),
      url: c.url ?? '',
      headers: Object.entries(c.headers ?? {}).map(([key, value]) => ({ key, value })),
      alwaysLoad: !!c.alwaysLoad,
      elicitation: !!c.elicitation,
      disabled: !!c.disabled,
      timeout: c.timeout != null ? String(c.timeout) : '',
      description: c.description ?? '',
      target: sources[name] ?? 'user', // 默认写回原文件，避免误把 project server 挪到 user
    })
    setDialogOpen(true)
  }

  const save = async () => {
    const name = form.name.trim()
    if (!name) return
    const isRemote = form.type === 'http' || form.type === 'sse'
    // 以原 config 为底，保留表单不管理的字段（env / alwaysAllow 等）；只覆盖表单管理的字段
    const cfg: MCPServerConfig = { ...(editingName ? servers[editingName] : {}), type: form.type }
    const set = <K extends keyof MCPServerConfig>(k: K, v: MCPServerConfig[K] | undefined) => {
      if (v === undefined) delete cfg[k]
      else cfg[k] = v
    }
    // 传输字段：先清两侧，再写当前 transport 的
    set('command', undefined); set('args', undefined); set('url', undefined); set('headers', undefined)
    if (isRemote) {
      set('url', form.url.trim() || undefined)
      const headers = Object.fromEntries(form.headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value]))
      set('headers', Object.keys(headers).length ? headers : undefined)
    } else {
      set('command', form.command.trim() || undefined)
      const args = form.args.split(',').map((s) => s.trim()).filter(Boolean)
      set('args', args.length ? args : undefined)
    }
    set('alwaysLoad', form.alwaysLoad || undefined)
    set('elicitation', form.elicitation || undefined)
    set('disabled', form.disabled || undefined)
    set('timeout', form.timeout.trim() && !isNaN(Number(form.timeout)) ? Number(form.timeout) : undefined)
    set('description', form.description.trim() || undefined)

    try {
      await api.mcp.save(name, cfg, form.target)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      return
    }
    setDialogOpen(false)
    await load()
  }

  const remove = async (name: string) => {
    if (!confirm(t('dialog.confirmDelete', { name }))) return
    try {
      await api.mcp.delete(name)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      return
    }
    await load()
  }

  return (
    <div className="h-full flex flex-col overflow-auto">
      <div className="border-b border-border px-6 py-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5" />
          <div>
            <h1 className="text-xl font-bold">{t('title')}</h1>
            <p className="text-xs text-muted-foreground">{t('description')}</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="servers" className="flex-1 flex flex-col min-h-0">
        <div className="px-6 pt-4 flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="servers">{t('tabs.servers')}</TabsTrigger>
            <TabsTrigger value="health">{t('tabs.health')}</TabsTrigger>
          </TabsList>
          <TabsContent value="servers" className="mt-0 contents">
            <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> {t('actions.add')}</Button>
          </TabsContent>
        </div>

        <TabsContent value="servers" className="flex-1 p-6 pt-4 space-y-4 overflow-auto">
          {/* Notes */}
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1">
            <p className="text-xs text-muted-foreground flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {t('parallelNote')}</p>
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">{t('loading')}</div>
          ) : Object.keys(servers).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">{t('empty')}</div>
          ) : (
            <>
              {local.length > 0 && (
                <Group title={t('groups.local')} icon={<Server className="w-4 h-4" />}>
                  {local.map(([name, c]) => <ServerCard key={name} name={name} config={c} t={t} onEdit={() => openEdit(name, c)} onDelete={() => remove(name)} />)}
                </Group>
              )}
              {remote.length > 0 && (
                <Group title={t('groups.remote')} icon={<Globe className="w-4 h-4" />}>
                  {remote.map(([name, c]) => <ServerCard key={name} name={name} config={c} t={t} onEdit={() => openEdit(name, c)} onDelete={() => remove(name)} />)}
                </Group>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="health" className="flex-1 p-6 pt-4 overflow-auto">
          <MCPHealthTab />
        </TabsContent>
      </Tabs>

      <McpDialog open={dialogOpen} onOpenChange={setDialogOpen} form={form} setForm={setForm} editingName={editingName} onSave={save} t={t} />
    </div>
  )
}

function Group({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">{icon} {title}</div>
      <div className="grid gap-3">{children}</div>
    </div>
  )
}

function ServerCard({ name, config: c, t, onEdit, onDelete }: { name: string; config: MCPServerConfig; t: (k: string) => string; onEdit: () => void; onDelete: () => void }) {
  const remote = isRemoteMCP(c)
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              {name}
              {remote && <Badge variant="outline" className="text-xs">{(c.type ?? 'http').toUpperCase()}</Badge>}
              {c.alwaysLoad && <Badge variant="outline" className="text-xs flex items-center gap-1"><Zap className="w-3 h-3" /> {t('fields.alwaysLoad')}</Badge>}
              {c.elicitation && <Badge variant="outline" className="text-xs flex items-center gap-1"><MessageCircleQuestion className="w-3 h-3" /> {t('fields.elicitationSupported')}</Badge>}
              {c.disabled && <Badge variant="secondary" className="text-xs">{t('fields.disabled')}</Badge>}
            </CardTitle>
            {c.description && <CardDescription className="mt-1">{c.description}</CardDescription>}
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /></Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onDelete}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        {remote ? (
          <>
            <Field label={t('fields.url')}><code className="bg-muted px-1 py-0.5 rounded text-xs break-all">{c.url}</code></Field>
            {c.headers && Object.keys(c.headers).length > 0 && (
              <Field label={t('fields.headers')}>
                <div className="space-y-1">
                  {Object.keys(c.headers).map((k) => (
                    <div key={k} className="text-xs"><code className="bg-muted px-1 py-0.5 rounded">{k}: ••••</code></div>
                  ))}
                </div>
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label={t('fields.command')}><code className="bg-muted px-1 py-0.5 rounded text-xs">{c.command}</code></Field>
            {c.args && c.args.length > 0 && (
              <Field label={t('fields.args')}>
                <div className="flex flex-wrap gap-1">{c.args.map((a, i) => <code key={i} className="bg-muted px-1 py-0.5 rounded text-xs">{a}</code>)}</div>
              </Field>
            )}
            {c.env && Object.keys(c.env).length > 0 && (
              <Field label={t('fields.env')}>
                <div className="space-y-1">{Object.entries(c.env).map(([k, v]) => <div key={k} className="text-xs"><code className="bg-muted px-1 py-0.5 rounded">{k}={v}</code></div>)}</div>
              </Field>
            )}
          </>
        )}
        {c.timeout != null && <Field label={t('fields.timeout')}>{c.timeout}ms</Field>}
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><span className="font-medium text-xs text-muted-foreground">{label}:</span> <span className="ml-1">{children}</span></div>
}

function McpDialog({ open, onOpenChange, form, setForm, editingName, onSave, t }: {
  open: boolean; onOpenChange: (v: boolean) => void; form: FormState; setForm: (f: FormState) => void
  editingName: string | null; onSave: () => void; t: (k: string) => string
}) {
  const remote = form.type === 'http' || form.type === 'sse'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>{editingName ? t('dialog.editTitle') : t('dialog.addTitle')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('dialog.name')}</Label>
              <Input value={form.name} disabled={!!editingName} placeholder={t('dialog.namePlaceholder')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('fields.transport')}</Label>
              <Select value={form.type} onValueChange={(v: Transport) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="http">http</SelectItem>
                  <SelectItem value="sse">sse</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {remote ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">{t('fields.url')}</Label>
                <Input value={form.url} placeholder={t('dialog.urlPlaceholder')} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('fields.headers')}</Label>
                  <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setForm({ ...form, headers: [...form.headers, { key: '', value: '' }] })}><Plus className="w-3 h-3" /></Button>
                </div>
                <KeyValueRows rows={form.headers} onChange={(headers) => setForm({ ...form, headers })} />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">{t('fields.command')}</Label>
                <Input value={form.command} placeholder={t('dialog.commandPlaceholder')} onChange={(e) => setForm({ ...form, command: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('fields.args')}</Label>
                <Input value={form.args} placeholder={t('dialog.argsPlaceholder')} onChange={(e) => setForm({ ...form, args: e.target.value })} />
              </div>
            </>
          )}

          <div className="grid grid-cols-3 gap-2">
            <ToggleField label={t('fields.alwaysLoad')} checked={form.alwaysLoad} onChange={(v) => setForm({ ...form, alwaysLoad: v })} />
            <ToggleField label={t('fields.elicitation')} checked={form.elicitation} onChange={(v) => setForm({ ...form, elicitation: v })} />
            <ToggleField label={t('fields.disabled')} checked={form.disabled} onChange={(v) => setForm({ ...form, disabled: v })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('fields.timeout')} (ms)</Label>
              <Input type="number" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('dialog.targetFile')}</Label>
              <Select value={form.target} onValueChange={(v: TargetFile) => setForm({ ...form, target: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t('dialog.fileUser')}</SelectItem>
                  <SelectItem value="project">{t('dialog.fileProject')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">{t('dialog.descriptionLabel')}</Label>
            <Textarea value={form.description} placeholder={t('dialog.descriptionPlaceholder')} className="min-h-[60px]" onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}><X className="w-4 h-4 mr-1" /> {t('actions.cancel')}</Button>
          <Button onClick={onSave} disabled={!form.name.trim()}><Save className="w-4 h-4 mr-1" /> {t('actions.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-2 py-1.5">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
