import { promises as fs } from 'fs'
import path from 'path'
import { parseChunk } from './session-parser'
import { summarizeEvents } from '../../../shared/session-summary'
import type { AgentTopology, AgentNode, WorkflowRun } from '../../../shared/types'

const AGENT_RE = /^agent-(.+)\.jsonl$/

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
const numOpt = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

/**
 * 扫一个 session 的 workflows/ 与 subagents/ 子目录 + 主 jsonl 的 Task 调用，组装 agent 拓扑。
 * 入参是 session 主 jsonl 路径（SessionFileMeta.filePath）；子目录在 `<projDir>/<sessionId>/`。
 * 任一来源缺失/损坏都不抛错，退化为可得部分（验收：wf 缺失时退化为只读主会话 Task 树）。
 */
export async function buildAgentTopology(sessionFilePath: string): Promise<AgentTopology> {
  const projDir = path.dirname(sessionFilePath)
  const sessionId = path.basename(sessionFilePath, '.jsonl')
  const subdir = path.join(projDir, sessionId)

  const workflows = await readWorkflows(subdir, sessionId)
  const agentLists = await Promise.all(workflows.map((wf) => scanWorkflowAgents(subdir, wf.runId)))
  const agents = agentLists.flat()
  const taskTree = await readMainTaskTree(sessionFilePath)

  return { sessionId, workflows, agents, taskTree }
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

/** 主 jsonl 里的普通 Task 调用（非 workflow）→ AgentNode（depth 0）。 */
async function readMainTaskTree(sessionFilePath: string): Promise<AgentNode[]> {
  let text: string
  try {
    text = await fs.readFile(sessionFilePath, 'utf8')
  } catch {
    return []
  }
  const { events } = parseChunk(text, 0)
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
      })
    }
  }
  return out
}
