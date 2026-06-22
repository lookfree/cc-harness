import { promises as fs } from 'fs'
import type { LoopTask } from '../../../shared/types/loop'
import { listSessions } from '../session/session-index'

const FIRE_TOLERANCE_MS = 120_000

interface WakeupCall {
  toolUseId: string
  ts: string
  delaySeconds: number
  reason: string
  prompt: string
}

async function discoverLoopsFromSession(
  sessionId: string,
  encodedCwd: string,
  cwd: string,
  filePath: string,
): Promise<LoopTask[]> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    return []
  }

  const wakeupCalls: WakeupCall[] = []
  const fireTimes: number[] = []

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (obj.type === 'assistant') {
      const msg = obj.message as Record<string, unknown> | undefined
      const blocks = Array.isArray(msg?.content) ? (msg.content as unknown[]) : []
      for (const block of blocks) {
        const b = block as Record<string, unknown>
        if (b?.type === 'tool_use' && b.name === 'ScheduleWakeup') {
          const input = b.input as Record<string, unknown> | undefined
          const delay = typeof input?.delaySeconds === 'number' ? input.delaySeconds : 0
          if (delay > 0 && typeof obj.timestamp === 'string') {
            wakeupCalls.push({
              toolUseId: typeof b.id === 'string' && b.id ? b.id : `noid-${obj.timestamp}`,
              ts: obj.timestamp,
              delaySeconds: delay,
              reason: typeof input?.reason === 'string' ? input.reason : '',
              prompt: typeof input?.prompt === 'string' ? input.prompt : '',
            })
          }
        }
      }
    }

    if (obj.type === 'system' && obj.subtype === 'scheduled_task_fire' && typeof obj.timestamp === 'string') {
      fireTimes.push(new Date(obj.timestamp).getTime())
    }
  }

  const now = Date.now()
  return wakeupCalls.map((call) => {
    const scheduledAtMs = new Date(call.ts).getTime()
    const fireAtMs = scheduledAtMs + call.delaySeconds * 1000

    const matchedFireTime = fireTimes.find(
      (t) => t >= scheduledAtMs && t <= fireAtMs + FIRE_TOLERANCE_MS,
    )
    const hasFired = matchedFireTime !== undefined
    const status: LoopTask['status'] = hasFired ? 'fired' : fireAtMs > now ? 'pending' : 'expired'

    return {
      id: `${sessionId}:${call.toolUseId}`,
      sessionId,
      encodedCwd,
      cwd,
      description: call.reason || call.prompt,
      prompt: call.prompt,
      delaySeconds: call.delaySeconds,
      scheduledAt: call.ts,
      fireAt: new Date(fireAtMs).toISOString(),
      status,
      firedAt: matchedFireTime != null ? new Date(matchedFireTime).toISOString() : undefined,
      source: 'jsonl' as const,
    }
  })
}

export async function discoverLoops(): Promise<LoopTask[]> {
  const sessions = await listSessions()
  const results = await Promise.all(
    sessions.map((s) =>
      discoverLoopsFromSession(s.sessionId, s.encodedCwd, s.cwd, s.filePath).catch(() => []),
    ),
  )
  return results
    .flat()
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
}
