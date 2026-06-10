/**
 * AI Model Provider Configuration
 * Supports multiple AI providers: Claude, Kimi, Zhipu, DeepSeek, OpenAI, etc.
 */

export interface Provider {
  id: string
  name: string // Unique identifier (e.g., 'claude', 'kimi', 'zhipu')
  displayName: string // Display name (e.g., 'Claude (Anthropic)')
  mode: 'api' | 'subscription' // API mode or subscription mode
  apiKey?: string // Required for API mode, not needed for subscription
  baseUrl?: string // API base URL (ANTHROPIC_BASE_URL)
  model?: string // Default model name
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
  }
  [key: string]: any
}
