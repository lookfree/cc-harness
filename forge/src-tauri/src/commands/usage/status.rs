// forge/src-tauri/src/commands/usage/status.rs
use serde::Serialize;
use sysinfo::{ProcessesToUpdate, System};

#[derive(Debug, Serialize, Clone)]
pub struct RunningTool {
    pub tool: String,          // "claude-code" | "codex-cli"
    pub pid: u32,
    pub working_dir: Option<String>,
}

const TOOL_PROCESS_NAMES: &[(&str, &str)] = &[
    ("claude", "claude-code"),
    ("codex",  "codex-cli"),
];

pub fn scan_running_tools() -> Vec<RunningTool> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut results = Vec::new();
    for (proc_name, tool_id) in TOOL_PROCESS_NAMES {
        for (pid, proc) in sys.processes() {
            let name = proc.name().to_string_lossy().to_lowercase();
            if name == *proc_name || name.starts_with(proc_name) {
                // Try to get working dir from process exe path parent
                let working_dir = proc.exe()
                    .and_then(|p| p.parent())
                    .map(|p| p.to_string_lossy().to_string());
                results.push(RunningTool {
                    tool: tool_id.to_string(),
                    pid: pid.as_u32(),
                    working_dir,
                });
            }
        }
    }
    results
}

#[tauri::command]
pub fn get_running_tools() -> Result<Vec<RunningTool>, String> {
    Ok(scan_running_tools())
}
