import type { IpcMain } from 'electron'
import { getBackgroundAgents } from '../services/bg-agents-service'

export function registerBgAgentsHandlers(ipcMain: IpcMain) {
  ipcMain.handle('bgagents:list', async () => {
    return getBackgroundAgents()
  })
}
