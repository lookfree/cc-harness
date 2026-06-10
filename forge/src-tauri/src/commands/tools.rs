use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct ToolStatus {
    pub name: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

pub fn detect(name: &str) -> ToolStatus {
    match which::which(name) {
        Ok(p) => {
            let version = std::process::Command::new(&p)
                .arg("--version")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .and_then(|o| {
                    String::from_utf8(o.stdout)
                        .ok()
                        .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
                });
            ToolStatus {
                name: name.to_string(),
                installed: true,
                path: Some(p.to_string_lossy().to_string()),
                version,
            }
        }
        Err(_) => ToolStatus {
            name: name.to_string(),
            installed: false,
            path: None,
            version: None,
        },
    }
}

/// Tauri 命令：检测 claude / codex / git / node / npm
#[tauri::command]
pub fn detect_tools() -> Vec<ToolStatus> {
    ["claude", "codex", "git", "node", "npm"]
        .iter()
        .map(|n| detect(n))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_finds_sh() {
        let t = detect("sh"); // POSIX 系统必有
        assert!(t.installed);
        assert!(t.path.is_some());
    }

    #[test]
    fn detect_missing_tool() {
        let t = detect("definitely-not-installed-xyz-123");
        assert!(!t.installed);
        assert!(t.path.is_none());
        assert!(t.version.is_none());
    }
}
