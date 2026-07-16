/**
 * 后台 agent / 活跃会话观测（ORCH-01/02/12、OBS-06）。
 * 数据源两条，均为 2.1.211 真机实测的落盘/输出契约：
 * 1. `claude agents --json --all`——官方脚本化出口（2.1.139 起），daemon 视角的权威 roster；
 * 2. `~/.claude/jobs/<short>/state.json` + `~/.claude/daemon/roster.json`——后台 job 的
 *    细节补充（classifier 标题、派活意图、重启次数、CLI 版本）。
 */

/** `claude agents --json` 的一行。status/state 是开放字符串，UI 分组务必带 default 兜底。 */
export interface CliAgentRow {
  /** background job 的 short id（如 'b7bd1518'）；interactive 会话无此字段 */
  id?: string
  /** interactive 会话的进程 pid */
  pid?: number
  kind: 'background' | 'interactive'
  cwd: string
  /** epoch ms */
  startedAt: number
  sessionId: string
  name: string
  /** background：running / failed / completed …（实测 'failed'） */
  state?: string
  /** interactive：idle / busy / waiting（实测三种） */
  status?: string
  /** OBS-06：在等什么（实测 'permission prompt'）——出现即该会话在等人 */
  waitingFor?: string
}

/** 后台 job 的落盘细节（jobs/<short>/state.json + daemon/roster.json 合并）。 */
export interface BgJobDetail {
  state?: string
  /** classifier 写的一句话进展标题（2.1.205 agent view headline 的落盘体） */
  detail?: string
  tempo?: string
  /** 派活时的原始意图（seed.intent） */
  intent?: string
  respawnFlags?: string[]
  createdAt?: string
  updatedAt?: string
  backend?: string
  /** roster.json worker.cliVersion——跑在哪个 CLI 版本上（自动升级观测点） */
  cliVersion?: string
  /** roster.json worker.attempt——第几次拉起（>1 说明 daemon 重启过它） */
  attempt?: number
}

export interface BgAgentItem extends CliAgentRow {
  job?: BgJobDetail
}

export interface BackgroundAgentsSnapshot {
  /** claude CLI 可用且 --json 成功返回 */
  available: boolean
  error?: string
  fetchedAt: number
  items: BgAgentItem[]
  /** daemon roster.json 的 updatedAt（daemon 活跃度参考） */
  rosterUpdatedAt?: number
}
