use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use crate::config::{atomic::write_atomic, claude::read_json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub name: String,
    pub config: Value,
    /// "settings" | "legacy"
    pub source: String,
}

fn settings_path(base_dir: &Path) -> PathBuf { base_dir.join("settings.json") }
fn legacy_path(base_dir: &Path) -> PathBuf { base_dir.join("claude_mcp_config.json") }

/// Read mcpServers from settings.json
fn read_from_settings(base_dir: &Path) -> Vec<McpServer> {
    let doc = match read_json(&settings_path(base_dir)) { Ok(d) => d, Err(_) => return vec![] };
    doc.get("mcpServers")
        .and_then(|v| v.as_object())
        .map(|obj| obj.iter().map(|(k, v)| McpServer { name: k.clone(), config: v.clone(), source: "settings".to_string() }).collect())
        .unwrap_or_default()
}

/// Read mcpServers from legacy claude_mcp_config.json (root key "mcpServers")
fn read_from_legacy(base_dir: &Path) -> Vec<McpServer> {
    let doc = match read_json(&legacy_path(base_dir)) { Ok(d) => d, Err(_) => return vec![] };
    doc.get("mcpServers")
        .and_then(|v| v.as_object())
        .map(|obj| obj.iter().map(|(k, v)| McpServer { name: k.clone(), config: v.clone(), source: "legacy".to_string() }).collect())
        .unwrap_or_default()
}

/// Merge: settings wins on name clash.
pub fn get_mcp_servers(base_dir: &Path) -> Result<Vec<McpServer>, String> {
    let from_legacy = read_from_legacy(base_dir);
    let from_settings = read_from_settings(base_dir);

    // Build a merged map: start with legacy, then overlay settings (settings wins)
    let mut merged: std::collections::BTreeMap<String, McpServer> = std::collections::BTreeMap::new();
    for srv in from_legacy {
        merged.insert(srv.name.clone(), srv);
    }
    for srv in from_settings {
        merged.insert(srv.name.clone(), srv);
    }
    Ok(merged.into_values().collect())
}

pub fn get_mcp_server(base_dir: &Path, name: &str) -> Result<Option<McpServer>, String> {
    Ok(get_mcp_servers(base_dir)?.into_iter().find(|s| s.name == name))
}

/// Save a server. If it originated from the legacy file, write it back there.
/// New servers (no existing entry) go to settings.json.
pub fn save_mcp_server(base_dir: &Path, name: &str, config: Value) -> Result<(), String> {
    // Determine target file: check if server currently exists in legacy
    let existing_source = get_mcp_server(base_dir, name)?
        .map(|s| s.source)
        .unwrap_or_else(|| "settings".to_string());

    if existing_source == "legacy" {
        write_to_legacy(base_dir, name, config)
    } else {
        write_to_settings(base_dir, name, config)
    }
}

fn write_to_settings(base_dir: &Path, name: &str, config: Value) -> Result<(), String> {
    let path = settings_path(base_dir);
    let mut doc = read_json(&path)?;
    let obj = doc.as_object_mut().ok_or("settings.json root not object")?;
    let mcp = obj.entry("mcpServers").or_insert(Value::Object(Default::default()));
    mcp.as_object_mut().ok_or("mcpServers not object")?.insert(name.to_string(), config);
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(&path, &pretty)
}

fn write_to_legacy(base_dir: &Path, name: &str, config: Value) -> Result<(), String> {
    let path = legacy_path(base_dir);
    let mut doc = read_json(&path)?;
    let obj = doc.as_object_mut().ok_or("legacy config root not object")?;
    let mcp = obj.entry("mcpServers").or_insert(Value::Object(Default::default()));
    mcp.as_object_mut().ok_or("mcpServers not object")?.insert(name.to_string(), config);
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(&path, &pretty)
}

/// Delete server from whichever file holds it.
pub fn delete_mcp_server(base_dir: &Path, name: &str) -> Result<(), String> {
    let source = get_mcp_server(base_dir, name)?
        .map(|s| s.source)
        .unwrap_or_else(|| "settings".to_string());

    let path = if source == "legacy" { legacy_path(base_dir) } else { settings_path(base_dir) };

    if !path.exists() { return Ok(()); }
    let mut doc = read_json(&path)?;
    let key = if source == "legacy" { "mcpServers" } else { "mcpServers" };
    if let Some(mcp) = doc.as_object_mut().and_then(|o| o.get_mut(key)).and_then(|v| v.as_object_mut()) {
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

    // A5 tests
    #[test]
    fn a5_merge_legacy_and_settings_settings_wins() {
        let dir = tempdir().unwrap();
        // Write legacy with "server-a" and "shared"
        let legacy = dir.path().join("claude_mcp_config.json");
        std::fs::write(&legacy, r#"{"mcpServers":{"server-a":{"cmd":"a"},"shared":{"cmd":"legacy"}}}"#).unwrap();
        // Write settings with "server-b" and "shared" (should win)
        let settings = dir.path().join("settings.json");
        std::fs::write(&settings, r#"{"mcpServers":{"server-b":{"cmd":"b"},"shared":{"cmd":"settings"}}}"#).unwrap();

        let servers = get_mcp_servers(dir.path()).unwrap();
        let names: Vec<&str> = servers.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"server-a"), "server-a from legacy");
        assert!(names.contains(&"server-b"), "server-b from settings");
        assert!(names.contains(&"shared"), "shared merged");
        let shared = servers.iter().find(|s| s.name == "shared").unwrap();
        assert_eq!(shared.config["cmd"], "settings", "settings should win for shared");
        assert_eq!(shared.source, "settings");
        let a = servers.iter().find(|s| s.name == "server-a").unwrap();
        assert_eq!(a.source, "legacy");
    }

    #[test]
    fn a5_save_back_to_legacy_origin() {
        let dir = tempdir().unwrap();
        let legacy = dir.path().join("claude_mcp_config.json");
        std::fs::write(&legacy, r#"{"mcpServers":{"legacy-srv":{"cmd":"old"}},"extraField":"keep"}"#).unwrap();

        // Save updated config for a legacy server
        save_mcp_server(dir.path(), "legacy-srv", json!({"cmd": "new"})).unwrap();

        // Should be written back to legacy file
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&legacy).unwrap()).unwrap();
        assert_eq!(doc["mcpServers"]["legacy-srv"]["cmd"], "new");
        assert_eq!(doc["extraField"], "keep", "extra fields preserved");

        // settings.json should not have been created / modified
        let settings = dir.path().join("settings.json");
        if settings.exists() {
            let sdoc: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
            // must not contain legacy-srv
            assert!(sdoc.get("mcpServers").and_then(|m| m.get("legacy-srv")).is_none());
        }
    }

    #[test]
    fn a5_delete_from_legacy_origin() {
        let dir = tempdir().unwrap();
        let legacy = dir.path().join("claude_mcp_config.json");
        std::fs::write(&legacy, r#"{"mcpServers":{"to-del":{"cmd":"x"}}}"#).unwrap();

        delete_mcp_server(dir.path(), "to-del").unwrap();

        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&legacy).unwrap()).unwrap();
        assert!(doc["mcpServers"].as_object().unwrap().is_empty());
    }

    #[test]
    fn a5_new_server_goes_to_settings() {
        let dir = tempdir().unwrap();
        // No existing files
        save_mcp_server(dir.path(), "new-srv", json!({"cmd": "x"})).unwrap();
        // Should be in settings.json
        let settings = dir.path().join("settings.json");
        assert!(settings.exists());
        let doc: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert!(doc["mcpServers"].get("new-srv").is_some());
        let servers = get_mcp_servers(dir.path()).unwrap();
        assert_eq!(servers[0].source, "settings");
    }
}
