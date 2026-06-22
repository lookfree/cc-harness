import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { MCPServerConfig } from '../../../shared/types'
import type { MCPHealth } from '../../../shared/types/mcp-health'

const PROBE_TIMEOUT_MS = 8_000
const NEEDS_AUTH_CACHE = path.join(os.homedir(), '.claude', 'mcp-needs-auth-cache.json')

function readNeedsAuthCache(): Record<string, { timestamp: number; id: string }> {
  try {
    return JSON.parse(fs.readFileSync(NEEDS_AUTH_CACHE, 'utf8')) as Record<string, { timestamp: number; id: string }>
  } catch {
    return {}
  }
}

function inferTransport(config: MCPServerConfig): MCPHealth['transport'] {
  if (config.type === 'http') return 'http'
  if (config.type === 'sse') return 'sse'
  if (config.command) return 'stdio'
  if (config.url) return config.url.startsWith('http') ? 'http' : 'sse'
  return 'unknown'
}

async function probeStdio(name: string, config: MCPServerConfig, startMs: number): Promise<MCPHealth> {
  return new Promise<MCPHealth>((resolve) => {
    const tmpDir = path.join(os.tmpdir(), `cc-mcp-probe-${process.pid}-${Date.now()}`)
    try { fs.mkdirSync(tmpDir, { recursive: true }) } catch { /* */ }

    const safeEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: os.homedir(),
      TMPDIR: os.tmpdir(),
      ...config.env,
    }

    const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true }) } catch { /* */ } }

    const fail = (error: string): MCPHealth => {
      cleanup()
      return { name, transport: 'stdio', state: 'failed', error, handshakeMs: Date.now() - startMs, callStats: { total: 0, success: 0, failed: 0, byTool: {} } }
    }

    let proc: ReturnType<typeof spawn>
    try {
      proc = config.args
        ? spawn(config.command!, config.args, { cwd: tmpDir, env: safeEnv })
        : spawn(config.command!, { shell: false, cwd: tmpDir, env: safeEnv })
    } catch (e) {
      return resolve(fail(String(e)))
    }

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch { /* */ }
      resolve(fail('probe_timeout'))
    }, PROBE_TIMEOUT_MS)

    let buf = ''
    let initDone = false
    let resolved = false

    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed) as Record<string, unknown>
          if (!initDone && String(msg.id) === '1') {
            // initialize response received — send initialized notification + tools/list
            initDone = true
            try {
              proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n')
              proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
            } catch { /* */ }
          } else if (String(msg.id) === '2') {
            // tools/list response
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            try { proc.kill('SIGKILL') } catch { /* */ }
            cleanup()
            const result = (msg.result ?? {}) as Record<string, unknown>
            const tools = (result.tools ?? []) as Array<{ name: string }>
            resolve({
              name,
              transport: 'stdio',
              state: 'connected',
              lastHandshakeAt: new Date().toISOString(),
              handshakeMs: Date.now() - startMs,
              toolCount: tools.length,
              toolNames: tools.map((t) => t.name),
              callStats: { total: 0, success: 0, failed: 0, byTool: {} },
            })
          }
        } catch { /* malformed JSON, keep buffering */ }
      }
    })

    proc.on('error', (err) => {
      if (!resolved) { resolved = true; clearTimeout(timer); resolve(fail(err.message)) }
    })
    proc.on('close', () => {
      if (!resolved) { resolved = true; clearTimeout(timer); resolve(fail('process_exited')) }
    })

    // Send initialize
    try {
      proc.stdin?.write(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'claude-code-debugger', version: '1.0' } },
      }) + '\n')
    } catch { /* stdin closed */ }
  })
}

async function probeHttp(name: string, config: MCPServerConfig, transport: MCPHealth['transport'], startMs: number): Promise<MCPHealth> {
  const base = { name, transport, callStats: { total: 0, success: 0, failed: 0, byTool: {} } }
  const url = config.url!
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.headers ?? {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'claude-code-debugger', version: '1.0' } } }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return { ...base, state: 'failed', error: `HTTP ${res.status}`, handshakeMs: Date.now() - startMs }
    const data = await res.json() as Record<string, unknown>
    if (data.error) return { ...base, state: 'failed', error: String((data.error as Record<string, unknown>).message ?? data.error), handshakeMs: Date.now() - startMs }
    return { ...base, state: 'connected', lastHandshakeAt: new Date().toISOString(), handshakeMs: Date.now() - startMs }
  } catch (e) {
    clearTimeout(timer)
    const err = e as Error
    return { ...base, state: 'failed', error: err.name === 'AbortError' ? 'probe_timeout' : err.message, handshakeMs: Date.now() - startMs }
  }
}

export async function probeMCP(name: string, config: MCPServerConfig): Promise<MCPHealth> {
  const startMs = Date.now()
  const transport = inferTransport(config)
  const needsAuthCache = readNeedsAuthCache()
  const emptyStats: MCPHealth['callStats'] = { total: 0, success: 0, failed: 0, byTool: {} }

  if (needsAuthCache[name]) {
    return { name, transport, state: 'needs-auth', needsAuth: true, callStats: emptyStats }
  }
  if (config.disabled) {
    return { name, transport, state: 'unknown', callStats: emptyStats }
  }
  if (transport === 'stdio') {
    if (!config.command) return { name, transport, state: 'failed', error: 'no_command', callStats: emptyStats }
    return probeStdio(name, config, startMs)
  }
  if (transport === 'http' || transport === 'sse') {
    if (!config.url) return { name, transport, state: 'failed', error: 'no_url', callStats: emptyStats }
    return probeHttp(name, config, transport, startMs)
  }
  return { name, transport: 'unknown', state: 'unknown', callStats: emptyStats }
}

export async function probeAllMCP(servers: Record<string, MCPServerConfig>): Promise<MCPHealth[]> {
  return Promise.all(Object.entries(servers).map(([name, cfg]) => probeMCP(name, cfg)))
}
