import fs from 'fs/promises'
import path from 'path'
import type { Skill, SkillSource, SkillUid } from '../../shared/types'
import { globScan } from './glob-scan'
import { FileManagerPlugins } from './file-manager-plugins'

export class FileManagerSkills extends FileManagerPlugins {
  // Cache for parsed skills
  private skillCache = new Map<string, { skill: Skill; mtime: number }>()

  /** skill 稳定唯一标识：plugin 含 marketplace/plugin/version，否则 source:name。 */
  private computeSkillUid(s: Skill): SkillUid {
    return s.source === 'plugin'
      ? `plugin:${s.marketplace}/${s.pluginName}@${s.version}/${s.name}`
      : `${s.source ?? 'user'}:${s.name}`
  }

  /**
   * 扫一个 skill 根目录下的 <name>/SKILL.md，解析后用 opts 装饰（source + plugin 元信息）推入 out。
   * 统一 user/project/plugin 三层的扫描+解析+装饰，消除重复循环。dir 不存在静默跳过。
   */
  private async scanSkillDir(
    dir: string,
    opts: { source: SkillSource; marketplace?: string; pluginName?: string; version?: string; pluginScope?: 'user' | 'project' },
    out: Skill[]
  ): Promise<void> {
    const hits = await globScan(dir, '*/SKILL.md', { maxDepth: 3, maxResults: 2000 })
    const location = opts.source === 'project' ? 'project' : 'user' // 兼容旧 location 字段（plugin/user→'user'）
    for (const skillMdPath of hits) {
      const skill = await this.parseSkillMD(skillMdPath, location)
      if (skill) out.push({ ...skill, ...opts })
    }
  }

  // Skills
  async getSkills(): Promise<Skill[]> {
    const out: Skill[] = []

    // 1) user：~/.claude/skills/<name>/SKILL.md
    await this.scanSkillDir(path.join(this.userConfigPath, 'skills'), { source: 'user' }, out)

    // 2) project：<cwd>/.claude/skills/<name>/SKILL.md
    await this.scanSkillDir(path.join(this.projectPath, '.claude', 'skills'), { source: 'project' }, out)

    // 2b) project 旧 JSON 格式 skills（非 Claude Code 标准格式，但本项目历史支持，保留兼容）
    const projectJson = await this.scanDirectory(path.join(this.projectPath, '.claude', 'skills'), '.json')
    for (const p of projectJson) {
      const skill = await this.readJSONFile<Skill>(p)
      if (skill) out.push({ ...skill, filePath: p, location: 'project', source: 'project' })
    }

    // 3) plugin：installed_plugins.json 为准只扫激活版本，按 enabledPlugins 跳过显式禁用的
    const enabled = await this.readEnabledPlugins()
    for (const pl of await this.readInstalledPlugins()) {
      if (enabled[`${pl.pluginName}@${pl.marketplace}`] === false) continue
      await this.scanSkillDir(path.join(pl.installPath, 'skills'), {
        source: 'plugin',
        marketplace: pl.marketplace,
        pluginName: pl.pluginName,
        version: pl.version,
        pluginScope: pl.scope,
      }, out)
    }

    // 4) 同名覆盖检测：winner 正常、其余标 overriddenBy
    this.markOverrides(out, (s) => this.computeSkillUid(s))

    this.logger.info('getSkills() returning', out.length, 'skills')
    return out
  }

  private async parseSkillMD(filePath: string, location: 'user' | 'project'): Promise<Skill | null> {
    try {
      // Check cache first
      const stats = await fs.stat(filePath)
      const cached = this.skillCache.get(filePath)

      if (cached && cached.mtime === stats.mtime.getTime()) {
        this.logger.info(`Using cached skill: ${path.basename(filePath)}`)
        return cached.skill
      }

      const content = await fs.readFile(filePath, 'utf-8')

      // Parse YAML frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!frontmatterMatch) {
        this.logger.warn(`No frontmatter found, skipping: ${filePath}`)
        return null
      }

      const frontmatter = frontmatterMatch[1]
      const lines = frontmatter.split('\n')
      const metadata: Record<string, string> = {}

      for (const line of lines) {
        const colonIndex = line.indexOf(':')
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim()
          const value = line.slice(colonIndex + 1).trim()
          metadata[key] = value
        }
      }

      const name = metadata.name || path.basename(path.dirname(filePath))
      const description = metadata.description || ''

      // Extract instructions (everything after frontmatter)
      const instructions = content.slice(frontmatterMatch[0].length).trim()

      // Get skill directory
      const skillDir = path.dirname(filePath)

      // Scan for references directory
      const references: Array<{ type: 'file' | 'package' | 'api' | 'tool'; path: string; description?: string }> = []
      const referencesDir = path.join(skillDir, 'references')
      if (await this.fileExists(referencesDir)) {
        try {
          const refFiles = await fs.readdir(referencesDir)
          for (const file of refFiles) {
            references.push({
              type: 'file',
              path: `references/${file}`,
            })
          }
        } catch (error) {
          // Ignore errors reading references
        }
      }

      // Scan for scripts directory
      const scripts: Array<{ name: string; command: string; description?: string; content?: string }> = []
      const scriptsDir = path.join(skillDir, 'scripts')
      if (await this.fileExists(scriptsDir)) {
        try {
          const scriptFiles = await fs.readdir(scriptsDir)
          for (const file of scriptFiles) {
            const ext = path.extname(file)
            if (ext === '.py' || ext === '.sh' || ext === '.js' || ext === '.ts') {
              const scriptPath = path.join(scriptsDir, file)
              let content: string | undefined
              let description: string | undefined

              try {
                // Read script content
                const scriptContent = await fs.readFile(scriptPath, 'utf-8')
                content = scriptContent

                // Extract description from first comment block
                if (ext === '.py') {
                  // Match Python docstrings
                  const docMatch = scriptContent.match(/(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/)
                  if (docMatch) {
                    description = (docMatch[1] || docMatch[2]).trim().split('\n')[0]
                  }
                } else if (ext === '.sh') {
                  // Match shell script comments
                  const lines = scriptContent.split('\n')
                  for (const line of lines) {
                    if (line.startsWith('#') && !line.startsWith('#!')) {
                      description = line.slice(1).trim()
                      break
                    }
                  }
                }

                // Count lines
                const lineCount = scriptContent.split('\n').length
                description = description || `${lineCount} lines`
              } catch (err) {
                // Ignore errors reading individual files
              }

              const commandPrefix = ext === '.py' ? 'python' : ext === '.sh' ? 'bash' : 'node'
              scripts.push({
                name: file,
                command: `${commandPrefix} scripts/${file}`,
                description,
                content,
              })
            }
          }
        } catch (error) {
          // Ignore errors reading scripts
        }
      }

      // Extract triggers from content with more detail
      const triggers: {
        commands?: string[]
        contexts?: string[]
        keywords?: {
          actions?: Array<{ word: string; type: string }>
          formats?: Array<{ word: string; type: string }>
          topics?: Array<{ word: string; type: string }>
          technologies?: Array<{ word: string; type: string }>
        }
        examples?: string[]
      } = {}

      // Extract action keywords
      const actionWords = new Set<string>()
      const actionMatches = instructions.match(/\b(create|generate|convert|export|update|delete|add|remove|edit|modify|analyze|process|extract|validate|build|make|design|develop|implement|test|deploy|fix)\b/gi)
      if (actionMatches) {
        actionMatches.forEach(w => actionWords.add(w.toLowerCase()))
      }

      // Extract format keywords
      const formatWords = new Set<string>()
      const formatMatches = instructions.match(/\b(json|yaml|xml|csv|markdown|html|pdf|png|svg|jpg|jpeg|gif|webp|mp4|avi|zip|tar|gz)\b/gi)
      if (formatMatches) {
        formatMatches.forEach(w => formatWords.add(w.toLowerCase()))
      }

      // Extract topic keywords
      const topicWords = new Set<string>()
      const topicMatches = instructions.match(/\b(diagram|chart|graph|visualization|report|documentation|test|analysis|workflow|pipeline|architecture|design|model)\b/gi)
      if (topicMatches) {
        topicMatches.forEach(w => topicWords.add(w.toLowerCase()))
      }

      // Extract technology keywords
      const techWords = new Set<string>()
      const techMatches = instructions.match(/\b(plantuml|uml|python|javascript|typescript|react|node|docker|kubernetes|aws|gcp|azure|git|github)\b/gi)
      if (techMatches) {
        techMatches.forEach(w => techWords.add(w.toLowerCase()))
      }

      // Extract example queries from markdown code blocks or quoted text
      const examples: string[] = []
      const exampleMatches = instructions.match(/(?:"([^"]+)"|`([^`]+)`|Example:\s*(.+?)(?:\n|$))/gi)
      if (exampleMatches) {
        exampleMatches.slice(0, 5).forEach(match => {
          const cleaned = match.replace(/^["'`]|["'`]$/g, '').replace(/^Example:\s*/i, '').trim()
          if (cleaned.length > 10 && cleaned.length < 100) {
            examples.push(cleaned)
          }
        })
      }

      if (actionWords.size > 0 || formatWords.size > 0 || topicWords.size > 0 || techWords.size > 0) {
        triggers.keywords = {
          actions: actionWords.size > 0 ? Array.from(actionWords).map(w => ({ word: w, type: 'action' })) : undefined,
          formats: formatWords.size > 0 ? Array.from(formatWords).map(w => ({ word: w, type: 'format' })) : undefined,
          topics: topicWords.size > 0 ? Array.from(topicWords).map(w => ({ word: w, type: 'topic' })) : undefined,
          technologies: techWords.size > 0 ? Array.from(techWords).map(w => ({ word: w, type: 'technology' })) : undefined,
        }

        this.logger.info(`Extracted triggers for ${name}:`, {
          actions: actionWords.size,
          formats: formatWords.size,
          topics: topicWords.size,
          technologies: techWords.size,
          examples: examples.length
        })
      }

      if (examples.length > 0) {
        triggers.examples = examples
      }

      // Also keep simple commands list for backward compatibility
      if (actionWords.size > 0) {
        triggers.commands = Array.from(actionWords)
      }

      const skill: Skill = {
        name,
        type: 'skill',
        description,
        enabled: true,
        implementation: {
          type: 'inline',
          instructions,
        },
        filePath,
        location,
        references: references.length > 0 ? references : undefined,
        scripts: scripts.length > 0 ? scripts : undefined,
        triggers: Object.keys(triggers).length > 0 ? triggers : undefined,
        content, // Add full markdown content for frontend analysis
      }

      // Cache the parsed skill
      this.skillCache.set(filePath, {
        skill,
        mtime: stats.mtime.getTime()
      })

      return skill
    } catch (error) {
      this.logger.error(`Error parsing SKILL.md at ${filePath}:`, error)
      return null
    }
  }

  async getSkill(name: string): Promise<Skill | null> {
    const skills = await this.getSkills()
    // 同名多条时确定性地返回 winner（未被覆盖的生效那条），而非任意首个，
    // 避免 save/delete 命中被覆盖的旧版本（code-review #3）。
    return (
      skills.find((s) => s.name === name && !s.overriddenBy) ??
      skills.find((s) => s.name === name) ??
      null
    )
  }

  async saveSkill(skill: Skill): Promise<void> {
    // 插件 skill 只读：由插件系统管理，不能通过本工具保存（否则会错写一个同名 user skill）。
    if (skill.source === 'plugin') {
      throw new Error(`插件 skill「${skill.name}」由插件管理，是只读的，不能保存`)
    }
    const location = skill.location || 'project'
    const dir = location === 'project'
      ? path.join(this.projectPath, '.claude', 'skills')
      : path.join(this.userConfigPath, 'skills')

    const filePath = path.join(dir, `${skill.name}.json`)
    await this.writeJSONFile(filePath, skill)
  }

  async deleteSkill(name: string): Promise<void> {
    const skill = await this.getSkill(name)
    if (!skill) return
    // 插件 skill 只读护栏（关键）：其 filePath 指向插件安装目录里的真实 SKILL.md，
    // 且 getSkill 按 name 解析可能命中插件那条 —— 误删会直接损坏已装插件。一律拦截。
    if (skill.source === 'plugin') {
      throw new Error(`插件 skill「${name}」由插件管理，是只读的，不能删除`)
    }
    if (skill.filePath) {
      await fs.unlink(skill.filePath)
    }
  }
}
