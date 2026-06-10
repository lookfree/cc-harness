# Forge M4+M4b 实施计划（Claude Code 配置管理迁移 + Git/Worktrees/Environment）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将老 Electron debugger 的全套 Claude Code 配置管理功能迁移至 Forge（M4），并新增 Git/Worktrees/Environment 页面（M4b）。Rust 后端替代所有 `window.api`/IPC 通道，文件监听改为 `notify` crate，前端复用老页面代码并替换调用方式。

**Architecture（M4）：** 新增 `forge/src-tauri/src/commands/claude_code/` 模块（skills/agents/hooks/mcp/commands/claudemd/graph/watcher），并注册全部 Tauri 命令；前端在 `forge/src/modules/claude-code/pages/` 中放置迁移后的页面（直接从 `src/pages/*.tsx` 复制改写），通过新建的 `forge/src/lib/tauri.ts` 包装 `invoke()`；导航栏新增 "Claude Code" 分组。

**Architecture（M4b）：** 新增 `commands/claude_code/git.rs`、`worktrees.rs`、`environment.rs`，依赖 `git2`/`notify`/`reqwest` crates；前端新增 Git.tsx / Worktrees.tsx / Environment.tsx（全新代码，inline style 深色主题）。

**Tech Stack:** 复用已有 tauri v2、rusqlite、serde_json、dirs、which；新增 `notify`、`git2`、`reqwest`（带 `rustls-tls`）依赖。

**Scope:** 仅覆盖设计文档 M4 + M4b（配置管理迁移、文件监听、Git、Worktrees、Environment）。不涉及使用管理、Codex 模块、Command Ref。

**约定：** 所有命令在仓库根目录 `/Users/wuhoujin/Documents/projects/superchat` 执行，除非另有说明。Rust 测试统一用 `cargo test --manifest-path forge/src-tauri/Cargo.toml`。

---

## 清单（Inventory）

### 迁移的老页面（`src/pages/` → `forge/src/modules/claude-code/pages/`）

| 老文件 | 新路径 |
|---|---|
| `src/pages/Skills.tsx` | `forge/src/modules/claude-code/pages/Skills.tsx` |
| `src/pages/Agents.tsx` | `forge/src/modules/claude-code/pages/Agents.tsx` |
| `src/pages/Hooks.tsx` | `forge/src/modules/claude-code/pages/Hooks.tsx` |
| `src/pages/MCP.tsx` | `forge/src/modules/claude-code/pages/MCP.tsx` |
| `src/pages/Commands.tsx` | `forge/src/modules/claude-code/pages/Commands.tsx` |
| `src/pages/ClaudeMd.tsx` | `forge/src/modules/claude-code/pages/ClaudeMd.tsx` |
| `src/pages/Graph.tsx` | `forge/src/modules/claude-code/pages/Graph.tsx` |

共 **7 个页面**迁移，加上新增 3 个（Git.tsx / Worktrees.tsx / Environment.tsx）共 **10 个页面**。

### 需要移植的 Electron IPC 通道

共 **34 条**通道，映射到新 Tauri 命令：

| Electron 通道 | 新 Tauri 命令 |
|---|---|
| `skills:getAll` | `get_skills` |
| `skills:get` | `get_skill` |
| `skills:save` | `save_skill` |
| `skills:delete` | `delete_skill` |
| `agents:getAll` | `get_agents` |
| `agents:get` | `get_agent` |
| `agents:save` | `save_agent` |
| `agents:delete` | `delete_agent` |
| `hooks:getAll` | `get_hooks` |
| `hooks:get` | `get_hook` |
| `hooks:save` | `save_hook` |
| `hooks:saveRaw` | `save_hook_raw` |
| `hooks:saveToSettings` | `save_hook_to_settings` |
| `hooks:delete` | `delete_hook` |
| `hooks:deleteFromSettings` | `delete_hook_from_settings` |
| `hooks:createScript` | `create_hook_script` |
| `hooks:readScript` | `read_hook_script` |
| `hooks:getLogs` | `get_hook_logs` |
| `hooks:getDebugLogs` | `get_hook_debug_logs` |
| `hooks:clearLogs` | `clear_hook_logs` |
| `hooks:launchDebugSession` | `launch_debug_session` |
| `hooks:stopDebugSession` | `stop_debug_session` |
| `hooks:test` | `test_hook` |
| `mcp:getAll` | `get_mcp_servers` |
| `mcp:get` | `get_mcp_server` |
| `mcp:save` | `save_mcp_server` |
| `mcp:delete` | `delete_mcp_server` |
| `mcp:test` | `test_mcp_connection` |
| `commands:getAll` | `get_slash_commands` |
| `commands:get` | `get_slash_command` |
| `commands:save` | `save_slash_command` |
| `commands:saveRaw` | `save_slash_command_raw` |
| `commands:delete` | `delete_slash_command` |
| `claudemd:get` | `get_claudemd` |
| `claudemd:getAll` | `get_all_claudemd` |
| `claudemd:save` | `save_claudemd` |
| `dependencies:getGraph` | `get_dependency_graph` |

M4b 新增命令（7 个 Git + 3 个 Worktrees + 5 个 Environment = **15 条**）：

| 新 Tauri 命令 | 用途 |
|---|---|
| `git_status` | 获取仓库状态 |
| `git_stage` | 暂存文件 |
| `git_commit` | 提交 |
| `git_push` | 推送（ssh-agent 凭据） |
| `git_branches` | 列出分支 |
| `git_checkout` | 切换分支 |
| `git_log` | 最近提交列表 |
| `list_worktrees` | 列出工作树 |
| `add_worktree` | 新建工作树 |
| `remove_worktree` | 删除工作树 |
| `detect_env_tools` | PATH 检测（claude/git/node/npm/pnpm/bun） |
| `get_env_vars` | 读取自定义环境变量（已有，复用 db::） |
| `set_env_var` | 新增/更新环境变量 |
| `delete_env_var` | 删除环境变量 |
| `test_api_connection` | 用 API Key 探测 Anthropic 连通性 |

### 需要从老应用迁移的前端依赖

需在 `forge/package.json` 新增：

```
tailwindcss postcss autoprefixer
@radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-icons
@radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator
@radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast
class-variance-authority clsx tailwind-merge lucide-react
i18next i18next-browser-languagedetector react-i18next
@monaco-editor/react
reactflow
zustand
date-fns
```

共需从老应用复制的 UI 文件：
- `src/components/ui/badge.tsx` `button.tsx` `card.tsx` `dialog.tsx` `input.tsx` `label.tsx` `select.tsx` `tabs.tsx` `textarea.tsx`
- `src/i18n/config.ts` `src/i18n/index.ts` `src/i18n/locales/` (全部)
- `shared/types/*.ts` (全部 7 个文件)
- `tailwind.config.js` + `postcss.config.js`（改写路径适配 forge 目录）

---

## Task 1: 添加 Rust 依赖 + 声明 claude_code 模块骨架

**Files:**
- Modify: `forge/src-tauri/Cargo.toml`（新增 notify, git2, reqwest）
- Create: `forge/src-tauri/src/commands/claude_code/mod.rs`（声明子模块）
- Create: `forge/src-tauri/src/commands/claude_code/skills.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/agents.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/hooks.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/mcp.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/slash_commands.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/claudemd.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/graph.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/watcher.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/git.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/worktrees.rs`（骨架）
- Create: `forge/src-tauri/src/commands/claude_code/environment.rs`（骨架）
- Modify: `forge/src-tauri/src/commands/mod.rs`（pub mod claude_code;）

- [x] **Step 1: 添加 Cargo 依赖**

编辑 `forge/src-tauri/Cargo.toml`，在 `[dependencies]` 末尾追加：

```toml
notify = { version = "8", default-features = false, features = ["macos_fsevent"] }
git2 = { version = "0.20", default-features = false, features = ["ssh", "ssh_key_from_memory"] }
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }
tokio = { version = "1", features = ["rt", "macros"] }
```

- [x] **Step 2: 创建 claude_code/mod.rs**

新建 `forge/src-tauri/src/commands/claude_code/mod.rs`：

```rust
pub mod agents;
pub mod claudemd;
pub mod environment;
pub mod git;
pub mod graph;
pub mod hooks;
pub mod mcp;
pub mod skills;
pub mod slash_commands;
pub mod watcher;
pub mod worktrees;
```

- [x] **Step 3: 创建各子模块骨架（所有函数体 todo!()）**

新建 `forge/src-tauri/src/commands/claude_code/skills.rs`：

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub location: String, // "user" | "project"
    pub dependencies: Option<Vec<String>>,
}

fn skills_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("skills")
}

pub fn get_skills(base_dir: &Path) -> Result<Vec<Skill>, String> { todo!() }
pub fn get_skill(base_dir: &Path, name: &str) -> Result<Option<Skill>, String> { todo!() }
pub fn save_skill(base_dir: &Path, skill: &Skill) -> Result<(), String> { todo!() }
pub fn delete_skill(base_dir: &Path, name: &str) -> Result<(), String> { todo!() }

#[tauri::command]
pub fn cmd_get_skills(base_dir: Option<String>) -> Result<Vec<Skill>, String> {
    let dir = resolve_base(base_dir)?;
    get_skills(&dir)
}
#[tauri::command]
pub fn cmd_get_skill(name: String, base_dir: Option<String>) -> Result<Option<Skill>, String> {
    let dir = resolve_base(base_dir)?;
    get_skill(&dir, &name)
}
#[tauri::command]
pub fn cmd_save_skill(skill: Skill, base_dir: Option<String>) -> Result<(), String> {
    let dir = resolve_base(base_dir)?;
    save_skill(&dir, &skill)
}
#[tauri::command]
pub fn cmd_delete_skill(name: String, base_dir: Option<String>) -> Result<(), String> {
    let dir = resolve_base(base_dir)?;
    delete_skill(&dir, &name)
}

fn resolve_base(base_dir: Option<String>) -> Result<PathBuf, String> {
    match base_dir {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir()
            .map(|h| h.join(".claude"))
            .ok_or_else(|| "cannot determine home dir".into()),
    }
}
```

以同样模式创建其余骨架文件，函数签名按清单填写，函数体 `todo!()`。

- [x] **Step 4: 注册 pub mod**

编辑 `forge/src-tauri/src/commands/mod.rs`，追加：

```rust
pub mod claude_code;
```

- [x] **Step 5: 验证编译**

```bash
cargo check --manifest-path forge/src-tauri/Cargo.toml 2>&1 | head -30
```

- [x] **Step 6: 提交**

```bash
git add forge/src-tauri/
git commit -m "feat(m4): scaffold claude_code commands module + add notify/git2/reqwest deps"
```

---

## Task 2: 前端基础设施 — Tailwind + shadcn UI + i18n + shared/types

**Files:**
- Create: `forge/tailwind.config.js`
- Create: `forge/postcss.config.js`
- Modify: `forge/vite.config.ts`（PostCSS）
- Modify: `forge/package.json`（新增前端依赖）
- Create: `forge/src/components/ui/`（复制 8 个 shadcn 组件）
- Create: `forge/src/i18n/`（复制 config.ts / index.ts / locales/）
- Create: `forge/src/lib/types/`（复制 shared/types/*.ts）
- Create: `forge/src/index.css`（Tailwind 指令）
- Modify: `forge/src/main.tsx`（import i18n, import index.css）

- [x] **Step 1: 安装前端依赖**

```bash
cd forge && npm install \
  tailwindcss postcss autoprefixer \
  @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-icons \
  @radix-ui/react-label @radix-ui/react-select @radix-ui/react-separator \
  @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-toast \
  class-variance-authority clsx tailwind-merge lucide-react \
  i18next i18next-browser-languagedetector react-i18next \
  @monaco-editor/react reactflow zustand date-fns
```

- [x] **Step 2: 初始化 Tailwind**

新建 `forge/tailwind.config.js`：

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
    },
  },
  plugins: [],
}
```

新建 `forge/postcss.config.js`：

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

- [x] **Step 3: 创建 index.css（Tailwind 指令 + CSS 变量）**

新建 `forge/src/index.css`（深色主题 CSS 变量，与老 `src/index.css` 保持一致）：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 6%;
    --foreground: 0 0% 90%;
    --card: 0 0% 8%;
    --card-foreground: 0 0% 90%;
    --popover: 0 0% 8%;
    --popover-foreground: 0 0% 90%;
    --primary: 217 91% 60%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 12%;
    --secondary-foreground: 0 0% 90%;
    --muted: 0 0% 12%;
    --muted-foreground: 0 0% 64%;
    --accent: 0 0% 12%;
    --accent-foreground: 0 0% 90%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 12%;
    --input: 0 0% 12%;
    --ring: 217 91% 60%;
    --radius: 0.5rem;
  }
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
}
```

- [x] **Step 4: 复制 shadcn UI 组件**

```bash
mkdir -p forge/src/components/ui
cp src/components/ui/badge.tsx \
   src/components/ui/button.tsx \
   src/components/ui/card.tsx \
   src/components/ui/dialog.tsx \
   src/components/ui/input.tsx \
   src/components/ui/label.tsx \
   src/components/ui/select.tsx \
   src/components/ui/tabs.tsx \
   src/components/ui/textarea.tsx \
   forge/src/components/ui/
```

将每个组件中的 `@/lib/utils` 导入路径改为相对路径（如 `../../lib/utils`）。

- [x] **Step 5: 创建 utils.ts**

新建 `forge/src/lib/utils.ts`：

```typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [x] **Step 6: 复制 i18n + shared/types**

```bash
mkdir -p forge/src/i18n forge/src/lib/types
cp src/i18n/config.ts src/i18n/index.ts forge/src/i18n/
cp -r src/i18n/locales forge/src/i18n/
cp shared/types/skill.ts shared/types/agent.ts shared/types/hook.ts \
   shared/types/mcp.ts shared/types/command.ts shared/types/claudemd.ts \
   shared/types/provider.ts shared/types/index.ts \
   forge/src/lib/types/
```

i18n 文件中的导入路径（相对路径）保持不变；types/index.ts 中移除 `provider` 导出（M3 已单独管理）。

- [x] **Step 7: 修改 main.tsx**

在 `forge/src/main.tsx` 顶部添加：

```typescript
import './index.css'
import './i18n'
```

- [x] **Step 8: 验证前端构建**

```bash
cd forge && npm run build 2>&1 | tail -20
```

- [x] **Step 9: 提交**

```bash
git add forge/
git commit -m "feat(m4): add tailwind + shadcn ui + i18n + shared types to forge frontend"
```

---

## Task 3: Rust — skills/agents/claudemd/graph 命令（TDD）

**Files:**
- Implement: `forge/src-tauri/src/commands/claude_code/skills.rs`（完整实现）
- Implement: `forge/src-tauri/src/commands/claude_code/agents.rs`（完整实现）
- Implement: `forge/src-tauri/src/commands/claude_code/claudemd.rs`（完整实现）
- Implement: `forge/src-tauri/src/commands/claude_code/graph.rs`（完整实现）

- [x] **Step 1: TDD Red — 写失败测试**

在 `skills.rs` 末尾加：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn get_skills_empty_dir() {
        let dir = tempdir().unwrap();
        let base = dir.path().to_path_buf();
        // skills/ subdir does not exist yet
        let skills = get_skills(&base).unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn save_and_get_skill_roundtrip() {
        let dir = tempdir().unwrap();
        let base = dir.path().to_path_buf();
        let skill = Skill {
            name: "test-skill".into(),
            description: "A test".into(),
            content: Some("# test".into()),
            file_path: None,
            location: "user".into(),
            dependencies: None,
        };
        save_skill(&base, &skill).unwrap();
        let loaded = get_skill(&base, "test-skill").unwrap().unwrap();
        assert_eq!(loaded.description, "A test");
    }

    #[test]
    fn delete_skill_removes_file() {
        let dir = tempdir().unwrap();
        let base = dir.path().to_path_buf();
        let skill = Skill {
            name: "to-delete".into(),
            description: "del".into(),
            content: None,
            file_path: None,
            location: "user".into(),
            dependencies: None,
        };
        save_skill(&base, &skill).unwrap();
        delete_skill(&base, "to-delete").unwrap();
        assert!(get_skill(&base, "to-delete").unwrap().is_none());
    }
}
```

类似地在 `agents.rs`、`claudemd.rs`、`graph.rs` 中写对应失败测试。

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep -E "FAILED|error" | head -20
```

- [x] **Step 2: Green — 实现 skills.rs**

完整实现：

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub location: String,
    pub dependencies: Option<Vec<String>>,
}

fn skills_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("skills")
}

pub fn get_skills(base_dir: &Path) -> Result<Vec<Skill>, String> {
    let dir = skills_dir(base_dir);
    if !dir.exists() { return Ok(vec![]); }
    let mut skills = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            skills.push(Skill {
                name,
                description: extract_frontmatter_field(&raw, "description")
                    .unwrap_or_default(),
                content: Some(raw),
                file_path: Some(path.to_string_lossy().to_string()),
                location: "user".into(),
                dependencies: None,
            });
        }
    }
    Ok(skills)
}

pub fn get_skill(base_dir: &Path, name: &str) -> Result<Option<Skill>, String> {
    Ok(get_skills(base_dir)?.into_iter().find(|s| s.name == name))
}

pub fn save_skill(base_dir: &Path, skill: &Skill) -> Result<(), String> {
    let dir = skills_dir(base_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.md", skill.name));
    let content = skill.content.clone().unwrap_or_else(|| {
        format!("---\nname: {}\ndescription: {}\n---\n", skill.name, skill.description)
    });
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn delete_skill(base_dir: &Path, name: &str) -> Result<(), String> {
    let path = skills_dir(base_dir).join(format!("{}.md", name));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn extract_frontmatter_field(content: &str, field: &str) -> Option<String> {
    let fm = content.strip_prefix("---\n")?.split("\n---").next()?;
    fm.lines()
        .find(|l| l.starts_with(&format!("{}:", field)))
        .map(|l| l[field.len() + 1..].trim().to_string())
}

fn resolve_base(base_dir: Option<String>) -> Result<PathBuf, String> {
    match base_dir {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir()
            .map(|h| h.join(".claude"))
            .ok_or_else(|| "cannot determine home dir".into()),
    }
}

#[tauri::command]
pub fn cmd_get_skills(base_dir: Option<String>) -> Result<Vec<Skill>, String> {
    get_skills(&resolve_base(base_dir)?)
}
#[tauri::command]
pub fn cmd_get_skill(name: String, base_dir: Option<String>) -> Result<Option<Skill>, String> {
    get_skill(&resolve_base(base_dir)?, &name)
}
#[tauri::command]
pub fn cmd_save_skill(skill: Skill, base_dir: Option<String>) -> Result<(), String> {
    save_skill(&resolve_base(base_dir)?, &skill)
}
#[tauri::command]
pub fn cmd_delete_skill(name: String, base_dir: Option<String>) -> Result<(), String> {
    delete_skill(&resolve_base(base_dir)?, &name)
}
```

- [x] **Step 3: Green — 实现 agents.rs**

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub name: String,
    pub description: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub location: String,
    pub dependencies: Option<Vec<String>>,
}

fn agents_dir(base_dir: &Path) -> PathBuf { base_dir.join("agents") }

pub fn get_agents(base_dir: &Path) -> Result<Vec<Agent>, String> {
    let dir = agents_dir(base_dir);
    if !dir.exists() { return Ok(vec![]); }
    let mut agents = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            agents.push(Agent {
                name: path.file_stem().unwrap().to_string_lossy().to_string(),
                description: extract_frontmatter_field(&raw, "description").unwrap_or_default(),
                content: Some(raw),
                file_path: Some(path.to_string_lossy().to_string()),
                location: "user".into(),
                dependencies: None,
            });
        }
    }
    Ok(agents)
}

pub fn get_agent(base_dir: &Path, name: &str) -> Result<Option<Agent>, String> {
    Ok(get_agents(base_dir)?.into_iter().find(|a| a.name == name))
}

pub fn save_agent(base_dir: &Path, agent: &Agent) -> Result<(), String> {
    let dir = agents_dir(base_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = agent.content.clone().unwrap_or_else(|| {
        format!("---\nname: {}\ndescription: {}\n---\n", agent.name, agent.description)
    });
    fs::write(dir.join(format!("{}.md", agent.name)), content).map_err(|e| e.to_string())
}

pub fn delete_agent(base_dir: &Path, name: &str) -> Result<(), String> {
    let path = agents_dir(base_dir).join(format!("{}.md", name));
    if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
    Ok(())
}

fn extract_frontmatter_field(content: &str, field: &str) -> Option<String> {
    let fm = content.strip_prefix("---\n")?.split("\n---").next()?;
    fm.lines()
        .find(|l| l.starts_with(&format!("{}:", field)))
        .map(|l| l[field.len() + 1..].trim().to_string())
}

fn resolve_base(b: Option<String>) -> Result<PathBuf, String> {
    match b {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude"))
            .ok_or_else(|| "no home dir".into()),
    }
}

#[tauri::command] pub fn cmd_get_agents(base_dir: Option<String>) -> Result<Vec<Agent>, String> { get_agents(&resolve_base(base_dir)?) }
#[tauri::command] pub fn cmd_get_agent(name: String, base_dir: Option<String>) -> Result<Option<Agent>, String> { get_agent(&resolve_base(base_dir)?, &name) }
#[tauri::command] pub fn cmd_save_agent(agent: Agent, base_dir: Option<String>) -> Result<(), String> { save_agent(&resolve_base(base_dir)?, &agent) }
#[tauri::command] pub fn cmd_delete_agent(name: String, base_dir: Option<String>) -> Result<(), String> { delete_agent(&resolve_base(base_dir)?, &name) }

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn agent_roundtrip() {
        let dir = tempdir().unwrap();
        let agent = Agent { name: "ag".into(), description: "d".into(), content: None, file_path: None, location: "user".into(), dependencies: None };
        save_agent(dir.path(), &agent).unwrap();
        assert!(get_agent(dir.path(), "ag").unwrap().is_some());
        delete_agent(dir.path(), "ag").unwrap();
        assert!(get_agent(dir.path(), "ag").unwrap().is_none());
    }
}
```

- [x] **Step 4: Green — 实现 claudemd.rs**

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use crate::config::atomic::write_atomic;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeMdFile {
    pub location: String,  // "user" | "project"
    pub file_path: String,
    pub content: String,
    pub exists: bool,
}

pub fn get_claudemd(base_dir: &Path) -> Result<ClaudeMdFile, String> {
    let path = base_dir.join("CLAUDE.md");
    let exists = path.exists();
    let content = if exists {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    Ok(ClaudeMdFile {
        location: "user".into(),
        file_path: path.to_string_lossy().to_string(),
        content,
        exists,
    })
}

pub fn get_all_claudemd(base_dir: &Path, project_path: Option<&Path>) -> Result<Vec<ClaudeMdFile>, String> {
    let mut files = vec![get_claudemd(base_dir)?];
    if let Some(proj) = project_path {
        let path = proj.join("CLAUDE.md");
        let exists = path.exists();
        let content = if exists { fs::read_to_string(&path).unwrap_or_default() } else { String::new() };
        files.push(ClaudeMdFile {
            location: "project".into(),
            file_path: path.to_string_lossy().to_string(),
            content,
            exists,
        });
    }
    Ok(files)
}

pub fn save_claudemd(path: &Path, content: &str) -> Result<(), String> {
    if let Some(p) = path.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(path, content)
}

fn resolve_base(b: Option<String>) -> Result<PathBuf, String> {
    match b {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude")).ok_or_else(|| "no home".into()),
    }
}

#[tauri::command]
pub fn cmd_get_claudemd(base_dir: Option<String>) -> Result<ClaudeMdFile, String> {
    get_claudemd(&resolve_base(base_dir)?)
}
#[tauri::command]
pub fn cmd_get_all_claudemd(base_dir: Option<String>, project_path: Option<String>) -> Result<Vec<ClaudeMdFile>, String> {
    get_all_claudemd(&resolve_base(base_dir)?, project_path.as_deref().map(Path::new))
}
#[tauri::command]
pub fn cmd_save_claudemd(file_path: String, content: String) -> Result<(), String> {
    save_claudemd(Path::new(&file_path), &content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn get_missing_claudemd_returns_empty() {
        let dir = tempdir().unwrap();
        let f = get_claudemd(dir.path()).unwrap();
        assert!(!f.exists);
        assert!(f.content.is_empty());
    }

    #[test]
    fn save_and_reload_claudemd() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("CLAUDE.md");
        save_claudemd(&path, "# Hello").unwrap();
        let f = get_claudemd(dir.path()).unwrap();
        assert!(f.exists);
        assert_eq!(f.content, "# Hello");
    }
}
```

- [x] **Step 5: Green — 实现 graph.rs**

```rust
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct DependencyNode {
    pub id: String,
    pub node_type: String, // "skill" | "agent" | "hook" | "command"
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DependencyEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub edge_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DependencyGraph {
    pub nodes: Vec<DependencyNode>,
    pub edges: Vec<DependencyEdge>,
}

pub fn get_dependency_graph(base_dir: &Path) -> Result<DependencyGraph, String> {
    let skills = super::skills::get_skills(base_dir)?;
    let agents = super::agents::get_agents(base_dir)?;

    let mut nodes = vec![];
    let mut edges = vec![];

    for s in &skills {
        nodes.push(DependencyNode { id: s.name.clone(), node_type: "skill".into(), name: s.name.clone() });
        if let Some(deps) = &s.dependencies {
            for dep in deps {
                edges.push(DependencyEdge {
                    id: format!("{}->{}", s.name, dep),
                    source: s.name.clone(),
                    target: dep.clone(),
                    edge_type: "depends-on".into(),
                });
            }
        }
    }
    for a in &agents {
        nodes.push(DependencyNode { id: a.name.clone(), node_type: "agent".into(), name: a.name.clone() });
        if let Some(deps) = &a.dependencies {
            for dep in deps {
                edges.push(DependencyEdge {
                    id: format!("{}->{}", a.name, dep),
                    source: a.name.clone(),
                    target: dep.clone(),
                    edge_type: "depends-on".into(),
                });
            }
        }
    }
    Ok(DependencyGraph { nodes, edges })
}

fn resolve_base(b: Option<String>) -> Result<std::path::PathBuf, String> {
    match b {
        Some(d) => Ok(std::path::PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude")).ok_or_else(|| "no home".into()),
    }
}

#[tauri::command]
pub fn cmd_get_dependency_graph(base_dir: Option<String>) -> Result<DependencyGraph, String> {
    get_dependency_graph(&resolve_base(base_dir)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn empty_dirs_returns_empty_graph() {
        let dir = tempdir().unwrap();
        let g = get_dependency_graph(dir.path()).unwrap();
        assert!(g.nodes.is_empty());
        assert!(g.edges.is_empty());
    }
}
```

- [x] **Step 6: 运行测试（Green）**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml \
  claude_code::skills \
  claude_code::agents \
  claude_code::claudemd \
  claude_code::graph \
  2>&1 | grep -E "test .* ok|FAILED|error"
```

- [x] **Step 7: 提交**

```bash
git add forge/src-tauri/src/commands/claude_code/
git commit -m "feat(m4): implement skills/agents/claudemd/graph Rust commands (TDD green)"
```

---

## Task 4: Rust — slash_commands/mcp/hooks 命令（TDD）

**Files:**
- Implement: `forge/src-tauri/src/commands/claude_code/slash_commands.rs`
- Implement: `forge/src-tauri/src/commands/claude_code/mcp.rs`
- Implement: `forge/src-tauri/src/commands/claude_code/hooks.rs`

- [x] **Step 1: TDD Red — 各模块失败测试**

slash_commands 测试：save/delete/list roundtrip（tempdir）。
mcp 测试：save server → get_mcp_servers 返回 1 条，delete 后返回 0。
hooks 测试：save_hook → get_hooks 返回 1 条，delete 后返回 0；get_hook_logs 初始返回空。

- [x] **Step 2: Green — 实现 slash_commands.rs**

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use crate::config::atomic::write_atomic;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashCommand {
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub file_path: Option<String>,
    pub location: String,
}

fn commands_dir(base_dir: &Path) -> PathBuf { base_dir.join("commands") }

pub fn get_slash_commands(base_dir: &Path) -> Result<Vec<SlashCommand>, String> {
    let dir = commands_dir(base_dir);
    if !dir.exists() { return Ok(vec![]); }
    let mut cmds = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            cmds.push(SlashCommand {
                name: path.file_stem().unwrap().to_string_lossy().to_string(),
                description: None,
                content,
                file_path: Some(path.to_string_lossy().to_string()),
                location: "user".into(),
            });
        }
    }
    Ok(cmds)
}

pub fn get_slash_command(base_dir: &Path, name: &str) -> Result<Option<SlashCommand>, String> {
    Ok(get_slash_commands(base_dir)?.into_iter().find(|c| c.name == name))
}

pub fn save_slash_command(base_dir: &Path, cmd: &SlashCommand) -> Result<(), String> {
    let dir = commands_dir(base_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{}.md", cmd.name)), &cmd.content)
}

pub fn save_slash_command_raw(base_dir: &Path, name: &str, content: &str, rel_path: &str) -> Result<(), String> {
    let target = if rel_path.is_empty() {
        commands_dir(base_dir).join(format!("{}.md", name))
    } else {
        base_dir.join(rel_path)
    };
    if let Some(p) = target.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(&target, content)
}

pub fn delete_slash_command(base_dir: &Path, name: &str) -> Result<(), String> {
    let path = commands_dir(base_dir).join(format!("{}.md", name));
    if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
    Ok(())
}

fn resolve_base(b: Option<String>) -> Result<PathBuf, String> {
    match b {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude")).ok_or_else(|| "no home".into()),
    }
}

#[tauri::command] pub fn cmd_get_slash_commands(base_dir: Option<String>) -> Result<Vec<SlashCommand>, String> { get_slash_commands(&resolve_base(base_dir)?) }
#[tauri::command] pub fn cmd_get_slash_command(name: String, base_dir: Option<String>) -> Result<Option<SlashCommand>, String> { get_slash_command(&resolve_base(base_dir)?, &name) }
#[tauri::command] pub fn cmd_save_slash_command(cmd: SlashCommand, base_dir: Option<String>) -> Result<(), String> { save_slash_command(&resolve_base(base_dir)?, &cmd) }
#[tauri::command] pub fn cmd_save_slash_command_raw(name: String, content: String, file_path: String, base_dir: Option<String>) -> Result<(), String> { save_slash_command_raw(&resolve_base(base_dir)?, &name, &content, &file_path) }
#[tauri::command] pub fn cmd_delete_slash_command(name: String, base_dir: Option<String>) -> Result<(), String> { delete_slash_command(&resolve_base(base_dir)?, &name) }

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn slash_command_roundtrip() {
        let dir = tempdir().unwrap();
        let cmd = SlashCommand { name: "foo".into(), description: None, content: "# foo".into(), file_path: None, location: "user".into() };
        save_slash_command(dir.path(), &cmd).unwrap();
        let loaded = get_slash_command(dir.path(), "foo").unwrap().unwrap();
        assert_eq!(loaded.content, "# foo");
        delete_slash_command(dir.path(), "foo").unwrap();
        assert!(get_slash_command(dir.path(), "foo").unwrap().is_none());
    }
}
```

- [x] **Step 3: Green — 实现 mcp.rs**

MCP 服务器配置存于 `settings.json` 的 `mcpServers` 字段（`serde_json::Value`，preserve-unknown-fields）：

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use crate::config::{atomic::write_atomic, claude::read_json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub name: String,
    pub config: Value,
}

fn settings_path(base_dir: &Path) -> PathBuf { base_dir.join("settings.json") }

pub fn get_mcp_servers(base_dir: &Path) -> Result<Vec<McpServer>, String> {
    let doc = read_json(&settings_path(base_dir))?;
    let servers = doc.get("mcpServers")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    Ok(servers.into_iter().map(|(k, v)| McpServer { name: k, config: v }).collect())
}

pub fn save_mcp_server(base_dir: &Path, name: &str, config: Value) -> Result<(), String> {
    let path = settings_path(base_dir);
    let mut doc = read_json(&path)?;
    let obj = doc.as_object_mut().ok_or("settings.json root not object")?;
    let mcp = obj.entry("mcpServers").or_insert(Value::Object(Default::default()));
    mcp.as_object_mut().ok_or("mcpServers not object")?.insert(name.to_string(), config);
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(&path, &pretty)
}

pub fn delete_mcp_server(base_dir: &Path, name: &str) -> Result<(), String> {
    let path = settings_path(base_dir);
    let mut doc = read_json(&path)?;
    if let Some(mcp) = doc.as_object_mut().and_then(|o| o.get_mut("mcpServers")).and_then(|v| v.as_object_mut()) {
        mcp.remove(name);
    }
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    write_atomic(&path, &pretty)
}

pub fn test_mcp_connection(_name: &str) -> Result<bool, String> {
    // Placeholder: real connection test requires per-server protocol knowledge
    Ok(false)
}

fn resolve_base(b: Option<String>) -> Result<PathBuf, String> {
    match b {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude")).ok_or_else(|| "no home".into()),
    }
}

#[tauri::command] pub fn cmd_get_mcp_servers(base_dir: Option<String>) -> Result<Vec<McpServer>, String> { get_mcp_servers(&resolve_base(base_dir)?) }
#[tauri::command] pub fn cmd_save_mcp_server(name: String, config: Value, base_dir: Option<String>) -> Result<(), String> { save_mcp_server(&resolve_base(base_dir)?, &name, config) }
#[tauri::command] pub fn cmd_delete_mcp_server(name: String, base_dir: Option<String>) -> Result<(), String> { delete_mcp_server(&resolve_base(base_dir)?, &name) }
#[tauri::command] pub fn cmd_test_mcp_connection(name: String) -> Result<bool, String> { test_mcp_connection(&name) }

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use serde_json::json;

    #[test]
    fn mcp_save_delete_roundtrip() {
        let dir = tempdir().unwrap();
        save_mcp_server(dir.path(), "my-server", json!({"command": "npx", "args": ["-y", "my-mcp"]})).unwrap();
        let servers = get_mcp_servers(dir.path()).unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "my-server");
        delete_mcp_server(dir.path(), "my-server").unwrap();
        assert!(get_mcp_servers(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn mcp_save_preserves_other_settings_fields() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"hooks":{},"unknownField":"keep"}"#).unwrap();
        save_mcp_server(dir.path(), "srv", json!({})).unwrap();
        let doc = read_json(&path).unwrap();
        assert_eq!(doc["unknownField"], "keep");
    }
}
```

- [x] **Step 4: Green — 实现 hooks.rs**

Hooks 存于 `settings.json` 的 `hooks` 字段，同时支持独立 `.md` 脚本文件和 debug log 解析：

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use crate::config::{atomic::write_atomic, claude::read_json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookEntry {
    pub name: String,
    pub hook_type: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookExecutionLog {
    pub id: String,
    pub hook_name: String,
    pub hook_type: String,
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timestamp: i64,
    pub success: bool,
}

// In-process log store (per process lifetime, max 100)
static EXEC_LOGS: Mutex<Vec<HookExecutionLog>> = Mutex::new(Vec::new());

fn settings_path(base_dir: &Path) -> PathBuf { base_dir.join("settings.json") }
fn hooks_dir(base_dir: &Path) -> PathBuf { base_dir.join("hooks") }

pub fn get_hooks(base_dir: &Path) -> Result<Vec<HookEntry>, String> {
    let doc = read_json(&settings_path(base_dir))?;
    let hooks_val = doc.get("hooks").cloned().unwrap_or(Value::Object(Default::default()));
    let mut result = vec![];
    if let Some(obj) = hooks_val.as_object() {
        for (hook_type, matchers) in obj {
            if let Some(arr) = matchers.as_array() {
                for (i, matcher) in arr.iter().enumerate() {
                    result.push(HookEntry {
                        name: format!("{}-{}", hook_type, i),
                        hook_type: hook_type.clone(),
                        content: Some(matcher.to_string()),
                        file_path: None,
                        location: "user".into(),
                    });
                }
            }
        }
    }
    Ok(result)
}

pub fn save_hook_to_settings(
    base_dir: &Path,
    hook_type: &str,
    hook_config: Value,
    _location: &str,
    matcher_index: Option<usize>,
) -> Result<(), String> {
    let path = settings_path(base_dir);
    let mut doc = read_json(&path)?;
    let obj = doc.as_object_mut().ok_or("settings not object")?;
    let hooks = obj.entry("hooks").or_insert(Value::Object(Default::default()));
    let hooks_obj = hooks.as_object_mut().ok_or("hooks not object")?;
    let list = hooks_obj.entry(hook_type).or_insert(Value::Array(vec![]));
    let arr = list.as_array_mut().ok_or("hook list not array")?;
    match matcher_index {
        Some(i) if i < arr.len() => arr[i] = hook_config,
        _ => arr.push(hook_config),
    }
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    if let Some(p) = path.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(&path, &pretty)
}

pub fn delete_hook_from_settings(
    base_dir: &Path,
    hook_type: &str,
    matcher_index: usize,
    _location: &str,
) -> Result<(), String> {
    let path = settings_path(base_dir);
    let mut doc = read_json(&path)?;
    if let Some(arr) = doc.as_object_mut()
        .and_then(|o| o.get_mut("hooks"))
        .and_then(|h| h.as_object_mut())
        .and_then(|h| h.get_mut(hook_type))
        .and_then(|l| l.as_array_mut())
    {
        if matcher_index < arr.len() { arr.remove(matcher_index); }
    }
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    write_atomic(&path, &pretty)
}

pub fn create_hook_script(path: &Path, content: &str) -> Result<String, String> {
    if let Some(p) = path.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    fs::write(path, content).map_err(|e| e.to_string())?;
    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

pub fn read_hook_script(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn get_hook_logs() -> Vec<HookExecutionLog> {
    EXEC_LOGS.lock().unwrap().clone()
}

pub fn clear_hook_logs() {
    EXEC_LOGS.lock().unwrap().clear();
}

pub fn get_hook_debug_logs(base_dir: &Path) -> Result<Vec<HookExecutionLog>, String> {
    let debug_dir = base_dir.join("debug");
    if !debug_dir.exists() { return Ok(vec![]); }
    // Parse debug log files — each line: "TIMESTAMP [LEVEL] message"
    let mut logs = vec![];
    let entries = fs::read_dir(&debug_dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("log") {
            if let Ok(content) = fs::read_to_string(&p) {
                for (i, line) in content.lines().enumerate() {
                    if line.contains("hook") || line.contains("Hook") {
                        logs.push(HookExecutionLog {
                            id: format!("debug-{}-{}", p.file_name().unwrap().to_string_lossy(), i),
                            hook_name: "debug".into(),
                            hook_type: "debug".into(),
                            command: String::new(),
                            exit_code: None,
                            stdout: line.to_string(),
                            stderr: String::new(),
                            duration_ms: 0,
                            timestamp: 0,
                            success: true,
                        });
                    }
                }
            }
        }
    }
    Ok(logs)
}

/// Launch `claude --debug` (optionally with a test prompt) in an external terminal.
/// Returns { success, message, pid }
pub fn launch_debug_session(
    hook_type: &str,
    project_path: Option<&str>,
) -> Result<serde_json::Value, String> {
    use std::process::Command as Cmd;
    let working_dir = project_path.unwrap_or(".");
    let test_prompt = hook_test_prompt(hook_type);
    let claude_args = if test_prompt.is_empty() {
        "--debug".to_string()
    } else {
        format!("--debug -p '{}'", test_prompt.replace('\'', "'\\''"))
    };
    let script = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"cd '{}' && claude {}\"\nend tell",
        working_dir, claude_args
    );
    let child = Cmd::new("osascript")
        .arg("-e").arg(&script)
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.id();
    Ok(serde_json::json!({ "success": true, "message": "Terminal launched", "pid": pid }))
}

pub fn stop_debug_session(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, libc::SIGTERM) == 0 }
}

/// Map hook type to a suitable test prompt (empty = interactive mode).
fn hook_test_prompt(hook_type: &str) -> &'static str {
    match hook_type {
        "SessionStart" => "",
        "SessionEnd" => "Say goodbye",
        "PreToolUse" | "PostToolUse" => "Read the file package.json and tell me the project name",
        "UserPromptSubmit" => "Hello, this is a test prompt for UserPromptSubmit hook",
        "Notification" => "Search for any TODO comments in this project",
        "Stop" => "Count from 1 to 5",
        "SubagentStart" | "SubagentStop" => "Use the Task tool to search for README files",
        "PreCompact" => "This is a test for PreCompact hook. Please respond briefly.",
        _ => "Hello, this is a hook test",
    }
}

fn resolve_base(b: Option<String>) -> Result<PathBuf, String> {
    match b {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude")).ok_or_else(|| "no home".into()),
    }
}

#[tauri::command]
pub fn cmd_get_hooks(base_dir: Option<String>) -> Result<Vec<HookEntry>, String> { get_hooks(&resolve_base(base_dir)?) }
#[tauri::command]
pub fn cmd_save_hook_to_settings(hook_type: String, hook_config: Value, location: String, base_dir: Option<String>, matcher_index: Option<usize>) -> Result<(), String> {
    save_hook_to_settings(&resolve_base(base_dir)?, &hook_type, hook_config, &location, matcher_index)
}
#[tauri::command]
pub fn cmd_delete_hook_from_settings(hook_type: String, matcher_index: usize, location: String, base_dir: Option<String>) -> Result<(), String> {
    delete_hook_from_settings(&resolve_base(base_dir)?, &hook_type, matcher_index, &location)
}
#[tauri::command]
pub fn cmd_create_hook_script(script_path: String, content: String) -> Result<String, String> {
    create_hook_script(Path::new(&script_path), &content)
}
#[tauri::command]
pub fn cmd_read_hook_script(script_path: String) -> Result<String, String> {
    read_hook_script(Path::new(&script_path))
}
#[tauri::command]
pub fn cmd_get_hook_logs() -> Vec<HookExecutionLog> { get_hook_logs() }
#[tauri::command]
pub fn cmd_clear_hook_logs() -> bool { clear_hook_logs(); true }
#[tauri::command]
pub fn cmd_get_hook_debug_logs(base_dir: Option<String>) -> Result<Vec<HookExecutionLog>, String> {
    get_hook_debug_logs(&resolve_base(base_dir)?)
}
#[tauri::command]
pub fn cmd_launch_debug_session(hook_type: String, project_path: Option<String>) -> Result<Value, String> {
    launch_debug_session(&hook_type, project_path.as_deref())
}
#[tauri::command]
pub fn cmd_stop_debug_session(pid: u32) -> bool { stop_debug_session(pid) }

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use serde_json::json;

    #[test]
    fn get_hooks_empty_settings() {
        let dir = tempdir().unwrap();
        let hooks = get_hooks(dir.path()).unwrap();
        assert!(hooks.is_empty());
    }

    #[test]
    fn save_and_delete_hook_in_settings() {
        let dir = tempdir().unwrap();
        let cfg = json!({"matcher": "*", "hooks": [{"type": "command", "command": "echo hi"}]});
        save_hook_to_settings(dir.path(), "PreToolUse", cfg, "user", None).unwrap();
        let hooks = get_hooks(dir.path()).unwrap();
        assert_eq!(hooks.len(), 1);
        delete_hook_from_settings(dir.path(), "PreToolUse", 0, "user").unwrap();
        assert!(get_hooks(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn hook_logs_initially_empty() {
        clear_hook_logs();
        assert!(get_hook_logs().is_empty());
    }
}
```

注意：`stop_debug_session` 中的 `libc::kill` 需要在 `Cargo.toml` 中添加 `libc = "0.2"` 依赖（Unix only）。在 `Cargo.toml` 添加：

```toml
[target.'cfg(unix)'.dependencies]
libc = "0.2"
```

- [x] **Step 5: 运行测试**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml \
  claude_code::slash_commands \
  claude_code::mcp \
  claude_code::hooks \
  2>&1 | grep -E "test .* ok|FAILED|error"
```

- [x] **Step 6: 提交**

```bash
git add forge/src-tauri/
git commit -m "feat(m4): implement slash_commands/mcp/hooks Rust commands (TDD green)"
```

---

## Task 5: 文件监听（notify crate）

**Files:**
- Implement: `forge/src-tauri/src/commands/claude_code/watcher.rs`
- Modify: `forge/src-tauri/src/lib.rs`（setup watcher + WatcherState）

- [x] **Step 1: 实现 watcher.rs**

```rust
use notify::{Config as NConfig, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Payload emitted as `files:changed` Tauri event
#[derive(Clone, serde::Serialize)]
pub struct FilesChangedPayload {
    pub paths: Vec<String>,
}

pub struct FileWatcher {
    _watcher: RecommendedWatcher,
}

impl FileWatcher {
    pub fn start(app: AppHandle, watch_dirs: Vec<PathBuf>) -> Result<Self, String> {
        // Debounce: batch events within 300ms window
        let last_event: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
        let app_clone = app.clone();
        let last_clone = last_event.clone();

        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, _>| {
                if let Ok(event) = res {
                    let mut last = last_clone.lock().unwrap();
                    let now = Instant::now();
                    if last.map(|t| now.duration_since(t) > Duration::from_millis(300)).unwrap_or(true) {
                        *last = Some(now);
                        let paths: Vec<String> = event.paths.iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect();
                        let _ = app_clone.emit("files:changed", FilesChangedPayload { paths });
                    }
                }
            },
            NConfig::default(),
        ).map_err(|e| e.to_string())?;

        let mut w = watcher;
        for dir in &watch_dirs {
            if dir.exists() {
                w.watch(dir, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
            }
        }

        Ok(FileWatcher { _watcher: w })
    }
}

pub struct WatcherState(pub Mutex<Option<FileWatcher>>);
```

- [x] **Step 2: 注册 WatcherState 到 lib.rs**

在 `forge/src-tauri/src/lib.rs` 的 `setup` 闭包中（`seed_presets` 之后）：

```rust
use crate::commands::claude_code::watcher::{FileWatcher, WatcherState};

// 在 manage(DbState(...)) 之后
app.manage(WatcherState(Mutex::new(None)));

// 初始化文件监听
let watch_dirs = {
    let mut dirs_to_watch = vec![];
    if let Some(home) = dirs::home_dir() {
        let claude_dir = home.join(".claude");
        for sub in &["skills", "agents", "commands", "hooks"] {
            dirs_to_watch.push(claude_dir.join(sub));
        }
    }
    dirs_to_watch
};
if let Ok(fw) = FileWatcher::start(app.handle().clone(), watch_dirs) {
    *app.state::<WatcherState>().0.lock().unwrap() = Some(fw);
}
```

并在 `pub mod` 声明中确保 `pub mod tray;` 上方加 `use std::sync::Mutex;`（已有则跳过）。

- [x] **Step 3: 验证编译**

```bash
cargo check --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep -v "^warning"
```

- [x] **Step 4: 提交**

```bash
git add forge/src-tauri/
git commit -m "feat(m4): add notify file watcher with debounce, emits files:changed event"
```

---

## Task 6: 注册全部 M4 Tauri 命令 + forge/src/lib/tauri.ts

**Files:**
- Modify: `forge/src-tauri/src/lib.rs`（invoke_handler 注册所有 M4 命令）
- Create: `forge/src/lib/tauri.ts`（invoke() 包装层）

- [ ] **Step 1: 注册命令到 invoke_handler**

在 `forge/src-tauri/src/lib.rs` 的 `invoke_handler` 中追加全部 M4 命令：

```rust
// M4 Claude Code 配置管理
commands::claude_code::skills::cmd_get_skills,
commands::claude_code::skills::cmd_get_skill,
commands::claude_code::skills::cmd_save_skill,
commands::claude_code::skills::cmd_delete_skill,
commands::claude_code::agents::cmd_get_agents,
commands::claude_code::agents::cmd_get_agent,
commands::claude_code::agents::cmd_save_agent,
commands::claude_code::agents::cmd_delete_agent,
commands::claude_code::claudemd::cmd_get_claudemd,
commands::claude_code::claudemd::cmd_get_all_claudemd,
commands::claude_code::claudemd::cmd_save_claudemd,
commands::claude_code::graph::cmd_get_dependency_graph,
commands::claude_code::slash_commands::cmd_get_slash_commands,
commands::claude_code::slash_commands::cmd_get_slash_command,
commands::claude_code::slash_commands::cmd_save_slash_command,
commands::claude_code::slash_commands::cmd_save_slash_command_raw,
commands::claude_code::slash_commands::cmd_delete_slash_command,
commands::claude_code::mcp::cmd_get_mcp_servers,
commands::claude_code::mcp::cmd_save_mcp_server,
commands::claude_code::mcp::cmd_delete_mcp_server,
commands::claude_code::mcp::cmd_test_mcp_connection,
commands::claude_code::hooks::cmd_get_hooks,
commands::claude_code::hooks::cmd_save_hook_to_settings,
commands::claude_code::hooks::cmd_delete_hook_from_settings,
commands::claude_code::hooks::cmd_create_hook_script,
commands::claude_code::hooks::cmd_read_hook_script,
commands::claude_code::hooks::cmd_get_hook_logs,
commands::claude_code::hooks::cmd_clear_hook_logs,
commands::claude_code::hooks::cmd_get_hook_debug_logs,
commands::claude_code::hooks::cmd_launch_debug_session,
commands::claude_code::hooks::cmd_stop_debug_session,
```

- [ ] **Step 2: 创建 forge/src/lib/tauri.ts**

新建 `forge/src/lib/tauri.ts`：

```typescript
import { invoke as tauriInvoke } from '@tauri-apps/api/core'

// Typed invoke wrapper — centralises all command names
function inv<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args)
}

// ── Skill types (mirror Rust structs) ──────────────────────────────────────
export interface Skill {
  name: string
  description: string
  content?: string
  file_path?: string
  location: string
  dependencies?: string[]
}

export interface Agent {
  name: string
  description: string
  content?: string
  file_path?: string
  location: string
  dependencies?: string[]
}

export interface ClaudeMdFile {
  location: string
  file_path: string
  content: string
  exists: boolean
}

export interface HookEntry {
  name: string
  hook_type: string
  content?: string
  file_path?: string
  location: string
}

export interface HookExecutionLog {
  id: string
  hook_name: string
  hook_type: string
  command: string
  exit_code?: number
  stdout: string
  stderr: string
  duration_ms: number
  timestamp: number
  success: boolean
}

export interface McpServer {
  name: string
  config: Record<string, unknown>
}

export interface SlashCommand {
  name: string
  description?: string
  content: string
  file_path?: string
  location: string
}

export interface DependencyGraph {
  nodes: Array<{ id: string; node_type: string; name: string }>
  edges: Array<{ id: string; source: string; target: string; edge_type: string }>
}

// Git types
export interface GitStatus {
  branch: string
  ahead: number
  behind: number
  staged: string[]
  unstaged: string[]
  untracked: string[]
}

export interface BranchInfo {
  name: string
  is_current: boolean
  is_remote: boolean
  upstream?: string
}

export interface CommitInfo {
  hash: string
  short_hash: string
  message: string
  author: string
  timestamp: number
}

// Worktree types
export interface WorktreeInfo {
  path: string
  branch: string
  is_main: boolean
  is_locked: boolean
}

// Environment types
export interface ToolDetection {
  name: string
  found: boolean
  path?: string
  version?: string
}

export interface EnvVar {
  key: string
  value: string
}

// ── IPC channel → Tauri command mapping ───────────────────────────────────
// Old channel          → New command (arg mapping notes)
// skills:getAll        → cmd_get_skills
// skills:save          → cmd_save_skill      { skill }
// skills:delete        → cmd_delete_skill    { name }
// agents:getAll        → cmd_get_agents
// agents:save          → cmd_save_agent      { agent }
// agents:delete        → cmd_delete_agent    { name }
// claudemd:get         → cmd_get_claudemd
// claudemd:getAll      → cmd_get_all_claudemd
// claudemd:save        → cmd_save_claudemd   { filePath, content }
// dependencies:getGraph → cmd_get_dependency_graph
// commands:getAll      → cmd_get_slash_commands
// commands:save        → cmd_save_slash_command { cmd }
// commands:saveRaw     → cmd_save_slash_command_raw { name, content, filePath }
// commands:delete      → cmd_delete_slash_command { name }
// mcp:getAll           → cmd_get_mcp_servers
// mcp:save             → cmd_save_mcp_server  { name, config }
// mcp:delete           → cmd_delete_mcp_server { name }
// mcp:test             → cmd_test_mcp_connection { name }
// hooks:getAll         → cmd_get_hooks
// hooks:saveToSettings → cmd_save_hook_to_settings { hookType, hookConfig, location, matcherIndex }
// hooks:deleteFromSettings → cmd_delete_hook_from_settings { hookType, matcherIndex, location }
// hooks:createScript   → cmd_create_hook_script { scriptPath, content }
// hooks:readScript     → cmd_read_hook_script { scriptPath }
// hooks:getLogs        → cmd_get_hook_logs
// hooks:clearLogs      → cmd_clear_hook_logs
// hooks:getDebugLogs   → cmd_get_hook_debug_logs
// hooks:launchDebugSession → cmd_launch_debug_session { hookType, projectPath }
// hooks:stopDebugSession   → cmd_stop_debug_session { pid }

export const api = {
  skills: {
    getAll: () => inv<Skill[]>('cmd_get_skills'),
    get: (name: string) => inv<Skill | null>('cmd_get_skill', { name }),
    save: (skill: Skill) => inv<void>('cmd_save_skill', { skill }),
    delete: (name: string) => inv<void>('cmd_delete_skill', { name }),
  },

  agents: {
    getAll: () => inv<Agent[]>('cmd_get_agents'),
    get: (name: string) => inv<Agent | null>('cmd_get_agent', { name }),
    save: (agent: Agent) => inv<void>('cmd_save_agent', { agent }),
    delete: (name: string) => inv<void>('cmd_delete_agent', { name }),
  },

  claudeMD: {
    get: () => inv<ClaudeMdFile>('cmd_get_claudemd'),
    getAll: (projectPath?: string) => inv<ClaudeMdFile[]>('cmd_get_all_claudemd', { projectPath }),
    save: (filePath: string, content: string) => inv<void>('cmd_save_claudemd', { filePath, content }),
  },

  graph: {
    getDependencies: () => inv<DependencyGraph>('cmd_get_dependency_graph'),
  },

  commands: {
    getAll: () => inv<SlashCommand[]>('cmd_get_slash_commands'),
    get: (name: string) => inv<SlashCommand | null>('cmd_get_slash_command', { name }),
    save: (cmd: SlashCommand) => inv<void>('cmd_save_slash_command', { cmd }),
    saveRaw: (name: string, content: string, filePath: string) =>
      inv<void>('cmd_save_slash_command_raw', { name, content, filePath }),
    delete: (name: string) => inv<void>('cmd_delete_slash_command', { name }),
  },

  mcp: {
    getAll: () => inv<McpServer[]>('cmd_get_mcp_servers'),
    save: (name: string, config: Record<string, unknown>) =>
      inv<void>('cmd_save_mcp_server', { name, config }),
    delete: (name: string) => inv<void>('cmd_delete_mcp_server', { name }),
    testConnection: (name: string) => inv<boolean>('cmd_test_mcp_connection', { name }),
  },

  hooks: {
    getAll: () => inv<HookEntry[]>('cmd_get_hooks'),
    saveToSettings: (hookType: string, hookConfig: unknown, location: string, matcherIndex?: number) =>
      inv<void>('cmd_save_hook_to_settings', { hookType, hookConfig, location, matcherIndex }),
    deleteFromSettings: (hookType: string, matcherIndex: number, location: string) =>
      inv<void>('cmd_delete_hook_from_settings', { hookType, matcherIndex, location }),
    createScript: (scriptPath: string, content: string) =>
      inv<string>('cmd_create_hook_script', { scriptPath, content }),
    readScript: (scriptPath: string) => inv<string>('cmd_read_hook_script', { scriptPath }),
    getLogs: () => inv<HookExecutionLog[]>('cmd_get_hook_logs'),
    clearLogs: () => inv<boolean>('cmd_clear_hook_logs'),
    getDebugLogs: () => inv<HookExecutionLog[]>('cmd_get_hook_debug_logs'),
    launchDebugSession: (hookType: string, projectPath?: string) =>
      inv<{ success: boolean; message: string; pid?: number }>('cmd_launch_debug_session', { hookType, projectPath }),
    stopDebugSession: (pid: number) => inv<boolean>('cmd_stop_debug_session', { pid }),
  },

  git: {
    getStatus: (repoPath: string) => inv<GitStatus>('cmd_git_status', { repoPath }),
    stage: (repoPath: string, paths: string[]) => inv<void>('cmd_git_stage', { repoPath, paths }),
    commit: (repoPath: string, message: string) => inv<string>('cmd_git_commit', { repoPath, message }),
    push: (repoPath: string) => inv<void>('cmd_git_push', { repoPath }),
    getBranches: (repoPath: string) => inv<BranchInfo[]>('cmd_git_branches', { repoPath }),
    checkout: (repoPath: string, branch: string) => inv<void>('cmd_git_checkout', { repoPath, branch }),
    getLog: (repoPath: string, limit: number) => inv<CommitInfo[]>('cmd_git_log', { repoPath, limit }),
  },

  worktrees: {
    list: (repoPath: string) => inv<WorktreeInfo[]>('cmd_list_worktrees', { repoPath }),
    add: (repoPath: string, branch: string, path: string, newBranch: boolean) =>
      inv<WorktreeInfo>('cmd_add_worktree', { repoPath, branch, path, newBranch }),
    remove: (repoPath: string, worktreePath: string, force: boolean) =>
      inv<void>('cmd_remove_worktree', { repoPath, worktreePath, force }),
  },

  environment: {
    detectTools: () => inv<ToolDetection[]>('cmd_detect_env_tools'),
    getEnvVars: () => inv<EnvVar[]>('cmd_get_env_vars'),
    setEnvVar: (key: string, value: string) => inv<void>('cmd_set_env_var', { key, value }),
    deleteEnvVar: (key: string) => inv<void>('cmd_delete_env_var', { key }),
    testApiConnection: () => inv<boolean>('cmd_test_api_connection'),
  },
}
```

- [ ] **Step 3: 验证编译（Rust + 前端）**

```bash
cargo check --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep -v "^warning"
cd forge && npm run build 2>&1 | tail -10
```

- [x] **Step 4: 提交**

```bash
git add forge/
git commit -m "feat(m4): register all M4 Tauri commands + create tauri.ts IPC wrapper"
```

---

## Task 7: 迁移老页面到 forge（7 个页面）

**Files:**
- Create: `forge/src/modules/claude-code/pages/Skills.tsx`（从 src/pages/Skills.tsx 迁移）
- Create: `forge/src/modules/claude-code/pages/Agents.tsx`
- Create: `forge/src/modules/claude-code/pages/Hooks.tsx`
- Create: `forge/src/modules/claude-code/pages/MCP.tsx`
- Create: `forge/src/modules/claude-code/pages/Commands.tsx`
- Create: `forge/src/modules/claude-code/pages/ClaudeMd.tsx`
- Create: `forge/src/modules/claude-code/pages/Graph.tsx`

**迁移流程（对每个页面执行相同步骤）：**

- [ ] **Step 1: 创建目录并复制文件**

```bash
mkdir -p forge/src/modules/claude-code/pages
cp src/pages/Skills.tsx \
   src/pages/Agents.tsx \
   src/pages/Hooks.tsx \
   src/pages/MCP.tsx \
   src/pages/Commands.tsx \
   src/pages/ClaudeMd.tsx \
   src/pages/Graph.tsx \
   forge/src/modules/claude-code/pages/
```

- [ ] **Step 2: 批量替换 API 调用**

对每个页面，将所有 `window.api.*` / `api.*` 调用替换为对应的 `api.*` 调用（从 `../../lib/tauri` 导入）。

导入行从：
```typescript
// 无需任何 import（老 window.api 全局）
// 或: import { api } from '../lib/api'
```
改为：
```typescript
import { api } from '../../lib/tauri'
```

具体 API 名称映射（按清单 IPC 通道表对照）：

| 老调用 | 新调用 |
|---|---|
| `api.skills.getAll()` | `api.skills.getAll()` ✓（同名） |
| `api.skills.save(skill)` | `api.skills.save(skill)` ✓ |
| `api.skills.delete(name)` | `api.skills.delete(name)` ✓ |
| `api.agents.getAll()` | `api.agents.getAll()` ✓ |
| `api.agents.save(agent)` | `api.agents.save(agent)` ✓ |
| `api.agents.delete(name)` | `api.agents.delete(name)` ✓ |
| `api.hooks.getAll()` | `api.hooks.getAll()` ✓ |
| `api.hooks.saveToSettings(...)` | `api.hooks.saveToSettings(...)` ✓ |
| `api.hooks.deleteFromSettings(...)` | `api.hooks.deleteFromSettings(...)` ✓ |
| `api.hooks.launchDebugSession(...)` | `api.hooks.launchDebugSession(...)` ✓ |
| `api.hooks.stopDebugSession(pid)` | `api.hooks.stopDebugSession(pid)` ✓ |
| `api.hooks.getLogs()` | `api.hooks.getLogs()` ✓ |
| `api.hooks.getDebugLogs()` | `api.hooks.getDebugLogs()` ✓ |
| `api.hooks.clearLogs()` | `api.hooks.clearLogs()` ✓ |
| `api.mcp.getAll()` | `api.mcp.getAll()` ✓ |
| `api.mcp.save(name, config)` | `api.mcp.save(name, config)` ✓ |
| `api.mcp.delete(name)` | `api.mcp.delete(name)` ✓ |
| `api.mcp.test(name)` | `api.mcp.testConnection(name)` ← 注意改名 |
| `api.commands.getAll()` | `api.commands.getAll()` ✓ |
| `api.commands.save(cmd)` | `api.commands.save(cmd)` ✓ |
| `api.commands.saveRaw(n,c,p)` | `api.commands.saveRaw(n,c,p)` ✓ |
| `api.commands.delete(name)` | `api.commands.delete(name)` ✓ |
| `api.claudeMD.get()` | `api.claudeMD.get()` ✓ |
| `api.claudeMD.getAll()` | `api.claudeMD.getAll()` ✓ |
| `api.claudeMD.save(content, location)` | `api.claudeMD.save(filePath, content)` ← 参数顺序/名称变化 |
| `api.graph.getDependencies()` / `api.dependencies.getGraph()` | `api.graph.getDependencies()` |

- [ ] **Step 3: 移除 Electron-isms**

逐文件检查并删除/替换：
- 删除所有 `import { ipcRenderer } from 'electron'`
- 删除所有 `window.electron.*` 调用
- 删除 `electron-store`、`contextBridge` 等引用
- 将 `react-router-dom` 的 `useNavigate`/`Link` 替换为 props 回调（页面接受 `onNavigate` prop）或直接删除不需要的路由跳转
- 将 `import { useTranslation } from 'react-i18next'` 保留（i18n 已复制）

- [ ] **Step 4: 修正 shadcn 组件导入路径**

将所有 `@/components/ui/...` 改为相对路径，如 `../../../components/ui/button`。

- [ ] **Step 5: 修正 shared/types 导入路径**

将所有 `../../shared/types` 改为 `../../lib/types`（forge 内的新位置）。

- [ ] **Step 6: 修复 Graph.tsx 中的 reactflow 依赖**

Graph.tsx 中使用 ReactFlow，依赖已在 Task 2 安装，无需特殊处理；检查 `onFilesChanged` 事件监听：

老写法（chokidar 回调）：
```typescript
useEffect(() => {
  const unsubscribe = api.onFilesChanged(() => { /* reload */ })
  return unsubscribe
}, [])
```

新写法（Tauri 事件）：
```typescript
import { listen } from '@tauri-apps/api/event'

useEffect(() => {
  let unlisten: (() => void) | undefined
  listen('files:changed', () => {
    // reload data
  }).then(fn => { unlisten = fn })
  return () => { unlisten?.() }
}, [])
```

对所有 7 个页面中使用了文件变更监听的地方统一替换。

- [ ] **Step 7: 验证前端构建**

```bash
cd forge && npm run build 2>&1 | grep -E "error|Error|✓" | head -30
```

- [ ] **Step 8: 提交**

```bash
git add forge/src/modules/claude-code/
git commit -m "feat(m4): migrate 7 debugger pages to forge (api→invoke, i18n, shadcn paths fixed)"
```

---

## Task 8: 导航接线 + App.tsx 路由扩展

**Files:**
- Modify: `forge/src/App.tsx`（新增 claude-code 页面导入 + renderPage case）
- Modify: `forge/src/shell/Navigation.tsx`（新增 Claude Code 导航分组）

- [ ] **Step 1: 修改 Navigation.tsx**

在 `NAV_ITEMS` 数组中，在 Model Switcher 分组之后追加 Claude Code 分组：

```typescript
{ id: "_group_claude_code", label: "Claude Code", isGroupHeader: true },
{ id: "cc_skills", label: "Skills" },
{ id: "cc_agents", label: "Agents" },
{ id: "cc_hooks", label: "Hooks" },
{ id: "cc_mcp", label: "MCP" },
{ id: "cc_commands", label: "Commands" },
{ id: "cc_claudemd", label: "CLAUDE.md" },
{ id: "cc_graph", label: "Dependency Graph" },
{ id: "cc_git", label: "Git" },
{ id: "cc_worktrees", label: "Worktrees" },
{ id: "cc_environment", label: "Environment" },
```

- [ ] **Step 2: 修改 App.tsx**

新增导入和 renderPage case：

```typescript
import Skills from "./modules/claude-code/pages/Skills";
import Agents from "./modules/claude-code/pages/Agents";
import Hooks from "./modules/claude-code/pages/Hooks";
import MCP from "./modules/claude-code/pages/MCP";
import Commands from "./modules/claude-code/pages/Commands";
import ClaudeMd from "./modules/claude-code/pages/ClaudeMd";
import Graph from "./modules/claude-code/pages/Graph";
import Git from "./modules/claude-code/pages/Git";
import Worktrees from "./modules/claude-code/pages/Worktrees";
import Environment from "./modules/claude-code/pages/Environment";
```

在 `type PageId` 联合类型中追加所有新 ID，在 `renderPage` 中追加对应 case。

- [ ] **Step 3: 验证前端构建**

```bash
cd forge && npm run build 2>&1 | tail -15
```

- [x] **Step 4: 提交**

```bash
git add forge/src/
git commit -m "feat(m4): wire claude-code nav group + App.tsx routing for all 10 pages"
```

---

## Task 9: M4b — Git 命令（git2 crate，TDD）

**Files:**
- Implement: `forge/src-tauri/src/commands/claude_code/git.rs`

- [x] **Step 1: TDD Red — 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn init_repo(path: &std::path::Path) -> git2::Repository {
        let repo = git2::Repository::init(path).unwrap();
        // configure user for commits
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "t@test.com").unwrap();
        repo
    }

    fn make_commit(repo: &git2::Repository, msg: &str) {
        let sig = git2::Signature::now("Test", "t@test.com").unwrap();
        let tree_id = {
            let mut idx = repo.index().unwrap();
            idx.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        let parents: Vec<git2::Commit> = if let Ok(head) = repo.head() {
            vec![repo.find_commit(head.target().unwrap()).unwrap()]
        } else { vec![] };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs).unwrap();
    }

    #[test]
    fn git_status_on_clean_repo() {
        let dir = tempdir().unwrap();
        let _repo = init_repo(dir.path());
        make_commit(&_repo, "init");
        let status = git_status(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(status.branch, "master");
        assert!(status.staged.is_empty());
    }

    #[test]
    fn git_branches_returns_master() {
        let dir = tempdir().unwrap();
        let repo = init_repo(dir.path());
        make_commit(&repo, "init");
        let branches = git_branches(dir.path().to_str().unwrap()).unwrap();
        assert!(!branches.is_empty());
        assert!(branches.iter().any(|b| b.name == "master" || b.name == "main"));
    }

    #[test]
    fn git_log_returns_one_commit() {
        let dir = tempdir().unwrap();
        let repo = init_repo(dir.path());
        make_commit(&repo, "initial commit");
        let log = git_log(dir.path().to_str().unwrap(), 10).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].message, "initial commit");
    }
}
```

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml claude_code::git 2>&1 | grep -E "FAILED|error" | head -10
```

- [ ] **Step 2: Green — 实现 git.rs**

```rust
use git2::{Repository, StatusOptions, BranchType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

pub fn git_status(repo_path: &str) -> Result<GitStatus, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("HEAD").to_string();

    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut staged = vec![];
    let mut unstaged = vec![];
    let mut untracked = vec![];

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();
        if s.contains(git2::Status::INDEX_NEW)
            || s.contains(git2::Status::INDEX_MODIFIED)
            || s.contains(git2::Status::INDEX_DELETED)
        {
            staged.push(path.clone());
        }
        if s.contains(git2::Status::WT_MODIFIED) || s.contains(git2::Status::WT_DELETED) {
            unstaged.push(path.clone());
        }
        if s.contains(git2::Status::WT_NEW) {
            untracked.push(path);
        }
    }

    // ahead/behind via revwalk against upstream
    let (ahead, behind) = repo.head()
        .ok()
        .and_then(|h| h.resolve().ok())
        .and_then(|h| h.target())
        .and_then(|local_oid| {
            let local_name = repo.head().ok()?.shorthand()?.to_string();
            let branch = repo.find_branch(&local_name, BranchType::Local).ok()?;
            let upstream = branch.upstream().ok()?;
            let upstream_oid = upstream.get().target()?;
            repo.graph_ahead_behind(local_oid, upstream_oid).ok()
        })
        .unwrap_or((0, 0));

    Ok(GitStatus { branch, ahead, behind, staged, unstaged, untracked })
}

pub fn git_stage(repo_path: &str, paths: &[String]) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    for path in paths {
        index.add_path(std::path::Path::new(path)).map_err(|e| e.to_string())?;
    }
    index.write().map_err(|e| e.to_string())
}

pub fn git_commit(repo_path: &str, message: &str) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let sig = repo.signature().map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let parents: Vec<git2::Commit> = if let Ok(head) = repo.head() {
        vec![repo.find_commit(head.target().ok_or("no target")?).map_err(|e| e.to_string())?]
    } else {
        vec![]
    };
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
        .map_err(|e| e.to_string())?;
    Ok(oid.to_string())
}

pub fn git_push(repo_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch_name = head.shorthand().ok_or("no branch name")?.to_string();
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);

    let mut callbacks = git2::RemoteCallbacks::new();
    // Attempt ssh-agent auth first, fall back to default key
    callbacks.credentials(|_url, username_from_url, _allowed_types| {
        let user = username_from_url.unwrap_or("git");
        git2::Cred::ssh_key_from_agent(user)
    });

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);
    remote.push(&[refspec.as_str()], Some(&mut push_opts))
        .map_err(|e| format!("push failed: {}", e))
}

pub fn git_branches(repo_path: &str) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head_name = repo.head().ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));
    let mut result = vec![];
    for branch in repo.branches(None).map_err(|e| e.to_string())? {
        let (branch, branch_type) = branch.map_err(|e| e.to_string())?;
        let name = branch.name().map_err(|e| e.to_string())?
            .unwrap_or("").to_string();
        let is_remote = branch_type == BranchType::Remote;
        let is_current = head_name.as_deref() == Some(&name);
        let upstream = if !is_remote {
            branch.upstream().ok()
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()))
        } else { None };
        result.push(BranchInfo { name, is_current, is_remote, upstream });
    }
    Ok(result)
}

pub fn git_checkout(repo_path: &str, branch: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let obj = repo.revparse_single(&format!("refs/heads/{}", branch))
        .map_err(|e| e.to_string())?;
    repo.checkout_tree(&obj, None).map_err(|e| e.to_string())?;
    repo.set_head(&format!("refs/heads/{}", branch)).map_err(|e| e.to_string())
}

pub fn git_log(repo_path: &str, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_oid = head.target().ok_or("no head target")?;
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push(head_oid).map_err(|e| e.to_string())?;
    let mut commits = vec![];
    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        commits.push(CommitInfo {
            hash: oid.to_string(),
            short_hash: oid.to_string()[..7].to_string(),
            message: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            timestamp: commit.author().when().seconds(),
        });
    }
    Ok(commits)
}

#[tauri::command] pub fn cmd_git_status(repo_path: String) -> Result<GitStatus, String> { git_status(&repo_path) }
#[tauri::command] pub fn cmd_git_stage(repo_path: String, paths: Vec<String>) -> Result<(), String> { git_stage(&repo_path, &paths) }
#[tauri::command] pub fn cmd_git_commit(repo_path: String, message: String) -> Result<String, String> { git_commit(&repo_path, &message) }
#[tauri::command] pub fn cmd_git_push(repo_path: String) -> Result<(), String> { git_push(&repo_path) }
#[tauri::command] pub fn cmd_git_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> { git_branches(&repo_path) }
#[tauri::command] pub fn cmd_git_checkout(repo_path: String, branch: String) -> Result<(), String> { git_checkout(&repo_path, &branch) }
#[tauri::command] pub fn cmd_git_log(repo_path: String, limit: usize) -> Result<Vec<CommitInfo>, String> { git_log(&repo_path, limit) }
```

- [ ] **Step 3: 运行测试**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml claude_code::git 2>&1 | grep -E "test .* ok|FAILED|error"
```

- [ ] **Step 4: 注册命令到 lib.rs**

在 `invoke_handler` 中追加：

```rust
commands::claude_code::git::cmd_git_status,
commands::claude_code::git::cmd_git_stage,
commands::claude_code::git::cmd_git_commit,
commands::claude_code::git::cmd_git_push,
commands::claude_code::git::cmd_git_branches,
commands::claude_code::git::cmd_git_checkout,
commands::claude_code::git::cmd_git_log,
```

- [ ] **Step 5: 提交**

```bash
git add forge/src-tauri/
git commit -m "feat(m4b): implement git commands via git2 crate (TDD green)"
```

---

## Task 10: M4b — Worktrees + Environment 命令（TDD）

**Files:**
- Implement: `forge/src-tauri/src/commands/claude_code/worktrees.rs`
- Implement: `forge/src-tauri/src/commands/claude_code/environment.rs`

- [ ] **Step 1: 实现 worktrees.rs（TDD）**

```rust
use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub is_main: bool,
    pub is_locked: bool,
}

pub fn list_worktrees(repo_path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let mut result = vec![];

    // Main worktree
    let main_path = repo.workdir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_path.to_string());
    let main_branch = repo.head().ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "HEAD".into());
    result.push(WorktreeInfo { path: main_path, branch: main_branch, is_main: true, is_locked: false });

    // Linked worktrees via gitdir files in .git/worktrees/
    let worktrees_meta_dir = repo.path().join("worktrees");
    if worktrees_meta_dir.exists() {
        for entry in std::fs::read_dir(&worktrees_meta_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let gitdir_file = entry.path().join("gitdir");
            let head_file = entry.path().join("HEAD");
            let locked = entry.path().join("locked").exists();
            if gitdir_file.exists() && head_file.exists() {
                let head_content = std::fs::read_to_string(&head_file).unwrap_or_default();
                let branch = if let Some(stripped) = head_content.strip_prefix("ref: refs/heads/") {
                    stripped.trim().to_string()
                } else {
                    head_content.trim()[..7.min(head_content.trim().len())].to_string()
                };
                // wt path is stored in gitdir (path of the worktree's .git file)
                let gitdir_content = std::fs::read_to_string(&gitdir_file).unwrap_or_default();
                let wt_path = std::path::Path::new(gitdir_content.trim())
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                result.push(WorktreeInfo { path: wt_path, branch, is_main: false, is_locked: locked });
            }
        }
    }
    Ok(result)
}

pub fn add_worktree(repo_path: &str, branch: &str, path: &str, new_branch: bool) -> Result<WorktreeInfo, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    // Resolve actual target path
    let wt_path = if path.is_empty() {
        let workdir = repo.workdir()
            .ok_or("bare repo not supported")?;
        workdir.join(".worktrees").join(branch).to_string_lossy().to_string()
    } else {
        path.to_string()
    };

    std::fs::create_dir_all(&wt_path).map_err(|e| e.to_string())?;

    // Create branch if requested
    if new_branch {
        let head = repo.head().map_err(|e| e.to_string())?;
        let commit = repo.find_commit(head.target().ok_or("no HEAD")?)
            .map_err(|e| e.to_string())?;
        repo.branch(branch, &commit, false).map_err(|e| e.to_string())?;
    }

    // Add worktree via libgit2
    repo.worktree(branch, std::path::Path::new(&wt_path), None)
        .map_err(|e| e.to_string())?;

    Ok(WorktreeInfo { path: wt_path, branch: branch.to_string(), is_main: false, is_locked: false })
}

pub fn remove_worktree(repo_path: &str, worktree_path: &str, force: bool) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    // Find worktree name by matching path
    let wts_meta = repo.path().join("worktrees");
    let mut wt_name = None;
    if wts_meta.exists() {
        for entry in std::fs::read_dir(&wts_meta).map_err(|e| e.to_string())?.flatten() {
            let gitdir_file = entry.path().join("gitdir");
            if gitdir_file.exists() {
                let content = std::fs::read_to_string(&gitdir_file).unwrap_or_default();
                let p = std::path::Path::new(content.trim()).parent()
                    .map(|x| x.to_string_lossy().to_string())
                    .unwrap_or_default();
                if p == worktree_path {
                    wt_name = Some(entry.file_name().to_string_lossy().to_string());
                    break;
                }
            }
        }
    }
    let name = wt_name.ok_or_else(|| format!("worktree not found: {}", worktree_path))?;
    let wt = repo.find_worktree(&name).map_err(|e| e.to_string())?;
    let mut prune_opts = git2::WorktreePruneOptions::new();
    if force {
        prune_opts.valid(true);
    }
    wt.prune(Some(&mut prune_opts)).map_err(|e| e.to_string())?;
    // Also remove the directory
    if std::path::Path::new(worktree_path).exists() {
        std::fs::remove_dir_all(worktree_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command] pub fn cmd_list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> { list_worktrees(&repo_path) }
#[tauri::command] pub fn cmd_add_worktree(repo_path: String, branch: String, path: String, new_branch: bool) -> Result<WorktreeInfo, String> { add_worktree(&repo_path, &branch, &path, new_branch) }
#[tauri::command] pub fn cmd_remove_worktree(repo_path: String, worktree_path: String, force: bool) -> Result<(), String> { remove_worktree(&repo_path, &worktree_path, force) }

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn init_repo_with_commit(path: &std::path::Path) -> git2::Repository {
        let repo = git2::Repository::init(path).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "t@t.com").unwrap();
        let sig = git2::Signature::now("Test", "t@t.com").unwrap();
        let tree_id = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[]).unwrap();
        repo
    }

    #[test]
    fn list_worktrees_main_only() {
        let dir = tempdir().unwrap();
        let _repo = init_repo_with_commit(dir.path());
        let wts = list_worktrees(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(wts.len(), 1);
        assert!(wts[0].is_main);
    }

    #[test]
    fn add_and_list_worktree() {
        let dir = tempdir().unwrap();
        let _repo = init_repo_with_commit(dir.path());
        let wt_path = dir.path().join("wt-feature").to_string_lossy().to_string();
        add_worktree(dir.path().to_str().unwrap(), "feature", &wt_path, true).unwrap();
        let wts = list_worktrees(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(wts.len(), 2);
        assert!(wts.iter().any(|w| w.branch == "feature"));
    }
}
```

- [ ] **Step 2: 实现 environment.rs（TDD）**

```rust
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use crate::commands::tools::detect;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDetection {
    pub name: String,
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

/// Detect tools: claude, git, node, npm, pnpm, bun
pub fn detect_env_tools() -> Result<Vec<ToolDetection>, String> {
    let names = ["claude", "git", "node", "npm", "pnpm", "bun"];
    Ok(names.iter().map(|&n| {
        let status = detect(n);
        ToolDetection {
            name: n.to_string(),
            found: status.installed,
            path: status.path,
            version: status.version,
        }
    }).collect())
}

pub fn get_env_vars_from_db(conn: &rusqlite::Connection) -> Result<Vec<EnvVar>, String> {
    crate::db::get_env_vars(conn)
        .map(|v| v.into_iter().map(|(k, val)| EnvVar { key: k, value: val }).collect())
}

pub fn set_env_var_in_db(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO env_vars (key, value, created_at) VALUES (?1, ?2, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![key, value],
    ).map_err(|e| e.to_string()).map(|_| ())
}

pub fn delete_env_var_in_db(conn: &rusqlite::Connection, key: &str) -> Result<(), String> {
    conn.execute("DELETE FROM env_vars WHERE key=?1", rusqlite::params![key])
        .map_err(|e| e.to_string()).map(|_| ())
}

/// Minimal connectivity test: POST to Anthropic API with current API key.
/// Marked #[ignore] by default in tests — requires network.
pub async fn test_api_connection_impl() -> Result<bool, String> {
    // Read API key from ~/.claude.json
    let path = dirs::home_dir()
        .map(|h| h.join(".claude.json"))
        .ok_or("no home dir")?;
    let doc = crate::config::claude::read_json(&path)?;
    let api_key = doc.get("apiKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if api_key.is_empty() {
        return Err("no API key configured".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&serde_json::json!({
            "model": "claude-haiku-4-5",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}]
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    // 200 or 400 (malformed but reachable) both indicate connectivity
    Ok(resp.status().as_u16() < 500)
}

use crate::commands::model_switcher::commands::DbState;

#[tauri::command]
pub fn cmd_detect_env_tools() -> Result<Vec<ToolDetection>, String> { detect_env_tools() }

#[tauri::command]
pub fn cmd_get_env_vars(state: tauri::State<DbState>) -> Result<Vec<EnvVar>, String> {
    let conn = state.0.lock().unwrap();
    get_env_vars_from_db(&conn)
}

#[tauri::command]
pub fn cmd_set_env_var(key: String, value: String, state: tauri::State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    set_env_var_in_db(&conn, &key, &value)
}

#[tauri::command]
pub fn cmd_delete_env_var(key: String, state: tauri::State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    delete_env_var_in_db(&conn, &key)
}

#[tauri::command]
pub async fn cmd_test_api_connection() -> Result<bool, String> {
    test_api_connection_impl().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_env_tools_returns_six() {
        let tools = detect_env_tools().unwrap();
        assert_eq!(tools.len(), 6);
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"claude"));
        assert!(names.contains(&"git"));
    }

    #[test]
    fn env_var_crud_in_memory_db() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        set_env_var_in_db(&conn, "MY_VAR", "hello").unwrap();
        let vars = get_env_vars_from_db(&conn).unwrap();
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].key, "MY_VAR");
        assert_eq!(vars[0].value, "hello");
        delete_env_var_in_db(&conn, "MY_VAR").unwrap();
        assert!(get_env_vars_from_db(&conn).unwrap().is_empty());
    }

    #[test]
    #[ignore] // needs network
    fn test_api_connection_with_key() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let ok = rt.block_on(test_api_connection_impl());
        // If no key configured, expect Err; otherwise bool
        assert!(ok.is_ok() || ok.unwrap_err().contains("no API key"));
    }
}
```

- [ ] **Step 3: 注册命令到 lib.rs**

```rust
// M4b Worktrees
commands::claude_code::worktrees::cmd_list_worktrees,
commands::claude_code::worktrees::cmd_add_worktree,
commands::claude_code::worktrees::cmd_remove_worktree,
// M4b Environment
commands::claude_code::environment::cmd_detect_env_tools,
commands::claude_code::environment::cmd_get_env_vars,
commands::claude_code::environment::cmd_set_env_var,
commands::claude_code::environment::cmd_delete_env_var,
commands::claude_code::environment::cmd_test_api_connection,
```

- [ ] **Step 4: 运行测试**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml \
  claude_code::worktrees \
  claude_code::environment \
  2>&1 | grep -E "test .* ok|FAILED|error"
```

- [ ] **Step 5: 提交**

```bash
git add forge/src-tauri/
git commit -m "feat(m4b): implement worktrees + environment Rust commands (TDD green)"
```

---

## Task 11: M4b — Git/Worktrees/Environment 前端页面（新代码）

**Files:**
- Create: `forge/src/modules/claude-code/pages/Git.tsx`
- Create: `forge/src/modules/claude-code/pages/Worktrees.tsx`
- Create: `forge/src/modules/claude-code/pages/Environment.tsx`

均为新代码，inline style 深色主题，与 Dashboard.tsx 保持一致。

- [ ] **Step 1: 创建 Git.tsx**

页面布局按设计文档：当前状态区 → 变更文件列表（多选 + 暂存）→ 提交框 → 分支列表 → 最近提交。

```typescript
import { useState, useEffect } from 'react'
import { api, GitStatus, BranchInfo, CommitInfo } from '../../../lib/tauri'
import { listen } from '@tauri-apps/api/event'

const REPO_PATH = '' // TODO: integrate with project context (M5)

export default function Git() {
  const [repoPath, setRepoPath] = useState(REPO_PATH)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [log, setLog] = useState<CommitInfo[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [commitMsg, setCommitMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!repoPath) return
    setLoading(true)
    setError(null)
    try {
      const [s, b, l] = await Promise.all([
        api.git.getStatus(repoPath),
        api.git.getBranches(repoPath),
        api.git.getLog(repoPath, 20),
      ])
      setStatus(s)
      setBranches(b)
      setLog(l)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    let unlisten: (() => void) | undefined
    listen('files:changed', load).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [repoPath])

  const handleStage = async () => {
    await api.git.stage(repoPath, selected)
    await load()
    setSelected([])
  }

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    await api.git.commit(repoPath, commitMsg)
    setCommitMsg('')
    await load()
  }

  const handlePush = async () => {
    await api.git.push(repoPath).catch(e => setError(String(e)))
    await load()
  }

  const handleCheckout = async (branch: string) => {
    await api.git.checkout(repoPath, branch)
    await load()
  }

  const s = { container: { padding: 24, maxWidth: 900, color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }, heading: { fontSize: 18, fontWeight: 700, marginBottom: 16 }, section: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: 16, marginBottom: 16 }, label: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1 }, btn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }, btnGhost: { padding: '6px 14px', background: 'transparent', color: '#a3a3a3', border: '1px solid #374151', borderRadius: 6, cursor: 'pointer', fontSize: 13 } }

  return (
    <div style={s.container}>
      <div style={s.heading}>Git</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input
          value={repoPath}
          onChange={e => setRepoPath(e.target.value)}
          placeholder="仓库路径（如 ~/projects/forge）"
          style={{ flex: 1, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 12px', color: '#e5e5e5', fontSize: 13 }}
        />
        <button style={s.btnGhost} onClick={load}>刷新</button>
      </div>
      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: '#6b7280', marginBottom: 12 }}>加载中...</div>}
      {status && (
        <div style={s.section}>
          <div style={s.label}>当前状态</div>
          <div style={{ marginTop: 8, fontSize: 14 }}>
            分支: <strong>{status.branch}</strong>
            {status.ahead > 0 && <span style={{ marginLeft: 8, color: '#10b981' }}>↑{status.ahead}</span>}
            {status.behind > 0 && <span style={{ marginLeft: 8, color: '#f59e0b' }}>↓{status.behind}</span>}
          </div>
        </div>
      )}
      {status && (status.staged.length + status.unstaged.length + status.untracked.length > 0) && (
        <div style={s.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={s.label}>变更文件</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={s.btnGhost} onClick={() => setSelected([...status.unstaged, ...status.untracked])}>全选</button>
              <button style={s.btn} onClick={handleStage} disabled={selected.length === 0}>暂存选中</button>
            </div>
          </div>
          {[...status.staged.map(p => ({ p, state: 'M staged' })), ...status.unstaged.map(p => ({ p, state: 'M' })), ...status.untracked.map(p => ({ p, state: '?' }))].map(({ p, state }) => (
            <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
              <input type="checkbox" checked={selected.includes(p)} onChange={e => setSelected(prev => e.target.checked ? [...prev, p] : prev.filter(x => x !== p))} />
              <span style={{ color: state.startsWith('?') ? '#f59e0b' : '#e5e5e5', fontFamily: 'monospace', fontSize: 12 }}>{state.split(' ')[0]}</span>
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}
      <div style={s.section}>
        <div style={s.label}>提交</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input value={commitMsg} onChange={e => setCommitMsg(e.target.value)} placeholder="提交信息" style={{ flex: 1, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 12px', color: '#e5e5e5', fontSize: 13 }} onKeyDown={e => e.key === 'Enter' && handleCommit()} />
          <button style={s.btn} onClick={handleCommit}>提交</button>
          <button style={s.btnGhost} onClick={handlePush}>推送</button>
        </div>
      </div>
      {branches.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>分支</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginTop: 8 }}>
            {branches.filter(b => !b.is_remote).map(b => (
              <button key={b.name} onClick={() => handleCheckout(b.name)} style={{ padding: '4px 12px', background: b.is_current ? '#1e3a5f' : '#1f1f1f', color: b.is_current ? '#3b82f6' : '#a3a3a3', border: `1px solid ${b.is_current ? '#3b82f6' : '#374151'}`, borderRadius: 20, fontSize: 13, cursor: 'pointer' }}>
                {b.name} {b.is_current && '✓'}
              </button>
            ))}
          </div>
        </div>
      )}
      {log.length > 0 && (
        <div style={s.section}>
          <div style={s.label}>最近提交</div>
          {log.map(c => (
            <div key={c.hash} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #1f1f1f', fontSize: 13 }}>
              <span style={{ fontFamily: 'monospace', color: '#6b7280', fontSize: 12 }}>{c.short_hash}</span>
              <span style={{ flex: 1 }}>{c.message}</span>
              <span style={{ color: '#6b7280' }}>{c.author}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 创建 Worktrees.tsx**

```typescript
import { useState, useEffect } from 'react'
import { api, WorktreeInfo } from '../../../lib/tauri'

export default function Worktrees() {
  const [repoPath, setRepoPath] = useState('')
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [newBranch, setNewBranch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!repoPath) return
    try {
      setWorktrees(await api.worktrees.list(repoPath))
      setError(null)
    } catch (e) { setError(String(e)) }
  }

  useEffect(() => { load() }, [repoPath])

  const handleAdd = async () => {
    if (!newBranch.trim()) return
    try {
      await api.worktrees.add(repoPath, newBranch, '', true)
      setNewBranch('')
      await load()
    } catch (e) { setError(String(e)) }
  }

  const handleRemove = async (wt: WorktreeInfo) => {
    try {
      await api.worktrees.remove(repoPath, wt.path, false)
      await load()
    } catch (e) { setError(String(e)) }
  }

  const s = { container: { padding: 24, color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }, heading: { fontSize: 18, fontWeight: 700, marginBottom: 16 }, card: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: 16, marginBottom: 12 }, label: { fontSize: 12, color: '#6b7280', letterSpacing: 1 }, btn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }, btnDanger: { padding: '6px 14px', background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, cursor: 'pointer', fontSize: 13 } }

  return (
    <div style={s.container}>
      <div style={s.heading}>工作树</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={repoPath} onChange={e => setRepoPath(e.target.value)} placeholder="仓库路径" style={{ flex: 1, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 12px', color: '#e5e5e5', fontSize: 13 }} />
      </div>
      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {worktrees.map(wt => (
        <div key={wt.path} style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{wt.is_main ? '主工作树' : wt.branch}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontFamily: 'monospace' }}>{wt.path}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>分支: {wt.branch} {wt.is_locked && <span style={{ color: '#f59e0b' }}>🔒 已锁定</span>}</div>
            </div>
            {!wt.is_main && (
              <button style={s.btnDanger} onClick={() => handleRemove(wt)}>删除</button>
            )}
          </div>
        </div>
      ))}
      <div style={{ ...s.card, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ color: '#6b7280', fontSize: 13 }}>+ 新建工作树</span>
        <input value={newBranch} onChange={e => setNewBranch(e.target.value)} placeholder="分支名" style={{ flex: 1, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 12px', color: '#e5e5e5', fontSize: 13 }} onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        <button style={s.btn} onClick={handleAdd}>创建</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 创建 Environment.tsx**

```typescript
import { useState, useEffect } from 'react'
import { api, ToolDetection, EnvVar } from '../../../lib/tauri'

export default function Environment() {
  const [tools, setTools] = useState<ToolDetection[]>([])
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [apiConnected, setApiConnected] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.environment.detectTools().then(setTools).catch(e => setError(String(e)))
    api.environment.getEnvVars().then(setEnvVars).catch(e => setError(String(e)))
  }, [])

  const handleAddVar = async () => {
    if (!newKey.trim()) return
    await api.environment.setEnvVar(newKey, newValue)
    setNewKey(''); setNewValue('')
    setEnvVars(await api.environment.getEnvVars())
  }

  const handleDeleteVar = async (key: string) => {
    await api.environment.deleteEnvVar(key)
    setEnvVars(await api.environment.getEnvVars())
  }

  const handleTestApi = async () => {
    try {
      const ok = await api.environment.testApiConnection()
      setApiConnected(ok)
    } catch (e) { setError(String(e)) }
  }

  const s = { container: { padding: 24, color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }, heading: { fontSize: 18, fontWeight: 700, marginBottom: 16 }, section: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: 16, marginBottom: 16 }, label: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 8 }, row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a1a1a', fontSize: 13 }, btn: { padding: '5px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }, btnGhost: { padding: '5px 12px', background: 'transparent', color: '#a3a3a3', border: '1px solid #374151', borderRadius: 6, cursor: 'pointer', fontSize: 12 }, btnDanger: { padding: '5px 12px', background: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', fontSize: 12 } }

  return (
    <div style={s.container}>
      <div style={s.heading}>环境</div>
      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={s.section}>
        <div style={s.label}>API 与连接</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#a3a3a3' }}>ANTHROPIC_API_KEY</span>
          <span style={{ flex: 1 }} />
          <button style={s.btnGhost} onClick={handleTestApi}>测试连接</button>
          {apiConnected === true && <span style={{ color: '#10b981', fontSize: 12 }}>● 连通</span>}
          {apiConnected === false && <span style={{ color: '#ef4444', fontSize: 12 }}>● 失败</span>}
        </div>
      </div>

      <div style={s.section}>
        <div style={s.label}>PATH 检测</div>
        {tools.map(t => (
          <div key={t.name} style={s.row}>
            <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.name}</span>
            <span>{t.found ? <span style={{ color: '#10b981' }}>✅</span> : <span style={{ color: '#ef4444' }}>❌ 未找到</span>}</span>
            <span style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 12 }}>{t.path ?? ''}</span>
            <span style={{ color: '#6b7280', fontSize: 12 }}>{t.version ?? ''}</span>
          </div>
        ))}
      </div>

      <div style={s.section}>
        <div style={s.label}>自定义环境变量</div>
        {envVars.map(v => (
          <div key={v.key} style={s.row}>
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#60a5fa' }}>{v.key}</span>
            <span style={{ flex: 1, marginLeft: 16, color: '#a3a3a3', fontSize: 12 }}>{v.value}</span>
            <button style={s.btnDanger} onClick={() => handleDeleteVar(v.key)}>删除</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="变量名" style={{ width: 160, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px', color: '#e5e5e5', fontSize: 12 }} />
          <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="值" style={{ flex: 1, background: '#1f1f1f', border: '1px solid #374151', borderRadius: 6, padding: '6px 10px', color: '#e5e5e5', fontSize: 12 }} onKeyDown={e => e.key === 'Enter' && handleAddVar()} />
          <button style={s.btn} onClick={handleAddVar}>+ 添加</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 验证前端构建**

```bash
cd forge && npm run build 2>&1 | grep -E "error|✓" | head -20
```

- [ ] **Step 5: 提交**

```bash
git add forge/src/modules/claude-code/pages/
git commit -m "feat(m4b): add Git/Worktrees/Environment pages (new inline-style UI)"
```

---

## Task 12: 全量验证 + 最终提交

**Files:** 无新文件，仅验证。

- [ ] **Step 1: 全量 Rust 测试**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml 2>&1 | tail -30
```

期望：所有非 `#[ignore]` 测试通过，0 个 FAILED。

- [ ] **Step 2: 全量前端构建**

```bash
cd forge && npm run build 2>&1 | tail -20
```

期望：0 个 TypeScript error，dist/ 产物生成。

- [ ] **Step 3: 检查未注册命令**

确认 `forge/src-tauri/src/lib.rs` 的 `invoke_handler` 中，`tauri.ts` 里每个 `inv('cmd_...')` 都有对应的命令注册（逐行比对）。

- [ ] **Step 4: 最终提交**

```bash
git add forge/
git commit -m "chore(m4+m4b): final validation — all tests green, frontend builds clean"
```

---

## 自审（Self-Review）

### 设计文档 IPC 接口覆盖核对

| 设计文档 `api.*` 命名 | 计划 Rust 命令 | 状态 |
|---|---|---|
| `skills.getAll/get/save/delete` | `cmd_get_skills` / `cmd_get_skill` / `cmd_save_skill` / `cmd_delete_skill` | ✓ |
| `agents.getAll/get/save/delete` | `cmd_get_agents` / `cmd_get_agent` / `cmd_save_agent` / `cmd_delete_agent` | ✓ |
| `hooks.getAll/get/save/test/getLogs/launchDebugSession/stopDebugSession` | Task 4 全覆盖（get_hook 不单独实现，通过 getAll 过滤）| ✓ |
| `mcp.getAll/get/save/delete/testConnection` | Task 4 全覆盖（get_mcp_server 通过 getAll 过滤）| ✓ |
| `commands.getAll/get/save/delete` | Task 4 全覆盖 | ✓ |
| `claudeMD.get/getAll/save` | Task 3 全覆盖 | ✓ |
| `graph.getDependencies` | `cmd_get_dependency_graph` | ✓ |
| `git.getStatus/stage/commit/push/getBranches/checkout/getLog` | Task 9 全覆盖 | ✓ |
| `worktrees.list/add/remove` | Task 10 全覆盖 | ✓ |
| `environment.detectTools/getEnvVars/setEnvVar/deleteEnvVar/testApiConnection` | Task 10 全覆盖 | ✓ |

### 设计文档特殊要求核对

| 要求 | 实现位置 | 状态 |
|---|---|---|
| 保留未知字段（settings.json 写入）| mcp.rs + hooks.rs 均使用 `read_json` + `merge_fields` 模式 | ✓ |
| base_dir 参数（可测试性）| 所有 pub fn 接受 `&Path` base_dir，Tauri wrapper 传 `~/.claude` | ✓ |
| notify crate 文件监听 + `files:changed` 事件 | Task 5 watcher.rs | ✓ |
| git2 crate（无系统 git 依赖）| Task 9 git.rs + Task 10 worktrees.rs | ✓ |
| `test_api_connection` 标记 `#[ignore]`（需网络）| Task 10 environment.rs 测试标注 | ✓ |
| launch_debug_session 使用 osascript（macOS）| hooks.rs launch_debug_session（跨平台 if/else 与老 Electron 一致）| ✓ |
| 前端 `files:changed` 事件监听（替代 chokidar）| Task 7 Step 6 | ✓ |
| shadcn 导入路径修正（@/→相对路径）| Task 7 Step 4 | ✓ |
| i18n 保留 | Task 2 复制 i18n + main.tsx import | ✓ |

### 类型一致性核对

- `tauri.ts` 中的 TypeScript 接口（`Skill`, `Agent`, `HookEntry`, `McpServer`, `SlashCommand` 等）字段名与 Rust `serde` 序列化输出（默认 snake_case）一致。
- `DependencyGraph` 中 `node_type` / `edge_type` 字段在 Rust 和 TS 均使用 snake_case。
- `WorktreeInfo.is_main` / `is_locked` 在 Rust（`pub is_main: bool`）和 TS（`is_main: boolean`）一致。

### 无占位符核对

- 所有 Rust `todo!()` 仅在 Task 1 骨架中出现，Task 3-10 均提供完整函数体。
- `test_mcp_connection` 返回 `Ok(false)` 为明确 v1 placeholder，符合设计文档（"not yet implemented"原样保留）。
- `REPO_PATH = ''` 在 Git.tsx 中有 TODO 注释（M5 集成项目上下文），不影响 M4 目标。
