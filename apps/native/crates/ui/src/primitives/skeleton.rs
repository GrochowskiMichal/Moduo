//! A placeholder while something loads (`skeleton.tsx`: rounded-md bg-state-active, pulsing;
//! still under reduced motion).

use std::time::Duration;

use gpui_kit::{div, prelude::*, Animation, AnimationExt, App, Window};
use moduo_tokens::Token;

use crate::space::sp;
use crate::theme;

#[derive(IntoElement)]
pub struct Skeleton {
    id: &'static str,
}

impl Skeleton {
    pub fn new() -> Self {
        Self { id: "skeleton" }
    }

    /// A distinct id when several skeletons animate side by side.
    pub fn id(mut self, id: &'static str) -> Self {
        self.id = id;
        self
    }

    /// Whether it pulses now: not under reduced motion (the movement tokens read 0 there).
    pub fn pulses(cx: &App) -> bool {
        !theme::duration(cx, Token::MotionBase).is_zero()
    }
}

impl Default for Skeleton {
    fn default() -> Self {
        Self::new()
    }
}

impl RenderOnce for Skeleton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let block = div()
            .w_full()
            .h(sp(4.))
            .rounded(theme::px(cx, Token::RadiusMd))
            .bg(theme::color(cx, Token::StateActive));
        if !Self::pulses(cx) {
            return block.into_any_element();
        }
        // Tailwind's animate-pulse: 2s, opacity 1 → 0.5 → 1.
        let period = Duration::from_secs(2); // design-literal: Tailwind's animate-pulse period
        block
            .with_animation(self.id, Animation::new(period).repeat(), |el, t| {
                let wave = (t * std::f32::consts::TAU).cos() * 0.25 + 0.75;
                el.opacity(wave)
            })
            .into_any_element()
    }
}
