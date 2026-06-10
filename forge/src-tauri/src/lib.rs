pub mod commands;
pub mod config;
pub mod db;
pub mod pty;
pub mod tray;

use crate::pty::SessionRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SessionRegistry::new())
        .invoke_handler(tauri::generate_handler![
            commands::tools::detect_tools,
            commands::runner::pty_create,
            commands::runner::pty_write,
            commands::runner::pty_resize,
            commands::runner::pty_kill,
            commands::runner::pty_list,
            commands::runner::pty_replay,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
