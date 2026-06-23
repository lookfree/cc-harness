import type { IpcMain } from 'electron'
import type { SessionMonitor } from '../services/session'

/**
 * Session 监视器 IPC（spec015）。请求/响应走 invoke；增量事件由 SessionMonitor
 * 经 win.webContents.send('session:events') 主动 push（preload onSessionEvents 接）。
 */
export function registerSessionHandlers(ipcMain: IpcMain, monitor: SessionMonitor) {
  ipcMain.handle('session:list', () => monitor.list())
  ipcMain.handle('session:snapshot', (_e, id: string, filePath: string) => monitor.snapshot(id, filePath))
  ipcMain.handle('session:subscribe', (_e, id: string, filePath: string) => {
    monitor.subscribe(id, filePath)
    return true
  })
  ipcMain.handle('session:unsubscribe', (_e, id: string) => {
    monitor.unsubscribe(id)
    return true
  })

  // spec016 agent 拓扑（subagent 树 + workflow 编排）
  ipcMain.handle('session:topology', (_e, filePath: string) => monitor.topology(filePath))
  ipcMain.handle('session:topology:subscribe', (_e, id: string, filePath: string) => {
    monitor.subscribeTopology(id, filePath)
    return true
  })
  ipcMain.handle('session:topology:unsubscribe', (_e, id: string) => {
    monitor.unsubscribeTopology(id)
    return true
  })

  // spec017 token/usage 分项 + ECC 建议
  ipcMain.handle('session:usage', (_e, id: string, filePath: string) => monitor.usage(id, filePath))

  ipcMain.handle('session:delete', (_e, id: string, filePath: string) => monitor.deleteSession(id, filePath))
}
