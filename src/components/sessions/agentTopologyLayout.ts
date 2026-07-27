import type { Node, Edge } from 'reactflow'
import type { CSSProperties } from 'react'
import type { AgentTopology, AgentNode, WorkflowRun } from '@shared/types'

export type TopoMode = 'workflow' | 'tree'

/** reactflow 节点 data 载荷（自定义节点渲染用）。 */
export interface WorkflowNodeData {
  kind: 'workflow'
  workflow: WorkflowRun
  actualAgents: number
}
export interface AgentNodeData {
  kind: 'agent'
  agent: AgentNode
}
export type TopoNodeData = WorkflowNodeData | AgentNodeData

const NODE_W = 150
const NODE_H = 64
const GAP_X = 24
const GAP_Y = 28
const COLS = 6 // 每行最多几个 agent
const WF_H = 84

/**
 * 节点入场动画标记：className 触发 CSS keyframes，--topo-delay 控制级联次序。
 * 外层 wrapper 只动 opacity（它的 transform 是 reactflow 定位用的，不能碰），
 * 内层（自定义节点根 div）做位移+缩放。仅新挂载的节点 DOM 播放一次。
 */
function enter(delayMs: number): Pick<Node, 'className' | 'style'> {
  return {
    className: 'topo-node-enter',
    style: { '--topo-delay': `${Math.min(delayMs, 2400)}ms` } as CSSProperties,
  }
}

/**
 * 拓扑 → reactflow nodes/edges（纯函数，便于布局逻辑独立演进）。
 * - workflow 模式：每个 workflow 一个头节点，其 agents 在下方网格 fan-out。
 * - tree 模式：按 depth 分层（y=depth 行），父→子边；扁平 workflow agents 挂在 workflow 根下。
 */
export function buildFlow(topology: AgentTopology, mode: TopoMode): { nodes: Node<TopoNodeData>[]; edges: Edge[] } {
  const nodes: Node<TopoNodeData>[] = []
  const edges: Edge[] = []
  let cursorY = 0

  topology.workflows.forEach((wf, wfIdx) => {
    const wfAgents = topology.agents.filter((a) => a.workflowRunId === wf.runId)
    const wfId = `wf:${wf.runId}`
    const rows = Math.max(1, Math.ceil(wfAgents.length / COLS))
    const gridW = COLS * (NODE_W + GAP_X)
    const baseDelay = wfIdx * 220

    nodes.push({
      id: wfId,
      type: 'workflow',
      position: { x: gridW / 2 - NODE_W, y: cursorY },
      data: { kind: 'workflow', workflow: wf, actualAgents: wfAgents.length },
      draggable: true,
      ...enter(baseDelay),
    })

    const agentsTop = cursorY + WF_H + GAP_Y
    // tree 模式按 depth 再下沉一层；workflow 模式纯网格（depth 不参与）
    const depthUnit = mode === 'tree' ? NODE_H + GAP_Y : 0
    wfAgents.forEach((a, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const depthOffset = a.depth * depthUnit
      // 节点 id 以 runId 命名空间化：避免与别的 workflow / 主会话 Task 树的 agentId 撞 id（reactflow 会静默丢节点）
      const nodeId = `agent:${wf.runId}:${a.agentId}`
      nodes.push({
        id: nodeId,
        type: 'agent',
        position: { x: col * (NODE_W + GAP_X), y: agentsTop + row * (NODE_H + GAP_Y) + depthOffset },
        data: { kind: 'agent', agent: a },
        draggable: true,
        ...enter(baseDelay + 180 + i * 45),
      })
      edges.push({ id: `e:${wfId}:${a.agentId}`, source: wfId, target: nodeId, animated: a.status === 'running' })
    })

    cursorY = agentsTop + rows * (NODE_H + GAP_Y) + 60
  })

  // 非 workflow 的普通 Task 子树（按 parentAgentId / depth 分层）
  if (topology.taskTree.length) {
    layoutTaskTree(topology.taskTree, cursorY, nodes, edges)
  }

  return { nodes, edges }
}

/** 普通 Task 子树：按 depth 分层（y=depth 行），父→子连边。 */
function layoutTaskTree(tree: AgentNode[], topY: number, nodes: Node<TopoNodeData>[], edges: Edge[]): void {
  const byDepth = new Map<number, AgentNode[]>()
  for (const a of tree) {
    const arr = byDepth.get(a.depth) ?? []
    arr.push(a)
    byDepth.set(a.depth, arr)
  }
  for (const [depth, arr] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    arr.forEach((a, i) => {
      // 主会话 Task 树用 'task:' 命名空间，与 workflow agent 节点隔离
      nodes.push({
        id: `task:${a.agentId}`,
        type: 'agent',
        position: { x: i * (NODE_W + GAP_X), y: topY + depth * (NODE_H + GAP_Y) },
        data: { kind: 'agent', agent: a },
        draggable: true,
        ...enter(depth * 150 + i * 60),
      })
      if (a.parentAgentId) {
        edges.push({ id: `e:task:${a.parentAgentId}:${a.agentId}`, source: `task:${a.parentAgentId}`, target: `task:${a.agentId}`, animated: a.status === 'running' })
      }
    })
  }
}
