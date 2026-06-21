import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { Hook, HookExecutionLog, HookAction, HookSettingsMatcher } from '@shared/types'
import { makeEmptyAction } from './hooks/HookActionForm'
import type { HookActionItem } from './hooks/HookActionForm'
import { HooksLogsTab } from './hooks/HooksLogsTab'
import { HookEditDialog } from './hooks/HookEditDialog'
import type { EditFormState } from './hooks/hookEditTypes'
import { HOOK_TYPES } from './hooks/hookTypes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Search,
  Webhook,
  Globe,
  FolderOpen,
  Terminal,
  Code,
  Zap,
  ArrowRight,
  FileCode,
  HelpCircle,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function Hooks() {
  const { t } = useTranslation('hooks')
  const [hooks, setHooks] = useState<Hook[]>([])
  const [selectedHook, setSelectedHook] = useState<Hook | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [editForm, setEditForm] = useState<EditFormState>({
    name: '',
    type: 'SessionStart',
    description: '',
    enabled: true,
    location: 'user',
    projectPath: '',
    priority: 100,
    stopOnError: false,
    pattern: '',
    matcher: '',
    matcherIndex: undefined,
    actions: [makeEmptyAction()],
    reloadSkills: false,
    sessionTitle: '',
    maxBlocks: 8,
    replaceToolOutput: false,
    effort: undefined,
  })
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Execution logs state
  const [executionLogs, setExecutionLogs] = useState<HookExecutionLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [selectedLog, setSelectedLog] = useState<HookExecutionLog | null>(null)

  // Debug session state
  const [debugSessionPid, setDebugSessionPid] = useState<number | null>(null)
  const [debugSessionRunning, setDebugSessionRunning] = useState(false)
  const [debugSessionMessage, setDebugSessionMessage] = useState<string>('')

  useEffect(() => {
    loadHooks()
    loadExecutionLogs()
  }, [])

  const loadExecutionLogs = useCallback(async () => {
    try {
      setLogsLoading(true)
      // Load both manual test logs and real Claude Code debug logs
      const [manualLogs, debugLogs] = await Promise.all([
        api.hooks.getLogs(),
        api.hooks.getDebugLogs(),
      ])
      // Merge and sort by timestamp (newest first)
      const allLogs = [...manualLogs, ...debugLogs].sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      setExecutionLogs(allLogs)
      console.log('[Hooks Page] Loaded', manualLogs.length, 'manual logs and', debugLogs.length, 'debug logs')
    } catch (error) {
      console.error('[Hooks Page] Failed to load execution logs:', error)
    } finally {
      setLogsLoading(false)
    }
  }, [])

  const clearExecutionLogs = async () => {
    try {
      await api.hooks.clearLogs()
      setExecutionLogs([])
      setSelectedLog(null)
    } catch (error) {
      console.error('[Hooks Page] Failed to clear execution logs:', error)
    }
  }

  // Launch Claude Code in debug mode
  const launchDebugSession = async (hook: Hook) => {
    if (debugSessionRunning) {
      alert(t('logs.sessionAlreadyRunning', 'A debug session is already running'))
      return
    }

    setDebugSessionRunning(true)
    setDebugSessionMessage(t('logs.startingDebugSession', 'Starting Claude Code in debug mode...'))

    try {
      // Extract project path from hook if it's a project hook
      let projectPath: string | undefined
      if (hook.location === 'project' && hook.filePath) {
        const match = hook.filePath.match(/^(.+)\/\.claude\//)
        if (match) {
          projectPath = match[1]
        }
      }

      const result = await api.hooks.launchDebugSession(hook.type, projectPath)

      if (result.success) {
        setDebugSessionPid(result.pid || null)
        setDebugSessionMessage(result.message)

        // Wait for session to auto-terminate (30s) then refresh logs
        // Claude Code writes debug logs after session ends
        setTimeout(async () => {
          setDebugSessionRunning(false)
          setDebugSessionPid(null)
          setDebugSessionMessage(t('logs.sessionEnded', 'Debug session ended. Loading logs...'))
          // Wait a bit for logs to be written
          await new Promise(resolve => setTimeout(resolve, 2000))
          await loadExecutionLogs()
          setDebugSessionMessage(t('logs.logsLoaded', 'Logs loaded successfully'))
        }, 32000)
      } else {
        setDebugSessionMessage(result.message)
        setDebugSessionRunning(false)
      }
    } catch (error) {
      console.error('[Hooks Page] Failed to launch debug session:', error)
      setDebugSessionMessage(t('logs.launchFailed', 'Failed to start debug session') + ': ' + (error as Error).message)
      setDebugSessionRunning(false)
    }
  }

  // Stop debug session manually
  const stopDebugSession = async () => {
    if (!debugSessionPid) return

    try {
      await api.hooks.stopDebugSession(debugSessionPid)
      setDebugSessionRunning(false)
      setDebugSessionPid(null)
      setDebugSessionMessage(t('logs.sessionStopped', 'Debug session stopped. Loading logs...'))
      // Wait for logs to be written before refreshing
      await new Promise(resolve => setTimeout(resolve, 2000))
      await loadExecutionLogs()
      setDebugSessionMessage(t('logs.logsLoaded', 'Logs loaded successfully'))
    } catch (error) {
      console.error('[Hooks Page] Failed to stop debug session:', error)
    }
  }

  const loadHooks = async () => {
    try {
      console.log('[Hooks Page] Loading hooks...')
      setLoading(true)
      const data = await api.hooks.getAll()
      console.log('[Hooks Page] Loaded', data.length, 'hooks with matcherIndex:', data.map(h => ({ name: h.name, matcherIndex: h.matcherIndex })))
      setHooks(data)

      // Update selectedHook with fresh data (including matcherIndex)
      if (selectedHook) {
        const updated = data.find(h => h.name === selectedHook.name && h.type === selectedHook.type)
        if (updated) {
          console.log('[Hooks Page] Updating selectedHook with fresh data, matcherIndex:', updated.matcherIndex)
          setSelectedHook(updated)
        }
      } else if (data.length > 0) {
        setSelectedHook(data[0])
      }
    } catch (error) {
      console.error('[Hooks Page] Failed to load hooks:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredHooks = hooks.filter((hook) =>
    hook.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    hook.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleEdit = async (hook: Hook) => {
    console.log('[Hooks Page] handleEdit called with hook:', hook.name, 'matcherIndex:', hook.matcherIndex)
    let projectPath = ''
    if (hook.filePath && hook.location === 'project') {
      const match = hook.filePath.match(/^(.+)\/\.claude\//)
      if (match) {
        projectPath = match[1]
      }
    }

    // Convert domain HookActions into the editing model
    const actions: HookActionItem[] = (hook.actions?.length ? hook.actions : []).map((action) => {
      const item = makeEmptyAction()
      // Map legacy abstract verbs to command, http/prompt stay as-is
      const rawType = action.type
      item.type = rawType === 'http' || rawType === 'prompt' ? rawType : 'command'
      item.timeout = action.timeout ?? 60000
      item.continueOnError = action.continueOnError ?? false
      item.continueOnBlock = action.continueOnBlock ?? false
      item.terminalSequence = action.terminalSequence ?? ''

      if (item.type === 'command') {
        const cmd = action.command || action.handler || ''
        const isScript = cmd.endsWith('.sh') || cmd.startsWith('.claude/hooks/')
        item.command = cmd
        item.useScriptFile = isScript
        item.scriptPath = isScript ? cmd : ''
        item.args = action.args ? [...action.args] : []
      } else if (item.type === 'http') {
        item.url = action.url ?? ''
        item.method = action.method ?? 'POST'
        item.headers = action.headers
          ? Object.entries(action.headers).map(([key, value]) => ({ key, value }))
          : []
        item.body = action.body ?? ''
      } else if (item.type === 'prompt') {
        item.prompt = action.prompt ?? ''
      }
      return item
    })
    if (actions.length === 0) actions.push(makeEmptyAction())

    // Load script content for each script file
    for (const item of actions) {
      if (item.type === 'command' && item.useScriptFile && item.scriptPath) {
        try {
          const content = await api.hooks.readScript(item.scriptPath, hook.location || 'user', projectPath || undefined)
          if (content) item.scriptContent = content
        } catch (error) {
          console.error('[Hooks Page] Failed to read script content:', error)
        }
      }
    }

    setEditForm({
      name: hook.name,
      type: hook.type,
      description: hook.description || '',
      enabled: hook.enabled,
      location: hook.location || 'user',
      projectPath,
      priority: hook.priority || 100,
      stopOnError: hook.stopOnError || false,
      pattern: hook.pattern || '',
      matcher: hook.pattern || '',
      matcherIndex: hook.matcherIndex, // Track the index for updating
      actions,
      reloadSkills: hook.sessionStart?.reloadSkills ?? false,
      sessionTitle: hook.sessionStart?.sessionTitle ?? '',
      maxBlocks: hook.maxBlocks ?? 8,
      replaceToolOutput: hook.replaceToolOutput ?? false,
      effort: hook.effort,
    })
    setIsEditing(true)
    setIsCreating(false)
  }

  const handleCreate = () => {
    setEditForm({
      name: '',
      type: 'SessionStart',
      description: '',
      enabled: true,
      location: 'user',
      projectPath: '',
      priority: 100,
      stopOnError: false,
      pattern: '',
      matcher: '',
      matcherIndex: undefined,
      actions: [makeEmptyAction()],
      reloadSkills: false,
      sessionTitle: '',
      maxBlocks: 8,
      replaceToolOutput: false,
      effort: undefined,
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
      console.error('[Hooks Page] Failed to select project path:', error)
    }
  }

  // Convert an editing action item into a domain HookAction
  // 单一来源：preview 与保存都用它构建 HookSettingsMatcher，避免序列化逻辑分叉
  const buildHookConfig = (actions: HookActionItem[]): HookSettingsMatcher => {
    const cfg: HookSettingsMatcher = {
      matcher: editForm.matcher || undefined,
      hooks: actions.map(actionItemToDomain),
    }
    if (editForm.type === 'SessionStart') {
      if (editForm.reloadSkills) cfg.reloadSkills = true
      if (editForm.sessionTitle.trim()) cfg.sessionTitle = editForm.sessionTitle.trim()
    }
    if (editForm.type === 'PostToolUse' && editForm.replaceToolOutput) cfg.replaceToolOutput = true
    // 仅在偏离默认 8 时写 maxBlocks，避免给每个 Stop hook 注入冗余的默认值
    if ((editForm.type === 'Stop' || editForm.type === 'StopFailure') && editForm.maxBlocks !== 8) {
      cfg.maxBlocks = editForm.maxBlocks
    }
    return cfg
  }

  const actionItemToDomain = (item: HookActionItem): HookAction => {
    const base: HookAction = {
      type: item.type,
      timeout: item.timeout,
      continueOnError: item.continueOnError || undefined,
      continueOnBlock: item.continueOnBlock || undefined,
      terminalSequence: item.terminalSequence.trim() || undefined,
    }
    if (item.type === 'command') {
      const commandValue = item.useScriptFile ? item.scriptPath : item.command
      if (commandValue.trim()) base.command = commandValue
      if (item.args.some((a) => a.trim())) base.args = item.args.filter((a) => a.trim())
    } else if (item.type === 'http') {
      base.url = item.url.trim() || undefined
      base.method = item.method
      const headerEntries = item.headers.filter((h) => h.key.trim())
      if (headerEntries.length > 0) {
        base.headers = Object.fromEntries(headerEntries.map((h) => [h.key.trim(), h.value]))
      }
      if (item.body.trim()) base.body = item.body
    } else if (item.type === 'prompt') {
      if (item.prompt.trim()) base.prompt = item.prompt
    }
    return base
  }

  const handleSave = async () => {
    const errors: string[] = []

    // Validate hook type
    if (!editForm.type || !HOOK_TYPES.includes(editForm.type)) {
      errors.push(t('errors.typeRequired'))
    }

    // Keep actions that have meaningful content for their type
    const validActions = editForm.actions.filter((item) => {
      if (item.type === 'command') {
        if (item.useScriptFile) return item.scriptPath.trim() && item.scriptContent.trim()
        return item.command.trim() || item.args.some((a) => a.trim())
      }
      if (item.type === 'http') return item.url.trim()
      if (item.type === 'prompt') return item.prompt.trim()
      return false
    })
    if (validActions.length === 0) {
      errors.push(t('errors.actionsRequired'))
    }

    // Validate project path for project hooks
    if (editForm.location === 'project' && !editForm.projectPath) {
      errors.push(t('errors.projectPathRequired'))
    }

    if (errors.length > 0) {
      setValidationErrors(errors)
      return
    }

    const hookConfig = buildHookConfig(validActions)

    // Backend ajv validation before saving（用与保存完全相同的 actions，避免双校验对象分叉）
    try {
      const synthesized: Hook = {
        name: editForm.name,
        type: editForm.type,
        enabled: true,
        description: editForm.description,
        actions: hookConfig.hooks,
      }
      const result = await api.hooks.validateHook(synthesized)
      if (!result.valid) {
        setValidationErrors(result.errors)
        return
      }
    } catch (error) {
      setValidationErrors([(error as Error).message])
      return
    }

    setValidationErrors([])
    setSaving(true)
    try {
      // First, create script files if needed
      for (const item of validActions) {
        if (item.type === 'command' && item.useScriptFile && item.scriptPath && item.scriptContent) {
          console.log('[Hooks Page] Creating script file:', item.scriptPath)
          await api.hooks.createScript(
            item.scriptPath,
            item.scriptContent,
            editForm.location,
            editForm.projectPath || undefined
          )
        }
      }

      // When editing, pass matcherIndex to update instead of adding new
      const matcherIndexToUse = isEditing ? editForm.matcherIndex : undefined
      console.log('[Hooks Page] Saving hook to settings:', editForm.type, hookConfig, 'matcherIndex:', matcherIndexToUse)
      await api.hooks.saveToSettings(
        editForm.type,
        hookConfig,
        editForm.location,
        editForm.projectPath || undefined,
        matcherIndexToUse
      )

      const updatedHooks = await api.hooks.getAll()
      setHooks(updatedHooks)

      // Try to find and select the newly created hook
      const newHook = updatedHooks.find((h) =>
        h.type === editForm.type &&
        h.pattern === (editForm.matcher || '')
      )
      if (newHook) setSelectedHook(newHook)

      setIsEditing(false)
      setIsCreating(false)
      setValidationErrors([])
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (error) {
      console.error('[Hooks Page] Failed to save hook:', error)
      alert(t('errors.saveFailed') + ': ' + (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedHook) return

    try {
      console.log('[Hooks Page] Deleting hook:', selectedHook.name, 'matcherIndex:', selectedHook.matcherIndex)

      // If hook has matcherIndex, use deleteFromSettings (for settings.json hooks)
      // Otherwise fall back to the legacy delete method
      if (selectedHook.matcherIndex !== undefined) {
        // Get project path from filePath if it's a project hook
        let projectPath: string | undefined
        if (selectedHook.location === 'project' && selectedHook.filePath) {
          const match = selectedHook.filePath.match(/^(.+)\/\.claude\//)
          if (match) {
            projectPath = match[1]
          }
        }

        await api.hooks.deleteFromSettings(
          selectedHook.type,
          selectedHook.matcherIndex,
          selectedHook.location || 'user',
          projectPath
        )
      } else {
        // Legacy hooks stored as separate JSON files
        await api.hooks.delete(selectedHook.name)
      }

      setDeleteDialogOpen(false)
      setSelectedHook(null)
      await loadHooks()
    } catch (error) {
      console.error('[Hooks Page] Failed to delete hook:', error)
      alert(t('errors.deleteFailed') + ': ' + (error as Error).message)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setIsCreating(false)
    setValidationErrors([])
  }

  const userHooks = filteredHooks.filter((h) => h.location === 'user')
  const projectHooks = filteredHooks.filter((h) => h.location === 'project')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-lg font-semibold mb-2">{t('loading')}</div>
          <div className="text-muted-foreground">{t('common:pleaseWait', 'Please wait')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-4">
      {/* Left Sidebar - Hooks List */}
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
          {t('newHook')}
        </Button>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4" />
                {t('stats.userHooks')}
              </CardTitle>
              <div className="text-2xl font-bold">{userHooks.length}</div>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                {t('stats.projectHooks')}
              </CardTitle>
              <div className="text-2xl font-bold">{projectHooks.length}</div>
            </CardHeader>
          </Card>
        </div>

        {/* Hooks List */}
        <div className="flex-1 overflow-auto space-y-2">
          {filteredHooks.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <Webhook className="h-12 w-12 mx-auto mb-4 opacity-50" />
                {searchQuery ? t('noSearchResults') : (
                  <>
                    <p>{t('noHooks')}</p>
                    <p className="text-sm mt-2">{t('noHooksHint')}</p>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            filteredHooks.map((hook) => (
              <Card
                key={hook.filePath || hook.name}
                className={cn(
                  'cursor-pointer transition-all hover:border-primary',
                  selectedHook?.name === hook.name && 'border-primary bg-accent'
                )}
                onClick={() => setSelectedHook(hook)}
              >
                <CardHeader className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Webhook className="h-4 w-4 shrink-0" />
                        <span className="truncate">{hook.name}</span>
                      </CardTitle>
                      {hook.description && (
                        <CardDescription className="text-sm mt-1 line-clamp-2">
                          {hook.description}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <Badge variant={hook.location === 'user' ? 'default' : 'secondary'}>
                      {hook.location === 'user' ? (
                        <><Globe className="h-3 w-3 mr-1" /> {t('user')}</>
                      ) : (
                        <><FolderOpen className="h-3 w-3 mr-1" /> {t('project')}</>
                      )}
                    </Badge>
                    <Badge variant="outline">{hook.type}</Badge>
                    {hook.enabled ? (
                      <Badge variant="outline" className="text-green-600">{t('enabled')}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-red-600">{t('disabled')}</Badge>
                    )}
                  </div>
                </CardHeader>
              </Card>
            ))
          )}
        </div>

        {/* Info Box */}
        <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <CardContent className="p-4">
            <h4 className="font-semibold text-sm mb-2">{t('aboutHooks')}</h4>
            <p className="text-xs text-muted-foreground">{t('aboutHooksDesc')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Right Panel - Hook Details */}
      <div className="flex-1 overflow-auto">
        {selectedHook ? (
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <Webhook className="h-6 w-6" />
                    {selectedHook.name}
                  </CardTitle>
                  {selectedHook.description && (
                    <CardDescription className="mt-2">{selectedHook.description}</CardDescription>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleEdit(selectedHook)}>
                    <Pencil className="h-4 w-4 mr-1" />
                    {t('edit')}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    {t('delete')}
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 mt-4 flex-wrap">
                <Badge variant={selectedHook.location === 'user' ? 'default' : 'secondary'}>
                  {selectedHook.location === 'user' ? t('user') : t('project')}
                </Badge>
                <Badge variant="outline">{selectedHook.type}</Badge>
                {selectedHook.enabled ? (
                  <Badge variant="outline" className="text-green-600">{t('enabled')}</Badge>
                ) : (
                  <Badge variant="outline" className="text-red-600">{t('disabled')}</Badge>
                )}
                {selectedHook.priority && (
                  <Badge variant="outline">Priority: {selectedHook.priority}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="details" className="w-full">
                <TabsList>
                  <TabsTrigger value="details">{t('tabs.details')}</TabsTrigger>
                  <TabsTrigger value="actions">{t('tabs.actions')}</TabsTrigger>
                  <TabsTrigger value="config">{t('tabs.config')}</TabsTrigger>
                  <TabsTrigger value="logs">{t('tabs.logs')}</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="space-y-4 mt-4">
                  {/* Hook Flow Visualization */}
                  <Card className="border-2">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Zap className="h-5 w-5" />
                        {t('flow.title')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between gap-4 p-4 bg-muted rounded-lg">
                        <div className="flex-1 text-center">
                          <div className="flex justify-center mb-2">
                            <Terminal className="h-8 w-8 text-blue-500" />
                          </div>
                          <p className="font-semibold text-sm">{t(`events.${selectedHook.type}.title`, selectedHook.type)}</p>
                          <p className="text-xs text-muted-foreground mt-1">{t('flow.eventTriggered')}</p>
                        </div>

                        <ArrowRight className="h-6 w-6 text-muted-foreground" />

                        <div className="flex-1 text-center">
                          <div className="flex justify-center mb-2">
                            <Webhook className="h-8 w-8 text-purple-500" />
                          </div>
                          <p className="font-semibold text-sm">{t('flow.hookExecutes')}</p>
                          <p className="text-xs text-muted-foreground mt-1">{selectedHook.name}</p>
                        </div>

                        <ArrowRight className="h-6 w-6 text-muted-foreground" />

                        <div className="flex-1 text-center">
                          <div className="flex justify-center mb-2">
                            <Code className="h-8 w-8 text-green-500" />
                          </div>
                          <p className="font-semibold text-sm">{t('flow.actionsRun')}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {selectedHook.actions?.length || 0} action(s)
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Pattern */}
                  {selectedHook.pattern && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">{t('details.pattern')}</h3>
                      <div className="bg-muted rounded-lg p-4">
                        <p className="text-sm font-mono">{selectedHook.pattern}</p>
                      </div>
                    </div>
                  )}

                  {/* Conditions */}
                  {selectedHook.conditions && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2">{t('details.conditions')}</h3>
                      <div className="bg-muted rounded-lg p-4 space-y-2">
                        {selectedHook.conditions.commands && (
                          <div>
                            <span className="text-xs text-muted-foreground">{t('details.commands')}:</span>
                            <p className="text-sm font-mono">{selectedHook.conditions.commands.join(', ')}</p>
                          </div>
                        )}
                        {selectedHook.conditions.branches && (
                          <div>
                            <span className="text-xs text-muted-foreground">{t('details.branches')}:</span>
                            <p className="text-sm font-mono">{selectedHook.conditions.branches.join(', ')}</p>
                          </div>
                        )}
                        {selectedHook.conditions.filePatterns && (
                          <div>
                            <span className="text-xs text-muted-foreground">{t('details.filePatterns')}:</span>
                            <p className="text-sm font-mono">{selectedHook.conditions.filePatterns.join(', ')}</p>
                          </div>
                        )}
                        {selectedHook.conditions.tools && (
                          <div>
                            <span className="text-xs text-muted-foreground">{t('details.tools')}:</span>
                            <p className="text-sm font-mono">{selectedHook.conditions.tools.join(', ')}</p>
                          </div>
                        )}
                        {selectedHook.conditions.customCondition && (
                          <div>
                            <span className="text-xs text-muted-foreground">{t('details.customCondition')}:</span>
                            <p className="text-sm font-mono">{selectedHook.conditions.customCondition}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* File Path */}
                  {selectedHook.filePath && (
                    <div>
                      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <FileCode className="h-4 w-4" />
                        {t('details.filePath')}
                      </h3>
                      <div className="bg-muted rounded-lg p-4">
                        <p className="text-sm font-mono break-all">{selectedHook.filePath}</p>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="actions" className="space-y-4 mt-4">
                  <h3 className="text-lg font-semibold">{t('actions.title')}</h3>
                  {selectedHook.actions && selectedHook.actions.length > 0 ? (
                    <div className="space-y-4">
                      {selectedHook.actions.map((action, index) => (
                        <Card key={index}>
                          <CardHeader className="p-4">
                            <CardTitle className="text-base flex items-center gap-2">
                              <Badge variant="outline">
                                {t(`actions.types.${action.type}`, action.type)}
                              </Badge>
                              <span className="text-muted-foreground text-sm">
                                Action {index + 1}
                              </span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-0 space-y-2">
                            {action.handler && (
                              <div>
                                <span className="text-xs text-muted-foreground">{t('actions.handler')}:</span>
                                <p className="text-sm font-mono">{action.handler}</p>
                              </div>
                            )}
                            {action.command && (
                              <div>
                                <span className="text-xs text-muted-foreground">{t('actions.command')}:</span>
                                <p className="text-sm font-mono">{action.command}</p>
                              </div>
                            )}
                            {action.timeout && (
                              <div>
                                <span className="text-xs text-muted-foreground">{t('actions.timeout')}:</span>
                                <p className="text-sm">{action.timeout}ms</p>
                              </div>
                            )}
                            <div>
                              <span className="text-xs text-muted-foreground">{t('actions.continueOnError')}:</span>
                              <p className="text-sm">{action.continueOnError ? t('actions.yes') : t('actions.no')}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <HelpCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No actions defined</p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="config" className="space-y-4 mt-4">
                  <div className="p-4 bg-muted rounded-lg">
                    <h3 className="text-sm font-semibold mb-3">Hook Configuration (JSON)</h3>
                    <pre className="text-xs font-mono bg-background p-3 rounded overflow-auto max-h-96">
                      {JSON.stringify(
                        {
                          name: selectedHook.name,
                          type: selectedHook.type,
                          enabled: selectedHook.enabled,
                          description: selectedHook.description,
                          pattern: selectedHook.pattern,
                          conditions: selectedHook.conditions,
                          actions: selectedHook.actions,
                          stopOnError: selectedHook.stopOnError,
                          priority: selectedHook.priority,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>

                  <div className="p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <HelpCircle className="h-4 w-4" />
                      {t('howToCreate.title')}
                    </h3>
                    <ol className="text-sm space-y-2 mt-3">
                      <li className="flex gap-2">
                        <span className="font-semibold">1.</span>
                        <span>{t('howToCreate.step1')}</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold">2.</span>
                        <span>{t('howToCreate.step2')}</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold">3.</span>
                        <span>{t('howToCreate.step3')}</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-semibold">4.</span>
                        <span>{t('howToCreate.step4')}</span>
                      </li>
                    </ol>
                  </div>
                </TabsContent>

                <TabsContent value="logs" className="space-y-4 mt-4">
                  <HooksLogsTab
                    selectedHook={selectedHook}
                    executionLogs={executionLogs}
                    logsLoading={logsLoading}
                    selectedLog={selectedLog}
                    setSelectedLog={setSelectedLog}
                    debugSessionRunning={debugSessionRunning}
                    debugSessionMessage={debugSessionMessage}
                    onRefreshLogs={loadExecutionLogs}
                    onClearLogs={clearExecutionLogs}
                    onLaunchDebug={() => launchDebugSession(selectedHook)}
                    onStopDebug={stopDebugSession}
                    t={t}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        ) : (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center">
              <Webhook className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">{t('selectHook')}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Edit/Create Dialog */}
      <HookEditDialog
        open={isEditing || isCreating}
        isCreating={isCreating}
        editForm={editForm}
        setEditForm={setEditForm}
        validationErrors={validationErrors}
        saving={saving}
        saveSuccess={saveSuccess}
        onSave={handleSave}
        onCancel={handleCancelEdit}
        onSelectProjectPath={handleSelectProjectPath}
        buildHookConfig={buildHookConfig}
        t={t}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('deleteDialog.description')} ({selectedHook?.name})
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
