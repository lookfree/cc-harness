use git2::Repository;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub is_main: bool,
    pub is_locked: bool,
}

pub fn list_worktrees(repo_path: &str) -> Result<Vec<WorktreeInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let mut result = vec![];

    // Main worktree
    let main_path = repo
        .workdir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| repo_path.to_string());
    let main_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "HEAD".into());
    result.push(WorktreeInfo {
        path: main_path,
        branch: main_branch,
        is_main: true,
        is_locked: false,
    });

    // Linked worktrees via gitdir files in .git/worktrees/
    let worktrees_meta_dir = repo.path().join("worktrees");
    if worktrees_meta_dir.exists() {
        for entry in std::fs::read_dir(&worktrees_meta_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let gitdir_file = entry.path().join("gitdir");
            let head_file = entry.path().join("HEAD");
            let locked = entry.path().join("locked").exists();
            if gitdir_file.exists() && head_file.exists() {
                let head_content = std::fs::read_to_string(&head_file).unwrap_or_default();
                let branch = if let Some(stripped) =
                    head_content.strip_prefix("ref: refs/heads/")
                {
                    stripped.trim().to_string()
                } else {
                    head_content.trim()[..7.min(head_content.trim().len())].to_string()
                };
                // wt path is stored in gitdir (path of the worktree's .git file)
                let gitdir_content =
                    std::fs::read_to_string(&gitdir_file).unwrap_or_default();
                let wt_path = std::path::Path::new(gitdir_content.trim())
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                result.push(WorktreeInfo {
                    path: wt_path,
                    branch,
                    is_main: false,
                    is_locked: locked,
                });
            }
        }
    }
    Ok(result)
}

pub fn add_worktree(
    repo_path: &str,
    branch: &str,
    path: &str,
    new_branch: bool,
) -> Result<WorktreeInfo, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    // Resolve actual target path
    let wt_path = if path.is_empty() {
        let workdir = repo.workdir().ok_or("bare repo not supported")?;
        workdir
            .join(".worktrees")
            .join(branch)
            .to_string_lossy()
            .to_string()
    } else {
        path.to_string()
    };

    if new_branch {
        // Create a new branch, then add the worktree pointing at that branch.
        let head = repo.head().map_err(|e| e.to_string())?;
        let commit = repo
            .find_commit(head.target().ok_or("no HEAD")?)
            .map_err(|e| e.to_string())?;
        let git_branch = repo
            .branch(branch, &commit, false)
            .map_err(|e| e.to_string())?;
        // Use WorktreeAddOptions to point the worktree HEAD at the existing branch reference
        let branch_ref = git_branch.into_reference();
        let mut opts = git2::WorktreeAddOptions::new();
        opts.reference(Some(&branch_ref));
        repo.worktree(branch, std::path::Path::new(&wt_path), Some(&opts))
            .map_err(|e| e.to_string())?;
    } else {
        // Add worktree for an existing branch via libgit2; checkout_existing
        let mut opts = git2::WorktreeAddOptions::new();
        opts.checkout_existing(true);
        repo.worktree(branch, std::path::Path::new(&wt_path), Some(&opts))
            .map_err(|e| e.to_string())?;
    }

    Ok(WorktreeInfo {
        path: wt_path,
        branch: branch.to_string(),
        is_main: false,
        is_locked: false,
    })
}

pub fn remove_worktree(
    repo_path: &str,
    worktree_path: &str,
    force: bool,
) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    // Find worktree name by matching path
    let wts_meta = repo.path().join("worktrees");
    let mut wt_name = None;
    if wts_meta.exists() {
        for entry in std::fs::read_dir(&wts_meta)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let gitdir_file = entry.path().join("gitdir");
            if gitdir_file.exists() {
                let content =
                    std::fs::read_to_string(&gitdir_file).unwrap_or_default();
                let p = std::path::Path::new(content.trim())
                    .parent()
                    .map(|x| x.to_string_lossy().to_string())
                    .unwrap_or_default();
                if p == worktree_path {
                    wt_name = Some(entry.file_name().to_string_lossy().to_string());
                    break;
                }
            }
        }
    }
    let name =
        wt_name.ok_or_else(|| format!("worktree not found: {}", worktree_path))?;
    let wt = repo.find_worktree(&name).map_err(|e| e.to_string())?;
    let mut prune_opts = git2::WorktreePruneOptions::new();
    if force {
        prune_opts.valid(true);
    }
    wt.prune(Some(&mut prune_opts))
        .map_err(|e| e.to_string())?;
    // Also remove the directory
    if std::path::Path::new(worktree_path).exists() {
        std::fs::remove_dir_all(worktree_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    list_worktrees(&repo_path)
}
#[tauri::command]
pub fn cmd_add_worktree(
    repo_path: String,
    branch: String,
    path: String,
    new_branch: bool,
) -> Result<WorktreeInfo, String> {
    add_worktree(&repo_path, &branch, &path, new_branch)
}
#[tauri::command]
pub fn cmd_remove_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    remove_worktree(&repo_path, &worktree_path, force)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn init_repo_with_commit(path: &std::path::Path) -> git2::Repository {
        let repo = git2::Repository::init(path).unwrap();
        {
            let mut cfg = repo.config().unwrap();
            cfg.set_str("user.name", "Test").unwrap();
            cfg.set_str("user.email", "t@t.com").unwrap();
        }
        let sig = git2::Signature::now("Test", "t@t.com").unwrap();
        let tree_id = repo.index().unwrap().write_tree().unwrap();
        {
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .unwrap();
        }
        repo
    }

    #[test]
    fn list_worktrees_main_only() {
        let dir = tempdir().unwrap();
        let _repo = init_repo_with_commit(dir.path());
        let wts = list_worktrees(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(wts.len(), 1);
        assert!(wts[0].is_main);
    }

    #[test]
    fn add_and_list_worktree() {
        let dir = tempdir().unwrap();
        let _repo = init_repo_with_commit(dir.path());
        let wt_path = dir
            .path()
            .join("wt-feature")
            .to_string_lossy()
            .to_string();
        add_worktree(dir.path().to_str().unwrap(), "feature", &wt_path, true).unwrap();
        let wts = list_worktrees(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(wts.len(), 2);
        assert!(wts.iter().any(|w| w.branch == "feature"));
    }
}
