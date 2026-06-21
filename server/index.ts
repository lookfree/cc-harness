import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import path from 'path'
import { FileManager } from '../electron/services/file-manager'
import { validateHook } from '../electron/services/hook-validation'
import type { Skill, Agent, Hook, MCPServerConfig, SlashCommand, Provider } from '../shared/types'

const app = express()
const PORT = process.env.API_PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Initialize FileManager
const fileManager = FileManager.getInstance()
fileManager.initialize()

// Error handling wrapper
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }

// ============ Skills API ============
app.get('/api/skills', asyncHandler(async (_req, res) => {
  console.log('[API] GET /api/skills')
  const skills = await fileManager.getSkills()
  res.json(skills)
}))

// Plugins / Marketplaces — Web 只读镜像（enable/disable/init/details 仅桌面端）
app.get('/api/plugins', asyncHandler(async (_req, res) => {
  res.json(await fileManager.getPlugins())
}))

app.get('/api/plugins/marketplaces', asyncHandler(async (_req, res) => {
  res.json(await fileManager.getMarketplaces())
}))

app.get('/api/skills/:name', asyncHandler(async (req, res) => {
  const skill = await fileManager.getSkill(req.params.name)
  if (skill) {
    res.json(skill)
  } else {
    res.status(404).json({ error: 'Skill not found' })
  }
}))

app.post('/api/skills', asyncHandler(async (req, res) => {
  const skill = req.body as Skill
  await fileManager.saveSkill(skill)
  res.json({ success: true })
}))

app.delete('/api/skills/:name', asyncHandler(async (req, res) => {
  await fileManager.deleteSkill(req.params.name)
  res.json({ success: true })
}))

// ============ Agents API ============
app.get('/api/agents', asyncHandler(async (_req, res) => {
  const agents = await fileManager.getAgents()
  res.json(agents)
}))

app.get('/api/agents/:name', asyncHandler(async (req, res) => {
  const agent = await fileManager.getAgent(req.params.name)
  if (agent) {
    res.json(agent)
  } else {
    res.status(404).json({ error: 'Agent not found' })
  }
}))

app.post('/api/agents', asyncHandler(async (req, res) => {
  const agent = req.body as Agent
  await fileManager.saveAgent(agent)
  res.json({ success: true })
}))

app.delete('/api/agents/:name', asyncHandler(async (req, res) => {
  await fileManager.deleteAgent(req.params.name)
  res.json({ success: true })
}))

// ============ Hooks API ============
app.get('/api/hooks', asyncHandler(async (_req, res) => {
  console.log('[API] GET /api/hooks')
  const hooks = await fileManager.getHooks()
  res.json(hooks)
}))

app.get('/api/hooks/:name', asyncHandler(async (req, res) => {
  const hook = await fileManager.getHook(req.params.name)
  if (hook) {
    res.json(hook)
  } else {
    res.status(404).json({ error: 'Hook not found' })
  }
}))

app.post('/api/hooks', asyncHandler(async (req, res) => {
  const hook = req.body as Hook
  await fileManager.saveHook(hook)
  res.json({ success: true })
}))

app.post('/api/hooks/raw', asyncHandler(async (req, res) => {
  const { name, content, filePath } = req.body
  await fileManager.saveHookRaw(name, content, filePath)
  res.json({ success: true })
}))

app.post('/api/hooks/settings', asyncHandler(async (req, res) => {
  const { hookType, hookConfig, location, projectPath, matcherIndex } = req.body
  await fileManager.saveHookToSettings(hookType, hookConfig, location, projectPath, matcherIndex)
  res.json({ success: true })
}))

app.post('/api/hooks/validate', asyncHandler(async (req, res) => {
  res.json(validateHook(req.body.hook))
}))

// ============ Permissions API ============
app.get('/api/permissions', asyncHandler(async (_req, res) => {
  res.json(await fileManager.getPermissionModel())
}))

app.post('/api/permissions/rule', asyncHandler(async (req, res) => {
  await fileManager.savePermissionRule(req.body.level, req.body.effect, req.body.rule)
  res.json({ success: true })
}))

app.post('/api/permissions/rule/delete', asyncHandler(async (req, res) => {
  await fileManager.deletePermissionRule(req.body.level, req.body.effect, req.body.rule)
  res.json({ success: true })
}))

app.get('/api/permissions/disallowed-tools', asyncHandler(async (req, res) => {
  res.json(await fileManager.getDisallowedTools(String(req.query.filePath)))
}))

app.post('/api/permissions/disallowed-tools', asyncHandler(async (req, res) => {
  await fileManager.setDisallowedTools(req.body.filePath, req.body.tools)
  res.json({ success: true })
}))

// ============ Settings API (read-only in web; writes are desktop-only) ============
app.get('/api/settings/model', asyncHandler(async (_req, res) => {
  res.json(await fileManager.getSettingsModel())
}))

app.get('/api/settings/toggles', asyncHandler(async (_req, res) => {
  res.json(await fileManager.getSafetyToggles())
}))

app.delete('/api/hooks/:name', asyncHandler(async (req, res) => {
  await fileManager.deleteHook(req.params.name)
  res.json({ success: true })
}))

app.delete('/api/hooks/settings/:hookType/:matcherIndex', asyncHandler(async (req, res) => {
  const { hookType, matcherIndex } = req.params
  const { location, projectPath } = req.query
  await fileManager.deleteHookFromSettings(
    hookType,
    parseInt(matcherIndex),
    location as 'user' | 'project',
    projectPath as string | undefined
  )
  res.json({ success: true })
}))

app.post('/api/hooks/script', asyncHandler(async (req, res) => {
  const { scriptPath, content, location, projectPath } = req.body
  const fullPath = await fileManager.createHookScript(scriptPath, content, location, projectPath)
  res.json({ fullPath })
}))

app.get('/api/hooks/script', asyncHandler(async (req, res) => {
  const { scriptPath, location, projectPath } = req.query
  const content = await fileManager.readHookScript(
    scriptPath as string,
    location as 'user' | 'project',
    projectPath as string | undefined
  )
  res.json({ content })
}))

// Hook logs - not available in web mode (no persistent state)
app.get('/api/hooks/logs', asyncHandler(async (_req, res) => {
  // In web mode, logs are not persisted
  res.json([])
}))

app.get('/api/hooks/debug-logs', asyncHandler(async (_req, res) => {
  // In web mode, debug logs are read from file system
  res.json([])
}))

app.delete('/api/hooks/logs', asyncHandler(async (_req, res) => {
  res.json({ success: true })
}))

// Launch debug session - not fully supported in web mode
app.post('/api/hooks/debug-session', asyncHandler(async (_req, res) => {
  res.status(501).json({
    success: false,
    message: 'Debug session launch requires Electron mode'
  })
}))

app.delete('/api/hooks/debug-session/:pid', asyncHandler(async (_req, res) => {
  res.status(501).json({
    success: false,
    message: 'Debug session management requires Electron mode'
  })
}))

// Test hook - limited in web mode
app.post('/api/hooks/test', asyncHandler(async (_req, res) => {
  res.status(501).json({
    success: false,
    message: 'Hook testing requires Electron mode for security reasons'
  })
}))

// ============ MCP Servers API ============
app.get('/api/mcp', asyncHandler(async (_req, res) => {
  console.log('[API] GET /api/mcp')
  const servers = await fileManager.getMCPServers()
  res.json(servers)
}))

app.get('/api/mcp/:name', asyncHandler(async (req, res) => {
  const servers = await fileManager.getMCPServers()
  const server = servers[req.params.name]
  if (server) {
    res.json(server)
  } else {
    res.status(404).json({ error: 'MCP server not found' })
  }
}))

app.post('/api/mcp/:name', asyncHandler(async (req, res) => {
  const servers = await fileManager.getMCPServers()
  servers[req.params.name] = req.body as MCPServerConfig
  await fileManager.saveMCPServers(servers)
  res.json({ success: true })
}))

app.delete('/api/mcp/:name', asyncHandler(async (req, res) => {
  const servers = await fileManager.getMCPServers()
  delete servers[req.params.name]
  await fileManager.saveMCPServers(servers)
  res.json({ success: true })
}))

app.post('/api/mcp/:name/test', asyncHandler(async (_req, res) => {
  // MCP connection testing not available in web mode
  res.status(501).json({
    success: false,
    message: 'MCP connection testing requires Electron mode'
  })
}))

// ============ Commands API ============
app.get('/api/commands', asyncHandler(async (_req, res) => {
  console.log('[API] GET /api/commands')
  const commands = await fileManager.getCommands()
  res.json(commands)
}))

app.get('/api/commands/:name', asyncHandler(async (req, res) => {
  const command = await fileManager.getCommand(req.params.name)
  if (command) {
    res.json(command)
  } else {
    res.status(404).json({ error: 'Command not found' })
  }
}))

app.post('/api/commands', asyncHandler(async (req, res) => {
  const command = req.body as SlashCommand
  await fileManager.saveCommand(command)
  res.json({ success: true })
}))

app.post('/api/commands/raw', asyncHandler(async (req, res) => {
  const { name, content, filePath } = req.body
  await fileManager.saveCommandRaw(name, content, filePath)
  res.json({ success: true })
}))

app.delete('/api/commands/:name', asyncHandler(async (req, res) => {
  const filePath = typeof req.query.filePath === 'string' ? req.query.filePath : undefined
  await fileManager.deleteCommand(req.params.name, filePath)
  res.json({ success: true })
}))

// ============ CLAUDE.md API ============
app.get('/api/claudemd', asyncHandler(async (_req, res) => {
  const content = await fileManager.getClaudeMD()
  res.json({ content })
}))

app.get('/api/claudemd/all', asyncHandler(async (_req, res) => {
  console.log('[API] GET /api/claudemd/all')
  const files = await fileManager.getClaudeMDFiles()
  res.json(files)
}))

app.post('/api/claudemd', asyncHandler(async (req, res) => {
  const { content, location } = req.body
  await fileManager.saveClaudeMD(content, location)
  res.json({ success: true })
}))

// ============ Project API ============
app.get('/api/project/context', asyncHandler(async (_req, res) => {
  const context = await fileManager.getProjectContext()
  res.json(context)
}))

// Select project path - not available in web mode
app.post('/api/project/select', asyncHandler(async (_req, res) => {
  res.status(501).json({
    error: 'Project selection dialog requires Electron mode'
  })
}))

// ============ Dependencies API ============
app.get('/api/dependencies/graph', asyncHandler(async (_req, res) => {
  // Return empty graph for now - dependency graph visualization
  res.json({ nodes: [], edges: [] })
}))

// ============ Validation API ============
app.post('/api/validate', asyncHandler(async (req, res) => {
  const { type, config } = req.body
  // Basic validation - can be extended
  res.json({ valid: true, type, config })
}))

// ============ Providers API ============
// Providers are stored in memory for web mode (not persisted)
let providers: Provider[] = []
let activeProviderId: string | null = null

app.get('/api/providers', asyncHandler(async (_req, res) => {
  res.json(providers)
}))

app.get('/api/providers/active', asyncHandler(async (_req, res) => {
  const active = providers.find(p => p.id === activeProviderId) || null
  res.json(active)
}))

app.post('/api/providers', asyncHandler(async (req, res) => {
  const provider: Provider = {
    ...req.body,
    id: `provider_${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  providers.push(provider)
  res.json(provider)
}))

app.put('/api/providers/:id', asyncHandler(async (req, res) => {
  const index = providers.findIndex(p => p.id === req.params.id)
  if (index === -1) {
    res.status(404).json({ error: 'Provider not found' })
    return
  }
  providers[index] = {
    ...providers[index],
    ...req.body,
    updatedAt: new Date().toISOString()
  }
  res.json(providers[index])
}))

app.delete('/api/providers/:id', asyncHandler(async (req, res) => {
  providers = providers.filter(p => p.id !== req.params.id)
  if (activeProviderId === req.params.id) {
    activeProviderId = null
  }
  res.json({ success: true })
}))

app.post('/api/providers/:id/switch', asyncHandler(async (req, res) => {
  const provider = providers.find(p => p.id === req.params.id)
  if (!provider) {
    res.status(404).json({ error: 'Provider not found' })
    return
  }
  activeProviderId = req.params.id
  res.json(provider)
}))

app.get('/api/providers/claude-settings', asyncHandler(async (_req, res) => {
  // Reading Claude settings file
  const fs = await import('fs/promises')
  const os = await import('os')
  const settingsPath = path.join(os.homedir(), '.claude.json')
  try {
    const content = await fs.readFile(settingsPath, 'utf-8')
    res.json({ content })
  } catch {
    res.json({ content: null })
  }
}))

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API Error]', err)
  res.status(500).json({ error: err.message })
})

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'web' })
})

// Start server
app.listen(PORT, () => {
  console.log(`[Server] API server running at http://localhost:${PORT}`)
  console.log(`[Server] Mode: Web (Express)`)
})

export default app
