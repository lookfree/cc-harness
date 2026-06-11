pub mod commands;
pub mod config;
pub mod db;
pub mod pathenv;
pub mod pty;
pub mod tray;

use std::sync::Mutex;
use tauri::{Emitter, Manager};
use crate::pty::SessionRegistry;
use crate::commands::model_switcher::commands::DbState;
use crate::commands::model_switcher::presets::seed_presets;
use crate::db::open as db_open;
use crate::commands::claude_code::watcher::{FileWatcher, WatcherState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 必须最先执行：GUI 启动时 launchd PATH 不含用户目录，影响 which 检测与 PTY 启动
    pathenv::fix_path();
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

            // 注册 WatcherState（初始为 None）
            app.manage(WatcherState(Mutex::new(None)));

            // 初始化文件监听（监听 ~/.claude 的各子目录）
            let watch_dirs = {
                let mut dirs_to_watch = vec![];
                if let Some(home) = dirs::home_dir() {
                    let claude_dir = home.join(".claude");
                    for sub in &["skills", "agents", "commands", "hooks"] {
                        dirs_to_watch.push(claude_dir.join(sub));
                    }
                }
                dirs_to_watch
            };
            if let Ok(fw) = FileWatcher::start(app.handle().clone(), watch_dirs) {
                *app.state::<WatcherState>().0.lock().unwrap() = Some(fw);
            }

            // 启动 tools:status 轮询线程（每 5 秒）
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        let tools = crate::commands::usage::status::scan_running_tools();
                        let _ = app_handle.emit("tools:status", tools);
                    }
                });
            }

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
            // M4 Claude Code 配置管理
            commands::claude_code::skills::cmd_get_skills,
            commands::claude_code::skills::cmd_get_skill,
            commands::claude_code::skills::cmd_save_skill,
            commands::claude_code::skills::cmd_delete_skill,
            commands::claude_code::agents::cmd_get_agents,
            commands::claude_code::agents::cmd_get_agent,
            commands::claude_code::agents::cmd_save_agent,
            commands::claude_code::agents::cmd_delete_agent,
            commands::claude_code::claudemd::cmd_get_claudemd,
            commands::claude_code::claudemd::cmd_get_all_claudemd,
            commands::claude_code::claudemd::cmd_save_claudemd,
            commands::claude_code::claudemd::cmd_discover_claudemd,
            commands::claude_code::graph::cmd_get_dependency_graph,
            commands::claude_code::slash_commands::cmd_get_slash_commands,
            commands::claude_code::slash_commands::cmd_get_slash_command,
            commands::claude_code::slash_commands::cmd_save_slash_command,
            commands::claude_code::slash_commands::cmd_save_slash_command_raw,
            commands::claude_code::slash_commands::cmd_delete_slash_command,
            commands::claude_code::mcp::cmd_get_mcp_servers,
            commands::claude_code::mcp::cmd_save_mcp_server,
            commands::claude_code::mcp::cmd_delete_mcp_server,
            commands::claude_code::mcp::cmd_test_mcp_connection,
            commands::claude_code::hooks::cmd_get_hooks,
            commands::claude_code::hooks::cmd_save_hook_to_settings,
            commands::claude_code::hooks::cmd_delete_hook_from_settings,
            commands::claude_code::hooks::cmd_create_hook_script,
            commands::claude_code::hooks::cmd_read_hook_script,
            commands::claude_code::hooks::cmd_get_hook_logs,
            commands::claude_code::hooks::cmd_clear_hook_logs,
            commands::claude_code::hooks::cmd_get_hook_debug_logs,
            commands::claude_code::hooks::cmd_launch_debug_session,
            commands::claude_code::hooks::cmd_stop_debug_session,
            commands::claude_code::hooks::cmd_test_hook,
            // M4b Git
            commands::claude_code::git::cmd_git_status,
            commands::claude_code::git::cmd_git_stage,
            commands::claude_code::git::cmd_git_commit,
            commands::claude_code::git::cmd_git_push,
            commands::claude_code::git::cmd_git_branches,
            commands::claude_code::git::cmd_git_checkout,
            commands::claude_code::git::cmd_git_log,
            // M4b Worktrees
            commands::claude_code::worktrees::cmd_list_worktrees,
            commands::claude_code::worktrees::cmd_add_worktree,
            commands::claude_code::worktrees::cmd_remove_worktree,
            // M4b Environment
            commands::claude_code::environment::cmd_detect_env_tools,
            commands::claude_code::environment::cmd_get_env_vars,
            commands::claude_code::environment::cmd_set_env_var,
            commands::claude_code::environment::cmd_delete_env_var,
            commands::claude_code::environment::cmd_test_api_connection,
            // M5 Usage
            commands::usage::sync::usage_sync,
            commands::usage::query::get_sessions,
            commands::usage::query::get_projects,
            commands::usage::query::pin_project,
            commands::usage::query::unpin_project,
            commands::usage::query::get_dashboard,
            commands::usage::query::get_daily_usage,
            commands::usage::status::get_running_tools,
            // M7 Codex CLI
            commands::codex_cli::config::codex_get_status,
            commands::codex_cli::config::codex_read_config,
            commands::codex_cli::config::codex_write_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
