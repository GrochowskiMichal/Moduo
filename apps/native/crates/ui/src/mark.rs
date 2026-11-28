//! The Moduo logomark, from the brand master (written by `bun run native:icons`).

use gpui_kit::{prelude::*, px, svg, App, Window};

use crate::icon::IconSize;
use crate::theme;

/// The mark's asset path.
pub const MODUO_MARK_PATH: &str = "brand/moduo-mark.svg";

/// The mark on the icon ladder, in the current text colour.
#[derive(IntoElement)]
pub struct ModuoMark {
    size: IconSize,
}

impl ModuoMark {
    pub fn new(size: IconSize) -> Self {
        Self { size }
    }
}

impl RenderOnce for ModuoMark {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let size = px(self.size.px(theme::tokens(cx)));
        svg()
            .path(MODUO_MARK_PATH)
            .size(size)
            .flex_none()
            .text_color(window.text_style().color)
    }
}
