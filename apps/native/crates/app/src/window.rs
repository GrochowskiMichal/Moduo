//! The main window: what it is called, how big it opens and how small it gets.

use crate::CurrentBackend;
use moduo_ui::gpui::{
    self, div, prelude::*, px, size, AnyWindowHandle, App, Bounds, Context, Pixels, Size,
    TitlebarOptions, Window, WindowBounds, WindowOptions,
};
use moduo_ui::theme;
use moduo_ui::tokens::Token;

/// The window title, and the app's name in the Dock.
pub const TITLE: &str = "Moduo";

/// The size the window opens at (the Tauri app's, `tauri.conf.json`).
pub fn default_size() -> Size<Pixels> {
    size(px(1280.), px(840.)) // design-literal: the window size, as the Tauri app's (tauri.conf.json)
}

/// Layouts are designed down to this size and no further.
pub fn min_size() -> Size<Pixels> {
    size(px(1024.), px(700.)) // design-literal: the smallest window layouts are designed for
}

/// "Moduo", and where it is when that is the cloud: changes there are real.
fn title(cx: &App) -> String {
    match cx.try_global::<CurrentBackend>() {
        Some(CurrentBackend(backend)) if backend.is_cloud() => {
            format!("{TITLE} · {}", backend.label())
        }
        _ => TITLE.to_owned(),
    }
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
            title: Some(title(cx).into()),
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
        let cloud = cx
            .try_global::<CurrentBackend>()
            .is_some_and(|b| b.0.is_cloud());
        let (alert, alert_text) = moduo_ui::alert_colors(cx);
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(background)
            .text_color(foreground)
            .children(cloud.then(|| {
                div()
                    .w_full()
                    .px(theme::px(cx, Token::PadX))
                    .py(theme::px(cx, Token::PadYSm))
                    .bg(alert)
                    .text_color(alert_text)
                    .text_size(theme::px(cx, Token::TextXs))
                    .child("Cloud backend: every change here is a real change to production data.")
            }))
    }
}
