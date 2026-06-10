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
