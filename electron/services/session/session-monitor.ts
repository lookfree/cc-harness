import { promises as fs } from 'fs'
import path from 'path'
import { watch, type FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import { listSessions } from './session-index'
import { parseChunk } from './session-parser'
import { SessionTailer } from './session-tailer'
import { buildAgentTopology } from './agent-topology'
import { summarizeEvents } from '../../../shared/session-summary'
import type { SessionEvent, SessionSummary, SessionEventsPush, AgentTopology } from '../../../shared/types'

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
  /** sessionId → workflow/subagents 目录 watcher（spec016 拓扑实时长出） */
  private topoWatchers = new Map<string, FSWatcher>()
  /** sessionId → 拓扑重建去抖定时器 */
  private topoTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private getWin: () => BrowserWindow | null) {}

  /** 一次性构建某 session 的 agent 拓扑（spec016）。 */
  topology(sessionFilePath: string): Promise<AgentTopology> {
    return buildAgentTopology(sessionFilePath)
  }

  /** 订阅拓扑：监听 `<sessionId>/workflows` 与 `subagents` 目录，文件变化去抖重建并 push。 */
  subscribeTopology(sessionId: string, sessionFilePath: string): void {
    if (this.topoWatchers.has(sessionId)) return
    const subdir = path.join(path.dirname(sessionFilePath), path.basename(sessionFilePath, '.jsonl'))
    void this.pushTopology(sessionId, sessionFilePath) // 首屏全量
    // 目标在 .claude 段下，不能套 dotfile 忽略正则（与 SessionTailer 同款坑）
    const w = watch([path.join(subdir, 'workflows'), path.join(subdir, 'subagents')], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    })
    const onChange = () => {
      clearTimeout(this.topoTimers.get(sessionId))
      this.topoTimers.set(
        sessionId,
        setTimeout(() => void this.pushTopology(sessionId, sessionFilePath), 300)
      )
    }
    w.on('add', onChange).on('change', onChange).on('unlink', onChange).on('addDir', onChange)
    this.topoWatchers.set(sessionId, w)
  }

  unsubscribeTopology(sessionId: string): void {
    this.topoWatchers.get(sessionId)?.close()
    this.topoWatchers.delete(sessionId)
    clearTimeout(this.topoTimers.get(sessionId))
    this.topoTimers.delete(sessionId)
  }

  private async pushTopology(sessionId: string, sessionFilePath: string): Promise<void> {
    try {
      const topology = await buildAgentTopology(sessionFilePath)
      this.getWin()?.webContents.send('session:topology', { sessionId, topology })
    } catch {
      /* 构建失败不影响其它 push */
    }
  }

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
    for (const id of [...this.topoWatchers.keys()]) this.unsubscribeTopology(id)
  }

  private push(payload: SessionEventsPush): void {
    this.getWin()?.webContents.send('session:events', payload)
  }
}
