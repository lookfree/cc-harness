# CC Harness

![cc-harness-back](images/cc-harness-back.png)

Claude Code 的桌面工作台——配置 / 调试 / 观测 / 编排五件事合一。支持 **桌面（Electron）** 和 **Web** 两种运行模式。

## 功能概览

### 配置层
- **Skills**：浏览、搜索 Claude Code 技能，支持 user / project / plugin 三层来源与覆盖检测
- **Commands**：查看和编辑自定义斜杠命令，支持三层来源
- **Agents**：管理子代理配置（`.md` + YAML frontmatter）
- **Hooks**：配置 PreToolUse / PostToolUse / SessionStart 等各类 hook，支持沙箱执行与实时日志
- **Permissions**：可视化编辑 allow / deny / ask 权限规则，分 user / project / local 三层
- **MCP Servers**：管理 Model Context Protocol 服务器，支持连接探活与健康面板
- **AI Models**：模型治理面板，管理 Claude Code 模型切换开关
- **Plugins**：Plugin Marketplace 浏览器，查看已安装插件与市场可用插件
- **CLAUDE.md**：浏览和编辑多项目的 CLAUDE.md 文件

### 观测层
- **Sessions**：实时会话监视器，流式解析 session jsonl，展示工具调用 / token 用量 / 状态
- **Subagent 拓扑**：可视化 Workflow 编排中的 subagent 调用树（基于 reactflow）
- **Token Usage**：Token 用量面板，按会话 / 模型 / 时段统计
- **Loop Wakeups**：`/loop` 定时唤醒任务面板，展示 pending / fired / expired 状态

### 其他
- **Memory**：Auto Memory 记忆文件浏览与管理
- **Dependency Graph**：组件依赖关系可视化
- **Settings**：应用设置

## 运行模式

| 模式 | 命令 | 说明 |
|------|------|------|
| **桌面（Electron）** | `npm run electron:dev` | 完整功能，含实时推流、hook 执行、MCP 测试 |
| **Web** | `npm run web:dev` | 浏览器访问，Express API 后端，部分功能只读 |

## 技术栈

- **桌面**：Electron
- **后端（Web）**：Express.js
- **前端**：React 18 + TypeScript
- **UI**：shadcn/ui + Tailwind CSS + Radix UI
- **可视化**：React Flow
- **编辑器**：Monaco Editor
- **i18n**：i18next（中文 / 英文）
- **构建**：Vite

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/lookfree/cc-harness.git
cd cc-harness

# 安装依赖
npm install

# 桌面模式（主模式）
npm run electron:dev

# Web 模式
npm run web:dev
```

## 目录结构

```
cc-harness/
├── electron/
│   ├── main.ts                  # Electron 主进程入口
│   ├── preload.cjs              # contextBridge（必须 .cjs）
│   ├── ipc/                     # IPC handlers（每域一个文件）
│   └── services/                # 后端服务
│       ├── file-manager*.ts     # 配置读写（继承链，domain 拆分）
│       ├── settings-writer.ts   # read-modify-write 原子写
│       ├── session/             # session 解析 / 监视 / 拓扑
│       ├── loop/                # loop 定时唤醒发现
│       ├── memory/              # Auto Memory 读写
│       ├── mcp/                 # MCP 探活
│       └── hook-sandbox.ts      # hook 沙箱执行
├── server/
│   └── index.ts                 # Web 模式 Express API
├── src/
│   ├── pages/                   # 各功能页面
│   ├── components/
│   │   ├── layout/              # Layout + LanguageSwitcher
│   │   └── ui/                  # shadcn/ui 组件
│   ├── lib/api.ts               # 统一 API（自动探测 Electron / Web）
│   ├── i18n/                    # 国际化（en + zh）
│   └── stores/                  # Zustand 状态
├── shared/
│   └── types/                   # 主 / 渲染进程共享类型
├── docs/
│   ├── cc-harness演进路径.md    # 产品方向与 Phase 划分
│   └── harness-ide-spec/        # 23 个可执行实现 spec
└── package.json
```

## npm 脚本

| 脚本 | 说明 |
|------|------|
| `npm run electron:dev` | 启动桌面应用（热重载） |
| `npm run electron:build` | 打包桌面应用 |
| `npm run web:dev` | 启动 Web 模式（Express :3001 + Vite :5173） |
| `npm run web:build` | 构建 Web 前端 |
| `npm run lint` | ESLint |

## 配置文件读取位置

| 文件 | 说明 |
|------|------|
| `~/.claude/settings.json` | 全局设置（hooks / permissions / model） |
| `~/.claude/plugins/installed_plugins.json` | 已安装 plugin 列表 |
| `~/.claude/projects/<encoded-cwd>/<session>.jsonl` | 会话运行记录 |
| `~/.claude/projects/<encoded-cwd>/memory/` | Auto Memory |
| `<cwd>/.claude/settings.json` | 项目级设置 |
| `<cwd>/.claude/settings.local.json` | 本地覆盖（不入 git） |

## Web 模式 API 端点（只读）

| 端点 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET /api/skills` | 技能列表 |
| `GET /api/hooks` | hook 列表 |
| `GET /api/commands` | 命令列表 |
| `GET /api/mcp` | MCP 服务器列表 |
| `GET /api/sessions` | 会话列表 |
| `GET /api/loops` | loop 唤醒任务列表 |
| `GET /api/claudemd/all` | CLAUDE.md 文件列表 |

## 架构说明

```
渲染进程 api.xxx()
  └─ window.electronAPI (contextBridge preload.cjs)
       └─ ipcRenderer.invoke('domain:action')
            └─ 主进程 IPC handler (electron/ipc/*.ts)
                 └─ FileManager / 专项 service
                      └─ 文件系统 (~/.claude / <cwd>/.claude)

Web 模式：渲染进程 fetch('/api/xxx') → Express → 同一套 service
```

## License

MIT
