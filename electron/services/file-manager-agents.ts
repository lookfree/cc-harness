import fs from 'fs/promises'
import path from 'path'
import type { Agent } from '../../shared/types'
import { FileManagerSkills } from './file-manager-skills'

export class FileManagerAgents extends FileManagerSkills {
  // Agents
  async getAgents(): Promise<Agent[]> {
    const projectAgents = await this.scanDirectory(
      path.join(this.projectPath, '.claude', 'agents'),
      '.json'
    )
    const userAgents = await this.scanDirectory(
      path.join(this.userConfigPath, 'agents'),
      '.json'
    )

    const allAgentPaths = [
      ...projectAgents.map((p) => ({ path: p, location: 'project' as const })),
      ...userAgents.map((p) => ({ path: p, location: 'user' as const })),
    ]

    const agents: Agent[] = []
    for (const { path: agentPath, location } of allAgentPaths) {
      const agent = await this.readJSONFile<Agent>(agentPath)
      if (agent) {
        agents.push({ ...agent, filePath: agentPath, location })
      }
    }

    return agents
  }

  async getAgent(name: string): Promise<Agent | null> {
    const agents = await this.getAgents()
    return agents.find((a) => a.name === name) || null
  }

  async saveAgent(agent: Agent): Promise<void> {
    const location = agent.location || 'project'
    const dir = location === 'project'
      ? path.join(this.projectPath, '.claude', 'agents')
      : path.join(this.userConfigPath, 'agents')

    const filePath = path.join(dir, `${agent.name}.json`)
    await this.writeJSONFile(filePath, agent)
  }

  async deleteAgent(name: string): Promise<void> {
    const agent = await this.getAgent(name)
    if (agent?.filePath) {
      await fs.unlink(agent.filePath)
    }
  }
}
