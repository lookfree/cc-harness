use crate::db;
use crate::pty::{session::PtySession, SessionRegistry};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[derive(Serialize, Clone, Debug)]
pub struct RunningSession {
    pub id: String,
    pub tool: String,
    pub working_dir: String,
}

/// Map tool id to CLI program name.
fn tool_to_cmd(tool: &str) -> Result<&'static str, String> {
    match tool {
        "claude-code" => Ok("claude"),
        "codex-cli" => Ok("codex"),
        _ => Err(format!("unknown tool: {tool}")),
    }
}

/// Create a new PTY session for the given tool.
///
/// Returns the session ID on success, or an Err if the tool is unknown or
/// the command cannot be spawned (e.g. not installed).
///
/// `extra_args` is optional; when provided, the args are appended to the
/// CLI invocation (e.g. `["--resume", "<sessionId>"]`).
#[tauri::command]
pub fn pty_create(
    tool: String,
    working_dir: String,
    extra_args: Option<Vec<String>>,
    app: AppHandle,
    registry: State<'_, SessionRegistry>,
) -> Result<String, String> {
    let cmd = tool_to_cmd(&tool)?;
    let session_id = Uuid::new_v4().to_string();

    // Load custom env vars from the database (best-effort; proceed without if db fails)
    let env_vars: Vec<(String, String)> = db::default_path()
        .and_then(|p| db::open(&p).ok())
        .and_then(|conn| db::get_env_vars(&conn).ok())
        .unwrap_or_default();

    // Track session start in DB (best-effort; don't fail the spawn on DB errors)
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let db_session_id = session_id.clone();
    let db_tool = tool.clone();
    let db_dir = working_dir.clone();
    if let Some(db_path) = crate::db::default_path() {
        if let Ok(conn) = crate::db::open(&db_path) {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO sessions (id, tool, working_dir, started_at, input_tokens, output_tokens, cost_usd)
                 VALUES (?1, ?2, ?3, ?4, 0, 0, 0.0)",
                rusqlite::params![db_session_id, db_tool, db_dir, now_unix],
            );
        }
    }

    let sid_output = session_id.clone();
    let app_output = app.clone();

    let sid_exit = session_id.clone();
    let app_exit = app.clone();
    let tool_exit = tool.clone();
    let dir_exit = working_dir.clone();

    let session = PtySession::spawn(
        &session_id,
        &tool,
        cmd,
        &working_dir,
        env_vars,
        extra_args,
        move |bytes| {
            let payload = String::from_utf8_lossy(&bytes).to_string();
            let _ = app_output.emit(&format!("pty:output:{sid_output}"), payload);
        },
        move || {
            let _ = app_exit.emit(&format!("pty:exit:{sid_exit}"), ());
            // Update session end time (best-effort)
            let ended_unix = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            if let Some(db_path) = crate::db::default_path() {
                if let Ok(conn) = crate::db::open(&db_path) {
                    let _ = conn.execute(
                        "UPDATE sessions SET ended_at=?1, duration_sec=?1-started_at WHERE id=?2",
                        rusqlite::params![ended_unix, sid_exit],
                    );
                    // Recompute project aggregates for this dir
                    let _ = crate::db::projects::recompute_project(&conn, &tool_exit, &dir_exit);
                }
            }
        },
    )
    .map_err(|e| format!("pty_create failed: {e}"))?;

    registry.insert(session)?;
    Ok(session_id)
}

/// Write data to a running PTY session.
#[tauri::command]
pub fn pty_write(
    session_id: String,
    data: String,
    registry: State<'_, SessionRegistry>,
) -> Result<(), String> {
    registry.with(&session_id, |s| s.write(data.as_bytes()))
}

/// Resize a running PTY session's terminal window.
#[tauri::command]
pub fn pty_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    registry: State<'_, SessionRegistry>,
) -> Result<(), String> {
    registry.with(&session_id, |s| s.resize(cols, rows))
}

/// Kill a running PTY session and remove it from the registry.
#[tauri::command]
pub fn pty_kill(
    session_id: String,
    registry: State<'_, SessionRegistry>,
) -> Result<(), String> {
    registry.remove(&session_id)
}

/// List all currently registered PTY sessions.
#[tauri::command]
pub fn pty_list(registry: State<'_, SessionRegistry>) -> Vec<RunningSession> {
    registry
        .list()
        .into_iter()
        .map(|(id, tool, working_dir)| RunningSession {
            id,
            tool,
            working_dir,
        })
        .collect()
}

/// Atomically mark a session as live and return any output buffered before
/// the frontend listener was ready.  The returned string is UTF-8 lossy.
/// Should be called after both pty:output and pty:exit listeners are registered.
#[tauri::command]
pub fn pty_replay(
    session_id: String,
    registry: State<'_, SessionRegistry>,
) -> Result<String, String> {
    registry.with(&session_id, |s| Ok(s.replay()))
}
