import type { PermissionParam, PermissionRule } from '../types/permission'

/**
 * 已知工具与其参数 key 提示（驱动 UI 下拉/自动补全）。
 * 值为 ['']：该工具用「路径/命令整体匹配」，inner 不按冒号切 key（如 Bash(git push:*)、Read(src/**)）。
 * 值为命名 key 列表：按 key:value 解析（如 WebFetch(domain:github.com)）。
 */
export const TOOL_PARAM_HINTS: Record<string, string[]> = {
  Bash: [''],
  Read: [''],
  Write: [''],
  Edit: [''],
  WebFetch: ['domain'],
  WebSearch: [],
}

/** TOOL_PARAM_HINTS[tool] === [''] 的工具：inner 整体当单个 value，不切 key、不按逗号分多参。 */
export function isWholeValueTool(tool: string): boolean {
  const hint = TOOL_PARAM_HINTS[tool]
  return hint?.length === 1 && hint[0] === ''
}

const hasGlob = (s: string): boolean => /[*]/.test(s)

/** 解析单条规则字符串 → 不含 level/effect 的结构（由调用方填）。 */
export function parsePermissionRule(raw: string): Omit<PermissionRule, 'effect' | 'level'> {
  const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\((.*)\))?$/)
  if (!m) return { raw, tool: raw, params: [] }
  const tool = m[1]
  const inner = m[2]?.trim()
  if (!inner) return { raw, tool, params: [] }

  // Bash/Read/Write 等无命名 key 工具：inner 整体作为单个 value（value 内的 ':' 是前缀匹配语义，不当 key 分隔）
  if (isWholeValueTool(tool)) {
    return { raw, tool, params: [{ key: '', value: inner, isGlob: hasGlob(inner) }] }
  }

  // 命名参数工具：按逗号切多参，每参在第一个冒号处切 key/value
  const params: PermissionParam[] = inner
    .split(',')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0)
    .map((seg) => {
      const ci = seg.indexOf(':')
      if (ci === -1) return { key: '', value: seg, isGlob: hasGlob(seg) }
      const key = seg.slice(0, ci).trim()
      const value = seg.slice(ci + 1).trim()
      return { key, value, isGlob: hasGlob(value) }
    })
  return { raw, tool, params }
}

/** 由结构化字段生成规则字符串（与 parse round-trip 一致）。 */
export function formatPermissionRule(tool: string, params: PermissionParam[]): string {
  if (!params.length) return tool
  const inner = params.map((p) => (p.key ? `${p.key}:${p.value}` : p.value)).join(', ')
  return `${tool}(${inner})`
}
