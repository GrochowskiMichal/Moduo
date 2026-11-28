//! The five motion patterns of the web app (`apps/app/src/global.css`, "motion patterns"), from
//! tokens. Under reduced motion every movement token is 0 and `--motion-grow` is 1, so each
//! pattern becomes a plain fade, exactly as in the browser.

use std::time::Duration;

use moduo_tokens::{Resolved, Token};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pattern {
    /// A panel slides and fades in (`.motion-panel`).
    Panel,
    /// A popover, menu or dialog grows from where it opened (`.motion-pop`).
    Pop,
    /// A row opens its height and fades in (`.motion-row`).
    Row,
    /// Views crossfade (`.motion-view`).
    View,
    /// A change a key made appears (`.motion-key`).
    Key,
}

/// How one pattern arrives.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MotionSpec {
    /// Opacity, from 0.
    pub fade: Duration,
    /// Scale, slide or height.
    pub movement: Duration,
    /// The scale it grows from (1 means none).
    pub scale_from: f32,
    /// The distance it slides from, in pixels (0 means none).
    pub shift_from: f32,
    /// Arrivals ease out (`--ease-out`): cubic-bezier control points.
    pub easing: [f32; 4],
}

fn ms(t: &Resolved, token: Token) -> Duration {
    crate::theme::duration_of(t, token)
}

pub fn spec(pattern: Pattern, t: &Resolved) -> MotionSpec {
    let fade = ms(t, Token::MotionFade);
    let none = MotionSpec {
        fade,
        movement: Duration::ZERO,
        scale_from: 1.0,
        shift_from: 0.0,
        easing: t.bezier(Token::EaseOut).unwrap_or([0.0, 0.0, 1.0, 1.0]),
    };
    match pattern {
        Pattern::Panel => MotionSpec {
            movement: ms(t, Token::MotionSlow),
            shift_from: t.px(Token::MotionShift).unwrap_or_default(),
            ..none
        },
        Pattern::Pop => MotionSpec {
            movement: ms(t, Token::MotionBase),
            scale_from: t.number(Token::MotionGrow).unwrap_or(1.0),
            ..none
        },
        Pattern::Row => MotionSpec {
            movement: ms(t, Token::MotionBase),
            ..none
        },
        // All opacity: --motion-slow, which reduced motion zeroes, so it keeps the short fade.
        Pattern::View => {
            let slow = ms(t, Token::MotionSlow);
            MotionSpec {
                fade: if slow.is_zero() { fade } else { slow },
                ..none
            }
        }
        Pattern::Key => MotionSpec {
            fade: ms(t, Token::MotionFast),
            ..none
        },
    }
}
