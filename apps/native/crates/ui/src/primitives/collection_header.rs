//! A section's header inside a pane (`collection-header.tsx`): one small control tall, the label in
//! the display face, a quiet count, one action flush right.

use gpui_kit::{div, prelude::*, AnyElement, App, SharedString, Window};
use moduo_tokens::Token;

use crate::space::sp;
use crate::text::{self, Family};
use crate::theme;

#[derive(IntoElement)]
pub struct CollectionHeader {
    label: SharedString,
    count: Option<SharedString>,
    action: Option<AnyElement>,
}

impl CollectionHeader {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            count: None,
            action: None,
        }
    }

    /// "3" or "1/3".
    pub fn count(mut self, count: impl Into<SharedString>) -> Self {
        self.count = Some(count.into());
        self
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}

impl RenderOnce for CollectionHeader {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let count = self.count.map(|c| {
            text::font(
                div()
                    .flex_none()
                    .text_color(theme::color(cx, Token::SubtleForeground))
                    .child(c),
                Family::Sans,
                Token::TextSm,
                Token::FontWeightRegular,
                cx,
            )
        });
        let el = div()
            .flex()
            .items_center()
            .min_w_0()
            .gap(sp(1.5))
            .h(theme::px(cx, Token::CtrlHSm))
            .text_color(theme::color(cx, Token::Foreground))
            .child(div().min_w_0().truncate().child(self.label))
            .children(count)
            .when_some(self.action, |el, a| {
                el.child(div().ml_auto().flex().flex_none().items_center().child(a))
            });
        text::font(
            el,
            Family::Display,
            Token::TextSm,
            Token::FontWeightMedium,
            cx,
        )
    }
}
