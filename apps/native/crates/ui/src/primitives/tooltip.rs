//! The tooltip (`tooltip.tsx`): a small floating surface with the label, after 150ms of hover.

use std::time::Duration;

use gpui_kit::TestSupportExt as _;
use gpui_kit::{div, prelude::*, AnyView, App, Context, SharedString, Window};
use moduo_tokens::Token;

use crate::space::sp;
use crate::text::{self, Family};
use crate::{style, theme};

/// How long a pointer rests before the tooltip shows (the provider's delay in tooltip.tsx).
pub const TOOLTIP_DELAY: Duration = Duration::from_millis(150);

pub struct TooltipView {
    text: SharedString,
}

/// Builds the tooltip view for GPUI's `.tooltip(…)`.
pub fn tooltip(text: SharedString) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
    move |_, cx| cx.new(|_| TooltipView { text: text.clone() }).into()
}

impl Render for TooltipView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let surface = style::floating_surface(
            div()
                .id("tooltip")
                .test_support()
                .aria_label(self.text.clone())
                .px(sp(2.))
                .py(sp(1.))
                .child(self.text.clone()),
            cx,
        );
        text::font(
            surface,
            Family::Sans,
            Token::TextXs,
            Token::FontWeightRegular,
            cx,
        )
        .text_color(theme::color(cx, Token::PopoverForeground))
    }
}
