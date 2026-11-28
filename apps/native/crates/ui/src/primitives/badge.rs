//! A small status pill (`badge.tsx`: rounded-full px-2 py-0.5 text-xs font-medium).

use gpui_kit::{div, prelude::*, App, SharedString, Window};
use moduo_tokens::Token;

use crate::space::sp;
use crate::text::{self, Family};
use crate::theme;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BadgeVariant {
    #[default]
    Default,
    Secondary,
    Destructive,
    Outline,
    Success,
    Warning,
    Info,
}

impl BadgeVariant {
    pub const ALL: [BadgeVariant; 7] = [
        Self::Default,
        Self::Secondary,
        Self::Destructive,
        Self::Outline,
        Self::Success,
        Self::Warning,
        Self::Info,
    ];

    /// Fill and text.
    fn colors(self) -> (Option<Token>, Token) {
        match self {
            Self::Default => (Some(Token::Primary), Token::PrimaryForeground),
            Self::Secondary => (Some(Token::StateActive), Token::Foreground),
            Self::Destructive => (Some(Token::Destructive), Token::DestructiveForeground),
            Self::Outline => (None, Token::Foreground),
            Self::Success => (Some(Token::Success), Token::SuccessForeground),
            Self::Warning => (Some(Token::Warning), Token::WarningForeground),
            Self::Info => (Some(Token::Info), Token::InfoForeground),
        }
    }
}

#[derive(IntoElement)]
pub struct Badge {
    text: SharedString,
    variant: BadgeVariant,
}

impl Badge {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self {
            text: text.into(),
            variant: BadgeVariant::default(),
        }
    }

    pub fn variant(mut self, variant: BadgeVariant) -> Self {
        self.variant = variant;
        self
    }
}

impl RenderOnce for Badge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let (fill, fg) = self.variant.colors();
        let el = div()
            .flex_none()
            .flex()
            .items_center()
            .gap(sp(1.))
            .px(sp(2.))
            .py(sp(0.5))
            .rounded_full()
            .border_1()
            .border_color(if self.variant == BadgeVariant::Outline {
                theme::color(cx, Token::Hairline)
            } else {
                gpui_kit::transparent_black()
            })
            .text_color(theme::color(cx, fg))
            .when_some(fill, |el, fill| el.bg(theme::color(cx, fill)))
            .whitespace_nowrap()
            .child(self.text);
        text::font(el, Family::Sans, Token::TextXs, Token::FontWeightMedium, cx)
    }
}
