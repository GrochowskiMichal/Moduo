//! The main window: what it is called, how big it opens and how small it gets.

use moduo_ui::gpui::{
    self, div, prelude::*, px, size, AnyWindowHandle, App, Bounds, Context, Pixels, Size,
    TitlebarOptions, Window, WindowBounds, WindowOptions,
};

/// The window title, and the app's name in the Dock.
pub const TITLE: &str = "Moduo";

/// The size the window opens at (the Tauri app's, `tauri.conf.json`).
pub fn default_size() -> Size<Pixels> {
    size(px(1280.), px(840.))
}

/// Layouts are designed down to this size and no further.
pub fn min_size() -> Size<Pixels> {
    size(px(1024.), px(700.))
}

/// A native title bar, centred, and hidden until the first frame is drawn.
pub fn main_window_options(cx: &App) -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
            None,
            default_size(),
            cx,
        ))),
        window_min_size: Some(min_size()),
        titlebar: Some(TitlebarOptions {
            title: Some(TITLE.into()),
            ..Default::default()
        }),
        show: false,
        ..Default::default()
    }
}

/// Opens the main window. It shows itself once it has drawn.
pub fn open_main_window(cx: &mut App) -> gpui::Result<AnyWindowHandle> {
    let options = main_window_options(cx);
    let (window, _) =
        moduo_ui::open_window(options, cx, |_, cx| cx.new(|_| Shell { shown: false }))?;
    Ok(window)
}

/// The empty app. The shell replaces it (specs/native-foundation.md, NF-26 on).
struct Shell {
    shown: bool,
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.shown {
            // A window shown before it has drawn flashes empty.
            self.shown = true;
            window.on_next_frame(|window, _| window.activate_window());
        }
        let (background, foreground) = moduo_ui::window_colors(cx);
        div().size_full().bg(background).text_color(foreground)
    }
}
