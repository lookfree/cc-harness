const { contextBridge, ipcRenderer } = require('electron')

console.log('[Preload] Script is loading...')

contextBridge.exposeInMainWorld('electronAPI', {
  // Skills
  getSkills: () => ipcRenderer.invoke('skills:getAll'),
  getSkill: (name) => ipcRenderer.invoke('skills:get', name),
  saveSkill: (skill) => ipcRenderer.invoke('skills:save', skill),
  deleteSkill: (name) => ipcRenderer.invoke('skills:delete', name),

  // Agents
  getAgents: () => ipcRenderer.invoke('agents:getAll'),
  getAgent: (name) => ipcRenderer.invoke('agents:get', name),
  saveAgent: (agent) => ipcRenderer.invoke('agents:save', agent),
  deleteAgent: (name) => ipcRenderer.invoke('agents:delete', name),

  // Hooks
  getHooks: () => ipcRenderer.invoke('hooks:getAll'),
  getHook: (name) => ipcRenderer.invoke('hooks:get', name),
  saveHook: (hook) => ipcRenderer.invoke('hooks:save', hook),
  saveHookRaw: (name, content, filePath) => ipcRenderer.invoke('hooks:saveRaw', name, content, filePath),
  saveHookToSettings: (hookType, hookConfig, location, projectPath, matcherIndex) =>
    ipcRenderer.invoke('hooks:saveToSettings', hookType, hookConfig, location, projectPath, matcherIndex),
  validateHook: (hook) => ipcRenderer.invoke('hooks:validate', hook),
  deleteHook: (name) => ipcRenderer.invoke('hooks:delete', name),
  deleteHookFromSettings: (hookType, matcherIndex, location, projectPath) =>
    ipcRenderer.invoke('hooks:deleteFromSettings', hookType, matcherIndex, location, projectPath),
  createHookScript: (scriptPath, content, location, projectPath) =>
    ipcRenderer.invoke('hooks:createScript', scriptPath, content, location, projectPath),
  readHookScript: (scriptPath, location, projectPath) =>
    ipcRenderer.invoke('hooks:readScript', scriptPath, location, projectPath),
  getHookLogs: () => ipcRenderer.invoke('hooks:getLogs'),
  getHookDebugLogs: () => ipcRenderer.invoke('hooks:getDebugLogs'),
  clearHookLogs: () => ipcRenderer.invoke('hooks:clearLogs'),
  testHook: (hookName, command, hookType, location, projectPath, timeout) =>
    ipcRenderer.invoke('hooks:test', hookName, command, hookType, location, projectPath, timeout),
  launchDebugSession: (hookType, projectPath) =>
    ipcRenderer.invoke('hooks:launchDebugSession', hookType, projectPath),
  stopDebugSession: (pid) => ipcRenderer.invoke('hooks:stopDebugSession', pid),

  // MCP
  getMCPServers: () => ipcRenderer.invoke('mcp:getAll'),
  getMCPServer: (name) => ipcRenderer.invoke('mcp:get', name),
  saveMCPServer: (name, config) => ipcRenderer.invoke('mcp:save', name, config),
  deleteMCPServer: (name) => ipcRenderer.invoke('mcp:delete', name),
  testMCPConnection: (name) => ipcRenderer.invoke('mcp:test', name),

  // Commands
  getCommands: () => ipcRenderer.invoke('commands:getAll'),
  getCommand: (name) => ipcRenderer.invoke('commands:get', name),
  saveCommand: (command) => ipcRenderer.invoke('commands:save', command),
  saveCommandRaw: (name, content, filePath) => ipcRenderer.invoke('commands:saveRaw', name, content, filePath),
  deleteCommand: (name, filePath) => ipcRenderer.invoke('commands:delete', name, filePath),

  // CLAUDE.md
  getClaudeMD: () => ipcRenderer.invoke('claudemd:get'),
  getAllClaudeMD: () => ipcRenderer.invoke('claudemd:getAll'),
  saveClaudeMD: (content, location) => ipcRenderer.invoke('claudemd:save', content, location),

  // Project
  getProjectContext: () => ipcRenderer.invoke('project:getContext'),
  selectProjectPath: () => ipcRenderer.invoke('project:selectPath'),

  // File watching
  onFilesChanged: (callback) => {
    ipcRenderer.on('files:changed', (_event, files) => callback(files))
  },

  // Dependencies
  getDependencyGraph: () => ipcRenderer.invoke('dependencies:getGraph'),

  // Validation
  validateConfig: (type, config) => ipcRenderer.invoke('validate:config', type, config),

  // Providers
  getProviders: () => ipcRenderer.invoke('providers:getAll'),
  getActiveProvider: () => ipcRenderer.invoke('providers:getActive'),
  addProvider: (provider) => ipcRenderer.invoke('providers:add', provider),
  updateProvider: (id, updates) => ipcRenderer.invoke('providers:update', id, updates),
  deleteProvider: (id) => ipcRenderer.invoke('providers:delete', id),
  switchProvider: (id) => ipcRenderer.invoke('providers:switch', id),
  readClaudeSettings: () => ipcRenderer.invoke('providers:readClaudeSettings'),

  // Plugins / Marketplaces
  pluginCliStatus: () => ipcRenderer.invoke('plugins:cliStatus'),
  getMarketplaces: () => ipcRenderer.invoke('plugins:getMarketplaces'),
  getPlugins: () => ipcRenderer.invoke('plugins:getAll'),
  pluginDetails: (key) => ipcRenderer.invoke('plugins:details', key),
  enablePlugin: (key) => ipcRenderer.invoke('plugins:enable', key),
  disablePlugin: (key) => ipcRenderer.invoke('plugins:disable', key),
  initPlugin: (name, cwd) => ipcRenderer.invoke('plugins:init', name, cwd),

  // Permissions
  getPermissionModel: () => ipcRenderer.invoke('permissions:getModel'),
  savePermissionRule: (level, effect, rule) => ipcRenderer.invoke('permissions:saveRule', level, effect, rule),
  deletePermissionRule: (level, effect, rule) => ipcRenderer.invoke('permissions:deleteRule', level, effect, rule),
  getDisallowedTools: (filePath) => ipcRenderer.invoke('permissions:getDisallowedTools', filePath),
  setDisallowedTools: (filePath, tools) => ipcRenderer.invoke('permissions:setDisallowedTools', filePath, tools),

  // Settings (统一写入层 spec009)
  getSettingsModel: () => ipcRenderer.invoke('settings:getModel'),
  setSettingKey: (level, keyPath, value) => ipcRenderer.invoke('settings:setKey', level, keyPath, value),
  getSafetyToggles: () => ipcRenderer.invoke('settings:getToggles')
})

console.log('[Preload] electronAPI exposed to window')
