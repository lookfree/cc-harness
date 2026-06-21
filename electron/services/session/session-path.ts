import type { SessionEvent } from '../../../shared/types'

/** /Users/a/b → -Users-a-b（Claude Code 规则：把 '/' 换成 '-'）。 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-')
}

/**
 * -Users-a-b → /Users/a/b（尽力还原）。
 * ⚠ 有损：原路径含 '-' 时无法区分。仅用于"显示/反查"占位；权威 cwd 用 resolveCwdFromEvents（行内 cwd）。
 */
export function decodeCwd(encoded: string): string {
  return encoded.replace(/^-/, '/').replace(/-/g, '/')
}

/** 从首条带 cwd 的事件取真实 cwd（权威，胜过有损的 decodeCwd）。 */
export function resolveCwdFromEvents(events: SessionEvent[]): string | undefined {
  for (const e of events) if (e.cwd) return e.cwd
  return undefined
}
