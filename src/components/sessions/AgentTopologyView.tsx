import 'reactflow/dist/style.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type ReactFlowInstance,
} from 'reactflow'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import type { AgentTopology, AgentNode, SessionEvent } from '@shared/types'
import { buildFlow, type TopoMode, type TopoNodeData } from './agentTopologyLayout'
import { topoNodeTypes } from './AgentNodes'
import { ConversationReplay } from './ConversationReplay'

interface Props {
  sessionId: string
  sessionFilePath: string
}

export function AgentTopologyView({ sessionId, sessionFilePath }: Props) {
  const { t } = useTranslation('sessions')
  const [topology, setTopology] = useState<AgentTopology | null>(null)
  const [mode, setMode] = useState<TopoMode>('workflow')
  const [drawerAgent, setDrawerAgent] = useState<AgentNode | null>(null)
  const [drawerEvents, setDrawerEvents] = useState<SessionEvent[]>([])

  const [nodes, setNodes, onNodesChange] = useNodesState<TopoNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const flowRef = useRef<ReactFlowInstance | null>(null)

  // 加载 + 订阅拓扑（workflow/agent 文件变化实时重建）
  useEffect(() => {
    let alive = true
    api.session.topology(sessionId, sessionFilePath).then((topo) => alive && setTopology(topo))
    void api.session.subscribeTopology(sessionId, sessionFilePath)
    const unbind = api.session.onTopology((p) => {
      if (p.sessionId === sessionId) setTopology(p.topology)
    })
    return () => {
      alive = false
      unbind()
      void api.session.unsubscribeTopology(sessionId)
    }
  }, [sessionId, sessionFilePath])

  // 拓扑/模式变化 → 重算节点
  useEffect(() => {
    if (!topology) return
    const flow = buildFlow(topology, mode)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    // 拓扑是异步到的，<ReactFlow fitView> 只在初次渲染跑（那时 nodes 还空）→ 节点会落在视口外。
    // 等两帧让新节点完成布局测量，再手动 fit 一次。
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.15, duration: 600 }))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [topology, mode, setNodes, setEdges])

  const onNodeClick = useCallback((_e: React.MouseEvent, node: Node<TopoNodeData>) => {
    if (node.data.kind !== 'agent' || !node.data.agent.filePath) return
    const agent = node.data.agent
    setDrawerAgent(agent)
    setDrawerEvents([])
    api.session.snapshot(agent.agentId, agent.filePath!).then(setDrawerEvents)
  }, [])

  if (topology && topology.workflows.length === 0 && topology.taskTree.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">{t('topo.empty')}</div>
  }

  return (
    <div className="relative h-full">
      {/* 模式切换 */}
      <div className="absolute top-2 left-2 z-10 flex gap-1 bg-card/90 backdrop-blur rounded border border-border p-0.5">
        {(['workflow', 'tree'] as TopoMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              'px-2 py-0.5 rounded text-xs',
              mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(`topo.mode.${m}`)}
          </button>
        ))}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={topoNodeTypes}
        onInit={(inst) => (flowRef.current = inst)}
        onNodeClick={onNodeClick}
        onlyRenderVisibleElements
        fitView
        fitViewOptions={{ padding: 0.15, duration: 600 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* 节点抽屉：该 agent 的 transcript（复用回放组件） */}
      {drawerAgent && (
        <div className="absolute top-0 right-0 h-full w-[420px] bg-card border-l border-border shadow-xl flex flex-col z-20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{drawerAgent.label}</div>
              <div className="text-[11px] text-muted-foreground truncate">{drawerAgent.agentId}</div>
            </div>
            <button onClick={() => setDrawerAgent(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <ConversationReplay events={drawerEvents} />
          </div>
        </div>
      )}
    </div>
  )
}
