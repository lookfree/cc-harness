import type { IpcMain } from 'electron'
import type { FileManager } from '../services/file-manager'
import type { SettingsLevel } from '../../shared/types'

export function registerSettingsHandlers(ipcMain: IpcMain, fileManager: FileManager) {
  ipcMain.handle('settings:getModel', () => fileManager.getSettingsModel())
  ipcMain.handle('settings:setKey', (_e, level: SettingsLevel, keyPath: string, value: unknown) =>
    fileManager.setSettingKey(level, keyPath, value)
  )
  ipcMain.handle('settings:getToggles', () => fileManager.getSafetyToggles())
}
