pub mod commands;
pub mod config;
pub mod db;
pub mod pty;
pub mod tray;

use std::sync::Mutex;
use tauri::Manager;
use crate::pty::SessionRegistry;
use crate::commands::model_switcher::commands::DbState;
use crate::commands::model_switcher::presets::seed_presets;
use crate::db::open as db_open;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SessionRegistry::new())
        .setup(|app| {
            // 打开 SQLite，种入预设
            let db_path = db::default_path()
                .expect("cannot determine db path");
            let conn = db_open(&db_path)
                .expect("failed to open forge.db");
            seed_presets(&conn).expect("failed to seed presets");
            app.manage(DbState(Mutex::new(conn)));

            // 初始化系统托盘
            tray::setup_tray(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // M1
            commands::tools::detect_tools,
            // M2 PTY
            commands::runner::pty_create,
            commands::runner::pty_write,
            commands::runner::pty_resize,
            commands::runner::pty_kill,
            commands::runner::pty_list,
            commands::runner::pty_replay,
            // M3 Model Switcher
            commands::model_switcher::commands::get_providers,
            commands::model_switcher::commands::get_active_providers,
            commands::model_switcher::commands::add_provider,
            commands::model_switcher::commands::update_provider,
            commands::model_switcher::commands::delete_provider,
            commands::model_switcher::commands::switch_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
