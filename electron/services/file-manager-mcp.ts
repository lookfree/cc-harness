import path from 'path'
import type { MCPServers, MCPServerConfig } from '../../shared/types'
import { FileManagerHooks } from './file-manager-hooks'

export class FileManagerMcp extends FileManagerHooks {
  /**
   * MCP 配置文件路径（写入目标）：
   * - project → <project>/.mcp.json（Claude Code 标准项目级文件；旧的 .claude/mcpServers.json 只读迁移）
   * - user → ~/.claude/claude_mcp_config.json（本工具的 user 层落盘；~/.claude.json 只读合并，见下）
   */
  private mcpPath(location: 'user' | 'project'): string {
    return location === 'project'
      ? path.join(this.projectPath, '.mcp.json')
      : path.join(this.userConfigPath, 'claude_mcp_config.json')
  }

  /** 本工具历史写过的旧路径，只读迁移用。 */
  private legacyMcpPaths(): string[] {
    return [
      path.join(this.userConfigPath, 'mcpServers.json'),
      path.join(this.projectPath, '.claude', 'mcpServers.json'),
    ]
  }

  /** 无 command 但有 url 且没声明 type → 规范化为 http（便于 UI 按 isRemoteMCP 分组）。 */
  private normalizeMCP(c: MCPServerConfig): MCPServerConfig {
    return !c.command && c.url && !c.type ? { ...c, type: 'http' } : c
  }

  /**
   * ~/.claude.json 是 Claude Code 自己的用户级 MCP 存储（`claude mcp add -s user` 写这里）。
   * 只读合并进来保证"看得见"；不写它——该文件由运行中的 CLI 频繁重写，外部写入有丢数据风险。
   */
  private async readClaudeJsonUserMCP(): Promise<MCPServers> {
    const claudeJson = await this.readJSONFile<{ mcpServers?: MCPServers }>(
      path.join(this.userConfigPath, '..', '.claude.json')
    )
    return claudeJson?.mcpServers ?? {}
  }

  async getMCPServers(): Promise<MCPServers> {
    this.logger.info('getMCPServers() called')
    // 合并次序（后者覆盖前者）：本工具 legacy → CLI 用户级(~/.claude.json) → 本工具 user 层 → 项目标准 .mcp.json
    const [legacyUser, legacyProject] = await Promise.all(
      this.legacyMcpPaths().map((p) => this.readJSONFile<{ mcpServers?: MCPServers }>(p))
    )
    const cliUserMCP = await this.readClaudeJsonUserMCP()
    const userMCP = await this.readJSONFile<{ mcpServers?: MCPServers }>(this.mcpPath('user'))
    const projectMCP = await this.readJSONFile<{ mcpServers?: MCPServers }>(this.mcpPath('project'))
    const merged: MCPServers = {
      ...(legacyUser?.mcpServers || {}),
      ...(legacyProject?.mcpServers || {}),
      ...cliUserMCP,
      ...(userMCP?.mcpServers || {}),
      ...(projectMCP?.mcpServers || {}),
    }
    const out = Object.fromEntries(Object.entries(merged).map(([name, cfg]) => [name, this.normalizeMCP(cfg)]))
    this.logger.info('Found', Object.keys(out).length, 'MCP servers')
    return out
  }

  /** 读某层 MCP 文件的 mcpServers（复用继承的 settingsWriter 路径原语，与 hooks 同款，不另起 writer 实例）。 */
  private async readMCPLayer(location: 'user' | 'project'): Promise<MCPServers> {
    const snap = await this.settingsWriter.readAtPath(this.mcpPath(location), location)
    return (snap.raw.mcpServers as MCPServers) ?? {}
  }

  /** 每个 server 来自哪个文件（project 覆盖 user，与 getMCPServers 合并同口径）；UI 编辑时默认写回原层用。 */
  async getMCPServerSources(): Promise<Record<string, 'user' | 'project'>> {
    const out: Record<string, 'user' | 'project'> = {}
    for (const name of Object.keys(await this.readClaudeJsonUserMCP())) out[name] = 'user'
    for (const level of ['user', 'project'] as const) {
      for (const name of Object.keys(await this.readMCPLayer(level))) out[name] = level
    }
    return out
  }

  /**
   * 单 server upsert：read-modify-write 该文件 mcpServers（保留其他 server 与未知顶层 key，原子写）。
   * 权威写：从「非目标」文件里删掉同名，避免同名跨文件残留导致重复/被覆盖看不见。
   */
  async saveMCPServer(name: string, config: MCPServerConfig, location: 'user' | 'project' = 'user'): Promise<void> {
    const servers = { ...(await this.readMCPLayer(location)), [name]: config }
    await this.settingsWriter.writeKeyAtPath(this.mcpPath(location), 'mcpServers', servers)

    const other = location === 'user' ? 'project' : 'user'
    await this.removeFromFile(this.mcpPath(other), name)
    // 旧路径里的同名条目一并清掉，避免合并读取时残留覆盖不可见（~/.claude.json 不动，见 readClaudeJsonUserMCP）
    for (const p of this.legacyMcpPaths()) await this.removeFromFile(p, name)
  }

  /** 从指定 MCP 文件的 mcpServers 里删掉某个 name（文件不存在/无该名则不动）。 */
  private async removeFromFile(filePath: string, name: string): Promise<void> {
    const snap = await this.settingsWriter.readAtPath(filePath, 'user')
    const servers = (snap.raw.mcpServers as MCPServers) ?? {}
    if (!(name in servers)) return
    const next = { ...servers }
    delete next[name]
    await this.settingsWriter.writeKeyAtPath(filePath, 'mcpServers', next)
  }

  /** 单 server 删除：从标准 user/project 文件与旧路径里有该 name 的都删掉（~/.claude.json 只读不动）。 */
  async deleteMCPServer(name: string): Promise<void> {
    for (const level of ['user', 'project'] as const) {
      await this.removeFromFile(this.mcpPath(level), name)
    }
    for (const p of this.legacyMcpPaths()) await this.removeFromFile(p, name)
  }
}
