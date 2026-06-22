# spec016 · Subagent 调用树与 Workflow 编排视图

- 对应功能 ID：ORCH-06 / ORCH-09
- 所属 Phase：P2
- 前置依赖：spec014（解析层）、spec015（监视器，复用其推流与 store）
- 工作量估计：L

## 目标

用 reactflow 画两张实时长出来的图：① **subagent 五层嵌套调用树**（Task 工具 spawn 的 agent，可再 spawn，2.1.172 起最多五层）；② **Workflow 编排拓扑**（2.1.154 的 Workflow 工具后台编排几十到上百 agent，确定性 loop/分支/fan-out）。每个节点显示 agent 名 / 用时 / token / 嵌套深度 / 所属 workflow 阶段。Workflow 跑几百 agent 时，这张图是用户唯一能看懂"它在干什么"的窗口——CLI 的 inline 进度条只能看计数。

## 现状（引用真实 file:line / 真实磁盘事实）

- `src/pages/Agents.tsx` 是配置占位页（演进路径"Agents 页是占位"），**完全没有运行时调用树**。
- `src/pages/Graph.tsx` **不是 reactflow**——实测它用 lucide 图标 + Card 自绘节点（`grep -rni reactflow src/` 全项目零命中）。reactflow 虽在 `package.json` deps 里，但**项目从未实际集成过**。所以本 spec 是 **reactflow 首次接入**，不是"复用"，工作量要含首次集成成本（布局、节点类型、live 增量 setNodes 的踩坑），不能假设"已验证可用"。可选：先补一个小任务把 Graph.tsx 迁到 reactflow 趟平，再做本 spec。
- **on-disk 数据源已核实**（本机 OpsBot 项目，`~/.claude/projects/-Users-wuhoujin-Documents-dev-opensource-OpsBot/67c384e2-…/`）：
  - **每个有 subagent 的 session 旁有子目录**：`<session-id>/subagents/workflows/wf_<id>/`，内含每个 agent 一对文件 `agent-<id>.jsonl`（该 agent 的完整 transcript，行带 `isSidechain:true` + `agentId`）+ `agent-<id>.meta.json`（实测内容 `{"agentType":"Explore"}`）。⚠️ **实际落盘的 agent jsonl 文件数 ≠ `wf_<id>.json` 里的 `agentCount`**——workflow 中途被 kill 时只落了一部分：本机 `wf_d32567f4-8ec` 的 `agentCount` 字段是 177，但目录里实际只有约 **52 个 agent-*.jsonl**。所以节点数以"实际扫到的 jsonl 文件数"为准，`agentCount` 只作头条声明值展示。
  - **workflow run 定义/进度在** `<session-id>/workflows/wf_<id>.json`，实测顶层键：`runId / timestamp / taskId / script / scriptPath / result / agentCount / logs / durationMs / error / summary / workflowName / status / startTime / phases / defaultModel / workflowProgress / totalTokens / totalToolCalls`。本机 `wf_d32567f4-8ec` 实测：`agentCount:177`、`durationMs:1766363`、`totalTokens:3274460`、`totalToolCalls:1018`、`status:'killed'`（注意是 `killed` 不是 `failed`——`status` 是开放字符串，枚举不全会导致 UI 状态映射 fallthrough）。
    - `phases`：实测 `[{title:'Audit',detail:'…'},{title:'Verify',…},{title:'Report',…}]`。
    - `workflowProgress`：实测条目 `{type:'workflow_phase', index:1, title:'Audit'}` 等（进度流水）。
    - `script`：workflow 的 JS 源码字符串（含 `export const meta = {name,description,phases}`）。
  - agent jsonl 首行实测：`{type:'user', isSidechain:true, sessionId, parentUuid:null, cwd, agentId, message:{role:'user', content:'You are a senior … auditor … YOUR DOMAIN: crypto-credentials …'}}`——即 agent 的 system/task prompt。
  - **普通（非 workflow）Task subagent**：主 jsonl 里以 `tool_use name:'Task'`（input 含 `subagent_type`）出现，结果在对应 `tool_result`。本机当前样本未见独立 Task 调用，但 spec014 已抽 `ToolUseEvent.subagentType`，按此关联。

> 关键结论：workflow 拓扑**不靠猜**——`wf_<id>.json` 直接给了 `agentCount/phases/status/durationMs/totalTokens`，`subagents/workflows/wf_<id>/` 目录给了每个 agent 的 jsonl + meta（agentType）。这是 ORCH-09 的权威本地契约。

## 改动方案

### 1. 拓扑数据结构（新增 `shared/types/agent-tree.ts`）

```ts
export interface AgentNode {
  agentId: string
  agentType?: string          // 来自 .meta.json {agentType}
  /** workflow agent 用 workflowName/phase；普通 Task 用 subagent_type */
  label: string
  parentAgentId: string | null  // 嵌套父；顶层 = null
  depth: number                 // 0=主会话直接 spawn，最多 5（ORCH-06）
  status: 'running' | 'done' | 'error' | 'unknown'
  startedAt?: string
  durationMs?: number
  tokens?: TokenUsageRollup     // 见 spec017，从该 agent jsonl 的 usage 汇总
  toolCalls?: number
  /** workflow 归属 */
  workflowRunId?: string
  workflowPhase?: string        // 'Audit' | 'Verify' | 'Report'
  filePath: string              // agent-<id>.jsonl 路径
}

export interface WorkflowRun {
  runId: string                 // 'wf_d32567f4-8ec'
  workflowName?: string
  status: string                // 开放字符串，实测值含 'running'|'completed'|'failed'|'killed'|'cancelled'——不要写成只含三值的联合类型，UI 状态映射要有 default 兜底
  agentCount: number            // 声明/目标 spawn 数（本机实测 177）；⚠️ 可能 ≠ 实际落盘的 agent-*.jsonl 文件数（workflow 中途 killed 时只落了一部分，实测某 wf 仅 52 个 jsonl），节点计数以实际扫到的 jsonl 为准、agentCount 只作头条展示
  durationMs?: number
  totalTokens?: number
  totalToolCalls?: number
  defaultModel?: string
  phases: Array<{ title: string; detail?: string }>
  progress: Array<{ type: string; index?: number; title?: string }>  // workflowProgress
  scriptMeta?: { name?: string; description?: string }  // 从 script 解析的 meta
  error?: string
  filePath: string
  sessionId: string
}

export interface AgentTopology {
  sessionId: string
  workflows: WorkflowRun[]
  agents: AgentNode[]
  /** 主会话里普通 Task 调用形成的非 workflow 子树（depth 嵌套） */
  taskTree: AgentNode[]
}
```

### 2. 后端：拓扑构建器（新增 `electron/services/session/agent-topology.ts`）

```ts
/** 扫一个 session 的 workflows/ 与 subagents/ 子目录 + 主 jsonl 的 Task 调用，组装拓扑 */
export async function buildAgentTopology(sessionDir: string, sessionId: string): Promise<AgentTopology>
```

构建逻辑：
- **Workflow 层**：读 `<sessionDir>/<sessionId>/workflows/*.json` 每个 → `WorkflowRun`（直接映射上面实测字段；`scriptMeta` 从 `script` 字符串里正则/轻量解析 `export const meta = {...}` 的 name/description，失败则留空）。
- **Workflow agents**：扫 `<sessionId>/subagents/workflows/wf_<id>/agent-*.jsonl` + 同名 `.meta.json` → 每个 `AgentNode`（`agentType` 取 meta，`tokens`/`toolCalls`/`durationMs` 由 spec014 解析该 agent jsonl 汇总：首/末事件 timestamp 差 = duration，usage 累加 = tokens）。`workflowRunId` = 目录的 `wf_<id>`，`workflowPhase` 尽力从 agent prompt / progress 时序对齐。
- **嵌套层（ORCH-06）**：agent jsonl 内若再出现 `tool_use name:'Task'` 或自身又有 sidechain 子目录，则 `parentAgentId` 指向上层，`depth` 递增（最多 5）。父子关系来源：agent jsonl 行的 `parentUuid` 链 + 目录层级。
- **普通 Task 子树**：主 jsonl 的 `ToolUseEvent`（`toolName==='Task'`）→ `AgentNode`（depth 0），其结果 tool_result 关联完成状态。

复用 spec015 的 tail：workflow 跑时 `wf_<id>.json` 与 agent jsonl 持续被写，监听其变化触发拓扑重建（增量：只重读变化的 agent 文件）。

### 3. IPC + 推流（扩 `electron/ipc/session.ts`）

```ts
ipcMain.handle('session:topology', (_e, sessionId, sessionDir) => buildAgentTopology(sessionDir, sessionId))
// 推流：workflow/agent 文件变化 → webContents.send('session:topology', { sessionId, topology })
```

preload 暴露 `getAgentTopology(sessionId, dir)` + `onTopology(cb)`。`src/lib/api.ts` 的 `session` 命名空间加 `topology` / `onTopology`。

### 4. 前端：调用树 + workflow 视图（新增 `src/pages/AgentTree.tsx`，或 Sessions 页加 Tab）

用 reactflow（首次接入，非复用——Graph.tsx 是自绘）：

- **视图切换**：`Subagent 树` / `Workflow 编排` 两个模式。
- **Subagent 树模式**：层次布局（dagre 或 reactflow 内置 + 自算 y=depth*行高），节点卡片显示 `label`（agentType/subagent_type）+ 用时 + token + `depth` 角标。running 节点脉冲边框，error 红边。边 = 父→子 spawn。深度超 5 给护栏提示（2.1.181 防无限嵌套）。
- **Workflow 编排模式**：
  - 顶部 workflow 头条：`workflowName` + `status` + `agentCount` + `durationMs` + `totalTokens`（直接来自 `wf_<id>.json`）。
  - **按 phase 分泳道**：`phases` 横向三列（Audit/Verify/Report），每个 agent 节点落到所属 phase 列，fan-out 的同 phase agent 纵向铺开。几百个 agent 时用聚合（同 phase 折叠成"N agents"可展开）。
  - 进度条：`workflowProgress` 时序驱动高亮当前 phase。
- **节点点击** → 侧抽屉显示该 agent 的 transcript（复用 spec015 回放组件，喂 agent jsonl 解析事件）。
- live：收到 `session:topology` push 即 diff 更新节点（新 agent 长出来、状态变色），reactflow 增量 setNodes/setEdges。

性能：几百节点用 reactflow `onlyRenderVisibleElements` + 聚合折叠；workflow 声明规模本机实测 `agentCount:177`（实际落盘 jsonl 约 52，killed 所致），按几百节点量级设计，聚合后默认显示 phase 摘要，展开才渲染叶子。

## 实现步骤

- [x] 1. `shared/types/agent-tree.ts`：`AgentNode` / `WorkflowRun` / `AgentTopology` / `AgentTopologyPush`。
- [x] 2. `electron/services/session/agent-topology.ts`：`buildAgentTopology`（扫 workflows/*.json + subagents/workflows/wf_*/agent-*.jsonl + 主 jsonl Task；每 agent 由其 jsonl 复用 `summarizeEvents` 汇总 token/用时/工具数；script 正则提 meta 不 eval）。
- [x] 3. `electron/ipc/session.ts`：`session:topology`（一次性）+ `session:topology:subscribe/unsubscribe`；`SessionMonitor` chokidar 监听 `<sessionId>/{workflows,subagents}` 去抖 300ms 重建并 `webContents.send('session:topology')`。
- [x] 4. preload + `src/lib/api.ts`：`getAgentTopology` / `subscribeTopology` / `onTopology`；`server/index.ts` 加 `GET /api/sessions/:id/topology`（Web 只读）。
- [x] 5. `src/components/sessions/`：`agentTopologyLayout.ts`（纯函数 topology→nodes/edges）+ `AgentNodes.tsx`（workflow/agent 自定义节点）+ `AgentTopologyView.tsx`（reactflow 首次接入，双模式、onlyRenderVisibleElements）。接 Sessions 第三 Tab。
- [x] 6. 节点点击 → 右侧抽屉，`snapshot(agentId, agentFilePath)` 取 agent jsonl 复用 `ConversationReplay` 渲染。
- [x] 7. i18n（sessions namespace tab.topology / topo.*，en/zh 对齐）。入口走 Sessions Tab，不另起侧栏页。

### 实际实现（与方案偏差，已落地）

- **phase 泳道未做（盘上无可靠归属信号）**：agent jsonl 无 phase 字段、`.meta.json` 仅 `{agentType}`、`workflowProgress` 无时间戳 → 无法把 agent 可靠归到 Audit/Verify/Report。故 `workflowPhase` 留空，phases 作进度标签条展示、agents 在 workflow 头节点下 fan-out 网格，不硬塞泳道。
- **嵌套（ORCH-06 五层）按设计实现但无真实样本**：本机 workflow 是扁平 fan-out（parentAgentId 全 null、depth 0）。tree 模式分层布局已写，待真实五层样本验证。
- **入口是 Sessions 第三 Tab** 而非独立页/侧栏（topology 本就 per-session）。
- **抽屉 transcript 为桌面端能力**（直读 agent jsonl 绝对路径；Web 的 id→filePath 反查不含 agent 文件，Web 下抽屉空，与"只读"一致）。
- **几百节点聚合折叠未做**：实测落盘最多 52 节点，reactflow + `onlyRenderVisibleElements` 流畅；真上几百再补。

## 验收标准

- [ ] 打开 OpsBot 那个 session 的 workflow 视图，显示 `wf_d32567f4-8ec`：workflowName、status（实测 `killed`，验收以 `wf_<id>.json` 实际值为准、不写死 failed）、agentCount=177、durationMs≈1766363、totalTokens≈3274460 与 `wf_<id>.json` 一致；树节点数以实际 agent-*.jsonl 文件数为准（可 < agentCount）。
- [ ] phases 显示三列 Audit / Verify / Report，各 phase 下能展开看到该阶段的 agent 节点。
- [ ] 每个 agent 节点显示 agentType（来自 `.meta.json`，如 Explore）+ 该 agent 的 token 与用时（由其 jsonl 汇总）。
- [ ] subagent 树模式下，嵌套 Task 的 agent 以父子边连接，depth 角标正确（≤5）。
- [ ] 点击一个 agent 节点，侧抽屉用回放组件正确渲染该 agent 的 prompt 与 transcript（首行 system/task prompt 可见）。
- [ ] 真跑（或模拟追加）一个 workflow 时，新 agent 节点实时长出、status 变色（验证 topology 推流）。
- [ ] 数十到上百节点的 workflow（本机实测约 52 个落盘 jsonl）默认以 phase 聚合显示不卡顿，展开后才渲染叶子节点。
- [ ] `wf_<id>.json` 缺失或损坏时拓扑构建不抛错，退化为只读主会话 Task 树。

## 风险与备注

- **目录契约基于本机 2.1.x 实测**（`subagents/workflows/wf_<id>/agent-<id>.jsonl` + `.meta.json` + `workflows/wf_<id>.json`）。不同版本路径可能变（早期 subagent 可能内联在主 jsonl）。构建器要同时支持"内联 Task tool_use"与"独立 agent jsonl"两种来源，二选一存在即用。
- **`.meta.json` 当前实测只有 `{agentType}`**，字段少。用时/token 只能由 agent jsonl 自行汇总，不依赖 meta。
- **workflowPhase 与 agent 的精确归属**：`wf_<id>.json` 的 `workflowProgress` 是 phase 时序流水，但每个 agent 属哪个 phase 需用 spawn 时间落在哪个 phase 区间来对齐，或从 agent prompt 文本推断（实测 prompt 含 "YOUR DOMAIN: …"）。这是启发式，标注"阶段归属为推断"。
- **嵌套深度来源**：本机样本是 workflow（扁平 fan-out），五层嵌套的真实样本暂缺。深度计算逻辑（parentUuid 链 + 目录层级）需待有真实五层样本时验证；先按设计实现，验收用构造样本。
- **几百 agent 的 reactflow 性能**：必须聚合 + 虚拟化，否则一次 setNodes 几百个会掉帧。
- `script` 解析 meta 用轻量正则即可，**不要 eval workflow JS**（安全：那是任意代码）。
