import { invoke as tauriInvoke } from '@tauri-apps/api/core'

// Typed invoke wrapper — centralises all command names
function inv<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args)
}

// ── Types (mirror Rust structs — snake_case fields per serde default) ────────

export interface Skill {
  name: string
  description: string
  content?: string
  file_path?: string
  location: string
  dependencies?: string[]
}

export interface Agent {
  name: string
  description: string
  content?: string
  file_path?: string
  location: string
  dependencies?: string[]
  source: 'builtin' | 'user'
}

export interface ClaudeMdFile {
  location: string
  file_path: string
  content: string
  exists: boolean
}

export interface HookEntry {
  name: string
  hook_type: string
  content?: string
  file_path?: string
  location: string
}

export interface HookExecutionLog {
  id: string
  hook_name: string
  hook_type: string
  command: string
  exit_code?: number
  stdout: string
  stderr: string
  duration_ms: number
  timestamp: number
  success: boolean
}

/** Result from cmd_test_hook */
export interface HookTestResult {
  exit_code?: number
  stdout: string
  stderr: string
  duration_ms: number
  timed_out: boolean
}

/** Structured entry from cmd_get_hook_debug_logs */
export interface HookDebugEntry {
  timestamp: string
  hook_type: string
  status: string
  message: string
  file: string
}

export interface McpServer {
  name: string
  config: Record<string, unknown>
  /** "settings" | "legacy" */
  source: string
}

export interface SlashCommand {
  name: string
  description?: string
  content: string
  file_path?: string
  location: string
  rel_path?: string
}

/** Entry returned by cmd_discover_claudemd */
export interface ClaudeMdEntry {
  path: string
  project_name: string
  location: string
}

export interface DependencyGraph {
  nodes: Array<{ id: string; node_type: string; name: string }>
  edges: Array<{ id: string; source: string; target: string; edge_type: string }>
}

// Git types
export interface GitStatus {
  branch: string
  ahead: number
  behind: number
  staged: string[]
  unstaged: string[]
  untracked: string[]
}

export interface BranchInfo {
  name: string
  is_current: boolean
  is_remote: boolean
  upstream?: string
}

export interface CommitInfo {
  hash: string
  short_hash: string
  message: string
  author: string
  timestamp: number
}

// Worktree types
export interface WorktreeInfo {
  path: string
  branch: string
  is_main: boolean
  is_locked: boolean
}

// Environment types
export interface ToolDetection {
  name: string
  found: boolean
  path?: string
  version?: string
}

export interface EnvVar {
  key: string
  value: string
}

// Usage types
export interface SessionRow {
  id: string
  tool: string
  working_dir: string
  started_at: number | null
  ended_at: number | null
  duration_sec: number | null
  model: string | null
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface ProjectRow {
  id: string
  tool: string
  directory: string
  pinned: boolean
  last_used_at: number | null
  session_count: number
  total_tokens: number
  total_cost_usd: number
}

export interface DashboardSummary {
  today_input_tokens: number
  today_output_tokens: number
  today_cost_usd: number
  claude_today_tokens: number
  codex_today_tokens: number
  recent_sessions: SessionRow[]
}

export interface DailyUsage {
  date: string           // "YYYY-MM-DD"
  claude_tokens: number
  codex_tokens: number
  total_cost_usd: number
}

export interface RunningTool {
  tool: string
  pid: number
  working_dir: string | null
}

export interface CodexStatus {
  installed: boolean
  path: string | null
  version: string | null
  config_exists: boolean
  config_path: string
  current_model: string | null
  current_provider: string | null
}

// ── IPC channel → Tauri command mapping ──────────────────────────────────────
// Note: JS camelCase arg keys map to Rust snake_case param names via Tauri v2
// Rust structs serialise with snake_case field names (serde default)

export const api = {
  runner: {
    create: (tool: string, workingDir: string, extraArgs?: string[]) =>
      inv<string>('pty_create', { tool, workingDir, extraArgs }),
    write: (sessionId: string, data: string) =>
      inv<void>('pty_write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      inv<void>('pty_resize', { sessionId, cols, rows }),
    kill: (sessionId: string) =>
      inv<void>('pty_kill', { sessionId }),
    list: () =>
      inv<{ id: string; tool: string; working_dir: string }[]>('pty_list'),
    replay: (sessionId: string) =>
      inv<string>('pty_replay', { sessionId }),
  },

  skills: {
    getAll: () => inv<Skill[]>('cmd_get_skills'),
    get: (name: string) => inv<Skill | null>('cmd_get_skill', { name }),
    save: (skill: Skill) => inv<void>('cmd_save_skill', { skill }),
    delete: (name: string) => inv<void>('cmd_delete_skill', { name }),
  },

  agents: {
    getAll: () => inv<Agent[]>('cmd_get_agents'),
    get: (name: string) => inv<Agent | null>('cmd_get_agent', { name }),
    save: (agent: Agent) => inv<void>('cmd_save_agent', { agent }),
    delete: (name: string) => inv<void>('cmd_delete_agent', { name }),
  },

  claudeMD: {
    get: () => inv<ClaudeMdFile>('cmd_get_claudemd'),
    getAll: (projectPath?: string) =>
      inv<ClaudeMdFile[]>('cmd_get_all_claudemd', { projectPath }),
    save: (filePath: string, content: string) =>
      inv<void>('cmd_save_claudemd', { filePath, content }),
    discover: (roots?: string[]) =>
      inv<ClaudeMdEntry[]>('cmd_discover_claudemd', { roots }),
  },

  graph: {
    getDependencies: () => inv<DependencyGraph>('cmd_get_dependency_graph'),
  },

  commands: {
    getAll: (projectPath?: string) => inv<SlashCommand[]>('cmd_get_slash_commands', { projectPath }),
    get: (name: string) => inv<SlashCommand | null>('cmd_get_slash_command', { name }),
    save: (cmd: SlashCommand) => inv<void>('cmd_save_slash_command', { cmd }),
    saveRaw: (name: string, content: string, filePath: string) =>
      inv<void>('cmd_save_slash_command_raw', { name, content, filePath }),
    delete: (name: string) => inv<void>('cmd_delete_slash_command', { name }),
  },

  mcp: {
    getAll: () => inv<McpServer[]>('cmd_get_mcp_servers'),
    save: (name: string, config: Record<string, unknown>) =>
      inv<void>('cmd_save_mcp_server', { name, config }),
    delete: (name: string) => inv<void>('cmd_delete_mcp_server', { name }),
    testConnection: (name: string) => inv<boolean>('cmd_test_mcp_connection', { name }),
  },

  hooks: {
    getAll: () => inv<HookEntry[]>('cmd_get_hooks'),
    saveToSettings: (
      hookType: string,
      hookConfig: unknown,
      location: string,
      matcherIndex?: number,
      projectPath?: string,
    ) =>
      inv<void>('cmd_save_hook_to_settings', {
        hookType,
        hookConfig,
        location,
        matcherIndex,
        projectPath,
      }),
    deleteFromSettings: (hookType: string, matcherIndex: number, location: string, projectPath?: string) =>
      inv<void>('cmd_delete_hook_from_settings', { hookType, matcherIndex, location, projectPath }),
    createScript: (scriptPath: string, content: string) =>
      inv<string>('cmd_create_hook_script', { scriptPath, content }),
    readScript: (scriptPath: string) => inv<string>('cmd_read_hook_script', { scriptPath }),
    getLogs: () => inv<HookExecutionLog[]>('cmd_get_hook_logs'),
    clearLogs: () => inv<boolean>('cmd_clear_hook_logs'),
    getDebugLogs: () => inv<HookDebugEntry[]>('cmd_get_hook_debug_logs'),
    testHook: (command: string, timeoutSecs?: number) =>
      inv<HookTestResult>('cmd_test_hook', { command, timeoutSecs }),
    launchDebugSession: (hookType: string, projectPath?: string) =>
      inv<{ success: boolean; message: string; pid?: number }>(
        'cmd_launch_debug_session',
        { hookType, projectPath },
      ),
    stopDebugSession: (pid: number) => inv<boolean>('cmd_stop_debug_session', { pid }),
  },

  // M4b Git / Worktrees / Environment (commands registered in a later step)
  git: {
    getStatus: (repoPath: string) => inv<GitStatus>('cmd_git_status', { repoPath }),
    stage: (repoPath: string, paths: string[]) =>
      inv<void>('cmd_git_stage', { repoPath, paths }),
    commit: (repoPath: string, message: string) =>
      inv<string>('cmd_git_commit', { repoPath, message }),
    push: (repoPath: string) => inv<void>('cmd_git_push', { repoPath }),
    getBranches: (repoPath: string) => inv<BranchInfo[]>('cmd_git_branches', { repoPath }),
    checkout: (repoPath: string, branch: string) =>
      inv<void>('cmd_git_checkout', { repoPath, branch }),
    getLog: (repoPath: string, limit: number) =>
      inv<CommitInfo[]>('cmd_git_log', { repoPath, limit }),
  },

  worktrees: {
    list: (repoPath: string) => inv<WorktreeInfo[]>('cmd_list_worktrees', { repoPath }),
    add: (repoPath: string, branch: string, path: string, newBranch: boolean) =>
      inv<WorktreeInfo>('cmd_add_worktree', { repoPath, branch, path, newBranch }),
    remove: (repoPath: string, worktreePath: string, force: boolean) =>
      inv<void>('cmd_remove_worktree', { repoPath, worktreePath, force }),
  },

  environment: {
    detectTools: () => inv<ToolDetection[]>('cmd_detect_env_tools'),
    getEnvVars: () => inv<EnvVar[]>('cmd_get_env_vars'),
    setEnvVar: (key: string, value: string) => inv<void>('cmd_set_env_var', { key, value }),
    deleteEnvVar: (key: string) => inv<void>('cmd_delete_env_var', { key }),
    testApiConnection: () => inv<boolean>('cmd_test_api_connection'),
  },

  usage: {
    sync:          ()                    => inv<number>('usage_sync'),
    getSessions:   (tool: string, limit?: number, offset?: number) => inv<SessionRow[]>('get_sessions', { tool, limit, offset }),
    getProjects:   (tool: string)        => inv<ProjectRow[]>('get_projects', { tool }),
    pinProject:    (tool: string, directory: string) => inv<void>('pin_project', { tool, directory }),
    unpinProject:  (tool: string, directory: string) => inv<void>('unpin_project', { tool, directory }),
    getDashboard:  ()                    => inv<DashboardSummary>('get_dashboard'),
    getDailyUsage: (days: number)        => inv<DailyUsage[]>('get_daily_usage', { days }),
    getRunningTools: ()                  => inv<RunningTool[]>('get_running_tools'),
  },

  codex: {
    getStatus: () => inv<CodexStatus>('codex_get_status'),
    readConfig: () => inv<string>('codex_read_config'),
    writeConfig: (content: string) => inv<void>('codex_write_config', { content }),
  },
}
