import type { TFunction } from 'i18next'
import type { HookType, EffortLevel } from '@shared/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Zap } from 'lucide-react'

/** Type-specific matcher-level fields surfaced in the edit dialog. */
export interface HookTypeFields {
  reloadSkills: boolean
  sessionTitle: string
  maxBlocks: number
  replaceToolOutput: boolean
}

interface HookTypePanelsProps {
  type: HookType
  fields: HookTypeFields
  effort?: EffortLevel
  onChange: (partial: Partial<HookTypeFields>) => void
  t: TFunction
}

export function HookTypePanels({ type, fields, effort, onChange, t }: HookTypePanelsProps) {
  const showSessionStart = type === 'SessionStart'
  const showMaxBlocks = type === 'Stop' || type === 'StopFailure'
  const showReplaceToolOutput = type === 'PostToolUse'
  const showPreToolUseNote = type === 'PreToolUse'

  if (!showSessionStart && !showMaxBlocks && !showReplaceToolOutput && !showPreToolUseNote && !effort) {
    return null
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <p className="text-sm font-medium">{t('dialog.typeSpecific', 'Type-specific options')}</p>

      {/* HOOK-13：≥2.1.211 ask 语义说明 */}
      {showPreToolUseNote && (
        <p className="text-xs text-muted-foreground">
          {t(
            'dialog.preToolUseSemantics',
            '≥2.1.211: an "ask" decision from this hook is no longer overridden by auto mode (it always floors at a prompt). ≥2.1.210: a hook callback timeout is no longer misreported as a user rejection.'
          )}
        </p>
      )}

      {showSessionStart && (
        <>
          <div className="flex items-center justify-between">
            <Label className="text-xs" htmlFor="reload-skills">
              {t('dialog.reloadSkills', 'Reload skills on session start')}
            </Label>
            <Switch
              id="reload-skills"
              checked={fields.reloadSkills}
              onCheckedChange={(v) => onChange({ reloadSkills: v })}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">{t('dialog.sessionTitle', 'Session Title')}</Label>
            <Input
              value={fields.sessionTitle}
              onChange={(e) => onChange({ sessionTitle: e.target.value })}
              placeholder={t('dialog.sessionTitlePlaceholder', 'Preset session title')}
            />
          </div>
        </>
      )}

      {showMaxBlocks && (
        <div className="space-y-2">
          <Label className="text-xs">{t('dialog.maxBlocks', 'Max Blocks')}</Label>
          <Input
            type="number"
            value={fields.maxBlocks}
            onChange={(e) => onChange({ maxBlocks: parseInt(e.target.value) || 8 })}
          />
          <p className="text-xs text-muted-foreground">{t('dialog.maxBlocksHint', 'Stop-hook block count limit (default 8)')}</p>
        </div>
      )}

      {showReplaceToolOutput && (
        <div className="flex items-center justify-between">
          <Label className="text-xs" htmlFor="replace-tool-output">
            {t('dialog.replaceToolOutput', 'Replace tool output for Claude')}
          </Label>
          <Switch
            id="replace-tool-output"
            checked={fields.replaceToolOutput}
            onCheckedChange={(v) => onChange({ replaceToolOutput: v })}
          />
        </div>
      )}

      {effort && (
        <div className="flex items-center gap-2">
          <Label className="text-xs">{t('dialog.effort', 'Effort')}</Label>
          <Badge variant="outline" className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {effort}
          </Badge>
          <span className="text-xs text-muted-foreground">{t('dialog.effortReadOnly', 'read-only')}</span>
        </div>
      )}
    </div>
  )
}
