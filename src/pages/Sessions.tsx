import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSessionStore, MAX_COMPARE } from '@/stores/sessionStore'
import { SessionList } from '@/components/sessions/SessionList'
import { ConversationReplay } from '@/components/sessions/ConversationReplay'
import { SessionTimeline, TimelineLegend, sharedDomain } from '@/components/sessions/SessionTimeline'
import { AgentTopologyView } from '@/components/sessions/AgentTopologyView'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { Columns, RefreshCw, Activity } from 'lucide-react'
import { shortCwd } from '@/components/sessions/sessionStatus'

export default function Sessions() {
  const { t } = useTranslation('sessions')
  const {
    summaries,
    eventsBySession,
    selectedIds,
    compareMode,
    loading,
    loadSessions,
    selectSession,
    toggleCompare,
    setCompareMode,
    startListening,
    stopListening,
  } = useSessionStore()
  const [tab, setTab] = useState('replay')
  const [seekSeq, setSeekSeq] = useState<number | undefined>(undefined)

  useEffect(() => {
    loadSessions()
    startListening()
    return () => stopListening()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const primaryId = selectedIds[0]
  const primaryEvents = primaryId ? eventsBySession[primaryId] ?? [] : []
  const primarySummary = summaries.find((s) => s.sessionId === primaryId)
  const isLive = api.isElectron() && !!primaryId

  // domain 仅比对模式用；非比对时早返回，避免每次 push（含无关 session）白扫选中会话的事件
  const domain = useMemo(
    () => (compareMode ? sharedDomain(selectedIds.map((id) => eventsBySession[id] ?? [])) : { minMs: 0, maxMs: 1 }),
    [compareMode, selectedIds, eventsBySession]
  )

  const onSeek = (seq: number) => {
    setSeekSeq(seq)
    setTab('replay')
  }

  const empty = (
    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      {t('selectPrompt')}
    </div>
  )

  return (
    <div className="flex h-full">
      <div className="w-80 shrink-0">
        <SessionList
          summaries={summaries}
          selectedIds={selectedIds}
          compareMode={compareMode}
          onSelect={selectSession}
          onToggleCompare={toggleCompare}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">
              {primarySummary ? primarySummary.title || shortCwd(primarySummary.cwd) : t('title')}
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="w-3 h-3" />
              {t('heuristicNote')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={loadSessions} disabled={loading}>
              <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
            </Button>
            <Button
              variant={compareMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCompareMode(!compareMode)}
            >
              <Columns className="w-4 h-4 mr-1" />
              {t('compare')}
            </Button>
          </div>
        </div>

        {compareMode ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {selectedIds.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('compareEmpty')}</div>
            ) : (
              <>
              <TimelineLegend />
              {selectedIds.map((id) => {
                const s = summaries.find((x) => x.sessionId === id)
                return (
                  <div key={id} className="border border-border rounded px-3">
                    <SessionTimeline
                      events={eventsBySession[id] ?? []}
                      domain={domain}
                      label={s ? s.title || shortCwd(s.cwd) : id}
                    />
                  </div>
                )
              })}
              </>
            )}
            <p className="text-xs text-muted-foreground">{t('compareHint', { max: MAX_COMPARE })}</p>
          </div>
        ) : !primaryId ? (
          empty
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="mx-4 mt-2 self-start">
              <TabsTrigger value="replay">{t('tab.replay')}</TabsTrigger>
              <TabsTrigger value="timeline">{t('tab.timeline')}</TabsTrigger>
              <TabsTrigger value="topology">{t('tab.topology')}</TabsTrigger>
            </TabsList>
            <TabsContent value="replay" className="flex-1 min-h-0 mt-2">
              <ConversationReplay events={primaryEvents} scrollToSeq={seekSeq} live={isLive} />
            </TabsContent>
            <TabsContent value="timeline" className="flex-1 overflow-y-auto px-4 mt-2">
              <TimelineLegend />
              <SessionTimeline events={primaryEvents} onSeek={onSeek} />
            </TabsContent>
            <TabsContent value="topology" className="flex-1 min-h-0 mt-2">
              {primarySummary && tab === 'topology' && (
                <AgentTopologyView sessionId={primaryId} sessionFilePath={primarySummary.filePath} />
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
