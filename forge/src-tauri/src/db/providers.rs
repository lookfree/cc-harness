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
