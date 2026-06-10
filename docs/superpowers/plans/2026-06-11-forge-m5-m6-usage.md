# Forge M5+M6 实施计划（使用管理：数据层 + UI + Dashboard）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Forge 的使用管理模块：解析 `~/.claude/projects/` JSONL 会话数据、写入 SQLite sessions/projects 表、PTY 会话生命周期追踪、进程状态轮询、前端 Sessions/Projects 页（Claude Code + Codex 共用组件）、全局 Dashboard 升级（今日统计卡片 + 30 天 recharts 图表 + 运行状态 + 最近会话）、"在 Runner 中恢复/启动"全流程。

**Architecture:** Rust 后端：`commands/usage/` 目录（parser + sync + query），`db/sessions.rs`，`db/projects.rs`；前端：`modules/claude-code/pages/Sessions.tsx`，`modules/claude-code/pages/Projects.tsx`，`modules/codex-cli/pages/Sessions.tsx`，`modules/codex-cli/pages/Projects.tsx`（后者两个为轻量包装），`modules/dashboard/pages/Dashboard.tsx`（全面重写），`lib/launchStore.ts`（全局 launch-request store）。

**Tech Stack:** 复用已有 rusqlite、serde_json、dirs、uuid、tokio；新增 `sysinfo = "0.33"` crate；前端 `npm add recharts`；TypeScript inline-style 深色主题（与 Skills.tsx 一致）。

**Scope:** 仅覆盖设计文档 M5 + M6。Codex Sessions 页仅展示 Forge PTY 追踪的会话（`~/.codex/` 目录不存在，见调研）。

**约定：** 所有命令在仓库根目录 `/Users/wuhoujin/Documents/projects/superchat` 执行。Rust 测试：`cargo test --manifest-path forge/src-tauri/Cargo.toml`。

---

## 数据格式调研

### Claude Code JSONL 格式（实测）

文件位置：`~/.claude/projects/<encoded-path>/<sessionId>.jsonl`

每行是一个独立 JSON 对象，字段因 `type` 而异：

```
type: "last-prompt"   → { type, leafUuid, sessionId }
type: "mode"          → { type, mode, sessionId }
type: "permission-mode" → { type, permissionMode, sessionId }
type: "system"        → { type, sessionId, ... }
type: "user"          → { parentUuid, type, uuid, timestamp, cwd, sessionId, ... }
type: "assistant"     → 包含 usage 数据（见下）
type: "ai-title"      → { type, sessionId, title, ... }
type: "attachment"    → hook 日志等
type: "file-history-snapshot"
type: "queue-operation"
```

**关键：`type == "assistant"` 行的完整结构（实测）：**

```json
{
  "parentUuid": "33e04b5a-...",
  "isSidechain": false,
  "requestId": "req_011Cbu...",
  "type": "assistant",
  "uuid": "af9badf3-...",
  "timestamp": "2026-06-10T15:38:27.729Z",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "/Users/wuhoujin/Documents/projects/superchat",
  "sessionId": "23b6d91b-0282-4552-b9b8-a8091fb37363",
  "version": "2.1.170",
  "gitBranch": "HEAD",
  "message": {
    "role": "assistant",
    "model": "claude-fable-5",
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 7191,
      "cache_creation_input_tokens": 4682,
      "cache_read_input_tokens": 16280,
      "output_tokens": 303,
      "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
      "service_tier": "standard",
      "cache_creation": { "ephemeral_1h_input_tokens": 4682, "ephemeral_5m_input_tokens": 0 },
      "inference_geo": "not_available",
      "iterations": [...],
      "speed": "standard"
    }
  }
}
```

**解析规则：**
- `sessionId`：从文件名（无 `.jsonl`）获取；行内 `sessionId` 字段验证一致性
- `cwd`（工作目录）：取 `type == "assistant"` 行的 `cwd` 字段（首次出现即稳定）
- `started_at`：第一条 `type == "assistant"` 行的 `timestamp`（ISO 8601）
- `ended_at`：最后一条 `type == "assistant"` 行的 `timestamp`
- `model`：`message.model`（首次非空即用）
- `input_tokens`：累加所有 `assistant` 行的 `message.usage.input_tokens`
- `output_tokens`：累加所有 `assistant` 行的 `message.usage.output_tokens`
- 容错：单行 JSON 解析失败 → 跳过并记录 warn！（不中断整体）
- 未知字段：忽略

### Codex CLI 会话数据

`~/.codex/` 目录不存在。因此：

- **Codex Sessions 页仅展示 Forge PTY 追踪到的会话**（tool="codex-cli"，通过 pty_create/pty_kill 写入 sessions 表）
- Codex Projects 页从 sessions 表聚合 codex-cli 会话的 directory 统计
- usage（tokens/cost）对 codex 会话显示 0（无原始日志）

---

## 任务列表

| # | 任务 | 关键产出 |
|---|---|---|
| T1 | 添加 sysinfo + 骨架文件 | Cargo.toml + 模块声明 |
| T2 | db/sessions.rs + db/projects.rs（TDD） | upsert/query CRUD |
| T3 | commands/usage/parser.rs（TDD） | JSONL 解析 + 定价表 |
| T4 | commands/usage/sync.rs + PTY 追踪 | usage_sync 命令 + runner.rs 改造 |
| T5 | commands/usage/query.rs | 查询命令 5 个 |
| T6 | commands/usage/status.rs | get_running_tools + 5s 轮询线程 |
| T7 | lib.rs 注册 + tauri.ts 扩展 | 所有新命令接线 |
| T8 | lib/launchStore.ts + runner.rs extra_args | launch-request store + --resume 支持 |
| T9 | Sessions.tsx + Projects.tsx（共用组件） | Claude Code + Codex 会话/项目页 |
| T10 | Dashboard.tsx 重写 | 今日统计 + 图表 + 运行状态 |
| T11 | Navigation + App.tsx 接线 + git commit | 导航更新 + 验收提交 |

---

## Task 1: 添加 sysinfo 依赖 + 声明新模块骨架

**Files:**
- Modify: `forge/src-tauri/Cargo.toml` — 新增 `sysinfo`
- Create: `forge/src-tauri/src/commands/usage/mod.rs`
- Create: `forge/src-tauri/src/commands/usage/parser.rs`（骨架）
- Create: `forge/src-tauri/src/commands/usage/sync.rs`（骨架）
- Create: `forge/src-tauri/src/commands/usage/query.rs`（骨架）
- Create: `forge/src-tauri/src/commands/usage/status.rs`（骨架）
- Create: `forge/src-tauri/src/db/sessions.rs`（骨架）
- Create: `forge/src-tauri/src/db/projects.rs`（骨架）
- Modify: `forge/src-tauri/src/commands/mod.rs` — `pub mod usage;`
- Modify: `forge/src-tauri/src/db/mod.rs` — `pub mod sessions; pub mod projects;`

- [ ] **Step 1: 添加 sysinfo 到 Cargo.toml**

编辑 `forge/src-tauri/Cargo.toml`，在 `[dependencies]` 段添加：

```toml
sysinfo = "0.33"
```

- [ ] **Step 2: 创建 commands/usage/mod.rs**

```rust
// forge/src-tauri/src/commands/usage/mod.rs
pub mod parser;
pub mod query;
pub mod status;
pub mod sync;
```

- [ ] **Step 3: 骨架 parser.rs**

```rust
// forge/src-tauri/src/commands/usage/parser.rs
use serde::Deserialize;
use std::path::Path;

/// 单条已解析会话（聚合自一个 .jsonl 文件）
#[derive(Debug, Clone)]
pub struct ParsedSession {
    pub session_id: String,
    pub working_dir: String,
    pub started_at: Option<i64>,   // Unix 秒
    pub ended_at: Option<i64>,
    pub model: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub source_path: String,       // .jsonl 绝对路径
}

/// 定价表 (model_id, input_per_1k_usd, output_per_1k_usd)
const PRICING: &[(&str, f64, f64)] = &[
    ("claude-sonnet-4-5", 0.003, 0.015),
    ("claude-sonnet-4-7", 0.003, 0.015),
    ("claude-fable-5",    0.003, 0.015), // 按 sonnet 级别估算
    ("claude-opus-4",     0.015, 0.075),
    ("claude-haiku-4-5",  0.0008, 0.004),
    ("gpt-4o",            0.005,  0.015),
    ("gpt-4o-mini",       0.00015, 0.0006),
];

pub fn estimate_cost(model: &str, input_tokens: i64, output_tokens: i64) -> f64 {
    todo!()
}

/// 解析一个 .jsonl 文件，返回 ParsedSession；失败时返回 Err
pub fn parse_session_file(path: &Path) -> Result<ParsedSession, String> {
    todo!()
}

/// 遍历 base_dir（如 ~/.claude/projects）下的所有 .jsonl 文件
pub fn walk_claude_sessions(base_dir: &Path) -> Vec<ParsedSession> {
    todo!()
}
```

- [ ] **Step 4: 骨架 sync.rs**

```rust
// forge/src-tauri/src/commands/usage/sync.rs
use rusqlite::Connection;

/// 解析 Claude 会话 + 写入 DB；返回同步的会话数
#[tauri::command]
pub fn usage_sync(db: tauri::State<'_, crate::commands::model_switcher::commands::DbState>)
    -> Result<usize, String>
{
    todo!()
}
```

- [ ] **Step 5: 骨架 query.rs**

```rust
// forge/src-tauri/src/commands/usage/query.rs
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SessionRow {
    pub id: String,
    pub tool: String,
    pub working_dir: String,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub duration_sec: Option<i64>,
    pub model: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Serialize)]
pub struct ProjectRow {
    pub id: String,
    pub tool: String,
    pub directory: String,
    pub pinned: bool,
    pub last_used_at: Option<i64>,
    pub session_count: i64,
    pub total_tokens: i64,
    pub total_cost_usd: f64,
}

#[derive(Debug, Serialize)]
pub struct DashboardSummary {
    pub today_input_tokens: i64,
    pub today_output_tokens: i64,
    pub today_cost_usd: f64,
    pub claude_today_tokens: i64,
    pub codex_today_tokens: i64,
    pub recent_sessions: Vec<SessionRow>,
}

#[derive(Debug, Serialize)]
pub struct DailyUsage {
    pub date: String,          // "YYYY-MM-DD"
    pub claude_tokens: i64,
    pub codex_tokens: i64,
    pub total_cost_usd: f64,
}

#[tauri::command]
pub fn get_sessions(
    tool: String,
    limit: Option<i64>,
    offset: Option<i64>,
    db: tauri::State<'_, crate::commands::model_switcher::commands::DbState>,
) -> Result<Vec<SessionRow>, String> { todo!() }

#[tauri::command]
pub fn get_projects(
    tool: String,
    db: tauri::State<'_, crate::commands::model_switcher::commands::DbState>,
) -> Result<Vec<ProjectRow>, String> { todo!() }

#[tauri::command]
pub fn pin_project(
    tool: String,
    directory: String,
    db: tauri::State<'_, crate::commands::model_switcher::commands::DbState>,
) -> Result<(), String> { todo!() }

#[tauri::command]
pub fn unpin_project(
    tool: String,
    directory: String,
    db: tauri::State<'_, crate::commands::model_switcher::commands::DbState>,
) -> Result<(), String> { todo!() }

#[tauri::command]
pub fn get_dashboard(
    db: tauri::State<'_, crate::commands::model_switcher::commands::DbState>,
) -> Result<DashboardSummary, String> { todo!() }

#[tauri::command]
pub fn get_daily_usage(
    days: i64,
    db: tauri::State<'_, crate::commands::model_switcher::commands::DbState>,
) -> Result<Vec<DailyUsage>, String> { todo!() }
```

- [ ] **Step 6: 骨架 status.rs**

```rust
// forge/src-tauri/src/commands/usage/status.rs
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct RunningTool {
    pub tool: String,
    pub pid: u32,
    pub working_dir: Option<String>,
}

#[tauri::command]
pub fn get_running_tools() -> Result<Vec<RunningTool>, String> {
    todo!()
}
```

- [ ] **Step 7: 骨架 db/sessions.rs + db/projects.rs**

```rust
// forge/src-tauri/src/db/sessions.rs
use rusqlite::{Connection, params};
use crate::commands::usage::parser::ParsedSession;

/// Upsert 一条解析好的会话，返回是否为新插入（vs 更新）
pub fn upsert_session(conn: &Connection, s: &ParsedSession) -> Result<bool, String> {
    todo!()
}

/// 通过 sessionId 查询
pub fn get_session(conn: &Connection, id: &str) -> Result<Option<crate::commands::usage::query::SessionRow>, String> {
    todo!()
}
```

```rust
// forge/src-tauri/src/db/projects.rs
use rusqlite::{Connection, params};

/// 重新计算并 upsert 一个 (tool, directory) 的聚合统计
pub fn recompute_project(conn: &Connection, tool: &str, directory: &str) -> Result<(), String> {
    todo!()
}

/// 批量 recompute：遍历 sessions 表中所有 (tool, working_dir) 去重后重算
pub fn recompute_all_projects(conn: &Connection) -> Result<usize, String> {
    todo!()
}

pub fn set_pinned(conn: &Connection, tool: &str, directory: &str, pinned: bool) -> Result<(), String> {
    todo!()
}
```

- [ ] **Step 8: 更新 commands/mod.rs**

在 `forge/src-tauri/src/commands/mod.rs` 末尾追加：

```rust
pub mod usage;
```

- [ ] **Step 9: 更新 db/mod.rs**

在 `forge/src-tauri/src/db/mod.rs` 顶部 `pub mod providers;` 后追加：

```rust
pub mod sessions;
pub mod projects;
```

- [ ] **Step 10: 验证骨架编译**

```bash
cargo build --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep -E "^error" | head -20
```

期望：无 `error`（允许 `todo!()` 警告）

- [ ] **Step 11: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src-tauri/Cargo.toml forge/src-tauri/src/commands/usage/ forge/src-tauri/src/db/sessions.rs forge/src-tauri/src/db/projects.rs forge/src-tauri/src/commands/mod.rs forge/src-tauri/src/db/mod.rs
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m5): add usage module skeleton + sysinfo dep"
```

---

## Task 2: db/sessions.rs + db/projects.rs 实现（TDD）

**Files:**
- Implement: `forge/src-tauri/src/db/sessions.rs`
- Implement: `forge/src-tauri/src/db/projects.rs`

### 红灯

- [ ] **Step 1: 写测试（先跑失败）**

在 `forge/src-tauri/src/db/sessions.rs` 末尾添加测试模块（此时函数体都是 `todo!()`，测试会 panic）：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::commands::usage::parser::ParsedSession;
    use rusqlite::Connection;

    fn mem_conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        c
    }

    fn make_session(id: &str, dir: &str, ts: i64) -> ParsedSession {
        ParsedSession {
            session_id: id.to_string(),
            working_dir: dir.to_string(),
            started_at: Some(ts),
            ended_at: Some(ts + 3600),
            model: Some("claude-sonnet-4-5".to_string()),
            input_tokens: 1000,
            output_tokens: 200,
            cost_usd: 0.006,
            source_path: format!("/tmp/{}.jsonl", id),
        }
    }

    #[test]
    fn upsert_inserts_new() {
        let conn = mem_conn();
        let s = make_session("sess-1", "~/projects/foo", 1700000000);
        let is_new = upsert_session(&conn, &s).unwrap();
        assert!(is_new);
        let row = get_session(&conn, "sess-1").unwrap().unwrap();
        assert_eq!(row.working_dir, "~/projects/foo");
        assert_eq!(row.input_tokens, 1000);
    }

    #[test]
    fn upsert_updates_existing() {
        let conn = mem_conn();
        let mut s = make_session("sess-2", "~/projects/bar", 1700000000);
        upsert_session(&conn, &s).unwrap();
        s.input_tokens = 5000;
        s.output_tokens = 800;
        let is_new = upsert_session(&conn, &s).unwrap();
        assert!(!is_new);
        let row = get_session(&conn, "sess-2").unwrap().unwrap();
        assert_eq!(row.input_tokens, 5000);
    }

    #[test]
    fn upsert_multiple_sessions_same_dir() {
        let conn = mem_conn();
        upsert_session(&conn, &make_session("a1", "~/p/x", 1700000000)).unwrap();
        upsert_session(&conn, &make_session("a2", "~/p/x", 1700001000)).unwrap();
        // Both should exist
        assert!(get_session(&conn, "a1").unwrap().is_some());
        assert!(get_session(&conn, "a2").unwrap().is_some());
    }
}
```

在 `forge/src-tauri/src/db/projects.rs` 末尾也加测试：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::commands::usage::parser::ParsedSession;
    use crate::db::sessions::upsert_session;
    use rusqlite::Connection;

    fn mem_conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        c
    }

    fn insert_sess(conn: &Connection, id: &str, tool: &str, dir: &str, ts: i64, inp: i64, out: i64) {
        let s = ParsedSession {
            session_id: id.to_string(),
            working_dir: dir.to_string(),
            started_at: Some(ts),
            ended_at: Some(ts + 600),
            model: Some("claude-sonnet-4-5".to_string()),
            input_tokens: inp,
            output_tokens: out,
            cost_usd: (inp as f64 / 1000.0) * 0.003 + (out as f64 / 1000.0) * 0.015,
            source_path: "/tmp/x.jsonl".to_string(),
        };
        // Manually insert with tool since ParsedSession doesn't carry tool
        conn.execute(
            "INSERT OR REPLACE INTO sessions (id, tool, working_dir, started_at, ended_at, model, input_tokens, output_tokens, cost_usd, raw_source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                s.session_id, tool, s.working_dir,
                s.started_at, s.ended_at, s.model,
                s.input_tokens, s.output_tokens, s.cost_usd, s.source_path
            ],
        ).unwrap();
    }

    #[test]
    fn recompute_aggregates_correctly() {
        let conn = mem_conn();
        insert_sess(&conn, "s1", "claude-code", "/p/foo", 1700000000, 1000, 100);
        insert_sess(&conn, "s2", "claude-code", "/p/foo", 1700001000, 2000, 200);
        recompute_project(&conn, "claude-code", "/p/foo").unwrap();

        let row: (i64, i64) = conn.query_row(
            "SELECT session_count, total_tokens FROM projects WHERE tool='claude-code' AND directory='/p/foo'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(row.0, 2);           // 2 sessions
        assert_eq!(row.1, 3300);        // 1000+100+2000+200
    }

    #[test]
    fn set_pinned_toggles() {
        let conn = mem_conn();
        insert_sess(&conn, "s3", "claude-code", "/p/bar", 1700000000, 100, 10);
        recompute_project(&conn, "claude-code", "/p/bar").unwrap();
        set_pinned(&conn, "claude-code", "/p/bar", true).unwrap();
        let pinned: i64 = conn.query_row(
            "SELECT pinned FROM projects WHERE tool='claude-code' AND directory='/p/bar'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(pinned, 1);
    }

    #[test]
    fn recompute_all_handles_multiple_tools() {
        let conn = mem_conn();
        insert_sess(&conn, "s4", "claude-code", "/p/a", 1700000000, 500, 50);
        insert_sess(&conn, "s5", "codex-cli",   "/p/b", 1700000000, 300, 30);
        let count = recompute_all_projects(&conn).unwrap();
        assert_eq!(count, 2); // 2 unique (tool, directory) combos
    }
}
```

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml db::sessions::tests 2>&1 | tail -5
# 期望: FAILED (todo! panics)
```

### 绿灯

- [ ] **Step 2: 实现 db/sessions.rs**

```rust
// forge/src-tauri/src/db/sessions.rs
use rusqlite::{params, Connection};
use crate::commands::usage::parser::ParsedSession;
use crate::commands::usage::query::SessionRow;

pub fn upsert_session(conn: &Connection, s: &ParsedSession) -> Result<bool, String> {
    // Check if exists
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",
        [&s.session_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO sessions
         (id, tool, working_dir, started_at, ended_at, duration_sec, model,
          input_tokens, output_tokens, cost_usd, raw_source)
         VALUES (?1, 'claude-code', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            s.session_id,
            s.working_dir,
            s.started_at,
            s.ended_at,
            s.ended_at.zip(s.started_at).map(|(e, st)| e - st),
            s.model,
            s.input_tokens,
            s.output_tokens,
            s.cost_usd,
            s.source_path,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(!exists)
}

pub fn get_session(conn: &Connection, id: &str) -> Result<Option<SessionRow>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, tool, working_dir, started_at, ended_at, duration_sec,
                model, input_tokens, output_tokens, cost_usd
         FROM sessions WHERE id=?1",
    ).map_err(|e| e.to_string())?;

    let mut rows = stmt.query([id]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(Some(SessionRow {
            id:           row.get(0).map_err(|e| e.to_string())?,
            tool:         row.get(1).map_err(|e| e.to_string())?,
            working_dir:  row.get(2).map_err(|e| e.to_string())?,
            started_at:   row.get(3).map_err(|e| e.to_string())?,
            ended_at:     row.get(4).map_err(|e| e.to_string())?,
            duration_sec: row.get(5).map_err(|e| e.to_string())?,
            model:        row.get(6).map_err(|e| e.to_string())?,
            input_tokens: row.get(7).map_err(|e| e.to_string())?,
            output_tokens:row.get(8).map_err(|e| e.to_string())?,
            cost_usd:     row.get(9).map_err(|e| e.to_string())?,
        }))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    // ... (tests already shown above)
}
```

- [ ] **Step 3: 实现 db/projects.rs**

```rust
// forge/src-tauri/src/db/projects.rs
use rusqlite::{params, Connection};
use uuid::Uuid;

pub fn recompute_project(conn: &Connection, tool: &str, directory: &str) -> Result<(), String> {
    // Aggregate from sessions
    let (session_count, total_input, total_output, total_cost, last_used): (i64, i64, i64, f64, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0),
                    COALESCE(SUM(cost_usd),0.0), MAX(started_at)
             FROM sessions WHERE tool=?1 AND working_dir=?2",
            params![tool, directory],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| e.to_string())?;

    let total_tokens = total_input + total_output;

    // Check if project row exists
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE tool=?1 AND directory=?2)",
        params![tool, directory],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    if exists {
        conn.execute(
            "UPDATE projects SET session_count=?1, total_tokens=?2, total_cost_usd=?3,
             last_used_at=?4 WHERE tool=?5 AND directory=?6",
            params![session_count, total_tokens, total_cost, last_used, tool, directory],
        ).map_err(|e| e.to_string())?;
    } else {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO projects (id, tool, directory, pinned, last_used_at, session_count,
             total_tokens, total_cost_usd) VALUES (?1,?2,?3,0,?4,?5,?6,?7)",
            params![id, tool, directory, last_used, session_count, total_tokens, total_cost],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn recompute_all_projects(conn: &Connection) -> Result<usize, String> {
    // Get all unique (tool, working_dir) combos from sessions
    let mut stmt = conn.prepare(
        "SELECT DISTINCT tool, working_dir FROM sessions"
    ).map_err(|e| e.to_string())?;
    let combos: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let count = combos.len();
    for (tool, dir) in combos {
        recompute_project(conn, &tool, &dir)?;
    }
    Ok(count)
}

pub fn set_pinned(conn: &Connection, tool: &str, directory: &str, pinned: bool) -> Result<(), String> {
    conn.execute(
        "UPDATE projects SET pinned=?1 WHERE tool=?2 AND directory=?3",
        params![pinned as i32, tool, directory],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    // ... (tests already shown above)
}
```

- [ ] **Step 4: 绿灯验证**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml db::sessions::tests db::projects::tests 2>&1 | tail -10
# 期望：test result: ok. X passed
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src-tauri/src/db/sessions.rs forge/src-tauri/src/db/projects.rs
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m5): implement db/sessions + db/projects with TDD"
```

---

## Task 3: commands/usage/parser.rs 实现（TDD）

**Files:**
- Implement: `forge/src-tauri/src/commands/usage/parser.rs`

### 红灯

- [ ] **Step 1: 创建 fixture JSONL 并写测试**

在 `forge/src-tauri/src/commands/usage/parser.rs` 末尾加测试：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    // Minimal fixture matching real schema
    fn write_fixture(lines: &[&str]) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        for line in lines {
            writeln!(f, "{}", line).unwrap();
        }
        f
    }

    const LINE_NON_ASSISTANT: &str = r#"{"type":"mode","mode":"normal","sessionId":"abc-123"}"#;

    const LINE_ASSISTANT_1: &str = r#"{
        "type":"assistant","sessionId":"abc-123","timestamp":"2026-06-10T10:00:00.000Z",
        "cwd":"/Users/test/projects/foo",
        "message":{"role":"assistant","model":"claude-sonnet-4-5","stop_reason":"end_turn",
            "usage":{"input_tokens":1000,"output_tokens":200,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}"#;

    const LINE_ASSISTANT_2: &str = r#"{
        "type":"assistant","sessionId":"abc-123","timestamp":"2026-06-10T11:30:00.000Z",
        "cwd":"/Users/test/projects/foo",
        "message":{"role":"assistant","model":"claude-sonnet-4-5","stop_reason":"end_turn",
            "usage":{"input_tokens":2000,"output_tokens":400,"cache_creation_input_tokens":100,"cache_read_input_tokens":500}}}"#;

    const LINE_BAD_JSON: &str = r#"{bad json!!!"#;

    #[test]
    fn parse_aggregates_tokens() {
        let f = write_fixture(&[LINE_NON_ASSISTANT, LINE_ASSISTANT_1, LINE_ASSISTANT_2]);
        let result = parse_session_file(f.path()).unwrap();
        // session_id from filename (NamedTempFile has random name, use the path stem)
        assert_eq!(result.input_tokens, 3000);
        assert_eq!(result.output_tokens, 600);
        assert_eq!(result.model, Some("claude-sonnet-4-5".to_string()));
        // cwd
        assert_eq!(result.working_dir, "/Users/test/projects/foo");
    }

    #[test]
    fn parse_timestamps() {
        let f = write_fixture(&[LINE_ASSISTANT_1, LINE_ASSISTANT_2]);
        let result = parse_session_file(f.path()).unwrap();
        // started_at = first assistant line timestamp
        let started = result.started_at.unwrap();
        let ended   = result.ended_at.unwrap();
        assert!(started < ended, "started={started} ended={ended}");
        // 2026-06-10T10:00:00Z → 1749553200 (approx)
        assert!(started > 1_700_000_000);
    }

    #[test]
    fn tolerates_bad_json_lines() {
        let f = write_fixture(&[LINE_BAD_JSON, LINE_ASSISTANT_1]);
        // Should not error — bad line skipped
        let result = parse_session_file(f.path()).unwrap();
        assert_eq!(result.input_tokens, 1000);
    }

    #[test]
    fn empty_file_returns_error() {
        let f = write_fixture(&[]);
        // A file with no assistant lines → Err (no data to aggregate)
        assert!(parse_session_file(f.path()).is_err());
    }

    #[test]
    fn estimate_cost_known_model() {
        // claude-sonnet-4-5: 0.003 per 1k input, 0.015 per 1k output
        let cost = estimate_cost("claude-sonnet-4-5", 1000, 1000);
        assert!((cost - 0.018).abs() < 0.0001);
    }

    #[test]
    fn estimate_cost_unknown_model_zero() {
        let cost = estimate_cost("unknown-model-xyz", 9999, 9999);
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn walk_finds_jsonl_files() {
        let dir = tempfile::tempdir().unwrap();
        // Create subdir (like ~/.claude/projects/<encoded-path>/)
        let subdir = dir.path().join("project-a");
        std::fs::create_dir_all(&subdir).unwrap();
        let fpath = subdir.join("session-xyz.jsonl");
        std::fs::write(&fpath, format!("{}\n{}\n", LINE_ASSISTANT_1, LINE_ASSISTANT_2)).unwrap();

        let sessions = walk_claude_sessions(dir.path());
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].input_tokens, 3000);
    }
}
```

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml commands::usage::parser::tests 2>&1 | tail -5
# 期望: FAILED
```

### 绿灯

- [ ] **Step 2: 实现 parser.rs**

```rust
// forge/src-tauri/src/commands/usage/parser.rs
use serde::Deserialize;
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct ParsedSession {
    pub session_id: String,
    pub working_dir: String,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub model: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub source_path: String,
}

/// 定价表 (model_id_prefix, input_per_1k_usd, output_per_1k_usd)
const PRICING: &[(&str, f64, f64)] = &[
    ("claude-sonnet-4-5", 0.003,  0.015),
    ("claude-sonnet-4-7", 0.003,  0.015),
    ("claude-fable-5",    0.003,  0.015),
    ("claude-opus-4",     0.015,  0.075),
    ("claude-haiku-4-5",  0.0008, 0.004),
    ("gpt-4o-mini",       0.00015, 0.0006),
    ("gpt-4o",            0.005,  0.015),
];

pub fn estimate_cost(model: &str, input_tokens: i64, output_tokens: i64) -> f64 {
    for (prefix, inp_price, out_price) in PRICING {
        if model.starts_with(prefix) {
            return (input_tokens as f64 / 1000.0) * inp_price
                 + (output_tokens as f64 / 1000.0) * out_price;
        }
    }
    0.0
}

/// Parse ISO 8601 timestamp string to Unix seconds (UTC).
fn parse_ts(ts: &str) -> Option<i64> {
    // 2026-06-10T15:38:27.729Z  or  2026-06-10T15:38:27Z
    // Trim milliseconds: keep up to 'Z'
    let s = ts.trim_end_matches('Z');
    // Split at 'T'
    let parts: Vec<&str> = s.splitn(2, 'T').collect();
    if parts.len() != 2 { return None; }
    let date_parts: Vec<u64> = parts[0].split('-').filter_map(|x| x.parse().ok()).collect();
    let time_parts: Vec<u64> = parts[1].split(':').filter_map(|x|
        x.split('.').next().and_then(|n| n.parse().ok())
    ).collect();
    if date_parts.len() < 3 || time_parts.len() < 3 { return None; }
    // Days since epoch (crude but fast, good enough for display)
    let y = date_parts[0];
    let m = date_parts[1];
    let d = date_parts[2];
    // Zeller / days-since-epoch calculation
    let days = days_since_epoch(y, m, d)?;
    let secs = days * 86400
        + time_parts[0] * 3600
        + time_parts[1] * 60
        + time_parts[2];
    Some(secs as i64)
}

fn days_since_epoch(y: u64, m: u64, d: u64) -> Option<u64> {
    // Days since 1970-01-01
    // Use the standard formula
    let y = y as i64;
    let m = m as i64;
    let d = d as i64;
    let m_adj = (m + 9) % 12;
    let y_adj = y - m_adj / 10;
    let days = 365 * y_adj + y_adj / 4 - y_adj / 100 + y_adj / 400
        + (m_adj * 306 + 5) / 10 + (d - 1)
        - 719468; // offset to Unix epoch
    if days < 0 { None } else { Some(days as u64) }
}

pub fn parse_session_file(path: &Path) -> Result<ParsedSession, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    let source_path = path.to_string_lossy().to_string();

    let mut working_dir: Option<String> = None;
    let mut model: Option<String> = None;
    let mut started_at: Option<i64> = None;
    let mut ended_at: Option<i64> = None;
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;

    for (line_no, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let obj: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                // Tolerant parse: skip bad lines
                log_warn(&format!("{}:{}: skip bad JSON: {}", source_path, line_no + 1, e));
                continue;
            }
        };

        if obj.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }

        // cwd
        if working_dir.is_none() {
            if let Some(cwd) = obj.get("cwd").and_then(|v| v.as_str()) {
                working_dir = Some(cwd.to_string());
            }
        }

        // timestamp
        if let Some(ts_str) = obj.get("timestamp").and_then(|v| v.as_str()) {
            if let Some(ts) = parse_ts(ts_str) {
                if started_at.is_none() { started_at = Some(ts); }
                ended_at = Some(ts);
            }
        }

        // usage
        let msg = match obj.get("message") { Some(m) => m, None => continue };
        if model.is_none() {
            if let Some(m) = msg.get("model").and_then(|v| v.as_str()) {
                model = Some(m.to_string());
            }
        }
        if let Some(usage) = msg.get("usage") {
            total_input  += usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
            total_output += usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
        }
    }

    if total_input == 0 && total_output == 0 && started_at.is_none() {
        return Err(format!("no assistant lines in {}", source_path));
    }

    let cost = model.as_deref()
        .map(|m| estimate_cost(m, total_input, total_output))
        .unwrap_or(0.0);

    Ok(ParsedSession {
        session_id,
        working_dir: working_dir.unwrap_or_default(),
        started_at,
        ended_at,
        model,
        input_tokens: total_input,
        output_tokens: total_output,
        cost_usd: cost,
        source_path,
    })
}

fn log_warn(msg: &str) {
    eprintln!("[WARN] {}", msg);
}

/// 遍历 base_dir 下的所有 .jsonl 文件（递归两层：base_dir/<encoded-project>/*.jsonl）
pub fn walk_claude_sessions(base_dir: &Path) -> Vec<ParsedSession> {
    let mut results = Vec::new();
    let Ok(entries) = std::fs::read_dir(base_dir) else { return results; };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let Ok(sub_entries) = std::fs::read_dir(&path) else { continue; };
            for sub_entry in sub_entries.flatten() {
                let sub_path = sub_entry.path();
                if sub_path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                    match parse_session_file(&sub_path) {
                        Ok(s) => results.push(s),
                        Err(e) => log_warn(&format!("skip {}: {}", sub_path.display(), e)),
                    }
                }
            }
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            match parse_session_file(&path) {
                Ok(s) => results.push(s),
                Err(e) => log_warn(&format!("skip {}: {}", path.display(), e)),
            }
        }
    }
    results
}

#[cfg(test)]
mod tests {
    // (paste tests from Step 1 here)
}
```

- [ ] **Step 3: 绿灯验证**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml commands::usage::parser::tests 2>&1 | tail -10
# 期望: test result: ok. 7 passed
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src-tauri/src/commands/usage/parser.rs
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m5): implement claude JSONL parser with TDD"
```

---

## Task 4: usage_sync 命令 + PTY 会话追踪

**Files:**
- Implement: `forge/src-tauri/src/commands/usage/sync.rs`
- Modify: `forge/src-tauri/src/commands/runner.rs` — PTY 生命周期写 sessions 表

- [ ] **Step 1: 实现 sync.rs**

```rust
// forge/src-tauri/src/commands/usage/sync.rs
use crate::commands::model_switcher::commands::DbState;
use crate::commands::usage::parser::walk_claude_sessions;
use crate::db::{sessions::upsert_session, projects::recompute_all_projects};
use tauri::State;

#[tauri::command]
pub fn usage_sync(db: State<'_, DbState>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // 1. Determine Claude projects base dir
    let base_dir = dirs::home_dir()
        .map(|h| h.join(".claude/projects"))
        .ok_or("cannot find home dir")?;

    // 2. Walk and parse sessions
    let sessions = walk_claude_sessions(&base_dir);
    let total = sessions.len();

    // 3. Upsert each into DB
    for s in &sessions {
        if let Err(e) = upsert_session(&conn, s) {
            eprintln!("[WARN] upsert_session {}: {}", s.session_id, e);
        }
    }

    // 4. Recompute project aggregates
    let _ = recompute_all_projects(&conn);

    Ok(total)
}
```

- [ ] **Step 2: 改造 runner.rs — PTY 生命周期写 sessions 表**

在 `pty_create` 成功启动后，插入 sessions 行（tool, working_dir, started_at）；
在 PTY exit 回调中，更新 ended_at 和 duration_sec。

找到 `forge/src-tauri/src/commands/runner.rs` 中 `pty_create` 函数，在 `session = PtySession::spawn(...)` 调用之前添加：

```rust
// Track session start in DB
let now_unix = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs() as i64;
let db_session_id = session_id.clone();
let db_tool = tool.clone();
let db_dir = working_dir.clone();
if let Some(db_path) = crate::db::default_path() {
    if let Ok(conn) = crate::db::open(&db_path) {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO sessions (id, tool, working_dir, started_at, input_tokens, output_tokens, cost_usd)
             VALUES (?1, ?2, ?3, ?4, 0, 0, 0.0)",
            rusqlite::params![db_session_id, db_tool, db_dir, now_unix],
        );
    }
}
```

在 exit 回调 `move || { ... }` 内追加：

```rust
// Update session end time
let ended_unix = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs() as i64;
if let Some(db_path) = crate::db::default_path() {
    if let Ok(conn) = crate::db::open(&db_path) {
        let _ = conn.execute(
            "UPDATE sessions SET ended_at=?1, duration_sec=ended_at-started_at WHERE id=?2",
            rusqlite::params![ended_unix, sid_exit],
        );
        // Recompute project aggregates for this dir
        let _ = crate::db::projects::recompute_project(&conn, &tool_exit, &dir_exit);
    }
}
```

注意：需要在 exit 闭包中捕获 `tool_exit` 和 `dir_exit`（从外部 clone 两个变量进去）。

- [ ] **Step 3: 验证编译**

```bash
cargo build --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep "^error" | head -10
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src-tauri/src/commands/usage/sync.rs forge/src-tauri/src/commands/runner.rs
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m5): usage_sync command + PTY session lifecycle tracking"
```

---

## Task 5: commands/usage/query.rs 实现

**Files:**
- Implement: `forge/src-tauri/src/commands/usage/query.rs`

- [ ] **Step 1: 实现 query.rs**

```rust
// forge/src-tauri/src/commands/usage/query.rs
use crate::commands::model_switcher::commands::DbState;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize, Clone)]
pub struct SessionRow {
    pub id: String,
    pub tool: String,
    pub working_dir: String,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub duration_sec: Option<i64>,
    pub model: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProjectRow {
    pub id: String,
    pub tool: String,
    pub directory: String,
    pub pinned: bool,
    pub last_used_at: Option<i64>,
    pub session_count: i64,
    pub total_tokens: i64,
    pub total_cost_usd: f64,
}

#[derive(Debug, Serialize)]
pub struct DashboardSummary {
    pub today_input_tokens: i64,
    pub today_output_tokens: i64,
    pub today_cost_usd: f64,
    pub claude_today_tokens: i64,
    pub codex_today_tokens: i64,
    pub recent_sessions: Vec<SessionRow>,
}

#[derive(Debug, Serialize)]
pub struct DailyUsage {
    pub date: String,           // "YYYY-MM-DD"
    pub claude_tokens: i64,
    pub codex_tokens: i64,
    pub total_cost_usd: f64,
}

fn row_to_session(row: &rusqlite::Row) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id:           row.get(0)?,
        tool:         row.get(1)?,
        working_dir:  row.get(2)?,
        started_at:   row.get(3)?,
        ended_at:     row.get(4)?,
        duration_sec: row.get(5)?,
        model:        row.get(6)?,
        input_tokens: row.get(7)?,
        output_tokens:row.get(8)?,
        cost_usd:     row.get(9)?,
    })
}

#[tauri::command]
pub fn get_sessions(
    tool: String,
    limit: Option<i64>,
    offset: Option<i64>,
    db: State<'_, DbState>,
) -> Result<Vec<SessionRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(50);
    let off = offset.unwrap_or(0);
    let mut stmt = conn.prepare(
        "SELECT id, tool, working_dir, started_at, ended_at, duration_sec,
                model, input_tokens, output_tokens, cost_usd
         FROM sessions WHERE tool=?1
         ORDER BY started_at DESC LIMIT ?2 OFFSET ?3",
    ).map_err(|e| e.to_string())?;
    stmt.query_map(params![tool, lim, off], row_to_session)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_projects(
    tool: String,
    db: State<'_, DbState>,
) -> Result<Vec<ProjectRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, tool, directory, pinned, last_used_at, session_count, total_tokens, total_cost_usd
         FROM projects WHERE tool=?1
         ORDER BY pinned DESC, last_used_at DESC",
    ).map_err(|e| e.to_string())?;
    stmt.query_map(params![tool], |row| Ok(ProjectRow {
        id:            row.get(0)?,
        tool:          row.get(1)?,
        directory:     row.get(2)?,
        pinned:        row.get::<_, i64>(3)? == 1,
        last_used_at:  row.get(4)?,
        session_count: row.get(5)?,
        total_tokens:  row.get(6)?,
        total_cost_usd:row.get(7)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pin_project(
    tool: String,
    directory: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::projects::set_pinned(&conn, &tool, &directory, true)
}

#[tauri::command]
pub fn unpin_project(
    tool: String,
    directory: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::projects::set_pinned(&conn, &tool, &directory, false)
}

#[tauri::command]
pub fn get_dashboard(db: State<'_, DbState>) -> Result<DashboardSummary, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Today = Unix day boundary (seconds from epoch to start of today UTC)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let today_start = now - (now % 86400);

    let (today_input, today_output, today_cost): (i64, i64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cost_usd),0.0)
         FROM sessions WHERE started_at >= ?1",
        params![today_start],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).map_err(|e| e.to_string())?;

    let claude_today: i64 = conn.query_row(
        "SELECT COALESCE(SUM(input_tokens+output_tokens),0) FROM sessions WHERE tool='claude-code' AND started_at>=?1",
        params![today_start], |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    let codex_today: i64 = conn.query_row(
        "SELECT COALESCE(SUM(input_tokens+output_tokens),0) FROM sessions WHERE tool='codex-cli' AND started_at>=?1",
        params![today_start], |r| r.get(0),
    ).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, tool, working_dir, started_at, ended_at, duration_sec,
                model, input_tokens, output_tokens, cost_usd
         FROM sessions ORDER BY started_at DESC LIMIT 10",
    ).map_err(|e| e.to_string())?;
    let recent = stmt.query_map([], row_to_session)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(DashboardSummary {
        today_input_tokens:  today_input,
        today_output_tokens: today_output,
        today_cost_usd:      today_cost,
        claude_today_tokens: claude_today,
        codex_today_tokens:  codex_today,
        recent_sessions:     recent,
    })
}

#[tauri::command]
pub fn get_daily_usage(days: i64, db: State<'_, DbState>) -> Result<Vec<DailyUsage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let since = now - days * 86400;

    let mut stmt = conn.prepare(
        "SELECT
            strftime('%Y-%m-%d', started_at, 'unixepoch') as d,
            SUM(CASE WHEN tool='claude-code' THEN input_tokens+output_tokens ELSE 0 END),
            SUM(CASE WHEN tool='codex-cli'   THEN input_tokens+output_tokens ELSE 0 END),
            SUM(cost_usd)
         FROM sessions
         WHERE started_at >= ?1
         GROUP BY d
         ORDER BY d ASC",
    ).map_err(|e| e.to_string())?;

    stmt.query_map(params![since], |row| Ok(DailyUsage {
        date:          row.get(0)?,
        claude_tokens: row.get(1)?,
        codex_tokens:  row.get(2)?,
        total_cost_usd:row.get(3)?,
    }))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: 验证编译**

```bash
cargo build --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep "^error" | head -10
```

- [ ] **Step 3: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src-tauri/src/commands/usage/query.rs
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m5): implement usage query commands (get_sessions/projects/dashboard/daily)"
```

---

## Task 6: get_running_tools + 5s 轮询线程

**Files:**
- Implement: `forge/src-tauri/src/commands/usage/status.rs`
- Modify: `forge/src-tauri/src/lib.rs` — 启动轮询线程

- [ ] **Step 1: 实现 status.rs**

```rust
// forge/src-tauri/src/commands/usage/status.rs
use serde::Serialize;
use sysinfo::{ProcessesToUpdate, System};

#[derive(Debug, Serialize, Clone)]
pub struct RunningTool {
    pub tool: String,          // "claude-code" | "codex-cli"
    pub pid: u32,
    pub working_dir: Option<String>,
}

const TOOL_PROCESS_NAMES: &[(&str, &str)] = &[
    ("claude", "claude-code"),
    ("codex",  "codex-cli"),
];

pub fn scan_running_tools() -> Vec<RunningTool> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut results = Vec::new();
    for (proc_name, tool_id) in TOOL_PROCESS_NAMES {
        for (pid, proc) in sys.processes() {
            let name = proc.name().to_string_lossy().to_lowercase();
            if name == *proc_name || name.starts_with(proc_name) {
                // Try to get working dir from process exe path or cwd
                let working_dir = proc.exe()
                    .and_then(|p| p.parent())
                    .map(|p| p.to_string_lossy().to_string());
                results.push(RunningTool {
                    tool: tool_id.to_string(),
                    pid: pid.as_u32(),
                    working_dir,
                });
            }
        }
    }
    results
}

#[tauri::command]
pub fn get_running_tools() -> Result<Vec<RunningTool>, String> {
    Ok(scan_running_tools())
}
```

- [ ] **Step 2: 在 lib.rs setup 中启动 5s 轮询线程**

在 `forge/src-tauri/src/lib.rs` 的 `.setup(|app| { ... })` 闭包内，紧接现有代码后添加：

```rust
// 启动 tools:status 轮询线程（每 5 秒）
{
    let app_handle = app.handle().clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            let tools = crate::commands::usage::status::scan_running_tools();
            let _ = app_handle.emit("tools:status", tools);
        }
    });
}
```

- [ ] **Step 3: 验证编译**

```bash
cargo build --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep "^error" | head -10
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src-tauri/src/commands/usage/status.rs forge/src-tauri/src/lib.rs
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m5): running tools scan + 5s polling thread emitting tools:status"
```

---

## Task 7: lib.rs 注册新命令 + tauri.ts 扩展

**Files:**
- Modify: `forge/src-tauri/src/lib.rs` — 注册所有 M5 命令
- Modify: `forge/src/lib/tauri.ts` — 新增 usage API 类型 + 函数

- [ ] **Step 1: 注册新命令到 invoke_handler**

在 `forge/src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 数组末尾追加：

```rust
// M5 Usage
commands::usage::sync::usage_sync,
commands::usage::query::get_sessions,
commands::usage::query::get_projects,
commands::usage::query::pin_project,
commands::usage::query::unpin_project,
commands::usage::query::get_dashboard,
commands::usage::query::get_daily_usage,
commands::usage::status::get_running_tools,
```

- [ ] **Step 2: 扩展 tauri.ts**

在 `forge/src/lib/tauri.ts` 中 `EnvVar` 接口后新增类型：

```typescript
// Usage types
export interface SessionRow {
  id: string
  tool: string
  working_dir: string
  started_at: number | null
  ended_at: number | null
  duration_sec: number | null
  model: string | null
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface ProjectRow {
  id: string
  tool: string
  directory: string
  pinned: boolean
  last_used_at: number | null
  session_count: number
  total_tokens: number
  total_cost_usd: number
}

export interface DashboardSummary {
  today_input_tokens: number
  today_output_tokens: number
  today_cost_usd: number
  claude_today_tokens: number
  codex_today_tokens: number
  recent_sessions: SessionRow[]
}

export interface DailyUsage {
  date: string           // "YYYY-MM-DD"
  claude_tokens: number
  codex_tokens: number
  total_cost_usd: number
}

export interface RunningTool {
  tool: string
  pid: number
  working_dir: string | null
}
```

在 `export const api = { ... }` 末尾的最后一个 `}` 前，追加：

```typescript
  usage: {
    sync:          ()                    => inv<number>('usage_sync'),
    getSessions:   (tool: string, limit?: number, offset?: number)
                                         => inv<SessionRow[]>('get_sessions', { tool, limit, offset }),
    getProjects:   (tool: string)        => inv<ProjectRow[]>('get_projects', { tool }),
    pinProject:    (tool: string, directory: string) => inv<void>('pin_project', { tool, directory }),
    unpinProject:  (tool: string, directory: string) => inv<void>('unpin_project', { tool, directory }),
    getDashboard:  ()                    => inv<DashboardSummary>('get_dashboard'),
    getDailyUsage: (days: number)        => inv<DailyUsage[]>('get_daily_usage', { days }),
    getRunningTools: ()                  => inv<RunningTool[]>('get_running_tools'),
  },
```

- [ ] **Step 3: 验证 Rust 编译**

```bash
cargo build --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep "^error" | head -10
```

- [ ] **Step 4: 验证 TS 类型检查**

```bash
cd forge && npx tsc --noEmit 2>&1 | head -20; cd ..
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src-tauri/src/lib.rs forge/src/lib/tauri.ts
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m5): register usage commands + extend tauri.ts API"
```

---

## Task 8: launchStore + --resume 支持（extra_args）

**Files:**
- Create: `forge/src/lib/launchStore.ts`
- Modify: `forge/src-tauri/src/commands/runner.rs` — pty_create 增加 extra_args 参数

**目的：** "在 Runner 中恢复会话"需要前端导航到 Runner 页并以特定参数启动一个 PTY。两个页面（Sessions → Runner）通过模块级 store 传递 launch-request。

- [ ] **Step 1: 创建 forge/src/lib/launchStore.ts**

```typescript
// forge/src/lib/launchStore.ts
// 轻量全局 launch-request store（无 Zustand 依赖，module-level 单例）
// 用于 Sessions/Projects 页向 Runner 页传递"待启动 PTY"请求。

export interface LaunchRequest {
  tool: string          // "claude-code" | "codex-cli"
  workingDir: string
  extraArgs?: string[]  // 例如 ["--resume", "<sessionId>"]
}

type Subscriber = (req: LaunchRequest | null) => void

let _request: LaunchRequest | null = null
const _subs: Set<Subscriber> = new Set()

export const launchStore = {
  /** Sessions/Projects 页调用：设置待启动请求，并导航到 runner 页 */
  set(req: LaunchRequest) {
    _request = req
    _subs.forEach(fn => fn(_request))
  },

  /** Runner 页调用：消费请求（消费后清空） */
  consume(): LaunchRequest | null {
    const r = _request
    _request = null
    return r
  },

  /** Runner 页 useEffect 订阅变更 */
  subscribe(fn: Subscriber): () => void {
    _subs.add(fn)
    return () => _subs.delete(fn)
  },
}
```

- [ ] **Step 2: 改造 pty_create 增加 extra_args**

在 `forge/src-tauri/src/commands/runner.rs` 中，修改 `pty_create` 签名：

```rust
#[tauri::command]
pub fn pty_create(
    tool: String,
    working_dir: String,
    extra_args: Option<Vec<String>>,   // 新增：如 ["--resume", "<sessionId>"]
    app: AppHandle,
    registry: State<'_, SessionRegistry>,
) -> Result<String, String> {
```

在 `PtySession::spawn(...)` 调用中，将 `extra_args` 传给 `PtySession::spawn`（需同步修改 pty/session.rs 的 spawn 签名以接受 `extra_args: Option<Vec<String>>`，并 append 到启动命令行参数后）。

具体修改 `forge/src-tauri/src/pty/session.rs` 的 `spawn` 函数签名：

```rust
pub fn spawn(
    id: &str,
    tool: &str,
    cmd: &str,
    working_dir: &str,
    env_vars: Vec<(String, String)>,
    extra_args: Option<Vec<String>>,    // 新增
    on_output: impl Fn(Vec<u8>) + Send + 'static,
    on_exit: impl Fn() + Send + 'static,
) -> Result<PtySession, String>
```

在 spawn 内，创建 `CommandBuilder` 后追加：

```rust
if let Some(args) = extra_args {
    for arg in args {
        cmd_builder.arg(arg);
    }
}
```

- [ ] **Step 3: 更新 tauri.ts 中 runner.create**

```typescript
// forge/src/lib/tauri.ts — runner.create 改为：
create: (tool: string, workingDir: string, extraArgs?: string[]) =>
  inv<string>('pty_create', { tool, workingDir, extraArgs }),
```

- [ ] **Step 4: 验证编译**

```bash
cargo build --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep "^error" | head -10
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src/lib/launchStore.ts forge/src-tauri/src/commands/runner.rs forge/src-tauri/src/pty/session.rs forge/src/lib/tauri.ts
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m6): launchStore + extra_args for pty_create (--resume support)"
```

---

## Task 9: Sessions.tsx + Projects.tsx 共用组件

**Files:**
- Create: `forge/src/modules/claude-code/pages/Sessions.tsx`
- Create: `forge/src/modules/claude-code/pages/Projects.tsx`
- Create: `forge/src/modules/codex-cli/pages/Sessions.tsx`
- Create: `forge/src/modules/codex-cli/pages/Projects.tsx`

前两个为完整实现；后两个为以 `tool="codex-cli"` 调用相同逻辑的轻量包装。

- [ ] **Step 1: 创建 forge/src/modules/claude-code/pages/Sessions.tsx**

```tsx
// forge/src/modules/claude-code/pages/Sessions.tsx
import { useEffect, useState } from 'react'
import { api, SessionRow } from '../../../lib/tauri'
import { launchStore } from '../../../lib/launchStore'

const s = {
  container: { padding: 24, color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif', height: '100%', overflow: 'auto' as const },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  heading: { fontSize: 20, fontWeight: 700 },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  btn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnSm: { padding: '4px 10px', background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  card: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: '14px 16px', marginBottom: 10 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#a3a3a3' },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: '#1f2937', color: '#9ca3af', fontSize: 11, border: '1px solid #374151', marginRight: 6 },
  actions: { display: 'flex', gap: 6, marginTop: 10 },
}

function fmtTime(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function fmtDuration(sec: number | null): string {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtCost(usd: number): string {
  return usd > 0 ? `$${usd.toFixed(4)}` : '—'
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return `${n}`
}

interface SessionsProps {
  tool?: string
  onNavigate?: (id: string) => void
}

export default function Sessions({ tool = 'claude-code', onNavigate }: SessionsProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.usage.getSessions(tool, 50)
      setSessions(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.usage.sync()
      await load()
    } finally {
      setSyncing(false)
    }
  }

  const handleResume = (sess: SessionRow) => {
    launchStore.set({
      tool: sess.tool,
      workingDir: sess.working_dir,
      extraArgs: sess.tool === 'claude-code' ? ['--resume', sess.id] : undefined,
    })
    onNavigate?.('runner')
  }

  useEffect(() => { load() }, [tool])

  const toolLabel = tool === 'claude-code' ? 'Claude Code' : 'Codex CLI'

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <div style={s.heading}>Sessions — {toolLabel}</div>
          <div style={s.sub}>{sessions.length} sessions loaded</div>
        </div>
        <button style={s.btn} onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {loading ? (
        <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
      ) : sessions.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 13 }}>No sessions found. Click Refresh to sync.</div>
      ) : sessions.map(sess => (
        <div key={sess.id} style={s.card}>
          <div style={s.row}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                <span style={s.mono}>{sess.working_dir || '—'}</span>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {fmtTime(sess.started_at)}
                {sess.duration_sec ? ` · ${fmtDuration(sess.duration_sec)}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' as const }}>
              <div style={{ fontSize: 13, color: '#a3a3a3' }}>
                {fmtTokens(sess.input_tokens + sess.output_tokens)} tokens
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{fmtCost(sess.cost_usd)}</div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            {sess.model && <span style={s.badge}>{sess.model}</span>}
            <span style={s.badge}>in: {fmtTokens(sess.input_tokens)}</span>
            <span style={s.badge}>out: {fmtTokens(sess.output_tokens)}</span>
          </div>
          <div style={s.actions}>
            {onNavigate && (
              <button style={s.btnSm} onClick={() => handleResume(sess)}>
                {sess.tool === 'claude-code' ? '在 Runner 中恢复' : '在 Runner 启动'}
              </button>
            )}
            <button
              style={s.btnSm}
              onClick={() => { if (sess.working_dir) window.open(`file://${sess.working_dir}`) }}
            >
              打开目录
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 创建 forge/src/modules/claude-code/pages/Projects.tsx**

```tsx
// forge/src/modules/claude-code/pages/Projects.tsx
import { useEffect, useState } from 'react'
import { api, ProjectRow } from '../../../lib/tauri'
import { launchStore } from '../../../lib/launchStore'

const s = {
  container: { padding: 24, color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif', height: '100%', overflow: 'auto' as const },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  heading: { fontSize: 20, fontWeight: 700 },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  btn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnSm: { padding: '4px 10px', background: '#1f2937', color: '#9ca3af', border: '1px solid #374151', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  card: { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: '14px 16px', marginBottom: 10 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#a3a3a3' },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: '#1f2937', color: '#9ca3af', fontSize: 11, border: '1px solid #374151', marginRight: 6 },
  actions: { display: 'flex', gap: 6, marginTop: 10 },
  pin: (pinned: boolean) => ({
    fontSize: 14,
    color: pinned ? '#f59e0b' : '#4b5563',
    cursor: 'pointer' as const,
    border: 'none',
    background: 'transparent',
    padding: '0 4px',
  }),
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return `${n}`
}

function fmtDate(ts: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const today = new Date()
  const diff = Math.floor((today.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return `${diff}天前`
}

interface ProjectsProps {
  tool?: string
  onNavigate?: (id: string) => void
}

export default function Projects({ tool = 'claude-code', onNavigate }: ProjectsProps) {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.usage.getProjects(tool)
      setProjects(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handlePin = async (proj: ProjectRow) => {
    if (proj.pinned) {
      await api.usage.unpinProject(tool, proj.directory)
    } else {
      await api.usage.pinProject(tool, proj.directory)
    }
    await load()
  }

  const handleLaunch = (proj: ProjectRow) => {
    launchStore.set({ tool, workingDir: proj.directory })
    onNavigate?.('runner')
  }

  useEffect(() => { load() }, [tool])

  const toolLabel = tool === 'claude-code' ? 'Claude Code' : 'Codex CLI'

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <div style={s.heading}>Projects — {toolLabel}</div>
          <div style={s.sub}>{projects.length} projects</div>
        </div>
        <button style={s.btn} onClick={load} disabled={loading}>Refresh</button>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {loading ? (
        <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
      ) : projects.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 13 }}>No projects. Run a session first.</div>
      ) : projects.map(proj => (
        <div key={proj.id} style={s.card}>
          <div style={s.row}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <button style={s.pin(proj.pinned)} onClick={() => handlePin(proj)} title={proj.pinned ? '取消固定' : '固定'}>
                {proj.pinned ? '★' : '☆'}
              </button>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  <span style={s.mono}>{proj.directory}</span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  最后使用: {fmtDate(proj.last_used_at)} · {proj.session_count} 次会话
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' as const }}>
              <div style={{ fontSize: 13, color: '#a3a3a3' }}>{fmtTokens(proj.total_tokens)} tokens</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {proj.total_cost_usd > 0 ? `$${proj.total_cost_usd.toFixed(4)}` : '—'}
              </div>
            </div>
          </div>
          <div style={s.actions}>
            {onNavigate && (
              <button style={s.btnSm} onClick={() => handleLaunch(proj)}>在 Runner 启动</button>
            )}
            <button
              style={s.btnSm}
              onClick={() => { if (proj.directory) window.open(`file://${proj.directory}`) }}
            >
              打开目录
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: 创建 Codex 包装页**

`forge/src/modules/codex-cli/pages/Sessions.tsx`（新建目录 `modules/codex-cli/pages/`）：

```tsx
// forge/src/modules/codex-cli/pages/Sessions.tsx
import ClaudeCodeSessions from '../../claude-code/pages/Sessions'

interface Props { onNavigate?: (id: string) => void }
export default function CodexSessions({ onNavigate }: Props) {
  return <ClaudeCodeSessions tool="codex-cli" onNavigate={onNavigate} />
}
```

`forge/src/modules/codex-cli/pages/Projects.tsx`：

```tsx
// forge/src/modules/codex-cli/pages/Projects.tsx
import ClaudeCodeProjects from '../../claude-code/pages/Projects'

interface Props { onNavigate?: (id: string) => void }
export default function CodexProjects({ onNavigate }: Props) {
  return <ClaudeCodeProjects tool="codex-cli" onNavigate={onNavigate} />
}
```

- [ ] **Step 4: 验证 TS 类型检查**

```bash
cd forge && npx tsc --noEmit 2>&1 | head -20; cd ..
```

- [ ] **Step 5: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src/modules/claude-code/pages/Sessions.tsx forge/src/modules/claude-code/pages/Projects.tsx forge/src/modules/codex-cli/
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m6): Sessions + Projects pages for Claude Code + Codex"
```

---

## Task 10: Dashboard.tsx 全面重写

**Files:**
- Replace: `forge/src/modules/dashboard/pages/Dashboard.tsx`
- Install: recharts（`cd forge && npm add recharts`）

- [ ] **Step 1: 安装 recharts**

```bash
cd forge && npm add recharts && cd ..
```

- [ ] **Step 2: 重写 Dashboard.tsx**

完整替换 `forge/src/modules/dashboard/pages/Dashboard.tsx`：

```tsx
// forge/src/modules/dashboard/pages/Dashboard.tsx
import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { api, DashboardSummary, DailyUsage, RunningTool } from '../../../lib/tauri'

const s = {
  container: { padding: 24, color: '#e5e5e5', fontFamily: 'ui-sans-serif, system-ui, sans-serif', height: '100%', overflow: 'auto' as const },
  heading: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
  sectionHead: { fontSize: 13, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 10, marginTop: 24 },
  cardRow: { display: 'flex', gap: 12, marginBottom: 4 },
  card: { flex: 1, background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: '14px 16px' },
  cardLabel: { fontSize: 11, color: '#6b7280', marginBottom: 6 },
  cardVal: { fontSize: 22, fontWeight: 700, color: '#e5e5e5' },
  cardSub: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '6px 10px', color: '#6b7280', borderBottom: '1px solid #1f1f1f', fontWeight: 500 },
  td: { padding: '8px 10px', borderBottom: '1px solid #1a1a1a', color: '#a3a3a3', verticalAlign: 'middle' as const },
  dot: (c: string) => ({ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: c, marginRight: 6 }),
  refreshBtn: { padding: '6px 14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, marginBottom: 20 },
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

function fmtCost(usd: number): string {
  return usd > 0 ? `$${usd.toFixed(3)}` : '$0.000'
}

function fmtTs(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [daily, setDaily] = useState<DailyUsage[]>([])
  const [running, setRunning] = useState<RunningTool[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [sumData, dailyData, runData] = await Promise.all([
        api.usage.getDashboard(),
        api.usage.getDailyUsage(30),
        api.usage.getRunningTools(),
      ])
      setSummary(sumData)
      setDaily(dailyData)
      setRunning(runData)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setSyncing(true)
    try {
      await api.usage.sync()
      await load()
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    load()
    // Listen for tools:status event (5s polling from Rust)
    let unlisten: (() => void) | undefined
    listen<RunningTool[]>('tools:status', ({ payload }) => {
      setRunning(payload)
    }).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  // Chart data: map DailyUsage to recharts format
  const chartData = daily.map(d => ({
    date: d.date.slice(5), // "MM-DD"
    'Claude Code': Math.round(d.claude_tokens / 1000),
    'Codex CLI':   Math.round(d.codex_tokens / 1000),
  }))

  return (
    <div style={s.container}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={s.heading}>Dashboard</div>
        <button style={s.refreshBtn} onClick={handleRefresh} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Refresh'}
        </button>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {/* Today's totals */}
      <div style={s.sectionHead}>今日</div>
      {summary ? (
        <div style={s.cardRow}>
          <div style={s.card}>
            <div style={s.cardLabel}>总 Token</div>
            <div style={s.cardVal}>{fmtTokens(summary.today_input_tokens + summary.today_output_tokens)}</div>
            <div style={s.cardSub}>输入 {fmtTokens(summary.today_input_tokens)} · 输出 {fmtTokens(summary.today_output_tokens)}</div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>预估费用</div>
            <div style={s.cardVal}>{fmtCost(summary.today_cost_usd)}</div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>Claude Code</div>
            <div style={s.cardVal}>{fmtTokens(summary.claude_today_tokens)}</div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>Codex CLI</div>
            <div style={s.cardVal}>{fmtTokens(summary.codex_today_tokens)}</div>
          </div>
        </div>
      ) : loading ? (
        <div style={{ color: '#6b7280', fontSize: 13 }}>Loading...</div>
      ) : null}

      {/* 30-day chart */}
      <div style={s.sectionHead}>30 天 Token 用量（k）</div>
      <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: '16px 8px', marginBottom: 4 }}>
        {chartData.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 12, padding: '20px', textAlign: 'center' as const }}>暂无历史数据</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} width={36} />
              <Tooltip
                contentStyle={{ background: '#141414', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#e5e5e5' }}
                itemStyle={{ color: '#a3a3a3' }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#6b7280' }} />
              <Bar dataKey="Claude Code" stackId="a" fill="#3b82f6" radius={[0,0,0,0]} />
              <Bar dataKey="Codex CLI"   stackId="a" fill="#10b981" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Running tools */}
      <div style={s.sectionHead}>工具运行状态</div>
      <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, padding: '12px 16px', marginBottom: 4 }}>
        {(['claude-code', 'codex-cli'] as const).map(toolId => {
          const procs = running.filter(r => r.tool === toolId)
          const isRunning = procs.length > 0
          return (
            <div key={toolId} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
              <span style={s.dot(isRunning ? '#22c55e' : '#4b5563')} />
              <span style={{ fontSize: 13, color: '#e5e5e5', width: 120 }}>
                {toolId === 'claude-code' ? 'Claude Code' : 'Codex CLI'}
              </span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {isRunning
                  ? procs.map(p => `PID ${p.pid}${p.working_dir ? `  ${p.working_dir}` : ''}`).join(' | ')
                  : '空闲'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Recent sessions */}
      <div style={s.sectionHead}>最近会话（全部工具）</div>
      <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, overflow: 'hidden' as const }}>
        {summary && summary.recent_sessions.length > 0 ? (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>工具</th>
                <th style={s.th}>目录</th>
                <th style={s.th}>时间</th>
                <th style={s.th}>Token</th>
                <th style={s.th}>费用</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent_sessions.map(sess => (
                <tr key={sess.id}>
                  <td style={s.td}>
                    <span style={{ ...s.dot(sess.tool === 'claude-code' ? '#3b82f6' : '#10b981') }} />
                    {sess.tool === 'claude-code' ? 'Claude Code' : 'Codex CLI'}
                  </td>
                  <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>
                    {sess.working_dir?.replace(/.*\//, '~/.../')?.slice(0, 40) || '—'}
                  </td>
                  <td style={s.td}>{fmtTs(sess.started_at)}</td>
                  <td style={s.td}>{fmtTokens(sess.input_tokens + sess.output_tokens)}</td>
                  <td style={s.td}>{fmtCost(sess.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ color: '#6b7280', fontSize: 12, padding: 16 }}>暂无会话</div>
        )}
      </div>

      {/* Original env detection table (kept at bottom) */}
      <div style={s.sectionHead}>环境检测</div>
      <EnvTable />
    </div>
  )
}

// Keep existing env detection inline
function EnvTable() {
  const [tools, setTools] = useState<{ name: string; installed: boolean; path: string | null; version: string | null }[]>([])
  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke<typeof tools>('detect_tools').then(setTools).catch(() => {})
    )
  }, [])
  return (
    <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: 8, overflow: 'hidden' as const }}>
      <table style={s.table}>
        <tbody>
          {tools.map(t => (
            <tr key={t.name} style={{ borderBottom: '1px solid #1a1a1a' }}>
              <td style={{ ...s.td, display: 'flex', alignItems: 'center' }}>
                <span style={s.dot(t.installed ? '#22c55e' : '#6b7280')} />
                {t.name}
              </td>
              <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>{t.path ?? 'not installed'}</td>
              <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 11 }}>{t.version ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: 验证 TS 类型检查**

```bash
cd forge && npx tsc --noEmit 2>&1 | head -20; cd ..
```

- [ ] **Step 4: Commit**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add forge/src/modules/dashboard/pages/Dashboard.tsx forge/package.json forge/package-lock.json
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m6): rewrite Dashboard with today totals + recharts + running tools + recent sessions"
```

---

## Task 11: Navigation + App.tsx 接线

**Files:**
- Modify: `forge/src/shell/Navigation.tsx` — 新增 cc_sessions, cc_projects, codex_sessions, codex_projects 条目
- Modify: `forge/src/App.tsx` — 新增 PageId 枚举值 + import + switch cases；onNavigate 传递

- [ ] **Step 1: 更新 Navigation.tsx**

在 `NAV_ITEMS` 数组中，在 `cc_skills` 条目前插入：

```typescript
{ id: "cc_sessions", label: "Sessions" },
{ id: "cc_projects", label: "Projects" },
```

在 `_group_claude_code` 组之后（原有 skills/agents/... 保留），并追加 Codex CLI 组：

```typescript
{ id: "_group_codex_cli", label: "Codex CLI", isGroupHeader: true },
{ id: "codex_sessions", label: "Sessions" },
{ id: "codex_projects", label: "Projects" },
```

完整更新后的 `NAV_ITEMS`：

```typescript
const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "runner", label: "CLI Runner" },
  { id: "_group_model_switcher", label: "Model Switcher", isGroupHeader: true },
  { id: "providers", label: "Providers" },
  { id: "presets", label: "Presets" },
  { id: "_group_claude_code", label: "Claude Code", isGroupHeader: true },
  { id: "cc_sessions", label: "Sessions" },
  { id: "cc_projects", label: "Projects" },
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
  { id: "_group_codex_cli", label: "Codex CLI", isGroupHeader: true },
  { id: "codex_sessions", label: "Sessions" },
  { id: "codex_projects", label: "Projects" },
]
```

- [ ] **Step 2: 更新 App.tsx**

添加 import：

```typescript
import Sessions from './modules/claude-code/pages/Sessions'
import Projects from './modules/claude-code/pages/Projects'
import CodexSessions from './modules/codex-cli/pages/Sessions'
import CodexProjects from './modules/codex-cli/pages/Projects'
```

扩展 `PageId` 联合类型，添加：

```typescript
| "cc_sessions"
| "cc_projects"
| "codex_sessions"
| "codex_projects"
```

在 `renderPage` 函数的 switch 中追加 cases（注意：Sessions/Projects 需要 `onNavigate` prop，因此 renderPage 需接受 `setPage` 参数）：

将 `renderPage` 函数改为：

```tsx
function renderPage(id: PageId, navigate: (id: string) => void) {
  switch (id) {
    case "dashboard": return <Dashboard />
    case "runner":    return <Runner />
    case "providers": return <Providers />
    case "presets":   return <Presets />
    case "cc_sessions":  return <Sessions tool="claude-code" onNavigate={navigate} />
    case "cc_projects":  return <Projects tool="claude-code" onNavigate={navigate} />
    case "codex_sessions": return <CodexSessions onNavigate={navigate} />
    case "codex_projects": return <CodexProjects onNavigate={navigate} />
    case "cc_skills":    return <Skills />
    case "cc_agents":    return <Agents />
    case "cc_hooks":     return <Hooks />
    case "cc_mcp":       return <MCP />
    case "cc_commands":  return <Commands />
    case "cc_claudemd":  return <ClaudeMd />
    case "cc_graph":     return <Graph />
    case "cc_git":       return <Git />
    case "cc_worktrees": return <Worktrees />
    case "cc_environment": return <Environment />
    default:             return <Dashboard />
  }
}
```

在 `App` 组件中，将 `renderPage(page)` 改为 `renderPage(page, setPage)`。

同时，在 Runner 页需消费 launchStore —— 在 `forge/src/modules/runner/pages/Runner.tsx` 的 `useEffect` 中添加：

```typescript
// 消费 launch-request（Sessions/Projects 页触发）
import { launchStore } from '../../../lib/launchStore'

useEffect(() => {
  const req = launchStore.consume()
  if (req) {
    // Auto-create a PTY with the requested params
    api.runner.create(req.tool, req.workingDir, req.extraArgs)
      .then(sessionId => { /* add tab */ })
      .catch(console.error)
  }
}, [])

// Subscribe to future requests
useEffect(() => {
  return launchStore.subscribe(req => {
    if (!req) return
    const consumed = launchStore.consume()
    if (consumed) {
      api.runner.create(consumed.tool, consumed.workingDir, consumed.extraArgs)
        .then(sessionId => { /* add tab */ })
        .catch(console.error)
    }
  })
}, [])
```

注意：`api.runner.create` 签名已在 Task 8 更新以接受 `extraArgs`；同时在 `tauri.ts` 中 runner 部分补充：

```typescript
runner: {
  create:  (tool: string, workingDir: string, extraArgs?: string[]) =>
    inv<string>('pty_create', { tool, workingDir, extraArgs }),
  // ... existing write/resize/kill/list/replay
}
```

- [ ] **Step 3: 验证 TS 类型检查**

```bash
cd forge && npx tsc --noEmit 2>&1 | head -30; cd ..
```

- [ ] **Step 4: 完整 Rust 编译**

```bash
cargo build --manifest-path forge/src-tauri/Cargo.toml 2>&1 | grep "^error" | head -10
```

- [ ] **Step 5: 验收提交**

```bash
git -C /Users/wuhoujin/Documents/projects/superchat add \
  forge/src/shell/Navigation.tsx \
  forge/src/App.tsx \
  forge/src/modules/runner/pages/Runner.tsx
git -C /Users/wuhoujin/Documents/projects/superchat commit -m "feat(m6): wire Sessions/Projects pages into navigation + launch-request flow"
```

---

## 自审（Self-Review）

### 正确性检查

| 检查点 | 结论 |
|---|---|
| JSONL 解析与实测格式匹配 | `type=="assistant"` + `message.usage.input_tokens/output_tokens` + `cwd` + `timestamp` — 全部在 T3 fixture 中验证 |
| 容错解析（bad JSON 跳过） | T3 `tolerates_bad_json_lines` 测试覆盖 |
| Upsert 幂等（重复 sync 不重复计数） | T2 `upsert_updates_existing` 测试覆盖 |
| 定价表包含实测 model `claude-fable-5` | 已在 PRICING 表中添加按 sonnet 级别估算 |
| PTY exit 回调 DB 写入安全 | 使用独立 `db::open` 避免锁竞争（不复用 AppState 的 Mutex<Connection>） |
| sysinfo crate 版本 | `0.33` — 2025 年稳定版，与 `ProcessesToUpdate::All` API 匹配 |
| recharts 类型声明 | recharts 4.x 自带 TypeScript 类型，无需 @types |
| `extra_args` Option<Vec<String>> 向后兼容 | None 时行为与原 pty_create 完全一致 |

### 遗漏/风险点

| 风险 | 缓解措施 |
|---|---|
| `sessions` 表的 `tool` 字段：`upsert_session` 硬编码 `'claude-code'`（T2 测试中手动插入用 params 传入 tool） | T4 PTY tracking 路径正确传 tool；parse_session_file 默认 claude-code；Codex 走 PTY 路径 |
| `Runner.tsx` 中 launchStore 消费逻辑需对接实际标签管理 | T11 仅提供 integration 骨架，具体标签 API 取决于 Runner.tsx 现有实现，需适配 |
| `days_since_epoch` 手写实现 | 已有完整日历公式；T3 `parse_timestamps` 测试验证 |
| Dashboard 在 DB 空时优雅降级 | `DashboardSummary` 所有聚合字段默认 0，前端处理 null summary |
| `pnpm` vs `npm` | 项目可能使用 pnpm；将 `npm add recharts` 改为 `pnpm add recharts` 如有 pnpm.lock |

### 任务间依赖顺序

```
T1(骨架) → T2(db层) → T3(parser) → T4(sync+PTY) → T5(query) → T6(status) → T7(注册)
                                                                              ↓
T8(launchStore+extra_args) → T9(Sessions/Projects页) → T10(Dashboard) → T11(接线)
```

T2 和 T3 可并行（互相不依赖）；T9、T10 可并行（均依赖 T7）。

---
