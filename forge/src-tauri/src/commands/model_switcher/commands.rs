use std::sync::Mutex;
use tauri::State;
use rusqlite::Connection;

use crate::db::providers::{
    self, Provider,
};
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
