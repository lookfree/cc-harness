import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { SettingsModel, SettingsLevel, EffectiveSetting, SafetyToggles } from '@shared/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Settings as SettingsIcon, Pencil, Trash2, Save, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SETTINGS_LEVELS as LEVELS, LEVEL_BADGE_CLASS as LEVEL_BADGE } from '@/lib/settingsLevels'

function LevelSelect({ value, onChange, className }: { value: SettingsLevel; onChange: (v: SettingsLevel) => void; className?: string }) {
  const { t } = useTranslation('settings')
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue /></SelectTrigger>
      <SelectContent>
        {LEVELS.map((l) => (
          <SelectItem key={l} value={l}>{t(`levels.${l}`)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** value 优先按 JSON 解析（数字/布尔/数组/对象/带引号串），失败按裸字符串。 */
function parseValue(input: string): unknown {
  const t = input.trim()
  if (t === '') return ''
  try {
    return JSON.parse(t)
  } catch {
    return input
  }
}

export default function Settings() {
  const { t } = useTranslation('settings')
  const [model, setModel] = useState<SettingsModel | null>(null)
  const [toggles, setToggles] = useState<SafetyToggles | null>(null)

  const [rawInput, setRawInput] = useState('')
  const [rawLevel, setRawLevel] = useState<SettingsLevel>('project')
  const [rawError, setRawError] = useState('')

  const [editing, setEditing] = useState<EffectiveSetting | null>(null)
  const [editLevel, setEditLevel] = useState<SettingsLevel>('project')
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState('')

  const load = async () => {
    const [m, tg] = await Promise.all([api.settings.getModel(), api.settings.getToggles()])
    setModel(m)
    setToggles(tg)
  }
  useEffect(() => {
    load()
  }, [])

  const writeRaw = async () => {
    const eq = rawInput.indexOf('=')
    if (eq <= 0) {
      setRawError(t('raw.invalid'))
      return
    }
    setRawError('')
    const keyPath = rawInput.slice(0, eq).trim()
    const value = parseValue(rawInput.slice(eq + 1))
    await api.settings.setKey(rawLevel, keyPath, value)
    setRawInput('')
    await load()
  }

  const openEdit = (e: EffectiveSetting) => {
    setEditing(e)
    setEditLevel(e.source)
    setEditValue(JSON.stringify(e.value, null, 2))
    setEditError('')
  }

  const saveEdit = async () => {
    if (!editing) return
    let value: unknown
    try {
      value = JSON.parse(editValue)
    } catch {
      setEditError(t('edit.parseError'))
      return
    }
    await api.settings.setKey(editLevel, editing.key, value)
    setEditing(null)
    await load()
  }

  const unsetEdit = async () => {
    if (!editing) return
    await api.settings.setKey(editLevel, editing.key, undefined)
    setEditing(null)
    await load()
  }

  const toggleBundledSkills = async (checked: boolean) => {
    // 写到该值实际生效的那一层（否则在 user 写而 project/local 已定义会被覆盖，开关看起来没反应）
    const target = toggles?.disableBundledSkillsSource ?? 'user'
    await api.settings.setKey(target, 'disableBundledSkills', checked)
    await load()
  }

  // 只展示「叶子 + 非对象顶层」，跳过会展开成叶子的父对象，避免一坨大对象塞表格
  const rows = (model?.effective ?? [])
    .filter((e) => {
      const v = e.value
      const isExpandableObject = typeof v === 'object' && v !== null && !Array.isArray(v)
      return !isExpandableObject
    })
    .sort((a, b) => a.key.localeCompare(b.key))

  return (
    <div className="h-full flex flex-col overflow-auto">
      <div className="border-b border-border px-6 py-4 flex items-center gap-2">
        <SettingsIcon className="w-5 h-5" />
        <div>
          <h1 className="text-xl font-bold">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Quick key=value writer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('raw.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                className="flex-1 font-mono"
                value={rawInput}
                placeholder={t('raw.placeholder')}
                onChange={(e) => setRawInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && writeRaw()}
              />
              <LevelSelect value={rawLevel} onChange={setRawLevel} className="w-32" />
              <Button onClick={writeRaw}>{t('raw.write')}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('raw.hint')}</p>
            {rawError && <p className="text-xs text-destructive">{rawError}</p>}
          </CardContent>
        </Card>

        {/* Effective settings table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('table.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('table.empty')}</p>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-[2fr_3fr_auto_auto] gap-3 px-2 pb-2 text-xs font-medium text-muted-foreground border-b border-border">
                  <span>{t('table.key')}</span>
                  <span>{t('table.value')}</span>
                  <span>{t('table.source')}</span>
                  <span className="text-right">{t('table.actions')}</span>
                </div>
                {rows.map((e) => (
                  <div key={e.key} className="grid grid-cols-[2fr_3fr_auto_auto] gap-3 px-2 py-1.5 items-center hover:bg-accent rounded text-sm">
                    <code className="font-mono text-xs truncate">{e.key}</code>
                    <code className="font-mono text-xs text-muted-foreground truncate">{JSON.stringify(e.value)}</code>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className={cn('text-xs', LEVEL_BADGE[e.source])}>{t(`levels.${e.source}`)}</Badge>
                      {e.overriddenLevels?.map((l) => (
                        <Badge key={l} variant="outline" className="text-[10px] opacity-60">{t(`levels.${l}`)}</Badge>
                      ))}
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 justify-self-end" onClick={() => openEdit(e)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Safety switches */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('toggles.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label className="text-sm">{t('toggles.disableBundledSkills')}</Label>
                <p className="text-xs text-muted-foreground mt-1">{t('toggles.disableBundledSkillsDesc')}</p>
              </div>
              <Switch checked={!!toggles?.disableBundledSkills} onCheckedChange={toggleBundledSkills} />
            </div>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4" /> {t('toggles.safeMode')}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{t('toggles.safeModeDesc')}</p>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <div className="text-sm font-medium">{t('toggles.cd')}</div>
              <p className="text-xs text-muted-foreground mt-1">{t('toggles.cdDesc')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{t('edit.title')}: {editing?.key}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">{t('edit.level')}</Label>
              <LevelSelect value={editLevel} onChange={setEditLevel} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('edit.value')}</Label>
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="font-mono text-sm min-h-[120px]"
              />
              <p className="text-xs text-muted-foreground">{t('edit.valueHint')}</p>
              {editError && <p className="text-xs text-destructive">{editError}</p>}
            </div>
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button variant="destructive" size="sm" onClick={unsetEdit}>
              <Trash2 className="w-4 h-4 mr-1" /> {t('edit.unset')}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                <X className="w-4 h-4 mr-1" /> {t('edit.cancel')}
              </Button>
              <Button size="sm" onClick={saveEdit}>
                <Save className="w-4 h-4 mr-1" /> {t('edit.save')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
