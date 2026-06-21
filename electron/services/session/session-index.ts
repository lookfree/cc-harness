import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { decodeCwd } from './session-path'
import type { SessionFileMeta } from '../../../shared/types'

const SUFFIX = '.jsonl'

/** 列出所有 project 目录及其 session 文件（不解析内容，只 stat）。目录不存在 → []（ENOENT 静默）。 */
export async function listSessions(projectsRoot?: string): Promise<SessionFileMeta[]> {
  const root = projectsRoot ?? path.join(os.homedir(), '.claude', 'projects')
  let projectDirs: string[]
  try {
    projectDirs = await fs.readdir(root)
  } catch {
    return []
  }

  const out: SessionFileMeta[] = []
  for (const encodedCwd of projectDirs) {
    const projDir = path.join(root, encodedCwd)
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(projDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith(SUFFIX)) continue
      const sessionId = ent.name.slice(0, -SUFFIX.length)
      const filePath = path.join(projDir, ent.name)
      let st: import('fs').Stats
      try {
        st = await fs.stat(filePath)
      } catch {
        continue
      }
      // subagent/workflow 在 <projDir>/<sessionId>/subagents（spec016）
      let hasSubagents = false
      try {
        hasSubagents = (await fs.stat(path.join(projDir, sessionId, 'subagents'))).isDirectory()
      } catch {
        /* 无则 false */
      }
      out.push({
        encodedCwd,
        cwd: decodeCwd(encodedCwd),
        sessionId,
        filePath,
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
        hasSubagents,
      })
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs) // 最近活跃在前
  return out
}
