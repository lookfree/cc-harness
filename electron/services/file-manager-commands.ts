import fs from 'fs/promises'
import path from 'path'
import type { SlashCommand, CommandSource } from '../../shared/types'
import { isMissing } from './glob-scan'
import { FileManagerMcp } from './file-manager-mcp'

export class FileManagerCommands extends FileManagerMcp {
  // Commands
  /** command 稳定唯一标识：plugin 含 marketplace/plugin/version，否则 source:name（与 computeSkillUid 同构）。 */
  private computeCommandUid(c: SlashCommand): string {
    return c.source === 'plugin'
      ? `plugin:${c.marketplace}/${c.pluginName}@${c.version}/${c.name}`
      : `${c.source ?? 'user'}:${c.name}`
  }

  /**
   * 递归扫一个 commands 根目录下的 *.md，命令名 = 相对 dir 的路径去 .md、子目录用 ':' 连（Claude Code 命名空间约定）。
   * 兼容本工具历史写法 commands/<name>/<name>.md：尾段与父目录同名时折叠，避免出现 name:name。
   * dir 不存在静默跳过，符号链接跳过。
   */
  private async scanCommandDir(
    dir: string,
    opts: { source: CommandSource; marketplace?: string; pluginName?: string; version?: string; pluginScope?: 'user' | 'project' },
    out: SlashCommand[]
  ): Promise<void> {
    const walk = async (cur: string, prefix: string[]): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(cur, { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) return // 目录不存在静默
        throw error
      }
      for (const ent of entries) {
        if (ent.isSymbolicLink()) continue
        const full = path.join(cur, ent.name)
        if (ent.isDirectory()) {
          await walk(full, [...prefix, ent.name])
        } else if (ent.isFile() && ent.name.endsWith('.md')) {
          const stem = ent.name.slice(0, -3)
          const segs = [...prefix, stem]
          // 仅 user/project：把本工具旧写法 commands/<name>/<name>.md 折叠成 <name>；
          // plugin 用标准平铺/命名空间布局，release/release.md 应保持 release:release，不折叠。
          if (opts.source !== 'plugin' && segs.length >= 2 && segs[segs.length - 1] === segs[segs.length - 2]) segs.pop()
          const commandName = segs.join(':')
          try {
            const content = await fs.readFile(full, 'utf-8')
            const command = this.parseCommandMarkdown(full, content, { ...opts, commandName })
            if (command) out.push(command)
          } catch (error) {
            this.logger.error(`Error reading command file ${full}:`, error)
          }
        }
      }
    }
    await walk(dir, [])
  }

  async getCommands(): Promise<SlashCommand[]> {
    this.logger.info('getCommands() called')
    const out: SlashCommand[] = []

    await this.scanCommandDir(path.join(this.userConfigPath, 'commands'), { source: 'user' }, out)
    await this.scanCommandDir(path.join(this.projectPath, '.claude', 'commands'), { source: 'project' }, out)

    // plugin：installed_plugins.json 为准只扫激活版本，按 enabledPlugins 跳过显式禁用的
    const enabled = await this.readEnabledPlugins()
    for (const pl of await this.readInstalledPlugins()) {
      if (enabled[`${pl.pluginName}@${pl.marketplace}`] === false) continue
      await this.scanCommandDir(path.join(pl.installPath, 'commands'), {
        source: 'plugin',
        marketplace: pl.marketplace,
        pluginName: pl.pluginName,
        version: pl.version,
        pluginScope: pl.scope,
      }, out)
    }

    // 同名覆盖检测：winner 正常、其余标 overriddenBy
    this.markOverrides(out, (c) => this.computeCommandUid(c))
    this.logger.info('getCommands() returning', out.length, 'commands')
    return out
  }

  private parseCommandMarkdown(
    filePath: string,
    content: string,
    opts: { source: CommandSource; marketplace?: string; pluginName?: string; version?: string; pluginScope?: 'user' | 'project'; commandName: string }
  ): SlashCommand | null {
    try {
      // Extract frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      const frontmatter: Record<string, string> = {}

      if (frontmatterMatch) {
        const frontmatterContent = frontmatterMatch[1]
        frontmatterContent.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split(':')
          if (key && valueParts.length > 0) {
            frontmatter[key.trim()] = valueParts.join(':').trim()
          }
        })
      }

      const commandName = opts.commandName
      const description = frontmatter.description || 'No description'

      // Extract instructions (everything after frontmatter)
      // Also strip any additional frontmatter blocks that might exist
      let instructions = content
      const instructionsMatch = content.match(/^---[\s\S]*?---\n([\s\S]*)$/)
      if (instructionsMatch) {
        instructions = instructionsMatch[1].trim()
        // Check for and remove any additional frontmatter blocks
        const additionalFrontmatterMatch = instructions.match(/^---\s*\n[\s\S]*?\n---\s*\n?/)
        if (additionalFrontmatterMatch) {
          instructions = instructions.slice(additionalFrontmatterMatch[0].length).trim()
          this.logger.warn('Stripped additional frontmatter from instructions in:', filePath)
        }
      }

      return {
        name: commandName,
        description,
        usage: `/${commandName}`,
        type: 'plugin',
        pattern: `^/${commandName}`,
        handler: {
          type: 'inline',
          code: instructions
        },
        instructions,
        rawContent: content,
        scope: opts.source === 'project' ? 'project' : 'global',
        enabled: true,
        filePath,
        location: opts.source === 'project' ? 'project' : 'user', // 兼容旧字段（plugin/user→'user'）
        source: opts.source,
        marketplace: opts.marketplace,
        pluginName: opts.pluginName,
        version: opts.version,
        pluginScope: opts.pluginScope,
        invokeName: opts.source === 'plugin' ? `${opts.pluginName}:${commandName}` : commandName,
      }
    } catch (error) {
      this.logger.error('Error parsing command markdown:', error)
      return null
    }
  }

  async getCommand(name: string): Promise<SlashCommand | null> {
    const commands = await this.getCommands()
    // 优先返回未被覆盖的 winner（同名多来源时），无则任意一条
    return commands.find((c) => c.name === name && !c.overriddenBy) || commands.find((c) => c.name === name) || null
  }

  /** filePath 是否落在某个已装 plugin 的 installPath 内（plugin 命令只读护栏，禁止写/删 plugin 自带文件）。 */
  private async isPluginPath(filePath: string): Promise<boolean> {
    if (!filePath) return false
    const resolved = path.resolve(filePath)
    for (const pl of await this.readInstalledPlugins()) {
      if (resolved.startsWith(path.resolve(pl.installPath) + path.sep)) return true
    }
    return false
  }

  async saveCommand(command: SlashCommand): Promise<void> {
    // Validate command format
    const validationErrors: string[] = []

    // Validate name
    if (!command.name || !command.name.trim()) {
      validationErrors.push('Command name is required')
    } else {
      const name = command.name.trim()
      if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        validationErrors.push('Command name can only contain lowercase letters, numbers, and hyphens, and must start with a letter')
      }
      if (name.length > 50) {
        validationErrors.push('Command name cannot exceed 50 characters')
      }
    }

    // Validate description
    if (!command.description || !command.description.trim()) {
      validationErrors.push('Description is required')
    } else if (command.description.length > 200) {
      validationErrors.push('Description cannot exceed 200 characters')
    }

    // Validate instructions
    if (!command.instructions || !command.instructions.trim()) {
      validationErrors.push('Instructions content is required')
    }

    // If there are validation errors, throw an error
    if (validationErrors.length > 0) {
      const error = new Error('Command validation failed: ' + validationErrors.join('; '))
      this.logger.error('Command validation failed:', validationErrors)
      throw error
    }

    const location = command.location || 'project'

    // 确定基础目录
    // 如果是 project 并且提供了 filePath（包含项目路径），则使用它
    // 否则使用默认的 projectPath 或 userConfigPath
    let baseDir: string
    if (location === 'project') {
      if (command.filePath) {
        // filePath 可能是完整路径或只是项目根目录
        // 如果是项目根目录，需要添加 .claude/commands
        if (command.filePath.includes('/.claude/commands/')) {
          // 从完整路径提取项目根目录
          const match = command.filePath.match(/^(.+)\/\.claude\/commands\//)
          baseDir = match ? path.join(match[1], '.claude', 'commands') : path.join(this.projectPath, '.claude', 'commands')
        } else {
          // filePath 是项目根目录
          baseDir = path.join(command.filePath, '.claude', 'commands')
        }
      } else {
        baseDir = path.join(this.projectPath, '.claude', 'commands')
      }
    } else {
      baseDir = path.join(this.userConfigPath, 'commands')
    }

    // Command files are stored as: commands/<name>/<name>.md
    const commandDir = path.join(baseDir, command.name)
    const filePath = path.join(commandDir, `${command.name}.md`)

    // Ensure directory exists
    await fs.mkdir(commandDir, { recursive: true })

    // Build markdown content with frontmatter
    const frontmatter = [
      '---',
      `description: ${command.description || 'No description'}`,
    ]

    // Add allowed-tools if specified in handler
    if (command.handler?.allowedTools) {
      frontmatter.push(`allowed-tools: ${command.handler.allowedTools}`)
    }

    frontmatter.push('---')

    // Strip existing frontmatter from instructions if present
    let instructions = command.instructions || ''
    const frontmatterMatch = instructions.match(/^---\s*\n[\s\S]*?\n---\s*\n?/)
    if (frontmatterMatch) {
      instructions = instructions.slice(frontmatterMatch[0].length).trim()
      this.logger.info('Stripped existing frontmatter from instructions')
    }

    const content = frontmatter.join('\n') + '\n\n' + instructions

    await fs.writeFile(filePath, content, 'utf-8')
    this.logger.info('Saved command to:', filePath)
  }

  async saveCommandRaw(_name: string, content: string, filePath: string): Promise<void> {
    if (!filePath) {
      throw new Error('File path is required for saving raw command content')
    }
    if (await this.isPluginPath(filePath)) {
      throw new Error('Plugin commands are read-only and cannot be edited')
    }

    // 确保目录存在
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    this.logger.info('Saving raw command content to:', filePath)
    await fs.writeFile(filePath, content, 'utf-8')
    this.logger.info('Saved raw command to:', filePath)
  }

  async deleteCommand(name: string, filePath?: string): Promise<void> {
    // 优先用调用方传入的精确 filePath（同名命令可来自多来源，仅按 name 解析会删错文件）；缺省回退按 name 查 winner。
    const targetPath = filePath || (await this.getCommand(name))?.filePath
    if (targetPath) {
      if (await this.isPluginPath(targetPath)) {
        throw new Error('Plugin commands are read-only and cannot be deleted')
      }
      // 删除命令文件
      await fs.unlink(targetPath)

      // 同时删除命令目录（如果目录为空）
      const commandDir = path.dirname(targetPath)
      try {
        const files = await fs.readdir(commandDir)
        if (files.length === 0) {
          await fs.rmdir(commandDir)
          this.logger.info('Deleted empty command directory:', commandDir)
        }
      } catch (error) {
        // 目录可能不存在或无法删除，忽略错误
        this.logger.warn('Could not remove command directory:', error)
      }

      this.logger.info('Deleted command:', name)
    }
  }
}
