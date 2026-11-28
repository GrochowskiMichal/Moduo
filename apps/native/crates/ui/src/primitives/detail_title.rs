//! A detail pane's title (`detail-title.tsx`: font-sans; rail text-md medium, lead text-lg
//! semibold snug, page text-2xl).

use gpui_kit::{div, prelude::*, relative, App, SharedString, Window};
use moduo_tokens::Token;

use crate::text::{self, Family};
use crate::theme;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DetailTitleSize {
    #[default]
    Rail,
    Lead,
    Page,
}

#[derive(IntoElement)]
pub struct DetailTitle {
    text: SharedString,
    size: DetailTitleSize,
}

impl DetailTitle {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self {
            text: text.into(),
            size: DetailTitleSize::default(),
        }
    }

    pub fn size(mut self, size: DetailTitleSize) -> Self {
        self.size = size;
        self
    }
}

impl RenderOnce for DetailTitle {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let (size, weight) = match self.size {
            DetailTitleSize::Rail => (Token::TextMd, Token::FontWeightMedium),
            DetailTitleSize::Lead => (Token::TextLg, Token::FontWeightSemibold),
            DetailTitleSize::Page => (Token::Text2xl, Token::FontWeightRegular),
        };
        let el = div()
            .text_color(theme::color(cx, Token::Foreground))
            .child(self.text);
        let el = match self.size {
            DetailTitleSize::Lead => el.line_height(relative(
                theme::tokens(cx)
                    .number(Token::LeadingSnug)
                    .unwrap_or_default(),
            )),
            _ => el,
        };
        text::font(el, Family::Sans, size, weight, cx)
    }
}
