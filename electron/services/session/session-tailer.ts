import { promises as fs, createReadStream } from 'fs'
import { watch, FSWatcher } from 'chokidar'
import { parseChunk, type ParseOpts } from './session-parser'
import type { SessionEvent } from '../../../shared/types'

interface TailState {
  offset: number // 已读到的字节位置（行边界）
  seq: number
  leftover: Buffer // 上次读到的不完整末行（字节），下次拼接（避免多字节 UTF-8 在边界被切）
}

export interface TailEventDetail {
  filePath: string
  events: SessionEvent[]
  initial: boolean
}

/** 自带 detail 的事件（不依赖 Node 全局 CustomEvent）。 */
class TailEvent<T> extends Event {
  constructor(type: string, public readonly detail: T) {
    super(type)
  }
}

/**
 * 增量 tail：每个文件记字节 offset，change 后只读新增字节、按行解析、推 SessionEvent。
 * 事件：'events'（{filePath, events, initial}）/ 'truncated'（{filePath}）/ 'error'（{filePath, error}）。
 *
 * ⚠ 直接 watch 具体 .jsonl 路径，**不套** file-manager 那条 dotfile 忽略正则——目标在 `.claude` 段下，
 * 套上会一个事件都收不到（spec014 验收专门验证这点）。
 */
export class SessionTailer extends EventTarget {
  private states = new Map<string, TailState>()
  private watchers = new Map<string, FSWatcher>()
  private queues = new Map<string, Promise<void>>()

  constructor(private opts?: ParseOpts) {
    super()
  }

  /** 开始 tail：先全量解析一遍（initial），再监听增量。 */
  watch(filePath: string): void {
    if (this.watchers.has(filePath)) return
    this.states.set(filePath, { offset: 0, seq: 0, leftover: Buffer.alloc(0) })
    this.enqueue(filePath, () => this.readDelta(filePath, true))

    const w = watch(filePath, { persistent: true, ignoreInitial: true, awaitWriteFinish: false })
    w.on('change', () => this.enqueue(filePath, () => this.onChange(filePath)))
    // watcher 就绪后补读一次：关掉「初始全量读 ↔ watcher 生效」之间写入被漏掉的窗口
    w.on('ready', () => this.enqueue(filePath, () => this.onChange(filePath)))
    w.on('error', (err) => this.emitErr(filePath, err))
    this.watchers.set(filePath, w)
  }

  unwatch(filePath: string): void {
    this.watchers.get(filePath)?.close()
    this.watchers.delete(filePath)
    this.states.delete(filePath)
    this.queues.delete(filePath)
  }

  unwatchAll(): void {
    for (const fp of [...this.watchers.keys()]) this.unwatch(fp)
  }

  /** 串行化每个文件的读取，避免重叠 change 导致 offset 竞态/重复读。 */
  private enqueue(filePath: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(filePath) ?? Promise.resolve()
    const next = prev.then(fn).catch((err) => this.emitErr(filePath, err))
    this.queues.set(filePath, next)
    return next
  }

  private async onChange(filePath: string): Promise<void> {
    const st = this.states.get(filePath)
    if (!st) return
    const { size } = await fs.stat(filePath)
    if (size < st.offset) {
      // 文件变小（被重写/轮转）→ 重置全量
      st.offset = 0
      st.seq = 0
      st.leftover = Buffer.alloc(0)
      this.dispatchEvent(new TailEvent('truncated', { filePath }))
      await this.readDelta(filePath, true)
    } else if (size > st.offset) {
      await this.readDelta(filePath, false, size)
    }
  }

  /** 读 [offset, end) 字节，拼 leftover，按行解析增量。 */
  private async readDelta(filePath: string, initial: boolean, knownEnd?: number): Promise<void> {
    const st = this.states.get(filePath)
    if (!st) return
    const end = knownEnd ?? (await fs.stat(filePath)).size
    if (end < st.offset) return

    const chunks: Buffer[] = []
    if (end > st.offset) {
      await new Promise<void>((resolve, reject) => {
        const rs = createReadStream(filePath, { start: st.offset, end: end - 1 }) // end inclusive
        rs.on('data', (c) => chunks.push(c as Buffer))
        rs.on('end', () => resolve())
        rs.on('error', reject)
      })
    }
    const combined = Buffer.concat([st.leftover, ...chunks])
    const lastNl = combined.lastIndexOf(0x0a)
    let completeText = ''
    if (lastNl === -1) {
      st.leftover = combined
    } else {
      completeText = combined.subarray(0, lastNl + 1).toString('utf8')
      st.leftover = Buffer.from(combined.subarray(lastNl + 1))
    }
    st.offset = end

    if (completeText) {
      const { events, nextSeq } = parseChunk(completeText, st.seq, this.opts)
      st.seq = nextSeq
      this.dispatchEvent(new TailEvent('events', { filePath, events, initial }))
    } else if (initial) {
      // 空文件/无完整行：仍发一个 initial 空批，便于消费方知道已就绪
      this.dispatchEvent(new TailEvent('events', { filePath, events: [], initial }))
    }
  }

  private emitErr(filePath: string, error: unknown): void {
    this.dispatchEvent(new TailEvent('error', { filePath, error }))
  }
}
