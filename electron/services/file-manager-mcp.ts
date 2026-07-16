import path from 'path'
import os from 'os'
import type { MCPServers, MCPServerConfig } from '../../shared/types'
import { FileManagerHooks } from './file-manager-hooks'

/** 一个 MCP 配置来源文件：路径 + 归属层 + 本工具是否可写（~/.claude.json 由 CLI 管理，只读）。 */
interface McpSourceFile {
  path: string
  level: 'user' | 'project'
  writable: boolean
}

/** getMCPServers / getMCPServerSources / 可写性 三者同源，避免各自 hand-roll 文件集导致口径漂移。 */
interface McpOverview {
  servers: MCPServers
  sources: Record<string, 'user' | 'project'>
  /** 出现在 ~/.claude.json 的 server——本工具不写该文件，save/delete 对它们要报错而非静默无效 */
  cliManaged: Set<string>
}

export class FileManagerMcp extends FileManagerHooks {
  /**
   * MCP 配置文件路径（写入目标）：
   * - project → <project>/.mcp.json（Claude Code 标准项目级文件）
   * - user → ~/.claude/claude_mcp_config.json（本工具的 user 层落盘）
   */
  private mcpPath(location: 'user' | 'project'): string {
    return location === 'project'
      ? path.join(this.projectPath, '.mcp.json')
      : path.join(this.userConfigPath, 'claude_mcp_config.json')
  }

  /** ~/.claude.json：Claude Code 自己的用户级 MCP 存储（`claude mcp add -s user` 写这里），只读合并。 */
  private claudeJsonPath(): string {
    return path.join(os.homedir(), '.claude.json')
  }

  /**
   * 有序来源列表（低→高优先级，后者覆盖前者）。同一 name 的归属 = 最高优先级来源。
   * project 层整体压过 user 层（还原"project 覆盖 user"不变量）；标准文件压过 legacy 文件。
   */
  private mcpSourceFiles(): McpSourceFile[] {
    return [
      { path: path.join(this.userConfigPath, 'mcpServers.json'), level: 'user', writable: true }, // legacy user
      { path: this.claudeJsonPath(), level: 'user', writable: false }, // CLI 用户级，只读
      { path: this.mcpPath('user'), level: 'user', writable: true }, // claude_mcp_config.json
      { path: path.join(this.projectPath, '.claude', 'mcpServers.json'), level: 'project', writable: true }, // legacy project
      { path: this.mcpPath('project'), level: 'project', writable: true }, // .mcp.json
    ]
  }

  /** 无 command 但有 url 且没声明 type → 规范化为 http（便于 UI 按 isRemoteMCP 分组）。 */
  private normalizeMCP(c: MCPServerConfig): MCPServerConfig {
    return !c.command && c.url && !c.type ? { ...c, type: 'http' } : c
  }

  /** 读单个 MCP 文件的 mcpServers（复用继承的 settingsWriter 路径原语，ENOENT/坏 JSON 退化为空）。 */
  private async readMCPFile(filePath: string): Promise<MCPServers> {
    const snap = await this.settingsWriter.readAtPath(filePath, 'user')
    return (snap.raw.mcpServers as MCPServers) ?? {}
  }

  /** 一次读齐所有来源文件（并行），单遍算出 servers / sources / cliManaged。 */
  private async loadMCPMerged(): Promise<McpOverview> {
    const descs = this.mcpSourceFiles()
    const perFile = await Promise.all(descs.map((d) => this.readMCPFile(d.path)))
    const servers: MCPServers = {}
    const sources: Record<string, 'user' | 'project'> = {}
    const cliManaged = new Set<string>()
    descs.forEach((d, i) => {
      for (const [name, cfg] of Object.entries(perFile[i])) {
        servers[name] = this.normalizeMCP(cfg) // 后者覆盖前者
        sources[name] = d.level
        if (!d.writable) cliManaged.add(name)
      }
    })
    return { servers, sources, cliManaged }
  }

  async getMCPServers(): Promise<MCPServers> {
    this.logger.info('getMCPServers() called')
    const { servers } = await this.loadMCPMerged()
    this.logger.info('Found', Object.keys(servers).length, 'MCP servers')
    return servers
  }

  /** 每个 server 来自哪个层（与 getMCPServers 严格同源，含 legacy 路径——否则供应链门控会漏）。 */
  async getMCPServerSources(): Promise<Record<string, 'user' | 'project'>> {
    return (await this.loadMCPMerged()).sources
  }

  /** 供 IPC（mcp:health）一次取齐，避免 getMCPServers + getMCPServerSources 双读大文件。 */
  async getMCPOverview(): Promise<McpOverview> {
    return this.loadMCPMerged()
  }

  /**
   * 单 server upsert：写目标层文件（保留其他 server 与未知顶层 key，原子写），
   * 并从「非目标」标准文件与 legacy 文件删同名，避免跨文件残留覆盖不可见。
   * ~/.claude.json 由 CLI 管理，本工具不写——命中则报错，绝不静默把配置分叉进 claude_mcp_config.json。
   */
  async saveMCPServer(name: string, config: MCPServerConfig, location: 'user' | 'project' = 'user'): Promise<void> {
    const { cliManaged } = await this.loadMCPMerged()
    if (cliManaged.has(name)) {
      throw new Error(`MCP server "${name}" 由 Claude Code CLI 管理（~/.claude.json），本工具不写该文件；请用 \`claude mcp\` 命令修改，避免配置分叉`)
    }
    const servers = { ...(await this.readMCPFile(this.mcpPath(location))), [name]: config }
    await this.settingsWriter.writeKeyAtPath(this.mcpPath(location), 'mcpServers', servers)

    const otherStandard = this.mcpPath(location === 'user' ? 'project' : 'user')
    await this.removeFromFile(otherStandard, name)
    for (const p of this.legacyMcpPaths()) await this.removeFromFile(p, name)
  }

  /** 本工具历史写过的旧路径，只读迁移用（保存/删除时清残留）。 */
  private legacyMcpPaths(): string[] {
    return [
      path.join(this.userConfigPath, 'mcpServers.json'),
      path.join(this.projectPath, '.claude', 'mcpServers.json'),
    ]
  }

  /** 从指定 MCP 文件的 mcpServers 里删掉某个 name（文件不存在/无该名则不动）。 */
  private async removeFromFile(filePath: string, name: string): Promise<void> {
    const servers = await this.readMCPFile(filePath)
    if (!(name in servers)) return
    const next = { ...servers }
    delete next[name]
    await this.settingsWriter.writeKeyAtPath(filePath, 'mcpServers', next)
  }

  /**
   * 单 server 删除：从标准 user/project 文件与 legacy 路径里都删掉。
   * ~/.claude.json 命中则报错——否则删除会静默无效（该 server 下次合并又回来）。
   */
  async deleteMCPServer(name: string): Promise<void> {
    const { cliManaged } = await this.loadMCPMerged()
    if (cliManaged.has(name)) {
      throw new Error(`MCP server "${name}" 由 Claude Code CLI 管理（~/.claude.json），无法从本工具删除；请用 \`claude mcp remove ${name}\``)
    }
    await this.removeFromFile(this.mcpPath('user'), name)
    await this.removeFromFile(this.mcpPath('project'), name)
    for (const p of this.legacyMcpPaths()) await this.removeFromFile(p, name)
  }
}
