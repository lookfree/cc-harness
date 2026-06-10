use serde::{Deserialize, Serialize};

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
    Ok(names
        .iter()
        .map(|&n| {
            let status = crate::commands::tools::detect(n);
            ToolDetection {
                name: n.to_string(),
                found: status.installed,
                path: status.path,
                version: status.version,
            }
        })
        .collect())
}

pub fn get_env_vars_from_db(
    conn: &rusqlite::Connection,
) -> Result<Vec<EnvVar>, String> {
    crate::db::get_env_vars(conn)
        .map(|v| v.into_iter().map(|(k, val)| EnvVar { key: k, value: val }).collect())
}

pub fn set_env_var_in_db(
    conn: &rusqlite::Connection,
    key: &str,
    value: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO env_vars (key, value, created_at) VALUES (?1, ?2, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())
    .map(|_| ())
}

pub fn delete_env_var_in_db(
    conn: &rusqlite::Connection,
    key: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM env_vars WHERE key=?1",
        rusqlite::params![key],
    )
    .map_err(|e| e.to_string())
    .map(|_| ())
}

/// Minimal connectivity test: POST to Anthropic API with current API key.
/// Marked #[ignore] by default in tests — requires network.
pub async fn test_api_connection_impl() -> Result<bool, String> {
    // Read API key from ~/.claude.json
    let path = dirs::home_dir()
        .map(|h| h.join(".claude.json"))
        .ok_or("no home dir")?;
    let doc = crate::config::claude::read_json(&path)?;
    let api_key = doc
        .get("apiKey")
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
pub fn cmd_detect_env_tools() -> Result<Vec<ToolDetection>, String> {
    detect_env_tools()
}

#[tauri::command]
pub fn cmd_get_env_vars(
    state: tauri::State<DbState>,
) -> Result<Vec<EnvVar>, String> {
    let conn = state.0.lock().unwrap();
    get_env_vars_from_db(&conn)
}

#[tauri::command]
pub fn cmd_set_env_var(
    key: String,
    value: String,
    state: tauri::State<DbState>,
) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    set_env_var_in_db(&conn, &key, &value)
}

#[tauri::command]
pub fn cmd_delete_env_var(
    key: String,
    state: tauri::State<DbState>,
) -> Result<(), String> {
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
