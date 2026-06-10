//! 系统托盘
//!
//! 单元测试不适用（依赖 Tauri AppHandle + OS 原生托盘）。
//! 在 M10 冒烟测试中手工验证：
//!   1. 托盘图标出现在系统菜单栏
//!   2. 菜单显示"当前 Provider: …"、预设快速切换项、分隔符、"打开 Forge"、"退出"
//!   3. 点击预设 → Provider 切换生效（热切换 claude-code，codex-cli 显示需重启提示）
//!   4. 菜单标题实时更新为激活的 Provider 名称
//!
//! ## 托盘生命周期说明
//!
//! Tauri v2 中 `TrayIconBuilder::build()` 会把图标注册到 app 的资源表（resources
//! table）并存储一份 `Arc<TrayIcon>`，因此即使调用方丢弃返回的句柄，图标也
//! 不会消失。`app.tray_by_id()` 可随时取回已注册的图标。
//!
//! ## 防止重复托盘
//!
//! 所有托盘都使用稳定 ID `TRAY_ID`。切换 Provider 时**不**新建托盘，而是通过
//! `tray_by_id` 找到现有图标，仅重建菜单并调用 `tray.set_menu()` 更新，避免
//! macOS 菜单栏出现多个重复图标。

use tauri::{
    App, AppHandle, Manager, Runtime,
    menu::{Menu, MenuItem, PredefinedMenuItem, IsMenuItem},
    tray::TrayIconBuilder,
};

use crate::commands::model_switcher::commands::DbState;
use crate::commands::model_switcher::presets::builtin_presets;
use crate::db::providers::{get_provider};

/// 稳定的托盘图标 ID，贯穿整个应用生命周期。
const TRAY_ID: &str = "forge-tray";

pub fn setup_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let menu = build_menu(&handle, None)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event({
            let handle = handle.clone();
            move |app, event| {
                let id = event.id().as_ref();
                if id == "open" {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                } else if id == "quit" {
                    app.exit(0);
                } else if let Some(preset_id) = id.strip_prefix("preset:") {
                    handle_preset_click(&handle, preset_id);
                }
            }
        })
        .build(&handle)?;

    Ok(())
}

/// 构建（或重建）托盘菜单。
///
/// `active_name` 为 `None` 时显示"(未设置)"，否则显示对应 Provider 名称。
fn build_menu<R: Runtime>(
    handle: &AppHandle<R>,
    active_name: Option<&str>,
) -> tauri::Result<Menu<R>> {
    let info_label = active_name
        .map(|n| format!("当前 Provider: {}", n))
        .unwrap_or_else(|| "当前 Provider: (未设置)".to_string());

    // 信息项（不可点击）
    let info_item = MenuItem::with_id(handle, "info", &info_label, false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(handle)?;

    // 快速切换预设（前 8 条）
    let presets = builtin_presets();
    let preset_items: Vec<MenuItem<R>> = presets
        .iter()
        .take(8)
        .map(|p| {
            MenuItem::with_id(
                handle,
                format!("preset:{}", p.id),
                p.name,
                true,
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;

    let sep2 = PredefinedMenuItem::separator(handle)?;
    let open_item = MenuItem::with_id(handle, "open", "打开 Forge", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(handle, "quit", "退出", true, None::<&str>)?;

    // 构建所有菜单项引用
    let mut all_items: Vec<&dyn IsMenuItem<R>> = vec![&info_item, &sep1];
    for item in &preset_items {
        all_items.push(item);
    }
    all_items.push(&sep2);
    all_items.push(&open_item);
    all_items.push(&quit_item);

    Menu::with_items(handle, &all_items)
}

fn handle_preset_click<R: Runtime>(handle: &AppHandle<R>, preset_id: &str) {
    if let Some(db_state) = handle.try_state::<DbState>() {
        let result = (|| -> Result<String, String> {
            let conn = db_state.0.lock().map_err(|e| e.to_string())?;

            let provider = get_provider(&conn, preset_id)?
                .ok_or_else(|| format!("preset '{}' not found", preset_id))?;

            let mut targets = Vec::new();
            if provider.claude_code_config.is_some() {
                targets.push("claude-code".to_string());
            }
            if provider.codex_cli_config.is_some() {
                targets.push("codex-cli".to_string());
            }

            for tool in &targets {
                crate::db::providers::set_active_provider(&conn, tool, preset_id)?;
            }

            let claude_path = crate::config::claude::default_path();
            let codex_path = crate::config::codex::default_path();
            let _results = crate::commands::model_switcher::switcher::switch_provider_with_paths(
                claude_path.as_deref(),
                codex_path.as_deref(),
                provider.claude_code_config.as_deref(),
                provider.codex_cli_config.as_deref(),
                &targets,
            );

            Ok(provider.name)
        })();

        if let Ok(name) = result {
            // 找到现有托盘，仅更新菜单——不新建图标，避免重复出现在菜单栏
            if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                if let Ok(menu) = build_menu(handle, Some(&name)) {
                    let _ = tray.set_menu(Some(menu));
                }
            }
        }
    }
}
