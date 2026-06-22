# CC Harness

![cc-harness-back](images/cc-harness-back.png)

> **把 Claude Code 的黑盒照亮。**

CC Harness 是围绕 Claude Code 的桌面工作台，提供**配置 / 调试 / 观测 / 编排 / 教学**五件事合一的可视化操作台。

Claude Code 已经从"单会话配置工具"长成了"多会话编排 + 自动循环 + 后台调度 + 可观测 + 可治理"的复杂系统——subagent 套五层、Workflow 编排几百个 agent、`/loop` 后台盯 PR、dream 黑盒固化记忆。每加一个能力就多一层不透明。CC Harness 的目标，是让你能回答这些问题：

- 这个 session 花了多少 token 在哪个 subagent 上？
- 我这个 hook 是不是在我没想到的时候触发了？
- 我设的那个 `/loop` 还在跑吗？
- 这个 MCP server 是不是经常超时？
- 那个 workflow 现在跑到第几个 agent 了？
- dream 把我的记忆改成了什么样？

支持 **桌面（Electron）** 和 **Web** 两种运行模式。

---

## 五根支柱

### 一、配置（Configure）
Claude Code 所有可改的地方，一网打尽且跟上 2.1.183 的现实。

- Skills / Commands 三层来源模型（user / project / plugin），覆盖检测、对比视图
- Plugin Marketplace 浏览器，多源多版本，查组件清单和 token 成本
- Hooks 全类型支持（MessageDisplay / PreCompact / HTTP hook / PostToolUse 输出替换等）
- 权限编辑器：`Tool(param:value)` 语法可视化构造，分层（user / project / local）
- Worktree、managed settings、fallbackModel、modelOverrides 全覆盖
- CLAUDE.md 多项目浏览与编辑

### 二、调试（Debug）
让你能"运行"一个 hook、一个 skill，看输入输出，不用在真实 session 里试错。

- Hook 沙箱执行器：给模拟输入 dry-run，看 stdout / stderr / blocked / 转换结果
- Hook 触发时间线：session 监视开着时，每次触发掉点，悬浮看 input/output
- 支持 MessageDisplay、PreCompact 等新 hook 的先试再用

### 三、观测（Observe）
Live 看 Claude Code 在干什么——这是项目最大差异化点。

- **Session 监视器**：tail session jsonl，实时解析 tool 调用、subagent spawn、token 分布
- **Subagent 拓扑图**：用 React Flow 实时画 subagent 五层调用树 + Workflow 编排图，每个节点显示用时、token、嵌套深度
- **Token / Usage 面板**：按 skills / subagents / MCP / plugins / base session 分项展示
- **Loop Wakeup 面板**：汇总所有 session 的 `/loop` 定时任务，pending / fired / expired 状态一览
- **MCP 健康面板**：每个 MCP server 连接状态、上次握手、暴露 tool 数、调用成功/失败/耗时
- **记忆面板**：Auto Memory 的 MEMORY.md + topic 文件可浏览，dream 固化前后 diff 可视化

### 四、编排（Compose）
把 CLAUDE.md + skills + hooks + commands + workflow 模板打包成可复用的业务 harness。

- 工作流模板管理：存、复用、导出成 plugin 格式
- `/goal`、`/loop`、subagent 编排的 UI 具象化
- Dynamic Workflows 可视化编辑器（计划中）

### 五、教学（Teach）
引导式配置，文章 + 工具页面 + 实际配置三件套同步走完。

- 给全新项目，工具陪你写 CLAUDE.md → 选 plugin → 配 hook → 设 `/goal`
- 对应 harness 系列文章的配套实验室

---

## 当前实现状态

| Phase | 内容 | 状态 |
|---|---|---|
| **Phase 0 · 止血** | build 时序修复、扫描报错降级、路径配置化、依赖核验 | ✅ 完成 |
| **Phase 1 · 配置层** | Skills 三层来源、Plugin 浏览器、Commands、Hooks 类型系统、权限编辑器、配置写入分层、模型治理、Worktree、Agents、MCP 升级 | ✅ 完成 |
| **Phase 2 · 观测层** | session jsonl 解析层、Session 监视器、Subagent 拓扑、Token Usage、Hook 沙箱、Loop 面板、MCP 健康、记忆面板 | ✅ 完成 |
| **Phase 3 · 编排教学** | 业务工作流模板、Harness Benchmark、Onboarding Tour | 规划中 |

详细 spec 见 [`docs/harness-ide-spec/`](docs/harness-ide-spec/README.md)（spec001–023，含验收标准和真实 file:line 引用）。

---

## 与同类工具的关系

| 工具 | 定位 | 与 CC Harness 的关系 |
|---|---|---|
| `claude config` / `claude agents` CLI | 官方管理入口 | 上游，不正面竞争；CC Harness 把 CLI 没暴露的东西可视化 |
| claudia | GUI 对话客户端 | 不交叉；CC Harness 不做对话窗口 |
| claude-code-templates | 模板市场 | 差异化在调试 + 观测 + 编排三根支柱 |
| LangSmith / DeepAgents Studio | 隔壁 harness 的 ops 面板 | 思想同源；CC Harness 死死围绕 Claude Code 一家 |

**护城河在观测**——CLI 的 inline 进度条只能看 agent 计数，看不到拓扑；subagent 套五层、Workflow 几百个 agent 时，CC Harness 是唯一能看懂"它在干什么"的窗口。

---

## 运行模式

| 模式 | 命令 | 说明 |
|------|------|------|
| **桌面（Electron）** | `npm run electron:dev` | 完整功能：实时推流、Hook 沙箱、MCP 测试、session 监视 |
| **Web** | `npm run web:dev` | 浏览器访问，只读浏览，Express API 后端 |

## 快速开始

```bash
git clone https://github.com/lookfree/cc-harness.git
cd cc-harness
npm install
npm run electron:dev
```

## 技术栈

- **桌面**：Electron + electron-builder
- **后端（Web）**：Express.js
- **前端**：React 18 + TypeScript + Vite
- **UI**：shadcn/ui + Tailwind CSS + Radix UI
- **可视化**：React Flow（subagent 拓扑图）
- **编辑器**：Monaco Editor
- **i18n**：i18next（中文 / 英文）
- **状态**：Zustand

## 目录结构

```
cc-harness/
├── electron/
│   ├── main.ts                  # Electron 主进程
│   ├── preload.cjs              # contextBridge
│   ├── ipc/                     # IPC handlers（每域一个文件）
│   └── services/
│       ├── file-manager*.ts     # 配置读写（继承链，domain 拆分）
│       ├── settings-writer.ts   # read-modify-write 原子写
│       ├── session/             # jsonl 解析 / 监视 / 拓扑
│       ├── loop/                # loop 唤醒发现
│       ├── memory/              # Auto Memory 读写
│       ├── mcp/                 # MCP 探活
│       └── hook-sandbox.ts      # Hook 沙箱执行
├── server/index.ts              # Web 模式 Express API
├── src/
│   ├── pages/                   # 15 个功能页面
│   ├── components/layout/       # 侧边栏 + 布局
│   ├── lib/api.ts               # 统一 API（自动探测 Electron / Web）
│   └── i18n/                    # 国际化（en + zh）
├── shared/types/                # 主/渲染进程共享类型
├── build/                       # 应用图标（icon.png / icon.icns）
└── docs/
    ├── cc-harness演进路径.md    # 产品方向与五支柱详述
    └── harness-ide-spec/        # 23 个实现 spec（含验收标准）
```

## 配置文件读取位置

| 文件 | 说明 |
|------|------|
| `~/.claude/settings.json` | 全局设置（hooks / permissions / model） |
| `~/.claude/plugins/installed_plugins.json` | 已安装 plugin 列表 |
| `~/.claude/projects/<encoded-cwd>/<session>.jsonl` | 会话运行记录（实时 tail） |
| `~/.claude/projects/<encoded-cwd>/memory/` | Auto Memory |
| `<cwd>/.claude/settings.json` | 项目级设置 |
| `<cwd>/.claude/settings.local.json` | 本地覆盖（不入 git） |

## License

MIT
