import { promises as fs } from 'fs'
import path from 'path'
import { parseChunk } from './session-parser'
import { summarizeEvents } from '../../../shared/session-summary'
import type { AgentTopology, AgentNode, WorkflowRun, SessionEvent } from '../../../shared/types'

const AGENT_RE = /^agent-(.+)\.jsonl$/

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const numOpt = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

/**
 * 扫一个 session 的 workflows/ 与 subagents/ 子目录 + 主 jsonl 的 Task 调用，组装 agent 拓扑。
 * 入参是 session 主 jsonl 路径（SessionFileMeta.filePath）；子目录在 `<projDir>/<sessionId>/`。
 * 任一来源缺失/损坏都不抛错，退化为可得部分（验收：wf 缺失时退化为只读主会话 Task 树）。
 */
export async function buildAgentTopology(sessionFilePath: string, mainEvents?: SessionEvent[]): Promise<AgentTopology> {
  const projDir = path.dirname(sessionFilePath)
  const sessionId = path.basename(sessionFilePath, '.jsonl')
  const subdir = path.join(projDir, sessionId)

  const workflows = await readWorkflows(subdir, sessionId)
  const agentLists = await Promise.all(workflows.map((wf) => scanWorkflowAgents(subdir, wf.runId)))
  const agents = agentLists.flat()
  // mainEvents 已解析时直接用（spec017 usage() 已 snapshot 过，免二次读+解析主 jsonl）
  const taskTree = mainEvents ? taskTreeFromEvents(mainEvents) : await readMainTaskTree(sessionFilePath)
  // ORCH-11：普通 subagent 落盘文件（subagents/agent-*.jsonl，非 workflow）——
  // 对得上的节点就地充实 token/时长/文件路径，其内部再 spawn 的 Task 作为嵌套子节点挂上
  const nested = await plainSubagentNodes(subdir, taskTree)

  return { sessionId, workflows, agents, taskTree: [...taskTree, ...nested] }
}

/** 读 workflows/*.json → WorkflowRun[]（损坏文件跳过）。 */
async function readWorkflows(subdir: string, sessionId: string): Promise<WorkflowRun[]> {
  const dir = path.join(subdir, 'workflows')
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const out: WorkflowRun[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const fp = path.join(dir, f)
    try {
      const raw = JSON.parse(await fs.readFile(fp, 'utf8'))
      out.push(mapWorkflow(raw, fp, sessionId))
    } catch {
      /* 损坏的 wf json 跳过，不影响其它 */
    }
  }
  return out
}

function mapWorkflow(raw: Record<string, unknown>, filePath: string, sessionId: string): WorkflowRun {
  const phasesRaw = Array.isArray(raw.phases) ? (raw.phases as Array<Record<string, unknown>>) : []
  const progRaw = Array.isArray(raw.workflowProgress) ? (raw.workflowProgress as Array<Record<string, unknown>>) : []
  return {
    runId: str(raw.runId) ?? path.basename(filePath, '.json'),
    workflowName: str(raw.workflowName),
    status: str(raw.status) ?? 'unknown',
    agentCount: num(raw.agentCount),
    durationMs: numOpt(raw.durationMs),
    totalTokens: numOpt(raw.totalTokens),
    totalToolCalls: numOpt(raw.totalToolCalls),
    defaultModel: str(raw.defaultModel),
    phases: phasesRaw.map((p) => ({ title: String(p.title ?? ''), detail: str(p.detail) })),
    progress: progRaw.map((p) => ({ type: String(p.type ?? ''), index: numOpt(p.index), title: str(p.title) })),
    scriptMeta: parseScriptMeta(raw.script),
    error: str(raw.error),
    filePath,
    sessionId,
  }
}

/** 从 script 字符串轻量正则提取 meta.name/description（不 eval——那是任意代码，安全红线）。 */
function parseScriptMeta(script: unknown): { name?: string; description?: string } | undefined {
  if (typeof script !== 'string') return undefined
  const name = script.match(/name:\s*['"]([^'"]+)['"]/)?.[1]
  const description = script.match(/description:\s*['"]([^'"]+)['"]/)?.[1]
  return name || description ? { name, description } : undefined
}

/** 扫 subagents/workflows/wf_<id>/agent-*.jsonl + .meta.json → AgentNode[]。 */
async function scanWorkflowAgents(subdir: string, runId: string): Promise<AgentNode[]> {
  const dir = path.join(subdir, 'subagents', 'workflows', runId)
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const jsonls = files.filter((f) => AGENT_RE.test(f))
  const nodes = await Promise.all(jsonls.map((f) => buildAgentNode(dir, f, runId)))
  return nodes.filter((n): n is AgentNode => n !== null)
}

/** 单个 workflow agent：meta 取 agentType，jsonl 汇总 token/用时/工具数（复用 spec015 summarizer）。 */
async function buildAgentNode(dir: string, fileName: string, runId: string): Promise<AgentNode | null> {
  const agentId = fileName.match(AGENT_RE)![1]
  const fp = path.join(dir, fileName)
  let agentType: string | undefined
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, `agent-${agentId}.meta.json`), 'utf8'))
    agentType = str(meta.agentType)
  } catch {
    /* meta 缺失 → agentType 留空 */
  }
  let text: string
  try {
    text = await fs.readFile(fp, 'utf8')
  } catch {
    return null
  }
  const { events } = parseChunk(text, 0)
  const sum = summarizeEvents(events, { sessionId: agentId, filePath: fp, cwd: '', hasSubagents: false, mtimeMs: 0, nowMs: 0 })
  // 时间戳异常 → Date.parse 得 NaN，存 undefined 而非 NaN（别污染 IPC payload）
  const start = sum.startedAt ? Date.parse(sum.startedAt) : NaN
  const end = sum.lastActivityAt ? Date.parse(sum.lastActivityAt) : NaN
  const durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined
  return {
    agentId,
    agentType,
    label: agentType ?? 'agent',
    parentAgentId: null, // workflow 是扁平 fan-out；嵌套（ORCH-06）待有真实五层样本再补
    depth: 0,
    status: events.length ? 'done' : 'unknown',
    startedAt: sum.startedAt,
    durationMs,
    tokens: sum.totalTokens,
    toolCalls: sum.toolUseCount,
    workflowRunId: runId,
    filePath: fp,
  }
}

/** 读主 jsonl + 解析 → 普通 Task 子树（无预解析事件时走这条）。 */
async function readMainTaskTree(sessionFilePath: string): Promise<AgentNode[]> {
  let text: string
  try {
    text = await fs.readFile(sessionFilePath, 'utf8')
  } catch {
    return []
  }
  return taskTreeFromEvents(parseChunk(text, 0).events)
}

/** 从已解析的主会话事件抽普通 Task 调用（非 workflow）→ AgentNode（depth 0）。 */
function taskTreeFromEvents(events: SessionEvent[]): AgentNode[] {
  const done = new Set<string>()
  const errored = new Set<string>()
  for (const e of events) {
    if (e.kind === 'tool_result') {
      done.add(e.toolUseId)
      if (e.isError) errored.add(e.toolUseId)
    }
  }
  const out: AgentNode[] = []
  for (const e of events) {
    if (e.kind === 'tool_use' && e.toolName === 'Task') {
      out.push({
        agentId: e.toolUseId,
        agentType: e.subagentType,
        label: e.subagentType ?? 'Task',
        parentAgentId: null,
        depth: 0,
        status: errored.has(e.toolUseId) ? 'error' : done.has(e.toolUseId) ? 'done' : 'running',
        startedAt: e.timestamp,
        background: e.input.run_in_background === true || undefined,
      })
    }
  }
  return out
}

/**
 * 扫 <subdir>/subagents/agent-*.jsonl（顶层，不含 workflows/ 子目录）：
 * - agentId 能对上 taskTree 节点的，就地充实 token/工具数/时长/文件路径（供抽屉回放）；
 * - 对不上的补一个 depth 0 节点（落盘了但主 jsonl 没扫到 spawn 的场景）；
 * - 每个文件里再 spawn 的 Task → 嵌套子节点（parentAgentId=该 agent，depth+1，五层封顶，ORCH-06/11）。
 * 目录缺失/文件损坏一律退化为不动，不抛错。
 */
async function plainSubagentNodes(subdir: string, taskTree: AgentNode[]): Promise<AgentNode[]> {
  const dir = path.join(subdir, 'subagents')
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const byId = new Map(taskTree.map((n) => [n.agentId, n]))
  const extra: AgentNode[] = []
  for (const f of files) {
    const m = f.match(AGENT_RE)
    if (!m) continue
    const agentId = m[1]
    const fp = path.join(dir, f)
    let text: string
    try {
      text = await fs.readFile(fp, 'utf8')
    } catch {
      continue
    }
    const { events } = parseChunk(text, 0)
    const sum = summarizeEvents(events, { sessionId: agentId, filePath: fp, cwd: '', hasSubagents: false, mtimeMs: 0, nowMs: 0 })
    const start = sum.startedAt ? Date.parse(sum.startedAt) : NaN
    const end = sum.lastActivityAt ? Date.parse(sum.lastActivityAt) : NaN
    const durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined

    let node = byId.get(agentId)
    if (node) {
      node.tokens = sum.totalTokens
      node.toolCalls = sum.toolUseCount
      node.filePath = fp
      if (durationMs !== undefined) node.durationMs = durationMs
    } else {
      let agentType: string | undefined
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, `agent-${agentId}.meta.json`), 'utf8')) as Record<string, unknown>
        agentType = str(meta.agentType)
      } catch {
        /* meta 缺失 → agentType 留空 */
      }
      node = {
        agentId,
        agentType,
        label: agentType ?? 'agent',
        parentAgentId: null,
        depth: 0,
        status: events.length ? 'done' : 'unknown',
        startedAt: sum.startedAt,
        durationMs,
        tokens: sum.totalTokens,
        toolCalls: sum.toolUseCount,
        filePath: fp,
      }
      extra.push(node)
    }

    if (node.depth >= 5) continue // ORCH-06 五层护栏
    for (const child of taskTreeFromEvents(events)) {
      extra.push({ ...child, parentAgentId: agentId, depth: Math.min(node.depth + 1, 5) })
    }
  }
  return extra
}
