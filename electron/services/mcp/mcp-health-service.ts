import fs from 'fs/promises'
import type { MCPServers, SessionEvent } from '../../../shared/types'
import type { MCPHealth } from '../../../shared/types/mcp-health'
import { parseLine } from '../session/session-parser'
import { listSessions } from '../session/session-index'
import { probeAllMCP } from './mcp-prober'
import { computeMCPCallStats } from './mcp-call-stats'

async function loadAllSessionEvents(): Promise<SessionEvent[]> {
  const sessions = await listSessions()
  const chunks = await Promise.all(sessions.map(async (s) => {
    try {
      const content = await fs.readFile(s.filePath, 'utf-8')
      return content.split('\n').filter(Boolean).flatMap((l) => parseLine(l, 0))
    } catch { return [] }
  }))
  return chunks.flat()
}

export async function getMCPHealth(servers: MCPServers): Promise<MCPHealth[]> {
  const [probeResults, allEvents] = await Promise.all([
    probeAllMCP(servers),
    loadAllSessionEvents(),
  ])

  const statsMap = computeMCPCallStats(allEvents)

  return probeResults.map((h) => ({
    ...h,
    callStats: statsMap[h.name] ?? h.callStats,
  }))
}
