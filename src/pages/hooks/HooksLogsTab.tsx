import type { TFunction } from 'i18next'
import type { Hook, HookExecutionLog } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  FileCode,
  Trash2,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  History,
  Timer,
  Bug,
  Square,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface HooksLogsTabProps {
  selectedHook: Hook
  executionLogs: HookExecutionLog[]
  logsLoading: boolean
  selectedLog: HookExecutionLog | null
  setSelectedLog: (log: HookExecutionLog | null) => void
  debugSessionRunning: boolean
  debugSessionMessage: string
  onRefreshLogs: () => void
  onClearLogs: () => void
  onLaunchDebug: () => void
  onStopDebug: () => void
  t: TFunction
}

export function HooksLogsTab({
  selectedHook,
  executionLogs,
  logsLoading,
  selectedLog,
  setSelectedLog,
  debugSessionRunning,
  debugSessionMessage,
  onRefreshLogs,
  onClearLogs,
  onLaunchDebug,
  onStopDebug,
  t,
}: HooksLogsTabProps) {
  return (
    <>
      {/* Test Button and Actions */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <History className="h-5 w-5" />
          {t('logs.title')}
        </h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshLogs}
            disabled={logsLoading}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", logsLoading && "animate-spin")} />
            {t('logs.refresh')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClearLogs}
            disabled={executionLogs.length === 0}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {t('logs.clear')}
          </Button>
          {/* Debug Session Button */}
          {debugSessionRunning ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={onStopDebug}
            >
              <Square className="h-4 w-4 mr-1" />
              {t('logs.stopDebug', 'Stop Debug')}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => onLaunchDebug()}
            >
              <Bug className="h-4 w-4 mr-1" />
              {t('logs.launchDebug', 'Launch Debug')}
            </Button>
          )}
        </div>
      </div>

      {/* Debug Session Status */}
      {debugSessionMessage && (
        <div className={cn(
          "rounded-lg p-3 border",
          debugSessionRunning
            ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
            : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800"
        )}>
          <div className="flex items-center gap-2">
            {debugSessionRunning && (
              <RefreshCw className="h-4 w-4 text-green-600 animate-spin" />
            )}
            <p className={cn(
              "text-sm",
              debugSessionRunning ? "text-green-700 dark:text-green-300" : "text-gray-700 dark:text-gray-300"
            )}>
              {debugSessionMessage}
            </p>
          </div>
          {debugSessionRunning && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              {t('logs.debugSessionRunning', 'Debug session is running. Logs will auto-refresh. Click "Stop Debug" to end early.')}
            </p>
          )}
        </div>
      )}

      {/* Info about real logs */}
      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          {t('logs.debugLogsHint', 'Showing real Claude Code execution logs from ~/.claude/debug/. Click "Launch Debug" to start Claude Code in debug mode and capture hook execution logs.')}
        </p>
      </div>

      {/* Execution Logs List - filtered by selected hook type */}
      {logsLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          <RefreshCw className="h-8 w-8 mx-auto mb-3 animate-spin" />
          <p>{t('logs.loading')}</p>
        </div>
      ) : (() => {
        // Filter logs by selected hook type
        const filteredLogs = selectedHook
          ? executionLogs.filter(log => log.hookType === selectedHook.type)
          : executionLogs

        return filteredLogs.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>{selectedHook ? t('logs.noLogsForHook', { type: selectedHook.type }) : t('logs.noLogs')}</p>
          <p className="text-sm mt-2">{t('logs.noLogsHint')}</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-auto">
          {filteredLogs.map((log) => (
            <div key={log.id}>
              <Card
                className={cn(
                  "cursor-pointer transition-all hover:border-primary",
                  selectedLog?.id === log.id && "border-primary bg-accent"
                )}
                onClick={() => setSelectedLog(selectedLog?.id === log.id ? null : log)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {log.status === 'success' && (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      )}
                      {log.status === 'failed' && (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                      {log.status === 'timeout' && (
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                      )}
                      {log.status === 'blocked' && (
                        <AlertCircle className="h-4 w-4 text-orange-500" />
                      )}
                      <Badge variant="outline" className="text-xs">
                        {log.hookType}
                      </Badge>
                      <span className="text-sm font-medium">{log.trigger}</span>
                      <Badge
                        variant={log.status === 'success' ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        {t(`logs.status.${log.status}`)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {log.duration > 0 && (
                        <span className="flex items-center gap-1">
                          <Timer className="h-3 w-3" />
                          {log.duration}ms
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground font-mono truncate">
                    {log.command || log.output || log.hookName}
                  </div>
                </CardContent>
              </Card>

              {/* Expanded Log Details - shown below the selected log */}
              {selectedLog?.id === log.id && (
                <div className="mt-1 ml-4 border-l-2 border-primary pl-4 pb-2">
                  <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-medium text-sm">
                        <FileCode className="h-4 w-4" />
                        {t('logs.details')}
                      </span>
                      <Badge
                        variant={log.status === 'success' ? 'default' : 'destructive'}
                      >
                        {log.exitCode !== undefined ? `Exit: ${log.exitCode}` : log.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-xs text-muted-foreground">{t('logs.hookType', 'Hook Type')}:</span>
                        <p className="font-medium">{log.hookType}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">{t('logs.hookName', 'Hook Name')}:</span>
                        <p className="font-medium">{log.hookName}</p>
                      </div>
                    </div>

                    {log.command && (
                      <div>
                        <span className="text-xs text-muted-foreground">{t('logs.command')}:</span>
                        <p className="text-sm font-mono bg-background p-2 rounded mt-1 break-all">{log.command}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-4 text-sm">
                      {log.duration > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">{t('logs.duration')}:</span>
                          <p className="font-medium">{log.duration}ms</p>
                        </div>
                      )}
                      <div>
                        <span className="text-xs text-muted-foreground">{t('logs.timestamp')}:</span>
                        <p className="font-medium">{new Date(log.timestamp).toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">{t('logs.location')}:</span>
                        <p className="font-medium">{log.location}</p>
                      </div>
                    </div>

                    {log.output && (
                      <div>
                        <span className="text-xs text-muted-foreground">{t('logs.output')}:</span>
                        <pre className="text-xs font-mono bg-green-50 dark:bg-green-950 p-3 rounded mt-1 overflow-auto max-h-[150px] whitespace-pre-wrap">
                          {log.output}
                        </pre>
                      </div>
                    )}

                    {log.error && (
                      <div>
                        <span className="text-xs text-muted-foreground">{t('logs.error')}:</span>
                        <pre className="text-xs font-mono bg-red-50 dark:bg-red-950 p-3 rounded mt-1 overflow-auto max-h-[150px] whitespace-pre-wrap text-red-600 dark:text-red-400">
                          {log.error}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            ))}
        </div>
      )
      })()}
    </>
  )
}
