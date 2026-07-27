/**
 * 最小 ANSI SGR 解析器（spec027）：把终端转义文本切成带样式的段，供 React 渲染 span。
 * 只解析 SGR（ESC[...m）；其余 CSI/OSC/两字节转义剥离；截断产生的残缺尾部丢弃。
 * 不产出 HTML 字符串——无 dangerouslySetInnerHTML，无 XSS 面。
 */

export interface AnsiSegment {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

// 16 基色取中等对比度值：深浅主题下语义色（红=错/绿=过）都可读，两端避开纯黑纯白
const PALETTE: string[] = [
  '#52525b', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#d946ef', '#06b6d4', '#a1a1aa', // 30-37
  '#71717a', '#f87171', '#4ade80', '#facc15', '#60a5fa', '#e879f9', '#22d3ee', '#d4d4d8', // 90-97 bright
]

/** 256 色 → CSS：0-15 查表；16-231 六值立方；232-255 灰阶 */
function color256(n: number | undefined): string | undefined {
  if (n === undefined || !Number.isInteger(n) || n < 0 || n > 255) return undefined
  if (n < 16) return PALETTE[n]
  if (n < 232) {
    const c = n - 16
    const v = (x: number) => (x === 0 ? 0 : 55 + x * 40)
    return `rgb(${v(Math.floor(c / 36))},${v(Math.floor(c / 6) % 6)},${v(c % 6)})`
  }
  const g = 8 + (n - 232) * 10
  return `rgb(${g},${g},${g})`
}

export function hasAnsi(s: string): boolean {
  // 任意 ESC 都进解析路径：SGR 上色，OSC/其他转义剥离（只认 ESC[ 会漏纯 OSC 输出）
  return s.includes('\x1b')
}

interface Style {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  inverse?: boolean
}

/** 应用一串 SGR 参数到样式状态（就地改） */
function applySgr(params: number[], st: Style): void {
  for (let i = 0; i < params.length; i++) {
    const p = params[i]
    if (p === 0) { for (const k of Object.keys(st) as (keyof Style)[]) delete st[k] }
    else if (p === 1) st.bold = true
    else if (p === 2) st.dim = true
    else if (p === 3) st.italic = true
    else if (p === 4) st.underline = true
    else if (p === 7) st.inverse = true
    else if (p === 9) st.strikethrough = true
    else if (p === 22) { delete st.bold; delete st.dim }
    else if (p === 23) delete st.italic
    else if (p === 24) delete st.underline
    else if (p === 27) delete st.inverse
    else if (p === 29) delete st.strikethrough
    else if (p >= 30 && p <= 37) st.fg = PALETTE[p - 30]
    else if (p >= 90 && p <= 97) st.fg = PALETTE[p - 90 + 8]
    else if (p === 39) delete st.fg
    else if (p >= 40 && p <= 47) st.bg = PALETTE[p - 40]
    else if (p >= 100 && p <= 107) st.bg = PALETTE[p - 100 + 8]
    else if (p === 49) delete st.bg
    else if (p === 38 || p === 48) {
      let c: string | undefined
      if (params[i + 1] === 5) { c = color256(params[i + 2]); i += 2 }
      else if (params[i + 1] === 2) { c = `rgb(${params[i + 2] ?? 0},${params[i + 3] ?? 0},${params[i + 4] ?? 0})`; i += 4 }
      if (c) { if (p === 38) st.fg = c; else st.bg = c }
    }
    // 其余（闪烁/字体等）忽略
  }
}

/**
 * 依序匹配：完整 CSI（捕获参数+终止字节）｜行尾残缺 CSI（4000 字符截断产物）｜
 * OSC（BEL/ST 收尾，未收尾则到下个 ESC 为止）｜孤立 ESC+任意一字节。
 */
// eslint-disable-next-line no-control-regex -- 匹配 ESC/BEL 控制字符正是 ANSI 解析器的本职
const TOKEN = /\x1b\[([0-9;:<=>?]*)([@-~])|\x1b\[[0-9;:<=>?]*$|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[\s\S]?/g

export function parseAnsi(input: string): AnsiSegment[] {
  const segs: AnsiSegment[] = []
  const st: Style = {}
  let last = 0

  const push = (text: string) => {
    if (!text) return
    const { inverse, ...rest } = st
    const seg: AnsiSegment = { text, ...rest }
    // inverse：有色才交换，无色忽略（不是终端模拟器，不猜默认前景/背景）
    if (inverse && (seg.fg || seg.bg)) [seg.fg, seg.bg] = [seg.bg, seg.fg]
    segs.push(seg)
  }

  for (const m of input.matchAll(TOKEN)) {
    push(input.slice(last, m.index))
    last = m.index + m[0].length
    if (m[2] === 'm') {
      // 空参数串等价于 0；分隔符 ; 与 : 都认，空位补 0
      applySgr((m[1] || '0').split(/[;:]/).map((x) => (x === '' ? 0 : Number(x))), st)
    }
    // 非 m 的 CSI / OSC / 其他转义：剥离不渲染
  }
  push(input.slice(last))
  return segs
}
