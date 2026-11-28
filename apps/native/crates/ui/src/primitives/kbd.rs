//! A key hint (`kbd.tsx`: rounded border bg-muted px-1 py-0.5 font-mono text-2xs muted text).

use gpui_kit::{div, prelude::*, App, SharedString, Window};
use moduo_tokens::Token;

use crate::space::sp;
use crate::text::{self, Family};
use crate::theme;

#[derive(IntoElement)]
pub struct Kbd {
    keys: SharedString,
}

impl Kbd {
    pub fn new(keys: impl Into<SharedString>) -> Self {
        Self { keys: keys.into() }
    }
}

impl RenderOnce for Kbd {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let el = div()
            .flex_none()
            .px(sp(1.))
            .py(sp(0.5))
            .rounded(theme::px(cx, Token::RadiusSm))
            .border_1()
            .border_color(theme::color(cx, Token::Border))
            .bg(theme::color(cx, Token::Muted))
            .text_color(theme::color(cx, Token::MutedForeground))
            .child(self.keys);
        text::font(
            el,
            Family::Mono,
            Token::Text2xs,
            Token::FontWeightRegular,
            cx,
        )
    }
}
