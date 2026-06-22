import { contextBridge, ipcRenderer } from 'electron'
import type { Skill, Agent, Hook, HookSettingsMatcher, MCPServers, MCPServerConfig, SlashCommand, ProjectContext, ConfigFile, Provider, HookExecutionLog, HookSimInput, HookDryRunResult, Marketplace, Plugin, PluginCliResult, PermissionModel, PermissionLevel, PermissionEffect, SettingsModel, SettingsLevel, SafetyToggles, WorktreeConfig, SessionSummary, SessionEvent, SessionEventsPush, AgentTopology, AgentTopologyPush, UsageReport } from '../shared/types'
import type { MCPHealth } from '../shared/types/mcp-health'
import type { MemoryStore, MemorySnapshot, DreamChange } from '../shared/types/memory'
import type { LoopTask } from '../shared/types/loop'

console.log('[Preload] Script is loading...')

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Skills
  getSkills: (): Promise<Skill[]> => ipcRenderer.invoke('skills:getAll'),
  getSkill: (name: string): Promise<Skill | null> => ipcRenderer.invoke('skills:get', name),
  saveSkill: (skill: Skill): Promise<void> => ipcRenderer.invoke('skills:save', skill),
  deleteSkill: (name: string): Promise<void> => ipcRenderer.invoke('skills:delete', name),

  // Agents
  getAgents: (): Promise<Agent[]> => ipcRenderer.invoke('agents:getAll'),
  getAgent: (name: string): Promise<Agent | null> => ipcRenderer.invoke('agents:get', name),
  saveAgent: (agent: Agent): Promise<void> => ipcRenderer.invoke('agents:save', agent),
  deleteAgent: (name: string): Promise<void> => ipcRenderer.invoke('agents:delete', name),

  // Hooks
  getHooks: (): Promise<Hook[]> => ipcRenderer.invoke('hooks:getAll'),
  getHook: (name: string): Promise<Hook | null> => ipcRenderer.invoke('hooks:get', name),
  saveHook: (hook: Hook): Promise<void> => ipcRenderer.invoke('hooks:save', hook),
  saveHookRaw: (name: string, content: string, filePath: string): Promise<void> => ipcRenderer.invoke('hooks:saveRaw', name, content, filePath),
  saveHookToSettings: (
    hookType: string,
    hookConfig: HookSettingsMatcher,
    location: 'user' | 'project',
    projectPath?: string,
    matcherIndex?: number
  ): Promise<void> => ipcRenderer.invoke('hooks:saveToSettings', hookType, hookConfig, location, projectPath, matcherIndex),
  validateHook: (hook: Hook): Promise<{ valid: boolean; errors: string[] }> => ipcRenderer.invoke('hooks:validate', hook),
  deleteHook: (name: string): Promise<void> => ipcRenderer.invoke('hooks:delete', name),
  deleteHookFromSettings: (
    hookType: string,
    matcherIndex: number,
    location: 'user' | 'project',
    projectPath?: string
  ): Promise<void> => ipcRenderer.invoke('hooks:deleteFromSettings', hookType, matcherIndex, location, projectPath),
  createHookScript: (
    scriptPath: string,
    content: string,
    location: 'user' | 'project',
    projectPath?: string
  ): Promise<string> => ipcRenderer.invoke('hooks:createScript', scriptPath, content, location, projectPath),
  readHookScript: (
    scriptPath: string,
    location: 'user' | 'project',
    projectPath?: string
  ): Promise<string | null> => ipcRenderer.invoke('hooks:readScript', scriptPath, location, projectPath),
  getHookLogs: (): Promise<HookExecutionLog[]> => ipcRenderer.invoke('hooks:getLogs'),
  getHookDebugLogs: (): Promise<HookExecutionLog[]> => ipcRenderer.invoke('hooks:getDebugLogs'),
  clearHookLogs: (): Promise<boolean> => ipcRenderer.invoke('hooks:clearLogs'),
  launchDebugSession: (
    hookType: string,
    projectPath?: string
  ): Promise<{ success: boolean; message: string; pid?: number }> =>
    ipcRenderer.invoke('hooks:launchDebugSession', hookType, projectPath),
  stopDebugSession: (pid: number): Promise<boolean> =>
    ipcRenderer.invoke('hooks:stopDebugSession', pid),
  testHook: (
    hookName: string,
    command: string,
    hookType: string,
    location: 'user' | 'project',
    projectPath?: string,
    timeout?: number
  ): Promise<HookExecutionLog> => ipcRenderer.invoke('hooks:test', hookName, command, hookType, location, projectPath, timeout),
  dryRunHook: (hook: Hook, actionIndex: number, input: HookSimInput): Promise<HookDryRunResult> =>
    ipcRenderer.invoke('hooks:dryRun', hook, actionIndex, input),

  // MCP
  getMCPServers: (): Promise<MCPServers> => ipcRenderer.invoke('mcp:getAll'),
  getMCPServer: (name: string): Promise<MCPServerConfig | null> => ipcRenderer.invoke('mcp:get', name),
  getMCPServerSources: (): Promise<Record<string, 'user' | 'project'>> => ipcRenderer.invoke('mcp:getSources'),
  saveMCPServer: (name: string, config: MCPServerConfig, location?: 'user' | 'project'): Promise<void> => ipcRenderer.invoke('mcp:save', name, config, location),
  deleteMCPServer: (name: string): Promise<void> => ipcRenderer.invoke('mcp:delete', name),
  testMCPConnection: (name: string): Promise<{ success: boolean; message?: string }> => ipcRenderer.invoke('mcp:test', name),
  getMCPHealth: (): Promise<MCPHealth[]> => ipcRenderer.invoke('mcp:health'),
  probeMCPServer: (name: string): Promise<MCPHealth> => ipcRenderer.invoke('mcp:probe', name),

  // Memory
  listMemoryStores: (): Promise<MemoryStore[]> => ipcRenderer.invoke('memory:list'),
  readMemoryStore: (encodedCwd: string): Promise<MemoryStore | null> => ipcRenderer.invoke('memory:read', encodedCwd),
  snapshotMemory: (encodedCwd: string): Promise<MemorySnapshot> => ipcRenderer.invoke('memory:snapshot', encodedCwd),
  listMemorySnapshots: (encodedCwd: string): Promise<MemorySnapshot[]> => ipcRenderer.invoke('memory:listSnapshots', encodedCwd),
  deleteMemorySnapshot: (id: string): Promise<void> => ipcRenderer.invoke('memory:deleteSnapshot', id),
  diffMemorySnapshots: (beforeId: string, afterId: string): Promise<DreamChange[]> => ipcRenderer.invoke('memory:diff', beforeId, afterId),

  // Loop wakeups
  listLoops: (): Promise<LoopTask[]> => ipcRenderer.invoke('loop:list'),

  // Commands
  getCommands: (): Promise<SlashCommand[]> => ipcRenderer.invoke('commands:getAll'),
  getCommand: (name: string): Promise<SlashCommand | null> => ipcRenderer.invoke('commands:get', name),
  saveCommand: (command: SlashCommand): Promise<void> => ipcRenderer.invoke('commands:save', command),
  saveCommandRaw: (name: string, content: string, filePath: string): Promise<void> => ipcRenderer.invoke('commands:saveRaw', name, content, filePath),
  deleteCommand: (name: string, filePath?: string): Promise<void> => ipcRenderer.invoke('commands:delete', name, filePath),

  // CLAUDE.md
  getClaudeMD: (): Promise<string> => ipcRenderer.invoke('claudemd:get'),
  getAllClaudeMD: (): Promise<Array<{ content: string; location: 'user' | 'project' | 'global'; filePath: string; exists: boolean }>> => ipcRenderer.invoke('claudemd:getAll'),
  saveClaudeMD: (content: string, location: 'user' | 'project'): Promise<void> => ipcRenderer.invoke('claudemd:save', content, location),

  // Project
  getProjectContext: (): Promise<ProjectContext> => ipcRenderer.invoke('project:getContext'),
  selectProjectPath: (): Promise<string | null> => ipcRenderer.invoke('project:selectPath'),

  // File watching
  onFilesChanged: (callback: (files: ConfigFile[]) => void) => {
    ipcRenderer.on('files:changed', (_event, files) => callback(files))
  },

  // Session monitor (spec015)
  getSessions: (): Promise<SessionSummary[]> => ipcRenderer.invoke('session:list'),
  getSessionSnapshot: (id: string, filePath: string): Promise<SessionEvent[]> =>
    ipcRenderer.invoke('session:snapshot', id, filePath),
  subscribeSession: (id: string, filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('session:subscribe', id, filePath),
  unsubscribeSession: (id: string): Promise<boolean> => ipcRenderer.invoke('session:unsubscribe', id),
  onSessionEvents: (callback: (payload: SessionEventsPush) => void): (() => void) => {
    const handler = (_event: unknown, payload: SessionEventsPush) => callback(payload)
    ipcRenderer.on('session:events', handler)
    return () => ipcRenderer.removeListener('session:events', handler)
  },
  getAgentTopology: (filePath: string): Promise<AgentTopology> => ipcRenderer.invoke('session:topology', filePath),
  getSessionUsage: (id: string, filePath: string): Promise<UsageReport> => ipcRenderer.invoke('session:usage', id, filePath),
  subscribeTopology: (id: string, filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('session:topology:subscribe', id, filePath),
  unsubscribeTopology: (id: string): Promise<boolean> => ipcRenderer.invoke('session:topology:unsubscribe', id),
  onSessionTopology: (callback: (payload: AgentTopologyPush) => void): (() => void) => {
    const handler = (_event: unknown, payload: AgentTopologyPush) => callback(payload)
    ipcRenderer.on('session:topology', handler)
    return () => ipcRenderer.removeListener('session:topology', handler)
  },

  // Dependencies
  getDependencyGraph: (): Promise<{ nodes: unknown[]; edges: unknown[] }> => ipcRenderer.invoke('dependencies:getGraph'),

  // Validation
  validateConfig: (type: string, config: unknown): Promise<{ valid: boolean; errors?: string[] }> => ipcRenderer.invoke('validate:config', type, config),

  // Providers
  getProviders: (): Promise<Provider[]> => ipcRenderer.invoke('providers:getAll'),
  getActiveProvider: (): Promise<Provider | null> => ipcRenderer.invoke('providers:getActive'),
  addProvider: (provider: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Promise<Provider> => ipcRenderer.invoke('providers:add', provider),
  updateProvider: (id: string, updates: Partial<Provider>): Promise<Provider> => ipcRenderer.invoke('providers:update', id, updates),
  deleteProvider: (id: string): Promise<void> => ipcRenderer.invoke('providers:delete', id),
  switchProvider: (id: string): Promise<Provider> => ipcRenderer.invoke('providers:switch', id),
  readClaudeSettings: (): Promise<string | null> => ipcRenderer.invoke('providers:readClaudeSettings'),

  // Plugins / Marketplaces
  pluginCliStatus: (): Promise<boolean> => ipcRenderer.invoke('plugins:cliStatus'),
  getMarketplaces: (): Promise<Marketplace[]> => ipcRenderer.invoke('plugins:getMarketplaces'),
  getPlugins: (): Promise<Plugin[]> => ipcRenderer.invoke('plugins:getAll'),
  pluginDetails: (key: string): Promise<PluginCliResult> => ipcRenderer.invoke('plugins:details', key),
  enablePlugin: (key: string): Promise<PluginCliResult> => ipcRenderer.invoke('plugins:enable', key),
  disablePlugin: (key: string): Promise<PluginCliResult> => ipcRenderer.invoke('plugins:disable', key),
  initPlugin: (name: string, cwd?: string): Promise<PluginCliResult> => ipcRenderer.invoke('plugins:init', name, cwd),

  // Permissions
  getPermissionModel: (): Promise<PermissionModel> => ipcRenderer.invoke('permissions:getModel'),
  savePermissionRule: (level: PermissionLevel, effect: PermissionEffect, rule: string): Promise<void> =>
    ipcRenderer.invoke('permissions:saveRule', level, effect, rule),
  deletePermissionRule: (level: PermissionLevel, effect: PermissionEffect, rule: string): Promise<void> =>
    ipcRenderer.invoke('permissions:deleteRule', level, effect, rule),
  getDisallowedTools: (filePath: string): Promise<string[]> => ipcRenderer.invoke('permissions:getDisallowedTools', filePath),
  setDisallowedTools: (filePath: string, tools: string[]): Promise<void> =>
    ipcRenderer.invoke('permissions:setDisallowedTools', filePath, tools),

  // Settings (统一写入层 spec009)
  getSettingsModel: (): Promise<SettingsModel> => ipcRenderer.invoke('settings:getModel'),
  setSettingKey: (level: SettingsLevel, keyPath: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('settings:setKey', level, keyPath, value),
  getSafetyToggles: (): Promise<SafetyToggles> => ipcRenderer.invoke('settings:getToggles'),
  getWorktreeConfig: (): Promise<WorktreeConfig> => ipcRenderer.invoke('settings:getWorktree'),
  setWorktreeKey: (level: SettingsLevel, key: 'baseRef' | 'bgIsolation', value: string | undefined): Promise<void> =>
    ipcRenderer.invoke('settings:setWorktreeKey', level, key, value),
})

console.log('[Preload] electronAPI exposed to window')

// Type declaration for TypeScript
declare global {
  interface Window {
    electronAPI: {
      // Skills
      getSkills: () => Promise<Skill[]>
      getSkill: (name: string) => Promise<Skill | null>
      saveSkill: (skill: Skill) => Promise<void>
      deleteSkill: (name: string) => Promise<void>

      // Agents
      getAgents: () => Promise<Agent[]>
      getAgent: (name: string) => Promise<Agent | null>
      saveAgent: (agent: Agent) => Promise<void>
      deleteAgent: (name: string) => Promise<void>

      // Hooks
      getHooks: () => Promise<Hook[]>
      getHook: (name: string) => Promise<Hook | null>
      saveHook: (hook: Hook) => Promise<void>
      saveHookRaw: (name: string, content: string, filePath: string) => Promise<void>
      saveHookToSettings: (
        hookType: string,
        hookConfig: HookSettingsMatcher,
        location: 'user' | 'project',
        projectPath?: string,
        matcherIndex?: number
      ) => Promise<void>
      validateHook: (hook: Hook) => Promise<{ valid: boolean; errors: string[] }>
      deleteHook: (name: string) => Promise<void>
      deleteHookFromSettings: (
        hookType: string,
        matcherIndex: number,
        location: 'user' | 'project',
        projectPath?: string
      ) => Promise<void>
      createHookScript: (
        scriptPath: string,
        content: string,
        location: 'user' | 'project',
        projectPath?: string
      ) => Promise<string>
      readHookScript: (
        scriptPath: string,
        location: 'user' | 'project',
        projectPath?: string
      ) => Promise<string | null>
      getHookLogs: () => Promise<HookExecutionLog[]>
      getHookDebugLogs: () => Promise<HookExecutionLog[]>
      clearHookLogs: () => Promise<boolean>
      launchDebugSession: (
        hookType: string,
        projectPath?: string
      ) => Promise<{ success: boolean; message: string; pid?: number }>
      stopDebugSession: (pid: number) => Promise<boolean>
      testHook: (
        hookName: string,
        command: string,
        hookType: string,
        location: 'user' | 'project',
        projectPath?: string,
        timeout?: number
      ) => Promise<HookExecutionLog>
      dryRunHook: (hook: Hook, actionIndex: number, input: HookSimInput) => Promise<HookDryRunResult>

      // MCP
      getMCPServers: () => Promise<MCPServers>
      getMCPServer: (name: string) => Promise<MCPServerConfig | null>
      getMCPServerSources: () => Promise<Record<string, 'user' | 'project'>>
      saveMCPServer: (name: string, config: MCPServerConfig, location?: 'user' | 'project') => Promise<void>
      deleteMCPServer: (name: string) => Promise<void>
      testMCPConnection: (name: string) => Promise<{ success: boolean; message?: string }>
      getMCPHealth: () => Promise<MCPHealth[]>
      probeMCPServer: (name: string) => Promise<MCPHealth>

      // Memory
      listMemoryStores: () => Promise<MemoryStore[]>
      readMemoryStore: (encodedCwd: string) => Promise<MemoryStore | null>
      snapshotMemory: (encodedCwd: string) => Promise<MemorySnapshot>
      listMemorySnapshots: (encodedCwd: string) => Promise<MemorySnapshot[]>
      deleteMemorySnapshot: (id: string) => Promise<void>
      diffMemorySnapshots: (beforeId: string, afterId: string) => Promise<DreamChange[]>

      // Loop wakeups
      listLoops: () => Promise<LoopTask[]>

      // Commands
      getCommands: () => Promise<SlashCommand[]>
      getCommand: (name: string) => Promise<SlashCommand | null>
      saveCommand: (command: SlashCommand) => Promise<void>
      saveCommandRaw: (name: string, content: string, filePath: string) => Promise<void>
      deleteCommand: (name: string, filePath?: string) => Promise<void>

      // CLAUDE.md
      getClaudeMD: () => Promise<string>
      getAllClaudeMD: () => Promise<Array<{ content: string; location: 'user' | 'project' | 'global'; filePath: string; exists: boolean }>>
      saveClaudeMD: (content: string, location: 'user' | 'project') => Promise<void>

      // Project
      getProjectContext: () => Promise<ProjectContext>
      selectProjectPath: () => Promise<string | null>

      // File watching
      onFilesChanged: (callback: (files: ConfigFile[]) => void) => void

      // Session monitor (spec015)
      getSessions: () => Promise<SessionSummary[]>
      getSessionSnapshot: (id: string, filePath: string) => Promise<SessionEvent[]>
      subscribeSession: (id: string, filePath: string) => Promise<boolean>
      unsubscribeSession: (id: string) => Promise<boolean>
      onSessionEvents: (callback: (payload: SessionEventsPush) => void) => () => void
      getAgentTopology: (filePath: string) => Promise<AgentTopology>
      getSessionUsage: (id: string, filePath: string) => Promise<UsageReport>
      subscribeTopology: (id: string, filePath: string) => Promise<boolean>
      unsubscribeTopology: (id: string) => Promise<boolean>
      onSessionTopology: (callback: (payload: AgentTopologyPush) => void) => () => void

      // Dependencies
      getDependencyGraph: () => Promise<{ nodes: unknown[]; edges: unknown[] }>

      // Validation
      validateConfig: (type: string, config: unknown) => Promise<{ valid: boolean; errors?: string[] }>

      // Providers
      getProviders: () => Promise<Provider[]>
      getActiveProvider: () => Promise<Provider | null>
      addProvider: (provider: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Provider>
      updateProvider: (id: string, updates: Partial<Provider>) => Promise<Provider>
      deleteProvider: (id: string) => Promise<void>
      switchProvider: (id: string) => Promise<Provider>
      readClaudeSettings: () => Promise<string | null>

      // Plugins / Marketplaces
      pluginCliStatus: () => Promise<boolean>
      getMarketplaces: () => Promise<Marketplace[]>
      getPlugins: () => Promise<Plugin[]>
      pluginDetails: (key: string) => Promise<PluginCliResult>
      enablePlugin: (key: string) => Promise<PluginCliResult>
      disablePlugin: (key: string) => Promise<PluginCliResult>
      initPlugin: (name: string, cwd?: string) => Promise<PluginCliResult>
      getPermissionModel: () => Promise<PermissionModel>
      savePermissionRule: (level: PermissionLevel, effect: PermissionEffect, rule: string) => Promise<void>
      deletePermissionRule: (level: PermissionLevel, effect: PermissionEffect, rule: string) => Promise<void>
      getDisallowedTools: (filePath: string) => Promise<string[]>
      setDisallowedTools: (filePath: string, tools: string[]) => Promise<void>
      getSettingsModel: () => Promise<SettingsModel>
      setSettingKey: (level: SettingsLevel, keyPath: string, value: unknown) => Promise<void>
      getSafetyToggles: () => Promise<SafetyToggles>
      getWorktreeConfig: () => Promise<WorktreeConfig>
      setWorktreeKey: (level: SettingsLevel, key: 'baseRef' | 'bgIsolation', value: string | undefined) => Promise<void>
    }
  }
}
