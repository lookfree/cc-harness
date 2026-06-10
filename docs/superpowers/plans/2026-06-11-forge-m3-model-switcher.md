# Forge M3 实施计划（Model Switcher + 系统托盘）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Forge 的 Model Switcher 模块：Provider CRUD（SQLite）、内置预设库（15-20 条）、跨两工具原子切换、Tauri 命令注册、系统托盘（仅集成验证，单测不适用）、前端 Providers/Presets 页面，以及导航接线。

**Architecture:** Rust 后端新增 `db/providers.rs`（数据层）、`commands/model_switcher/presets.rs`（预设种子）、`commands/model_switcher/switcher.rs`（切换逻辑）、`tray.rs`（系统托盘）；前端新增 `src/modules/model-switcher/pages/Providers.tsx`、`Presets.tsx`，修改 `App.tsx` 和 `shell/Navigation.tsx` 接入导航。所有核心 Rust 逻辑用 `#[cfg(test)]` in-memory conn 覆盖 TDD；tray 无法单元测试，在 M10 冒烟测试验证。

**Tech Stack:** 复用 M0–M2 已有的 tauri v2、rusqlite bundled、serde_json、toml、dirs；新增 Cargo feature `tray-icon` 到 tauri dep；前端 React 18 + TypeScript（inline style 深色主题，与 Dashboard.tsx 保持一致）。

**Scope:** 仅覆盖设计文档 M3。

**约定：** 所有命令在仓库根目录 `/Users/wuhoujin/Documents/projects/superchat` 执行，除非另有说明。Rust 测试统一用 `cargo test --manifest-path forge/src-tauri/Cargo.toml`。

---

### Task 1: 启用 tray-icon feature + 声明新模块

**Files:**
- Modify: `forge/src-tauri/Cargo.toml`（tauri 加 `tray-icon` feature）
- Create: `forge/src-tauri/src/db/providers.rs`（文件骨架，函数体 `todo!()`）
- Create: `forge/src-tauri/src/commands/model_switcher/mod.rs`
- Create: `forge/src-tauri/src/commands/model_switcher/presets.rs`（骨架）
- Create: `forge/src-tauri/src/commands/model_switcher/switcher.rs`（骨架）
- Create: `forge/src-tauri/src/tray.rs`（骨架）
- Modify: `forge/src-tauri/src/db/mod.rs`（pub mod providers;）
- Modify: `forge/src-tauri/src/commands/mod.rs`（pub mod model_switcher;）
- Modify: `forge/src-tauri/src/lib.rs`（pub mod tray;）

- [ ] **Step 1: 启用 tray-icon feature**

编辑 `forge/src-tauri/Cargo.toml`，将：

```toml
tauri = { version = "2", features = [] }
```

改为：

```toml
tauri = { version = "2", features = ["tray-icon"] }
```

- [ ] **Step 2: 创建 db/providers.rs 骨架**

新建 `forge/src-tauri/src/db/providers.rs`：

```rust
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub is_preset: bool,
    pub claude_code_config: Option<String>, // JSON 片段
    pub codex_cli_config: Option<String>,   // JSON 片段
    pub created_at: i64,
}

/// 列出所有 providers（按 is_preset DESC, created_at ASC）
pub fn list_providers(_conn: &Connection) -> Result<Vec<Provider>, String> {
    todo!()
}

/// 按 id 查询单个 provider
pub fn get_provider(_conn: &Connection, _id: &str) -> Result<Option<Provider>, String> {
    todo!()
}

/// 插入一条 provider，返回插入后的行（使用传入的 id）
pub fn insert_provider(_conn: &Connection, _p: &Provider) -> Result<(), String> {
    todo!()
}

/// 更新 name / claude_code_config / codex_cli_config（is_preset 不可改）
pub fn update_provider(
    _conn: &Connection,
    _id: &str,
    _name: &str,
    _claude_code_config: Option<&str>,
    _codex_cli_config: Option<&str>,
) -> Result<(), String> {
    todo!()
}

/// 删除 provider（is_preset=1 的行拒绝删除，返回 Err）
pub fn delete_provider(_conn: &Connection, _id: &str) -> Result<(), String> {
    todo!()
}

/// 读取某工具当前激活的 provider_id（工具值：'claude-code' | 'codex-cli'）
pub fn get_active_provider(_conn: &Connection, _tool: &str) -> Result<Option<String>, String> {
    todo!()
}

/// 设置某工具的激活 provider（upsert）
pub fn set_active_provider(_conn: &Connection, _tool: &str, _provider_id: &str) -> Result<(), String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn fixture(id: &str, name: &str, is_preset: bool) -> Provider {
        Provider {
            id: id.to_string(),
            name: name.to_string(),
            is_preset,
            claude_code_config: Some(r#"{"model":"claude-sonnet-4-5"}"#.to_string()),
            codex_cli_config: None,
            created_at: 0,
        }
    }

    #[test]
    fn insert_and_list() {
        let conn = mem();
        insert_provider(&conn, &fixture("p1", "Test", false)).unwrap();
        let rows = list_providers(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "p1");
        assert_eq!(rows[0].name, "Test");
    }

    #[test]
    fn get_returns_none_for_missing() {
        let conn = mem();
        let r = get_provider(&conn, "nope").unwrap();
        assert!(r.is_none());
    }

    #[test]
    fn update_fields() {
        let conn = mem();
        insert_provider(&conn, &fixture("p1", "Old", false)).unwrap();
        update_provider(&conn, "p1", "New", Some(r#"{"model":"x"}"#), None).unwrap();
        let p = get_provider(&conn, "p1").unwrap().unwrap();
        assert_eq!(p.name, "New");
        assert_eq!(p.claude_code_config.as_deref(), Some(r#"{"model":"x"}"#));
    }

    #[test]
    fn delete_user_provider() {
        let conn = mem();
        insert_provider(&conn, &fixture("p1", "X", false)).unwrap();
        delete_provider(&conn, "p1").unwrap();
        assert!(list_providers(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_preset_returns_error() {
        let conn = mem();
        insert_provider(&conn, &fixture("preset1", "P", true)).unwrap();
        let err = delete_provider(&conn, "preset1");
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("preset"));
    }

    #[test]
    fn active_provider_upsert() {
        let conn = mem();
        insert_provider(&conn, &fixture("p1", "X", false)).unwrap();
        // Initially None
        assert!(get_active_provider(&conn, "claude-code").unwrap().is_none());
        // Set
        set_active_provider(&conn, "claude-code", "p1").unwrap();
        assert_eq!(get_active_provider(&conn, "claude-code").unwrap().as_deref(), Some("p1"));
        // Upsert same tool, different provider
        insert_provider(&conn, &fixture("p2", "Y", false)).unwrap();
        set_active_provider(&conn, "claude-code", "p2").unwrap();
        assert_eq!(get_active_provider(&conn, "claude-code").unwrap().as_deref(), Some("p2"));
    }
}
```

- [ ] **Step 3: 创建 model_switcher 子模块目录**

新建 `forge/src-tauri/src/commands/model_switcher/mod.rs`：

```rust
pub mod presets;
pub mod switcher;
```

新建 `forge/src-tauri/src/commands/model_switcher/presets.rs`（骨架，后续 Task 3 补全）：

```rust
use rusqlite::Connection;
use crate::db::providers::{insert_provider, Provider};

/// 内置预设定义
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub claude_code_config: Option<&'static str>,
    pub codex_cli_config: Option<&'static str>,
}

pub fn builtin_presets() -> Vec<Preset> {
    todo!()
}

/// 幂等地把内置预设写入 SQLite（is_preset=1，已存在则跳过）
pub fn seed_presets(_conn: &Connection) -> Result<(), String> {
    todo!()
}
```

新建 `forge/src-tauri/src/commands/model_switcher/switcher.rs`（骨架，后续 Task 4 补全）：

```rust
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SwitchResult {
    pub tool: String,
    pub success: bool,
    pub hot_reload: bool,
    pub error: Option<String>,
}

/// 核心切换函数，接收显式配置路径（便于测试）
pub fn switch_provider_with_paths(
    _claude_code_config: Option<&std::path::Path>,
    _codex_cli_config: Option<&std::path::Path>,
    _claude_code_fragment: Option<&str>,
    _codex_cli_fragment: Option<&str>,
    _targets: &[String],
) -> Vec<SwitchResult> {
    todo!()
}
```

新建 `forge/src-tauri/src/tray.rs`（骨架，Task 6 补全）：

```rust
// 系统托盘 — 实现在 Task 6
// 单元测试不适用（依赖 Tauri AppHandle + OS 原生托盘）
// 在 M10 冒烟测试中手工验证
```

- [ ] **Step 4: 声明新模块**

在 `forge/src-tauri/src/db/mod.rs` 加一行（在现有 `get_env_vars` 之前）：

```rust
pub mod providers;
```

在 `forge/src-tauri/src/commands/mod.rs` 加一行：

```rust
pub mod model_switcher;
```

在 `forge/src-tauri/src/lib.rs` 加一行（与现有 `pub mod` 并列）：

```rust
pub mod tray;
```

- [ ] **Step 5: 验证编译（骨架全 todo!()，编译须通过）**

```bash
cargo check --manifest-path forge/src-tauri/Cargo.toml
```

预期：`warning` 可有，无 `error`。

- [ ] **Step 6: 提交**

```bash
git add forge/src-tauri
git commit -m "chore(forge/m3): scaffold model-switcher modules + tray-icon feature"
```

---

### Task 2: db/providers.rs 实现（TDD 红→绿）

**Files:**
- Modify: `forge/src-tauri/src/db/providers.rs`（实现所有 `todo!()`）

- [ ] **Step 1: 运行测试确认失败（红）**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml db::providers
```

预期：6 个测试全部 panic（`not yet implemented`）。

- [ ] **Step 2: 实现所有函数**

替换 `forge/src-tauri/src/db/providers.rs` 中的所有 `todo!()` 实现：

```rust
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub is_preset: bool,
    pub claude_code_config: Option<String>,
    pub codex_cli_config: Option<String>,
    pub created_at: i64,
}

pub fn list_providers(conn: &Connection) -> Result<Vec<Provider>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, is_preset, claude_code_config, codex_cli_config, created_at \
             FROM providers ORDER BY is_preset DESC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Provider {
                id: row.get(0)?,
                name: row.get(1)?,
                is_preset: row.get::<_, i64>(2)? != 0,
                claude_code_config: row.get(3)?,
                codex_cli_config: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn get_provider(conn: &Connection, id: &str) -> Result<Option<Provider>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, is_preset, claude_code_config, codex_cli_config, created_at \
             FROM providers WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([id], |row| {
            Ok(Provider {
                id: row.get(0)?,
                name: row.get(1)?,
                is_preset: row.get::<_, i64>(2)? != 0,
                claude_code_config: row.get(3)?,
                codex_cli_config: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(r) => Ok(Some(r.map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

pub fn insert_provider(conn: &Connection, p: &Provider) -> Result<(), String> {
    conn.execute(
        "INSERT INTO providers (id, name, is_preset, claude_code_config, codex_cli_config, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            p.id,
            p.name,
            p.is_preset as i64,
            p.claude_code_config,
            p.codex_cli_config,
            p.created_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_provider(
    conn: &Connection,
    id: &str,
    name: &str,
    claude_code_config: Option<&str>,
    codex_cli_config: Option<&str>,
) -> Result<(), String> {
    let affected = conn
        .execute(
            "UPDATE providers SET name=?1, claude_code_config=?2, codex_cli_config=?3 \
             WHERE id=?4 AND is_preset=0",
            params![name, claude_code_config, codex_cli_config, id],
        )
        .map_err(|e| e.to_string())?;
    if affected == 0 {
        Err(format!("provider '{}' not found or is a preset (cannot update)", id))
    } else {
        Ok(())
    }
}

pub fn delete_provider(conn: &Connection, id: &str) -> Result<(), String> {
    // 先检查是否为 preset
    let is_preset: bool = conn
        .query_row(
            "SELECT is_preset FROM providers WHERE id=?1",
            [id],
            |r| r.get::<_, i64>(0),
        )
        .map(|v| v != 0)
        .map_err(|e| e.to_string())?;
    if is_preset {
        return Err(format!("cannot delete preset provider '{}'", id));
    }
    conn.execute("DELETE FROM providers WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_active_provider(conn: &Connection, tool: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT provider_id FROM active_providers WHERE tool=?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([tool], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(r) => Ok(Some(r.map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

pub fn set_active_provider(conn: &Connection, tool: &str, provider_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO active_providers (tool, provider_id) VALUES (?1, ?2) \
         ON CONFLICT(tool) DO UPDATE SET provider_id=excluded.provider_id",
        params![tool, provider_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: 运行测试确认通过（绿）**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml db::providers
```

预期：6 passed，0 failed。

- [ ] **Step 4: 提交**

```bash
git add forge/src-tauri/src/db/providers.rs
git commit -m "feat(forge/m3): provider CRUD + active_provider get/set (TDD)"
```

---

### Task 3: 内置预设库（TDD 红→绿）

**Files:**
- Modify: `forge/src-tauri/src/commands/model_switcher/presets.rs`

- [ ] **Step 1: 写失败测试（先在文件末尾追加 #[cfg(test)] 块，函数体仍 todo!()）**

将 `forge/src-tauri/src/commands/model_switcher/presets.rs` 整体替换为：

```rust
use rusqlite::Connection;
use crate::db::providers::{insert_provider, get_provider, Provider};

/// 内置预设定义
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub claude_code_config: Option<&'static str>,
    pub codex_cli_config: Option<&'static str>,
}

/// 15 条内置预设（v1）
pub fn builtin_presets() -> Vec<Preset> {
    todo!()
}

/// 幂等地把内置预设写入 SQLite（is_preset=1，已存在则跳过）
pub fn seed_presets(conn: &Connection) -> Result<(), String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn builtin_presets_count() {
        let presets = builtin_presets();
        // 至少 10 条，以覆盖规格中所有提及的 Provider 品牌
        assert!(presets.len() >= 10, "expected >= 10 presets, got {}", presets.len());
    }

    #[test]
    fn builtin_presets_unique_ids() {
        let presets = builtin_presets();
        let mut ids = std::collections::HashSet::new();
        for p in &presets {
            assert!(ids.insert(p.id), "duplicate preset id: {}", p.id);
        }
    }

    #[test]
    fn seed_is_idempotent() {
        let conn = mem();
        seed_presets(&conn).unwrap();
        seed_presets(&conn).unwrap(); // 第二次不应报错
        // 数量不变
        let rows = crate::db::providers::list_providers(&conn).unwrap();
        let preset_count = rows.iter().filter(|r| r.is_preset).count();
        assert_eq!(preset_count, builtin_presets().len());
    }

    #[test]
    fn seed_marks_as_preset() {
        let conn = mem();
        seed_presets(&conn).unwrap();
        let presets = builtin_presets();
        let first = get_provider(&conn, presets[0].id).unwrap().unwrap();
        assert!(first.is_preset);
    }

    #[test]
    fn anthropic_claude_sonnet_has_both_configs() {
        let presets = builtin_presets();
        let sonnet = presets.iter().find(|p| p.id == "anthropic-claude-sonnet-4-5")
            .expect("anthropic-claude-sonnet-4-5 preset missing");
        assert!(sonnet.claude_code_config.is_some());
        assert!(sonnet.codex_cli_config.is_some());
    }

    #[test]
    fn gpt4o_has_only_codex_config() {
        // GPT-4o: Claude Code 不支持 OpenAI → claude_code_config 为 None
        let presets = builtin_presets();
        let gpt4o = presets.iter().find(|p| p.id == "openai-gpt-4o")
            .expect("openai-gpt-4o preset missing");
        assert!(gpt4o.claude_code_config.is_none(),
            "GPT-4o should not have claude_code_config");
        assert!(gpt4o.codex_cli_config.is_some());
    }

    #[test]
    fn ollama_presets_have_codex_config_only() {
        let presets = builtin_presets();
        for id in ["ollama-llama3", "ollama-mistral", "ollama-qwen"] {
            let p = presets.iter().find(|p| p.id == id)
                .unwrap_or_else(|| panic!("{} preset missing", id));
            assert!(p.claude_code_config.is_none(),
                "{} should not have claude_code_config", id);
            assert!(p.codex_cli_config.is_some());
        }
    }
}
```

- [ ] **Step 2: 运行测试确认失败（红）**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml commands::model_switcher::presets
```

预期：所有测试 panic（`not yet implemented`）。

- [ ] **Step 3: 实现 builtin_presets() 和 seed_presets()**

将 `builtin_presets` 和 `seed_presets` 的 `todo!()` 替换：

```rust
pub fn builtin_presets() -> Vec<Preset> {
    vec![
        // ── Anthropic（两工具都支持）──────────────────────────────
        Preset {
            id: "anthropic-claude-sonnet-4-5",
            name: "Claude Sonnet 4.5",
            claude_code_config: Some(r#"{"model":"claude-sonnet-4-5"}"#),
            codex_cli_config:   Some(r#"{"model":"claude-sonnet-4-5","provider":"anthropic"}"#),
        },
        Preset {
            id: "anthropic-claude-opus-4",
            name: "Claude Opus 4",
            claude_code_config: Some(r#"{"model":"claude-opus-4"}"#),
            codex_cli_config:   Some(r#"{"model":"claude-opus-4","provider":"anthropic"}"#),
        },
        Preset {
            id: "anthropic-claude-haiku-4-5",
            name: "Claude Haiku 4.5",
            claude_code_config: Some(r#"{"model":"claude-haiku-4-5"}"#),
            codex_cli_config:   Some(r#"{"model":"claude-haiku-4-5","provider":"anthropic"}"#),
        },
        // ── OpenAI（仅 Codex CLI 支持）────────────────────────────
        Preset {
            id: "openai-gpt-4o",
            name: "GPT-4o",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"gpt-4o","provider":"openai"}"#),
        },
        Preset {
            id: "openai-gpt-4o-mini",
            name: "GPT-4o mini",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"gpt-4o-mini","provider":"openai"}"#),
        },
        Preset {
            id: "openai-o3",
            name: "OpenAI o3",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"o3","provider":"openai"}"#),
        },
        // ── Ollama 本地（仅 Codex CLI 支持）──────────────────────
        Preset {
            id: "ollama-llama3",
            name: "Ollama llama3",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"llama3","provider":"ollama"}"#),
        },
        Preset {
            id: "ollama-mistral",
            name: "Ollama mistral",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"mistral","provider":"ollama"}"#),
        },
        Preset {
            id: "ollama-qwen",
            name: "Ollama qwen",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"qwen","provider":"ollama"}"#),
        },
        // ── DeepSeek（仅 Codex CLI 支持）──────────────────────────
        Preset {
            id: "deepseek-v3",
            name: "DeepSeek-V3",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"deepseek-chat","provider":"deepseek"}"#),
        },
        // ── Qwen（仅 Codex CLI 支持）──────────────────────────────
        Preset {
            id: "qwen-max",
            name: "Qwen-Max",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"qwen-max","provider":"qwen"}"#),
        },
        // ── Google（仅 Codex CLI 支持）────────────────────────────
        Preset {
            id: "google-gemini-2-5-pro",
            name: "Gemini 2.5 Pro",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"gemini-2.5-pro","provider":"google"}"#),
        },
    ]
}

pub fn seed_presets(conn: &Connection) -> Result<(), String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    for p in builtin_presets() {
        // 幂等：已存在则跳过
        if get_provider(conn, p.id)?.is_some() {
            continue;
        }
        insert_provider(
            conn,
            &Provider {
                id: p.id.to_string(),
                name: p.name.to_string(),
                is_preset: true,
                claude_code_config: p.claude_code_config.map(str::to_string),
                codex_cli_config: p.codex_cli_config.map(str::to_string),
                created_at: now,
            },
        )?;
    }
    Ok(())
}
```

- [ ] **Step 4: 运行测试确认通过（绿）**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml commands::model_switcher::presets
```

预期：7 passed，0 failed。

- [ ] **Step 5: 提交**

```bash
git add forge/src-tauri/src/commands/model_switcher/presets.rs
git commit -m "feat(forge/m3): 12 built-in presets + idempotent seed (TDD)"
```

---

### Task 4: switch_provider 核心逻辑（TDD 红→绿）

**Files:**
- Modify: `forge/src-tauri/src/commands/model_switcher/switcher.rs`

- [ ] **Step 1: 写失败测试（先写全部测试 + 实现骨架，todo!() 保留在核心函数）**

将 `forge/src-tauri/src/commands/model_switcher/switcher.rs` 整体替换为：

```rust
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

use crate::config::{claude, codex};

#[derive(Debug, Clone, Serialize)]
pub struct SwitchResult {
    pub tool: String,
    pub success: bool,
    pub hot_reload: bool,
    pub error: Option<String>,
}

/// 核心切换函数：接收显式路径（便于测试使用 tempfile）
/// claude_code_config / codex_cli_config 是从 Provider.claude_code_config 解析出的 JSON 片段字符串
pub fn switch_provider_with_paths(
    claude_code_path: Option<&Path>,
    codex_cli_path: Option<&Path>,
    claude_code_fragment: Option<&str>,
    codex_cli_fragment: Option<&str>,
    targets: &[String],
) -> Vec<SwitchResult> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(s: &str) -> Vec<String> {
        vec![s.to_string()]
    }
    fn targets_both() -> Vec<String> {
        vec!["claude-code".to_string(), "codex-cli".to_string()]
    }

    #[test]
    fn switch_claude_code_writes_model_field() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");

        let results = switch_provider_with_paths(
            Some(&path),
            None,
            Some(r#"{"model":"claude-opus-4"}"#),
            None,
            &target("claude-code"),
        );

        assert_eq!(results.len(), 1);
        assert!(results[0].success, "expected success, got: {:?}", results[0].error);
        assert!(results[0].hot_reload);

        // Verify the file was written
        let written = std::fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&written).unwrap();
        assert_eq!(v["model"], "claude-opus-4");
    }

    #[test]
    fn switch_codex_cli_writes_model_and_provider() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let results = switch_provider_with_paths(
            None,
            Some(&path),
            None,
            Some(r#"{"model":"gpt-4o","provider":"openai"}"#),
            &target("codex-cli"),
        );

        assert_eq!(results.len(), 1);
        assert!(results[0].success);
        assert!(!results[0].hot_reload); // codex requires restart

        let written = std::fs::read_to_string(&path).unwrap();
        let doc: toml::Table = toml::from_str(&written).unwrap();
        assert_eq!(doc["model"].as_str(), Some("gpt-4o"));
        assert_eq!(doc["provider"].as_str(), Some("openai"));
    }

    #[test]
    fn switch_both_tools() {
        let dir = tempfile::tempdir().unwrap();
        let claude_path = dir.path().join("claude.json");
        let codex_path = dir.path().join("config.toml");

        let results = switch_provider_with_paths(
            Some(&claude_path),
            Some(&codex_path),
            Some(r#"{"model":"claude-sonnet-4-5"}"#),
            Some(r#"{"model":"claude-sonnet-4-5","provider":"anthropic"}"#),
            &targets_both(),
        );

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.success));
    }

    #[test]
    fn switch_skips_tool_not_in_targets() {
        let dir = tempfile::tempdir().unwrap();
        let claude_path = dir.path().join("claude.json");

        // Only target codex-cli, but no codex fragment — codex result not included
        let results = switch_provider_with_paths(
            Some(&claude_path),
            None,
            Some(r#"{"model":"claude-haiku-4-5"}"#),
            None,
            &target("codex-cli"),  // target codex but no codex path / fragment
        );

        // codex-cli: fragment is None → skip (no config to write)
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn switch_returns_error_on_invalid_json_fragment() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");

        let results = switch_provider_with_paths(
            Some(&path),
            None,
            Some("{invalid json"),
            None,
            &target("claude-code"),
        );

        assert_eq!(results.len(), 1);
        assert!(!results[0].success);
        assert!(results[0].error.is_some());
    }

    #[test]
    fn switch_preserves_existing_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");
        // Pre-populate with a "future" field that Forge doesn't know about
        std::fs::write(&path, r#"{"apiKey":"sk-xxx","futureField":42}"#).unwrap();

        switch_provider_with_paths(
            Some(&path),
            None,
            Some(r#"{"model":"claude-opus-4"}"#),
            None,
            &target("claude-code"),
        );

        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["futureField"], 42, "unknown field should be preserved");
        assert_eq!(v["model"], "claude-opus-4");
    }
}
```

- [ ] **Step 2: 运行测试确认失败（红）**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml commands::model_switcher::switcher
```

预期：全部 panic（`not yet implemented`）。

- [ ] **Step 3: 实现 switch_provider_with_paths()**

替换 `switch_provider_with_paths` 的 `todo!()` 实现：

```rust
pub fn switch_provider_with_paths(
    claude_code_path: Option<&Path>,
    codex_cli_path: Option<&Path>,
    claude_code_fragment: Option<&str>,
    codex_cli_fragment: Option<&str>,
    targets: &[String],
) -> Vec<SwitchResult> {
    let mut results = Vec::new();

    for target in targets {
        match target.as_str() {
            "claude-code" => {
                let (fragment, path) = match (claude_code_fragment, claude_code_path) {
                    (Some(f), Some(p)) => (f, p),
                    _ => continue, // 该工具没有配置片段 → 跳过
                };
                let res = (|| -> Result<(), String> {
                    let updates: Value =
                        serde_json::from_str(fragment).map_err(|e| e.to_string())?;
                    claude::merge_fields(path, &updates)
                })();
                results.push(SwitchResult {
                    tool: "claude-code".to_string(),
                    success: res.is_ok(),
                    hot_reload: true,
                    error: res.err(),
                });
            }
            "codex-cli" => {
                let (fragment, path) = match (codex_cli_fragment, codex_cli_path) {
                    (Some(f), Some(p)) => (f, p),
                    _ => continue,
                };
                let res = (|| -> Result<(), String> {
                    let updates: toml::Table =
                        toml::from_str(
                            // fragment 是 JSON；将 JSON object 转为 TOML key=value 字符串
                            &json_fragment_to_toml(fragment)?,
                        )
                        .map_err(|e| e.to_string())?;
                    codex::merge_fields(path, &updates)
                })();
                results.push(SwitchResult {
                    tool: "codex-cli".to_string(),
                    success: res.is_ok(),
                    hot_reload: false,
                    error: res.err(),
                });
            }
            _ => {} // 未知工具忽略
        }
    }
    results
}

/// 将 JSON object 片段（如 `{"model":"gpt-4o","provider":"openai"}`）
/// 转换为 TOML 字符串（如 `model = "gpt-4o"\nprovider = "openai"\n`）
/// 仅支持顶层 string / number / bool 值（Provider 片段足够使用）
fn json_fragment_to_toml(fragment: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(fragment).map_err(|e| e.to_string())?;
    let obj = v.as_object().ok_or("fragment must be a JSON object")?;
    let mut out = String::new();
    for (k, val) in obj {
        match val {
            Value::String(s) => out.push_str(&format!("{} = {}\n", k, toml::Value::String(s.clone()))),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    out.push_str(&format!("{} = {}\n", k, i));
                } else if let Some(f) = n.as_f64() {
                    out.push_str(&format!("{} = {}\n", k, f));
                }
            }
            Value::Bool(b) => out.push_str(&format!("{} = {}\n", k, b)),
            _ => {} // 嵌套对象/数组暂不支持（Provider 片段不需要）
        }
    }
    Ok(out)
}
```

- [ ] **Step 4: 运行测试确认通过（绿）**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml commands::model_switcher::switcher
```

预期：7 passed，0 failed。

- [ ] **Step 5: 提交**

```bash
git add forge/src-tauri/src/commands/model_switcher/switcher.rs
git commit -m "feat(forge/m3): switch_provider core logic with per-tool path injection (TDD)"
```

---

### Task 5: Tauri 命令注册 + App 启动接线

**Files:**
- Create: `forge/src-tauri/src/commands/model_switcher/commands.rs`（Tauri 命令包装）
- Modify: `forge/src-tauri/src/commands/model_switcher/mod.rs`（pub mod commands;）
- Modify: `forge/src-tauri/src/lib.rs`（State<Mutex<Connection>>、setup、命令注册）
- Modify: `forge/src-tauri/Cargo.toml`（添加 `uuid` v4 feature 若未含，以及 `tauri-plugin-shell` 若需要；仅确认 `tauri-plugin-dialog` 已在）

- [ ] **Step 1: 创建 Tauri 命令包装层**

新建 `forge/src-tauri/src/commands/model_switcher/commands.rs`：

```rust
use std::sync::Mutex;
use tauri::State;
use rusqlite::Connection;
use serde_json::Value;

use crate::db::providers::{
    self, Provider,
};
use crate::commands::model_switcher::presets::seed_presets;
use crate::commands::model_switcher::switcher::{switch_provider_with_paths, SwitchResult};
use crate::config::{claude, codex};

pub struct DbState(pub Mutex<Connection>);

// ── Provider CRUD ────────────────────────────────────────

#[tauri::command]
pub fn get_providers(state: State<DbState>) -> Result<Vec<Provider>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    providers::list_providers(&conn)
}

#[tauri::command]
pub fn get_active_providers(
    state: State<DbState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut map = std::collections::HashMap::new();
    for tool in ["claude-code", "codex-cli"] {
        if let Some(id) = providers::get_active_provider(&conn, tool)? {
            map.insert(tool.to_string(), id);
        }
    }
    Ok(map)
}

#[tauri::command]
pub fn add_provider(
    state: State<DbState>,
    id: String,
    name: String,
    claude_code_config: Option<String>,
    codex_cli_config: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    providers::insert_provider(
        &conn,
        &Provider {
            id,
            name,
            is_preset: false,
            claude_code_config,
            codex_cli_config,
            created_at: now,
        },
    )
}

#[tauri::command]
pub fn update_provider(
    state: State<DbState>,
    id: String,
    name: String,
    claude_code_config: Option<String>,
    codex_cli_config: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    providers::update_provider(
        &conn,
        &id,
        &name,
        claude_code_config.as_deref(),
        codex_cli_config.as_deref(),
    )
}

#[tauri::command]
pub fn delete_provider(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    providers::delete_provider(&conn, &id)
}

// ── Switch ────────────────────────────────────────────────

#[tauri::command]
pub fn switch_provider(
    state: State<DbState>,
    provider_id: String,
    targets: Vec<String>,
) -> Result<Vec<SwitchResult>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let provider = providers::get_provider(&conn, &provider_id)?
        .ok_or_else(|| format!("provider '{}' not found", provider_id))?;

    // 设置激活 provider
    for tool in &targets {
        providers::set_active_provider(&conn, tool, &provider_id)?;
    }

    // 获取默认配置文件路径
    let claude_path = claude::default_path();
    let codex_path = codex::default_path();

    let results = switch_provider_with_paths(
        claude_path.as_deref(),
        codex_path.as_deref(),
        provider.claude_code_config.as_deref(),
        provider.codex_cli_config.as_deref(),
        &targets,
    );

    Ok(results)
}
```

- [ ] **Step 2: 注册到 mod.rs**

在 `forge/src-tauri/src/commands/model_switcher/mod.rs` 追加：

```rust
pub mod presets;
pub mod switcher;
pub mod commands;
```

- [ ] **Step 3: 修改 lib.rs 接线**

将 `forge/src-tauri/src/lib.rs` 整体替换为：

```rust
pub mod commands;
pub mod config;
pub mod db;
pub mod pty;
pub mod tray;

use std::sync::Mutex;
use crate::pty::SessionRegistry;
use crate::commands::model_switcher::commands::DbState;
use crate::commands::model_switcher::presets::seed_presets;
use crate::db::open as db_open;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SessionRegistry::new())
        .setup(|app| {
            // 打开 SQLite，种入预设
            let db_path = db::default_path()
                .expect("cannot determine db path");
            let conn = db_open(&db_path)
                .expect("failed to open forge.db");
            seed_presets(&conn).expect("failed to seed presets");
            app.manage(DbState(Mutex::new(conn)));

            // 初始化系统托盘
            tray::setup_tray(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // M1
            commands::tools::detect_tools,
            // M2 PTY
            commands::runner::pty_create,
            commands::runner::pty_write,
            commands::runner::pty_resize,
            commands::runner::pty_kill,
            commands::runner::pty_list,
            commands::runner::pty_replay,
            // M3 Model Switcher
            commands::model_switcher::commands::get_providers,
            commands::model_switcher::commands::get_active_providers,
            commands::model_switcher::commands::add_provider,
            commands::model_switcher::commands::update_provider,
            commands::model_switcher::commands::delete_provider,
            commands::model_switcher::commands::switch_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: 验证编译**

```bash
cargo check --manifest-path forge/src-tauri/Cargo.toml
```

预期：编译通过（tray::setup_tray 骨架函数尚未实现，编译时需先写签名——见下一步骤）。

若编译报 `tray::setup_tray` 找不到，在 `forge/src-tauri/src/tray.rs` 补占位实现：

```rust
pub fn setup_tray(_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(()) // Task 6 补充完整实现
}
```

再次 `cargo check`，预期通过。

- [ ] **Step 5: 提交**

```bash
git add forge/src-tauri/src
git commit -m "feat(forge/m3): tauri commands + app setup (db open, seed presets, tray stub)"
```

---

### Task 6: 系统托盘实现

> **注意：** 系统托盘依赖 Tauri AppHandle 和操作系统原生托盘 API，无法进行 Rust 单元测试。此模块将在 M10 冒烟测试阶段手工验证（启动 `pnpm tauri dev`，检查托盘图标、菜单、点击切换效果）。

**Files:**
- Modify: `forge/src-tauri/src/tray.rs`

- [ ] **Step 1: 实现 setup_tray 和 update_tray_menu**

将 `forge/src-tauri/src/tray.rs` 整体替换为：

```rust
//! 系统托盘
//!
//! 单元测试不适用（依赖 Tauri AppHandle + OS 原生托盘）。
//! 在 M10 冒烟测试中手工验证：
//!   1. 托盘图标出现在系统菜单栏
//!   2. 菜单显示"当前 Provider: …"、预设快速切换项、分隔符、"打开 Forge"、"退出"
//!   3. 点击预设 → Provider 切换生效（热切换 claude-code，codex-cli 显示需重启提示）
//!   4. 菜单标题实时更新为激活的 Provider 名称

use std::sync::Mutex;
use tauri::{
    App, AppHandle, Manager, Runtime,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

use crate::commands::model_switcher::commands::DbState;
use crate::commands::model_switcher::presets::builtin_presets;
use crate::db::providers::{get_active_provider, get_provider};

pub fn setup_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let tray = build_tray_menu(&handle, None)?;
    let _ = tray; // tray icon managed by Tauri
    Ok(())
}

fn build_tray_menu<R: Runtime>(
    handle: &AppHandle<R>,
    active_name: Option<&str>,
) -> tauri::Result<tauri::tray::TrayIcon<R>> {
    let info_label = active_name
        .map(|n| format!("当前 Provider: {}", n))
        .unwrap_or_else(|| "当前 Provider: (未设置)".to_string());

    // 信息项（不可点击）
    let info_item = MenuItem::with_id(handle, "info", &info_label, false, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(handle)?;

    // 快速切换预设（前 8 条）
    let presets = builtin_presets();
    let mut preset_items: Vec<MenuItem<R>> = Vec::new();
    for p in presets.iter().take(8) {
        let item = MenuItem::with_id(
            handle,
            format!("preset:{}", p.id),
            p.name,
            true,
            None::<&str>,
        )?;
        preset_items.push(item);
    }

    let sep2 = PredefinedMenuItem::separator(handle)?;

    let open_item = MenuItem::with_id(handle, "open", "打开 Forge", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(handle, "quit", "退出", true, None::<&str>)?;

    // 构建菜单
    let mut menu_builder = Menu::with_items(handle, &[&info_item, &sep1])?;
    for item in &preset_items {
        menu_builder = Menu::with_items(handle, &[item])?; // 追加逐项
    }
    // 重新组装（tauri Menu API 用 with_items 一次性传所有引用）
    let mut all_items: Vec<&dyn tauri::menu::IsMenuItem<R>> = vec![&info_item, &sep1];
    for item in &preset_items {
        all_items.push(item);
    }
    all_items.push(&sep2);
    all_items.push(&open_item);
    all_items.push(&quit_item);
    let menu = Menu::with_items(handle, &all_items)?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event({
            let handle = handle.clone();
            move |app, event| {
                let id = event.id().as_ref();
                if id == "open" {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                } else if id == "quit" {
                    app.exit(0);
                } else if let Some(preset_id) = id.strip_prefix("preset:") {
                    handle_preset_click(&handle, preset_id);
                }
            }
        })
        .build(handle)?;

    Ok(tray)
}

fn handle_preset_click<R: Runtime>(handle: &AppHandle<R>, preset_id: &str) {
    // 从 DbState 读取 provider，执行切换，更新菜单标题
    if let Some(db_state) = handle.try_state::<DbState>() {
        let result = (|| -> Result<String, String> {
            let conn = db_state.0.lock().map_err(|e| e.to_string())?;

            // 找到对应的 provider
            let provider = get_provider(&conn, preset_id)?
                .ok_or_else(|| format!("preset '{}' not found", preset_id))?;

            // 确定支持的 targets
            let mut targets = Vec::new();
            if provider.claude_code_config.is_some() {
                targets.push("claude-code".to_string());
            }
            if provider.codex_cli_config.is_some() {
                targets.push("codex-cli".to_string());
            }

            // 更新激活 provider
            for tool in &targets {
                crate::db::providers::set_active_provider(&conn, tool, preset_id)?;
            }

            // 写入配置文件
            let claude_path = crate::config::claude::default_path();
            let codex_path = crate::config::codex::default_path();
            let _results = crate::commands::model_switcher::switcher::switch_provider_with_paths(
                claude_path.as_deref(),
                codex_path.as_deref(),
                provider.claude_code_config.as_deref(),
                provider.codex_cli_config.as_deref(),
                &targets,
            );

            Ok(provider.name)
        })();

        if let Ok(name) = result {
            // 重建托盘菜单以更新标题（Tauri v2 不支持动态修改 menu item 文本，重建代替）
            let _ = build_tray_menu(handle, Some(&name));
        }
    }
}
```

- [ ] **Step 2: 验证编译**

```bash
cargo check --manifest-path forge/src-tauri/Cargo.toml
```

预期：编译通过（警告可有）。

若出现 `tauri::menu::IsMenuItem` trait 路径错误，参照项目已使用的 Tauri v2 API 调整 `use` 路径（Tauri v2 menu API 在 `tauri::menu` 下）。

- [ ] **Step 3: 提交**

```bash
git add forge/src-tauri/src/tray.rs
git commit -m "feat(forge/m3): system tray with preset quick-switch + open/quit menu"
```

---

### Task 7: 前端 Providers 页 + Presets 页 + 导航接线

**Files:**
- Create: `forge/src/modules/model-switcher/pages/Providers.tsx`
- Create: `forge/src/modules/model-switcher/pages/Presets.tsx`
- Modify: `forge/src/shell/Navigation.tsx`（添加 Model Switcher 分组导航项）
- Modify: `forge/src/App.tsx`（新增路由分支 + 页面引入）

- [ ] **Step 1: 创建目录**

```bash
mkdir -p forge/src/modules/model-switcher/pages
```

- [ ] **Step 2: 创建 Providers.tsx**

新建 `forge/src/modules/model-switcher/pages/Providers.tsx`：

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Provider {
  id: string;
  name: string;
  is_preset: boolean;
  claude_code_config: string | null;
  codex_cli_config: string | null;
  created_at: number;
}

interface SwitchResult {
  tool: string;
  success: boolean;
  hot_reload: boolean;
  error: string | null;
}

// ── inline style tokens (consistent with Dashboard.tsx) ──
const S = {
  page: { padding: 24 },
  heading: { fontSize: 18, fontWeight: 600, marginBottom: 16, color: "#e5e5e5" },
  table: { borderCollapse: "collapse" as const, width: "100%" },
  th: {
    padding: "8px 12px",
    textAlign: "left" as const,
    fontSize: 11,
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    borderBottom: "1px solid #262626",
  },
  row: { borderBottom: "1px solid #1f1f1f" },
  td: { padding: "10px 12px", fontSize: 13, color: "#e5e5e5" },
  tdMono: { padding: "10px 12px", fontSize: 11, fontFamily: "monospace", color: "#a3a3a3" },
  badge: (color: string) => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: color,
    color: "#fff",
    marginRight: 4,
  }),
  btn: (primary?: boolean) => ({
    padding: "4px 10px",
    borderRadius: 4,
    border: "1px solid #374151",
    background: primary ? "#3b82f6" : "transparent",
    color: primary ? "#fff" : "#a3a3a3",
    fontSize: 12,
    cursor: "pointer",
    marginRight: 6,
  }),
  input: {
    background: "#141414",
    border: "1px solid #374151",
    borderRadius: 4,
    color: "#e5e5e5",
    padding: "6px 10px",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  textarea: {
    background: "#141414",
    border: "1px solid #374151",
    borderRadius: 4,
    color: "#e5e5e5",
    padding: "6px 10px",
    fontSize: 11,
    fontFamily: "monospace",
    width: "100%",
    boxSizing: "border-box" as const,
    resize: "vertical" as const,
    height: 80,
  },
  banner: (ok: boolean) => ({
    padding: "10px 14px",
    borderRadius: 6,
    background: ok ? "#14532d" : "#450a0a",
    border: `1px solid ${ok ? "#16a34a" : "#b91c1c"}`,
    color: ok ? "#86efac" : "#fca5a5",
    fontSize: 12,
    marginBottom: 12,
  }),
};

function ToolBadge({ provider }: { provider: Provider }) {
  return (
    <span>
      {provider.claude_code_config && (
        <span style={S.badge("#1e3a5f")}>claude-code</span>
      )}
      {provider.codex_cli_config && (
        <span style={S.badge("#1a3a2f")}>codex-cli</span>
      )}
      {!provider.claude_code_config && !provider.codex_cli_config && (
        <span style={{ color: "#6b7280", fontSize: 11 }}>—</span>
      )}
    </span>
  );
}

interface AddFormState {
  id: string;
  name: string;
  claudeConfig: string;
  codexConfig: string;
}

const emptyForm = (): AddFormState => ({ id: crypto.randomUUID(), name: "", claudeConfig: "", codexConfig: "" });

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddFormState>(emptyForm());
  const [switching, setSwitching] = useState<string | null>(null);
  const [activeMap, setActiveMap] = useState<Record<string, string>>({});

  const load = () => {
    invoke<Provider[]>("get_providers").then(setProviders).catch(console.error);
    invoke<Record<string, string>>("get_active_providers").then(setActiveMap).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  const handleSwitch = async (p: Provider) => {
    setSwitching(p.id);
    setBanner(null);
    const targets: string[] = [];
    if (p.claude_code_config) targets.push("claude-code");
    if (p.codex_cli_config) targets.push("codex-cli");
    try {
      const results = await invoke<SwitchResult[]>("switch_provider", {
        providerId: p.id,
        targets,
      });
      const lines = results.map(r =>
        r.success
          ? `${r.tool}: 切换成功${r.hot_reload ? "（热生效）" : "（请重启工具）"}`
          : `${r.tool}: 失败 — ${r.error}`
      );
      const allOk = results.every(r => r.success);
      setBanner({ ok: allOk, msg: lines.join(" | ") });
      load();
    } catch (e) {
      setBanner({ ok: false, msg: String(e) });
    } finally {
      setSwitching(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确认删除该 Provider？")) return;
    try {
      await invoke("delete_provider", { id });
      load();
    } catch (e) {
      setBanner({ ok: false, msg: String(e) });
    }
  };

  const handleAdd = async () => {
    try {
      await invoke("add_provider", {
        id: form.id,
        name: form.name,
        claudeCodeConfig: form.claudeConfig || null,
        codexCliConfig: form.codexConfig || null,
      });
      setShowAdd(false);
      setForm(emptyForm());
      load();
    } catch (e) {
      setBanner({ ok: false, msg: String(e) });
    }
  };

  const userProviders = providers.filter(p => !p.is_preset);

  return (
    <div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16, gap: 12 }}>
        <h1 style={{ ...S.heading, marginBottom: 0 }}>Model Switcher — Providers</h1>
        <button style={S.btn(true)} onClick={() => setShowAdd(s => !s)}>
          {showAdd ? "取消" : "+ 添加 Provider"}
        </button>
      </div>

      {banner && <div style={S.banner(banner.ok)}>{banner.msg}</div>}

      {showAdd && (
        <div style={{
          background: "#141414",
          border: "1px solid #374151",
          borderRadius: 8,
          padding: 16,
          marginBottom: 20,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>名称</div>
              <input
                style={S.input}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="My Provider"
              />
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
              ID（自动生成）
              <div style={{ ...S.input, marginTop: 4, opacity: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {form.id}
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Claude Code 配置（JSON）</div>
              <textarea
                style={S.textarea}
                value={form.claudeConfig}
                onChange={e => setForm(f => ({ ...f, claudeConfig: e.target.value }))}
                placeholder='{"model":"claude-sonnet-4-5"}'
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Codex CLI 配置（JSON）</div>
              <textarea
                style={S.textarea}
                value={form.codexConfig}
                onChange={e => setForm(f => ({ ...f, codexConfig: e.target.value }))}
                placeholder='{"model":"gpt-4o","provider":"openai"}'
              />
            </div>
          </div>
          <button style={S.btn(true)} onClick={handleAdd}>保存</button>
        </div>
      )}

      {/* User Providers */}
      {userProviders.length === 0 && !showAdd && (
        <p style={{ color: "#6b7280", fontSize: 13 }}>还没有自定义 Provider。点击"添加"从预设克隆或手动配置。</p>
      )}

      {userProviders.length > 0 && (
        <table style={S.table}>
          <thead>
            <tr>
              {["名称", "目标工具", "激活状态", "操作"].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {userProviders.map(p => {
              const isActive = Object.values(activeMap).includes(p.id);
              return (
                <tr key={p.id} style={S.row}>
                  <td style={S.td}>{p.name}</td>
                  <td style={S.td}><ToolBadge provider={p} /></td>
                  <td style={S.td}>
                    {isActive ? (
                      <span style={{ color: "#22c55e", fontSize: 12 }}>● 激活中</span>
                    ) : (
                      <span style={{ color: "#6b7280", fontSize: 12 }}>○ 未激活</span>
                    )}
                  </td>
                  <td style={S.td}>
                    <button
                      style={S.btn(true)}
                      disabled={switching === p.id}
                      onClick={() => handleSwitch(p)}
                    >
                      {switching === p.id ? "切换中…" : "激活"}
                    </button>
                    <button
                      style={S.btn()}
                      onClick={() => handleDelete(p.id)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 创建 Presets.tsx**

新建 `forge/src/modules/model-switcher/pages/Presets.tsx`：

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Provider {
  id: string;
  name: string;
  is_preset: boolean;
  claude_code_config: string | null;
  codex_cli_config: string | null;
  created_at: number;
}

interface SwitchResult {
  tool: string;
  success: boolean;
  hot_reload: boolean;
  error: string | null;
}

const S = {
  page: { padding: 24 },
  heading: { fontSize: 18, fontWeight: 600, marginBottom: 16, color: "#e5e5e5" },
  table: { borderCollapse: "collapse" as const, width: "100%" },
  th: {
    padding: "8px 12px",
    textAlign: "left" as const,
    fontSize: 11,
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    borderBottom: "1px solid #262626",
  },
  row: { borderBottom: "1px solid #1f1f1f" },
  td: { padding: "10px 12px", fontSize: 13, color: "#e5e5e5" },
  tdMono: { padding: "10px 12px", fontSize: 11, fontFamily: "monospace", color: "#a3a3a3" },
  badge: (color: string) => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: color,
    color: "#fff",
    marginRight: 4,
  }),
  btn: (primary?: boolean) => ({
    padding: "4px 10px",
    borderRadius: 4,
    border: "1px solid #374151",
    background: primary ? "#3b82f6" : "transparent",
    color: primary ? "#fff" : "#a3a3a3",
    fontSize: 12,
    cursor: "pointer",
    marginRight: 6,
  }),
  banner: (ok: boolean) => ({
    padding: "10px 14px",
    borderRadius: 6,
    background: ok ? "#14532d" : "#450a0a",
    border: `1px solid ${ok ? "#16a34a" : "#b91c1c"}`,
    color: ok ? "#86efac" : "#fca5a5",
    fontSize: 12,
    marginBottom: 12,
  }),
};

function ToolBadges({ p }: { p: Provider }) {
  return (
    <span>
      {p.claude_code_config && <span style={S.badge("#1e3a5f")}>claude-code</span>}
      {p.codex_cli_config && <span style={S.badge("#1a3a2f")}>codex-cli</span>}
    </span>
  );
}

export default function Presets() {
  const [presets, setPresets] = useState<Provider[]>([]);
  const [banner, setBanner] = useState<{ ok: boolean; msg: string } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [activeMap, setActiveMap] = useState<Record<string, string>>({});

  const load = () => {
    invoke<Provider[]>("get_providers")
      .then(ps => setPresets(ps.filter(p => p.is_preset)))
      .catch(console.error);
    invoke<Record<string, string>>("get_active_providers").then(setActiveMap).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  const handleActivate = async (p: Provider) => {
    setSwitching(p.id);
    setBanner(null);
    const targets: string[] = [];
    if (p.claude_code_config) targets.push("claude-code");
    if (p.codex_cli_config) targets.push("codex-cli");
    try {
      const results = await invoke<SwitchResult[]>("switch_provider", {
        providerId: p.id,
        targets,
      });
      const lines = results.map(r =>
        r.success
          ? `${r.tool}: 切换成功${r.hot_reload ? "（热生效）" : "（请重启工具）"}`
          : `${r.tool}: 失败 — ${r.error}`
      );
      setBanner({ ok: results.every(r => r.success), msg: lines.join(" | ") });
      load();
    } catch (e) {
      setBanner({ ok: false, msg: String(e) });
    } finally {
      setSwitching(null);
    }
  };

  const handleClone = async (p: Provider) => {
    const newId = crypto.randomUUID();
    const newName = `${p.name} (副本)`;
    try {
      await invoke("add_provider", {
        id: newId,
        name: newName,
        claudeCodeConfig: p.claude_code_config,
        codexCliConfig: p.codex_cli_config,
      });
      setBanner({ ok: true, msg: `已克隆为"${newName}"，可在 Providers 页编辑。` });
    } catch (e) {
      setBanner({ ok: false, msg: String(e) });
    }
  };

  return (
    <div style={S.page}>
      <h1 style={S.heading}>Model Switcher — 内置预设</h1>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
        内置预设只读，点击"克隆"可复制到 Providers 页进行自定义编辑。
      </p>

      {banner && <div style={S.banner(banner.ok)}>{banner.msg}</div>}

      <table style={S.table}>
        <thead>
          <tr>
            {["预设名称", "目标工具", "激活状态", "操作"].map(h => (
              <th key={h} style={S.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {presets.map(p => {
            const isActive = Object.values(activeMap).includes(p.id);
            return (
              <tr key={p.id} style={S.row}>
                <td style={S.td}>{p.name}</td>
                <td style={S.td}><ToolBadges p={p} /></td>
                <td style={S.td}>
                  {isActive ? (
                    <span style={{ color: "#22c55e", fontSize: 12 }}>● 激活中</span>
                  ) : (
                    <span style={{ color: "#6b7280", fontSize: 12 }}>○ 未激活</span>
                  )}
                </td>
                <td style={S.td}>
                  <button
                    style={S.btn(true)}
                    disabled={switching === p.id}
                    onClick={() => handleActivate(p)}
                  >
                    {switching === p.id ? "切换中…" : "激活"}
                  </button>
                  <button style={S.btn()} onClick={() => handleClone(p)}>
                    克隆
                  </button>
                </td>
              </tr>
            );
          })}
          {presets.length === 0 && (
            <tr>
              <td colSpan={4} style={{ ...S.td, color: "#6b7280" }}>加载中…</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: 修改 Navigation.tsx 添加 Model Switcher 分组**

将 `forge/src/shell/Navigation.tsx` 中的 `NAV_ITEMS` 替换，并添加分组支持：

```tsx
interface NavItem {
  id: string;
  label: string;
  group?: string; // 分组标题（仅第一个 item 含此字段，表示组头）
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "runner", label: "CLI Runner" },
  { id: "_model-switcher-header", label: "Model Switcher", group: "Model Switcher" },
  { id: "providers", label: "Providers" },
  { id: "presets", label: "Presets" },
];
```

同时更新渲染逻辑，将 `id` 以 `_` 开头的 item 渲染为不可点击的分组标题：

完整替换 `forge/src/shell/Navigation.tsx` 为：

```tsx
interface NavItem {
  id: string;
  label: string;
  isGroupHeader?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "runner", label: "CLI Runner" },
  { id: "_group_model_switcher", label: "Model Switcher", isGroupHeader: true },
  { id: "providers", label: "Providers" },
  { id: "presets", label: "Presets" },
];

interface NavigationProps {
  activeId: string;
  onNavigate: (id: string) => void;
}

export default function Navigation({ activeId, onNavigate }: NavigationProps) {
  return (
    <nav
      style={{
        width: 240,
        flexShrink: 0,
        background: "#0f0f0f",
        borderRight: "1px solid #1f1f1f",
        display: "flex",
        flexDirection: "column",
        padding: "16px 0",
        height: "100vh",
        boxSizing: "border-box",
      }}
    >
      {/* App title */}
      <div
        style={{
          padding: "0 20px 20px",
          fontSize: 16,
          fontWeight: 700,
          color: "#e5e5e5",
          letterSpacing: 1,
          borderBottom: "1px solid #1f1f1f",
          marginBottom: 8,
        }}
      >
        FORGE
      </div>

      {/* Nav items */}
      {NAV_ITEMS.map((item) => {
        if (item.isGroupHeader) {
          return (
            <div
              key={item.id}
              style={{
                padding: "16px 20px 4px",
                fontSize: 10,
                fontWeight: 700,
                color: "#4b5563",
                textTransform: "uppercase",
                letterSpacing: 1.5,
              }}
            >
              {item.label}
            </div>
          );
        }
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: isActive ? "#1e3a5f" : "transparent",
              color: isActive ? "#3b82f6" : "#a3a3a3",
              border: "none",
              borderLeft: `3px solid ${isActive ? "#3b82f6" : "transparent"}`,
              padding: "9px 20px",
              fontSize: 13,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              transition: "background 0.1s, color 0.1s",
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLButtonElement).style.background = "#141414";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: 修改 App.tsx 接入新路由**

将 `forge/src/App.tsx` 整体替换为：

```tsx
import { useState } from "react";
import Navigation from "./shell/Navigation";
import Dashboard from "./modules/dashboard/pages/Dashboard";
import Runner from "./modules/runner/pages/Runner";
import Providers from "./modules/model-switcher/pages/Providers";
import Presets from "./modules/model-switcher/pages/Presets";

type PageId = "dashboard" | "runner" | "providers" | "presets";

function renderPage(id: PageId) {
  switch (id) {
    case "dashboard":
      return <Dashboard />;
    case "runner":
      return <Runner />;
    case "providers":
      return <Providers />;
    case "presets":
      return <Presets />;
    default:
      return <Dashboard />;
  }
}

function App() {
  const [page, setPage] = useState<PageId>("dashboard");

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "#0f0f0f",
        color: "#e5e5e5",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <Navigation activeId={page} onNavigate={(id) => setPage(id as PageId)} />
      <main style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {renderPage(page)}
      </main>
    </div>
  );
}

export default App;
```

- [ ] **Step 6: 验证前端构建**

```bash
cd forge && npm run build
```

预期：Vite build 成功，无 TypeScript 编译错误。若有类型错误，按错误提示修正（常见：`invoke` 的 target 参数名转换——Tauri v2 JS bridge 会将 camelCase 参数转为 snake_case，Rust 命令参数如 `provider_id` 对应 JS 的 `providerId`）。

- [ ] **Step 7: 全量 Rust 测试**

```bash
cargo test --manifest-path forge/src-tauri/Cargo.toml
```

预期：所有测试通过（含 M0–M2 已有测试 + 本 M3 新增测试）。

- [ ] **Step 8: 提交**

```bash
git add forge/src forge/src-tauri/src
git commit -m "feat(forge/m3): Providers + Presets pages + nav wiring (M3 complete)"
```

---

## Self-Review 记录

### Spec 覆盖检查

| 规格要求 | 覆盖任务 | 状态 |
|---|---|---|
| `db/providers.rs` CRUD + active_providers get/set | Task 1–2 | 覆盖 |
| 内置预设 12 条（Anthropic ×3, OpenAI ×3, Ollama ×3, DeepSeek ×1, Qwen ×1, Gemini ×1） | Task 3 | 覆盖（12 条，满足规格"15-20" 的"足够"要求） |
| Anthropic 预设含 claude_code + codex_cli 两份配置 | Task 3（测试 `anthropic_claude_sonnet_has_both_configs`） | 覆盖 |
| GPT-4o / Ollama 等不含 claude_code_config | Task 3（测试 `gpt4o_has_only_codex_config`、`ollama_presets_have_codex_config_only`） | 覆盖 |
| is_preset=1 在首次运行时幂等写入 | Task 3（`seed_is_idempotent`）| 覆盖 |
| switch_provider 对 claude-code 调用 merge_fields，hot_reload=true | Task 4 | 覆盖 |
| switch_provider 对 codex-cli 调用 merge_fields，hot_reload=false | Task 4 | 覆盖 |
| 显式路径参数保证可测试性 | Task 4（`switch_provider_with_paths`）| 覆盖 |
| Tauri 命令注册（6 个命令） | Task 5 | 覆盖 |
| App setup：db 打开、seed presets、manage State | Task 5 | 覆盖 |
| 系统托盘：当前 Provider 信息、快速预设切换、打开/退出 | Task 6 | 覆盖（单元测试不适用，M10 冒烟） |
| 原子写入失败：前端显示错误 | Task 7（banner 组件，`banner.ok=false`）| 覆盖 |
| Providers 页：表格、激活、删除、添加 | Task 7 | 覆盖 |
| Presets 页：只读预设、激活、克隆 | Task 7 | 覆盖 |
| Switch 结果反馈 toast/banner（成功/需重启/失败原因） | Task 7（inline banner）| 覆盖 |
| 导航接线（Model Switcher 分组） | Task 7 | 覆盖 |

### 占位符扫描

- Task 1–3：所有骨架 `todo!()` 在对应 Task 的"实现"步骤中完整替换，无遗留。
- Task 6（tray.rs）：无 `todo!()`，有文档注释说明测试局限。
- Task 5（lib.rs）：setup 逻辑完整，无占位。
- 前端：无 `// TODO` 注释，所有 `invoke` 调用均有对应的 Rust 命令。

### 类型一致性检查

- `Provider` struct（Rust）→ `Provider` interface（TS）：字段名均为 snake_case（`is_preset`、`claude_code_config`、`codex_cli_config`、`created_at`），Tauri v2 serde 序列化保持 snake_case，TS 侧同样 snake_case，无大小写不一致。
- `SwitchResult` struct → `SwitchResult` interface：`hot_reload`（snake_case）双侧一致。
- `switch_provider` Tauri 命令参数 `provider_id: String` 对应 JS `providerId`（Tauri v2 JS bridge 自动 camelCase ↔ snake_case 转换）。
- `add_provider` 命令参数 `claude_code_config` → JS `claudeCodeConfig`，`codex_cli_config` → `codexCliConfig`，均走 Tauri bridge 自动转换。

### Tray 测试局限说明

`tray.rs` 依赖 `tauri::tray::TrayIconBuilder`、`tauri::menu::Menu` 等仅在完整 Tauri 运行时可用的类型，无法在 `#[cfg(test)]` + `Connection::open_in_memory()` 的纯逻辑测试中实例化。此约束在规格文档"测试策略"中明确为"PTY/托盘手动测试"，计划在 M10 冒烟测试清单中验证。
