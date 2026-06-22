import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  Zap,
  Bot,
  Webhook,
  Server,
  Terminal,
  LayoutDashboard,
  GitBranch,
  Settings,
  FileText,
  Cpu,
  Puzzle,
  ShieldCheck,
  Activity,
  Brain,
  Timer,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Tooltip } from '@/components/ui/tooltip'

interface LayoutProps {
  children: React.ReactNode
}

const navigationKeys = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'sessions', href: '/sessions', icon: Activity },
  { key: 'models', href: '/models', icon: Cpu },
  { key: 'claudeMd', href: '/claude-md', icon: FileText },
  { key: 'commands', href: '/commands', icon: Terminal },
  { key: 'agents', href: '/agents', icon: Bot },
  { key: 'mcp', href: '/mcp', icon: Server },
  { key: 'skills', href: '/skills', icon: Zap },
  { key: 'plugins', href: '/plugins', icon: Puzzle },
  { key: 'hooks', href: '/hooks', icon: Webhook },
  { key: 'permissions', href: '/permissions', icon: ShieldCheck },
  { key: 'memory', href: '/memory', icon: Brain },
  { key: 'loops', href: '/loops', icon: Timer },
  { key: 'graph', href: '/graph', icon: GitBranch },
  { key: 'settings', href: '/settings', icon: Settings },
] as const

const isMac = typeof navigator !== 'undefined'
  && /mac/i.test(`${navigator.platform} ${navigator.userAgent}`)

export function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const { t } = useTranslation('layout')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* 侧栏 — 自身是 drag 区域，收缩到 icon-only（72px）而非消失 */}
      <div
        className={cn(
          'border-r border-border bg-card flex flex-col flex-shrink-0 transition-all duration-200 overflow-hidden',
          sidebarOpen ? 'w-64' : 'w-[72px]',
        )}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* 头部：流量灯垂直避让 + toggle 按钮 */}
        <div
          className={cn(
            'flex items-center shrink-0 px-3 pb-2',
            sidebarOpen ? 'justify-between' : 'justify-center',
          )}
          style={{
            paddingTop: isMac ? '46px' : '14px',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {sidebarOpen && (
            <span className="text-sm font-semibold text-foreground truncate">
              {t('appName')}
            </span>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title={sidebarOpen ? t('collapseSidebar') : t('expandSidebar')}
          >
            {sidebarOpen
              ? <PanelLeftClose className="w-4 h-4" />
              : <PanelLeftOpen className="w-4 h-4" />
            }
          </button>
        </div>

        {/* 导航 */}
        <nav
          className="flex-1 overflow-y-auto p-2 space-y-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {navigationKeys.map((item) => {
            const isActive = location.pathname === item.href
            const link = (
              <Link
                key={item.key}
                to={item.href}
                className={cn(
                  'flex items-center rounded-lg text-sm font-medium transition-colors',
                  sidebarOpen ? 'gap-3 px-3 py-2' : 'justify-center p-2',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {sidebarOpen && t(`nav.${item.key}`)}
              </Link>
            )
            return sidebarOpen ? link : (
              <Tooltip key={item.key} content={t(`nav.${item.key}`)}>
                {link}
              </Tooltip>
            )
          })}
        </nav>

        {/* 底部：收缩时隐藏 */}
        {sidebarOpen && (
          <div
            className="border-t border-border p-4 space-y-3 shrink-0"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <LanguageSwitcher />
            <div className="text-xs text-muted-foreground">
              <p>{t('appName')}</p>
              <p className="mt-1">{t('version', { version: '0.1.0' })}</p>
            </div>
          </div>
        )}
      </div>

      {/* 主内容 */}
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
