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

/// An entry discovered by the multi-root CLAUDE.md scanner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeMdEntry {
    pub path: String,
    pub project_name: String,
    pub location: String,
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

/// Directories to skip when scanning for CLAUDE.md files.
const SKIP_DIRS: &[&str] = &["node_modules", ".git", "target", ".cache", "dist", "build"];
const MAX_SCAN_DEPTH: usize = 3;

/// Recursively walk `dir` up to `depth` levels, collecting CLAUDE.md paths.
/// Skips SKIP_DIRS. Does NOT follow symlinks.
fn walk_for_claudemd(dir: &Path, depth: usize, results: &mut Vec<ClaudeMdEntry>) {
    if depth == 0 { return; }
    let entries = match fs::read_dir(dir) { Ok(e) => e, Err(_) => return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Skip hidden dirs and known heavy dirs
        if SKIP_DIRS.contains(&name.as_str()) { continue; }
        let meta = match fs::symlink_metadata(&path) { Ok(m) => m, Err(_) => continue };
        // Don't follow symlinks
        if meta.is_symlink() { continue; }
        if meta.is_dir() {
            // Check if CLAUDE.md exists directly inside
            let claude_path = path.join("CLAUDE.md");
            if claude_path.is_file() {
                let project_name = name.clone();
                results.push(ClaudeMdEntry {
                    path: claude_path.to_string_lossy().to_string(),
                    project_name,
                    location: "project".to_string(),
                });
            }
            // Recurse deeper
            walk_for_claudemd(&path, depth - 1, results);
        }
    }
}

/// Discover CLAUDE.md files under the given roots, up to depth 3.
/// Skips node_modules, .git, target.
pub fn discover_claudemd(roots: &[PathBuf]) -> Vec<ClaudeMdEntry> {
    let mut results = vec![];
    let mut seen = std::collections::HashSet::new();
    for root in roots {
        if !root.is_dir() { continue; }
        walk_for_claudemd(root, MAX_SCAN_DEPTH, &mut results);
    }
    // Deduplicate by path
    results.retain(|e| seen.insert(e.path.clone()));
    results
}

/// Default roots for discovery: ~/Documents, ~/Projects, ~/projects, ~/dev, ~/code, ~/work, ~/src, ~
fn default_roots() -> Vec<PathBuf> {
    let home = match dirs::home_dir() { Some(h) => h, None => return vec![] };
    let subdirs = &["Documents", "Projects", "projects", "dev", "code", "work", "src"];
    let mut roots: Vec<PathBuf> = subdirs.iter().map(|s| home.join(s)).collect();
    roots.push(home);
    roots
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

/// Discover CLAUDE.md files across default roots.
/// Optional roots parameter for testability (Vec<String> of directory paths).
#[tauri::command]
pub fn cmd_discover_claudemd(roots: Option<Vec<String>>) -> Vec<ClaudeMdEntry> {
    let paths: Vec<PathBuf> = match roots {
        Some(r) => r.into_iter().map(PathBuf::from).collect(),
        None => default_roots(),
    };
    discover_claudemd(&paths)
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

    // A6 tests
    #[test]
    fn a6_discover_finds_nested_project() {
        let root = tempdir().unwrap();
        // root/myproject/CLAUDE.md
        let proj_dir = root.path().join("myproject");
        fs::create_dir_all(&proj_dir).unwrap();
        fs::write(proj_dir.join("CLAUDE.md"), "# MyProject").unwrap();

        let entries = discover_claudemd(&[root.path().to_path_buf()]);
        assert!(!entries.is_empty(), "should find myproject/CLAUDE.md");
        let found = entries.iter().find(|e| e.project_name == "myproject");
        assert!(found.is_some());
        assert_eq!(found.unwrap().location, "project");
    }

    #[test]
    fn a6_discover_excludes_node_modules() {
        let root = tempdir().unwrap();
        let nm = root.path().join("node_modules").join("some-pkg");
        fs::create_dir_all(&nm).unwrap();
        fs::write(nm.join("CLAUDE.md"), "# ignore me").unwrap();

        let entries = discover_claudemd(&[root.path().to_path_buf()]);
        let in_nm = entries.iter().any(|e| e.path.contains("node_modules"));
        assert!(!in_nm, "node_modules should be excluded");
    }

    #[test]
    fn a6_discover_excludes_depth_4() {
        let root = tempdir().unwrap();
        // depth 4 from root: root/a/b/c/d/CLAUDE.md
        let deep = root.path().join("a").join("b").join("c").join("d");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("CLAUDE.md"), "# too deep").unwrap();
        // depth 3 from root: root/a/b/c/CLAUDE.md — should be found
        let depth3 = root.path().join("a").join("b").join("c");
        fs::write(depth3.join("CLAUDE.md"), "# depth 3").unwrap();

        let entries = discover_claudemd(&[root.path().to_path_buf()]);
        // depth 3 (a/b/c) should be found
        let depth3_found = entries.iter().any(|e| e.project_name == "c");
        assert!(depth3_found, "depth-3 project should be found");
        // depth 4 (a/b/c/d) should NOT be found
        let depth4_found = entries.iter().any(|e| e.project_name == "d");
        assert!(!depth4_found, "depth-4 project should NOT be found");
    }

    #[test]
    fn a6_discover_multiple_roots() {
        let root1 = tempdir().unwrap();
        let root2 = tempdir().unwrap();
        let p1 = root1.path().join("proj1");
        fs::create_dir_all(&p1).unwrap();
        fs::write(p1.join("CLAUDE.md"), "# proj1").unwrap();
        let p2 = root2.path().join("proj2");
        fs::create_dir_all(&p2).unwrap();
        fs::write(p2.join("CLAUDE.md"), "# proj2").unwrap();

        let entries = discover_claudemd(&[root1.path().to_path_buf(), root2.path().to_path_buf()]);
        let names: Vec<&str> = entries.iter().map(|e| e.project_name.as_str()).collect();
        assert!(names.contains(&"proj1"));
        assert!(names.contains(&"proj2"));
    }
}
