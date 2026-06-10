use serde_json::Value;
use std::path::{Path, PathBuf};

use super::atomic::write_atomic;

/// ~/.claude.json 的默认路径
pub fn default_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude.json"))
}

pub fn read_json(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Object(Default::default()));
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// 读取-修改-写回：只覆盖 updates 中的字段，未知字段原样保留（设计文档"兼容 Claude Code 快速迭代"）
pub fn merge_fields(path: &Path, updates: &Value) -> Result<(), String> {
    let mut doc = read_json(path)?;
    let obj = doc.as_object_mut().ok_or("root is not a JSON object")?;
    let upd = updates.as_object().ok_or("updates must be a JSON object")?;
    for (k, v) in upd {
        obj.insert(k.clone(), v.clone());
    }
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    write_atomic(path, &pretty)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn read_missing_file_returns_empty_object() {
        let dir = tempfile::tempdir().unwrap();
        let v = read_json(&dir.path().join("nope.json")).unwrap();
        assert_eq!(v, json!({}));
    }

    #[test]
    fn merge_preserves_unknown_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");
        std::fs::write(&path, r#"{"apiKey":"old","futureField":{"a":1}}"#).unwrap();
        merge_fields(&path, &json!({"apiKey": "new"})).unwrap();
        let doc = read_json(&path).unwrap();
        assert_eq!(doc["apiKey"], "new");
        assert_eq!(doc["futureField"]["a"], 1);
    }

    #[test]
    fn merge_creates_file_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude.json");
        merge_fields(&path, &json!({"apiKey": "k"})).unwrap();
        assert_eq!(read_json(&path).unwrap()["apiKey"], "k");
    }
}
