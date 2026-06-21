import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { SlashCommand } from '@shared/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
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
import { Search, Terminal, Globe, FolderOpen, FileText, Plus, Pencil, Trash2, Save, X, AlertCircle, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SourceBadge } from '@/components/SourceBadge'
import { sourceOf as cmdSource, sourceKey as cmdKey, sourceLabel as cmdSourceLabel } from '@/lib/source'

type SourceFilter = 'all' | 'user' | 'project' | 'plugin'

export default function Commands() {
  const { t } = useTranslation('commands')
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [selectedCommand, setSelectedCommand] = useState<SlashCommand | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [editForm, setEditForm] = useState<{
    name: string
    description: string
    instructions: string
    location: 'user' | 'project'
    projectPath: string
  }>({
    name: '',
    description: '',
    instructions: '',
    location: 'project',
    projectPath: ''
  })
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    loadCommands()
  }, [])

  const loadCommands = async () => {
    try {
      console.log('[Commands Page] Loading commands...')
      setLoading(true)
      const data = await api.commands.getAll()
      console.log('[Commands Page] Loaded', data.length, 'commands:', data)
      setCommands(data)
      if (data.length > 0 && !selectedCommand) {
        setSelectedCommand(data[0])
      }
    } catch (error) {
      console.error('[Commands Page] Failed to load commands:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredCommands = commands.filter((cmd) =>
    (sourceFilter === 'all' || cmdSource(cmd) === sourceFilter) &&
    (cmd.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cmd.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const handleEdit = (command: SlashCommand) => {
    // 从 filePath 中提取项目路径
    let projectPath = ''
    if (command.filePath && command.location === 'project') {
      // filePath 格式: /path/to/project/.claude/commands/cmd-name/cmd-name.md
      const match = command.filePath.match(/^(.+)\/\.claude\/commands\//)
      if (match) {
        projectPath = match[1]
      }
    }
    setEditForm({
      name: command.name,
      description: command.description,
      instructions: command.rawContent || command.instructions || '',
      location: command.location || 'project',
      projectPath
    })
    setIsEditing(true)
    setIsCreating(false)
  }

  const handleCreate = () => {
    // 提供模板
    const template = `---
description: 命令描述
argument-hint: [参数1] [参数2?]
---

# 命令标题

在这里编写命令的指令内容...
`
    setEditForm({
      name: '',
      description: '',
      instructions: template,
      location: 'project',
      projectPath: ''
    })
    setIsCreating(true)
    setIsEditing(false)
  }

  const handleSelectProjectPath = async () => {
    try {
      const path = await api.project.selectPath()
      if (path) {
        setEditForm({ ...editForm, projectPath: path })
      }
    } catch (error) {
      console.error('[Commands Page] Failed to select project path:', error)
    }
  }

  const handleSave = async () => {
    // 简化验证：只验证必填项
    const errors: string[] = []
    const name = editForm.name.trim()
    const content = editForm.instructions.trim()

    if (!name) {
      errors.push(t('errors.nameRequired'))
    } else if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      errors.push(t('errors.invalidName'))
    }

    if (!content) {
      errors.push(t('errors.instructionsRequired'))
    }

    if (isCreating && editForm.location === 'project' && !editForm.projectPath) {
      errors.push(t('errors.projectPathRequired'))
    }

    setValidationErrors(errors)
    if (errors.length > 0) {
      return
    }

    setSaving(true)
    try {
      // 确定保存路径
      let targetFilePath: string
      if (isEditing && selectedCommand?.filePath) {
        // 编辑模式：使用原来的文件路径
        targetFilePath = selectedCommand.filePath
      } else {
        // 创建模式：构建新的文件路径
        const baseDir = editForm.location === 'user'
          ? `${process.env.HOME || '~'}/.claude/commands`
          : `${editForm.projectPath}/.claude/commands`
        targetFilePath = `${baseDir}/${name}/${name}.md`
      }

      console.log('[Commands Page] Saving raw content to:', targetFilePath)
      await api.commands.saveRaw(name, content, targetFilePath)

      // 重新加载命令列表
      const updatedCommands = await api.commands.getAll()
      setCommands(updatedCommands)

      // 从更新后的列表中查找并选中保存的命令（按 filePath 精确匹配，避免同名多来源选错）
      const savedCmd = updatedCommands.find(c => c.filePath === targetFilePath) ?? updatedCommands.find(c => c.name === name)
      if (savedCmd) setSelectedCommand(savedCmd)

      setIsEditing(false)
      setIsCreating(false)
      setValidationErrors([])
    } catch (error) {
      console.error('[Commands Page] Failed to save command:', error)
      alert(t('errors.saveFailed') + ': ' + (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedCommand) return

    try {
      console.log('[Commands Page] Deleting command:', selectedCommand.name)
      await api.commands.delete(selectedCommand.name, selectedCommand.filePath)
      setDeleteDialogOpen(false)
      setSelectedCommand(null)
      await loadCommands()
    } catch (error) {
      console.error('[Commands Page] Failed to delete command:', error)
      alert(t('errors.deleteFailed') + ': ' + (error as Error).message)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setIsCreating(false)
    setValidationErrors([])
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-lg font-semibold mb-2">{t('common:loading', 'Loading...')}</div>
          <div className="text-muted-foreground">{t('common:pleaseWait', 'Please wait')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-4">
      {/* Left Sidebar - Commands List */}
      <div className="w-80 flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-2">{t('description')}</p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Create Button */}
        <Button onClick={handleCreate} className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          {t('newCommand')}
        </Button>

        {/* Source filter */}
        <div className="flex gap-1">
          {(['all', 'user', 'project', 'plugin'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={sourceFilter === f ? 'default' : 'outline'}
              className="text-xs h-7 px-2"
              onClick={() => setSourceFilter(f)}
            >
              {t(`filter.${f}`)}
            </Button>
          ))}
        </div>

        <div className="text-sm text-muted-foreground px-1">
          {filteredCommands.length} / {commands.length}
        </div>

        {/* Commands List */}
        <div className="flex-1 overflow-auto space-y-2">
          {filteredCommands.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                {searchQuery ? t('noSearchResults') : t('noCommands')}
              </CardContent>
            </Card>
          ) : (
            filteredCommands.map((cmd) => {
              const src = cmdSource(cmd)
              const srcLabel = cmdSourceLabel(cmd, t)
              return (
              <Card
                key={cmdKey(cmd)}
                className={cn(
                  'cursor-pointer transition-all hover:border-primary',
                  selectedCommand && cmdKey(selectedCommand) === cmdKey(cmd) && 'border-primary bg-accent',
                  cmd.overriddenBy && 'opacity-60'
                )}
                onClick={() => setSelectedCommand(cmd)}
              >
                <CardHeader className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Terminal className="h-4 w-4 shrink-0" />
                        <span className={cn('truncate', cmd.overriddenBy && 'line-through')}>/{cmd.name}</span>
                      </CardTitle>
                      <CardDescription className="text-sm mt-1 line-clamp-2">
                        {cmd.description}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <SourceBadge source={src} label={srcLabel} />
                    {cmd.overriddenBy && (
                      <Badge variant="outline" className="text-xs bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                        {t('overridden')}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
              </Card>
              )
            })
          )}
        </div>
      </div>

      {/* Right Panel - Command Details */}
      <div className="flex-1 overflow-auto">
        {selectedCommand ? (
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <Terminal className="h-6 w-6" />
                    /{selectedCommand.name}
                  </CardTitle>
                  <CardDescription className="mt-2">{selectedCommand.description}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(selectedCommand)}
                    disabled={cmdSource(selectedCommand) === 'plugin'}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    {t('edit')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={cmdSource(selectedCommand) === 'plugin'}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    {t('delete')}
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 mt-4 flex-wrap items-center">
                <SourceBadge source={cmdSource(selectedCommand)} label={cmdSourceLabel(selectedCommand, t)} />
                {selectedCommand.invokeName && selectedCommand.invokeName !== selectedCommand.name && (
                  <Badge variant="outline" className="font-mono text-xs">
                    {t('invokeName')}: {selectedCommand.invokeName}
                  </Badge>
                )}
                {cmdSource(selectedCommand) === 'plugin' && (
                  <Badge variant="outline" className="text-xs">{t('readOnly')}</Badge>
                )}
                {selectedCommand.pluginScope && (
                  <Badge variant="outline" className="text-xs">{t(`pluginScope.${selectedCommand.pluginScope}`)}</Badge>
                )}
              </div>
              {selectedCommand.overriddenBy && (
                <div className="mt-3 flex items-start gap-2 text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{t('overriddenHint')}</span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="overview" className="w-full">
                <TabsList>
                  <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
                  <TabsTrigger value="useguide">{t('tabs.useguide')}</TabsTrigger>
                  <TabsTrigger value="instructions">{t('tabs.instructions')}</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 mt-4">
                  <div>
                    <h3 className="font-semibold mb-2">{t('overview.usage')}</h3>
                    <code className="block bg-muted p-3 rounded-md font-mono text-sm">
                      {selectedCommand.usage}
                    </code>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-2">{t('overview.description')}</h3>
                    <p className="text-muted-foreground">{selectedCommand.description}</p>
                  </div>

                  {selectedCommand.filePath && (
                    <div>
                      <h3 className="font-semibold mb-2">{t('overview.filePath')}</h3>
                      <code className="block bg-muted p-3 rounded-md font-mono text-sm break-all">
                        {selectedCommand.filePath}
                      </code>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="useguide" className="space-y-4 mt-4">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <h3>{t('useguide.title')}</h3>

                    <div className="bg-muted p-4 rounded-md">
                      <h4 className="text-sm font-semibold mb-2">{t('useguide.basicUsage')}</h4>
                      <p className="text-sm mb-2">{t('useguide.basicUsageDesc')}</p>
                      <code className="block bg-background p-3 rounded-md font-mono text-sm">
                        {selectedCommand.usage}
                      </code>
                    </div>

                    <div className="bg-muted p-4 rounded-md mt-4">
                      <h4 className="text-sm font-semibold mb-2">{t('useguide.commandDescription')}</h4>
                      <p className="text-sm">{selectedCommand.description}</p>
                    </div>

                    {selectedCommand.location && (
                      <div className="bg-muted p-4 rounded-md mt-4">
                        <h4 className="text-sm font-semibold mb-2">{t('useguide.scope')}</h4>
                        <p className="text-sm">
                          {selectedCommand.location === 'user' ? (
                            <>
                              <Badge variant="default" className="mr-2">{t('useguide.userLevel')}</Badge>
                              {t('useguide.userLevelDesc')}
                            </>
                          ) : (
                            <>
                              <Badge variant="secondary" className="mr-2">{t('useguide.projectLevel')}</Badge>
                              {t('useguide.projectLevelDesc')}
                            </>
                          )}
                        </p>
                      </div>
                    )}

                    <div className="bg-muted p-4 rounded-md mt-4">
                      <h4 className="text-sm font-semibold mb-2">{t('useguide.usageSteps')}</h4>
                      <ol className="list-decimal list-inside space-y-2 text-sm">
                        <li>{t('useguide.step1')}</li>
                        <li>{t('useguide.step2')}</li>
                        <li>{t('useguide.step3')}</li>
                        <li>{t('useguide.step4')}</li>
                      </ol>
                    </div>

                    {selectedCommand.filePath && (
                      <div className="bg-muted p-4 rounded-md mt-4">
                        <h4 className="text-sm font-semibold mb-2">{t('useguide.editCommand')}</h4>
                        <p className="text-sm mb-2">{t('useguide.editCommandDesc')}</p>
                        <code className="block bg-background p-3 rounded-md font-mono text-xs break-all">
                          {selectedCommand.filePath}
                        </code>
                      </div>
                    )}

                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-4 rounded-md mt-4">
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        {t('useguide.tips')}
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-sm">
                        <li>{t('useguide.tip1')}</li>
                        <li>{t('useguide.tip2')}</li>
                        <li>{t('useguide.tip3')}</li>
                        <li>{t('useguide.tip4')}</li>
                      </ul>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="instructions" className="mt-4">
                  <div className="space-y-4">
                    <Textarea
                      value={selectedCommand.rawContent || selectedCommand.instructions || ''}
                      onChange={(e) => {
                        const updatedCommand = { ...selectedCommand, rawContent: e.target.value }
                        setSelectedCommand(updatedCommand)
                        setSaveSuccess(false)
                      }}
                      readOnly={cmdSource(selectedCommand) === 'plugin'}
                      className="min-h-[500px] font-mono text-sm"
                      placeholder={t('noInstructions')}
                    />
                    <div className="flex justify-end items-center gap-3">
                      {saveSuccess && (
                        <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                          <Check className="h-4 w-4" />
                          {t('saveSuccess', '保存成功')}
                        </span>
                      )}
                      <Button
                        onClick={async () => {
                          if (!selectedCommand) return

                          const content = selectedCommand.rawContent || ''

                          // 验证格式
                          const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
                          if (!frontmatterMatch) {
                            alert(t('errors.missingFrontmatter', '命令文件必须包含 frontmatter (--- ... ---)'))
                            return
                          }

                          // 检查是否有 description
                          const frontmatterContent = frontmatterMatch[1]
                          const hasDescription = /^description\s*:/m.test(frontmatterContent)
                          if (!hasDescription) {
                            alert(t('errors.missingDescription', '命令文件必须在 frontmatter 中包含 description 字段'))
                            return
                          }

                          // 检查 description 是否为空
                          const descMatch = frontmatterContent.match(/^description\s*:\s*(.*)$/m)
                          if (descMatch && !descMatch[1].trim()) {
                            alert(t('errors.emptyDescription', 'description 字段不能为空'))
                            return
                          }

                          setSaving(true)
                          setSaveSuccess(false)
                          try {
                            // 直接保存 rawContent 到文件
                            await api.commands.saveRaw(selectedCommand.name, content, selectedCommand.filePath || '')
                            // 重新加载命令
                            const updatedCommands = await api.commands.getAll()
                            setCommands(updatedCommands)
                            const updated = updatedCommands.find(c => c.filePath === selectedCommand.filePath) ?? updatedCommands.find(c => c.name === selectedCommand.name)
                            if (updated) setSelectedCommand(updated)
                            setSaveSuccess(true)
                            // 3秒后自动隐藏成功提示
                            setTimeout(() => setSaveSuccess(false), 3000)
                          } catch (error) {
                            console.error('[Commands Page] Failed to save:', error)
                            alert(t('errors.saveFailed') + ': ' + (error as Error).message)
                          } finally {
                            setSaving(false)
                          }
                        }}
                        disabled={saving || cmdSource(selectedCommand) === 'plugin'}
                      >
                        <Save className="h-4 w-4 mr-1" />
                        {saving ? t('dialog.saving') : t('dialog.save')}
                      </Button>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        ) : (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t('selectCommand')}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={isEditing || isCreating} onOpenChange={(open) => !open && handleCancelEdit()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>
              {isCreating ? t('dialog.createTitle') : `${t('dialog.editTitle')}: /${editForm.name}`}
            </DialogTitle>
            <DialogDescription>
              {isCreating
                ? t('dialog.createDescription')
                : t('dialog.editDescription')}
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

            <div className="space-y-2">
              <Label htmlFor="cmd-name">{t('dialog.name')}</Label>
              <Input
                id="cmd-name"
                placeholder={t('dialog.namePlaceholder')}
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                disabled={isEditing}
              />
              <p className="text-xs text-muted-foreground">
                {t('dialog.nameHint')} /{editForm.name || 'command-name'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cmd-location">{t('dialog.location')}</Label>
              <Select
                value={editForm.location}
                onValueChange={(value: 'user' | 'project') =>
                  setEditForm({ ...editForm, location: value, projectPath: value === 'user' ? '' : editForm.projectPath })
                }
                disabled={isEditing}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4" />
                      {t('dialog.locationProject')}
                    </div>
                  </SelectItem>
                  <SelectItem value="user">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      {t('dialog.locationUser')}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 项目路径选择 - 仅当选择 project 时显示 */}
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
                  <Button type="button" variant="outline" onClick={handleSelectProjectPath}>
                    <FolderOpen className="h-4 w-4 mr-1" />
                    {t('dialog.browse')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('dialog.projectPathHint')}: {editForm.projectPath ? `${editForm.projectPath}/.claude/commands/${editForm.name || 'command-name'}/` : t('dialog.projectPathRequired')}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="cmd-rawcontent">{t('dialog.rawContent', 'Markdown Content')}</Label>
              <Textarea
                id="cmd-rawcontent"
                placeholder={`---
description: ${t('dialog.descriptionPlaceholder')}
argument-hint: [arg1] [arg2?]
---

# Command Title

Your command instructions here...`}
                value={editForm.instructions}
                onChange={(e) => setEditForm({ ...editForm, instructions: e.target.value })}
                className="min-h-[400px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t('dialog.rawContentHint', 'Edit the complete markdown content including frontmatter (---...---)')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelEdit}>
              <X className="h-4 w-4 mr-1" />
              {t('dialog.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? t('dialog.saving') : t('dialog.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('deleteDialog.description')} (/{selectedCommand?.name})
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t('deleteDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-1" />
              {t('deleteDialog.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
