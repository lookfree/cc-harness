import type { SessionEvent, ToolUseEvent, ToolResultEvent } from '../../../shared/types'
import type { MCPCallStats } from '../../../shared/types/mcp-health'

// Matches mcp__<server>__<tool> where server may contain hyphens or underscores
const MCP_TOOL_RE = /^mcp__(.+?)__/

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = Math.max(0, Math.ceil(sorted.length * p) - 1)
  return sorted[i]
}

export function computeMCPCallStats(events: SessionEvent[]): Record<string, MCPCallStats> {
  const toolUses = new Map<string, { serverName: string; toolName: string; ts: string }>()
  const stats: Record<string, MCPCallStats> = {}

  const getOrCreate = (server: string): MCPCallStats => {
    if (!stats[server]) stats[server] = { total: 0, success: 0, failed: 0, byTool: {} }
    return stats[server]
  }

  // First pass: collect all mcp tool_use events
  for (const ev of events) {
    if (ev.kind !== 'tool_use') continue
    const tu = ev as ToolUseEvent
    const m = MCP_TOOL_RE.exec(tu.toolName)
    if (!m) continue
    toolUses.set(tu.toolUseId, { serverName: m[1], toolName: tu.toolName, ts: ev.timestamp ?? '' })
  }

  // Latency buckets per server
  const latencies: Record<string, number[]> = {}

  // Second pass: match tool_result to compute latency and success/fail
  for (const ev of events) {
    if (ev.kind !== 'tool_result') continue
    const tr = ev as ToolResultEvent
    const use = toolUses.get(tr.toolUseId)
    if (!use) continue

    const { serverName, toolName } = use
    const s = getOrCreate(serverName)
    s.total++
    const ok = !tr.isError
    if (ok) s.success++; else s.failed++

    // Track last call
    if (!s.lastCallAt || (ev.timestamp ?? '') > s.lastCallAt) {
      s.lastCallAt = ev.timestamp
      s.lastCallOk = ok
    }

    // Per-tool stats
    if (!s.byTool[toolName]) s.byTool[toolName] = { total: 0, failed: 0, avgMs: 0 }
    s.byTool[toolName].total++
    if (!ok) s.byTool[toolName].failed++

    // Latency: timestamp diff (ms)
    if (use.ts && ev.timestamp) {
      const ms = new Date(ev.timestamp).getTime() - new Date(use.ts).getTime()
      if (ms >= 0) {
        latencies[serverName] ??= []
        latencies[serverName].push(ms)
        // Update per-tool avgMs incrementally
        const bt = s.byTool[toolName]
        bt.avgMs = bt.avgMs + (ms - bt.avgMs) / bt.total
      }
    }
  }

  // Compute latency percentiles
  for (const [server, lats] of Object.entries(latencies)) {
    const sorted = [...lats].sort((a, b) => a - b)
    const s = stats[server]
    if (!s) continue
    s.latencyMsP50 = percentile(sorted, 0.5)
    s.latencyMsP95 = percentile(sorted, 0.95)
    s.latencyMsMax = sorted[sorted.length - 1]
  }

  return stats
}
