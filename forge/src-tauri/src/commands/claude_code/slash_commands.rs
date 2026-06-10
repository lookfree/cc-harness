use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use crate::config::atomic::write_atomic;
use crate::commands::claude_code::utils::safe_join;

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
    let file_name = format!("{}.md", cmd.name);
    let path = safe_join(&dir, &file_name)?;
    write_atomic(&path, &cmd.content)
}

pub fn save_slash_command_raw(base_dir: &Path, name: &str, content: &str, rel_path: &str) -> Result<(), String> {
    let target = if rel_path.is_empty() {
        let dir = commands_dir(base_dir);
        let file_name = format!("{}.md", name);
        safe_join(&dir, &file_name)?
    } else {
        safe_join(base_dir, rel_path)?
    };
    if let Some(p) = target.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(&target, content)
}

pub fn delete_slash_command(base_dir: &Path, name: &str) -> Result<(), String> {
    let dir = commands_dir(base_dir);
    let file_name = format!("{}.md", name);
    let path = safe_join(&dir, &file_name)?;
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

    #[test]
    fn save_slash_command_rejects_traversal_in_name() {
        let dir = tempdir().unwrap();
        let cmd = SlashCommand { name: "../evil".into(), description: None, content: "bad".into(), file_path: None, location: "user".into() };
        let result = save_slash_command(dir.path(), &cmd);
        assert!(result.is_err(), "expected Err for name '../evil'");
        // nothing written outside the tempdir base
        assert!(!dir.path().parent().unwrap().join("evil.md").exists());
    }

    #[test]
    fn save_slash_command_raw_rejects_traversal_in_rel_path() {
        let dir = tempdir().unwrap();
        let result = save_slash_command_raw(dir.path(), "x", "bad", "../../evil.md");
        assert!(result.is_err(), "expected Err for rel_path '../../evil.md'");
    }

    #[test]
    fn save_slash_command_raw_rejects_absolute_rel_path() {
        let dir = tempdir().unwrap();
        let result = save_slash_command_raw(dir.path(), "x", "bad", "/tmp/evil.md");
        assert!(result.is_err(), "expected Err for absolute rel_path");
    }

    #[test]
    fn delete_slash_command_rejects_traversal_in_name() {
        let dir = tempdir().unwrap();
        let result = delete_slash_command(dir.path(), "../evil");
        assert!(result.is_err(), "expected Err for name '../evil'");
    }
}
