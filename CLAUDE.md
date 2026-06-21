# claude-code-debugger

围绕 Claude Code 的桌面工具。Electron + React + TypeScript，双模式（桌面 Electron / Web Express）。

**定位正在演进**：从一年前的"Claude Code 配置浏览器"重做成 **"Harness 工作台"**——配置 / 调试 / 观测 / 编排 / 教学 五件事。详细方向、路径、按版本对齐的功能缺口、以及每个功能的可执行 spec，全部在 `docs/`：

- `docs/claude-code-debugger演进路径.md` —— 产品方向、五支柱、Phase 0/1/2/3 划分（**先读这个**）。
- `docs/harness-ide-spec/README.md` —— 22 个实现 spec 的索引（spec001–022）+ 状态 + 依赖关系。
- `docs/harness-ide-spec/功能版本对照表.md` —— 功能 ID（ORCH/OBS/HOOK/PERM/MODEL/SKILL/MISC）↔ Claude Code 版本 ↔ 项目覆盖状态。

**动代码前先看对应 spec**（spec 引了真实 file:line、给了类型 diff 和验收标准）。改了方向/功能后回头更新这三份文档。

## 工作方式

- **想清楚再写**：先说清假设；有多种理解就摆出来让我选，别默默挑一个；有更简单的做法就直说、该反对就反对；不清楚就停下来问，别猜。
- **最简实现**：解决问题的最少代码，不加没要求的功能/抽象/配置/防御。单次使用就别造抽象。写完若 200 行能压到 50，就重写。和项目"不做什么"哲学一致（Thin Harness）。
- **外科手术式改动**：只动该动的，每一行改动都能追溯到需求。别顺手"改进"相邻代码/注释/格式，别重构没坏的东西，跟现有风格走。只清理自己改动产生的孤儿（import/变量）；遇到无关的既有死代码——**提一句，别删**（除非明确要求）。
- **目标驱动**：把任务变成可验证的成功标准再做。多步任务先列简短计划，每步带验证点（改 X → 验证：Y）。spec 的"验收标准"就是现成的成功标准，照着 loop 到通过。

## 跑起来

```bash
npm install
npm run electron:dev      # 桌面端（主模式）
npm run web:dev           # Web 模式（Express :3001 + Vite :5173）
npm run electron:build    # 出包
```

⚠️ **已知 build 时序 bug（spec001 修）**：`electron:dev` 里 `copy:preload` 可能在 vite 首次 build 出 `dist-electron/` 之前就跑，`cp` 失败 → preload 没拷过去 → `window.electronAPI` 全断、IPC 不通。首次启动若 Electron 窗口空白/报 `Preload error`，先 `mkdir -p dist-electron && cp electron/preload.cjs dist-electron/preload.cjs` 再重启。彻底修见 spec001。

## 架构

```
electron/services/file-manager*.ts  # 核心：扫描/读写 ~/.claude 和项目 .claude 配置。
                                    # 按域拆成继承链（base→plugins→skills→agents→hooks→mcp→commands→claudemd→FileManager）；
                                    # FileManager 仍是单例门面，对外 API 不变。新增方法放对应 domain 文件，跨域共享的低层 helper 放 base（protected）。
electron/services/provider-manager.ts
electron/ipc/*.ts                    # 每个域一个 registerXxxHandlers(ipcMain, fileManager)
electron/preload.cjs                 # contextBridge（必须 .cjs）
server/index.ts                      # Web 模式 REST，镜像 IPC
src/pages/*.tsx                      # Dashboard/Skills/Agents/Hooks/MCP/Commands/ClaudeMd/Graph/Models/Settings
src/lib/api.ts                       # 统一 API，自动探测 Electron(IPC) / Web(HTTP)
shared/types/*.ts                    # 主进程/渲染进程共享类型
```

调用链：`渲染进程 api.xxx()` → preload `contextBridge` → 主进程 IPC handler → `FileManager` → 文件系统。Web 模式同一 `FileManager` 走 Express。

## 关键事实（动手前必须知道，多数是审查实测的）

**Claude Code 配置的真相源**（别盲扫、别想当然）：
- **激活的 plugin 版本** → `~/.claude/plugins/installed_plugins.json`（schema v2，带 scope/version/installPath）。**不要盲扫 `plugins/cache/` 目录**，那里有废弃版本残留（本机 superpowers 残留 5 个版本目录）。
- **plugin 是否启用** → `~/.claude/settings.json` 的 `enabledPlugins`（plugin 级，不是版本级）。
- **plugin 内容结构** → `<installPath>/{skills/*/SKILL.md, commands/*.md, .claude-plugin/plugin.json}`。
- **三层来源**：user(`~/.claude/`) / project(`<cwd>/.claude/`) / plugin，同名时 user 覆盖 project 覆盖 plugin。
- **session 运行记录** → `~/.claude/projects/<encoded-cwd>/<session>.jsonl`（encoded-cwd = cwd 把 `/` 换成 `-`），每行一个 JSON turn。
- **workflow 落盘** → `<session>/workflows/wf_<id>.json`（含 agentCount/phases/status/totalTokens）+ `<session>/subagents/workflows/wf_<id>/agent-<id>.{jsonl,meta.json}`。注意 `agentCount`(声明数) 可能 ≠ 实际落盘 jsonl 数（killed 中断）。
- **Auto Memory** → `~/.claude/projects/<encoded-cwd>/memory/MEMORY.md` + topic 文件。
- `claude` CLI **不在 PATH**——所有"改配置"以直接读写文件为主路径，CLI 仅作可选增强。

**写 settings.json 的铁律（spec009）**：统一走 `SettingsWriter`（read-modify-write 整对象 + 原子写 + 保留未知字段）。**禁止** `writeJSONFile` 整覆盖 settings（会丢用户未知字段）。hooks/permissions/model/worktree/MCP 的保存都走它，不准各写各的。

**现状里几个已知偏差（spec 已认领修）**：
- `file-manager.ts:192` 硬编码扫 `plugins/marketplaces/anthropic-agent-skills`——该目录在 2.1.x 已不存在，导致 Skills 页扫不到任何 plugin skill（spec003/004 修）。
- ~~`getCommands()` 用 `<dir>/<dir>.md` 子目录约定，真实是平铺 `commands/*.md`~~（spec006 已修：改扫平铺/命名空间 `commands/**/*.md`，三层来源 + 覆盖检测，plugin 只读）。
- `getAgents()` 扫 `.json`，但 agent 真相源是 `.md` + YAML frontmatter（spec012 修）。
- `file-manager.ts:108` chokidar `ignored:/(^|[/\\])\../` 忽略 dotfile——监听 `~/.claude` 实际失效，tail jsonl 不能照搬这条正则（spec014 修）。
- `file-manager.ts:557` 三层路径里 local 层 location 被误标 `'project'`（spec009 修）。
- **reactflow 在 deps 但项目从未用过**（`Graph.tsx` 是 lucide 自绘）——Phase 2 拓扑图是首次集成，不是复用。

## 约定

- 改主进程（`electron/`）要重启 Electron；改前端（`src/`）有热重载。
- 日志前缀：`[Main]` `[Preload]` `[FileManager]` `[IPC]` `[API]`。FileManager 对"文件不存在"应静默返回空，不刷 ERROR（spec002）。
- 类型放 `shared/types/`，主/渲染共享。新增功能：定类型 → IPC handler → preload 暴露 → `api.ts` 封装 → 页面 → **i18n 文案**。
- **i18n 是硬要求，开发时同步做，先保中英文**：所有面向用户的字符串走 `useTranslation()` 的 `t()`，**不准硬编码**。基建已就位（`src/i18n/`，`supportedLngs:['en','zh']`，自动探测语言）。加新页面就在 `src/i18n/locales/en/` 和 `src/i18n/locales/zh/` **各建一个同名 namespace JSON**（en 和 zh 必须成对，缺一不可），再在 `src/i18n/index.ts` 注册。已有 namespace：common/layout/dashboard/models/commands/hooks；skills/agents/mcp/claudemd/graph/settings 以及 Phase 2 的新页（sessions/plugins/usage…）都还没有自己的 namespace，谁加这页谁建。每个 UI spec 的"实现步骤"末尾都有 i18n 一项，别跳过。
- Web 模式保持只读浏览角色：hook 执行 / MCP 测试 / session 监视都只在桌面端。
- 规划文档用中文。spec 严格按 `docs/harness-ide-spec/README.md` 的模板写。
