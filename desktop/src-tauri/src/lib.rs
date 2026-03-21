use serde::Serialize;
use std::process::Command;
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[derive(Serialize)]
struct RoomInfo {
    room_id: String,
    token: String,
    pair_secret: String,
    device_id: String,
}

/// Create a room via the Worker API
#[tauri::command]
async fn create_room(api_base: String) -> Result<RoomInfo, String> {
    let url = format!("{}/api/room", api_base);
    let resp = reqwest::Client::new()
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let device_id = uuid::Uuid::new_v4().to_string();

    Ok(RoomInfo {
        room_id: data["roomId"].as_str().unwrap_or("").to_string(),
        token: data["token"].as_str().unwrap_or("").to_string(),
        pair_secret: data["pairSecret"].as_str().unwrap_or("").to_string(),
        device_id,
    })
}

/// Inject text at current cursor position via clipboard + ⌘V simulation.
/// Uses osascript (AppleScript) for maximum macOS compatibility.
///
/// Flow:
/// 1. Save current clipboard via pbpaste
/// 2. Write text to clipboard via pbcopy
/// 3. Simulate ⌘V via osascript
/// 4. Wait 150ms
/// 5. Restore original clipboard via pbcopy
#[tauri::command]
fn inject_text(text: String) -> Result<(), String> {
    // Run in a thread to avoid blocking the main thread
    let handle = thread::spawn(move || -> Result<(), String> {
        // 1. Save current clipboard
        let saved = Command::new("pbpaste")
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).to_string())
                } else {
                    None
                }
            });

        // 2. Write new text to clipboard
        let mut child = Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("pbcopy spawn error: {}", e))?;

        if let Some(stdin) = child.stdin.as_mut() {
            use std::io::Write;
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("pbcopy write error: {}", e))?;
        }
        child
            .wait()
            .map_err(|e| format!("pbcopy wait error: {}", e))?;

        // 3. Simulate ⌘V via osascript
        Command::new("osascript")
            .args([
                "-e",
                r#"tell application "System Events" to keystroke "v" using command down"#,
            ])
            .output()
            .map_err(|e| format!("osascript error: {}", e))?;

        // 4. Wait 150ms for target app to process paste
        thread::sleep(Duration::from_millis(150));

        // 5. Restore original clipboard
        if let Some(original) = saved {
            let mut child = Command::new("pbcopy")
                .stdin(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("pbcopy restore error: {}", e))?;

            if let Some(stdin) = child.stdin.as_mut() {
                use std::io::Write;
                let _ = stdin.write_all(original.as_bytes());
            }
            let _ = child.wait();
        }

        Ok(())
    });

    handle
        .join()
        .map_err(|_| "Thread panic".to_string())?
}

/// Check if accessibility permission is available
#[tauri::command]
fn check_accessibility() -> bool {
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events" to return name of first process"#,
        ])
        .output();

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            // Build tray menu
            let quit = MenuItemBuilder::with_id("quit", "退出 Sinput").build(app)?;
            let show = MenuItemBuilder::with_id("show", "显示/隐藏").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("No default icon"))
                .icon_as_template(true)
                .menu(&menu)
                .tooltip("Sinput")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Enable autostart
            let manager = app.autolaunch();
            if !manager.is_enabled().unwrap_or(false) {
                let _ = manager.enable();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_room,
            inject_text,
            check_accessibility,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sinput");
}
