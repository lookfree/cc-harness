import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { Hook, HookAction, HookSimInput, HookDryRunResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import { Play, AlertTriangle, CheckCircle, XCircle, ArrowLeftRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

// Determine whether this is the Electron desktop environment
const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI)

interface Props {
  hook: Hook
}

type Decision = HookDryRunResult['decision']

const DECISION_CONFIG: Record<Decision, { label: string; icon: React.ElementType; className: string }> = {
  allow:     { label: 'decision.allow',     icon: CheckCircle,     className: 'text-green-600 border-green-600' },
  block:     { label: 'decision.block',     icon: XCircle,         className: 'text-red-600 border-red-600' },
  transform: { label: 'decision.transform', icon: ArrowLeftRight,  className: 'text-blue-600 border-blue-600' },
  none:      { label: 'decision.none',      icon: Minus,           className: 'text-muted-foreground' },
}

export function HookSandbox({ hook }: Props) {
  const { t } = useTranslation('hooks')

  const [actionIndex, setActionIndex] = useState(0)
  const [toolName, setToolName] = useState('Bash')
  const [toolInputJson, setToolInputJson] = useState('{"command":"echo hello"}')
  const [toolOutputJson, setToolOutputJson] = useState('{"output":"hello"}')
  const [promptText, setPromptText] = useState('Hello, this is a test prompt')
  const [messageText, setMessageText] = useState('Hello from Claude')
  const [sessionId, setSessionId] = useState('dryrun-session')
  const [cwd] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(10000)
  const [allowNetwork, setAllowNetwork] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<HookDryRunResult | null>(null)

  const selectedAction: HookAction | undefined = hook.actions?.[actionIndex]
  const actionType = selectedAction?.type === 'http' || selectedAction?.type === 'prompt'
    ? selectedAction.type : 'command'
  const hookType = hook.type

  function buildInput(): HookSimInput {
    const base: HookSimInput = {
      hookType,
      sessionId: sessionId || 'dryrun-session',
      cwd: cwd || undefined,
      timeoutMs,
      allowNetwork,
    }
    if (hookType === 'PreToolUse' || hookType === 'PostToolUse') {
      base.toolName = toolName
      try { base.toolInput = JSON.parse(toolInputJson) } catch { base.toolInput = { command: toolInputJson } }
      if (hookType === 'PostToolUse') {
        try { base.toolOutput = JSON.parse(toolOutputJson) } catch { base.toolOutput = toolOutputJson }
      }
    } else if (hookType === 'UserPromptSubmit') {
      base.prompt = promptText
    } else if (hookType === 'MessageDisplay') {
      base.message = messageText
    }
    return base
  }

  async function run() {
    if (!selectedAction) return
    setRunning(true)
    setResult(null)
    try {
      const res = await api.hooks.dryRun(hook, actionIndex, buildInput())
      setResult(res)
    } catch (err) {
      setResult({
        hookName: hook.name,
        hookType: hook.type,
        actionType,
        exitCode: null,
        stdout: '',
        stderr: '',
        decision: 'none',
        error: (err as Error).message,
        durationMs: 0,
        timedOut: false,
      })
    } finally {
      setRunning(false)
    }
  }

  function handleRunClick() {
    if (actionType === 'command') { setShowConfirm(true); return }
    if (actionType === 'http' && !allowNetwork) {
      // nudge user to enable network
      setResult({ hookName: hook.name, hookType: hook.type, actionType, exitCode: null, stdout: '', stderr: '', decision: 'none', error: t('sandbox.networkDisabledHint'), durationMs: 0, timedOut: false })
      return
    }
    run()
  }

  if (!isElectron) {
    return (
      <div className="flex items-center gap-2 p-4 bg-muted rounded-lg text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {t('sandbox.webDisabled')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Action selector */}
      {hook.actions && hook.actions.length > 1 && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('sandbox.selectAction')}</Label>
          <Select value={String(actionIndex)} onValueChange={(v) => setActionIndex(Number(v))}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hook.actions.map((a, i) => (
                <SelectItem key={i} value={String(i)}>
                  [{a.type}] {a.command ?? a.url ?? a.prompt?.slice(0, 40) ?? `Action ${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* sim input fields */}
      <div className="space-y-3">
        {(hookType === 'PreToolUse' || hookType === 'PostToolUse') && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('sandbox.fields.toolName')}</Label>
              <Input className="h-8 text-sm font-mono" value={toolName} onChange={(e) => setToolName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t('sandbox.fields.toolInput')}</Label>
              <Textarea className="text-sm font-mono h-20" value={toolInputJson} onChange={(e) => setToolInputJson(e.target.value)} />
            </div>
            {hookType === 'PostToolUse' && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('sandbox.fields.toolOutput')}</Label>
                <Textarea className="text-sm font-mono h-16" value={toolOutputJson} onChange={(e) => setToolOutputJson(e.target.value)} />
              </div>
            )}
          </>
        )}
        {hookType === 'UserPromptSubmit' && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('sandbox.fields.prompt')}</Label>
            <Textarea className="text-sm h-16" value={promptText} onChange={(e) => setPromptText(e.target.value)} />
          </div>
        )}
        {hookType === 'MessageDisplay' && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('sandbox.fields.message')}</Label>
            <Textarea className="text-sm h-16" value={messageText} onChange={(e) => setMessageText(e.target.value)} />
          </div>
        )}

        {/* advanced */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('sandbox.fields.timeout')}</Label>
            <Input
              className="h-8 text-sm"
              type="number"
              min={1000}
              max={30000}
              step={1000}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('sandbox.fields.sessionId')}</Label>
            <Input className="h-8 text-sm font-mono" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          </div>
        </div>

        {actionType === 'http' && (
          <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
            <Switch checked={allowNetwork} onCheckedChange={setAllowNetwork} id="allow-network" />
            <Label htmlFor="allow-network" className="text-sm cursor-pointer">{t('sandbox.fields.allowNetwork')}</Label>
          </div>
        )}
      </div>

      {/* prompt action: just show template */}
      {actionType === 'prompt' && (
        <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">{t('sandbox.promptPreview')}</p>
          <pre className="whitespace-pre-wrap text-xs font-mono">{selectedAction?.prompt ?? ''}</pre>
        </div>
      )}

      {/* command warning banner */}
      {actionType === 'command' && (
        <div className="flex items-start gap-2 p-3 bg-orange-50 dark:bg-orange-950 rounded-lg text-xs text-orange-800 dark:text-orange-200">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          {t('sandbox.cmdWarningBanner')}
        </div>
      )}

      <Button size="sm" onClick={handleRunClick} disabled={running || actionType === 'prompt'} className="w-full">
        {running ? t('sandbox.running') : (
          <><Play className="h-3 w-3 mr-1" />{t('sandbox.runBtn')}</>
        )}
      </Button>

      {/* result */}
      {result && <SandboxResult result={result} t={t} />}

      {/* confirm dialog for command actions */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              {t('sandbox.cmdConfirmTitle')}
            </DialogTitle>
            <DialogDescription>{t('sandbox.cmdConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>{t('sandbox.cancel')}</Button>
            <Button onClick={() => { setShowConfirm(false); run() }}>{t('sandbox.runBtn')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SandboxResult({ result, t }: { result: HookDryRunResult; t: (k: string, opts?: Record<string, unknown>) => string }) {
  const cfg = DECISION_CONFIG[result.decision]
  const Icon = cfg.icon

  return (
    <div className="border rounded-lg overflow-hidden space-y-0 divide-y text-sm">
      {/* header */}
      <div className="flex items-center justify-between p-3 bg-muted/50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('sandbox.result.decision')}</span>
          <Badge variant="outline" className={cn('gap-1', cfg.className)}>
            <Icon className="h-3 w-3" />
            {t(cfg.label)}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{result.durationMs}ms</span>
          {result.exitCode !== null && (
            <span>{t('sandbox.result.exitCode')}: {result.exitCode}</span>
          )}
          {result.timedOut && (
            <Badge variant="destructive" className="text-xs">{t('sandbox.result.timedOut')}</Badge>
          )}
          {result.httpStatus !== undefined && (
            <span>HTTP {result.httpStatus}</span>
          )}
        </div>
      </div>

      {result.blockReason && (
        <div className="p-3">
          <span className="text-xs text-muted-foreground">{t('sandbox.result.blockReason')}: </span>
          <span className="text-red-600 font-medium">{result.blockReason}</span>
        </div>
      )}

      {result.error && (
        <div className="p-3">
          <span className="text-xs text-muted-foreground">{t('sandbox.result.error')}: </span>
          <span className="text-red-600">{result.error}</span>
        </div>
      )}

      {result.transformedOutput !== undefined && (
        <div className="p-3 space-y-1">
          <p className="text-xs text-muted-foreground">{t('sandbox.result.transform')}</p>
          <pre className="text-xs font-mono bg-muted p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
            {typeof result.transformedOutput === 'string' ? result.transformedOutput : JSON.stringify(result.transformedOutput, null, 2)}
          </pre>
        </div>
      )}

      {result.stdout && (
        <div className="p-3 space-y-1">
          <p className="text-xs text-muted-foreground">{t('sandbox.result.stdout')}</p>
          <pre className="text-xs font-mono bg-muted p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">{result.stdout}</pre>
        </div>
      )}

      {result.stderr && (
        <div className="p-3 space-y-1">
          <p className="text-xs text-muted-foreground">{t('sandbox.result.stderr')}</p>
          <pre className="text-xs font-mono bg-muted p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap text-yellow-700 dark:text-yellow-400">{result.stderr}</pre>
        </div>
      )}
    </div>
  )
}
