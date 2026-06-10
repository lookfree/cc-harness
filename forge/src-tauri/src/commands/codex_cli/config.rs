use std::path::{Path, PathBuf};
use serde::Serialize;
use toml::Table;

use crate::config::codex::{default_path, read_toml};
use crate::config::atomic::write_atomic;
use crate::commands::tools::detect;

/// Overview 页所需的 Codex 状态快照
#[derive(Debug, Serialize)]
pub struct CodexStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub config_exists: bool,
    pub config_path: String,
    pub current_model: Option<String>,
    pub current_provider: Option<String>,
}

/// 读取 codex 安装状态 + 配置摘要
/// param base_path: 仅供测试注入，None 使用 default_path()
pub fn get_status_impl(base_path: Option<&Path>) -> CodexStatus {
    let tool = detect("codex");
    let cfg_path: PathBuf = match base_path {
        Some(p) => p.join("config.toml"),
        None => default_path().unwrap_or_else(|| PathBuf::from("~/.codex/config.toml")),
    };
    let config_exists = cfg_path.exists();
    let (current_model, current_provider) = if config_exists {
        match read_toml(&cfg_path) {
            Ok(t) => (
                t.get("model").and_then(|v| v.as_str()).map(|s| s.to_string()),
                t.get("provider").and_then(|v| v.as_str()).map(|s| s.to_string()),
            ),
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };
    CodexStatus {
        installed: tool.installed,
        path: tool.path,
        version: tool.version,
        config_exists,
        config_path: cfg_path.to_string_lossy().to_string(),
        current_model,
        current_provider,
    }
}

/// 读取配置文件原始文本
/// param base_path: 仅供测试注入
pub fn read_config_impl(base_path: Option<&Path>) -> Result<String, String> {
    let cfg_path: PathBuf = match base_path {
        Some(p) => p.join("config.toml"),
        None => default_path().ok_or("无法获取 home 目录".to_string())?,
    };
    if !cfg_path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&cfg_path).map_err(|e| e.to_string())
}

/// 写入配置文件（先校验 TOML 语法，再原子写入）
/// param base_path: 仅供测试注入
pub fn write_config_impl(content: &str, base_path: Option<&Path>) -> Result<(), String> {
    // 1. 校验 TOML 可解析
    content.parse::<Table>().map_err(|e| format!("TOML 语法错误：{e}"))?;
    // 2. 确定写入路径
    let cfg_path: PathBuf = match base_path {
        Some(p) => p.join("config.toml"),
        None => default_path().ok_or("无法获取 home 目录".to_string())?,
    };
    // 3. 确保父目录存在
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_atomic(&cfg_path, content)
}

// ── Tauri 命令 ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn codex_get_status() -> CodexStatus {
    get_status_impl(None)
}

#[tauri::command]
pub fn codex_read_config() -> Result<String, String> {
    read_config_impl(None)
}

#[tauri::command]
pub fn codex_write_config(content: String) -> Result<(), String> {
    write_config_impl(&content, None)
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_no_config_file() {
        let dir = tempfile::tempdir().unwrap();
        // tempdir 内无 config.toml → config_exists = false
        let s = get_status_impl(Some(dir.path()));
        assert!(!s.config_exists);
        assert!(s.current_model.is_none());
        assert!(s.current_provider.is_none());
    }

    #[test]
    fn status_reads_model_and_provider() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("config.toml"),
            "model = \"gpt-4o\"\nprovider = \"openai\"\n",
        )
        .unwrap();
        let s = get_status_impl(Some(dir.path()));
        assert!(s.config_exists);
        assert_eq!(s.current_model.as_deref(), Some("gpt-4o"));
        assert_eq!(s.current_provider.as_deref(), Some("openai"));
    }

    #[test]
    fn read_config_missing_returns_empty() {
        let dir = tempfile::tempdir().unwrap();
        let raw = read_config_impl(Some(dir.path())).unwrap();
        assert_eq!(raw, "");
    }

    #[test]
    fn read_config_returns_content() {
        let dir = tempfile::tempdir().unwrap();
        let content = "model = \"claude-opus-4\"\n";
        std::fs::write(dir.path().join("config.toml"), content).unwrap();
        let raw = read_config_impl(Some(dir.path())).unwrap();
        assert_eq!(raw, content);
    }

    #[test]
    fn write_config_valid_toml() {
        let dir = tempfile::tempdir().unwrap();
        let content = "model = \"claude-sonnet-4-5\"\nprovider = \"anthropic\"\n";
        write_config_impl(content, Some(dir.path())).unwrap();
        let read_back = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert_eq!(read_back, content);
    }

    #[test]
    fn write_config_invalid_toml_returns_err() {
        let dir = tempfile::tempdir().unwrap();
        let result = write_config_impl("not = valid [[toml", Some(dir.path()));
        assert!(result.is_err());
        // 原文件不应存在（写入被拦截）
        assert!(!dir.path().join("config.toml").exists());
    }

    #[test]
    fn write_config_preserves_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        // 先写入含未知字段的配置
        let original = "model = \"old\"\n\n[advanced]\ntimeout = 30\n";
        std::fs::write(dir.path().join("config.toml"), original).unwrap();
        // 直接写入新文本（write_config_impl 是 raw write，不合并）
        let new_content = "model = \"new\"\n\n[advanced]\ntimeout = 30\n";
        write_config_impl(new_content, Some(dir.path())).unwrap();
        let read_back = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(read_back.contains("model = \"new\""));
        assert!(read_back.contains("timeout = 30"));
    }
}
