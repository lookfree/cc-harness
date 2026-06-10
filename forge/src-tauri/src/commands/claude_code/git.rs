use git2::{BranchType, Repository, StatusOptions};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

pub fn git_status(repo_path: &str) -> Result<GitStatus, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("HEAD").to_string();

    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;

    let mut staged = vec![];
    let mut unstaged = vec![];
    let mut untracked = vec![];

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let s = entry.status();
        if s.contains(git2::Status::INDEX_NEW)
            || s.contains(git2::Status::INDEX_MODIFIED)
            || s.contains(git2::Status::INDEX_DELETED)
        {
            staged.push(path.clone());
        }
        if s.contains(git2::Status::WT_MODIFIED) || s.contains(git2::Status::WT_DELETED) {
            unstaged.push(path.clone());
        }
        if s.contains(git2::Status::WT_NEW) {
            untracked.push(path);
        }
    }

    // ahead/behind via revwalk against upstream
    let (ahead, behind) = repo
        .head()
        .ok()
        .and_then(|h| h.resolve().ok())
        .and_then(|h| h.target())
        .and_then(|local_oid| {
            let local_name = repo.head().ok()?.shorthand()?.to_string();
            let branch = repo.find_branch(&local_name, BranchType::Local).ok()?;
            let upstream = branch.upstream().ok()?;
            let upstream_oid = upstream.get().target()?;
            repo.graph_ahead_behind(local_oid, upstream_oid).ok()
        })
        .unwrap_or((0, 0));

    Ok(GitStatus {
        branch,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
    })
}

pub fn git_stage(repo_path: &str, paths: &[String]) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    for path in paths {
        index
            .add_path(std::path::Path::new(path))
            .map_err(|e| e.to_string())?;
    }
    index.write().map_err(|e| e.to_string())
}

pub fn git_commit(repo_path: &str, message: &str) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let sig = repo.signature().map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let parents: Vec<git2::Commit> = if let Ok(head) = repo.head() {
        vec![repo
            .find_commit(head.target().ok_or("no target")?)
            .map_err(|e| e.to_string())?]
    } else {
        vec![]
    };

    // Guard: if there is a parent commit, check that the new tree differs from HEAD.
    // This prevents creating a silent empty commit when nothing is staged.
    if let Some(parent) = parents.first() {
        if parent.tree_id() == tree_id {
            return Err("nothing staged to commit".into());
        }
    }

    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
        .map_err(|e| e.to_string())?;
    Ok(oid.to_string())
}

pub fn git_push(repo_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let branch_name = head.shorthand().ok_or("no branch name")?.to_string();
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    let refspec = format!(
        "refs/heads/{}:refs/heads/{}",
        branch_name, branch_name
    );

    let mut callbacks = git2::RemoteCallbacks::new();
    // Attempt ssh-agent auth first, fall back to default key files
    callbacks.credentials(|_url, username_from_url, _allowed_types| {
        let user = username_from_url.unwrap_or("git");
        git2::Cred::ssh_key_from_agent(user)
    });

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);
    remote
        .push(&[refspec.as_str()], Some(&mut push_opts))
        .map_err(|e| format!("push failed: {}", e))
}

pub fn git_branches(repo_path: &str) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));
    let mut result = vec![];
    for branch in repo.branches(None).map_err(|e| e.to_string())? {
        let (branch, branch_type) = branch.map_err(|e| e.to_string())?;
        let name = branch
            .name()
            .map_err(|e| e.to_string())?
            .unwrap_or("")
            .to_string();
        let is_remote = branch_type == BranchType::Remote;
        let is_current = head_name.as_deref() == Some(&name);
        let upstream = if !is_remote {
            branch
                .upstream()
                .ok()
                .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()))
        } else {
            None
        };
        result.push(BranchInfo {
            name,
            is_current,
            is_remote,
            upstream,
        });
    }
    Ok(result)
}

pub fn git_checkout(repo_path: &str, branch: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let obj = repo
        .revparse_single(&format!("refs/heads/{}", branch))
        .map_err(|e| e.to_string())?;
    repo.checkout_tree(&obj, None)
        .map_err(|e| e.to_string())?;
    repo.set_head(&format!("refs/heads/{}", branch))
        .map_err(|e| e.to_string())
}

pub fn git_log(repo_path: &str, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_oid = head.target().ok_or("no head target")?;
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push(head_oid).map_err(|e| e.to_string())?;
    let mut commits = vec![];
    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let hash_str = oid.to_string();
        let short_hash = hash_str[..7.min(hash_str.len())].to_string();
        commits.push(CommitInfo {
            hash: hash_str,
            short_hash,
            message: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            timestamp: commit.author().when().seconds(),
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn cmd_git_status(repo_path: String) -> Result<GitStatus, String> {
    git_status(&repo_path)
}
#[tauri::command]
pub fn cmd_git_stage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    git_stage(&repo_path, &paths)
}
#[tauri::command]
pub fn cmd_git_commit(repo_path: String, message: String) -> Result<String, String> {
    git_commit(&repo_path, &message)
}
#[tauri::command]
pub fn cmd_git_push(repo_path: String) -> Result<(), String> {
    git_push(&repo_path)
}
#[tauri::command]
pub fn cmd_git_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    git_branches(&repo_path)
}
#[tauri::command]
pub fn cmd_git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    git_checkout(&repo_path, &branch)
}
#[tauri::command]
pub fn cmd_git_log(repo_path: String, limit: usize) -> Result<Vec<CommitInfo>, String> {
    git_log(&repo_path, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn init_repo(path: &std::path::Path) -> git2::Repository {
        let repo = git2::Repository::init(path).unwrap();
        let mut cfg = repo.config().unwrap();
        cfg.set_str("user.name", "Test").unwrap();
        cfg.set_str("user.email", "t@test.com").unwrap();
        repo
    }

    fn make_commit(repo: &git2::Repository, msg: &str) {
        let sig = git2::Signature::now("Test", "t@test.com").unwrap();
        let tree_id = {
            let mut idx = repo.index().unwrap();
            idx.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        let parents: Vec<git2::Commit> = if let Ok(head) = repo.head() {
            vec![repo.find_commit(head.target().unwrap()).unwrap()]
        } else {
            vec![]
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
            .unwrap();
    }

    #[test]
    fn git_status_on_clean_repo() {
        let dir = tempdir().unwrap();
        let repo = init_repo(dir.path());
        make_commit(&repo, "init");
        let status = git_status(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(status.branch, "master");
        assert!(status.staged.is_empty());
    }

    #[test]
    fn git_branches_returns_master() {
        let dir = tempdir().unwrap();
        let repo = init_repo(dir.path());
        make_commit(&repo, "init");
        let branches = git_branches(dir.path().to_str().unwrap()).unwrap();
        assert!(!branches.is_empty());
        assert!(branches
            .iter()
            .any(|b| b.name == "master" || b.name == "main"));
    }

    #[test]
    fn git_log_returns_one_commit() {
        let dir = tempdir().unwrap();
        let repo = init_repo(dir.path());
        make_commit(&repo, "initial commit");
        let log = git_log(dir.path().to_str().unwrap(), 10).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].message, "initial commit");
    }

    #[test]
    fn git_commit_rejects_nothing_staged() {
        let dir = tempdir().unwrap();
        let repo = init_repo(dir.path());
        // Create an initial commit so HEAD exists
        make_commit(&repo, "initial commit");
        // Attempt to commit again without staging anything
        let result = git_commit(dir.path().to_str().unwrap(), "empty commit");
        assert!(result.is_err(), "expected Err when nothing is staged");
        let err_msg = result.unwrap_err();
        assert!(
            err_msg.contains("nothing staged"),
            "unexpected error message: {err_msg}"
        );
    }

    #[test]
    fn git_commit_succeeds_with_staged_changes() {
        use std::fs as sfs;
        let dir = tempdir().unwrap();
        let repo = init_repo(dir.path());
        make_commit(&repo, "initial commit");
        // Write a file and stage it
        sfs::write(dir.path().join("hello.txt"), "hello").unwrap();
        git_stage(dir.path().to_str().unwrap(), &["hello.txt".to_string()]).unwrap();
        let result = git_commit(dir.path().to_str().unwrap(), "add hello");
        assert!(result.is_ok(), "commit with staged file should succeed");
    }
}
