import fs from 'fs/promises'
import path from 'path'
import type { Agent, AgentSource } from '../../shared/types'
import { FileManagerSkills } from './file-manager-skills'

interface AgentScanOpts {
  source: AgentSource
  marketplace?: string
  pluginName?: string
  version?: string
  pluginScope?: 'user' | 'project'
}

export class FileManagerAgents extends FileManagerSkills {
  /** 扫一个 agents 目录下的 *.md，解析后用 opts 装饰推入 out。目录不存在静默跳过（scanDirectory 返回 []）。 */
  private async scanAgentDir(dir: string, opts: AgentScanOpts, out: Agent[]): Promise<void> {
    const files = await this.scanDirectory(dir, '.md')
    for (const fp of files) {
      let content: string
      try {
        content = await fs.readFile(fp, 'utf-8')
      } catch {
        continue
      }
      const agent = this.parseAgentMarkdown(fp, content, opts)
      if (agent) out.push(agent)
    }
  }

  /** 解析 subagent .md：frontmatter（name/description/tools/model）+ 正文 system prompt。 */
  private parseAgentMarkdown(filePath: string, content: string, opts: AgentScanOpts): Agent | null {
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/) // 容忍 CRLF（Windows 编辑的 .md）
    const fm: Record<string, string> = {}
    if (fmMatch) {
      for (const line of fmMatch[1].split(/\r?\n/)) {
        const ci = line.indexOf(':')
        if (ci > 0) fm[line.slice(0, ci).trim()] = line.slice(ci + 1).trim()
      }
    }
    const systemPrompt = (fmMatch ? content.slice(fmMatch[0].length) : content).trim()

    // tools: CSV（Read, Grep）或内联数组（[Read, Grep]）；多行 - item 形式当前不解析
    let tools: string[] | undefined
    if (fm.tools) {
      let t = fm.tools.trim()
      if (t.startsWith('[') && t.endsWith(']')) t = t.slice(1, -1)
      const parsed = t.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      if (parsed.length) tools = parsed
    }

    return {
      name: fm.name || path.basename(filePath, '.md'),
      type: 'subagent',
      description: fm.description || '',
      enabled: true,
      systemPrompt,
      tools,
      model: fm.model || undefined,
      filePath,
      source: opts.source,
      location: opts.source === 'project' ? 'project' : 'user', // 兼容旧字段
      marketplace: opts.marketplace,
      pluginName: opts.pluginName,
      version: opts.version,
      pluginScope: opts.pluginScope,
    }
  }

  async getAgents(): Promise<Agent[]> {
    const out: Agent[] = []

    // user / project：扫 *.md（不再扫 .json）
    await this.scanAgentDir(path.join(this.userConfigPath, 'agents'), { source: 'user' }, out)
    await this.scanAgentDir(path.join(this.projectPath, '.claude', 'agents'), { source: 'project' }, out)

    // plugin：installed_plugins.json 为准只扫激活版本，按 enabledPlugins 跳过显式禁用的（复用 spec004）
    for (const { dir, opts } of await this.iterEnabledPluginDirs('agents')) {
      await this.scanAgentDir(dir, opts, out)
    }

    // 同名覆盖检测：winner 正常、其余标 overriddenBy（user>project>plugin）
    this.markOverrides(out, (a) => this.computeSourceUid(a))
    return out
  }

  async getAgent(name: string): Promise<Agent | null> {
    const agents = await this.getAgents()
    // 优先返回未被覆盖的 winner
    return agents.find((a) => a.name === name && !a.overriddenBy) || agents.find((a) => a.name === name) || null
  }

  /** 写回 subagent .md（frontmatter + system prompt）；plugin 来源只读。 */
  async saveAgent(agent: Agent): Promise<void> {
    if (agent.source === 'plugin') {
      throw new Error('Plugin agents are read-only and cannot be edited')
    }
    const location = agent.source === 'project' || agent.location === 'project' ? 'project' : 'user'
    const dir = location === 'project'
      ? path.join(this.projectPath, '.claude', 'agents')
      : path.join(this.userConfigPath, 'agents')
    // 仅当原文件名与当前 name 一致时复用 filePath；改名则写到 <name>.md，避免把新 name 写进旧文件名
    const filePath = agent.filePath && path.basename(agent.filePath) === `${agent.name}.md`
      ? agent.filePath
      : path.join(dir, `${agent.name}.md`)

    // 折叠换行，避免破坏单行 frontmatter（描述含换行会拆成非法 YAML）
    const oneLine = (s: string) => s.replace(/\r?\n/g, ' ').trim()
    const fmLines = ['---', `name: ${oneLine(agent.name)}`, `description: ${oneLine(agent.description || '')}`]
    if (agent.tools?.length) fmLines.push(`tools: ${agent.tools.join(', ')}`)
    if (agent.model) fmLines.push(`model: ${oneLine(agent.model)}`)
    fmLines.push('---')
    const content = `${fmLines.join('\n')}\n\n${(agent.systemPrompt || '').trim()}\n`

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, 'utf-8')
  }

  async deleteAgent(name: string): Promise<void> {
    const agent = await this.getAgent(name)
    if (!agent?.filePath) return
    if (agent.source === 'plugin') {
      throw new Error('Plugin agents are read-only and cannot be deleted')
    }
    await fs.unlink(agent.filePath)
  }
}
