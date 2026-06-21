# spec015 · Session 监视器

- 对应功能 ID：ORCH-01 / ORCH-02 / ORCH-04 / ORCH-05 / OBS-06
- 所属 Phase：P2
- 前置依赖：spec014（session-jsonl 解析层）
- 工作量估计：L

## 目标

做项目最大差异化点的第一块：一个 **Live 会话监视器**。左侧是所有 session 列表（按活跃度排序，含 running/blocked/completed 状态、`waitingFor`），中间是选中 session 的**对话回放 + 时间线双视图**，并支持**多 session 横向比对**（同屏并列两三个 session 的时间线）。数据走 spec014 解析 + chokidar tail，主进程通过 IPC **push** 增量事件到渲染进程，UI 实时长出来。Web 模式降级为只读快照。

目前没有任何第三方面板能把多 session 横向比对，这是发力点。

## 现状（引用真实 file:line）

- **项目完全没有 session 监视能力**。九个页面（`src/pages/`）全是静态配置浏览，无 `~/.claude/projects/` 相关页面。
- IPC 全是 `invoke`（请求/响应）模式，唯一的 push 通道是 `api.onFilesChanged`（`src/lib/api.ts:478`）→ `window.electronAPI.onFilesChanged`，由 `file-manager.ts:113` 的 chokidar change 触发。**没有"主进程主动持续推流"的范式**，本 spec 要建立它。
- `claude` CLI 不在本机 PATH（演进路径已实测），所以 `claude agents --json` 仅作可选增强；**主路径是直接读 jsonl + listSessions（spec014）**。
- reactflow / recharts 已在 `package.json` deps，但**项目尚未实际使用**（`Graph.tsx` 是 lucide 自绘，非 reactflow——见 spec016 修正）。本页主要用列表 + 时间线，不需要 reactflow；拓扑图留给 spec016（那里是 reactflow 首次接入）。

## 改动方案

### 1. 会话状态推断（无 CLI 时的主路径）

`claude agents --json` 给的 `running/blocked/completed` + `waitingFor`（OBS-06）本机拿不到（CLI 缺失），所以从 jsonl + 文件状态**推断**：

```ts
// shared/types/session.ts 追加
export type SessionLiveStatus = 'active' | 'idle' | 'waiting' | 'completed' | 'unknown'
export interface SessionSummary {
  sessionId: string
  cwd: string
  filePath: string
  title?: string            // 来自 ai-title 事件（最后一条）
  lastModelUsed?: string
  status: SessionLiveStatus
  /** 推断的"在等什么"：最后一条若是 tool_use 且无对应 tool_result → 工具名/权限 */
  waitingFor?: string
  turnCount: number
  toolUseCount: number
  totalTokens: TokenUsageRollup   // 见 spec017
  startedAt?: string
  lastActivityAt: string          // = mtime 或最后事件 timestamp
  hasSubagents: boolean
  /** 是否被 pin（Ctrl+T pinned session，ORCH-05）——数据源待确认，见风险 */
  pinned?: boolean
}
```

状态推断规则（诚实标注：这是启发式，非 CLI 权威）：
- `mtime` 在最近 N 秒内（默认 30s）且最后事件是 assistant/tool → `active`。
- 最后事件是 `tool_use` 且无匹配 `tool_result`，或最后是 `user_turn`（等模型）→ `waiting`，`waitingFor` = 该 tool_use 的 `toolName`（如等 `Bash` 权限）。
- mtime 久未变 + 最后事件 `stopReason==='end_turn'` → `idle`。
- 文件含 session 结束标记（`type:'system'` 退出 / SessionEnd）→ `completed`。
- 无法判断 → `unknown`。

### 2. 后端：SessionMonitor 服务 + IPC 推流（新增 `electron/services/session/session-monitor.ts`）

封装 spec014 的 `SessionTailer` + `listSessions`，对外是"订阅式"接口：

```ts
export class SessionMonitor {
  constructor(private win: () => BrowserWindow | null) {}
  /** 列出所有 session 概要（轮询 + 监听 projects 目录新增） */
  async list(): Promise<SessionSummary[]>
  /** 订阅某 session 的增量事件，主进程开始 tail，并 push 到渲染进程 */
  subscribe(sessionId: string, filePath: string): void
  unsubscribe(sessionId: string): void
  /** 取一个 session 的全量已解析事件（首屏快照） */
  async snapshot(sessionId: string, filePath: string): Promise<SessionEvent[]>
}
```

推流通道（建立新范式，复用 preload 现有 `onFilesChanged` 写法）：
- 新增 IPC 事件 channel：`session:events`（主→渲染，`win.webContents.send`），payload `{ sessionId, events: SessionEvent[], initial: boolean }`。
- 新增 `session:status`（主→渲染）：某 session 状态变化时 push `SessionSummary`。
- `SessionTailer` 的 `'events'` 监听里 `webContents.send('session:events', …)`。

IPC handlers（新增 `electron/ipc/session.ts`，在 `electron/ipc/index.ts:14` 的 `registerIPCHandlers` 注册）：

```ts
ipcMain.handle('session:list', () => monitor.list())
ipcMain.handle('session:snapshot', (_e, id, fp) => monitor.snapshot(id, fp))
ipcMain.handle('session:subscribe', (_e, id, fp) => { monitor.subscribe(id, fp); return true })
ipcMain.handle('session:unsubscribe', (_e, id) => { monitor.unsubscribe(id); return true })
```

preload（`electron/preload.cjs` / `preload.ts`）暴露：`getSessions` / `getSessionSnapshot` / `subscribeSession` / `unsubscribeSession` / `onSessionEvents(cb)` / `onSessionStatus(cb)`（后两者用 `ipcRenderer.on`，参照现有 `onFilesChanged`）。

### 3. 前端 API（`src/lib/api.ts`，仿 `hooks` 命名空间）

```ts
session: {
  list: () => isElectron ? window.electronAPI.getSessions() : httpGet('/api/sessions'),
  snapshot: (id, fp) => isElectron ? window.electronAPI.getSessionSnapshot(id, fp)
                                   : httpGet(`/api/sessions/${id}`),  // web: 一次性快照
  subscribe: (id, fp) => isElectron ? window.electronAPI.subscribeSession(id, fp) : warnWeb(),
  unsubscribe: (id) => isElectron ? window.electronAPI.unsubscribeSession(id) : undefined,
  onEvents: (cb) => isElectron ? window.electronAPI.onSessionEvents(cb) : warnWeb(),
  onStatus: (cb) => isElectron ? window.electronAPI.onSessionStatus(cb) : warnWeb(),
}
```

Web 模式（`server/index.ts`）：只加 `GET /api/sessions`（list）+ `GET /api/sessions/:id`（snapshot），**无推流**——演进路径定调"Web 模式保持只读浏览"。

### 4. 前端页面（新增 `src/pages/Sessions.tsx` + 路由）

布局（参考 `src/pages/Skills.tsx` 的左列表/右详情骨架）：

- **左栏 · Session 列表**：每项 = 状态点（绿=active / 黄=waiting / 灰=idle/completed）+ title（ai-title）+ cwd 短名 + 最近活跃相对时间 + token 小计 + subagent 角标。顶部过滤：状态、cwd、搜索。pinned 置顶。
- **中栏 · 双视图 Tab**（选中 session）：
  - **对话回放**：按 turn 时序渲染 user→assistant→tool_use/tool_result 卡片。assistant 显示 model + thinking 折叠（只标存在/字数）+ text。tool_use 显示工具名 + input 摘要；tool_result 折叠 content（error 红标）。新事件到达自动追加并滚到底（可锁定）。
  - **时间线**：横向时间轴，每个事件一个刻度点（按 kind 上色），悬浮看摘要、点击跳到回放对应卡片。tool_use→tool_result 用连线表"用了多久"。
- **多 session 比对**：列表项支持多选（≤3），中栏切"比对模式"并列各 session 时间线，共享时间轴对齐，直观看谁先谁后、谁卡住。
- **Live 指示**：订阅中显示脉冲点；收到 `session:events` 增量 push 即更新（Zustand store 存 `Map<sessionId, SessionEvent[]>`）。

状态管理：新增 `src/stores/sessionStore.ts`（Zustand），存 `summaries`、`eventsBySession`、`selectedIds`、`subscribedIds`；`onEvents`/`onStatus` 回调里 merge（按 `seq` 去重）。

### 5. CLI 增强（可选，不阻塞）

若检测到 `claude` 在 PATH：`session:list` 额外跑 `claude agents --json`（2.1.162 起含 `waitingFor`）合并进 `SessionSummary.status/waitingFor`，权威覆盖启发式。检测失败静默回落到 jsonl 推断。

## 实现步骤

- [x] 1. `shared/types/session.ts`：加 `SessionLiveStatus` / `SessionSummary` / `TokenUsageRollup` / `SessionEventsPush`。
- [x] 2. `electron/services/session/session-monitor.ts`：`SessionMonitor`（list/snapshot/subscribe）。状态推断抽到 `shared/session-summary.ts` 的纯函数 `summarizeEvents`，前后端共用（单一真相源）。
- [x] 3. `electron/ipc/session.ts`：4 个 handler；`main.ts` 实例化 `SessionMonitor(() => mainWindow)` 并 `registerSessionHandlers`（注：原 `files:changed` push 其实从未接线，本 spec 才真正建立推流范式）。
- [x] 4. `electron/preload.cjs` + `preload.ts`：暴露 getSessions/getSessionSnapshot/subscribeSession/unsubscribeSession/onSessionEvents（返回取消监听句柄）。
- [x] 5. `src/lib/api.ts`：`session` 命名空间。
- [x] 6. `server/index.ts`：`GET /api/sessions` + `GET /api/sessions/:id`（只读快照，Web 端按 id 反查 filePath）。
- [x] 7. `src/stores/sessionStore.ts`：Zustand store + push 按 `seq` 去重合并 + `summarizeEvents` 重算 live 状态。
- [x] 8. `src/pages/Sessions.tsx` + `src/components/sessions/{SessionList,ConversationReplay,SessionTimeline,sessionStatus}`：左列表 / 双视图 Tab / 多选比对；接路由与侧栏。
- [ ] 9. （可选，未做）CLI 探测增强 `claude agents --json`——`claude` 不在 PATH，留待后续。
- [x] 10. i18n：`src/i18n/locales/{en,zh}/sessions.json` + 注册 + layout nav 标签。

### 实际实现（与方案的偏差，已落地）

- **不另起 `session:status` channel**：状态由客户端从累积事件经 `summarizeEvents`（shared 纯函数）派生，与后端 `list()` 同一套逻辑 → 单一真相源、单推流通道、无死 API。`onSessionStatus` 因此未暴露。
- **桌面端首屏不单独调 `snapshot`**：订阅时 `SessionTailer` 的 initial 全量 push（`initial:true`）即灌满首屏；`snapshot()` 仅 Web 用 + 作显式 API。两路 `seq` 一致，store 按 seq 去重，重复也无害。
- **`pinned`（ORCH-05）/ bg（ORCH-04）留空不展示**——本地无稳定文件契约，避免编造（见风险节）。
- **`list()` 全量解析每个文件**算概要：实测本机 40 个 session（含 35MB 大会话）≈ 488ms，可接受；后续大规模再加 mtime 缓存。

## 验收标准

- [ ] 打开 Sessions 页，左栏列出本机 ≥14 个 session，按最近活跃排序，OpsBot 会话带 subagent 角标。
- [ ] 选中一个 session，对话回放按时序正确渲染 user/assistant/tool_use/tool_result，model 与 token 正确显示。
- [ ] 在外部对某 session jsonl 追加几行（或真跑一个 Claude Code 会话），监视器**无需刷新**自动追加新卡片并滚动（验证 push 链路）。
- [ ] 时间线视图点击某刻度 → 回放滚到对应卡片；tool_use 与其 tool_result 在时间线上有连线。
- [ ] 多选 2 个 session 进比对模式，两条时间线共享时间轴对齐显示。
- [ ] 最后一条是未完成 tool_use 的 session 状态显示 `waiting`，`waitingFor` 显示工具名。
- [ ] Web 模式 `GET /api/sessions` 返回列表、`/api/sessions/:id` 返回快照；订阅相关 API 在 web 下打 warn 不报错。
- [ ] 关闭 session 订阅后主进程停止该文件 tail（DevTools 验证不再收到该 id 的 `session:events`）。

## 风险与备注

- **状态推断是启发式**，非权威。CLI 可用时以 `claude agents --json` 覆盖；不可用时 UI 要标注"状态为推断值"。`pinned`（ORCH-05）/ `bg`（ORCH-04）目前**无稳定本地文件契约**——探测方案：观察会话期间 `~/.claude.json` 的 `projects.<path>` 子键、或 `~/.claude/projects/<cwd>/` 下是否出现 pin/bg 标记文件；未确认前 `pinned`/bg 字段留空、UI 不展示，避免编造。
- **推流性能**：大会话首次 snapshot 上千事件，一次性传 IPC 可能卡顿。snapshot 分页或首屏只传最近 N 条 + 懒加载历史。增量 push 天然小批量，无压力。
- **多 session 同时订阅** = 多个 chokidar watcher + tail，注意 unsubscribe 时彻底 close，防句柄泄漏（SessionTailer 已有 `unwatch`）。
- **时间戳缺失的元事件**：部分 meta 行无 timestamp（spec014 已知），时间线对这些点用相邻事件时间兜位，并标注"近似"。
- ORCH-01（agent view dashboard）的"全局汇总"形态本 spec 用 session 列表承接；若后续 CLI 暴露更丰富的 dashboard 数据，再扩。
