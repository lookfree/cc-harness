export type MCPConnState = 'connected' | 'failed' | 'needs-auth' | 'unknown'

export interface MCPCallStats {
  total: number
  success: number
  failed: number
  latencyMsP50?: number
  latencyMsP95?: number
  latencyMsMax?: number
  lastCallAt?: string
  lastCallOk?: boolean
  byTool: Record<string, { total: number; failed: number; avgMs: number }>
}

export interface MCPHealth {
  name: string
  transport: 'stdio' | 'sse' | 'http' | 'unknown'
  state: MCPConnState
  lastHandshakeAt?: string
  handshakeMs?: number
  toolCount?: number
  toolNames?: string[]
  needsAuth?: boolean
  error?: string
  callStats: MCPCallStats
}
