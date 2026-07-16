/**
 * pending-approval：项目级声明的 stdio server，批量健康检查不自动 spawn（对齐 Claude Code
 * 2.1.196"仓库自批 server 不再被 `claude mcp list` 自动拉起"的供应链姿态），等用户显式确认。
 */
export type MCPConnState = 'connected' | 'failed' | 'needs-auth' | 'unknown' | 'pending-approval'

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
