//! The Moduo logomark, from the brand master (written by `bun run native:icons`).

use gpui_kit::{prelude::*, px, svg, App, Window};

/// The mark's asset path.
pub const MODUO_MARK_PATH: &str = "brand/moduo-mark.svg";

/// The mark at a size in pixels, in the current text colour.
#[derive(IntoElement)]
pub struct ModuoMark {
    size: f32,
}

impl ModuoMark {
    pub fn new(size: f32) -> Self {
        Self { size }
    }
}

impl RenderOnce for ModuoMark {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        svg()
            .path(MODUO_MARK_PATH)
            .size(px(self.size))
            .flex_none()
            .text_color(window.text_style().color)
    }
}
