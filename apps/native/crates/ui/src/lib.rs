//! Moduo's primitives and the one door to GPUI.
//!
//! Every other crate draws through this one: it is the only crate that may name
//! the component library (`apps/native/tests/boundaries.rs` fails otherwise), the
//! way React features use the shadcn wrappers and never Radix itself.

/// GPUI's core API (elements, entities, windows, the test harness).
///
/// The component library's own modules are shut out below, so a crate that
/// needs a button has to take Moduo's.
#[allow(hidden_glob_reexports)]
pub mod gpui {
    pub use gpui_kit::*;

    // A private item wins over a glob import of the same name: these make
    // `moduo_ui::gpui::component` and friends unreachable from outside.
    #[allow(dead_code)]
    mod assets {}
    #[allow(dead_code)]
    mod base {}
    #[allow(dead_code)]
    mod component {}
}

/// The design tokens, as the rest of the app names them.
pub use moduo_tokens as tokens;

pub mod assets;
pub mod focus;
pub mod fonts;
pub mod icon;
pub mod mark;
pub mod motion;
pub mod primitives;
pub mod space;
pub mod style;
pub mod text;
pub mod theme;

use gpui_kit::component::ActiveTheme as _;

use crate::gpui::{AnyWindowHandle, App, Application, Entity, Hsla, Render, Window, WindowOptions};

/// The application object, with Moduo's assets (and the kit's) registered.
pub fn application() -> Application {
    gpui_kit::application().with_assets(assets::Assets)
}

/// Call once, before anything is drawn: the component library, the fonts and the default
/// appearance.
pub fn init(cx: &mut App) {
    gpui_kit::init(cx);
    fonts::load(cx);
    theme::init(cx);
}

/// Opens a window whose content is `build`'s view, under the layer that hosts
/// dialogs, popovers and toasts.
pub fn open_window<V: Render>(
    options: WindowOptions,
    cx: &mut App,
    build: impl FnOnce(&mut Window, &mut App) -> Entity<V>,
) -> gpui::Result<(AnyWindowHandle, Entity<V>)> {
    gpui_kit::open_window(options, cx, build)
}

/// The fill and text colour of a strip that must not be missed (the cloud warning).
pub fn alert_colors(cx: &App) -> (Hsla, Hsla) {
    let theme = cx.theme();
    (theme.danger, theme.danger_foreground)
}

/// The window's fill and its text colour.
pub fn window_colors(cx: &App) -> (Hsla, Hsla) {
    let theme = cx.theme();
    (theme.background, theme.foreground)
}
