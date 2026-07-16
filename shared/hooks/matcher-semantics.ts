/**
 * Hook matcher 语义分析（HOOK-12，对齐 Claude Code ≥2.1.195）：
 * - 2.1.195 起 plain 字符串按**精确匹配**（此前带连字符的名字会意外子串匹配，如
 *   `code-reviewer` 能命中 `mcp__code-reviewer-pro__x`，升级后不再命中）
 * - 2.1.191 起逗号分隔列表（`"Bash,PowerShell"`）正常生效（此前静默失效）
 * - 含正则元字符的按正则解释（`Edit|Write`、`mcp__brave-search__.*`）
 * 用途：Hook 编辑器实时提示"这个 matcher 在当前版本会命中什么"，直击"hook 为什么没生效"。
 */
export interface MatcherAnalysis {
  kind: 'empty' | 'exact' | 'list' | 'regex'
  /** exact/list：按精确等值命中的名字集合；regex 不填 */
  names?: string[]
  /** regex 语法非法（new RegExp 抛错）——该 matcher 不会命中任何工具 */
  invalidRegex?: boolean
  /**
   * 形如 `mcp__<server>` 的精确名：MCP 工具名是 `mcp__<server>__<tool>`，
   * 精确匹配下这个写法命不中该 server 的任何工具，应写 `mcp__<server>__.*`
   */
  mcpPrefixSuspect?: boolean
}

const REGEX_META = /[|*+?^$()[\]{}\\.]/

export function analyzeHookMatcher(matcher: string): MatcherAnalysis {
  const m = matcher.trim()
  if (!m) return { kind: 'empty' }
  if (m.includes(',')) {
    return {
      kind: 'list',
      names: m
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  }
  if (REGEX_META.test(m)) {
    try {
      new RegExp(m)
      return { kind: 'regex' }
    } catch {
      return { kind: 'regex', invalidRegex: true }
    }
  }
  return {
    kind: 'exact',
    names: [m],
    mcpPrefixSuspect: m.startsWith('mcp__') && m.split('__').length === 2 ? true : undefined,
  }
}
