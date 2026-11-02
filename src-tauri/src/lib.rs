// The whole game is the web UI in ../dist; this shell only hosts it in a native window.

/// The table is designed for a window about this many CSS pixels tall. A 1080p screen at 150% scaling (or a small laptop)
/// leaves much less, so the window is zoomed out just enough to get this much room. (This is the webview's own zoom, like
/// Ctrl+minus in a browser: layout and pointer coordinates stay in CSS pixels. It is not CSS `zoom` or a scale transform.)
#[cfg(desktop)]
const DESIGN_HEIGHT: f64 = 800.0;
/// Never zoom out further than this, or the text gets too small to read.
#[cfg(desktop)]
const MIN_ZOOM: f64 = 0.7;

#[cfg(desktop)]
fn fit_zoom(window: &tauri::WebviewWindow) {
    let Ok(size) = window.inner_size() else { return };
    let Ok(scale) = window.scale_factor() else { return };
    if size.height == 0 || scale <= 0.0 {
        return; // minimised
    }
    let css_height = size.height as f64 / scale; // the page's height at 100% zoom
    let zoom = ((css_height / DESIGN_HEIGHT).clamp(MIN_ZOOM, 1.0) * 100.0).round() / 100.0;
    let _ = window.set_zoom(zoom);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    fit_zoom(&window);
                    let w = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::Resized(_) = event {
                            fit_zoom(&w);
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running 15 Steps");
}
