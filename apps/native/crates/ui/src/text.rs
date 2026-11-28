//! Type roles (`docs/DESIGN_RULES.md` R4, R9): what a piece of text is decides its face, size,
//! weight and leading, all from tokens. One font axis moves every role together.

use gpui_kit::{prelude::*, relative, App, FontWeight};
use moduo_tokens::{Resolved, Token};

/// Draws an element's text in a role: face, size, weight and leading from tokens. GPUI has no
/// letter spacing, so `TextStyle::tracking` and `uppercase` are for the caller (upper-case the
/// string; tracking waits for GPUI).
pub fn styled<E: Styled>(element: E, role: TextRole, cx: &App) -> E {
    let s = role.style(crate::theme::tokens(cx));
    element
        .font_family(s.face)
        .text_size(gpui_kit::px(s.size))
        .font_weight(FontWeight(s.weight))
        .line_height(relative(s.line_height))
}

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
    /// Page headings (`time-report-sheet.tsx`, `view-export-menu.tsx`: `font-display text-2xl
    /// font-semibold`).
    Heading,
}

/// A role's text, resolved.
#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
    /// The first family of the token's stack, as the web app names it.
    pub family: String,
    /// The face to draw with: the first family in the stack the app bundles, else Geist, so a
    /// font choice the app can't draw yet falls back to the default (specs/native-foundation.md).
    pub face: String,
    /// Pixels.
    pub size: f32,
    pub weight: f32,
    /// A multiple of the size.
    pub line_height: f32,
    /// Letter spacing in pixels.
    pub tracking: f32,
    pub uppercase: bool,
}

// Line heights: the web app keeps Tailwind's per-size companions (text-base 1.5, text-sm 1.43,
// text-2xl 1.33; an eyebrow inherits its parent's). The nearest leading tokens stand in: normal for
// base and inherited, normal for mono (1.5 against 1.43), snug for headings (1.35 against 1.33).
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
                Token::LeadingNormal,
                None,
                false,
            ),
            TextRole::Eyebrow => (
                Token::FontBody,
                Token::Text2xs,
                Token::FontWeightMedium,
                Token::LeadingNormal,
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
                Token::LeadingSnug,
                None,
                false,
            ),
        };
        // Every token named here exists (`Token` is generated from them); a missing value reads 0.
        let size = t.px(size).unwrap_or_default();
        let stack = t.fonts(family).unwrap_or_default();
        let bundled = crate::fonts::FAMILIES;
        TextStyle {
            family: stack.first().map(|s| s.to_string()).unwrap_or_default(),
            face: stack
                .iter()
                .find(|f| bundled.contains(f))
                .unwrap_or(&bundled[0])
                .to_string(),
            size,
            weight: t.number(weight).unwrap_or_default(),
            line_height: t.number(leading).unwrap_or_default(),
            // Tracking tokens are in em: they scale with the text they space.
            tracking: tracking.and_then(|token| t.em(token)).unwrap_or_default() * size,
            uppercase,
        }
    }
}
