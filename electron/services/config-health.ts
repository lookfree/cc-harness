import type { ConfigHealth, HealthCheck } from '../../shared/types'

export interface ConfigHealthInput {
  /** settings 合并视图的点号路径 → 值（settings-writer 已把一层嵌套摊平，故含 env.XXX） */
  effective: Map<string, unknown>
  mcpServers: number
  skills: number
  commands: number
  agents: number
  /**
   * Stop / SubagentStop hook 里「看不到 stop_hook_active 判断」的 hook 名。
   * Claude Code 会把 stop_hook_active 传进 hook 输入；不判它就一直阻断收尾，
   * 表现为 "A hook blocked the turn from ending N consecutive times"。
   */
  unguardedStopHooks?: string[]
  /** 命令指向的脚本文件不存在的 hook 名——这类 hook 会静默失效 */
  missingHookScripts?: string[]
  /** 每轮都进上下文的 CLAUDE.md 字符数（user + 当前项目两份之和） */
  claudeMdChars?: number
  /** permissions.allow 里等价于"放行整个工具"的规则原文 */
  wideOpenRules?: string[]
}

/**
 * 配置面体检（spec028，纯函数不碰 fs）。
 * 阈值来自 ECC 经验法则（MCP>10 吃 context、工具面>80 判断力下降），不是官方契约——UI 须标注"经验阈值"。
 */
export function computeConfigHealth(input: ConfigHealthInput): ConfigHealth {
  const {
    effective, mcpServers, skills, commands, agents,
    unguardedStopHooks = [], missingHookScripts = [], claudeMdChars = 0, wideOpenRules = [],
  } = input
  const checks: HealthCheck[] = []
  const has = (k: string): boolean => {
    const v = effective.get(k)
    return v !== undefined && v !== null && v !== ''
  }

  // 1) thinking 预算不设上限 → 贵且常无收益
  if (!has('env.MAX_THINKING_TOKENS')) {
    checks.push({ id: 'thinking-budget-unset', severity: 'suggest', penalty: 10 })
  }

  // 2) subagent 跟主力模型跑 → 批量 fan-out 时最烧钱的一档
  if (!has('env.CLAUDE_CODE_SUBAGENT_MODEL')) {
    checks.push({ id: 'subagent-model-unset', severity: 'suggest', penalty: 10 })
  }

  // 3) 显式关掉 autocompact → 上下文吃满后每轮都在重发历史
  if (effective.get('autoCompactEnabled') === false) {
    checks.push({ id: 'autocompact-off', severity: 'warn', penalty: 15 })
  }

  // 4) MCP server 过多 → 每个 server 的工具描述都常驻 context
  if (mcpServers > 10) {
    checks.push({ id: 'mcp-heavy', severity: 'warn', params: { count: mcpServers, limit: 10 }, penalty: 15 })
  } else if (mcpServers > 5) {
    checks.push({ id: 'mcp-heavy', severity: 'info', params: { count: mcpServers, limit: 10 }, penalty: 5 })
  }

  // 5) 工具面总量（skills+commands+agents+mcp 的近似口径，真实工具数需连 server 枚举）
  const surface = skills + commands + agents + mcpServers
  if (surface > 80) {
    checks.push({ id: 'surface-heavy', severity: 'warn', params: { count: surface, limit: 80 }, penalty: 15 })
  } else if (surface > 50) {
    checks.push({ id: 'surface-heavy', severity: 'info', params: { count: surface, limit: 80 }, penalty: 5 })
  }

  // 6) 默认模型钉死在 opus → 多数任务 sonnet 够用
  const model = effective.get('model')
  if (typeof model === 'string' && /opus/i.test(model)) {
    checks.push({ id: 'opus-pinned', severity: 'suggest', params: { model }, penalty: 10 })
  }

  // 7) Stop/SubagentStop hook 不判 stop_hook_active → 会把会话卡在收不了尾的循环里
  if (unguardedStopHooks.length > 0) {
    checks.push({
      id: 'stop-hook-no-guard',
      severity: 'warn',
      params: { count: unguardedStopHooks.length, names: unguardedStopHooks.join(', ') },
      penalty: 20,
    })
  }

  // 8) hook 指向的脚本不存在 → hook 静默不执行，最难自己发现的一类
  if (missingHookScripts.length > 0) {
    checks.push({
      id: 'hook-script-missing',
      severity: 'warn',
      params: { count: missingHookScripts.length, names: missingHookScripts.join(', ') },
      penalty: 15,
    })
  }

  // 9) CLAUDE.md 每轮都进上下文，越大越贵（阈值按 ~4 字符/token 折算）
  if (claudeMdChars > 16000) {
    checks.push({ id: 'claude-md-bloat', severity: 'warn', params: { chars: claudeMdChars, tokens: Math.round(claudeMdChars / 4) }, penalty: 10 })
  } else if (claudeMdChars > 8000) {
    checks.push({ id: 'claude-md-bloat', severity: 'info', params: { chars: claudeMdChars, tokens: Math.round(claudeMdChars / 4) }, penalty: 5 })
  }

  // 10) allow 里放行了整个工具（如 Bash(*)）——等于对该工具关掉了确认
  if (wideOpenRules.length > 0) {
    checks.push({
      id: 'permissions-wide-open',
      severity: 'warn',
      params: { count: wideOpenRules.length, rules: wideOpenRules.join(', ') },
      penalty: 15,
    })
  }

  // 11) 进入危险模式的二次确认被关掉（是合法的高级用法，只作事实提示）
  if (effective.get('skipDangerousModePermissionPrompt') === true) {
    checks.push({ id: 'dangerous-skip-enabled', severity: 'info', params: {}, penalty: 5 })
  }

  checks.sort((a, b) => b.penalty - a.penalty)
  const score = Math.max(0, 100 - checks.reduce((s, c) => s + c.penalty, 0))
  return { score, checks, counts: { mcpServers, skills, commands, agents } }
}
