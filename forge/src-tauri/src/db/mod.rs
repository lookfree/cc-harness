pub mod providers;

use rusqlite::Connection;
use std::path::{Path, PathBuf};

const MIGRATIONS: &[(&str, &str)] = &[
    ("001_providers", include_str!("migrations/001_providers.sql")),
    ("002_usage", include_str!("migrations/002_usage.sql")),
];

/// 默认数据库路径：<data_local_dir>/forge/forge.db
pub fn default_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("forge/forge.db"))
}

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY);")
        .map_err(|e| e.to_string())?;
    for (name, sql) in MIGRATIONS {
        let applied: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name=?1)",
                [name],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !applied {
            conn.execute_batch(sql).map_err(|e| e.to_string())?;
            conn.execute("INSERT INTO schema_migrations(name) VALUES (?1)", [name])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Read all rows from the env_vars table.
pub fn get_env_vars(conn: &Connection) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM env_vars ORDER BY key")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [name],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn migrate_creates_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        for t in ["providers", "active_providers", "sessions", "projects", "env_vars"] {
            assert!(table_exists(&conn, t), "missing table {t}");
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // 第二次不应报错（已应用的跳过）
    }

    #[test]
    fn open_creates_parent_dir_and_migrates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/forge.db");
        let conn = open(&path).unwrap();
        assert!(table_exists(&conn, "providers"));
    }

    #[test]
    fn get_env_vars_empty_and_insert() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        // Initially empty
        let vars = get_env_vars(&conn).unwrap();
        assert!(vars.is_empty());

        // Insert a row and read it back
        conn.execute(
            "INSERT INTO env_vars (key, value, created_at) VALUES (?1, ?2, 0)",
            ["MY_KEY", "my_value"],
        )
        .unwrap();

        let vars = get_env_vars(&conn).unwrap();
        assert_eq!(vars.len(), 1);
        assert_eq!(vars[0].0, "MY_KEY");
        assert_eq!(vars[0].1, "my_value");
    }
}
