import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import type { Plugin, Marketplace, PluginVersion } from '@shared/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Puzzle, Package, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

const SCOPE_BADGE: Record<string, string> = {
  user: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  project: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
}

export default function Plugins() {
  const { t } = useTranslation('plugins')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([])
  const [selected, setSelected] = useState<Plugin | null>(null)
  const [cliOk, setCliOk] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const load = async () => {
    const [pl, mk, cli] = await Promise.all([
      api.plugins.getAll(),
      api.plugins.getMarketplaces(),
      api.plugins.cliStatus(),
    ])
    setPlugins(pl)
    setMarketplaces(mk)
    setCliOk(cli)
    setSelected((cur) => (cur ? pl.find((p) => p.key === cur.key) ?? null : null))
  }

  useEffect(() => {
    load()
  }, [])

  // plugin 按 marketplace 分组
  const grouped = useMemo(() => {
    const byMk = new Map<string, Plugin[]>()
    for (const p of plugins) {
      const g = byMk.get(p.marketplace)
      if (g) g.push(p)
      else byMk.set(p.marketplace, [p])
    }
    return byMk
  }, [plugins])

  const marketplaceMeta = (name: string) => marketplaces.find((m) => m.name === name)

  const toggleEnabled = async (p: Plugin) => {
    setBusy(p.key)
    setActionError('')
    try {
      const r = p.enabled ? await api.plugins.disable(p.key) : await api.plugins.enable(p.key)
      if (!r.ok) setActionError(r.message) // CLI 失败 / 降级失败时把原因显式上报，不静默回弹
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Puzzle className="w-5 h-5" />
          <h1 className="text-xl font-bold">{t('title')}</h1>
          <Badge variant="secondary">{plugins.length}</Badge>
        </div>
      </div>

      {/* CLI 降级横幅 */}
      {cliOk === false && (
        <div className="mx-6 mt-4 flex items-start gap-2 text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t('cliUnavailable')}</span>
        </div>
      )}

      {/* 操作错误反馈 */}
      {actionError && (
        <div className="mx-6 mt-4 flex items-start gap-2 text-xs rounded-md border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-2">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{actionError}</span>
        </div>
      )}

      <div className="flex-1 grid grid-cols-2 gap-4 p-6 overflow-hidden">
        {/* 左：marketplace 分组的 plugin 列表 */}
        <div className="overflow-y-auto space-y-4">
          {plugins.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">{t('noPlugins')}</div>
          ) : (
            [...grouped.entries()].map(([mk, list]) => {
              const meta = marketplaceMeta(mk)
              return (
                <div key={mk}>
                  <div className="flex items-center gap-2 px-1 mb-2 text-xs text-muted-foreground">
                    <Package className="w-3.5 h-3.5" />
                    <span className="font-medium">{mk}</span>
                    {meta?.source.repo && <span className="opacity-70">· {meta.source.repo}</span>}
                  </div>
                  <div className="space-y-2">
                    {list.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => setSelected(p)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-lg border transition-colors',
                          selected?.key === p.key
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card hover:bg-accent border-border'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm">{p.name}</span>
                          {p.currentVersion && (
                            <Badge variant="outline" className="text-xs">
                              {p.currentVersion}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {p.enabled ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {t('enabled')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <XCircle className="w-3.5 h-3.5" /> {t('disabled')}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {p.versions.length} {t('versions')}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* 右：plugin 详情 */}
        <div className="overflow-y-auto">
          {selected ? (
            <PluginDetail plugin={selected} busy={busy === selected.key} onToggle={() => toggleEnabled(selected)} />
          ) : (
            <div className="text-center text-muted-foreground py-8">{t('selectPlugin')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function PluginDetail({ plugin, busy, onToggle }: { plugin: Plugin; busy: boolean; onToggle: () => void }) {
  const { t } = useTranslation('plugins')
  const current = plugin.versions.find((v) => v.isCurrent) ?? plugin.versions[0]
  const manifest = current?.manifest
  const author = typeof manifest?.author === 'string' ? manifest?.author : manifest?.author?.name

  return (
    <div className="space-y-4">
      {/* 头部 + enable 开关（plugin 级） */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">{plugin.name}</h2>
          <p className="text-sm text-muted-foreground">{plugin.marketplace}</p>
          {manifest?.description && <p className="text-muted-foreground mt-2">{manifest.description}</p>}
        </div>
        <Button
          variant={plugin.enabled ? 'default' : 'outline'}
          size="sm"
          disabled={busy}
          onClick={onToggle}
        >
          {plugin.enabled ? t('enabled') : t('disabled')}
        </Button>
      </div>

      {/* manifest 元信息 */}
      {manifest && (
        <Card>
          <CardContent className="p-4 text-sm space-y-1">
            {author && (
              <div><span className="text-muted-foreground">{t('manifest.author')}: </span>{author}</div>
            )}
            {manifest.license && (
              <div><span className="text-muted-foreground">{t('manifest.license')}: </span>{manifest.license}</div>
            )}
            {manifest.homepage && (
              <div><span className="text-muted-foreground">{t('manifest.homepage')}: </span>{manifest.homepage}</div>
            )}
            {manifest.repository && (
              <div><span className="text-muted-foreground">{t('manifest.repository')}: </span>{manifest.repository}</div>
            )}
            {manifest.keywords && manifest.keywords.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 pt-1">
                <span className="text-muted-foreground">{t('manifest.keywords')}: </span>
                {manifest.keywords.map((k) => (
                  <Badge key={k} variant="secondary" className="text-xs">{k}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 版本列表 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('versions')} ({plugin.versions.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {plugin.versions.map((v) => (
            <VersionRow key={v.installPath} v={v} />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function VersionRow({ v }: { v: PluginVersion }) {
  const { t } = useTranslation('plugins')
  const c = v.components
  return (
    <div className={cn('rounded-md border px-3 py-2', v.isCurrent ? 'border-primary bg-primary/5' : 'border-border')}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm">{v.version}</span>
        <Badge variant="outline" className={cn('text-xs', SCOPE_BADGE[v.scope])}>
          {t(`scope.${v.scope}`)}
        </Badge>
        {v.isCurrent && <Badge className="text-xs">{t('current')}</Badge>}
      </div>
      {c && (
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>{t('components.skills')} {c.skills}</span>
          <span>{t('components.commands')} {c.commands}</span>
          <span>{t('components.agents')} {c.agents}</span>
          <span>{t('components.hooks')} {c.hooks}</span>
        </div>
      )}
    </div>
  )
}
