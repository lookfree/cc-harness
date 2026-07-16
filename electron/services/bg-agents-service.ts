import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { isMissing } from './glob-scan'
import type { BackgroundAgentsSnapshot, BgAgentItem, BgJobDetail, CliAgentRow } from '../../shared/types'

const execFileP = promisify(execFile)

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

/** 读 JSON 对象；ENOENT（文件不存在）静默，坏 JSON / 权限等真错误记日志（否则损坏的 roster/state 无从排查）。 */
async function readJson(p: string): Promise<Record<string, unknown> | null> {
  let text: string
  try {
    text = await fs.readFile(p, 'utf8')
  } catch (e) {
    if (!isMissing(e)) console.warn('[bg-agents] read failed:', p, e)
    return null
  }
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch (e) {
    console.warn('[bg-agents] parse failed:', p, e)
    return null
  }
}

interface ClaudeBin {
  bin: string
  /** Windows 上 npm 的 claude.cmd shim 必须 shell:true 才能被 execFile 执行 */
  shell: boolean
}
let claudeBinCache: ClaudeBin | undefined

/**
 * 解析 claude 可执行文件：Electron GUI 进程的 PATH 常缺 shell 里的自定义路径（launchd 环境），
 * PATH 找不到时按常见安装位兜底。命中具体文件才缓存；退回 PATH 不缓存，以便安装后下次重探。
 */
async function resolveClaudeBin(): Promise<ClaudeBin> {
  if (claudeBinCache) return claudeBinCache
  const home = os.homedir()
  const isWin = process.platform === 'win32'
  const candidates = isWin
    ? [
        path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
        path.join(home, '.local', 'bin', 'claude.exe'),
      ]
    : [path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude']
  for (const c of candidates) {
    try {
      await fs.access(c)
      const hit: ClaudeBin = { bin: c, shell: c.endsWith('.cmd') }
      claudeBinCache = hit
      return hit
    } catch {
      /* 试下一个 */
    }
  }
  // 交给 PATH（Windows 上 .cmd shim 需 shell:true）；不缓存，留后续重探机会
  return { bin: 'claude', shell: isWin }
}

/**
 * 后台 agent / 活跃会话快照（ORCH-01/02/12、OBS-06）：
 * `claude agents --json --all` 为权威 roster（官方脚本化出口，不需要 TTY），
 * 后台 job 再用 jobs/<short>/state.json + daemon/roster.json 充实细节。
 * CLI 不可用/超时 → available:false 并带错误信息，UI 降级提示。
 */
export async function getBackgroundAgents(): Promise<BackgroundAgentsSnapshot> {
  const fetchedAt = Date.now()
  const claudeDir = path.join(os.homedir(), '.claude')

  const roster = await readJson(path.join(claudeDir, 'daemon', 'roster.json'))

  // ORCH-05：pins.json（实测为数组，当前样本为空——按字符串条目防御性匹配 id/sessionId）
  let pins: string[] = []
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(claudeDir, 'jobs', 'pins.json'), 'utf8')) as unknown
    if (Array.isArray(parsed)) pins = parsed.filter((p): p is string => typeof p === 'string')
  } catch {
    /* 缺失/损坏 → 无钉住 */
  }
  const workers =
    roster?.workers && typeof roster.workers === 'object' && !Array.isArray(roster.workers)
      ? (roster.workers as Record<string, Record<string, unknown>>)
      : {}

  let rows: CliAgentRow[] = []
  let error: string | undefined
  try {
    const { bin, shell } = await resolveClaudeBin()
    const { stdout } = await execFileP(bin, ['agents', '--json', '--all'], {
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      shell,
    })
    const parsed = JSON.parse(stdout) as unknown
    if (Array.isArray(parsed)) rows = parsed as CliAgentRow[]
    else error = 'unexpected_output'
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  const items: BgAgentItem[] = await Promise.all(
    rows.map(async (r): Promise<BgAgentItem> => {
      const pinned = pins.length > 0 && ((!!r.id && pins.includes(r.id)) || pins.includes(r.sessionId)) ? true : undefined
      if (!r.id) return { ...r, pinned }
      const jobState = await readJson(path.join(claudeDir, 'jobs', r.id, 'state.json'))
      const worker = workers[r.id]
      if (!jobState && !worker) return { ...r, pinned }
      const job: BgJobDetail = {
        state: str(jobState?.state),
        detail: str(jobState?.detail),
        tempo: str(jobState?.tempo),
        intent: str(jobState?.intent),
        respawnFlags: Array.isArray(jobState?.respawnFlags)
          ? (jobState!.respawnFlags as unknown[]).filter((f): f is string => typeof f === 'string')
          : undefined,
        createdAt: str(jobState?.createdAt),
        updatedAt: str(jobState?.updatedAt),
        backend: str(jobState?.backend),
        cliVersion: str(worker?.cliVersion),
        attempt: num(worker?.attempt),
      }
      return { ...r, job, pinned }
    })
  )

  return { available: !error, error, fetchedAt, items, rosterUpdatedAt: num(roster?.updatedAt) }
}
