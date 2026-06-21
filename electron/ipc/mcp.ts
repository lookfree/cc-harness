import type { IpcMain } from 'electron'
import type { FileManager } from '../services/file-manager'
import type { MCPServerConfig } from '../../shared/types'

export function registerMCPHandlers(ipcMain: IpcMain, fileManager: FileManager) {
  ipcMain.handle('mcp:getAll', async () => {
    return await fileManager.getMCPServers()
  })

  ipcMain.handle('mcp:get', async (_event, name: string) => {
    const servers = await fileManager.getMCPServers()
    return servers[name] || null
  })

  ipcMain.handle('mcp:getSources', async () => {
    return await fileManager.getMCPServerSources()
  })

  ipcMain.handle('mcp:save', async (_event, name: string, config: MCPServerConfig, location?: 'user' | 'project') => {
    await fileManager.saveMCPServer(name, config, location)
  })

  ipcMain.handle('mcp:delete', async (_event, name: string) => {
    await fileManager.deleteMCPServer(name)
  })

  ipcMain.handle('mcp:test', async (_event, _name: string) => {
    // TODO: Implement MCP connection testing
    return { success: true, message: 'Connection test not yet implemented' }
  })
}
