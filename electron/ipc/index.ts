import type { IpcMain } from 'electron'
import type { FileManager } from '../services/file-manager'
import { registerSkillHandlers } from './skills'
import { registerAgentHandlers } from './agents'
import { registerHookHandlers } from './hooks'
import { registerMCPHandlers } from './mcp'
import { registerCommandHandlers } from './commands'
import { registerClaudeMDHandlers } from './claudemd'
import { registerProjectHandlers } from './project'
import { registerDependencyHandlers } from './dependencies'
import { registerValidationHandlers } from './validation'
import { registerProviderHandlers } from './providers'
import { registerPluginHandlers } from './plugins'
import { registerPermissionHandlers } from './permissions'
import { registerSettingsHandlers } from './settings'
import { registerMemoryHandlers } from './memory'
import { registerLoopHandlers } from './loop'

export function registerIPCHandlers(ipcMain: IpcMain, fileManager: FileManager) {
  registerSkillHandlers(ipcMain, fileManager)
  registerAgentHandlers(ipcMain, fileManager)
  registerHookHandlers(ipcMain, fileManager)
  registerMCPHandlers(ipcMain, fileManager)
  registerCommandHandlers(ipcMain, fileManager)
  registerClaudeMDHandlers(ipcMain, fileManager)
  registerProjectHandlers(ipcMain, fileManager)
  registerDependencyHandlers(ipcMain, fileManager)
  registerValidationHandlers(ipcMain)
  registerProviderHandlers()
  registerPluginHandlers(ipcMain, fileManager)
  registerPermissionHandlers(ipcMain, fileManager)
  registerSettingsHandlers(ipcMain, fileManager)
  registerMemoryHandlers(ipcMain)
  registerLoopHandlers(ipcMain)
}
