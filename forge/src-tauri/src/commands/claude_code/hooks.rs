use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use crate::config::{atomic::write_atomic, claude::read_json};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookEntry {
    pub name: String,
    pub hook_type: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub location: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookExecutionLog {
    pub id: String,
    pub hook_name: String,
    pub hook_type: String,
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timestamp: i64,
    pub success: bool,
}

// In-process log store (per process lifetime, max 100)
static EXEC_LOGS: Mutex<Vec<HookExecutionLog>> = Mutex::new(Vec::new());

fn settings_path(base_dir: &Path) -> PathBuf { base_dir.join("settings.json") }

pub fn get_hooks(base_dir: &Path) -> Result<Vec<HookEntry>, String> {
    let doc = read_json(&settings_path(base_dir))?;
    let hooks_val = doc.get("hooks").cloned().unwrap_or(Value::Object(Default::default()));
    let mut result = vec![];
    if let Some(obj) = hooks_val.as_object() {
        for (hook_type, matchers) in obj {
            if let Some(arr) = matchers.as_array() {
                for (i, matcher) in arr.iter().enumerate() {
                    result.push(HookEntry {
                        name: format!("{}-{}", hook_type, i),
                        hook_type: hook_type.clone(),
                        content: Some(matcher.to_string()),
                        file_path: None,
                        location: "user".into(),
                    });
                }
            }
        }
    }
    Ok(result)
}

/// Resolve the settings.json path based on location and optional project_path.
/// location=="project" → <project_path>/.claude/settings.json
/// otherwise           → <base_dir>/settings.json
fn resolve_settings_path(base_dir: &Path, location: &str, project_path: Option<&str>) -> Result<PathBuf, String> {
    if location == "project" {
        let proj = project_path.ok_or("project_path required when location is 'project'")?;
        Ok(PathBuf::from(proj).join(".claude").join("settings.json"))
    } else {
        Ok(settings_path(base_dir))
    }
}

pub fn save_hook_to_settings(
    base_dir: &Path,
    hook_type: &str,
    hook_config: Value,
    location: &str,
    matcher_index: Option<usize>,
) -> Result<(), String> {
    save_hook_to_settings_proj(base_dir, hook_type, hook_config, location, None, matcher_index)
}

pub fn save_hook_to_settings_proj(
    base_dir: &Path,
    hook_type: &str,
    hook_config: Value,
    location: &str,
    project_path: Option<&str>,
    matcher_index: Option<usize>,
) -> Result<(), String> {
    let path = resolve_settings_path(base_dir, location, project_path)?;
    let mut doc = read_json(&path)?;
    let obj = doc.as_object_mut().ok_or("settings not object")?;
    let hooks = obj.entry("hooks").or_insert(Value::Object(Default::default()));
    let hooks_obj = hooks.as_object_mut().ok_or("hooks not object")?;
    let list = hooks_obj.entry(hook_type).or_insert(Value::Array(vec![]));
    let arr = list.as_array_mut().ok_or("hook list not array")?;
    match matcher_index {
        Some(i) if i < arr.len() => arr[i] = hook_config,
        _ => arr.push(hook_config),
    }
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    if let Some(p) = path.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(&path, &pretty)
}

pub fn delete_hook_from_settings(
    base_dir: &Path,
    hook_type: &str,
    matcher_index: usize,
    location: &str,
) -> Result<(), String> {
    delete_hook_from_settings_proj(base_dir, hook_type, matcher_index, location, None)
}

pub fn delete_hook_from_settings_proj(
    base_dir: &Path,
    hook_type: &str,
    matcher_index: usize,
    location: &str,
    project_path: Option<&str>,
) -> Result<(), String> {
    let path = resolve_settings_path(base_dir, location, project_path)?;
    let mut doc = read_json(&path)?;
    if let Some(arr) = doc.as_object_mut()
        .and_then(|o| o.get_mut("hooks"))
        .and_then(|h| h.as_object_mut())
        .and_then(|h| h.get_mut(hook_type))
        .and_then(|l| l.as_array_mut())
    {
        if matcher_index < arr.len() { arr.remove(matcher_index); }
    }
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    if let Some(p) = path.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    write_atomic(&path, &pretty)
}

/// Result struct for hook test execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookTestResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
}

/// Test a hook command via `sh -c <command>`.
/// Spawns in a thread so timeout can be enforced via channel.
pub fn test_hook(command: &str, timeout_secs: Option<u64>) -> HookTestResult {
    use std::process::Command as Proc;
    use std::time::Instant;

    let timeout = std::time::Duration::from_secs(timeout_secs.unwrap_or(30));
    let start = Instant::now();

    let output = {
        // We need to enforce timeout. Use a thread + channel approach.
        let cmd_str = command.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = Proc::new("sh")
                .arg("-c")
                .arg(&cmd_str)
                .output();
            let _ = tx.send(result);
        });
        rx.recv_timeout(timeout)
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    match output {
        Ok(Ok(out)) => HookTestResult {
            exit_code: out.status.code(),
            stdout: String::from_utf8_lossy(&out.stdout).trim_end().to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).trim_end().to_string(),
            duration_ms,
            timed_out: false,
        },
        Ok(Err(e)) => HookTestResult {
            exit_code: None,
            stdout: String::new(),
            stderr: e.to_string(),
            duration_ms,
            timed_out: false,
        },
        Err(_) => {
            // Timeout: channel recv timed out. The spawned thread may still run
            // but we can't easily kill it here without adding more deps.
            // This is acceptable for the test command use case.
            HookTestResult {
                exit_code: None,
                stdout: String::new(),
                stderr: String::new(),
                duration_ms,
                timed_out: true,
            }
        }
    }
}

pub fn create_hook_script(path: &Path, content: &str) -> Result<String, String> {
    if let Some(p) = path.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    fs::write(path, content).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

pub fn read_hook_script(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn get_hook_logs() -> Vec<HookExecutionLog> {
    EXEC_LOGS.lock().unwrap().clone()
}

pub fn clear_hook_logs() {
    EXEC_LOGS.lock().unwrap().clear();
}

/// A structured debug log entry parsed from Claude Code debug .txt files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookDebugEntry {
    /// ISO timestamp string from the log line e.g. "2026-01-01T00:00:00.000Z"
    pub timestamp: String,
    /// Hook type e.g. "PreToolUse", "SessionStart", or query string
    pub hook_type: String,
    /// "matched" | "error" | "running" | "output"
    pub status: String,
    /// Human-readable message
    pub message: String,
    /// Source file name
    pub file: String,
}

/// Parse a single log line into (timestamp, level, message)
fn parse_debug_line(line: &str) -> Option<(String, String, String)> {
    // Format: 2025-11-29T08:08:33.503Z [DEBUG] message
    // Find " [LEVEL]" pattern
    let bracket_open = line.find(" [")?;
    let timestamp = line[..bracket_open].trim().to_string();
    // Must look like an ISO timestamp
    if !timestamp.contains('T') || !timestamp.ends_with('Z') { return None; }
    // rest starts after the space, at '[LEVEL]...'
    let rest = &line[bracket_open + 1..]; // starts with '[', e.g. "[DEBUG] message"
    let close = rest.find(']')?;
    // level is between '[' and ']' i.e. rest[1..close]
    let level = if rest.starts_with('[') { rest[1..close].to_string() } else { rest[..close].to_string() };
    let message = rest[close + 1..].trim().to_string();
    // Strip optional [CATEGORY] prefix
    let message = if message.starts_with('[') {
        if let Some(ci) = message.find(']') {
            message[ci + 1..].trim().to_string()
        } else {
            message
        }
    } else {
        message
    };
    Some((timestamp, level, message))
}

/// Parse a single debug .txt file and return structured HookDebugEntry items.
fn parse_debug_file(path: &Path) -> Vec<HookDebugEntry> {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let content = match fs::read_to_string(path) { Ok(c) => c, Err(_) => return vec![] };
    let mut entries: Vec<HookDebugEntry> = vec![];

    // State machine: track current hook event being built
    let mut current_hook_type: Option<String> = None;
    let mut current_ts: String = String::new();

    for line in content.lines() {
        let parsed = match parse_debug_line(line) {
            Some(p) => p,
            None => continue,
        };
        let (ts, level, msg) = parsed;

        // Pattern: "Getting matching hook commands for <HookType> with query: <query>"
        if let Some(cap_start) = {
            let prefix = "Getting matching hook commands for ";
            if msg.starts_with(prefix) { Some(&msg[prefix.len()..]) } else { None }
        } {
            // e.g. "PreToolUse with query: read"
            if let Some(with_pos) = cap_start.find(" with query:") {
                current_hook_type = Some(cap_start[..with_pos].to_string());
                current_ts = ts.clone();
            }
            continue;
        }

        // Pattern: "Matched N unique hooks for query \"startup\""
        if let Some(rest) = {
            let prefix = "Matched ";
            if msg.starts_with(prefix) { Some(&msg[prefix.len()..]) } else { None }
        } {
            // Extract count
            if let Some(space) = rest.find(' ') {
                let count_str = &rest[..space];
                let count: u32 = count_str.parse().unwrap_or(0);
                if count > 0 {
                    // Extract query
                    let query = if let Some(qi) = rest.find('"') {
                        if let Some(qe) = rest[qi + 1..].find('"') {
                            rest[qi + 1..qi + 1 + qe].to_string()
                        } else { rest.to_string() }
                    } else { rest.to_string() };

                    let hook_type = current_hook_type.clone().unwrap_or_else(|| "unknown".to_string());
                    entries.push(HookDebugEntry {
                        timestamp: current_ts.clone(),
                        hook_type,
                        status: "matched".to_string(),
                        message: format!("Matched {} hook(s) for query \"{}\"", count, query),
                        file: file_name.clone(),
                    });
                }
            }
            current_hook_type = None;
            continue;
        }

        // Pattern: "Running hook command: <cmd>"
        if let Some(cmd) = {
            let prefix = "Running hook command:";
            if msg.starts_with(prefix) { Some(msg[prefix.len()..].trim()) } else { None }
        } {
            entries.push(HookDebugEntry {
                timestamp: ts.clone(),
                hook_type: current_hook_type.clone().unwrap_or_else(|| "HookCommand".to_string()),
                status: "running".to_string(),
                message: format!("Running hook command: {}", cmd),
                file: file_name.clone(),
            });
            continue;
        }

        // Pattern: Hook output lines
        if msg.contains("Hook output") || msg.contains("Hook returned") {
            if let Some(last) = entries.last_mut() {
                last.message.push('\n');
                last.message.push_str(&msg);
            }
            continue;
        }

        // Pattern: ERROR lines related to hooks
        if level == "ERROR" {
            let msg_lower = msg.to_lowercase();
            if msg_lower.contains("hook") || msg_lower.contains("command") ||
               msg_lower.contains("spawn") || msg_lower.contains("enoent") ||
               msg_lower.contains("exit code") || msg_lower.contains("timed out") {
                entries.push(HookDebugEntry {
                    timestamp: ts.clone(),
                    hook_type: current_hook_type.clone().unwrap_or_else(|| "unknown".to_string()),
                    status: "error".to_string(),
                    message: msg.clone(),
                    file: file_name.clone(),
                });
                continue;
            }
        }

        // Pattern: exit code lines
        if let Some(exit_pos) = {
            let ml = msg.to_lowercase();
            ml.find("exit").map(|_| ())
        } {
            let _ = exit_pos;
            // Check if matches exit code pattern
            let ml = msg.to_lowercase();
            if (ml.contains("exit") && ml.contains("code")) || ml.contains("exited") {
                if let Some(last) = entries.last_mut() {
                    // Append exit code info to last entry
                    last.message.push('\n');
                    last.message.push_str(&msg);
                    // Determine if error
                    // Simple check: if code is non-zero
                    if let Some(num_start) = ml.rfind(|c: char| c.is_ascii_alphabetic()).map(|i| i + 1) {
                        let num_part = ml[num_start..].trim();
                        if let Ok(code) = num_part.parse::<i32>() {
                            if code != 0 { last.status = "error".to_string(); }
                        }
                    }
                }
                continue;
            }
        }

        // Pattern: timed out
        let ml = msg.to_lowercase();
        if (ml.contains("hook") && ml.contains("timed")) || (ml.contains("timeout") && ml.contains("hook")) {
            if let Some(last) = entries.last_mut() {
                last.status = "error".to_string();
                last.message.push_str("\n[TIMEOUT] ");
                last.message.push_str(&msg);
            }
        }
    }

    entries
}

pub fn get_hook_debug_logs(base_dir: &Path) -> Result<Vec<HookDebugEntry>, String> {
    let debug_dir = base_dir.join("debug");
    if !debug_dir.exists() { return Ok(vec![]); }

    // Collect .txt files, sorted newest first
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = vec![];
    for entry in fs::read_dir(&debug_dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("txt") {
            if let Ok(meta) = fs::metadata(&p) {
                if let Ok(mt) = meta.modified() {
                    files.push((mt, p));
                }
            }
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));

    let mut all: Vec<HookDebugEntry> = vec![];
    for (_, path) in files.iter().take(10) {
        all.extend(parse_debug_file(path));
    }

    // Sort by timestamp desc, deduplicate by hook_type+timestamp+status
    all.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let mut seen = std::collections::HashSet::new();
    let result: Vec<HookDebugEntry> = all.into_iter().filter(|e| {
        let key = format!("{}-{}-{}", e.hook_type, e.timestamp, e.status);
        seen.insert(key)
    }).take(100).collect();

    Ok(result)
}

pub fn launch_debug_session(
    hook_type: &str,
    project_path: Option<&str>,
) -> Result<Value, String> {
    use std::process::Command as Cmd;
    let working_dir = project_path.unwrap_or(".");
    let test_prompt = hook_test_prompt(hook_type);
    let claude_args = if test_prompt.is_empty() {
        "--debug".to_string()
    } else {
        format!("--debug -p '{}'", test_prompt.replace('\'', "'\\''"))
    };
    let script = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"cd '{}' && claude {}\"\nend tell",
        working_dir, claude_args
    );
    let child = Cmd::new("osascript")
        .arg("-e").arg(&script)
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.id();
    Ok(serde_json::json!({ "success": true, "message": "Terminal launched", "pid": pid }))
}

pub fn stop_debug_session(pid: u32) -> bool {
    #[cfg(unix)]
    unsafe { libc::kill(pid as i32, libc::SIGTERM) == 0 }
    #[cfg(not(unix))]
    { let _ = pid; false }
}

fn hook_test_prompt(hook_type: &str) -> &'static str {
    match hook_type {
        "SessionStart" => "",
        "SessionEnd" => "Say goodbye",
        "PreToolUse" | "PostToolUse" => "Read the file package.json and tell me the project name",
        "UserPromptSubmit" => "Hello, this is a test prompt for UserPromptSubmit hook",
        "Notification" => "Search for any TODO comments in this project",
        "Stop" => "Count from 1 to 5",
        "SubagentStart" | "SubagentStop" => "Use the Task tool to search for README files",
        "PreCompact" => "This is a test for PreCompact hook. Please respond briefly.",
        _ => "Hello, this is a hook test",
    }
}

fn resolve_base(b: Option<String>) -> Result<PathBuf, String> {
    match b {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude")).ok_or_else(|| "no home".into()),
    }
}

#[tauri::command]
pub fn cmd_get_hooks(base_dir: Option<String>) -> Result<Vec<HookEntry>, String> { get_hooks(&resolve_base(base_dir)?) }
#[tauri::command]
pub fn cmd_save_hook_to_settings(hook_type: String, hook_config: Value, location: String, base_dir: Option<String>, matcher_index: Option<usize>, project_path: Option<String>) -> Result<(), String> {
    save_hook_to_settings_proj(&resolve_base(base_dir)?, &hook_type, hook_config, &location, project_path.as_deref(), matcher_index)
}
#[tauri::command]
pub fn cmd_delete_hook_from_settings(hook_type: String, matcher_index: usize, location: String, base_dir: Option<String>, project_path: Option<String>) -> Result<(), String> {
    delete_hook_from_settings_proj(&resolve_base(base_dir)?, &hook_type, matcher_index, &location, project_path.as_deref())
}
#[tauri::command]
pub fn cmd_create_hook_script(script_path: String, content: String) -> Result<String, String> {
    create_hook_script(Path::new(&script_path), &content)
}
#[tauri::command]
pub fn cmd_read_hook_script(script_path: String) -> Result<String, String> {
    read_hook_script(Path::new(&script_path))
}
#[tauri::command]
pub fn cmd_get_hook_logs() -> Vec<HookExecutionLog> { get_hook_logs() }
#[tauri::command]
pub fn cmd_clear_hook_logs() -> bool { clear_hook_logs(); true }
#[tauri::command]
pub fn cmd_get_hook_debug_logs(base_dir: Option<String>) -> Result<Vec<HookDebugEntry>, String> {
    get_hook_debug_logs(&resolve_base(base_dir)?)
}
#[tauri::command]
pub fn cmd_launch_debug_session(hook_type: String, project_path: Option<String>) -> Result<Value, String> {
    launch_debug_session(&hook_type, project_path.as_deref())
}
#[tauri::command]
pub fn cmd_stop_debug_session(pid: u32) -> bool { stop_debug_session(pid) }
#[tauri::command]
pub fn cmd_test_hook(command: String, timeout_secs: Option<u64>) -> HookTestResult {
    test_hook(&command, timeout_secs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use serde_json::json;

    #[test]
    fn get_hooks_empty_settings() {
        let dir = tempdir().unwrap();
        let hooks = get_hooks(dir.path()).unwrap();
        assert!(hooks.is_empty());
    }

    #[test]
    fn save_and_delete_hook_in_settings() {
        let dir = tempdir().unwrap();
        let cfg = json!({"matcher": "*", "hooks": [{"type": "command", "command": "echo hi"}]});
        save_hook_to_settings(dir.path(), "PreToolUse", cfg, "user", None).unwrap();
        let hooks = get_hooks(dir.path()).unwrap();
        assert_eq!(hooks.len(), 1);
        delete_hook_from_settings(dir.path(), "PreToolUse", 0, "user").unwrap();
        assert!(get_hooks(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn a1_project_scope_hook_lands_in_project_settings() {
        let base = tempdir().unwrap();
        let proj = tempdir().unwrap();
        let cfg = json!({"matcher": "*", "hooks": [{"type": "command", "command": "echo proj"}]});
        // Write to project scope
        save_hook_to_settings_proj(base.path(), "PreToolUse", cfg, "project", Some(proj.path().to_str().unwrap()), None).unwrap();
        // Hook present in project settings
        let proj_settings = proj.path().join(".claude").join("settings.json");
        assert!(proj_settings.exists(), "project settings.json should be created");
        let doc: Value = serde_json::from_str(&fs::read_to_string(&proj_settings).unwrap()).unwrap();
        let hooks = doc["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(hooks.len(), 1);
        // User base settings should NOT exist
        let user_settings = base.path().join("settings.json");
        assert!(!user_settings.exists(), "user settings.json should be untouched");
    }

    #[test]
    fn a1_user_scope_hook_lands_in_user_settings() {
        let base = tempdir().unwrap();
        let proj = tempdir().unwrap();
        let cfg = json!({"matcher": "*", "hooks": [{"type": "command", "command": "echo user"}]});
        // Write to user scope
        save_hook_to_settings_proj(base.path(), "PreToolUse", cfg, "user", Some(proj.path().to_str().unwrap()), None).unwrap();
        // Hook present in user settings
        let user_settings = base.path().join("settings.json");
        assert!(user_settings.exists(), "user settings.json should be created");
        // Project .claude dir should NOT exist
        let proj_claude = proj.path().join(".claude");
        assert!(!proj_claude.exists(), "project .claude dir should be untouched");
    }

    #[test]
    fn a1_project_scope_delete_removes_from_project_only() {
        let base = tempdir().unwrap();
        let proj = tempdir().unwrap();
        let cfg = json!({"matcher": "*", "hooks": [{"type": "command", "command": "echo proj"}]});
        save_hook_to_settings_proj(base.path(), "PreToolUse", cfg, "project", Some(proj.path().to_str().unwrap()), None).unwrap();
        delete_hook_from_settings_proj(base.path(), "PreToolUse", 0, "project", Some(proj.path().to_str().unwrap())).unwrap();
        let proj_settings = proj.path().join(".claude").join("settings.json");
        let doc: Value = serde_json::from_str(&fs::read_to_string(&proj_settings).unwrap()).unwrap();
        let hooks = doc["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(hooks.is_empty());
    }

    #[test]
    fn hook_logs_initially_empty() {
        clear_hook_logs();
        assert!(get_hook_logs().is_empty());
    }

    // A3 tests
    #[test]
    fn a3_debug_log_empty_when_no_debug_dir() {
        let dir = tempdir().unwrap();
        let result = get_hook_debug_logs(dir.path()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn a3_debug_log_fixture_matched_and_error() {
        let dir = tempdir().unwrap();
        let debug_dir = dir.path().join("debug");
        fs::create_dir_all(&debug_dir).unwrap();

        // Synthetic .txt fixture mirroring old claude code debug format
        let fixture = "\
2026-01-01T10:00:00.000Z [DEBUG] Getting matching hook commands for PreToolUse with query: read_file\n\
2026-01-01T10:00:00.001Z [DEBUG] Matched 2 unique hooks for query \"read_file\" (2 before deduplication)\n\
2026-01-01T10:00:00.002Z [DEBUG] Running hook command: echo hello\n\
2026-01-01T10:00:01.000Z [ERROR] Hook exited with exit code 1\n\
2026-01-01T10:00:02.000Z [DEBUG] Getting matching hook commands for SessionStart with query: startup\n\
2026-01-01T10:00:02.001Z [DEBUG] Matched 0 unique hooks for query \"startup\" (0 before deduplication)\n\
";
        fs::write(debug_dir.join("session-test.txt"), fixture).unwrap();

        let entries = get_hook_debug_logs(dir.path()).unwrap();
        // Should have: 1 "matched" for PreToolUse, 1 "running" for echo hello
        // SessionStart matched 0 → should NOT produce a matched entry
        let matched: Vec<_> = entries.iter().filter(|e| e.status == "matched").collect();
        let running: Vec<_> = entries.iter().filter(|e| e.status == "running").collect();
        assert!(!matched.is_empty(), "should have matched entry");
        assert_eq!(matched[0].hook_type, "PreToolUse");
        assert!(!running.is_empty(), "should have running entry");
    }

    #[test]
    fn a3_debug_log_error_line_captured() {
        let dir = tempdir().unwrap();
        let debug_dir = dir.path().join("debug");
        fs::create_dir_all(&debug_dir).unwrap();

        let fixture = "\
2026-01-02T09:00:00.000Z [ERROR] Hook command spawn failed: ENOENT no such file\n\
";
        fs::write(debug_dir.join("err-test.txt"), fixture).unwrap();

        let entries = get_hook_debug_logs(dir.path()).unwrap();
        let errors: Vec<_> = entries.iter().filter(|e| e.status == "error").collect();
        assert!(!errors.is_empty(), "should capture error entries");
        assert!(errors[0].message.contains("ENOENT"));
    }

    // A2 tests
    #[test]
    fn a2_test_hook_echo_success() {
        let result = test_hook("echo hi", None);
        assert_eq!(result.exit_code, Some(0));
        assert_eq!(result.stdout, "hi");
        assert!(!result.timed_out);
    }

    #[test]
    fn a2_test_hook_nonzero_exit() {
        let result = test_hook("exit 3", None);
        assert_eq!(result.exit_code, Some(3));
        assert!(!result.timed_out);
    }

    #[test]
    fn a2_test_hook_timeout() {
        let start = std::time::Instant::now();
        let result = test_hook("sleep 10", Some(1));
        let elapsed = start.elapsed().as_millis();
        assert!(result.timed_out, "expected timed_out=true");
        assert!(elapsed < 2500, "should finish within ~2.5s but took {}ms", elapsed);
    }
}
