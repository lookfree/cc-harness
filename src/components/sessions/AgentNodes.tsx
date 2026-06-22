import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { compactNum, formatDuration } from './sessionStatus'
import type { TopoNodeData } from './agentTopologyLayout'
import type { AgentNode as AgentNodeT } from '@shared/types'

const STATUS_RING: Record<AgentNodeT['status'], string> = {
  running: 'border-blue-500 animate-pulse',
  done: 'border-emerald-500/60',
  error: 'border-red-500',
  unknown: 'border-border',
}

/** workflow 状态 → 角标色（status 是开放字符串，default 兜底）。 */
function wfStatusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-blue-500/15 text-blue-600'
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-600'
    case 'failed':
    case 'killed':
    case 'cancelled':
      return 'bg-red-500/15 text-red-600'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

const WorkflowNode = memo(({ data }: NodeProps<TopoNodeData>) => {
  const { t } = useTranslation('sessions')
  if (data.kind !== 'workflow') return null
  const wf = data.workflow
  return (
    <div className="w-[300px] rounded-lg border border-border bg-card shadow-sm px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm truncate">{wf.workflowName || wf.runId}</span>
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded', wfStatusColor(wf.status))}>{wf.status}</span>
      </div>
      {wf.scriptMeta?.description && (
        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{wf.scriptMeta.description}</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-1">
        <span>{t('topo.agentsOfDeclared', { actual: data.actualAgents, declared: wf.agentCount })}</span>
        {wf.durationMs != null && <span>{formatDuration(wf.durationMs)}</span>}
        {wf.totalTokens != null && <span>{t('tokens', { n: compactNum(wf.totalTokens) })}</span>}
        {wf.totalToolCalls != null && <span>{wf.totalToolCalls} {t('topo.tools')}</span>}
      </div>
      {wf.phases.length > 0 && (
        <div className="flex gap-1 mt-1.5">
          {wf.phases.map((p, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {p.title}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  )
})
WorkflowNode.displayName = 'WorkflowNode'

const AgentNodeCard = memo(({ data }: NodeProps<TopoNodeData>) => {
  const { t } = useTranslation('sessions')
  if (data.kind !== 'agent') return null
  const a = data.agent
  return (
    <div className={cn('w-[150px] rounded-md border-2 bg-card shadow-sm px-2 py-1.5 cursor-pointer', STATUS_RING[a.status])}>
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-medium truncate">{a.label}</span>
        {a.depth > 0 && <span className="text-[9px] text-muted-foreground shrink-0">{t('topo.depth', { n: a.depth })}</span>}
      </div>
      <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground mt-0.5">
        {a.durationMs != null && <span>{formatDuration(a.durationMs)}</span>}
        {a.tokens && <span>{t('tokens', { n: compactNum(a.tokens.totalTokens) })}</span>}
        {a.toolCalls != null && <span>{a.toolCalls} {t('topo.tools')}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  )
})
AgentNodeCard.displayName = 'AgentNodeCard'

export const topoNodeTypes = { workflow: WorkflowNode, agent: AgentNodeCard }
