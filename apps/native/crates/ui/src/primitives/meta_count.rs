//! A count with its icon in a row's metadata (`meta-count.tsx`). Nothing at zero.

use gpui_kit::{div, prelude::*, App, Role, SharedString, Window};
use moduo_tokens::Token;

use crate::icon::{Icon, IconName, IconSize};
use crate::space::sp;
use crate::text::{self, Family};
use crate::theme;

#[derive(IntoElement)]
pub struct MetaCount {
    icon: IconName,
    count: i64,
    /// What one of them is called ("comments"): the spoken text is "3 comments".
    label: SharedString,
}

impl MetaCount {
    pub fn new(icon: IconName, count: i64, label: impl Into<SharedString>) -> Self {
        Self {
            icon,
            count,
            label: label.into(),
        }
    }
}

impl RenderOnce for MetaCount {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        if self.count <= 0 {
            return div().into_any_element();
        }
        let el = div()
            .id(SharedString::from(format!(
                "meta-{}-{}",
                self.icon.name(),
                self.label
            )))
            .flex_none()
            .flex()
            .items_center()
            .gap(sp(0.5))
            .role(Role::Label)
            .aria_label(SharedString::from(format!("{} {}", self.count, self.label)))
            .text_color(theme::color(cx, Token::MutedForeground))
            .child(Icon::new(self.icon).size(IconSize::Xs))
            .child(self.count.to_string());
        text::font(
            el,
            Family::Sans,
            Token::TextXs,
            Token::FontWeightRegular,
            cx,
        )
        .into_any_element()
    }
}
