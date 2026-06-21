import path from 'path'
import type { MCPServers, MCPServerConfig } from '../../shared/types'
import { FileManagerHooks } from './file-manager-hooks'
import { SettingsWriter } from './settings-writer'

export class FileManagerMcp extends FileManagerHooks {
  /**
   * MCP 配置写入复用 spec009 的 SettingsWriter（整对象 read-modify-write + 原子写 + 保留未知顶层 key），
   * 仅把路径换成 MCP 文件：user→claude_mcp_config.json，project→.claude/mcpServers.json。
   */
  private mcpWriter = new SettingsWriter((level) =>
    level === 'project'
      ? path.join(this.projectPath, '.claude', 'mcpServers.json')
      : path.join(this.userConfigPath, 'claude_mcp_config.json')
  )

  /** 无 command 但有 url 且没声明 type → 规范化为 http（便于 UI 按 isRemoteMCP 分组）。 */
  private normalizeMCP(c: MCPServerConfig): MCPServerConfig {
    return !c.command && c.url && !c.type ? { ...c, type: 'http' } : c
  }

  async getMCPServers(): Promise<MCPServers> {
    this.logger.info('getMCPServers() called')
    // 旧版本曾把 user 写到 ~/.claude/mcpServers.json，现统一用 claude_mcp_config.json——legacy 文件仍读入避免丢失
    const legacyUserMCP = await this.readJSONFile<{ mcpServers?: MCPServers }>(
      path.join(this.userConfigPath, 'mcpServers.json')
    )
    const userMCP = await this.readJSONFile<{ mcpServers?: MCPServers }>(
      path.join(this.userConfigPath, 'claude_mcp_config.json')
    )
    const projectMCP = await this.readJSONFile<{ mcpServers?: MCPServers }>(
      path.join(this.projectPath, '.claude', 'mcpServers.json')
    )
    const merged: MCPServers = {
      ...(legacyUserMCP?.mcpServers || {}),
      ...(userMCP?.mcpServers || {}),
      ...(projectMCP?.mcpServers || {}),
    }
    const out: MCPServers = {}
    for (const [name, cfg] of Object.entries(merged)) out[name] = this.normalizeMCP(cfg)
    this.logger.info('Found', Object.keys(out).length, 'MCP servers')
    return out
  }

  /** 每个 server 来自哪个文件（project 覆盖 user，与 getMCPServers 合并同口径）；UI 编辑时默认写回原层用。 */
  async getMCPServerSources(): Promise<Record<string, 'user' | 'project'>> {
    const out: Record<string, 'user' | 'project'> = {}
    for (const level of ['user', 'project'] as const) {
      const snap = await this.mcpWriter.readLayer(level)
      for (const name of Object.keys((snap.raw.mcpServers as MCPServers) ?? {})) out[name] = level
    }
    return out
  }

  /**
   * 单 server upsert，走 mcpWriter read-modify-write（保留该文件其他 server 与未知顶层 key）。
   * 权威写：从「非目标」文件里删掉同名，避免同名跨文件残留导致重复/被覆盖看不见。
   */
  async saveMCPServer(name: string, config: MCPServerConfig, location: 'user' | 'project' = 'user'): Promise<void> {
    const snap = await this.mcpWriter.readLayer(location)
    const servers = { ...((snap.raw.mcpServers as MCPServers) ?? {}) }
    servers[name] = config
    await this.mcpWriter.writeKey(location, 'mcpServers', servers)

    const other = location === 'user' ? 'project' : 'user'
    const osnap = await this.mcpWriter.readLayer(other)
    const oservers = (osnap.raw.mcpServers as MCPServers) ?? {}
    if (name in oservers) {
      const next = { ...oservers }
      delete next[name]
      await this.mcpWriter.writeKey(other, 'mcpServers', next)
    }
  }

  /** 单 server 删除：从 user/project 两个文件里有该 name 的那个删掉（其余文件/key 不动）。 */
  async deleteMCPServer(name: string): Promise<void> {
    for (const level of ['user', 'project'] as const) {
      const snap = await this.mcpWriter.readLayer(level)
      const servers = (snap.raw.mcpServers as MCPServers) ?? {}
      if (name in servers) {
        const next = { ...servers }
        delete next[name]
        await this.mcpWriter.writeKey(level, 'mcpServers', next)
      }
    }
  }
}
