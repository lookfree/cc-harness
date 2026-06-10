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
