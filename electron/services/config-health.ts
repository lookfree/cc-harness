import type { ConfigHealth, HealthCheck } from '../../shared/types'

export interface ConfigHealthInput {
  /** settings 合并视图的点号路径 → 值（settings-writer 已把一层嵌套摊平，故含 env.XXX） */
  effective: Map<string, unknown>
  mcpServers: number
  skills: number
  commands: number
  agents: number
}

/**
 * 配置面体检（spec028，纯函数不碰 fs）。
 * 阈值来自 ECC 经验法则（MCP>10 吃 context、工具面>80 判断力下降），不是官方契约——UI 须标注"经验阈值"。
 */
export function computeConfigHealth(input: ConfigHealthInput): ConfigHealth {
  const { effective, mcpServers, skills, commands, agents } = input
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

  checks.sort((a, b) => b.penalty - a.penalty)
  const score = Math.max(0, 100 - checks.reduce((s, c) => s + c.penalty, 0))
  return { score, checks, counts: { mcpServers, skills, commands, agents } }
}
