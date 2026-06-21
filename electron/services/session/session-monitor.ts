import { promises as fs } from 'fs'
import type { BrowserWindow } from 'electron'
import { listSessions } from './session-index'
import { parseChunk } from './session-parser'
import { SessionTailer } from './session-tailer'
import { summarizeEvents } from '../../../shared/session-summary'
import type { SessionEvent, SessionSummary, SessionEventsPush } from '../../../shared/types'

/**
 * 封装 spec014 的 listSessions + SessionTailer，对外是"订阅式"接口：
 * - list/snapshot：请求/响应（一次性解析）
 * - subscribe：主进程开始 tail，增量事件经 win.webContents.send('session:events') push 到渲染进程
 *
 * 建立"主进程主动持续推流"范式（项目原先只有 invoke 请求/响应）。
 */
export class SessionMonitor {
  /** sessionId → 该会话的 tailer（subscribe 时建，unsubscribe 时 close 防句柄泄漏） */
  private tailers = new Map<string, SessionTailer>()

  constructor(private getWin: () => BrowserWindow | null) {}

  /** 列出所有 session 概要（全量解析每个文件 → 状态/计数/token 小计）。 */
  async list(): Promise<SessionSummary[]> {
    const metas = await listSessions()
    const now = Date.now()
    const summaries = await Promise.all(
      metas.map(async (m): Promise<SessionSummary | null> => {
        try {
          const text = await fs.readFile(m.filePath, 'utf8')
          const { events } = parseChunk(text, 0)
          return summarizeEvents(events, {
            sessionId: m.sessionId,
            filePath: m.filePath,
            cwd: m.cwd,
            hasSubagents: m.hasSubagents,
            mtimeMs: m.mtimeMs,
            nowMs: now,
          })
        } catch {
          return null
        }
      })
    )
    return summaries.filter((s): s is SessionSummary => s !== null)
  }

  /** 取一个 session 的全量已解析事件（首屏快照，Web 模式唯一路径）。 */
  async snapshot(_sessionId: string, filePath: string): Promise<SessionEvent[]> {
    const text = await fs.readFile(filePath, 'utf8')
    return parseChunk(text, 0).events
  }

  /** 订阅：开始 tail 该文件，initial 全量 + 后续增量都 push 到渲染进程。 */
  subscribe(sessionId: string, filePath: string): void {
    if (this.tailers.has(sessionId)) return
    const tailer = new SessionTailer()
    tailer.addEventListener('events', (ev) => {
      const detail = (ev as CustomEvent<{ events: SessionEvent[]; initial: boolean }>).detail
      this.push({ sessionId, events: detail.events, initial: detail.initial })
    })
    tailer.addEventListener('truncated', () => {
      this.push({ sessionId, events: [], initial: true, truncated: true })
    })
    this.tailers.set(sessionId, tailer)
    tailer.watch(filePath)
  }

  /** 退订：彻底 close 该文件的 watcher/tailer。 */
  unsubscribe(sessionId: string): void {
    const t = this.tailers.get(sessionId)
    if (!t) return
    t.unwatchAll()
    this.tailers.delete(sessionId)
  }

  /** 应用退出/窗口关闭时全部退订，防句柄泄漏。 */
  unsubscribeAll(): void {
    for (const id of [...this.tailers.keys()]) this.unsubscribe(id)
  }

  private push(payload: SessionEventsPush): void {
    this.getWin()?.webContents.send('session:events', payload)
  }
}
