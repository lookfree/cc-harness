import path from 'path'
import type { MCPServers } from '../../shared/types'
import { FileManagerHooks } from './file-manager-hooks'

export class FileManagerMcp extends FileManagerHooks {
  // MCP Servers
  async getMCPServers(): Promise<MCPServers> {
    this.logger.info('getMCPServers() called')

    // Try claude_mcp_config.json first (the actual file Claude uses)
    const userMCPPath = path.join(this.userConfigPath, 'claude_mcp_config.json')
    this.logger.info('Checking user MCP config at:', userMCPPath)
    const userMCP = await this.readJSONFile<{ mcpServers: MCPServers }>(userMCPPath)

    // Also check for mcpServers.json in project
    const projectMCPPath = path.join(this.projectPath, '.claude', 'mcpServers.json')
    this.logger.info('Checking project MCP config at:', projectMCPPath)
    const projectMCP = await this.readJSONFile<{ mcpServers: MCPServers }>(projectMCPPath)

    const servers = {
      ...(userMCP?.mcpServers || {}),
      ...(projectMCP?.mcpServers || {}),
    }

    this.logger.info('Found', Object.keys(servers).length, 'MCP servers')
    return servers
  }

  async saveMCPServers(servers: MCPServers, location: 'user' | 'project' = 'project'): Promise<void> {
    const filePath = location === 'project'
      ? path.join(this.projectPath, '.claude', 'mcpServers.json')
      : path.join(this.userConfigPath, 'mcpServers.json')

    await this.writeJSONFile(filePath, { mcpServers: servers })
  }
}
