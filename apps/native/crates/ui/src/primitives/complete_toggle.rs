//! The done circle (`complete-toggle.tsx`): a 16px ring that fills with the accent and pops its check
//! in when a task is done — the one sanctioned delight (`check-pop`, global.css). Under reduced
//! motion the check just appears.

use std::rc::Rc;

use gpui_kit::{prelude::*, svg, Animation, AnimationExt, App, ElementId, Transformation, Window};
use moduo_tokens::Token;

use super::pressable::{pressable, OnPress};
use crate::icon::IconName;
use crate::space::sp;
use crate::style;
use crate::theme;

#[derive(IntoElement)]
pub struct CompleteToggle {
    id: ElementId,
    done: bool,
    disabled: bool,
    on_toggle: Option<OnPress>,
}

/// What the toggle remembers between renders: whether it was done, and how many times it became
/// done (each time is a new pop).
struct Seen {
    done: bool,
    pops: usize,
}

impl CompleteToggle {
    pub fn new(id: impl Into<ElementId>, done: bool) -> Self {
        Self {
            id: id.into(),
            done,
            disabled: false,
            on_toggle: None,
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_toggle(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Rc::new(f));
        self
    }

    /// Whether the check pops when it appears (not under reduced motion).
    pub fn pops(cx: &App) -> bool {
        !theme::duration(cx, Token::MotionBase).is_zero()
    }
}

impl RenderOnce for CompleteToggle {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let seen_id = ElementId::Name(format!("{:?}-seen", self.id).into());
        let seen = window.use_keyed_state(seen_id, cx, |_, _| Seen {
            done: self.done,
            pops: 0,
        });
        let became_done = seen.read(cx).done != self.done && self.done;
        let pops = seen.update(cx, |s, _| {
            if became_done {
                s.pops += 1;
            }
            s.done = self.done;
            s.pops
        });
        let press = if self.disabled { None } else { self.on_toggle };
        let (el, _) = pressable(self.id.clone(), self.disabled, press, window, cx);
        let el = el
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .size(sp(4.))
            .rounded_full()
            .border_1()
            .when(self.disabled, |el| el.opacity(0.5));
        let el = style::hit_min_pad(el, cx);
        let el = if self.done {
            el.border_color(theme::color(cx, Token::Primary))
                .bg(theme::color(cx, Token::Primary))
        } else {
            let edge = theme::color(cx, Token::Foreground);
            el.border_color(theme::color_alpha(cx, Token::MutedForeground, 50.0))
                .when(!self.disabled, |el| el.hover(move |s| s.border_color(edge)))
        };
        if !self.done {
            return el;
        }
        let check = svg()
            .path(IconName::Check.path())
            .size(sp(2.5))
            .text_color(theme::color(cx, Token::PrimaryForeground));
        if !Self::pops(cx) || pops == 0 {
            return el.child(check);
        }
        // check-pop: 0.5 → 1.15 → 1 over --motion-base on --ease-spring.
        let duration = theme::duration(cx, Token::MotionBase);
        let spring = theme::tokens(cx)
            .bezier(Token::EaseSpring)
            .unwrap_or([0.0, 0.0, 1.0, 1.0]);
        let id = ElementId::Name(format!("{:?}-pop-{pops}", self.id).into());
        el.child(check.with_animation(
            id,
            Animation::new(duration).with_easing(move |t| bezier(spring, t)),
            |c, t| {
                let scale = if t < 0.6 {
                    0.5 + (1.15 - 0.5) * (t / 0.6)
                } else {
                    1.15 - 0.15 * ((t - 0.6) / 0.4)
                };
                c.with_transformation(Transformation::scale(gpui_kit::size(scale, scale)))
            },
        ))
    }
}

/// A CSS cubic-bezier easing at `t` (x solved by bisection, then y).
fn bezier([x1, y1, x2, y2]: [f32; 4], t: f32) -> f32 {
    let at = |a: f32, b: f32, s: f32| {
        3.0 * a * s * (1.0 - s).powi(2) + 3.0 * b * s * s * (1.0 - s) + s.powi(3)
    };
    let (mut lo, mut hi) = (0.0_f32, 1.0_f32);
    for _ in 0..24 {
        let mid = (lo + hi) / 2.0;
        if at(x1, x2, mid) < t {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    at(y1, y2, (lo + hi) / 2.0)
}
