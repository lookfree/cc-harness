export interface MCPServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  timeout?: number
  disabled?: boolean
  alwaysAllow?: string[]
  description?: string
}

export interface MCPServers {
  [serverName: string]: MCPServerConfig
}

export interface MCPServerStatus {
  name: string
  status: 'connected' | 'disconnected' | 'error' | 'loading'
  pid?: number
  lastError?: string
  connectedAt?: string
  tools?: MCPTool[]
  resources?: MCPResource[]
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface MCPToolCall {
  id: string
  serverName: string
  toolName: string
  input: Record<string, unknown>
  timestamp: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  output?: unknown
  error?: string
  duration?: number
}

export interface MCPServerLog {
  id: string
  serverName: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}
