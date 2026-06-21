export interface MCPServerConfig {
  /** 传输类型：stdio（默认，本地进程）/ http / sse（远程连接器） */
  type?: 'stdio' | 'http' | 'sse'
  /** stdio：可执行命令；远程时可省略 */
  command?: string
  args?: string[]
  env?: Record<string, string>
  // ---- 远程连接器（claude.ai MCP / http / sse，2.1.46） ----
  /** 远程 MCP 端点 url */
  url?: string
  /** 远程鉴权等头 */
  headers?: Record<string, string>
  timeout?: number
  disabled?: boolean
  alwaysAllow?: string[]
  /** 强制加载该 server（2.1.121） */
  alwaysLoad?: boolean
  /** 声明支持 elicitation 追问（2.1.76）；配置层标记，运行时交互见 spec020/Phase2 */
  elicitation?: boolean
  description?: string
}

export interface MCPServers {
  [serverName: string]: MCPServerConfig
}

/** 派生：判断一个 server 是远程连接器还是本地 stdio（UI 分组用）。 */
export function isRemoteMCP(c: MCPServerConfig): boolean {
  return c.type === 'http' || c.type === 'sse' || (!!c.url && !c.command)
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
