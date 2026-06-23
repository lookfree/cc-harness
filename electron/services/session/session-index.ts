import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { decodeCwd } from './session-path'
import type { SessionFileMeta } from '../../../shared/types'

const SUFFIX = '.jsonl'

export const SESSIONS_ROOT = path.join(os.homedir(), '.claude', 'projects')

/** 列出所有 project 目录及其 session 文件（不解析内容，只 stat）。目录不存在 → []（ENOENT 静默）。 */
export async function listSessions(projectsRoot?: string): Promise<SessionFileMeta[]> {
  const root = projectsRoot ?? SESSIONS_ROOT
  let projectDirs: string[]
  try {
    projectDirs = await fs.readdir(root)
  } catch {
    return []
  }

  // 各 project 并行扫描；每个文件的 stat 也并行（避免数百次串行 stat 阻塞 UI 加载）。
  const perProject = await Promise.all(projectDirs.map((encodedCwd) => scanProject(root, encodedCwd)))
  const out = perProject.flat()
  out.sort((a, b) => b.mtimeMs - a.mtimeMs) // 最近活跃在前
  return out
}

/** 扫一个 project 目录下的所有 .jsonl，坏目录 → []。 */
async function scanProject(root: string, encodedCwd: string): Promise<SessionFileMeta[]> {
  const projDir = path.join(root, encodedCwd)
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(projDir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(SUFFIX))
  const metas = await Promise.all(files.map((e) => statSession(projDir, encodedCwd, e.name)))
  return metas.filter((m): m is SessionFileMeta => m !== null)
}

/** stat 单个 session 文件 + 探 subagents 子目录（并行），stat 失败 → null（跳过）。 */
async function statSession(projDir: string, encodedCwd: string, name: string): Promise<SessionFileMeta | null> {
  const sessionId = name.slice(0, -SUFFIX.length)
  const filePath = path.join(projDir, name)
  // subagent/workflow 在 <projDir>/<sessionId>/subagents（spec016）——每 session 独立目录，须逐个探
  const [st, subStat] = await Promise.all([
    fs.stat(filePath).catch(() => null),
    fs.stat(path.join(projDir, sessionId, 'subagents')).catch(() => null),
  ])
  if (!st) return null
  return {
    encodedCwd,
    cwd: decodeCwd(encodedCwd),
    sessionId,
    filePath,
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs,
    hasSubagents: subStat?.isDirectory() ?? false,
  }
}
