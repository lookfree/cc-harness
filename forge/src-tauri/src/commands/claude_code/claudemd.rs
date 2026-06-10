use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use crate::config::atomic::write_atomic;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeMdFile {
    pub location: String,
    pub file_path: String,
    pub content: String,
    pub exists: bool,
}

pub fn get_claudemd(base_dir: &Path) -> Result<ClaudeMdFile, String> {
    let path = base_dir.join("CLAUDE.md");
    let exists = path.exists();
    let content = if exists {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    Ok(ClaudeMdFile {
        location: "user".into(),
        file_path: path.to_string_lossy().to_string(),
        content,
        exists,
    })
}

pub fn get_all_claudemd(base_dir: &Path, project_path: Option<&Path>) -> Result<Vec<ClaudeMdFile>, String> {
    let mut files = vec![get_claudemd(base_dir)?];
    if let Some(proj) = project_path {
        let path = proj.join("CLAUDE.md");
        let exists = path.exists();
        let content = if exists { fs::read_to_string(&path).unwrap_or_default() } else { String::new() };
        files.push(ClaudeMdFile {
            location: "project".into(),
            file_path: path.to_string_lossy().to_string(),
            content,
            exists,
        });
    }
    Ok(files)
}

pub fn save_claudemd(path: &Path, content: &str) -> Result<(), String> {
    if let Some(p) = path.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(path, content)
}

fn resolve_base(b: Option<String>) -> Result<PathBuf, String> {
    match b {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude")).ok_or_else(|| "no home".into()),
    }
}

#[tauri::command]
pub fn cmd_get_claudemd(base_dir: Option<String>) -> Result<ClaudeMdFile, String> {
    get_claudemd(&resolve_base(base_dir)?)
}
#[tauri::command]
pub fn cmd_get_all_claudemd(base_dir: Option<String>, project_path: Option<String>) -> Result<Vec<ClaudeMdFile>, String> {
    get_all_claudemd(&resolve_base(base_dir)?, project_path.as_deref().map(Path::new))
}
#[tauri::command]
pub fn cmd_save_claudemd(file_path: String, content: String) -> Result<(), String> {
    save_claudemd(Path::new(&file_path), &content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn get_missing_claudemd_returns_empty() {
        let dir = tempdir().unwrap();
        let f = get_claudemd(dir.path()).unwrap();
        assert!(!f.exists);
        assert!(f.content.is_empty());
    }

    #[test]
    fn save_and_reload_claudemd() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("CLAUDE.md");
        save_claudemd(&path, "# Hello").unwrap();
        let f = get_claudemd(dir.path()).unwrap();
        assert!(f.exists);
        assert_eq!(f.content, "# Hello");
    }
}
