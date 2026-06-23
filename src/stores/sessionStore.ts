import { create } from 'zustand'
import { api } from '@/lib/api'
import { summarizeEvents } from '@shared/session-summary'
import type { SessionSummary, SessionEvent, SessionEventsPush } from '@shared/types'

/** 最多同时比对的 session 数（ORCH 多 session 横向比对）。 */
export const MAX_COMPARE = 3

interface SessionState {
  summaries: SessionSummary[]
  /** 每个 session 累积的已解析事件（initial 全量 + 增量合并，按 seq 去重） */
  eventsBySession: Record<string, SessionEvent[]>
  /** 选中的 session（单选=1；比对模式 ≤MAX_COMPARE） */
  selectedIds: string[]
  /** 已建立增量订阅的 session（避免重复订阅） */
  subscribedIds: string[]
  compareMode: boolean
  loading: boolean
  /** onEvents 取消监听句柄（startListening 注册一次） */
  unbind?: () => void

  loadSessions: () => Promise<void>
  /** 单选某 session：替换选中并确保已加载/订阅 */
  selectSession: (id: string) => Promise<void>
  clearSelection: () => void
  deselectSession: (id: string) => void
  /** 比对模式下增删选中（≤MAX_COMPARE） */
  toggleCompare: (id: string) => Promise<void>
  setCompareMode: (on: boolean) => void
  startListening: () => void
  stopListening: () => void
}

/** 取末尾带 timestamp 的事件时间（ms），用于状态新鲜度判断；无则回落"现在"。 */
function lastActivityMs(events: SessionEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const ts = events[i].timestamp
    if (ts) {
      const ms = Date.parse(ts)
      if (!Number.isNaN(ms)) return ms
    }
  }
  return Date.now()
}

export const useSessionStore = create<SessionState>((set, get) => ({
  summaries: [],
  eventsBySession: {},
  selectedIds: [],
  subscribedIds: [],
  compareMode: false,
  loading: false,

  loadSessions: async () => {
    set({ loading: true })
    try {
      const summaries = await api.session.list()
      set({ summaries })
    } finally {
      set({ loading: false })
    }
  },

  selectSession: async (id) => {
    set({ selectedIds: [id] })
    await ensureLoaded(id, get, set)
  },

  clearSelection: () => set({ selectedIds: [] }),
  deselectSession: (id) => set((s) => ({ selectedIds: s.selectedIds.filter((x) => x !== id) })),

  toggleCompare: async (id) => {
    const { selectedIds } = get()
    if (selectedIds.includes(id)) {
      set({ selectedIds: selectedIds.filter((x) => x !== id) })
      return
    }
    if (selectedIds.length >= MAX_COMPARE) return
    set({ selectedIds: [...selectedIds, id] })
    await ensureLoaded(id, get, set)
  },

  setCompareMode: (on) => {
    const { selectedIds } = get()
    // 退出比对回到单选：只留第一个
    set({ compareMode: on, selectedIds: on ? selectedIds : selectedIds.slice(0, 1) })
  },

  startListening: () => {
    if (get().unbind) return
    const unbind = api.session.onEvents((payload) => ingest(payload, set))
    set({ unbind })
  },

  stopListening: () => {
    const { unbind, subscribedIds } = get()
    unbind?.()
    subscribedIds.forEach((id) => void api.session.unsubscribe(id))
    set({ unbind: undefined, subscribedIds: [] })
  },
}))

type Get = () => SessionState
type Set = (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void

/** 确保某 session 的事件已加载：桌面端订阅（initial push 灌入），Web 端拉一次快照。 */
async function ensureLoaded(id: string, get: Get, set: Set): Promise<void> {
  const summary = get().summaries.find((s) => s.sessionId === id)
  if (!summary) return
  if (api.isElectron()) {
    if (get().subscribedIds.includes(id)) return
    set((s) => ({ subscribedIds: [...s.subscribedIds, id] }))
    await api.session.subscribe(id, summary.filePath)
  } else {
    if (get().eventsBySession[id]) return
    const events = await api.session.snapshot(id, summary.filePath)
    ingest({ sessionId: id, events, initial: true }, set)
  }
}

/** 合并一批 push 事件 + 用 shared summarizer 重算该 session 的 live 概要。 */
function ingest(payload: SessionEventsPush, set: Set): void {
  const { sessionId, events, truncated } = payload
  set((state) => {
    const prev = truncated ? [] : state.eventsBySession[sessionId] ?? []
    // 增量天然 append-only（seq 单调，parseChunk 升序发出，tailer 不回读），prev 始终有序 →
    // 只接 seq 大于已有最大值的新事件，免去每次 push 重建 Map + 全量排序
    const maxSeq = prev.length ? prev[prev.length - 1].seq : -1
    const fresh = events.filter((e) => e.seq > maxSeq)
    if (fresh.length === 0 && prev.length) return {} // 重复 push、无新事件 → 不动
    const merged = prev.length ? [...prev, ...fresh] : fresh

    const eventsBySession = { ...state.eventsBySession, [sessionId]: merged }

    // 重算 live 状态（filePath/cwd/hasSubagents 沿用列表里的概要）。
    // completed 由目录启发式在 list() 里设置；ingest 重算摘要（token/消息数等），但保留 completed 标记不覆盖。
    const prevSummary = state.summaries.find((s) => s.sessionId === sessionId)
    let summaries = state.summaries
    if (prevSummary) {
      const ms = lastActivityMs(merged)
      const live = summarizeEvents(merged, {
        sessionId,
        filePath: prevSummary.filePath,
        cwd: prevSummary.cwd,
        hasSubagents: prevSummary.hasSubagents,
        mtimeMs: ms,
        nowMs: Date.now(),
      })
      const updated = prevSummary.status === 'completed' ? { ...live, status: 'completed' as const } : live
      summaries = state.summaries.map((s) => (s.sessionId === sessionId ? updated : s))
    }
    return { eventsBySession, summaries }
  })
}
