import type { IpcMain } from 'electron'
import type { FileManager } from '../services/file-manager'
import type { MCPServerConfig } from '../../shared/types'
import { getMCPHealth } from '../services/mcp/mcp-health-service'
import { probeMCP } from '../services/mcp/mcp-prober'

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

  ipcMain.handle('mcp:health', async () => {
    const servers = await fileManager.getMCPServers()
    return getMCPHealth(servers)
  })

  ipcMain.handle('mcp:probe', async (_event, name: string) => {
    const servers = await fileManager.getMCPServers()
    const cfg = servers[name]
    if (!cfg) throw new Error(`Unknown MCP server: ${name}`)
    return probeMCP(name, cfg)
  })

  // Replaced fake stub — now routes to real single-server probe
  ipcMain.handle('mcp:test', async (_event, name: string) => {
    const servers = await fileManager.getMCPServers()
    const cfg = servers[name]
    if (!cfg) return { success: false, message: `Unknown server: ${name}` }
    const result = await probeMCP(name, cfg)
    return { success: result.state === 'connected', message: result.error ?? result.state }
  })
}
