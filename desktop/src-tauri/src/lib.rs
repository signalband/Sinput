use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

// --- Simulate ⌘V via CoreGraphics (direct, no subprocess) ---

#[cfg(target_os = "macos")]
fn simulate_cmd_v() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGKeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEY_V: CGKeyCode = 9;

    let source = match CGEventSource::new(CGEventSourceStateID::HIDSystemState) {
        Ok(s) => s,
        Err(_) => { eprintln!("Failed to create CGEventSource"); return; }
    };

    if let (Ok(key_down), Ok(key_up)) = (
        CGEvent::new_keyboard_event(source.clone(), KEY_V, true),
        CGEvent::new_keyboard_event(source, KEY_V, false),
    ) {
        key_down.set_flags(CGEventFlags::CGEventFlagCommand);
        key_down.post(core_graphics::event::CGEventTapLocation::HID);

        key_up.set_flags(CGEventFlags::CGEventFlagCommand);
        key_up.post(core_graphics::event::CGEventTapLocation::HID);
    }
}

#[cfg(not(target_os = "macos"))]
fn simulate_cmd_v() {}

// --- Pairing persistence ---

#[derive(Serialize, Deserialize, Clone)]
struct PairingInfo {
    room_id: String,
    pair_secret: String,
    device_id: String,
}

fn pairing_path() -> std::path::PathBuf {
    let mut p = dirs::config_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    p.push("com.sinput.desktop");
    std::fs::create_dir_all(&p).ok();
    p.push("pairing.json");
    p
}

fn load_pairing() -> Option<PairingInfo> {
    serde_json::from_str(&std::fs::read_to_string(pairing_path()).ok()?).ok()
}

fn save_pairing(info: &PairingInfo) {
    if let Ok(json) = serde_json::to_string_pretty(info) {
        std::fs::write(pairing_path(), json).ok();
    }
}

// --- Tauri commands ---

#[derive(Serialize)]
struct RoomInfo {
    room_id: String,
    token: String,
    pair_secret: String,
    device_id: String,
}

#[tauri::command]
async fn create_room(api_base: String) -> Result<RoomInfo, String> {
    let url = format!("{}/api/room", api_base);
    let resp = reqwest::Client::new()
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;
    let data: serde_json::Value = resp.json().await.map_err(|e| format!("{}", e))?;
    let device_id = uuid::Uuid::new_v4().to_string();
    let info = RoomInfo {
        room_id: data["roomId"].as_str().unwrap_or("").to_string(),
        token: data["token"].as_str().unwrap_or("").to_string(),
        pair_secret: data["pairSecret"].as_str().unwrap_or("").to_string(),
        device_id,
    };
    save_pairing(&PairingInfo {
        room_id: info.room_id.clone(),
        pair_secret: info.pair_secret.clone(),
        device_id: info.device_id.clone(),
    });
    Ok(info)
}

#[tauri::command]
fn get_saved_pairing() -> Option<PairingInfo> {
    load_pairing()
}

#[tauri::command]
fn clear_pairing() {
    std::fs::remove_file(pairing_path()).ok();
}

#[tauri::command]
fn inject_text(text: String) -> Result<(), String> {
    let handle = thread::spawn(move || -> Result<(), String> {
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
        let mut child = Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("{}", e))?;
        if let Some(stdin) = child.stdin.as_mut() {
            use std::io::Write;
            stdin.write_all(text.as_bytes()).map_err(|e| format!("{}", e))?;
        }
        child.wait().map_err(|e| format!("{}", e))?;

        // Simulate ⌘V using CGEvent (runs as Sinput.app, not a subprocess)
        simulate_cmd_v();

        thread::sleep(Duration::from_millis(150));

        if let Some(original) = saved {
            let mut c = Command::new("pbcopy")
                .stdin(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("{}", e))?;
            if let Some(stdin) = c.stdin.as_mut() {
                use std::io::Write;
                let _ = stdin.write_all(original.as_bytes());
            }
            let _ = c.wait();
        }
        Ok(())
    });
    handle.join().map_err(|_| "Thread panic".to_string())?
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
    }
}

/// Called by frontend to update tray menu status text and icon
#[tauri::command]
fn update_tray_status(app: tauri::AppHandle, connected: bool) {
    if let Some(state) = app.try_state::<ConnectionState>() {
        *state.0.lock().unwrap() = connected;
    }
    rebuild_tray_menu(&app, connected);

    // Switch tray icon (with/without green dot)
    if let Some(tray) = app.tray_by_id("sinput-tray") {
        let icon_bytes: &[u8] = if connected {
            include_bytes!("../icons/tray-connected.png")
        } else {
            include_bytes!("../icons/tray-default.png")
        };
        if let Ok(img) = tauri::image::Image::from_bytes(icon_bytes) {
            let _ = tray.set_icon(Some(img));
        }
    }
}

struct ConnectionState(Mutex<bool>);

/// Check macOS Accessibility permission using the native API
#[tauri::command]
fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        // AXIsProcessTrusted() — the real macOS Accessibility check
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    { true }
}

/// Open System Settings → Accessibility and prompt user to add the app
#[tauri::command]
fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    {
        // On macOS 13+, use the new URL scheme
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }
}

fn rebuild_tray_menu(app: &tauri::AppHandle, connected: bool) {
    let status_text = if connected {
        "🟢  已连接"
    } else {
        "🔴  未连接"
    };

    if let Some(tray) = app.tray_by_id("sinput-tray") {
        let status = MenuItemBuilder::with_id("settings", status_text)
            .build(app)
            .unwrap();
        let quit = MenuItemBuilder::with_id("quit", "退出 Sinput")
            .build(app)
            .unwrap();
        let menu = MenuBuilder::new(app)
            .items(&[&status, &quit])
            .build()
            .unwrap();
        let _ = tray.set_menu(Some(menu));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(ConnectionState(Mutex::new(false)))
        .setup(|app| {
            // Build initial tray menu
            let status = MenuItemBuilder::with_id("settings", "🔴  未连接")
                .build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出 Sinput")
                .build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&status, &quit])
                .build()?;

            let tray_icon = tauri::image::Image::from_bytes(
                include_bytes!("../icons/tray-default.png")
            ).expect("Failed to load tray icon");

            let _tray = TrayIconBuilder::with_id("sinput-tray")
                .icon(tray_icon)
                .icon_as_template(false)
                .menu(&menu)
                .menu_on_left_click(true)
                .tooltip("Sinput")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "settings" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Window starts hidden; frontend JS decides whether to show
            if let Some(win) = app.get_webview_window("main") {
                let wc = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = wc.hide();
                    }
                });
            }

            // Autostart
            let manager = app.autolaunch();
            if !manager.is_enabled().unwrap_or(false) {
                let _ = manager.enable();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_room,
            get_saved_pairing,
            clear_pairing,
            inject_text,
            update_tray_status,
            check_accessibility,
            open_accessibility_settings,
            show_window,
            hide_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sinput");
}
