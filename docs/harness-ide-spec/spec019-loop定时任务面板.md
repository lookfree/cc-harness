# spec019 · loop 定时任务面板

- 对应功能 ID：ORCH-08
- 所属 Phase：P2
- 前置依赖：spec014（解析层）、spec015（监视器，复用 session 列表与推流）
- 工作量估计：M

## 目标

把分散在各 session 的 `/loop` 定时任务（2.1.71，session 级 cron，自然语言转 cron，轮询/提醒/盯 PR，3 天过期、不并发）汇总成一个**调度面板**：每个 loop 跑在哪个 session、cron 表达式、下次触发、还剩几次/还剩几天、上次执行结果，并支持**取消**。配合后台会话状态，把"Claude Code 在后台替我盯着的事"可视化。

`/loop` 的本地存储契约**待确认**——本 spec 以"探测 + jsonl 解析"为主，给出明确探测方案，不假装有现成 API。

## 现状（引用真实 file:line / 真实磁盘探测）

- **项目完全没有 loop 概念**。无相关页面、类型、IPC。
- **数据源探测结果（本机实测）**：
  - `~/.claude/` 下 **未发现** `loop` / `cron` / `schedule` 命名的文件或目录（`ls ~/.claude | grep -iE 'loop|cron|schedul'` 为空）。
  - `~/.claude/settings.json` 无 loop 相关键。
  - `~/.claude.json`（大配置）顶层键已列出（`numStartups/projects/skillUsage/…`），**无 loop 顶层键**；但 `projects` 是按项目路径的子对象，loop 可能藏在 `projects.<path>` 子键下——本机当前无活跃 loop，未能取到正样本。
  - 主 jsonl 里 `/loop` 作为 slash command 会以 `user_turn`（text 以 `/loop` 开头）+ 后续 `system`/`queue-operation` 事件出现（实测有 `queue-operation` 类型 412 条，疑似与排队/调度相关，**待坐实**）。
- **结论（诚实标注）**：`/loop` 没有已确认的稳定本地文件契约。本 spec 给三条探测路径（见下），实现时先跑探测确定真相源，再落地解析。CLI 不在 PATH，`claude` 子命令暂不可用作主路径。

## 改动方案

### 1. loop 任务类型（新增 `shared/types/loop.ts`）

```ts
export interface LoopTask {
  id: string                    // loop 唯一标识（来源依探测确定）
  sessionId: string
  cwd: string
  /** 自然语言原始描述（用户 /loop 后跟的话） */
  description: string
  /** 转出的 cron 表达式（若能取到） */
  cron?: string
  /** 解释后的下次触发时间 */
  nextRunAt?: string
  /** 间隔（若是简单 interval 而非 cron），如 '5m' */
  interval?: string
  status: 'active' | 'expired' | 'cancelled' | 'unknown'
  createdAt?: string
  /** 3 天过期：到期时间 */
  expiresAt?: string
  /** 剩余可执行次数（若有上限） */
  remainingRuns?: number
  lastRunAt?: string
  lastRunOutcome?: string
  /** 数据从哪条路径解析出来的，便于排查 */
  source: 'claude-json' | 'jsonl' | 'cli' | 'unknown'
}
```

### 2. 后端：loop 发现器（新增 `electron/services/loop/loop-discovery.ts`）

```ts
/** 聚合所有 session 的 loop 任务。内部按优先级尝试三条数据源 */
export async function discoverLoops(): Promise<LoopTask[]>
/** 取消一个 loop（依真相源不同：改 claude.json / 写标记 / CLI 命令） */
export async function cancelLoop(task: LoopTask): Promise<{ ok: boolean; message: string }>
```

**三条探测路径（按可靠性排序，实现时先验证哪条成立）**：

1. **`~/.claude.json` 的 `projects.<path>` 子键**（优先）：解析每个 project 下是否有 loop/schedule 子结构。实现前先在有活跃 loop 的环境 diff `~/.claude.json`（创建 loop 前后），定位键名后写解析。
2. **jsonl 解析**（spec014 复用）：扫每个 session 的 `/loop` user_turn + 相邻 `queue-operation`/`system` 事件，重建 loop 创建意图与状态。能拿到 description、createdAt，但 nextRun/remaining 可能不全。
3. **CLI 增强**（可选）：若 `claude` 在 PATH 且存在 loop 列举子命令，跑它取权威列表。当前 CLI 缺失，作未来增强。

发现器策略：三条都试，能拿到的字段 merge，`source` 标注来源；都拿不到时返回空 + UI 提示"未发现 loop（或数据源未坐实）"。

取消：依坐实的真相源——若是 `~/.claude.json` 子键则改写该文件移除条目（先备份）；若只能从 jsonl 观测（只读）则**不提供取消**，UI 灰化取消按钮并说明"当前数据源只读，无法取消，请在对应会话内 /loop 取消"。**不臆造写入路径**。

### 3. IPC（新增 `electron/ipc/loop.ts`，在 `electron/ipc/index.ts` 注册）

```ts
ipcMain.handle('loop:list', () => discoverLoops())
ipcMain.handle('loop:cancel', (_e, task) => cancelLoop(task))
```

preload + `src/lib/api.ts` 加 `loop` 命名空间。Web 模式：`GET /api/loops`（只读列表），取消桌面端独占。

### 4. 前端面板（新增 `src/pages/Loops.tsx`）

- **任务表**：每行 = description + 所属 session（链到 spec015）+ cron/interval + 下次触发倒计时 + 剩余次数/剩余天数（3 天过期进度条）+ status 徽章 + 上次结果 + 取消按钮。
- **过滤**：status（active/expired）、cwd。
- **空态**：明确文案"未发现 /loop 任务"+ 一句"数据源说明"（标注探测状态）。
- live：复用 spec015 推流，loop 相关文件变化时刷新。
- 取消：确认对话框；只读数据源时取消按钮禁用 + tooltip 解释。

## 实现步骤

- [x] 0. **先探测**：实测结论见"风险与备注"末尾追加。真相源 = session jsonl 中 `ScheduleWakeup` tool_use；无专用文件。
- [x] 1. `shared/types/loop.ts`：`LoopTask`。
- [x] 2. `electron/services/loop/loop-discovery.ts`：`discoverLoops`（扫所有 session jsonl）。取消只读不实现（数据来源只读）。
- [x] 3. `electron/ipc/loop.ts`：`loop:list`；`index.ts` 注册。
- [x] 4. preload + `src/lib/api.ts`：`loop` 命名空间；`server/index.ts` 加 `GET /api/loops`。
- [x] 5. `src/pages/Loops.tsx`：任务表 + 过滤 + 只读说明 + 空态。
- [x] 6. i18n + 路由 + 侧栏（Timer 图标，nav.loops key）。

## 验收标准

- [ ] 探测步骤产出书面结论：`/loop` 的真相源是 `~/.claude.json` 子键 / jsonl / 都不可用，并记录字段名。
- [ ] 若真相源坐实为 claude.json：手动建一个 `/loop`，面板能列出它，description/cron/nextRun 与实际一致。
- [ ] 3 天过期以倒计时/进度条展示，过期任务 status=expired。
- [ ] 任务行能跳到 spec015 对应 session。
- [ ] 取消（可写源）后该 loop 从面板消失且真相源文件已更新（取消前自动备份）。
- [ ] 只读源时取消按钮禁用 + tooltip 说明原因。
- [ ] 无 loop 时显示空态与数据源说明，不报错。
- [ ] Web 模式 `GET /api/loops` 返回只读列表。

## 风险与备注

- **数据源是本 spec 最大不确定项**，已诚实标注：本机当前无活跃 loop 正样本，三条探测路径未坐实哪条成立。实现**必须先做步骤 0 探测**，再写解析，不可凭空假设 `~/.claude.json` 结构。
- **`queue-operation` 事件语义未坐实**（jsonl 实测有 412 条但不确定与 loop 的关系）。探测时一并确认。
- **取消的写入风险**：直接改 `~/.claude.json` 有破坏全局配置的风险——必须先备份、原子写、schema 校验。若拿不准，宁可只读不提供取消，引导用户去会话内 `/loop` 取消。
- **不并发 + session 级**：loop 绑 session，session 没了 loop 也没了。面板要处理"loop 指向的 session 已消失"的情况（标 orphan）。
- CLI 一旦入 PATH 且有 loop 列举命令，应优先用 CLI 作权威源（更准），jsonl/claude.json 作离线兜底。

**步骤 0 实测结论（2026-06-22）**：
- `~/.claude/` 无独立 loop/cron/schedule 文件；`~/.claude.json` 顶层及各 `projects.<path>` 子键均无 loop 相关字段。
- `CronCreate`/`CronDelete`/`CronList` 以 `deferred_tools_delta` 形式出现在所有 session 的 attachment 中，但本机从未实际调用（无 tool_use 事件），疑为预留能力。
- **真实机制**：`/loop` 动态模式使用 `ScheduleWakeup` 工具（`input: {delaySeconds, reason, prompt}`），写进 assistant turn 的 tool_use block。触发时产生 `queue-operation:enqueue` + `system:scheduled_task_fire` 两条记录，`scheduled_task_fire.content = "Claude resuming /loop wakeup (...)"`。
- 状态推断：`scheduledAt + delaySeconds > now` 且无对应 `scheduled_task_fire` → pending；反之 → fired；`fireAt < now` 且无 fire → expired。
- 取消：无可写路径（pending wakeup 存于 CLI 进程内部），UI 只读说明，引导用户在会话内取消。
