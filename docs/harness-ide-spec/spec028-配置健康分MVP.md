# spec028 · 配置健康分 MVP

- 对应功能 ID：MISC（配置体检）+ OBS-02 联动
- 所属 Phase：P2
- 前置依赖：spec009（settings 分层读取）、spec013（MCP 来源集）、spec017（usage-advisor 同款 id+params 契约）
- 工作量估计：S（<1天）

## 目标

在 Dashboard 给出一个**配置健康分 + 可执行清单**：扫 settings/MCP/技能面，把 ECC 四条量化调优（thinking 预算、subagent 模型、autocompact、MCP 过多）落成"你这台机器现在缺什么"。它是"成本优化器"叙事的入口——Usage 面板回答"钱花在哪"（spec017/026），健康分回答"下一步改什么"。

**MVP 边界**：只读、只给建议，不提供一键修改（写入路径已有 `settingsWriter`，但一键改配置涉及层级选择与回滚语义，留到后续）。

## 现状

- `electron/services/session/usage-advisor.ts:14` 已有 4 条**运行时**建议（基于单个 session 的 token 分布），但**没有任何配置面体检**——用户看完"该换 sonnet"，不知道自己 `env` 里压根没设 subagent 模型。
- 数据源全部就绪、无需新扫描：
  - `settingsWriter.getModel()`（`settings-writer.ts:160`）的 `effective` **已把一层嵌套摊成点号路径**（`:169`），故 `env.MAX_THINKING_TOKENS` 可直接查。
  - `getMCPServers()`（`file-manager-mcp.ts:80`）、`getSkills()`（`file-manager-skills.ts:29`）、`getCommands()`（`file-manager-commands.ts:51`）、`getAgents()`（`file-manager-agents.ts:69`）。
- i18n 硬规则：后端只出 `id` + `params`，文案在前端 `t()`（沿用 spec017 的 `UsageAdvice` 契约，`session.ts:155` 注释）。

## 改动方案

### 1. 类型（`shared/types/health.ts`，index 导出）

```ts
export type HealthSeverity = 'warn' | 'suggest' | 'info'
export interface HealthCheck {
  /** i18n：health.check.<id>.title / .detail */
  id: 'thinking-budget-unset' | 'subagent-model-unset' | 'autocompact-off'
    | 'mcp-heavy' | 'surface-heavy' | 'opus-pinned'
  severity: HealthSeverity
  params?: Record<string, string | number>
  /** 扣分权重（UI 可展示"修好 +N 分"） */
  penalty: number
}
export interface ConfigHealth {
  score: number            // 0–100，100 = 无待办
  checks: HealthCheck[]    // 已按 penalty 降序
  /** 参与计算的规模数（UI 展示口径，避免用户猜） */
  counts: { mcpServers: number; skills: number; commands: number; agents: number }
}
```

### 2. 纯函数（`electron/services/config-health.ts`）

`computeConfigHealth(input): ConfigHealth`，入参是**已取好的数据**（`effective: Map<string, unknown>` + 四个计数 + `model`），不碰 fs——可单测、可复用。规则：

| id | 触发 | severity | 扣分 |
|---|---|---|---|
| `thinking-budget-unset` | `env.MAX_THINKING_TOKENS` 未设 | suggest | 10 |
| `subagent-model-unset` | `env.CLAUDE_CODE_SUBAGENT_MODEL` 未设 | suggest | 10 |
| `autocompact-off` | `autoCompactEnabled === false` | warn | 15 |
| `mcp-heavy` | MCP server > 10 → warn / 6–10 → info | warn/info | 15 / 5 |
| `surface-heavy` | skills+commands+agents+mcp > 80 → warn / > 50 → info | warn/info | 15 / 5 |
| `opus-pinned` | `model` 显式含 `opus` | suggest | 10 |
| `stop-hook-no-guard` | Stop/SubagentStop hook 未判 `stop_hook_active`（2026-08-04 追加） | warn | 20 |
| `hook-script-missing` | hook 命令指向的脚本文件不存在（2026-08-04 追加） | warn | 15 |
| `claude-md-bloat` | CLAUDE.md（user+项目）> 16k 字符 → warn / > 8k → info（2026-08-04 追加） | warn/info | 10 / 5 |
| `permissions-wide-open` | `permissions.allow` 有等价"整个工具放行"的规则（2026-08-04 追加） | warn | 15 |
| `dangerous-skip-enabled` | `skipDangerousModePermissionPrompt === true`（2026-08-04 追加） | info | 5 |

`score = max(0, 100 - Σpenalty)`。阈值来源是策略文档转述的 ECC 经验法则（MCP>10 吃 context、工具面>80 判断力下降），**不是官方契约**——UI 文案须说"经验阈值"。

### 3. 后端接线

- `file-manager.ts` 门面加 `getConfigHealth()`：并发取 settings model + 四个列表 → 调纯函数。
- `electron/ipc/settings.ts` 加 `settings:health`；`preload.cjs` 暴露 `getConfigHealth`。
- `server/index.ts` 加 `GET /api/settings/health`（只读，Web 可用）。
- `src/lib/api.ts` 的 `settings.health()`。

### 4. 前端（Dashboard 卡片）

`src/pages/Dashboard.tsx` 加一张卡：大号分数 + 严重度圆点，下列前 3 条待办（title + detail），点"查看全部"展开剩余。空清单（100 分）显示一句"配置无待办"。不做跳转/编辑。

### 5. 与 `claude doctor` 的分工（2026-08-04 核实）

实跑 `claude doctor`（CLI 2.1.221）确认它只覆盖**安装健康**：运行方式/版本/commit/平台/安装路径/安装方式/搜索/自动更新通道/上次更新结果/Remote Control，末尾提示"完整 setup checkup 请在会话内跑 `/doctor`"。**不涉及成本、上下文、纪律链**。所以健康分与它不重叠：doctor 答"装没装好"，健康分答"配得省不省钱、纪律链有没有断"。

### 6. i18n

`dashboard` namespace 下新增 `health.*`：`title`、`scoreHint`、`empty`、`showAll`、`counts`、`check.<id>.title/detail`（6 条 × 2 语言）。en/zh 成对。

## 实现步骤

- [x] 1. `shared/types/health.ts` + index 导出。
- [x] 2. `electron/services/config-health.ts`：`computeConfigHealth` 纯函数。
- [x] 3. `file-manager.ts` 门面 `getConfigHealth()`。
- [x] 4. IPC `settings:health` + preload + `api.settings.health()` + Web 路由。
- [x] 5. Dashboard 健康分卡片。
- [x] 6. i18n en/zh `health.*` 成对。
- [x] 7. `npx tsc --noEmit` + `eslint` 通过；本机实测分数与手工核对一致。

## 验收标准

- [x] Dashboard 出现健康分卡片，分数 = 100 − 命中项扣分之和（本机手工核对一致）。
- [x] 本机 `~/.claude/settings.json` 的 `env` 为空 → `thinking-budget-unset` 与 `subagent-model-unset` 两条必现。
- [x] MCP server 数与 MCP 页显示一致（同一 `getMCPServers()` 口径）。
- [x] Web 模式 `GET /api/settings/health` 返回同结构（只读可用）。
- [x] en/zh 键成对、无硬编码文案；`npx tsc --noEmit` 0 错误。

## 风险与备注

- **阈值是经验值不是官方契约**：MCP>10 / 工具面>80 来自 ECC 经验法则（策略文档第六节转述），UI 必须标注，避免被当成官方规范。
- **"工具面"是代理指标**：真实工具数需要连上每个 MCP server 枚举 tools（spec020 健康面板才做），MVP 用 skills+commands+agents+mcp 计数近似，文案里说明口径。
- `env.CLAUDE_CODE_SUBAGENT_MODEL` / `MAX_THINKING_TOKENS` 键名来自 ECC 实践转述；本工具只做"未设置则建议"，不写入，键名即使有出入也不会误改用户配置。
- 一键修复留到后续：写入需选层（user/project/local）+ 回滚语义，超出 MVP。
- **`stop-hook-no-guard` 是静态启发式**（2026-08-04 追加，动机是实际撞上 "A hook blocked the turn from ending 9 consecutive times"）：命令串或其指向的脚本里出现 `stop_hook_active` 即视为已判。脚本可能用别的方式避免死循环（比如根本不 block），所以文案只说"未见该判断"、不断言有 bug。读脚本的路径解析与 spec018 沙箱一致——相对路径按 hook 所属项目目录解析，`$CLAUDE_PROJECT_DIR` 做替换。
