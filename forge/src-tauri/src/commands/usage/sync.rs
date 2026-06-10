// forge/src-tauri/src/commands/usage/sync.rs
use crate::commands::model_switcher::commands::DbState;
use crate::commands::usage::parser::walk_claude_sessions;
use crate::db::{sessions::upsert_session, projects::recompute_all_projects};
use tauri::State;

#[tauri::command]
pub fn usage_sync(db: State<'_, DbState>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // 1. Determine Claude projects base dir
    let base_dir = dirs::home_dir()
        .map(|h| h.join(".claude/projects"))
        .ok_or("cannot find home dir")?;

    // 2. Walk and parse sessions
    let sessions = walk_claude_sessions(&base_dir);
    let total = sessions.len();

    // 3. Upsert each into DB
    for s in &sessions {
        if let Err(e) = upsert_session(&conn, s) {
            eprintln!("[WARN] upsert_session {}: {}", s.session_id, e);
        }
    }

    // 4. Recompute project aggregates
    let _ = recompute_all_projects(&conn);

    Ok(total)
}
