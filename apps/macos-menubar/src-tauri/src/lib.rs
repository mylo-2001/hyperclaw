use tauri::menu::{Menu, MenuItem};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let quit = MenuItem::with_id(app, "quit", "Quit HyperClaw", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&quit])?;
                let handle = app.handle().clone();
                if let Some(q) = menu.get_item("quit") {
                    q.set_on_menu_event(move |_| {
                        handle.exit(0);
                    });
                }
                let icon = app.default_window_icon().cloned().expect("default icon");
                let _ = tauri::tray::TrayIconBuilder::new()
                    .icon(icon)
                    .menu(&menu)
                    .menu_on_left_click(false)
                    .id("main")
                    .build(app);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
