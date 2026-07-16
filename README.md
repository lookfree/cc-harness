<div align="center">
<img src="images/cc-harness-back.png" alt="CC Harness — Claude Code 的桌面工作台" width="100%" />

# CC Harness

### 把 Claude Code 的黑盒照亮

**围绕 Claude Code 的开源桌面工作台：配置 · 调试 · 观测 · 编排 · 教学**

A desktop workbench for Claude Code: configure, debug, observe, orchestrate, and teach your AI agent workflows.

**简体中文** · [问题反馈](https://github.com/lookfree/cc-harness/issues)

<p>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-3b8fff" alt="platform" />
  <img src="https://img.shields.io/badge/desktop-Electron-24C8DB" alt="Electron" />
  <img src="https://img.shields.io/badge/license-MIT-2F4F4F" alt="MIT license" />
  <img src="https://img.shields.io/badge/Claude%20Code-2.1.211-orange" alt="Claude Code version" />
</p>

Claude Code 已经从"单会话配置工具"长成了多会话编排 + 自动循环 + 后台调度 + 可治理的复杂系统。每加一个能力就多一层不透明——CC Harness 想帮你看见它在干什么。

</div>

---

<details>
<summary><kbd>目录</kbd></summary>

- [CC Harness 是什么](#cc-harness-是什么)
- [你在用 Claude Code 做这些事时，CC Harness 能帮上什么](#你在用-claude-code-做这些事时cc-harness-能帮上什么)
- [五根支柱](#五根支柱)
- [适合谁](#适合谁)
- [快速开始](#快速开始)
- [当前实现状态](#当前实现状态)
- [技术栈](#技术栈)
- [常见问题](#常见问题)
- [开源协议](#开源协议)

</details>

---

## CC Harness 是什么

CC Harness 是 Claude Code 的可视化运维台。它不做 AI 对话，不替代 CLI——它做的是 CLI 做不到的那件事：**让你看见 Claude Code 在干什么**。

Claude Code 越复杂越像黑盒——subagent 五层、Workflow 几百 agent、dream 黑盒固化记忆，CC Harness 是目前最系统地把这个黑盒照亮的工具。

---

## 你在用 Claude Code 做这些事时，CC Harness 能帮上什么

### 1. Workflow 跑了几百个 agent，但你不知道现在跑到哪

你用 `/ultracode` 起了一个 Workflow 任务，编排了几十个 subagent 并行处理。CLI 里只有一个计数——`Running agent 47/200`——你看不到拓扑，不知道哪条线卡了、哪个阶段在等待、哪个 agent 吃掉了最多 token。

CC Harness 的 Session 监视器实时解析 session jsonl，用 React Flow 画出 subagent 五层调用树，每个节点显示用时、token 消耗和嵌套深度。Workflow 跑着时，这张图是你唯一能看懂"它在干什么"的窗口。

![agent-拓扑](./images/agent-拓扑.png)

### 2. Hook 莫名其妙没生效，你不知道是没触发还是执行失败

你配了一个 `PostToolUse` hook，本该在 Claude 写文件后自动格式化代码。但代码一直没格式化——是 hook 没触发？触发了但报错了？settings.json 写对了吗？

![hook-1](./images/hook-1.png)

CC Harness 的 Hook 沙箱让你给一个模拟输入直接 dry-run，看 stdout、stderr、exit code 和实际效果。不用真开 session、不用等 Claude 操作文件，一分钟验证 hook 是不是通的。dry-run 时环境完全隔离：只暴露 `PATH / HOME / TMPDIR`，不传 API token，不传任何用户凭证。

![hook-2](./images/hook-2.png)

### 3. `/loop` 设了七个后台任务，但你不知道还有几个在跑

你用 `/loop` 让 Claude 后台盯着几个 PR、跑几个定时检查。三天过去了，你打开 Claude Code 发现有几个 session 已经消失，但不知道哪些 loop 还活着、哪些已经过期、哪些触发过几次。

CC Harness 的 Loop Wakeup 面板汇总所有 session 的 `ScheduleWakeup` 事件，按 pending / fired / expired 分类，告诉你每个 loop 的触发记录和剩余状态。

![loop](./images/loop.png)

### 4. token 消耗远超预期，但你不知道钱花在哪

同样的任务，用不同的 skills 组合、不同的 subagent 嵌套深度，token 差距可以是几倍。`/usage` 能出分项数字，但数字散落在 CLI 输出里，跨 session 很难比。

CC Harness 的 Token Usage 面板把 skills / subagents / MCP / plugins / base session 各项拉出来做成可视面板：

![token-use](./images/token-use.png)

调优建议实时计算：按 Sonnet 价格重算当前 session 的 Opus token，给出精确能省多少——是这次 session 的真实数字，不是估算。

![token-apply](./images/token-apply.png)

### 5. 同事接手项目，三层配置全靠口口相传

项目里有 user 级 skill、project 级 command、plugin 带的 agent，还有几个 hook——但没有工具能一眼看清这些配置的覆盖关系。你很难解释"这个 skill 来自哪里、为什么这个 hook 会触发"。

CC Harness 的配置层把 Skills / Commands / Agents / Hooks 的三层来源（user / project / plugin）都列出来，标注覆盖关系，让任何人打开都能看懂当前项目的 harness 全貌。

### 6. 你写了十几个 skill，但不知道哪句 prompt 会命中哪个

skill 多了之后，"这个 skill 什么时候会被调用"变得越来越模糊。

CC Harness 的 Skills 页内置 Trigger 分析器，自动从 skill 内容提取触发关键词并按 action / technology / format / topic 分类，生成"什么样的 prompt 会激活这个 skill"的示例：

![skills-trigger](./images/skills-trigger.png)

同一个 skill 还有 Mermaid 结构图（可缩放、TD/LR 布局切换），蓝色是 skill 节点、绿色是引用、橙色是脚本、紫色是触发器，一图看清结构：

![skills-diagram](./images/skills-diagram.png)

### 7. Skills、Hooks、MCP 之间的依赖关系你说不清楚

项目大了之后，哪个 skill 依赖哪个 MCP server、哪个 hook 会初始化哪个 MCP、哪个 command 会调用哪个 skill——这些关系散在各个配置文件里，没人能一眼说清楚。

CC Harness 的 Dependency Graph 自动识别五类关系（Skills → MCP / Hooks → MCP / Skills ↔ Hooks / Commands → Skills / Commands → MCP），把有关联的节点聚合成带编号步骤的工作流链：

```
① Hook 触发 → ② MCP Server 启动 → ③ Skill 激活 → ④ MCP Tool 调用
```

![依赖关系](./images/依赖关系.png)

### 8. Auto Memory 固化了什么，你完全不知道

Claude Code 的 dream 机制会在后台把对话记忆压缩固化进 MEMORY.md。但它合并了什么、删了哪些旧记录、解决了哪些矛盾——整个过程是黑盒，你只能看到结果，看不到变化。

CC Harness 在每次 dream 前后做快照，用 diff viewer 呈现 added / deleted / modified / merged / conflict-resolved 五种变化类型，让记忆固化过程第一次变得可见。

![memorry](./images/memorry.png)

---

## 五根支柱

**一、配置（Configure）** Skills / Commands 三层来源模型、Plugin Marketplace 多源多版本浏览、全类型 Hooks（MessageDisplay / PreCompact / HTTP / PostToolUse 输出替换）、`Tool(param:value)` 权限语法可视化构造、Worktree + managed settings + fallbackModel、CLAUDE.md 多项目编辑。

**二、调试（Debug）** Hook 沙箱执行器支持模拟输入 dry-run，看 stdout / stderr / blocked / 转换结果；session 监视开着时，hook 触发在时间线掉点，悬浮看 input/output。

**三、观测（Observe）** 实时 tail session jsonl、画 subagent 五层调用树 + Workflow 编排图、Token 分项面板、Loop 调度面板、MCP 健康面板、Auto Memory 记忆视图 + dream 固化前后 diff。**这是项目最大差异化点：CLI 里看不到拓扑，CC Harness 把它画出来。**

**四、编排（Compose）** 把 CLAUDE.md + skills + hooks + commands 打包成可复用的业务 harness 模板，存、复用、导出成 plugin 格式（路线图中）。

**五、教学（Teach）** 给全新项目目录，工具陪你走一遍：写 CLAUDE.md → 选 plugin → 配 hook → 设 `/goal`（路线图中）。

---

## 适合谁

- 重度使用 Claude Code 的开发者，想知道 session 里到底发生了什么
- 用 Workflow / subagent 编排跑复杂任务、需要可视化监控的人
- 配了很多 hooks、skills、MCP，想统一管理和调试的人
- 团队共用一套 Claude Code harness 配置，需要对齐和交接的人
- 关注 token 成本、想做跨 session 优化分析的人

不太适合：只使用 claude.ai 网页版、或期待工具自动替你做决定的人。CC Harness 帮你看见状态、验证效果、分析成本——判断和操作还是你来。

---

## 快速开始

```bash
git clone https://github.com/lookfree/cc-harness.git
cd cc-harness
npm install

# 桌面模式（主模式，完整功能）
npm run electron:dev

# Web 模式（浏览器访问，只读）
npm run web:dev
```

**前置条件**：Node.js 18+，已安装 Claude Code CLI（`~/.claude/` 目录存在）。

---

## 当前实现状态

| Phase | 内容 | 状态 |
|---|---|---|
| **Phase 0 · 止血** | build 时序修复、扫描报错降级、路径配置化、依赖核验 | ✅ 完成 |
| **Phase 1 · 配置层** | Skills 三层来源、Plugin 浏览器、Commands、Hooks 类型系统、权限编辑器、配置写入分层、模型治理、Worktree、Agents、MCP 升级 | ✅ 完成 |
| **Phase 2 · 观测层** | session jsonl 解析、Session 监视器、Subagent 拓扑图、Token Usage、Hook 沙箱、Loop 面板、MCP 健康、记忆面板 | ✅ 完成 |
| **Phase 3 · 编排教学** | 业务工作流模板、Harness Benchmark、Onboarding Tour | 规划中 |

详细 spec 见 [`docs/harness-ide-spec/`](docs/harness-ide-spec/README.md)（spec001–023，含验收标准和真实 file:line 引用）。

---

## 技术栈

- **桌面**：Electron + electron-builder
- **后端（Web 模式）**：Express.js
- **前端**：React 18 + TypeScript + Vite
- **UI**：shadcn/ui + Tailwind CSS + Radix UI
- **可视化**：React Flow（subagent 拓扑图）
- **编辑器**：Monaco Editor
- **i18n**：i18next（中文 / 英文）
- **状态**：Zustand

---

## 常见问题

### CC Harness 会替我管理 Claude Code 配置吗？

不会自动替你做决定。它帮你看见配置状态、验证 hook 是否生效、分析 token 分布——判断和操作还是你来。

### 我的 session 数据会上传吗？

不会。CC Harness 读取的是你本机 `~/.claude/` 下的文件，完全本地运行，不向任何服务器上传数据。

### Web 模式和桌面模式有什么区别？

桌面模式（Electron）是主模式，支持完整功能：实时 session 监视、Hook 沙箱执行、MCP 连接测试、文件监听。Web 模式是只读浏览，适合在没有桌面环境的场景快速查看配置。

### 它能支持最新版本的 Claude Code 吗？

当前对齐 Claude Code 2.1.211：模型价格表（Opus 4.8 / Sonnet 5 促销价 / Fable 5 按量价）、配置分层语义（2.1.207 起 `autoMode`/`pluginConfigs` 的层级限制）、权限批准的仓库根存储（2.1.211）、MCP 标准路径（`.mcp.json` / `~/.claude.json`）均已按官方 changelog 校准。功能面（后台 agent 观测、hook matcher 语义校验等）持续扩展——差距与计划见 [版本追赶评估](docs/harness-ide-spec/版本追赶评估-2.1.185-2.1.211.md) 和 [spec 文档](docs/harness-ide-spec/README.md)。

### 和 claudia 有什么不同？

claudia 是 GUI 对话客户端，替代 CLI 的交互入口。CC Harness 不做对话窗口，专注在 Claude Code 的**配置 / 调试 / 观测 / 编排**——是做完事情之后用来看清楚发生了什么的工具。

---

## 开源协议

[MIT](LICENSE)
