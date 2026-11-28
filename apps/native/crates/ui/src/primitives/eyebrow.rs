//! A section label (`eyebrow.tsx`: font-sans text-2xs font-medium uppercase tracking-wide), for
//! fixed chrome only (`docs/DESIGN_RULES.md` R12).

use gpui_kit::{div, prelude::*, App, SharedString, Window};
use moduo_tokens::Token;

use crate::text::{self, Family};
use crate::theme;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EyebrowTone {
    #[default]
    Default,
    /// At 70% of muted.
    Muted,
    /// A tag-like label: regular weight, 70% muted.
    Tag,
    /// Louder: semibold.
    Strong,
    /// The colour comes from the parent.
    Inherit,
}

impl EyebrowTone {
    pub const ALL: [EyebrowTone; 5] = [
        Self::Default,
        Self::Muted,
        Self::Tag,
        Self::Strong,
        Self::Inherit,
    ];
}

#[derive(IntoElement)]
pub struct Eyebrow {
    text: SharedString,
    tone: EyebrowTone,
}

impl Eyebrow {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self {
            text: text.into(),
            tone: EyebrowTone::default(),
        }
    }

    pub fn tone(mut self, tone: EyebrowTone) -> Self {
        self.tone = tone;
        self
    }
}

impl RenderOnce for Eyebrow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let weight = match self.tone {
            EyebrowTone::Tag => Token::FontWeightRegular,
            EyebrowTone::Strong => Token::FontWeightSemibold,
            _ => Token::FontWeightMedium,
        };
        let el = div().child(self.text.to_uppercase());
        let el = match self.tone {
            EyebrowTone::Default | EyebrowTone::Strong => {
                el.text_color(theme::color(cx, Token::MutedForeground))
            }
            EyebrowTone::Muted | EyebrowTone::Tag => {
                el.text_color(theme::color_alpha(cx, Token::MutedForeground, 70.0))
            }
            EyebrowTone::Inherit => el,
        };
        text::font(el, Family::Sans, Token::Text2xs, weight, cx)
    }
}
