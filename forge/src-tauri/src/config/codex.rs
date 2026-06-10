use std::path::{Path, PathBuf};
use toml::Table;

use super::atomic::write_atomic;

/// ~/.codex/config.toml 的默认路径
pub fn default_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex/config.toml"))
}

pub fn read_toml(path: &Path) -> Result<Table, String> {
    if !path.exists() {
        return Ok(Table::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    toml::from_str(&raw).map_err(|e| e.to_string())
}

pub fn merge_fields(path: &Path, updates: &Table) -> Result<(), String> {
    let mut doc = read_toml(path)?;
    for (k, v) in updates {
        doc.insert(k.clone(), v.clone());
    }
    let out = toml::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    write_atomic(path, &out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_missing_file_returns_empty_table() {
        let dir = tempfile::tempdir().unwrap();
        let t = read_toml(&dir.path().join("nope.toml")).unwrap();
        assert!(t.is_empty());
    }

    #[test]
    fn merge_preserves_unknown_sections() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "model = \"old\"\n\n[future_section]\na = 1\n").unwrap();
        let updates: Table = toml::from_str("model = \"new\"").unwrap();
        merge_fields(&path, &updates).unwrap();
        let doc = read_toml(&path).unwrap();
        assert_eq!(doc["model"].as_str(), Some("new"));
        assert_eq!(doc["future_section"]["a"].as_integer(), Some(1));
    }

    #[test]
    fn merge_creates_file_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        let updates: Table = toml::from_str("model = \"m\"").unwrap();
        merge_fields(&path, &updates).unwrap();
        assert_eq!(read_toml(&path).unwrap()["model"].as_str(), Some("m"));
    }
}
