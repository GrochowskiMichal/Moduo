//! The native Moduo desktop app: one window, no webview.

pub mod window;

/// Starts the app and opens its window. Returns when the app quits.
pub fn run() {
    moduo_ui::application().run(|cx| {
        moduo_ui::init(cx);
        window::open_main_window(cx).expect("the main window opens");
        // No menu bar yet (specs/native-foundation.md, NF-29): closing the window quits.
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        cx.activate(true);
    });
}
