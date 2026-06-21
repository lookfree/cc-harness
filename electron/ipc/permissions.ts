import type { IpcMain } from 'electron'
import type { FileManager } from '../services/file-manager'
import type { PermissionEffect, PermissionLevel } from '../../shared/types'

export function registerPermissionHandlers(ipcMain: IpcMain, fileManager: FileManager) {
  ipcMain.handle('permissions:getModel', () => fileManager.getPermissionModel())
  ipcMain.handle('permissions:saveRule', (_e, level: PermissionLevel, effect: PermissionEffect, rule: string) =>
    fileManager.savePermissionRule(level, effect, rule)
  )
  ipcMain.handle('permissions:deleteRule', (_e, level: PermissionLevel, effect: PermissionEffect, rule: string) =>
    fileManager.deletePermissionRule(level, effect, rule)
  )
  ipcMain.handle('permissions:getDisallowedTools', (_e, filePath: string) =>
    fileManager.getDisallowedTools(filePath)
  )
  ipcMain.handle('permissions:setDisallowedTools', (_e, filePath: string, tools: string[]) =>
    fileManager.setDisallowedTools(filePath, tools)
  )
}
