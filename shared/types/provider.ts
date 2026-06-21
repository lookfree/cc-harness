/**
 * AI Model Provider Configuration
 * Supports multiple AI providers: Claude, Kimi, Zhipu, DeepSeek, OpenAI, etc.
 */

/** API 报文格式：anthropic = 原生/兼容 Anthropic Messages；openai = OpenAI 格式（需网关代理才能给 Claude Code 用）。 */
export type ProviderApiFormat = 'anthropic' | 'openai'

/** 角色 → 具体模型 id 的映射（CC Switch 粒度）。各角色写入对应的 ANTHROPIC_DEFAULT_*_MODEL。 */
export interface ProviderModelMap {
  opus?: string
  sonnet?: string
  haiku?: string
  fable?: string
}

export interface Provider {
  id: string
  name: string // Unique identifier (e.g., 'claude', 'kimi', 'zhipu')
  displayName: string // Display name (e.g., 'Claude (Anthropic)')
  mode: 'api' | 'subscription' // API mode or subscription mode
  apiKey?: string // Required for API mode, not needed for subscription
  baseUrl?: string // API base URL (ANTHROPIC_BASE_URL)
  model?: string // 主/默认模型（→ ANTHROPIC_MODEL）
  /** 角色映射（CC Switch 粒度）：opus/sonnet/haiku/fable → 该家具体模型 id（→ ANTHROPIC_DEFAULT_*_MODEL） */
  models?: ProviderModelMap
  /** 该家模型是否支持 1M 上下文（展示用 badge） */
  supports1m?: boolean
  /** API 格式（anthropic 兼容 / openai 需网关） */
  apiFormat?: ProviderApiFormat
  enabled: boolean // Whether the provider is enabled
  isActive: boolean // Whether this is the currently active provider
  icon?: string // Icon emoji or URL
  description?: string // Short description of the provider
  createdAt?: string
  updatedAt?: string
}

export interface ProviderTemplate {
  name: string
  displayName: string
  baseUrl?: string
  model?: string
  icon?: string
}

export interface ProviderConfig {
  activeProvider: string | null // ID of the active provider
  providers: Provider[]
  lastUpdated: string
}

export interface ClaudeConfig {
  env?: {
    ANTHROPIC_AUTH_TOKEN?: string
    ANTHROPIC_BASE_URL?: string
    ANTHROPIC_API_KEY?: string
    ANTHROPIC_MODEL?: string
    ANTHROPIC_DEFAULT_OPUS_MODEL?: string
    ANTHROPIC_DEFAULT_SONNET_MODEL?: string
    ANTHROPIC_DEFAULT_HAIKU_MODEL?: string
    ANTHROPIC_DEFAULT_FABLE_MODEL?: string
  }
  [key: string]: any
}
