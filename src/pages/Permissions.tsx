import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { PermissionModel, PermissionRule, PermissionLevel, PermissionEffect } from '@shared/types'
import { TOOL_PARAM_HINTS, formatPermissionRule, isWholeValueTool } from '@shared/permission/parse'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ShieldCheck, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SETTINGS_LEVELS as LEVELS, LEVEL_BADGE_CLASS as LEVEL_BADGE } from '@/lib/settingsLevels'

const EFFECTS: PermissionEffect[] = ['allow', 'deny', 'ask']

const EFFECT_BADGE: Record<PermissionEffect, string> = {
  allow: 'bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30',
  deny: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  ask: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
}

const KNOWN_TOOLS = Object.keys(TOOL_PARAM_HINTS)

type PickFile = { name: string; filePath: string; kind: 'skill' | 'command' }

export default function Permissions() {
  const { t } = useTranslation('permissions')
  const [model, setModel] = useState<PermissionModel | null>(null)

  // Tool(param:value) builder
  const [tool, setTool] = useState('Bash')
  const [params, setParams] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }])
  const [level, setLevel] = useState<PermissionLevel>('project')
  const [effect, setEffect] = useState<PermissionEffect>('allow')

  // disallowed-tools editor
  const [files, setFiles] = useState<PickFile[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [disallowed, setDisallowed] = useState<string[]>([])
  const [newTool, setNewTool] = useState('')

  const loadModel = async () => setModel(await api.permissions.getModel())

  useEffect(() => {
    loadModel()
    ;(async () => {
      const [skills, commands] = await Promise.all([api.skills.getAll(), api.commands.getAll()])
      setFiles([
        ...skills.filter((s) => s.filePath).map((s) => ({ name: s.name, filePath: s.filePath as string, kind: 'skill' as const })),
        ...commands.filter((c) => c.filePath).map((c) => ({ name: c.name, filePath: c.filePath as string, kind: 'command' as const })),
      ])
    })()
  }, [])

  const updateParam = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setParams(params.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  const wholeValue = isWholeValueTool(tool)
  const previewParams = params
    .filter((p) => p.value.trim())
    .map((p) => ({ key: wholeValue ? '' : p.key.trim(), value: p.value.trim(), isGlob: /[*]/.test(p.value) }))
  const preview = formatPermissionRule(tool.trim() || 'Tool', previewParams)

  const addRule = async () => {
    if (!tool.trim()) return
    await api.permissions.saveRule(level, effect, preview)
    setParams([{ key: '', value: '' }])
    await loadModel()
  }

  const deleteRule = async (r: PermissionRule) => {
    await api.permissions.deleteRule(r.level, r.effect, r.raw)
    await loadModel()
  }

  const selectFile = async (fp: string) => {
    setSelectedFile(fp)
    setDisallowed(fp ? await api.permissions.getDisallowedTools(fp) : [])
  }

  const addDisallowed = async () => {
    const tn = newTool.trim()
    if (!tn || !selectedFile || disallowed.includes(tn)) return
    const next = [...disallowed, tn]
    await api.permissions.setDisallowedTools(selectedFile, next)
    setDisallowed(next)
    setNewTool('')
  }

  const removeDisallowed = async (name: string) => {
    const next = disallowed.filter((x) => x !== name)
    await api.permissions.setDisallowedTools(selectedFile, next)
    setDisallowed(next)
  }

  const layerOf = (lvl: PermissionLevel) => model?.layers.find((l) => l.level === lvl)
  const rulesOf = (lvl: PermissionLevel, eff: PermissionEffect): PermissionRule[] => {
    const layer = layerOf(lvl)
    return layer ? layer[eff] : []
  }

  return (
    <div className="h-full flex flex-col overflow-auto">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-2">
        <ShieldCheck className="w-5 h-5" />
        <div>
          <h1 className="text-xl font-bold">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Builder */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" /> {t('builder.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('builder.tool')}</Label>
                <Input
                  list="known-tools"
                  value={tool}
                  onChange={(e) => setTool(e.target.value)}
                  placeholder={t('builder.toolPlaceholder')}
                />
                <datalist id="known-tools">
                  {KNOWN_TOOLS.map((tn) => (
                    <option key={tn} value={tn} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('builder.level')}</Label>
                <Select value={level} onValueChange={(v: PermissionLevel) => setLevel(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>{t(`levels.${l}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('builder.effect')}</Label>
                <Select value={effect} onValueChange={(v: PermissionEffect) => setEffect(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EFFECTS.map((e) => (
                      <SelectItem key={e} value={e}>{t(`effects.${e}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Params */}
            <div className="space-y-2">
              <Label className="text-xs">{t('builder.param')}</Label>
              {params.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  {!wholeValue && (
                    <Input
                      className="w-40"
                      value={p.key}
                      placeholder={t('builder.paramKey')}
                      onChange={(e) => updateParam(i, { key: e.target.value })}
                    />
                  )}
                  <Input
                    className="flex-1"
                    value={p.value}
                    placeholder={t('builder.paramValue')}
                    onChange={(e) => updateParam(i, { value: e.target.value })}
                  />
                  {/[*]/.test(p.value) && <Badge variant="outline" className="text-xs">{t('builder.glob')}</Badge>}
                  {params.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => setParams(params.filter((_, j) => j !== i))}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
              {!wholeValue && (
                <Button variant="outline" size="sm" onClick={() => setParams([...params, { key: '', value: '' }])}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> {t('builder.addParam')}
                </Button>
              )}
            </div>

            {/* Preview + add */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <div className="text-sm">
                <span className="text-muted-foreground mr-2">{t('builder.preview')}:</span>
                <code className="px-2 py-1 rounded bg-muted font-mono">{preview}</code>
              </div>
              <Button onClick={addRule} disabled={!tool.trim()}>
                <Plus className="w-4 h-4 mr-1" /> {t('builder.add')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Layered matrix */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('matrix.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {EFFECTS.map((eff) => (
              <div key={eff} className="space-y-2">
                <Badge variant="outline" className={cn('text-xs', EFFECT_BADGE[eff])}>{t(`effects.${eff}`)}</Badge>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {LEVELS.map((lvl) => {
                    const layer = layerOf(lvl)
                    const rules = rulesOf(lvl, eff)
                    return (
                      <div key={lvl} className="rounded-lg border border-border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn('text-xs', LEVEL_BADGE[lvl])}>{t(`levels.${lvl}`)}</Badge>
                          {layer && !layer.exists && (
                            <span className="text-xs text-muted-foreground">{t('matrix.noFile')}</span>
                          )}
                        </div>
                        {rules.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t('matrix.empty')}</p>
                        ) : (
                          rules.map((r) => (
                            <div
                              key={r.raw}
                              className={cn(
                                'flex items-center justify-between gap-2 rounded px-2 py-1 text-sm',
                                r.overriddenBy ? 'opacity-50' : 'bg-card'
                              )}
                            >
                              <code className={cn('font-mono text-xs truncate', r.overriddenBy && 'line-through')}>{r.raw}</code>
                              <div className="flex items-center gap-1 shrink-0">
                                {r.overriddenBy && (
                                  <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                                    {t('matrix.overriddenBy', { level: t(`levels.${r.overriddenBy}`) })}
                                  </Badge>
                                )}
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => deleteRule(r)}>
                                  <X className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* disallowed-tools editor */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('disallowed.title')}</CardTitle>
            <p className="text-xs text-muted-foreground">{t('disallowed.description')}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('disallowed.pickFile')}</Label>
              <Select value={selectedFile} onValueChange={selectFile}>
                <SelectTrigger className="md:w-96"><SelectValue placeholder={t('disallowed.pickFile')} /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t('disallowed.skills')}</SelectLabel>
                    {files.filter((f) => f.kind === 'skill').map((f) => (
                      <SelectItem key={f.filePath} value={f.filePath}>{f.name}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{t('disallowed.commands')}</SelectLabel>
                    {files.filter((f) => f.kind === 'command').map((f) => (
                      <SelectItem key={f.filePath} value={f.filePath}>{f.name}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {selectedFile ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {disallowed.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t('disallowed.empty')}</p>
                  ) : (
                    disallowed.map((tn) => (
                      <Badge key={tn} variant="secondary" className="text-xs flex items-center gap-1">
                        {tn}
                        <button onClick={() => removeDisallowed(tn)} className="hover:text-destructive">
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    className="w-60"
                    value={newTool}
                    placeholder={t('disallowed.toolPlaceholder')}
                    onChange={(e) => setNewTool(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addDisallowed()}
                  />
                  <Button variant="outline" size="sm" onClick={addDisallowed} disabled={!newTool.trim()}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> {t('disallowed.addTool')}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('disallowed.noSelection')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
