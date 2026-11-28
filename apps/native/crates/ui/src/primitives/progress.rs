//! A thin progress bar (`progress.tsx`): a hairline track, the done part in muted foreground.

use gpui_kit::{div, prelude::*, relative, App, Role, SharedString, Window};
use moduo_tokens::Token;

use crate::space::sp;
use crate::theme;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ProgressSize {
    /// h-0.5
    Sm,
    /// h-1.5
    #[default]
    Md,
}

#[derive(IntoElement)]
pub struct Progress {
    value: f32,
    max: f32,
    label: SharedString,
    size: ProgressSize,
}

impl Progress {
    /// `label` is required: a bare bar tells a screen reader nothing.
    pub fn new(value: f32, max: f32, label: impl Into<SharedString>) -> Self {
        Self {
            value,
            max,
            label: label.into(),
            size: ProgressSize::default(),
        }
    }

    pub fn size(mut self, size: ProgressSize) -> Self {
        self.size = size;
        self
    }

    /// The done fraction, clamped into 0–1; a non-positive max is an empty bar.
    pub fn fraction(value: f32, max: f32) -> f32 {
        if !max.is_finite() || max <= 0.0 {
            return 0.0;
        }
        (value.clamp(0.0, max)) / max
    }
}

impl RenderOnce for Progress {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let height = match self.size {
            ProgressSize::Sm => sp(0.5),
            ProgressSize::Md => sp(1.5),
        };
        div()
            .id(SharedString::from(format!("progress-{}", self.label)))
            .w_full()
            .h(height)
            .overflow_hidden()
            .rounded_full()
            .role(Role::ProgressIndicator)
            .aria_label(self.label)
            .bg(theme::color(cx, Token::Hairline))
            .child(
                div()
                    .h_full()
                    .rounded_full()
                    .bg(theme::color(cx, Token::MutedForeground))
                    .w(relative(Self::fraction(self.value, self.max))),
            )
    }
}
