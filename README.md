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
  <img src="https://img.shields.io/badge/Claude%20Code-2.1.183-orange" alt="Claude Code version" />
</p>

Claude Code 已经从"单会话配置工具"长成了多会话编排 + 自动循环 + 后台调度 + 可治理的复杂系统。每加一个能力就多一层不透明——CC Harness 想帮你看见它在干什么。

</div>

---

<details>
<summary><kbd>目录</kbd></summary>

- [CC Harness 是什么](#cc-harness-是什么)
- [你在用 Claude Code 做这些事时，CC Harness 能帮上什么](#你在用-claude-code-做这些事时cc-harness-能帮上什么)
- [五根支柱](#五根支柱)
- [几个值得单独说的功能](#几个值得单独说的功能)
- [适合谁](#适合谁)
- [不太适合谁](#不太适合谁)
- [快速开始](#快速开始)
- [当前实现状态](#当前实现状态)
- [技术栈](#技术栈)
- [常见问题](#常见问题)
- [开源协议](#开源协议)

</details>

---

## CC Harness 是什么

CC Harness 是一个开源的 Electron 桌面工作台，围绕 Claude Code 提供配置 / 调试 / 观测 / 编排四件事的可视化操作台。

English summary: CC Harness is an open-source Electron desktop workbench for Claude Code developers to configure hooks/skills/MCP, debug agent workflows, observe real-time session activity, and orchestrate multi-agent pipelines.

CC Harness 是 Claude Code 的可视化运维台。它不做 AI 对话，不替代 CLI——它做的是 CLI 做不到的那件事：**让你看见 Claude Code 在干什么**。

- 实时 tail session jsonl，画 subagent 五层调用树和 Workflow 编排拓扑
- 汇总所有后台 `/loop` 定时任务的触发历史和剩余状态
- Hook 沙箱：给模拟输入 dry-run，不用真开 session 就能验证 hook 是不是通的
- 跨 session 的 token 分项面板，找出"钱烧在哪个 subagent 上"
- Skills / Commands / Hooks 三层来源（user / project / plugin）覆盖关系一屏看清

Claude Code 越复杂越像黑盒——subagent 五层、Workflow 几百 agent、dream 黑盒固化记忆，谁能把这个越来越深的黑盒照亮，谁就有价值。这是 CC Harness 存在的理由。

---

## 你在用 Claude Code 做这些事时，CC Harness 能帮上什么

### 1. Workflow 跑了几百个 agent，但你不知道现在跑到哪

你用 `/ultracode` 起了一个 Workflow 任务，编排了几十个 subagent 并行处理。CLI 里的进度条只有一个 agent 计数——`Running agent 47/200`——你看不到拓扑，不知道哪条线卡了、哪个阶段在等待、哪个 agent 吃掉了最多 token。

打开 CC Harness 的 Session 监视器，它实时解析 session jsonl，用 React Flow 画出 subagent 五层调用树。每个节点显示用时、token 消耗和嵌套深度。Workflow 跑着时，这张图是你唯一能看懂"它在干什么"的窗口。

### 2. Hook 莫名其妙没生效，你不知道是没触发还是执行失败

你配了一个 `PostToolUse` hook，本该在 Claude 写文件后自动格式化代码。但代码一直没格式化——是 hook 没触发？触发了但报错了？settings.json 写对了吗？matcher 对上了吗？

CC Harness 的 Hook 沙箱让你给一个模拟输入直接 dry-run，看 stdout、stderr、exit code 和实际效果。不用真开 session、不用等 Claude 操作文件，一分钟验证 hook 是不是通的。

### 3. `/loop` 设了七个后台任务，但你不知道还有几个在跑

你用 `/loop` 让 Claude 后台盯着几个 PR、跑几个定时检查。三天过去了，你打开 Claude Code 发现有几个 session 已经消失，但不知道哪些 loop 还活着、哪些已经过期、哪些触发过几次。

CC Harness 的 Loop Wakeup 面板汇总所有 session 的 `ScheduleWakeup` 事件，按 pending / fired / expired 分类，告诉你每个 loop 的触发记录和剩余状态。

### 4. token 消耗远超预期，但你不知道钱花在哪

同样的任务，用不同的 skills 组合、不同的 subagent 嵌套深度，token 差距可以是几倍。`/usage` 能出分项数字，但数字散落在 CLI 输出里，跨 session 很难比。

CC Harness 的 Token Usage 面板把 skills / subagents / MCP / plugins / base session 各项拉过来做成面板，支持跨 session 横向对比——帮你找到"换 Sonnet 省 60%"在你这个项目里具体是多少。

### 5. 同事接手项目，三层配置全靠口口相传

项目里有 user 级 skill、project 级 command、plugin 带的 agent，还有几个 hook——但没有工具能一眼看清这些配置的覆盖关系。你很难解释"这个 skill 来自哪里、为什么这个 hook 会触发"。

CC Harness 的配置层把 Skills / Commands / Agents / Hooks 的三层来源（user / project / plugin）都列出来，标注覆盖关系，让任何人打开都能看懂当前项目的 harness 全貌。

### 6. 你写了十几个 skill，但不知道哪句 prompt 会命中哪个

skill 多了之后，"这个 skill 什么时候会被调用"变得越来越模糊。你不确定哪些关键词会触发它，也不清楚它的结构是什么。

CC Harness 的 Skills 页内置 Trigger 分析器，自动从 skill 内容提取触发关键词并按 action / technology / format / topic 分类，还能生成"什么样的 prompt 会激活这个 skill"的示例。同一个 skill 还有 Mermaid 结构图（可缩放、可切换 TD/LR 布局），蓝色是 skill 节点、绿色是引用、橙色是脚本、紫色是触发器，一图看清结构。

### 7. Skills、Hooks、MCP 之间的依赖关系你说不清楚

项目大了之后，哪个 skill 依赖哪个 MCP server、哪个 hook 会初始化哪个 MCP、哪个 command 会调用哪个 skill——这些关系散在各个配置文件里，没人能一眼说清楚。

CC Harness 的 Dependency Graph 自动从名称和内容里提取关键词，识别 Skills → MCP（uses）/ Hooks → MCP（initializes）/ Skills ↔ Hooks（configures）/ Commands → Skills（invokes）/ Commands → MCP（triggers）五种关系，并把有关联的节点组成带编号步骤的工作流叙事——整个 harness 的依赖拓扑一张图呈现。

---

## 五根支柱

**一、配置（Configure）** Claude Code 所有可改的地方，一网打尽且跟上 2.1.183 的现实——Skills / Commands 三层来源模型、Plugin Marketplace 多源多版本浏览、全类型 Hooks（MessageDisplay / PreCompact / HTTP / PostToolUse 输出替换）、`Tool(param:value)` 权限语法可视化构造、Worktree + managed settings + fallbackModel、CLAUDE.md 多项目编辑。

**二、调试（Debug）** 让你能"运行"一个 hook、一个 skill，看输入输出，不用在真实 session 里试错。Hook 沙箱执行器支持模拟输入 dry-run，看 stdout / stderr / blocked / 转换结果；session 监视开着时，hook 触发在时间线掉点，悬浮看 input/output。

**三、观测（Observe）** Live 看 Claude Code 在干什么——实时 tail session jsonl、画 subagent 五层调用树 + Workflow 编排图、Token 分项面板、Loop 调度面板、MCP 健康面板、Auto Memory 记忆视图 + dream 固化前后 diff。**这是项目最大差异化点：CLI 里看不到拓扑，CC Harness 把它画出来。**

**四、编排（Compose）** 把 CLAUDE.md + skills + hooks + commands 打包成可复用的业务 harness 模板，存、复用、导出成 plugin 格式；`/goal`、`/loop`、subagent 编排的 UI 具象化（路线图中）。

**五、教学（Teach）** 给全新项目目录，工具陪你走一遍：写 CLAUDE.md → 选 plugin → 配 hook → 设 `/goal`。文章 + 工具页面 + 实际配置三件套同步完成（路线图中）。

---

## 几个值得单独说的功能

### Dependency Graph — 不只是关系图，是工作流叙事

从 Skills / Hooks / MCP / Commands 的名称和内容里自动提取关键词，识别五类依赖关系，把有关联的节点聚合成带编号步骤的工作流链：

```
① Hook 触发 → ② MCP Server 启动 → ③ Skill 激活 → ④ MCP Tool 调用
```

CLI 看不到这张图。这是 CC Harness 里最接近"编排可视化"的功能。

### Skills Mermaid 图 + Trigger 分析

每个 skill 内置四个分析视图：**Overview**（引用/脚本/触发器统计）→ **Triggers**（关键词提取 + 命中示例 + 置信度分类）→ **Diagram**（Mermaid 结构图，可缩放，TD/LR 布局切换）→ **References**（关联资源）。

写了二十个 skill 还搞不清楚哪个会被触发——打开 Trigger 分析器，一秒看清。

### Session 时间线直方图

大 session 的事件流压缩进 60 个直方图桶，按 user\_turn / assistant\_turn / tool\_use / tool\_result 分层叠加显示，点击任意桶跳转到对应 turn。长时间运行的 Workflow session 里，这张图是快速定位"在哪一段出了问题"的第一入口。

### Memory Dream Diff

Auto Memory 每次固化（dream）前后，CC Harness 做快照对比：哪些记忆被合并、哪些过期项被删除、哪些矛盾被解决、浮现了哪些新模式——用 diff viewer 呈现，颜色标注 added / deleted / modified / merged / conflict-resolved 五种变化类型。dream 是黑盒——这是目前唯一能把它照亮的工具。

### Hook 沙箱的安全设计

干 run 时环境完全隔离：只暴露 `PATH / HOME / TMPDIR` 三个环境变量，不传 API token，不传任何用户凭证。输出解析支持 JSON block / exit code（2=block）/ stdout 三种决策格式，超时 30s 自动 SIGKILL，输出上限 1MB。测过再用，不用担心 dry-run 出副作用。

---

## 适合谁

- 重度使用 Claude Code 的开发者，想知道 session 里到底发生了什么
- 用 Workflow / subagent 编排跑复杂任务、需要可视化监控的人
- 配了很多 hooks、skills、MCP，想统一管理和调试的人
- 团队共用一套 Claude Code harness 配置，需要对齐和交接的人
- 关注 token 成本、想做跨 session 优化分析的人

---

## 不太适合谁

- 只想打开聊天框问问题，不关心 Claude Code 底层配置的人
- 不使用 Claude Code CLI，只用 claude.ai 网页版的人
- 期待一个自动管理 Claude Code 配置、不需要自己动手的工具的人

CC Harness 更适合把 Claude Code 当成一个需要调优和观测的系统来对待的人：你提供判断和配置，它帮你看见状态、验证效果、分析成本。

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

当前对齐 Claude Code 2.1.183。Claude Code 迭代很快，CC Harness 跟着主版本能力边界持续扩展——详见 [spec 文档](docs/harness-ide-spec/README.md) 的版本对应关系。

### 和 claudia 有什么不同？

claudia 是 GUI 对话客户端，替代 CLI 的交互入口。CC Harness 不做对话窗口，专注在 Claude Code 的**配置 / 调试 / 观测 / 编排**——是做完事情之后用来看清楚发生了什么的工具。

---

## 开源协议

[MIT](LICENSE)
