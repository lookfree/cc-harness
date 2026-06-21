import type { TFunction } from 'i18next'
import type { HookType, HookSettingsMatcher } from '@shared/types'
import { HookActionForm, makeEmptyAction } from './HookActionForm'
import type { HookActionItem } from './HookActionForm'
import { HookTypePanels } from './HookTypePanels'
import type { HookTypeFields } from './HookTypePanels'
import type { EditFormState } from './hookEditTypes'
import { HOOK_TYPE_GROUPS } from './hookTypes'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Globe,
  FolderOpen,
  Plus,
  Save,
  X,
  AlertCircle,
  Check,
  AlertTriangle,
} from 'lucide-react'

interface HookEditDialogProps {
  open: boolean
  isCreating: boolean
  editForm: EditFormState
  setEditForm: (form: EditFormState) => void
  validationErrors: string[]
  saving: boolean
  saveSuccess: boolean
  onSave: () => void
  onCancel: () => void
  onSelectProjectPath: () => void
  buildHookConfig: (actions: HookActionItem[]) => HookSettingsMatcher
  t: TFunction
}

export function HookEditDialog({
  open,
  isCreating,
  editForm,
  setEditForm,
  validationErrors,
  saving,
  saveSuccess,
  onSave,
  onCancel,
  onSelectProjectPath,
  buildHookConfig,
  t,
}: HookEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            {isCreating ? t('dialog.createTitle') : `${t('dialog.editTitle')}: ${editForm.name}`}
          </DialogTitle>
          <DialogDescription>
            {isCreating ? t('dialog.createDescription') : t('dialog.editDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/50 text-destructive rounded-md p-4">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                {t('validation.title')}
              </h4>
              <p className="text-sm mb-2">{t('validation.fixErrors')}</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {validationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Hook Type */}
          <div className="space-y-2">
            <Label>{t('dialog.type')}</Label>
            <Select
              value={editForm.type}
              onValueChange={(value: HookType) => setEditForm({ ...editForm, type: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('dialog.typePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {HOOK_TYPE_GROUPS.map((g) => (
                  <SelectGroup key={g.group}>
                    <SelectLabel>{t(`groups.${g.group}`, g.group)}</SelectLabel>
                    {g.types.map((type) => (
                      <SelectItem key={type} value={type}>
                        <div className="flex flex-col">
                          <span>{t(`events.${type}.title`, type)}</span>
                          <span className="text-xs text-muted-foreground">{t(`events.${type}.description`, '')}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <Label>{t('dialog.location')}</Label>
            <Select
              value={editForm.location}
              onValueChange={(value: 'user' | 'project') =>
                setEditForm({ ...editForm, location: value, projectPath: value === 'user' ? '' : editForm.projectPath })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    {t('dialog.locationUser')}
                  </div>
                </SelectItem>
                <SelectItem value="project">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    {t('dialog.locationProject')}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Project Path (only for project hooks) */}
          {editForm.location === 'project' && (
            <div className="space-y-2">
              <Label>{t('dialog.projectPath')}</Label>
              <div className="flex gap-2">
                <Input
                  value={editForm.projectPath}
                  placeholder={t('dialog.projectPathPlaceholder')}
                  readOnly
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={onSelectProjectPath}>
                  <FolderOpen className="h-4 w-4 mr-1" />
                  {t('dialog.browse')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('dialog.projectPathHint')}: {editForm.projectPath ? `${editForm.projectPath}/.claude/settings.json` : t('dialog.projectPathRequired')}
              </p>
            </div>
          )}

          {/* Matcher Pattern */}
          <div className="space-y-2">
            <Label>{t('dialog.matcher', 'Matcher')}</Label>
            <Input
              value={editForm.matcher}
              onChange={(e) => setEditForm({ ...editForm, matcher: e.target.value })}
              placeholder={t('dialog.matcherPlaceholder', 'Tool name pattern (e.g., Bash, Edit|Write)')}
            />
            <p className="text-xs text-muted-foreground">
              {t('dialog.matcherHint', 'Leave empty to match all. Use | for multiple patterns (e.g., Edit|Write)')}
            </p>
          </div>

          {/* Type-specific panels */}
          <HookTypePanels
            type={editForm.type}
            fields={{
              reloadSkills: editForm.reloadSkills,
              sessionTitle: editForm.sessionTitle,
              maxBlocks: editForm.maxBlocks,
              replaceToolOutput: editForm.replaceToolOutput,
            }}
            effort={editForm.effort}
            onChange={(partial: Partial<HookTypeFields>) => setEditForm({ ...editForm, ...partial })}
            t={t}
          />

          {/* Hook Actions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{t('dialog.hookCommands', 'Commands')}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditForm({ ...editForm, actions: [...editForm.actions, makeEmptyAction()] })}
              >
                <Plus className="h-4 w-4 mr-1" />
                {t('dialog.addCommand', 'Add Command')}
              </Button>
            </div>

            {editForm.actions.map((action, index) => (
              <HookActionForm
                key={index}
                action={action}
                index={index}
                canRemove={editForm.actions.length > 1}
                onChange={(next: HookActionItem) => {
                  const actions = [...editForm.actions]
                  actions[index] = next
                  setEditForm({ ...editForm, actions })
                }}
                onRemove={() => setEditForm({ ...editForm, actions: editForm.actions.filter((_, i) => i !== index) })}
                t={t}
              />
            ))}
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <Label>{t('dialog.preview', 'Configuration Preview')}</Label>
            <div className="bg-muted rounded-lg p-4">
              <pre className="text-xs font-mono overflow-auto max-h-[200px]">
                {JSON.stringify({ hooks: { [editForm.type]: [buildHookConfig(editForm.actions)] } }, null, 2)}
              </pre>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('dialog.previewHint', 'This configuration will be saved to settings.json')}
            </p>
            {editForm.actions.some((a) => a.type === 'command' && a.useScriptFile && a.scriptPath) && (
              <p className="text-xs text-blue-600 dark:text-blue-400">
                {t('dialog.scriptWillBeCreated', 'Script file(s) will be created automatically')}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {saveSuccess && (
            <div className="flex flex-col gap-1 mr-auto text-left">
              <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <Check className="h-4 w-4" />
                {t('saveSuccess')}
              </span>
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {t('saveSuccessRestartHint')}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              <X className="h-4 w-4 mr-1" />
              {t('dialog.cancel')}
            </Button>
            <Button onClick={onSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? t('dialog.saving') : t('dialog.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
