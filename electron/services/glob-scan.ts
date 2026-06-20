import { promises as fs } from 'fs'
import path from 'path'

/** Node fs 「文件/目录不存在」判定。ENOENT=不存在，ENOTDIR=路径中段不是目录，两者都视作「正常缺失」。 */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** 把一个 glob 段编译成 entry 名匹配器。仅支持 '*'（单层通配，不跨 '/'）。 */
function segToMatcher(seg: string): (name: string) => boolean {
  if (seg === '*') return () => true
  if (!seg.includes('*')) return (name) => name === seg
  // 混合段（如 'v*'）：'*' → '.*'，其余字符转义，锚定全匹配
  const re = new RegExp(
    '^' +
      seg
        .split('*')
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$'
  )
  return (name) => re.test(name)
}

/**
 * 在 root 下按由 '/' 分段的 glob 模式匹配文件，每段仅支持 '*'（单层通配，不跨目录分隔符）。
 * @param root    扫描根的绝对路径
 * @param pattern 形如 '*​/SKILL.md' / '*​/*​/*​/skills/*​/SKILL.md' 的相对模式
 * @param opts.maxDepth   最大目录深度护栏（默认 8）
 * @param opts.maxResults 最大命中数护栏（默认 2000）
 * @returns 命中文件的绝对路径数组；root 不存在时返回 []（不抛错）。符号链接目录/文件一律跳过。
 */
export async function globScan(
  root: string,
  pattern: string,
  opts: { maxDepth?: number; maxResults?: number } = {}
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 8
  const maxResults = opts.maxResults ?? 2000
  const segs = pattern.split('/').filter(Boolean)
  const results: string[] = []
  if (segs.length === 0) return results

  async function walk(dir: string, segIdx: number, depth: number): Promise<void> {
    if (results.length >= maxResults || depth > maxDepth) return
    const matcher = segToMatcher(segs[segIdx])
    const isLast = segIdx === segs.length - 1

    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return // 缺失即空，静默
      throw error
    }

    for (const ent of entries) {
      if (results.length >= maxResults) return
      if (ent.isSymbolicLink()) continue // 跳过符号链接，防环、防越界
      if (!matcher(ent.name)) continue
      const full = path.join(dir, ent.name)
      if (isLast) {
        if (ent.isFile()) results.push(full)
      } else if (ent.isDirectory()) {
        await walk(full, segIdx + 1, depth + 1)
      }
    }
  }

  try {
    await walk(root, 0, 0)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
  return results
}
