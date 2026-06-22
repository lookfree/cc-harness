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
} from 'lucide-react'
import { LanguageSwitcher } from './LanguageSwitcher'

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

export function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const { t } = useTranslation('layout')

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navigationKeys.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.key}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className="w-5 h-5" />
                {t(`nav.${item.key}`)}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-4 space-y-3">
          <LanguageSwitcher />
          <div className="text-xs text-muted-foreground">
            <p>{t('appName')}</p>
            <p className="mt-1">{t('version', { version: '0.1.0' })}</p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
