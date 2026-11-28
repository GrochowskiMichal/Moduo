//! A one-pixel rule in the border colour (`separator.tsx`).

use gpui_kit::{div, prelude::*, App, Window};
use moduo_tokens::Token;

use crate::space::sp;
use crate::theme;

#[derive(IntoElement)]
pub struct Separator {
    vertical: bool,
}

impl Separator {
    pub fn horizontal() -> Self {
        Self { vertical: false }
    }

    pub fn vertical() -> Self {
        Self { vertical: true }
    }
}

impl RenderOnce for Separator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let line = div().flex_none().bg(theme::color(cx, Token::Border));
        if self.vertical {
            line.w(sp(0.25)).h_full()
        } else {
            line.h(sp(0.25)).w_full()
        }
    }
}
