import type {
  Skill,
  Agent,
  Hook,
  MCPServers,
  MCPServerConfig,
  SlashCommand,
  ProjectContext,
  Provider,
  HookExecutionLog,
  Marketplace,
  Plugin,
  PluginCliResult,
} from '@shared/types'

// Detect if running in Electron
const isElectron = typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined'

// API base URL for web mode
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

console.log('[API] Running in', isElectron ? 'Electron' : 'Web', 'mode')
if (!isElectron) {
  console.log('[API] API base URL:', API_BASE_URL)
}

// HTTP client for web mode
async function httpGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}

async function httpPost<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}

async function httpPut<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  })
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}

async function httpDelete<T>(path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`)
  if (query) {
    Object.entries(query).forEach(([key, value]) => url.searchParams.append(key, value))
  }
  const response = await fetch(url.toString(), { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}

// Type-safe wrapper around electron API or HTTP API
export const api = {
  // Skills
  skills: {
    getAll: async (): Promise<Skill[]> => {
      if (isElectron) {
        console.log('[API] window.electronAPI:', window.electronAPI)
        if (!window.electronAPI) {
          console.error('[API] window.electronAPI is undefined!')
          throw new Error('Electron API not available')
        }
        try {
          return await window.electronAPI.getSkills()
        } catch (error) {
          console.error('[API] Failed to get skills:', error)
          throw error
        }
      } else {
        return httpGet<Skill[]>('/api/skills')
      }
    },
    get: async (name: string): Promise<Skill | null> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        try {
          return await window.electronAPI.getSkill(name)
        } catch (error) {
          console.error(`[API] Failed to get skill "${name}":`, error)
          throw error
        }
      } else {
        try {
          return await httpGet<Skill>(`/api/skills/${encodeURIComponent(name)}`)
        } catch {
          return null
        }
      }
    },
    save: async (skill: Skill): Promise<void> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        try {
          return await window.electronAPI.saveSkill(skill)
        } catch (error) {
          console.error('[API] Failed to save skill:', error)
          throw error
        }
      } else {
        await httpPost('/api/skills', skill)
      }
    },
    delete: async (name: string): Promise<void> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        try {
          return await window.electronAPI.deleteSkill(name)
        } catch (error) {
          console.error(`[API] Failed to delete skill "${name}":`, error)
          throw error
        }
      } else {
        await httpDelete(`/api/skills/${encodeURIComponent(name)}`)
      }
    },
  },

  // Agents
  agents: {
    getAll: async (): Promise<Agent[]> => {
      if (isElectron) {
        return window.electronAPI.getAgents()
      } else {
        return httpGet<Agent[]>('/api/agents')
      }
    },
    get: async (name: string): Promise<Agent | null> => {
      if (isElectron) {
        return window.electronAPI.getAgent(name)
      } else {
        try {
          return await httpGet<Agent>(`/api/agents/${encodeURIComponent(name)}`)
        } catch {
          return null
        }
      }
    },
    save: async (agent: Agent): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.saveAgent(agent)
      } else {
        await httpPost('/api/agents', agent)
      }
    },
    delete: async (name: string): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.deleteAgent(name)
      } else {
        await httpDelete(`/api/agents/${encodeURIComponent(name)}`)
      }
    },
  },

  // Hooks
  hooks: {
    getAll: async (): Promise<Hook[]> => {
      if (isElectron) {
        return window.electronAPI.getHooks()
      } else {
        return httpGet<Hook[]>('/api/hooks')
      }
    },
    get: async (name: string): Promise<Hook | null> => {
      if (isElectron) {
        return window.electronAPI.getHook(name)
      } else {
        try {
          return await httpGet<Hook>(`/api/hooks/${encodeURIComponent(name)}`)
        } catch {
          return null
        }
      }
    },
    save: async (hook: Hook): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.saveHook(hook)
      } else {
        await httpPost('/api/hooks', hook)
      }
    },
    saveRaw: async (name: string, content: string, filePath: string): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.saveHookRaw(name, content, filePath)
      } else {
        await httpPost('/api/hooks/raw', { name, content, filePath })
      }
    },
    saveToSettings: async (
      hookType: string,
      hookConfig: { matcher?: string; hooks: Array<{ type: string; command?: string; prompt?: string; timeout?: number }> },
      location: 'user' | 'project',
      projectPath?: string,
      matcherIndex?: number
    ): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.saveHookToSettings(hookType, hookConfig, location, projectPath, matcherIndex)
      } else {
        await httpPost('/api/hooks/settings', { hookType, hookConfig, location, projectPath, matcherIndex })
      }
    },
    delete: async (name: string): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.deleteHook(name)
      } else {
        await httpDelete(`/api/hooks/${encodeURIComponent(name)}`)
      }
    },
    deleteFromSettings: async (
      hookType: string,
      matcherIndex: number,
      location: 'user' | 'project',
      projectPath?: string
    ): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.deleteHookFromSettings(hookType, matcherIndex, location, projectPath)
      } else {
        await httpDelete(`/api/hooks/settings/${encodeURIComponent(hookType)}/${matcherIndex}`, {
          location,
          projectPath: projectPath || '',
        })
      }
    },
    createScript: async (
      scriptPath: string,
      content: string,
      location: 'user' | 'project',
      projectPath?: string
    ): Promise<string> => {
      if (isElectron) {
        return window.electronAPI.createHookScript(scriptPath, content, location, projectPath)
      } else {
        const result = await httpPost<{ fullPath: string }>('/api/hooks/script', { scriptPath, content, location, projectPath })
        return result.fullPath
      }
    },
    readScript: async (
      scriptPath: string,
      location: 'user' | 'project',
      projectPath?: string
    ): Promise<string | null> => {
      if (isElectron) {
        return window.electronAPI.readHookScript(scriptPath, location, projectPath)
      } else {
        const url = new URL(`${API_BASE_URL}/api/hooks/script`)
        url.searchParams.append('scriptPath', scriptPath)
        url.searchParams.append('location', location)
        if (projectPath) url.searchParams.append('projectPath', projectPath)
        const result = await fetch(url.toString()).then(r => r.json())
        return result.content
      }
    },
    getLogs: async (): Promise<HookExecutionLog[]> => {
      if (isElectron) {
        return window.electronAPI.getHookLogs()
      } else {
        return httpGet<HookExecutionLog[]>('/api/hooks/logs')
      }
    },
    getDebugLogs: async (): Promise<HookExecutionLog[]> => {
      if (isElectron) {
        return window.electronAPI.getHookDebugLogs()
      } else {
        return httpGet<HookExecutionLog[]>('/api/hooks/debug-logs')
      }
    },
    clearLogs: async (): Promise<boolean> => {
      if (isElectron) {
        return window.electronAPI.clearHookLogs()
      } else {
        const result = await httpDelete<{ success: boolean }>('/api/hooks/logs')
        return result.success
      }
    },
    launchDebugSession: async (
      hookType: string,
      projectPath?: string
    ): Promise<{ success: boolean; message: string; pid?: number }> => {
      if (isElectron) {
        return window.electronAPI.launchDebugSession(hookType, projectPath)
      } else {
        return httpPost<{ success: boolean; message: string; pid?: number }>('/api/hooks/debug-session', { hookType, projectPath })
      }
    },
    stopDebugSession: async (pid: number): Promise<boolean> => {
      if (isElectron) {
        return window.electronAPI.stopDebugSession(pid)
      } else {
        const result = await httpDelete<{ success: boolean }>(`/api/hooks/debug-session/${pid}`)
        return result.success
      }
    },
    test: async (
      hookName: string,
      command: string,
      hookType: string,
      location: 'user' | 'project',
      projectPath?: string,
      timeout?: number
    ): Promise<HookExecutionLog> => {
      if (isElectron) {
        return window.electronAPI.testHook(hookName, command, hookType, location, projectPath, timeout)
      } else {
        return httpPost<HookExecutionLog>('/api/hooks/test', { hookName, command, hookType, location, projectPath, timeout })
      }
    },
  },

  // MCP
  mcp: {
    getAll: async (): Promise<MCPServers> => {
      if (isElectron) {
        return window.electronAPI.getMCPServers()
      } else {
        return httpGet<MCPServers>('/api/mcp')
      }
    },
    get: async (name: string): Promise<MCPServerConfig | null> => {
      if (isElectron) {
        return window.electronAPI.getMCPServer(name)
      } else {
        try {
          return await httpGet<MCPServerConfig>(`/api/mcp/${encodeURIComponent(name)}`)
        } catch {
          return null
        }
      }
    },
    save: async (name: string, config: MCPServerConfig): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.saveMCPServer(name, config)
      } else {
        await httpPost(`/api/mcp/${encodeURIComponent(name)}`, config)
      }
    },
    delete: async (name: string): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.deleteMCPServer(name)
      } else {
        await httpDelete(`/api/mcp/${encodeURIComponent(name)}`)
      }
    },
    testConnection: async (name: string): Promise<unknown> => {
      if (isElectron) {
        return window.electronAPI.testMCPConnection(name)
      } else {
        return httpPost(`/api/mcp/${encodeURIComponent(name)}/test`)
      }
    },
  },

  // Commands
  commands: {
    getAll: async (): Promise<SlashCommand[]> => {
      if (isElectron) {
        return window.electronAPI.getCommands()
      } else {
        return httpGet<SlashCommand[]>('/api/commands')
      }
    },
    get: async (name: string): Promise<SlashCommand | null> => {
      if (isElectron) {
        return window.electronAPI.getCommand(name)
      } else {
        try {
          return await httpGet<SlashCommand>(`/api/commands/${encodeURIComponent(name)}`)
        } catch {
          return null
        }
      }
    },
    save: async (command: SlashCommand): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.saveCommand(command)
      } else {
        await httpPost('/api/commands', command)
      }
    },
    saveRaw: async (name: string, content: string, filePath: string): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.saveCommandRaw(name, content, filePath)
      } else {
        await httpPost('/api/commands/raw', { name, content, filePath })
      }
    },
    delete: async (name: string): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.deleteCommand(name)
      } else {
        await httpDelete(`/api/commands/${encodeURIComponent(name)}`)
      }
    },
  },

  // CLAUDE.md
  claudeMD: {
    get: async (): Promise<string> => {
      if (isElectron) {
        return window.electronAPI.getClaudeMD()
      } else {
        const result = await httpGet<{ content: string }>('/api/claudemd')
        return result.content
      }
    },
    getAll: async (): Promise<Array<{ content: string; location: 'user' | 'project' | 'global'; filePath: string; exists: boolean }>> => {
      if (isElectron) {
        return window.electronAPI.getAllClaudeMD()
      } else {
        return httpGet('/api/claudemd/all')
      }
    },
    save: async (content: string, location: 'user' | 'project'): Promise<void> => {
      if (isElectron) {
        return window.electronAPI.saveClaudeMD(content, location)
      } else {
        await httpPost('/api/claudemd', { content, location })
      }
    },
  },

  // Project
  project: {
    getContext: async (): Promise<ProjectContext> => {
      if (isElectron) {
        return window.electronAPI.getProjectContext()
      } else {
        return httpGet<ProjectContext>('/api/project/context')
      }
    },
    selectPath: async (): Promise<string | null> => {
      if (isElectron) {
        return window.electronAPI.selectProjectPath()
      } else {
        // Not available in web mode
        console.warn('[API] selectProjectPath is not available in web mode')
        return null
      }
    },
  },

  // Dependencies
  dependencies: {
    getGraph: async (): Promise<{ nodes: unknown[]; edges: unknown[] }> => {
      if (isElectron) {
        return window.electronAPI.getDependencyGraph()
      } else {
        return httpGet<{ nodes: unknown[]; edges: unknown[] }>('/api/dependencies/graph')
      }
    },
  },

  // Validation
  validate: async (type: string, config: unknown): Promise<{ valid: boolean; errors?: string[] }> => {
    if (isElectron) {
      return window.electronAPI.validateConfig(type, config)
    } else {
      return httpPost<{ valid: boolean; errors?: string[] }>('/api/validate', { type, config })
    }
  },

  // File watching
  onFilesChanged: (callback: (files: unknown) => void): void => {
    if (isElectron) {
      window.electronAPI.onFilesChanged(callback)
    } else {
      // File watching not available in web mode
      console.warn('[API] File watching is not available in web mode')
    }
  },

  // Providers
  providers: {
    getAll: async (): Promise<Provider[]> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.getProviders()
      } else {
        return httpGet<Provider[]>('/api/providers')
      }
    },
    getActive: async (): Promise<Provider | null> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.getActiveProvider()
      } else {
        return httpGet<Provider | null>('/api/providers/active')
      }
    },
    add: async (provider: Omit<Provider, 'id' | 'createdAt' | 'updatedAt'>): Promise<Provider> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.addProvider(provider)
      } else {
        return httpPost<Provider>('/api/providers', provider)
      }
    },
    update: async (id: string, updates: Partial<Provider>): Promise<Provider> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.updateProvider(id, updates)
      } else {
        return httpPut<Provider>(`/api/providers/${encodeURIComponent(id)}`, updates)
      }
    },
    delete: async (id: string): Promise<void> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.deleteProvider(id)
      } else {
        await httpDelete(`/api/providers/${encodeURIComponent(id)}`)
      }
    },
    switch: async (id: string): Promise<Provider> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.switchProvider(id)
      } else {
        return httpPost<Provider>(`/api/providers/${encodeURIComponent(id)}/switch`)
      }
    },
    readClaudeSettings: async (): Promise<string | null> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.readClaudeSettings()
      } else {
        const result = await httpGet<{ content: string | null }>('/api/providers/claude-settings')
        return result.content
      }
    },
  },

  // Plugins / Marketplaces (spec005)
  plugins: {
    cliStatus: async (): Promise<boolean> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.pluginCliStatus()
      }
      return false
    },
    getMarketplaces: async (): Promise<Marketplace[]> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.getMarketplaces()
      }
      return httpGet<Marketplace[]>('/api/plugins/marketplaces')
    },
    getAll: async (): Promise<Plugin[]> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.getPlugins()
      }
      return httpGet<Plugin[]>('/api/plugins')
    },
    details: async (key: string): Promise<PluginCliResult> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.pluginDetails(key)
      }
      return { ok: false, cliAvailable: false, message: 'details 仅桌面端可用' }
    },
    enable: async (key: string): Promise<PluginCliResult> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.enablePlugin(key)
      }
      return { ok: false, cliAvailable: false, message: 'enable 仅桌面端可用（Web 只读）' }
    },
    disable: async (key: string): Promise<PluginCliResult> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.disablePlugin(key)
      }
      return { ok: false, cliAvailable: false, message: 'disable 仅桌面端可用（Web 只读）' }
    },
    init: async (name: string, cwd?: string): Promise<PluginCliResult> => {
      if (isElectron) {
        if (!window.electronAPI) throw new Error('Electron API not available')
        return await window.electronAPI.initPlugin(name, cwd)
      }
      return { ok: false, cliAvailable: false, message: 'init 仅桌面端可用' }
    },
  },

  // Utility: Check if in Electron mode
  isElectron: () => isElectron,
}
