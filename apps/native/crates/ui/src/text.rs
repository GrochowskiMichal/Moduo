//! Type roles (`docs/DESIGN_RULES.md` R4, R9): what a piece of text is decides its face, size,
//! weight and leading, all from tokens. One font axis moves every role together.

use moduo_tokens::{Resolved, Token};

/// What a piece of text is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextRole {
    /// Content: titles, values, descriptions, metadata (`font-sans text-base`).
    Body,
    /// Chrome: control labels and button text (`font-display text-base font-medium`).
    Chrome,
    /// Section labels (`eyebrow.tsx`: `font-sans text-2xs font-medium uppercase tracking-wide`).
    Eyebrow,
    /// Code only (`font-mono text-sm`).
    Mono,
    /// Page headings (`detail-title.tsx` page: `text-2xl`, display face).
    Heading,
}

/// A role's text, resolved.
#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
    /// The first family of the stack; GPUI falls back to the system face when it is not bundled.
    pub family: String,
    /// Pixels.
    pub size: f32,
    pub weight: f32,
    /// A multiple of the size.
    pub line_height: f32,
    /// Letter spacing in pixels.
    pub tracking: f32,
    pub uppercase: bool,
}

impl TextRole {
    pub fn style(self, t: &Resolved) -> TextStyle {
        let (family, size, weight, leading, tracking, uppercase) = match self {
            TextRole::Body => (
                Token::FontBody,
                Token::TextBase,
                Token::FontWeightRegular,
                Token::LeadingNormal,
                None,
                false,
            ),
            TextRole::Chrome => (
                Token::FontDisplay,
                Token::TextBase,
                Token::FontWeightMedium,
                Token::LeadingSnug,
                None,
                false,
            ),
            TextRole::Eyebrow => (
                Token::FontBody,
                Token::Text2xs,
                Token::FontWeightMedium,
                Token::LeadingTight,
                Some(Token::TrackingWide),
                true,
            ),
            TextRole::Mono => (
                Token::FontMono,
                Token::TextSm,
                Token::FontWeightRegular,
                Token::LeadingNormal,
                None,
                false,
            ),
            TextRole::Heading => (
                Token::FontDisplay,
                Token::Text2xl,
                Token::FontWeightSemibold,
                Token::LeadingTight,
                Some(Token::TrackingTight),
                false,
            ),
        };
        // Every token named here exists (`Token` is generated from them); a missing value reads 0.
        let size = t.px(size).unwrap_or_default();
        TextStyle {
            family: t
                .fonts(family)
                .and_then(|f| f.first().map(|s| s.to_string()))
                .unwrap_or_default(),
            size,
            weight: t.number(weight).unwrap_or_default(),
            line_height: t.number(leading).unwrap_or_default(),
            // Tracking tokens are in em: they scale with the text they space.
            tracking: tracking.and_then(|token| t.em(token)).unwrap_or_default() * size,
            uppercase,
        }
    }
}
