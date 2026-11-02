// The whole game is the web UI in ../dist; this shell only hosts it in a native window.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running 15 Steps");
}
