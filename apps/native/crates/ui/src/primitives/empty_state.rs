//! What a place shows when it has nothing (`empty-state.tsx`): an icon, a title, a description, an
//! action and a quiet hint, centred.

use gpui_kit::{div, prelude::*, AnyElement, App, SharedString, Window};
use moduo_tokens::Token;

use crate::icon::{Icon, IconName, IconSize};
use crate::space::sp;
use crate::text::{self, Family};
use crate::theme;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EmptySize {
    /// Fills its place and centres.
    #[default]
    Page,
    /// Sits in a section.
    Inline,
}

#[derive(IntoElement)]
pub struct EmptyState {
    title: SharedString,
    icon: Option<IconName>,
    description: Option<SharedString>,
    action: Option<AnyElement>,
    hint: Option<SharedString>,
    size: EmptySize,
}

impl EmptyState {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            icon: None,
            description: None,
            action: None,
            hint: None,
            size: EmptySize::default(),
        }
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn description(mut self, text: impl Into<SharedString>) -> Self {
        self.description = Some(text.into());
        self
    }

    pub fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }

    pub fn hint(mut self, text: impl Into<SharedString>) -> Self {
        self.hint = Some(text.into());
        self
    }

    pub fn size(mut self, size: EmptySize) -> Self {
        self.size = size;
        self
    }
}

impl RenderOnce for EmptyState {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let line = |t: SharedString, size: Token, color: Token, cx: &App| {
            text::font(
                div()
                    .text_color(theme::color(cx, color))
                    .text_center()
                    .child(t),
                Family::Sans,
                size,
                Token::FontWeightRegular,
                cx,
            )
        };
        let el = div()
            .flex()
            .flex_col()
            .items_center()
            .gap(sp(2.))
            .text_center();
        let el = match self.size {
            EmptySize::Page => el.size_full().justify_center().px(sp(6.)),
            EmptySize::Inline => el.px(sp(3.)).py(sp(4.)),
        };
        el.when_some(self.icon, |el, icon| {
            el.child(
                Icon::new(icon)
                    .size(IconSize::Lg)
                    .color(theme::color(cx, Token::SubtleForeground)),
            )
        })
        .child(line(self.title, Token::TextSm, Token::Foreground, cx))
        .when_some(self.description, |el, d| {
            el.child(line(d, Token::TextXs, Token::MutedForeground, cx))
        })
        .when_some(self.action, |el, a| el.child(div().mt(sp(1.)).child(a)))
        .when_some(self.hint, |el, h| {
            el.child(line(h, Token::Text2xs, Token::SubtleForeground, cx))
        })
    }
}
