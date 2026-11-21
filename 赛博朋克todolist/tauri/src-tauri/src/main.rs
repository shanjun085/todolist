// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;

            // WebView2 user-data directory. Defaults to Tauri's per-app local data
            // dir; NEON_TASKS_DATA_DIR overrides it (used for sandboxed smoke tests).
            let data_dir = match std::env::var("NEON_TASKS_DATA_DIR") {
                Ok(p) if !p.trim().is_empty() => PathBuf::from(p),
                _ => app.path().app_local_data_dir().unwrap_or_default(),
            };

            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("赛博朋克 · Todo list")
            .inner_size(420.0, 800.0)
            .min_inner_size(340.0, 560.0)
            .center();

            builder = builder.data_directory(data_dir);
            builder.build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
