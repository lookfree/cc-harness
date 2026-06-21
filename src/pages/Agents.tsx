import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { Agent } from '@shared/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SourceBadge } from '@/components/SourceBadge'
import { sourceOf, sourceKey, sourceLabel } from '@/lib/source'
import { Bot, Search, Wrench, Cpu, FileCode, AlertCircle, Users } from 'lucide-react'
import { cn } from '@/lib/utils'

type SourceFilter = 'all' | 'user' | 'project' | 'plugin'

export default function Agents() {
  const { t } = useTranslation('agents')
  const [agents, setAgents] = useState<Agent[]>([])
  const [selected, setSelected] = useState<Agent | null>(null)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  useEffect(() => {
    api.agents
      .getAll()
      .then((data) => {
        setAgents(data)
        setSelected((cur) => cur ?? data.find((a) => !a.overriddenBy) ?? data[0] ?? null)
      })
      .catch((e) => console.error('[Agents] load failed:', e))
  }, [])

  const filtered = agents.filter(
    (a) =>
      (sourceFilter === 'all' || sourceOf(a) === sourceFilter) &&
      (a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.description.toLowerCase().includes(search.toLowerCase()))
  )
  const selectedKey = selected ? sourceKey(selected) : null

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border px-6 py-4 flex items-center gap-2">
        <Bot className="w-5 h-5" />
        <div>
          <h1 className="text-xl font-bold">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <Badge variant="secondary" className="ml-2">{agents.length}</Badge>
      </div>

      <div className="flex-1 grid grid-cols-[20rem_1fr] gap-4 p-6 overflow-hidden">
        {/* Left: list */}
        <div className="flex flex-col gap-3 overflow-hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {(['all', 'user', 'project', 'plugin'] as const).map((f) => (
              <Button key={f} size="sm" variant={sourceFilter === f ? 'default' : 'outline'} className="text-xs h-7 px-2" onClick={() => setSourceFilter(f)}>
                {t(`filter.${f}`)}
              </Button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">{t('empty')}</div>
            ) : (
              filtered.map((a) => (
                <button
                  key={sourceKey(a)}
                  onClick={() => setSelected(a)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg border transition-colors',
                    selectedKey === sourceKey(a) ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-accent border-border',
                    a.overriddenBy && 'opacity-60'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('font-medium text-sm truncate', a.overriddenBy && 'line-through')}>{a.name}</span>
                    {a.overriddenBy && <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 shrink-0">{t('overridden')}</Badge>}
                  </div>
                  <p className="text-xs opacity-70 mt-0.5 line-clamp-2">{a.description}</p>
                  <div className="mt-1"><SourceBadge source={sourceOf(a)} label={sourceLabel(a, t)} /></div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: detail + Teams note */}
        <div className="overflow-y-auto space-y-4">
          {/* Agent Teams 收缩说明（ORCH-07）—— 无 TeamCreate/TeamDelete，纯说明 */}
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 flex items-start gap-2">
            <Users className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-xs font-medium">{t('teams.title')}</div>
              <p className="text-xs text-muted-foreground mt-0.5">{t('teams.note')}</p>
            </div>
          </div>

          {selected ? (
            <AgentDetail agent={selected} />
          ) : (
            <div className="text-center text-muted-foreground py-8 text-sm">{t('noSelection')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function AgentDetail({ agent }: { agent: Agent }) {
  const { t } = useTranslation('agents')
  const src = sourceOf(agent)
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-2xl font-bold">{agent.name}</h2>
          <SourceBadge source={src} label={sourceLabel(agent, t)} />
          {src === 'plugin' && <Badge variant="outline" className="text-xs">{t('detail.readOnly')}</Badge>}
        </div>
        {agent.description && <p className="text-muted-foreground mt-1">{agent.description}</p>}
      </div>

      {agent.overriddenBy && (
        <div className="flex items-start gap-2 text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{t('overriddenHint')}</span>
        </div>
      )}

      {/* Tools + model */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> {t('detail.tools')}</CardTitle></CardHeader>
          <CardContent>
            {agent.tools?.length ? (
              <div className="flex flex-wrap gap-1">
                {agent.tools.map((tool) => <Badge key={tool} variant="secondary" className="text-xs font-mono">{tool}</Badge>)}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{t('detail.toolsInherit')}</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> {t('detail.model')}</CardTitle></CardHeader>
          <CardContent>
            <span className={cn('text-xs', agent.model ? 'font-mono' : 'text-muted-foreground')}>{agent.model || t('detail.modelDefault')}</span>
          </CardContent>
        </Card>
      </div>

      {/* System prompt */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t('detail.systemPrompt')}</CardTitle></CardHeader>
        <CardContent>
          <pre className="text-xs whitespace-pre-wrap font-mono bg-muted rounded-md p-3 max-h-[420px] overflow-auto">{agent.systemPrompt || ''}</pre>
        </CardContent>
      </Card>

      {agent.filePath && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <FileCode className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono break-all">{agent.filePath}</span>
        </div>
      )}
    </div>
  )
}
