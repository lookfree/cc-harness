import type { TokenUsageRollup } from './session'

/** 一个 subagent / workflow agent 节点（ORCH-06 嵌套树 / ORCH-09 workflow fan-out）。 */
export interface AgentNode {
  agentId: string
  /** 来自 <agent>.meta.json 的 {agentType}（如 'Explore'）；普通 Task 用 subagent_type */
  agentType?: string
  /** 节点展示名：agentType / subagent_type / workflowPhase 之一 */
  label: string
  /** 嵌套父 agentId；顶层（主会话直接 spawn）= null */
  parentAgentId: string | null
  /** 0=主会话直接 spawn，最多 5（ORCH-06 五层护栏） */
  depth: number
  status: 'running' | 'done' | 'error' | 'unknown'
  startedAt?: string
  durationMs?: number
  /** 由该 agent jsonl 的 usage 汇总（spec014 解析） */
  tokens?: TokenUsageRollup
  toolCalls?: number
  /** workflow 归属（普通 Task 子树为空） */
  workflowRunId?: string
  /** 'Audit' | 'Verify' | 'Report' 等；归属为推断（见 spec016 风险节） */
  workflowPhase?: string
  /** agent-<id>.jsonl 路径（点击抽屉回放用）；普通内联 Task 无独立文件则空 */
  filePath?: string
  /** Task 输入带 run_in_background: true（2.1.198 起后台为默认，此标记为显式请求） */
  background?: boolean
  /** workflow journal.jsonl 里该 agent 的真实返回值预览（截断；2.1.208 起 journal 为 resume 权威源） */
  resultPreview?: string
}

/**
 * 一次 Workflow run（来自 workflows/wf_<id>.json，ORCH-09 权威本地契约）。
 * status 是开放字符串（实测含 running/completed/failed/killed/cancelled）——UI 映射务必有 default 兜底。
 */
export interface WorkflowRun {
  runId: string
  workflowName?: string
  status: string
  /** 声明/目标 spawn 数（实测 177）；⚠ 可能 ≠ 实际落盘 agent-*.jsonl 数（killed 截断，实测仅 52），节点计数以实扫为准 */
  agentCount: number
  durationMs?: number
  totalTokens?: number
  totalToolCalls?: number
  defaultModel?: string
  phases: Array<{ title: string; detail?: string }>
  /** workflowProgress 时序流水 */
  progress: Array<{ type: string; index?: number; title?: string }>
  /** 从 script 字符串轻量解析的 meta（不 eval） */
  scriptMeta?: { name?: string; description?: string }
  error?: string
  filePath: string
  sessionId: string
  /** journal.jsonl 统计（实测契约：type=started/result 两种行）；缺 journal 时为空 */
  journalStarted?: number
  journalResults?: number
}

/** 一个 session 的完整 agent 拓扑（workflow + 嵌套 Task 树）。 */
export interface AgentTopology {
  sessionId: string
  workflows: WorkflowRun[]
  /** 所有 workflow agents（带 workflowRunId） */
  agents: AgentNode[]
  /** 主会话里普通 Task 调用形成的非 workflow 子树（depth 嵌套） */
  taskTree: AgentNode[]
}

/** 主→渲染推流 payload（session:topology channel，workflow/agent 文件变化时重建推送）。 */
export interface AgentTopologyPush {
  sessionId: string
  topology: AgentTopology
}
