// forge/src-tauri/src/commands/usage/parser.rs
use serde_json::Value;
use std::path::Path;

/// 单条已解析会话（聚合自一个 .jsonl 文件）
#[derive(Debug, Clone)]
pub struct ParsedSession {
    pub session_id: String,
    pub working_dir: String,
    pub started_at: Option<i64>,   // Unix 秒
    pub ended_at: Option<i64>,
    pub model: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
    pub source_path: String,       // .jsonl 绝对路径
}

/// 定价表 (model_id_prefix, input_per_1k_usd, output_per_1k_usd)
const PRICING: &[(&str, f64, f64)] = &[
    ("claude-sonnet-4-5", 0.003,  0.015),
    ("claude-sonnet-4-7", 0.003,  0.015),
    ("claude-fable-5",    0.003,  0.015),
    ("claude-opus-4",     0.015,  0.075),
    ("claude-haiku-4-5",  0.0008, 0.004),
    ("gpt-4o-mini",       0.00015, 0.0006),
    ("gpt-4o",            0.005,  0.015),
];

pub fn estimate_cost(model: &str, input_tokens: i64, output_tokens: i64) -> f64 {
    for (prefix, inp_price, out_price) in PRICING {
        if model.starts_with(prefix) {
            return (input_tokens as f64 / 1000.0) * inp_price
                 + (output_tokens as f64 / 1000.0) * out_price;
        }
    }
    0.0
}

/// Parse ISO 8601 timestamp string to Unix seconds (UTC).
fn parse_ts(ts: &str) -> Option<i64> {
    // 2026-06-10T15:38:27.729Z  or  2026-06-10T15:38:27Z
    // Strip any trailing 'Z'
    let s = ts.trim_end_matches('Z');
    // Split at 'T'
    let parts: Vec<&str> = s.splitn(2, 'T').collect();
    if parts.len() != 2 { return None; }
    let date_parts: Vec<u64> = parts[0].split('-').filter_map(|x| x.parse().ok()).collect();
    let time_parts: Vec<u64> = parts[1].split(':').filter_map(|x|
        x.split('.').next().and_then(|n| n.parse().ok())
    ).collect();
    if date_parts.len() < 3 || time_parts.len() < 3 { return None; }
    let y = date_parts[0];
    let m = date_parts[1];
    let d = date_parts[2];
    let days = days_since_epoch(y, m, d)?;
    let secs = days * 86400
        + time_parts[0] * 3600
        + time_parts[1] * 60
        + time_parts[2];
    Some(secs as i64)
}

fn days_since_epoch(y: u64, m: u64, d: u64) -> Option<u64> {
    // Days since 1970-01-01 using standard formula
    let y = y as i64;
    let m = m as i64;
    let d = d as i64;
    let m_adj = (m + 9) % 12;
    let y_adj = y - m_adj / 10;
    let days = 365 * y_adj + y_adj / 4 - y_adj / 100 + y_adj / 400
        + (m_adj * 306 + 5) / 10 + (d - 1)
        - 719468; // offset to Unix epoch
    if days < 0 { None } else { Some(days as u64) }
}

pub fn parse_session_file(path: &Path) -> Result<ParsedSession, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();
    let source_path = path.to_string_lossy().to_string();

    let mut working_dir: Option<String> = None;
    let mut model: Option<String> = None;
    let mut started_at: Option<i64> = None;
    let mut ended_at: Option<i64> = None;
    let mut total_input: i64 = 0;
    let mut total_output: i64 = 0;

    for (line_no, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let obj: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[WARN] {}:{}: skip bad JSON: {}", source_path, line_no + 1, e);
                continue;
            }
        };

        if obj.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }

        // cwd
        if working_dir.is_none() {
            if let Some(cwd) = obj.get("cwd").and_then(|v| v.as_str()) {
                working_dir = Some(cwd.to_string());
            }
        }

        // timestamp
        if let Some(ts_str) = obj.get("timestamp").and_then(|v| v.as_str()) {
            if let Some(ts) = parse_ts(ts_str) {
                if started_at.is_none() { started_at = Some(ts); }
                ended_at = Some(ts);
            }
        }

        // usage
        let msg = match obj.get("message") { Some(m) => m, None => continue };
        if model.is_none() {
            if let Some(m) = msg.get("model").and_then(|v| v.as_str()) {
                model = Some(m.to_string());
            }
        }
        if let Some(usage) = msg.get("usage") {
            total_input  += usage.get("input_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
            total_output += usage.get("output_tokens").and_then(|v| v.as_i64()).unwrap_or(0);
        }
    }

    if total_input == 0 && total_output == 0 && started_at.is_none() {
        return Err(format!("no assistant lines in {}", source_path));
    }

    let cost = model.as_deref()
        .map(|m| estimate_cost(m, total_input, total_output))
        .unwrap_or(0.0);

    Ok(ParsedSession {
        session_id,
        working_dir: working_dir.unwrap_or_default(),
        started_at,
        ended_at,
        model,
        input_tokens: total_input,
        output_tokens: total_output,
        cost_usd: cost,
        source_path,
    })
}

/// 遍历 base_dir 下的所有 .jsonl 文件（递归两层：base_dir/<encoded-project>/*.jsonl）
pub fn walk_claude_sessions(base_dir: &Path) -> Vec<ParsedSession> {
    let mut results = Vec::new();
    let Ok(entries) = std::fs::read_dir(base_dir) else { return results; };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let Ok(sub_entries) = std::fs::read_dir(&path) else { continue; };
            for sub_entry in sub_entries.flatten() {
                let sub_path = sub_entry.path();
                if sub_path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                    match parse_session_file(&sub_path) {
                        Ok(s) => results.push(s),
                        Err(e) => eprintln!("[WARN] skip {}: {}", sub_path.display(), e),
                    }
                }
            }
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            match parse_session_file(&path) {
                Ok(s) => results.push(s),
                Err(e) => eprintln!("[WARN] skip {}: {}", path.display(), e),
            }
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    // Minimal fixture matching real schema
    fn write_fixture(lines: &[&str]) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        for line in lines {
            writeln!(f, "{}", line).unwrap();
        }
        f
    }

    const LINE_NON_ASSISTANT: &str = r#"{"type":"mode","mode":"normal","sessionId":"abc-123"}"#;

    const LINE_ASSISTANT_1: &str = r#"{"type":"assistant","sessionId":"abc-123","timestamp":"2026-06-10T10:00:00.000Z","cwd":"/Users/test/projects/foo","message":{"role":"assistant","model":"claude-sonnet-4-5","stop_reason":"end_turn","usage":{"input_tokens":1000,"output_tokens":200,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}"#;

    const LINE_ASSISTANT_2: &str = r#"{"type":"assistant","sessionId":"abc-123","timestamp":"2026-06-10T11:30:00.000Z","cwd":"/Users/test/projects/foo","message":{"role":"assistant","model":"claude-sonnet-4-5","stop_reason":"end_turn","usage":{"input_tokens":2000,"output_tokens":400,"cache_creation_input_tokens":100,"cache_read_input_tokens":500}}}"#;

    const LINE_BAD_JSON: &str = r#"{bad json!!!"#;

    #[test]
    fn parse_aggregates_tokens() {
        let f = write_fixture(&[LINE_NON_ASSISTANT, LINE_ASSISTANT_1, LINE_ASSISTANT_2]);
        let result = parse_session_file(f.path()).unwrap();
        assert_eq!(result.input_tokens, 3000);
        assert_eq!(result.output_tokens, 600);
        assert_eq!(result.model, Some("claude-sonnet-4-5".to_string()));
        assert_eq!(result.working_dir, "/Users/test/projects/foo");
    }

    #[test]
    fn parse_timestamps() {
        let f = write_fixture(&[LINE_ASSISTANT_1, LINE_ASSISTANT_2]);
        let result = parse_session_file(f.path()).unwrap();
        let started = result.started_at.unwrap();
        let ended   = result.ended_at.unwrap();
        assert!(started < ended, "started={started} ended={ended}");
        // 2026-06-10T10:00:00Z → approx 1749549600
        assert!(started > 1_700_000_000);
    }

    #[test]
    fn tolerates_bad_json_lines() {
        let f = write_fixture(&[LINE_BAD_JSON, LINE_ASSISTANT_1]);
        let result = parse_session_file(f.path()).unwrap();
        assert_eq!(result.input_tokens, 1000);
    }

    #[test]
    fn empty_file_returns_error() {
        let f = write_fixture(&[]);
        assert!(parse_session_file(f.path()).is_err());
    }

    #[test]
    fn estimate_cost_known_model() {
        // claude-sonnet-4-5: 0.003 per 1k input, 0.015 per 1k output
        let cost = estimate_cost("claude-sonnet-4-5", 1000, 1000);
        assert!((cost - 0.018).abs() < 0.0001);
    }

    #[test]
    fn estimate_cost_unknown_model_zero() {
        let cost = estimate_cost("unknown-model-xyz", 9999, 9999);
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn walk_finds_jsonl_files() {
        let dir = tempfile::tempdir().unwrap();
        let subdir = dir.path().join("project-a");
        std::fs::create_dir_all(&subdir).unwrap();
        let fpath = subdir.join("session-xyz.jsonl");
        std::fs::write(&fpath, format!("{}\n{}\n", LINE_ASSISTANT_1, LINE_ASSISTANT_2)).unwrap();

        let sessions = walk_claude_sessions(dir.path());
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].input_tokens, 3000);
    }
}
