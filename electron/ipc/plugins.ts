import type { IpcMain } from 'electron'
import { spawn } from 'child_process'
import type { FileManager } from '../services/file-manager'
import type { PluginCliResult } from '../../shared/types'

// claude CLI 是否在 PATH，探测一次缓存（本机实测不在 PATH，降级为直接改 settings.json）
let claudeOnPathCache: boolean | null = null

function isClaudeOnPath(): Promise<boolean> {
  if (claudeOnPathCache !== null) return Promise.resolve(claudeOnPathCache)
  return new Promise((resolve) => {
    const probe = process.platform === 'win32' ? 'where' : 'which'
    try {
      const p = spawn(probe, ['claude'])
      p.on('close', (code) => {
        claudeOnPathCache = code === 0
        resolve(claudeOnPathCache)
      })
      p.on('error', () => {
        claudeOnPathCache = false
        resolve(false)
      })
    } catch {
      claudeOnPathCache = false
      resolve(false)
    }
  })
}

async function runClaudePlugin(args: string[], cwd?: string): Promise<PluginCliResult> {
  if (!(await isClaudeOnPath())) {
    return { ok: false, cliAvailable: false, message: 'claude CLI 不在 PATH，已降级为只读 / 直接改 settings.json' }
  }
  return new Promise<PluginCliResult>((resolve) => {
    const p = spawn('claude', ['plugin', ...args], { cwd })
    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (r: PluginCliResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    // 超时护栏：CLI 挂起（等 stdin auth / 网络）时不让 IPC invoke 永久卡住
    const timer = setTimeout(() => {
      p.kill()
      finish({ ok: false, cliAvailable: true, stdout, stderr, message: 'claude plugin 超时（30s），已终止' })
    }, 30000)
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('close', (code) =>
      finish({ ok: code === 0, cliAvailable: true, stdout, stderr, message: code === 0 ? 'ok' : `claude plugin exited ${code}` })
    )
    p.on('error', (e) => finish({ ok: false, cliAvailable: true, stderr: String(e), message: String(e) }))
  })
}

// enable/disable：优先 claude plugin enable/disable；CLI 不可用时直接改 settings.json（降级主路径）
async function setPluginEnabled(fileManager: FileManager, key: string, val: boolean): Promise<PluginCliResult> {
  const cli = await runClaudePlugin([val ? 'enable' : 'disable', key])
  if (cli.cliAvailable) return cli
  await fileManager.setEnabledPlugin(key, val)
  return { ok: true, cliAvailable: false, message: `已直接写入 settings.json：${key} = ${val}` }
}

export function registerPluginHandlers(ipcMain: IpcMain, fileManager: FileManager) {
  ipcMain.handle('plugins:cliStatus', () => isClaudeOnPath())
  ipcMain.handle('plugins:getMarketplaces', () => fileManager.getMarketplaces())
  ipcMain.handle('plugins:getAll', () => fileManager.getPlugins())
  ipcMain.handle('plugins:details', (_e, key: string) => runClaudePlugin(['details', key]))
  ipcMain.handle('plugins:enable', (_e, key: string) => setPluginEnabled(fileManager, key, true))
  ipcMain.handle('plugins:disable', (_e, key: string) => setPluginEnabled(fileManager, key, false))
  ipcMain.handle('plugins:init', (_e, name: string, cwd?: string) => runClaudePlugin(['init', name], cwd))
}
