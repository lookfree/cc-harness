import type { IpcMain } from 'electron'
import type { FileManager } from '../services/file-manager'
import type { DependencyNode, DependencyEdge } from '../../shared/types'

export function registerDependencyHandlers(ipcMain: IpcMain, fileManager: FileManager) {
  ipcMain.handle('dependencies:getGraph', async () => {
    // TODO: Implement dependency graph generation
    const skills = await fileManager.getSkills()
    const agents = await fileManager.getAgents()
    const hooks = await fileManager.getHooks()
    const commands = await fileManager.getCommands()

    // 只取生效（未被同名覆盖）的 skill：getSkills 会返回同名多条（如多版本 plugin skill），
    // 用 id:s.name 建节点会撞重复 id；edges 也必须用同一份，否则被覆盖 skill 的依赖会产生源节点不存在的孤儿边。
    const activeSkills = skills.filter((s) => !s.overriddenBy)

    const nodes: DependencyNode[] = [
      ...activeSkills.map((s) => ({ id: s.name, type: 'skill' as const, name: s.name, data: s })),
      ...agents.map((a) => ({ id: a.name, type: 'agent' as const, name: a.name, data: a })),
      ...hooks.map((h) => ({ id: h.name, type: 'hook' as const, name: h.name, data: h })),
      ...commands.map((c) => ({ id: c.name, type: 'command' as const, name: c.name, data: c })),
    ]

    const edges: DependencyEdge[] = []

    // Add edges based on dependencies
    activeSkills.forEach((skill) => {
      skill.dependencies?.forEach((dep) => {
        edges.push({
          id: `${skill.name}-${dep}`,
          source: skill.name,
          target: dep,
          type: 'depends-on',
        })
      })
    })

    agents.forEach((agent) => {
      agent.dependencies?.forEach((dep) => {
        edges.push({
          id: `${agent.name}-${dep}`,
          source: agent.name,
          target: dep,
          type: 'depends-on',
        })
      })
    })

    return { nodes, edges }
  })
}
