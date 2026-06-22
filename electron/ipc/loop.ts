import type { IpcMain } from 'electron'
import { discoverLoops } from '../services/loop/loop-discovery'

export function registerLoopHandlers(ipcMain: IpcMain) {
  ipcMain.handle('loop:list', () => discoverLoops())
}
