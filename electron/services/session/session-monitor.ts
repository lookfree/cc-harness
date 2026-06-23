import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { watch, type FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import { listSessions } from './session-index'
import { parseChunk } from './session-parser'
import { SessionTailer } from './session-tailer'
import { buildAgentTopology } from './agent-topology'
import { computeUsageBreakdown } from './usage-breakdown'
import { adviseUsage } from './usage-advisor'
import { summarizeEvents } from '../../../shared/session-summary'
import { PRICING_UPDATED } from '../../../shared/data/model-pricing'
import type { SessionEvent, SessionSummary, SessionEventsPush, AgentTopology, UsageReport } from '../../../shared/types'

/**
 * 封装 spec014 的 listSessions + SessionTailer，对外是"订阅式"接口：
 * - list/snapshot：请求/响应（一次性解析）
 * - subscribe：主进程开始 tail，增量事件经 win.webContents.send('session:events') push 到渲染进程
 *
 * 建立"主进程主动持续推流"范式（项目原先只有 invoke 请求/响应）。
 */
export class SessionMonitor {
  private readonly sessionsRoot = path.join(os.homedir(), '.claude', 'projects')
  /** sessionId → 该会话的 tailer（subscribe 时建，unsubscribe 时 close 防句柄泄漏） */
  private tailers = new Map<string, SessionTailer>()
  /** sessionId → workflow/subagents 目录 watcher + 去抖定时器（spec016 拓扑实时长出） */
  private topoSubs = new Map<string, { watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> }>()

  constructor(private getWin: () => BrowserWindow | null) {}

  /** 一次性构建某 session 的 agent 拓扑（spec016）。 */
  topology(sessionFilePath: string): Promise<AgentTopology> {
    return buildAgentTopology(sessionFilePath)
  }

  /** 一次性算某 session 的 token 分项 + ECC 建议（spec017）。 */
  async usage(sessionId: string, sessionFilePath: string): Promise<UsageReport> {
    // 先解析主 jsonl，再把事件喂给拓扑构建器——免它二次读+解析主 jsonl
    const events = await this.snapshot(sessionId, sessionFilePath)
    const topology = await buildAgentTopology(sessionFilePath, events)
    const breakdown = computeUsageBreakdown(events, topology)
    return { breakdown, advice: adviseUsage(breakdown), pricingUpdated: PRICING_UPDATED }
  }

  /** 订阅拓扑：监听 `<sessionId>/workflows` 与 `subagents` 目录，文件变化去抖重建并 push。 */
  subscribeTopology(sessionId: string, sessionFilePath: string): void {
    if (this.topoSubs.has(sessionId)) return
    const subdir = path.join(path.dirname(sessionFilePath), path.basename(sessionFilePath, '.jsonl'))
    void this.pushTopology(sessionId, sessionFilePath) // 首屏全量
    // 目标在 .claude 段下，不能套 dotfile 忽略正则（与 SessionTailer 同款坑）
    const watcher = watch([path.join(subdir, 'workflows'), path.join(subdir, 'subagents')], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    })
    const onChange = () => {
      const sub = this.topoSubs.get(sessionId)
      if (!sub) return
      clearTimeout(sub.timer)
      sub.timer = setTimeout(() => void this.pushTopology(sessionId, sessionFilePath), 300)
    }
    watcher.on('add', onChange).on('change', onChange).on('unlink', onChange).on('addDir', onChange)
    this.topoSubs.set(sessionId, { watcher })
  }

  unsubscribeTopology(sessionId: string): void {
    const sub = this.topoSubs.get(sessionId)
    if (!sub) return
    sub.watcher.close()
    clearTimeout(sub.timer)
    this.topoSubs.delete(sessionId)
  }

  private async pushTopology(sessionId: string, sessionFilePath: string): Promise<void> {
    try {
      // 注：每次变更全量重建（重读+重解析所有 agent jsonl）。仅在 workflow 运行中（持续写文件）
      // 才频繁触发；已完成/killed 的 workflow 无文件变更=零重建。真上几百 agent 的活跃 run 再加
      // mtime 缓存只重解析变化的那个文件（spec016 待优化项）。
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
    const valid = summaries.filter((s): s is SessionSummary => s !== null)

    // 同一 cwd 下只有最新的 session 可能还活着，其余标 completed
    const latestMtimeByCwd = new Map<string, number>()
    for (const m of metas) {
      const cur = latestMtimeByCwd.get(m.cwd) ?? 0
      if (m.mtimeMs > cur) latestMtimeByCwd.set(m.cwd, m.mtimeMs)
    }
    const nonLatest = new Set(
      metas.filter((m) => m.mtimeMs < (latestMtimeByCwd.get(m.cwd) ?? 0)).map((m) => m.sessionId)
    )
    return valid.map((s) =>
      nonLatest.has(s.sessionId) ? { ...s, status: 'completed' as const } : s
    )
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

  /** 删除 session jsonl 文件，先退订再删除。 */
  async deleteSession(sessionId: string, filePath: string): Promise<void> {
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(this.sessionsRoot + path.sep)) {
      throw new Error(`Refusing to delete file outside sessions directory: ${resolved}`)
    }
    this.unsubscribe(sessionId)
    this.unsubscribeTopology(sessionId)
    await fs.unlink(resolved)
  }

  /** 应用退出/窗口关闭时全部退订，防句柄泄漏。 */
  unsubscribeAll(): void {
    for (const id of [...this.tailers.keys()]) this.unsubscribe(id)
    for (const id of [...this.topoSubs.keys()]) this.unsubscribeTopology(id)
  }

  private push(payload: SessionEventsPush): void {
    this.getWin()?.webContents.send('session:events', payload)
  }
}
