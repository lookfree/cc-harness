# spec018 · Hook 沙箱执行器

- 对应功能 ID：HOOK 可执行化（HOOK-01 / 02 / 04 / 06 的 dry-run）
- 所属 Phase：P2
- 前置依赖：spec007（Hooks 类型系统补全，提供完整 HookAction 类型）；spec015（session 监视，hook 触发时间线挂上去）
- 工作量估计：M

## 目标

让用户选一个 hook，喂**模拟输入** dry-run，看 stdout / stderr / exitCode / blocked / 转换结果，**不启真 session**。command/http/prompt 三种 action 形态都能试。配合 session 监视器，把 hook 在真实会话里的**触发时间线**也画出来。核心是沙箱执行的安全边界（`child_process` 隔离），因为 hook 本质是用户机器上跑任意命令。

## 现状（引用真实 file:line）

- 项目**已有 hook 测试雏形但很弱**：`src/lib/api.ts:309 hooks.test(hookName, command, hookType, location, projectPath, timeout)` → `window.electronAPI.testHook`。但它只传一个裸 `command` 字符串，**不构造 hook input JSON、不区分 command/http/prompt、不解析 block/转换语义**。
- `src/lib/api.ts:291 launchDebugSession` 真起一个调试 session（`electron/ipc/hooks.ts:392`，switch 在 `:409`-`:447`），这是"启真 session"，与本 spec 要的"不启 session 的 dry-run"相反。
- `electron/ipc/hooks.ts` 已有 child_process 执行 hook 的代码路径（testHook），但**无安全边界设计**（无超时硬杀、无 stdin 注入 hook input、无环境隔离）。
- `HookExecutionLog`（`shared/types/hook.ts:82` 区域）已存在，可复用为 dry-run 结果载体（需扩字段）。

## 改动方案

### 1. Hook 输入/输出契约类型（`shared/types/hook.ts` 追加）

Claude Code 给 hook 的输入是一段 JSON（经 stdin），hook 通过 stdout JSON 或 exit code 表达决策。建模这套契约：

```ts
/** dry-run 时构造的模拟 hook 输入（按 HookType 不同字段不同） */
export interface HookSimInput {
  hookType: HookType
  sessionId?: string
  cwd?: string
  /** PreToolUse/PostToolUse：模拟的工具名与输入 */
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: unknown          // PostToolUse 用
  /** UserPromptSubmit：模拟用户 prompt */
  prompt?: string
  /** MessageDisplay：模拟待显示的 assistant 消息 */
  message?: string
  /** 任意补充字段（高级：直接编辑原始 JSON） */
  extra?: Record<string, unknown>
}

/** dry-run 结果 */
export interface HookDryRunResult {
  hookName: string
  hookType: HookType
  actionType: HookActionType    // command | http | prompt
  exitCode: number | null
  stdout: string
  stderr: string
  /** 解析 hook 输出后的语义结果 */
  decision: 'allow' | 'block' | 'transform' | 'none'
  /** block 时的原因（hook 输出的 reason 字段） */
  blockReason?: string
  /** transform 时的替换内容（PostToolUse 输出替换 / MessageDisplay 转换） */
  transformedOutput?: unknown
  durationMs: number
  timedOut: boolean
  /** http hook：响应状态与 body */
  httpStatus?: number
  httpResponseBody?: string
  error?: string
}
```

### 2. 沙箱执行器（新增 `electron/services/hook-sandbox.ts`）

```ts
export async function dryRunHook(
  hook: Hook, action: HookAction, input: HookSimInput, opts?: SandboxOpts
): Promise<HookDryRunResult>

export interface SandboxOpts {
  timeoutMs?: number       // 默认 10000，硬上限 30000
  maxOutputBytes?: number  // 默认 1MB，截断防 OOM
  cwd?: string             // 默认临时目录，不在真实项目 cwd（防误改）
  allowNetwork?: boolean   // http hook 才放行；command hook 默认告警
}
```

**安全边界设计（核心）**：

- **command/exec form**：用 `child_process.spawn`（**不用 `exec`/shell 拼接**，避免注入）。`command` 走 `spawn(cmd, {shell:true})` 时明确标"经 shell（有注入面）"；`args` exec form 走 `spawn(bin, argv, {shell:false})`（安全）。
- **stdin 注入**：把 `HookSimInput` 序列化成 hook input JSON 写进子进程 stdin（这是 Claude Code 真实传参方式），而不是拼到命令行。
- **超时硬杀**：`timeoutMs` 到点 `child.kill('SIGKILL')`，`timedOut=true`。不信任 hook 自己的 timeout。
- **环境隔离**：子进程 `env` 只传白名单（PATH、HOME、必要的 CLAUDE_* 模拟变量如 effort），**不透传**本进程全部 env（防泄漏 token）。给一个隔离的临时 `cwd`（`os.tmpdir()/cc-hook-dryrun-<rand>`），dry-run 默认不在真实项目目录跑，防 hook 误删/改文件。
- **输出上限**：stdout/stderr 累计超 `maxOutputBytes` 截断 + 杀进程。
- **prompt 类**：不执行（prompt hook 是把 prompt 交给模型，无外部命令）——dry-run 只回显 prompt 模板 + 占位符替换预览，`decision='none'`。
- **http hook**：用 `fetch`（主进程 Node 18+ 有），按 spec007 的 `url/method/headers/body` 发；body 模板替换 `${...}` 占位为 sim input。`allowNetwork` 必须显式开，UI 二次确认（出网有副作用风险）。超时同样硬控。
- **决策解析**：读子进程 stdout，尝试 `JSON.parse` → 按 Claude Code hook 输出约定取 `decision`/`reason`/替换字段；exit code 非 0 也按约定可能表 block。映射规则集中一处（随官方约定更新）。

> **明确不做**：不用 Docker/VM 级沙箱（过重）。隔离手段 = spawn + 临时 cwd + env 白名单 + 超时硬杀 + 输出上限 + 网络默认关。UI 必须警示"dry-run 仍会在你机器上真实执行该命令"。

### 3. IPC（扩 `electron/ipc/hooks.ts`）

```ts
ipcMain.handle('hooks:dryRun', (_e, hook, action, input, opts) =>
  dryRunHook(hook, action, input, opts))
```

preload 暴露 `dryRunHook`。`src/lib/api.ts` 的 `hooks` 命名空间加 `dryRun(hook, action, input, opts)`。
**Web 模式禁用**（演进路径："hook 执行得桌面端"）——`server/index.ts` 不提供该路由，web 下 `dryRun` 抛"仅桌面端"。

### 4. 前端：dry-run 面板（扩 `src/pages/Hooks.tsx`）

在选中 hook 的详情区加"沙箱试运行"区块：
- **模拟输入表单**（按 hook.type 动态出字段，复用 spec007 的类型分流）：PreToolUse→toolName+toolInput JSON 编辑器；UserPromptSubmit→prompt textarea；MessageDisplay→message；高级模式→裸 JSON 编辑器（`extra`）。
- **action 选择**：hook 有多个 action 时选一个跑。
- **安全确认**：command 类点"运行"前弹确认，明示"将在临时目录执行该命令"；http 类需勾"允许出网"。
- **结果展示**：exitCode、stdout/stderr（等宽、可折叠）、decision 徽章（allow 绿/block 红/transform 蓝/none 灰）、blockReason、transformedOutput diff（PostToolUse 输出替换时显示 原始→替换）、durationMs、timedOut 警告。

### 5. Hook 触发时间线（接 spec015 监视器）

session 监视开着时，从 jsonl 推断 hook 触发点（**探测**：jsonl 是否记录 hook 触发？实测主 jsonl 有 `system` 行 `subtype:'local_command'`，可能是 hook 痕迹）。在 spec015 时间线视图叠一层 hook 轨道：每次疑似 hook 触发掉一个点，悬浮看类型/输入/输出。

```ts
// shared/types/session.ts 追加（若 jsonl 含 hook 事件）
export interface HookFireEvent extends SessionEventBase {
  kind: 'hook_fire'
  hookType?: string
  detail?: string
}
```

## 实现步骤

- [x] 1. `shared/types/hook.ts`：`HookSimInput` / `HookDryRunResult`。
- [x] 2. `electron/services/hook-sandbox.ts`：`dryRunHook` + 三形态执行 + 安全边界（spawn/stdin/超时/env 白名单/临时 cwd/输出上限/决策解析）。
- [x] 3. `electron/ipc/hooks.ts`：`hooks:dryRun` handler。
- [x] 4. preload + `src/lib/api.ts`：`hooks.dryRun`（web 禁用）。
- [x] 5. `src/pages/Hooks.tsx`：模拟输入表单（按 type 动态）+ 安全确认 + 结果展示（含 transform diff）。
- [~] 6. （接 spec015）jsonl hook 触发探测 + 时间线 hook 轨道（`HookFireEvent`）——数据源未坐实，推迟；见风险备注。
- [x] 7. i18n + 安全提示文案。

## 验收标准

- [x] 选一个 command hook（如 echo 一段 JSON），dry-run 返回正确 stdout、exitCode=0、decision 按输出解析。
- [x] command 用 `args:["node","-e","..."]` exec form 跑 → `shell:false`，结果正确（验证 exec form 路径）。
- [x] 一个故意死循环的 hook 在 `timeoutMs` 到点被 SIGKILL，`timedOut=true`，UI 显示超时不卡死。
- [x] 输出 `{"decision":"block","reason":"x"}` 的 hook → decision=block、blockReason='x' 红徽章。
- [x] PostToolUse 输出替换 hook → transformedOutput 显示，UI 给 原始→替换 diff。
- [x] http hook 指向本地测试端点（需勾允许出网）→ httpStatus + responseBody 正确；未勾出网时 http 类禁止运行并提示。
- [x] dry-run 子进程 env 不含敏感 token（DevTools 注入一个 `process.env.SECRET`，hook 打印 env 验证拿不到）。
- [x] dry-run 默认 cwd 是临时目录而非真实项目（hook 内 `pwd` 验证）。
- [x] Web 模式调用 dryRun 抛"仅桌面端"，不崩。

## 风险与备注

- **dry-run 仍是真实执行**：沙箱只隔离 cwd/env/超时/网络，**不能阻止 hook 命令本身的副作用**（它若写 `~/.bashrc` 照样写）。这是命令型 hook 的本质，UI 必须显著警示，不可宣称"绝对安全"。Docker 级隔离过重不做。
- **hook 输出约定需对官方**：`decision`/`reason`/输出替换字段的精确 JSON 形状以官方 hook 文档为准，集中在"决策解析"一处映射，发现差异只改这里。
- **effort 透传**：spec007 已定 effort 是运行时透传（环境变量/输入 JSON）。dry-run 时由 sim input 模拟（env 白名单里给 `CLAUDE_EFFORT` 或写进 stdin JSON），让用户能试不同 effort 下 hook 行为。
- **hook 触发时间线的数据源待确认**：主 jsonl 是否完整记录每次 hook 触发尚未坐实（实测有 `system/local_command` 行但不确定是否等价 hook）。探测方案：开一个真实会话、配一个会打印标记的 hook、看 jsonl 出现什么。未坐实前时间线 hook 轨道标"实验性/推断"。
- **http hook 出网**有真实副作用（真发 POST），必须显式 opt-in + 二次确认，默认关。
- 复用 spec007 的 `HookAction` 类型，避免重复定义；本 spec 只加"执行/结果"类型，不动配置类型。
