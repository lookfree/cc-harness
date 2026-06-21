import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Check, Settings, Zap, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Provider, ProviderModelMap, ProviderApiFormat } from '@shared/types'

/** 角色映射的四个角色（CC Switch 粒度）。 */
const MODEL_ROLES: Array<keyof ProviderModelMap> = ['opus', 'sonnet', 'haiku', 'fable']

// 各家最新模型（2026-06，CC Switch 角色映射粒度；模型 id / 端点可在表单里改）
const CLAUDE_MODELS: ProviderModelMap = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  fable: 'claude-fable-5',
}

const defaultProviders: Omit<Provider, 'id' | 'apiKey' | 'enabled' | 'isActive'>[] = [
  {
    name: 'claude-subscription',
    displayName: 'Claude Pro/Max',
    mode: 'subscription',
    model: 'claude-sonnet-4-6',
    models: CLAUDE_MODELS,
    supports1m: true,
    apiFormat: 'anthropic',
    icon: '👤',
    description: '使用 Claude 订阅账号（需通过 claude login 登录）'
  },
  {
    name: 'claude-api',
    displayName: 'Claude API',
    mode: 'api',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
    models: CLAUDE_MODELS,
    supports1m: true,
    apiFormat: 'anthropic',
    icon: '🔑',
    description: '使用 Anthropic API Key（按量付费）'
  },
  {
    name: 'kimi',
    displayName: 'Kimi (月之暗面)',
    mode: 'api',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    model: 'kimi-k2.6',
    models: { opus: 'kimi-k2.6', sonnet: 'kimi-k2.6', haiku: 'kimi-k2.6' },
    supports1m: false,
    apiFormat: 'anthropic',
    icon: '🌙',
    description: 'Kimi K2.6，Anthropic 兼容端点，擅长中文理解'
  },
  {
    name: 'zhipu',
    displayName: '智谱 AI (GLM)',
    mode: 'api',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-5.2',
    models: { opus: 'glm-5.2', sonnet: 'glm-5.2', haiku: 'glm-4.5-air' },
    supports1m: true,
    apiFormat: 'anthropic',
    icon: '💡',
    description: 'GLM-5.2（1M 上下文），Anthropic 兼容端点'
  },
  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    mode: 'api',
    baseUrl: 'https://api.deepseek.com/anthropic',
    model: 'deepseek-v4-flash',
    models: { opus: 'deepseek-v4-pro', sonnet: 'deepseek-v4-flash', haiku: 'deepseek-v4-flash' },
    supports1m: true,
    apiFormat: 'anthropic',
    icon: '🔍',
    description: 'DeepSeek V4（1M 上下文），专注代码、性价比高'
  },
  {
    name: 'openai',
    displayName: 'OpenAI',
    mode: 'api',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    models: { opus: 'gpt-5.5', sonnet: 'gpt-5.5', haiku: 'gpt-5.5-mini' },
    supports1m: false,
    apiFormat: 'openai',
    icon: '⚡',
    description: 'GPT-5.5（OpenAI 格式，需网关代理转 Anthropic 才能给 Claude Code 用）'
  }
]

export default function Models() {
  const { t } = useTranslation('models')
  const [providers, setProviders] = useState<Provider[]>([])
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [formData, setFormData] = useState({
    displayName: '',
    name: '',
    mode: 'api' as 'api' | 'subscription',
    apiKey: '',
    baseUrl: '',
    model: '',
    models: {} as ProviderModelMap,
    supports1m: false,
    apiFormat: 'anthropic' as ProviderApiFormat
  })

  useEffect(() => {
    loadProviders()
  }, [])

  const loadProviders = async () => {
    try {
      const { api } = await import('@/lib/api')
      const data = await api.providers.getAll()
      console.log('[Models Page] Loaded', data.length, 'providers')
      setProviders(data)
    } catch (error) {
      console.error('[Models Page] Failed to load providers:', error)
    }
  }

  const handleAddProvider = (template: typeof defaultProviders[0]) => {
    setFormData({
      displayName: template.displayName,
      name: template.name,
      // Only Claude supports subscription mode, force API mode for others
      mode: template.name.includes('claude') ? template.mode : 'api',
      apiKey: '',
      baseUrl: template.baseUrl || '',
      model: template.model || '',
      models: { ...(template.models || {}) },
      supports1m: template.supports1m || false,
      apiFormat: template.apiFormat || 'anthropic'
    })
    setEditingProvider(null)
    setDialogOpen(true)
  }

  const handleEditProvider = (provider: Provider) => {
    setFormData({
      displayName: provider.displayName,
      name: provider.name,
      // Only Claude supports subscription mode, force API mode for others
      mode: provider.name.includes('claude') ? provider.mode : 'api',
      apiKey: provider.apiKey || '',
      baseUrl: provider.baseUrl || '',
      model: provider.model || '',
      models: { ...(provider.models || {}) },
      supports1m: provider.supports1m || false,
      apiFormat: provider.apiFormat || 'anthropic'
    })
    setEditingProvider(provider)
    setDialogOpen(true)
  }

  const handleSaveProvider = async () => {
    try {
      const { api } = await import('@/lib/api')

      // 去掉空的角色映射，避免写入空模型 id
      const cleanModels: ProviderModelMap = {}
      for (const role of MODEL_ROLES) {
        const v = formData.models[role]?.trim()
        if (v) cleanModels[role] = v
      }
      const payload = { ...formData, models: cleanModels }

      if (editingProvider) {
        // Update existing
        await api.providers.update(editingProvider.id, payload)
      } else {
        // Add new
        await api.providers.add({
          ...payload,
          enabled: true,
          isActive: false
        })
      }

      // Reload providers
      await loadProviders()
      setDialogOpen(false)
    } catch (error) {
      console.error('[Models Page] Failed to save provider:', error)
      alert('保存失败: ' + error)
    }
  }

  const handleSwitchProvider = async (providerId: string) => {
    try {
      const { api } = await import('@/lib/api')
      await api.providers.switch(providerId)
      await loadProviders()
      console.log('[Models Page] Switched to provider:', providerId)
    } catch (error) {
      console.error('[Models Page] Failed to switch provider:', error)
      alert('切换失败: ' + error)
    }
  }

  const handleToggleProvider = async (providerId: string) => {
    try {
      const { api } = await import('@/lib/api')
      const provider = providers.find(p => p.id === providerId)
      if (provider) {
        await api.providers.update(providerId, { enabled: !provider.enabled })
        await loadProviders()
      }
    } catch (error) {
      console.error('[Models Page] Failed to toggle provider:', error)
      alert('操作失败: ' + error)
    }
  }

  const handleDeleteProvider = async (providerId: string) => {
    if (confirm('确定要删除这个配置吗？')) {
      try {
        const { api } = await import('@/lib/api')
        await api.providers.delete(providerId)
        await loadProviders()
      } catch (error) {
        console.error('[Models Page] Failed to delete provider:', error)
        alert('删除失败: ' + error)
      }
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('title')}</h1>
          <p className="text-muted-foreground">
            {t('description')}
          </p>
        </div>

        {/* Active Provider Card */}
        {providers.find(p => p.isActive) && (
          <Card className="border-primary bg-primary/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-2xl">
                    {providers.find(p => p.isActive)?.icon}
                  </div>
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {providers.find(p => p.isActive)?.displayName}
                      <Badge variant="default" className="ml-2">
                        <Check className="w-3 h-3 mr-1" />
                        Active
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      当前使用的 AI 模型
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    const active = providers.find(p => p.isActive)
                    if (active) handleEditProvider(active)
                  }}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  配置
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Base URL:</span>
                  <p className="font-mono mt-1">{providers.find(p => p.isActive)?.baseUrl}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Model:</span>
                  <p className="font-mono mt-1">{providers.find(p => p.isActive)?.model}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Add Provider Templates */}
        <div>
          <h2 className="text-xl font-semibold mb-4">{t('addNew')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {defaultProviders.map((template) => {
              const isAdded = providers.some(p => p.name === template.name)
              return (
                <Card
                  key={template.name}
                  className={cn(
                    "cursor-pointer transition-all hover:shadow-md",
                    isAdded && "opacity-50"
                  )}
                  onClick={() => !isAdded && handleAddProvider(template)}
                >
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-xl flex-shrink-0">
                        {template.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base">{template.displayName}</CardTitle>
                        {template.description && (
                          <CardDescription className="mt-1 text-xs">
                            {template.description}
                          </CardDescription>
                        )}
                        {isAdded && (
                          <Badge variant="secondary" className="mt-2">{t('added')}</Badge>
                        )}
                      </div>
                      {!isAdded && <Plus className="w-5 h-5 text-muted-foreground flex-shrink-0" />}
                    </div>
                  </CardHeader>
                </Card>
              )
            })}
          </div>
        </div>

        {/* Configured Providers */}
        <div>
          <h2 className="text-xl font-semibold mb-4">{t('configured')}</h2>
          <div className="space-y-3">
            {providers.length === 0 ? (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center text-muted-foreground">
                    {t('noProviders')}
                  </div>
                </CardContent>
              </Card>
            ) : (
              providers.map((provider) => (
                <Card
                  key={provider.id}
                  className={cn(
                    "transition-all",
                    provider.isActive && "border-primary"
                  )}
                >
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-xl">
                          {provider.icon}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{provider.displayName}</h3>
                            {provider.isActive && (
                              <Badge variant="default" className="text-xs">
                                <Check className="w-3 h-3 mr-1" />
                                {t('active')}
                              </Badge>
                            )}
                            {!provider.enabled && (
                              <Badge variant="secondary" className="text-xs">
                                Disabled
                              </Badge>
                            )}
                            {provider.supports1m && (
                              <Badge variant="outline" className="text-xs">1M</Badge>
                            )}
                            {provider.apiFormat === 'openai' && (
                              <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-500/30">OpenAI</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                            {provider.mode === 'subscription' ? (
                              <span className="flex items-center gap-1">
                                👤 订阅模式（使用 Claude 登录）
                              </span>
                            ) : (
                              <span className="flex items-center gap-1">
                                <Globe className="w-3 h-3" />
                                {provider.baseUrl || 'Default'}
                              </span>
                            )}
                            {provider.model && (
                              <span className="flex items-center gap-1">
                                <Zap className="w-3 h-3" />
                                {provider.model}
                              </span>
                            )}
                          </div>
                          {provider.models && Object.keys(provider.models).length > 0 && (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted-foreground font-mono">
                              {MODEL_ROLES.filter((r) => provider.models?.[r]).map((r) => (
                                <span key={r}>
                                  <span className="opacity-60">{r}:</span> {provider.models?.[r]}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {!provider.isActive && provider.enabled && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleSwitchProvider(provider.id)}
                          >
                            {t('actions.switch')}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditProvider(provider)}
                        >
                          {t('actions.edit')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleProvider(provider.id)}
                        >
                          {provider.enabled ? t('actions.disable') : t('actions.enable')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteProvider(provider.id)}
                          disabled={provider.isActive}
                        >
                          {t('actions.delete')}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit/Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingProvider ? t('dialog.editTitle') : t('dialog.addTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('dialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dialog.displayName')}</label>
              <Input
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder={t('dialog.displayNamePlaceholder')}
              />
            </div>

            {/* Show info for subscription mode providers */}
            {formData.name === 'claude-subscription' && (
              <div className="space-y-2">
                <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-900 dark:text-blue-100">
                    💡 使用 Claude Pro/Max 订阅账号，需要先在终端运行 <code className="px-1 py-0.5 bg-blue-100 dark:bg-blue-900 rounded">claude login</code> 登录
                  </p>
                </div>
              </div>
            )}

            {formData.mode === 'api' && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dialog.apiKey')}</label>
                  <Input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    placeholder={t('dialog.apiKeyPlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dialog.baseUrl')}</label>
                  <Input
                    value={formData.baseUrl}
                    onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                    placeholder={t('dialog.baseUrlPlaceholder')}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('dialog.baseUrlDesc')}
                  </p>
                </div>
              </>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dialog.model')}</label>
              <Input
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                placeholder={t('dialog.modelPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">{t('dialog.modelDesc')}</p>
            </div>

            {/* 角色 → 模型映射（CC Switch 粒度，写 ANTHROPIC_DEFAULT_*_MODEL） */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dialog.roleMapping')}</label>
              <div className="grid grid-cols-2 gap-2">
                {MODEL_ROLES.map((role) => (
                  <div key={role} className="space-y-1">
                    <span className="text-xs text-muted-foreground capitalize">{role}</span>
                    <Input
                      className="font-mono text-xs"
                      value={formData.models[role] || ''}
                      onChange={(e) => setFormData({ ...formData, models: { ...formData.models, [role]: e.target.value } })}
                      placeholder={role}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('dialog.roleMappingDesc')}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('dialog.apiFormat')}</label>
                <Select
                  value={formData.apiFormat}
                  onValueChange={(v: ProviderApiFormat) => setFormData({ ...formData, apiFormat: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('dialog.supports1m')}</label>
                <div className="flex items-center gap-2 h-9">
                  <Switch
                    checked={formData.supports1m}
                    onCheckedChange={(v) => setFormData({ ...formData, supports1m: v })}
                  />
                  <span className="text-xs text-muted-foreground">1M context</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('dialog.cancel')}
            </Button>
            <Button onClick={handleSaveProvider}>
              {t('dialog.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
