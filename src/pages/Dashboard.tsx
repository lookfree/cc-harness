import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { SessionSummary } from '@shared/types'
import { STATUS_META, shortCwd, relativeTime, compactNum } from '@/components/sessions/sessionStatus'
import { Zap, Bot, Webhook, Server, Terminal, FileText, Globe, FolderOpen, Activity, ArrowRight } from 'lucide-react'

function toLocalDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA')
}

// ── Active Sessions card ──────────────────────────────────────────────────────

function ActiveSessionsCard({ sessions }: { sessions: SessionSummary[] }) {
  const { t } = useTranslation('dashboard')
  const navigate = useNavigate()
  const nowMs = Date.now()

  const active = useMemo(
    () =>
      sessions
        .filter((s) => s.status !== 'completed')
        .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
        .slice(0, 5),
    [sessions]
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="w-4 h-4 text-green-500" />
          {t('activeSessions.title')}
        </CardTitle>
        {sessions.length > 5 && (
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => navigate('/sessions')}>
            {t('activeSessions.viewAll')}
            <ArrowRight className="w-3 h-3" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t('activeSessions.empty')}</p>
        ) : (
          <div className="space-y-1">
            {active.map((s) => {
              const meta = STATUS_META[s.status]
              return (
                <button
                  key={s.sessionId}
                  onClick={() => navigate('/sessions')}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted/50 transition-colors text-left"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                  <span className="flex-1 truncate text-sm">{s.title || shortCwd(s.cwd)}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {compactNum(s.totalTokens.totalTokens)} tok
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
                    {relativeTime(s.lastActivityAt, nowMs)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Token Trend card ──────────────────────────────────────────────────────────

function TokenTrendCard({ sessions }: { sessions: SessionSummary[] }) {
  const { t } = useTranslation('dashboard')
  const todayStr = toLocalDate(new Date().toISOString())

  const { chartData, todayTokens } = useMemo(() => {
    const byDay: Record<string, { input: number; output: number; cache: number }> = {}
    for (const s of sessions) {
      const day = toLocalDate(s.lastActivityAt)
      const prev = byDay[day] ?? { input: 0, output: 0, cache: 0 }
      byDay[day] = {
        input: prev.input + s.totalTokens.inputTokens,
        output: prev.output + s.totalTokens.outputTokens,
        cache: prev.cache + s.totalTokens.cacheReadInputTokens + s.totalTokens.cacheCreationInputTokens,
      }
    }

    const data = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const day = d.toLocaleDateString('en-CA')
      const { input = 0, output = 0, cache = 0 } = byDay[day] ?? {}
      return { date: `${d.getMonth() + 1}/${d.getDate()}`, input, output, cache, isToday: day === todayStr }
    })

    const today = byDay[todayStr]
    const todayTotal = today ? today.input + today.output + today.cache : 0
    return { chartData: data, todayTokens: todayTotal }
  }, [sessions, todayStr])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{t('tokenTrend.title')}</CardTitle>
          <div className="text-right">
            <div className="text-2xl font-bold">{compactNum(todayTokens)}</div>
            <div className="text-xs text-muted-foreground">{t('tokenTrend.today')}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={compactNum}
            />
            <Tooltip
              formatter={(v: number, name: string) => [compactNum(v), t(`tokenTrend.${name}`)]}
              contentStyle={{ fontSize: 11 }}
            />
            <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} formatter={(name) => t(`tokenTrend.${name}`)} />
            <Bar dataKey="input" stackId="a" fill="#3b82f6" fillOpacity={0.8} />
            <Bar dataKey="output" stackId="a" fill="#8b5cf6" fillOpacity={0.8} />
            <Bar dataKey="cache" stackId="a" fill="#6b7280" fillOpacity={0.5} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-1 text-right">{t('tokenTrend.range')}</p>
      </CardContent>
    </Card>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { t } = useTranslation('dashboard')
  const [stats, setStats] = useState({
    skills: 0,
    agents: 0,
    hooks: 0,
    mcpServers: 0,
    commands: 0,
    claudeMdFiles: 0,
    claudeMdProjects: 0,
  })
  const [claudeMdFiles, setClaudeMdFiles] = useState<Array<{
    content: string
    location: 'user' | 'project' | 'global'
    filePath: string
    exists: boolean
    projectName?: string
  }>>([])
  const [sessions, setSessions] = useState<SessionSummary[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const [skills, agents, hooks, mcpServers, commands, claudeMd, sessionList] = await Promise.all([
          api.skills.getAll(),
          api.agents.getAll(),
          api.hooks.getAll(),
          api.mcp.getAll(),
          api.commands.getAll(),
          api.claudeMD.getAll(),
          api.session.list(),
        ])
        setClaudeMdFiles(claudeMd)
        setSessions(sessionList)
        const existingFiles = claudeMd.filter(f => f.exists)
        setStats({
          skills: skills.length,
          agents: agents.length,
          hooks: hooks.length,
          mcpServers: Object.keys(mcpServers).length,
          commands: commands.length,
          claudeMdFiles: existingFiles.length,
          claudeMdProjects: claudeMd.filter(f => f.location === 'project' && f.exists).length,
        })
      } catch (error) {
        console.error('Failed to load stats:', error)
      }
    }
    load()
  }, [])

  const cards = [
    { title: t('stats.claudeMdFiles'), description: t('stats.configFiles'), count: stats.claudeMdFiles, icon: FileText, color: 'text-cyan-500' },
    { title: t('stats.skills'), description: t('stats.totalSkills'), count: stats.skills, icon: Zap, color: 'text-blue-500' },
    { title: t('stats.commands'), description: t('stats.slashCommands'), count: stats.commands, icon: Terminal, color: 'text-pink-500' },
    { title: t('stats.agents'), description: t('stats.activeAgents'), count: stats.agents, icon: Bot, color: 'text-purple-500' },
    { title: t('stats.mcpServers'), description: t('stats.connectedServers'), count: stats.mcpServers, icon: Server, color: 'text-orange-500' },
    { title: t('stats.hooks'), description: t('stats.configuredHooks'), count: stats.hooks, icon: Webhook, color: 'text-green-500' },
  ]

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      {/* Active sessions + token trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActiveSessionsCard sessions={sessions} />
        <TokenTrendCard sessions={sessions} />
      </div>

      {/* Config stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <card.icon className={`w-4 h-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.count}</div>
              <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* CLAUDE.md overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            {t('claudeMdSection.title')}
          </CardTitle>
          <CardDescription>{t('claudeMdSection.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {claudeMdFiles.filter(f => f.location === 'global').map((file) => (
              <div key={file.filePath} className="border rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Globe className="h-4 w-4 text-blue-500 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-sm">{t('claudeMdSection.globalConfig')}</h4>
                      {file.exists ? (
                        <Badge variant="outline" className="text-green-600 border-green-600 text-xs">{t('claudeMdSection.active')}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-orange-600 border-orange-600 text-xs">{t('claudeMdSection.notCreated')}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate" title={file.filePath}>{file.filePath}</p>
                    {file.exists && <p className="text-xs text-muted-foreground mt-1">{file.content.split('\n').length} lines</p>}
                  </div>
                </div>
              </div>
            ))}
            <div className="border rounded-lg p-4">
              <div className="flex items-start gap-3">
                <FolderOpen className="h-4 w-4 text-purple-500 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-sm">{t('claudeMdSection.projectConfigs')}</h4>
                    <Badge variant="secondary" className="text-xs">{stats.claudeMdProjects}</Badge>
                  </div>
                  {claudeMdFiles.filter(f => f.location === 'project' && f.exists).slice(0, 3).map((file) => (
                    <div key={file.filePath} className="text-xs text-muted-foreground truncate" title={file.filePath}>
                      • {file.projectName}
                    </div>
                  ))}
                  {stats.claudeMdProjects > 3 && (
                    <div className="text-xs text-muted-foreground mt-1">+ {stats.claudeMdProjects - 3} {t('claudeMdSection.more')}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
