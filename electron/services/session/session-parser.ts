import type { SessionEvent, SessionEventBase, TokenUsage } from '../../../shared/types'

export interface ParseOpts {
  /** tool_result content 截断，默认 4000 */
  maxResultChars?: number
  /** MetaEvent 是否保留 raw，默认 true */
  keepRawMeta?: boolean
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

/** 从 content（string 或 块数组）抽文本块拼接。 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && typeof b === 'object' && (b as Raw).type === 'text')
    .map((b) => ((b as Raw).text ?? '') as string)
    .join('')
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** tool_result content → 文本：string 原样（含空串）；块数组取 text，无 text 但有块则 stringify；空数组/缺省 → ''。 */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = extractText(content)
    return text || (content.length ? stringify(content) : '')
  }
  return content == null ? '' : stringify(content)
}

function truncate(s: string, opts?: ParseOpts): string {
  const max = opts?.maxResultChars ?? 4000
  return s.length > max ? s.slice(0, max) + '…' : s
}

function mapUsage(u: Raw | undefined): TokenUsage | undefined {
  if (!u || typeof u !== 'object') return undefined
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheCreationInputTokens: num(u.cache_creation_input_tokens),
    cacheReadInputTokens: num(u.cache_read_input_tokens),
    serviceTier: typeof u.service_tier === 'string' ? u.service_tier : undefined,
    serverToolUse: u.server_tool_use && typeof u.server_tool_use === 'object' ? u.server_tool_use : undefined,
  }
}

/** 解析单行原始 JSON 字符串 → 0..N 个规范化事件（一行 assistant 可拆多个）。坏行返回 []（调用方计 malformed）。 */
export function parseLine(line: string, seq: number, opts?: ParseOpts): SessionEvent[] {
  let o: Raw
  try {
    o = JSON.parse(line)
  } catch {
    return []
  }
  if (!o || typeof o !== 'object') return []

  const base: SessionEventBase = {
    uuid: typeof o.uuid === 'string' ? o.uuid : `${seq}`,
    parentUuid: typeof o.parentUuid === 'string' ? o.parentUuid : null,
    sessionId: o.sessionId,
    timestamp: o.timestamp,
    cwd: o.cwd,
    version: o.version,
    isSidechain: o.isSidechain === true ? true : undefined,
    agentId: typeof o.agentId === 'string' ? o.agentId : undefined,
    seq,
  }
  const msg: Raw = o.message && typeof o.message === 'object' ? o.message : {}
  const content = msg.content
  const blocks: Raw[] = Array.isArray(content) ? content : []

  switch (o.type) {
    case 'assistant': {
      let hasThinking = false
      let thinkingChars = 0
      for (const b of blocks) {
        if (b?.type === 'thinking') {
          hasThinking = true
          thinkingChars += typeof b.thinking === 'string' ? b.thinking.length : 0
        }
      }
      const events: SessionEvent[] = [{
        ...base,
        kind: 'assistant_turn',
        model: typeof msg.model === 'string' ? msg.model : undefined,
        text: extractText(content),
        hasThinking,
        thinkingChars,
        stopReason: typeof msg.stop_reason === 'string' ? msg.stop_reason : undefined,
        usage: mapUsage(msg.usage),
      }]
      blocks.forEach((b, i) => {
        if (b?.type === 'tool_use') {
          // 缺 id 时用唯一兜底（不可与别的缺 id 记录互相闭环；'' 会让两条无关记录假配对）
          const tid = typeof b.id === 'string' && b.id ? b.id : `noid:${base.uuid}:${i}`
          events.push({
            ...base,
            uuid: tid,
            kind: 'tool_use',
            toolUseId: tid,
            toolName: typeof b.name === 'string' ? b.name : '',
            input: b.input && typeof b.input === 'object' ? b.input : {},
            subagentType: typeof b.input?.subagent_type === 'string' ? b.input.subagent_type : undefined,
            parentTurnUuid: base.uuid,
          })
        }
      })
      return events
    }
    case 'user': {
      const events: SessionEvent[] = []
      blocks.forEach((b, i) => {
        if (b?.type === 'tool_result') {
          events.push({
            ...base,
            uuid: `${base.uuid}:tr:${i}`,
            kind: 'tool_result',
            toolUseId: typeof b.tool_use_id === 'string' && b.tool_use_id ? b.tool_use_id : `noresult:${seq}:${i}`,
            isError: b.is_error === true,
            contentText: truncate(toolResultText(b.content), opts),
            structured: o.toolUseResult,
          })
        }
      })
      // 用户文本块与 tool_result 可能并存（中断/续写场景）——有文本就额外发 user_turn，避免丢失人类输入
      const text = extractText(content)
      if (text || events.length === 0) {
        events.push({ ...base, kind: 'user_turn', text, entrypoint: o.entrypoint, gitBranch: o.gitBranch })
      }
      return events
    }
    case 'system':
      return [{ ...base, kind: 'system', subtype: o.subtype, level: o.level, content: typeof o.content === 'string' ? o.content : undefined }]
    default:
      return [{
        ...base,
        kind: 'meta',
        metaType: typeof o.type === 'string' ? o.type : 'unknown',
        raw: opts?.keepRawMeta === false ? undefined : o,
      }]
  }
}

/** 批量解析整段文本（按 \n 切，跳过空行，坏行计入 malformed 不抛）。seq 仅在非空行递增。 */
export function parseChunk(
  text: string,
  startSeq: number,
  opts?: ParseOpts
): { events: SessionEvent[]; nextSeq: number; malformed: number } {
  const events: SessionEvent[] = []
  let seq = startSeq
  let malformed = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const evs = parseLine(line, seq, opts)
    if (evs.length === 0) malformed++
    else events.push(...evs)
    seq++
  }
  return { events, nextSeq: seq, malformed }
}
