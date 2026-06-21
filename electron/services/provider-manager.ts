import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Provider, ProviderConfig, ClaudeConfig } from '../../shared/types'

/**
 * ProviderManager - Manages AI model provider configurations
 * Similar to cc-switch's ProviderService
 */
export class ProviderManager {
  private configPath: string
  private claudeSettingsPath: string
  private config: ProviderConfig | null = null

  constructor() {
    const homeDir = os.homedir()
    // Store provider config in ~/.claude/providers.json
    this.configPath = path.join(homeDir, '.claude', 'providers.json')
    // Claude Code settings path
    this.claudeSettingsPath = path.join(homeDir, '.claude', 'settings.json')

    console.log('[ProviderManager] Initialized')
    console.log('[ProviderManager] Config path:', this.configPath)
    console.log('[ProviderManager] Claude settings path:', this.claudeSettingsPath)
  }

  /**
   * Load provider configuration
   */
  async loadConfig(): Promise<ProviderConfig> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8')
      this.config = JSON.parse(data)
      console.log('[ProviderManager] Loaded config:', this.config)
      return this.config!
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('[ProviderManager] Config file not found, creating default')
        // Create default config
        this.config = {
          activeProvider: null,
          providers: [],
          lastUpdated: new Date().toISOString()
        }
        await this.saveConfig()
        return this.config
      }
      console.error('[ProviderManager] Error loading config:', error)
      throw error
    }
  }

  /**
   * Save provider configuration
   */
  async saveConfig(): Promise<void> {
    try {
      if (!this.config) {
        throw new Error('No config to save')
      }

      // Ensure directory exists
      const dir = path.dirname(this.configPath)
      await fs.mkdir(dir, { recursive: true })

      // Update timestamp
      this.config.lastUpdated = new Date().toISOString()

      // Atomic write: write to temp file then rename
      const tempPath = `${this.configPath}.tmp`
      await fs.writeFile(tempPath, JSON.stringify(this.config, null, 2), 'utf-8')
      await fs.rename(tempPath, this.configPath)

      console.log('[ProviderManager] Config saved successfully')
    } catch (error) {
      console.error('[ProviderManager] Error saving config:', error)
      throw error
    }
  }

  /**
   * Get all providers
   */
  async getProviders(): Promise<Provider[]> {
    if (!this.config) {
      await this.loadConfig()
    }
    return this.config!.providers
  }

  /**
   * Get active provider
   */
  async getActiveProvider(): Promise<Provider | null> {
    if (!this.config) {
      await this.loadConfig()
    }
    const activeId = this.config!.activeProvider
    if (!activeId) return null
    return this.config!.providers.find(p => p.id === activeId) || null
  }

  /**
   * Add a new provider
   */
  async addProvider(provider: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Promise<Provider> {
    if (!this.config) {
      await this.loadConfig()
    }

    const newProvider: Provider = {
      ...provider,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }

    this.config!.providers.push(newProvider)
    await this.saveConfig()

    console.log('[ProviderManager] Added provider:', newProvider.name)
    return newProvider
  }

  /**
   * Update an existing provider
   */
  async updateProvider(id: string, updates: Partial<Provider>): Promise<Provider> {
    if (!this.config) {
      await this.loadConfig()
    }

    const index = this.config!.providers.findIndex(p => p.id === id)
    if (index === -1) {
      throw new Error(`Provider not found: ${id}`)
    }

    this.config!.providers[index] = {
      ...this.config!.providers[index],
      ...updates,
      id, // Prevent ID change
      updatedAt: new Date().toISOString()
    }

    await this.saveConfig()

    // If this is the active provider, sync to Claude settings
    if (this.config!.activeProvider === id) {
      await this.syncToClaudeSettings(this.config!.providers[index])
    }

    console.log('[ProviderManager] Updated provider:', id)
    return this.config!.providers[index]
  }

  /**
   * Delete a provider
   */
  async deleteProvider(id: string): Promise<void> {
    if (!this.config) {
      await this.loadConfig()
    }

    // Cannot delete active provider
    if (this.config!.activeProvider === id) {
      throw new Error('Cannot delete active provider')
    }

    this.config!.providers = this.config!.providers.filter(p => p.id !== id)
    await this.saveConfig()

    console.log('[ProviderManager] Deleted provider:', id)
  }

  /**
   * Switch to a different provider
   * This updates Claude Code's settings.json file
   */
  async switchProvider(id: string): Promise<Provider> {
    if (!this.config) {
      await this.loadConfig()
    }

    const provider = this.config!.providers.find(p => p.id === id)
    if (!provider) {
      throw new Error(`Provider not found: ${id}`)
    }

    if (!provider.enabled) {
      throw new Error('Provider is disabled')
    }

    // Update active provider
    const previousActive = this.config!.activeProvider
    this.config!.activeProvider = id

    // Update isActive flags
    this.config!.providers = this.config!.providers.map(p => ({
      ...p,
      isActive: p.id === id
    }))

    await this.saveConfig()

    // Sync to Claude Code settings
    await this.syncToClaudeSettings(provider)

    console.log('[ProviderManager] Switched provider:', provider.name)
    console.log('[ProviderManager] Previous active:', previousActive)

    return provider
  }

  /**
   * Sync provider configuration to Claude Code settings.json
   * Updates ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL
   */
  private async syncToClaudeSettings(provider: Provider): Promise<void> {
    try {
      let claudeConfig: ClaudeConfig = {}

      // Try to read existing settings
      try {
        const data = await fs.readFile(this.claudeSettingsPath, 'utf-8')
        claudeConfig = JSON.parse(data)
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          console.warn('[ProviderManager] Error reading Claude settings:', error)
        }
      }

      if (!claudeConfig.env) {
        claudeConfig.env = {}
      }

      if (provider.mode === 'subscription') {
        // Subscription mode: clear API settings to use Claude subscription
        console.log('[ProviderManager] Switching to subscription mode')
        delete claudeConfig.env.ANTHROPIC_AUTH_TOKEN
        delete claudeConfig.env.ANTHROPIC_API_KEY
        delete claudeConfig.env.ANTHROPIC_BASE_URL
      } else {
        // API mode: set API key and base URL
        console.log('[ProviderManager] Switching to API mode')

        if (provider.apiKey) {
          claudeConfig.env.ANTHROPIC_AUTH_TOKEN = provider.apiKey
        }

        // Set custom base URL if provided
        if (provider.baseUrl) {
          claudeConfig.env.ANTHROPIC_BASE_URL = provider.baseUrl
          console.log('[ProviderManager] Set ANTHROPIC_BASE_URL:', provider.baseUrl)
        } else {
          // Clear base URL if not provided (use default Anthropic endpoint)
          delete claudeConfig.env.ANTHROPIC_BASE_URL
        }
      }

      // 角色 → 模型映射（CC Switch 粒度）：API 模式写 ANTHROPIC_MODEL 与 ANTHROPIC_DEFAULT_*_MODEL；
      // 订阅模式清掉（用 Claude 登录账号的原生模型解析，不强行 pin）。未配置的角色一律清，避免残留上一家映射。
      const isApi = provider.mode !== 'subscription'
      const env = claudeConfig.env
      const setEnv = (key: keyof NonNullable<ClaudeConfig['env']>, val?: string) => {
        if (isApi && val) env[key] = val
        else delete env[key]
      }
      setEnv('ANTHROPIC_MODEL', provider.model)
      setEnv('ANTHROPIC_DEFAULT_OPUS_MODEL', provider.models?.opus)
      setEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', provider.models?.sonnet)
      setEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL', provider.models?.haiku)
      setEnv('ANTHROPIC_DEFAULT_FABLE_MODEL', provider.models?.fable)

      // Ensure directory exists
      const dir = path.dirname(this.claudeSettingsPath)
      await fs.mkdir(dir, { recursive: true })

      // Atomic write
      const tempPath = `${this.claudeSettingsPath}.tmp`
      await fs.writeFile(tempPath, JSON.stringify(claudeConfig, null, 2), 'utf-8')
      await fs.rename(tempPath, this.claudeSettingsPath)

      console.log('[ProviderManager] Synced to Claude settings:', {
        mode: provider.mode,
        hasApiKey: !!provider.apiKey,
        hasBaseUrl: !!provider.baseUrl
      })
    } catch (error) {
      console.error('[ProviderManager] Error syncing to Claude settings:', error)
      throw error
    }
  }

  /**
   * Read current configuration from Claude Code settings
   * Used for backfill protection
   */
  async readFromClaudeSettings(): Promise<string | null> {
    try {
      const data = await fs.readFile(this.claudeSettingsPath, 'utf-8')
      const claudeConfig: ClaudeConfig = JSON.parse(data)
      return claudeConfig.env?.ANTHROPIC_AUTH_TOKEN || null
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('[ProviderManager] Error reading Claude settings:', error)
      }
      return null
    }
  }
}

// Singleton instance
let providerManager: ProviderManager | null = null

export function getProviderManager(): ProviderManager {
  if (!providerManager) {
    providerManager = new ProviderManager()
  }
  return providerManager
}
