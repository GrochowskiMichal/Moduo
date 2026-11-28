//! The button (`button.tsx`): six variants, four sizes, pressed, loading and invalid states.
//! Heights are the control rungs (`--ctrl-h-sm` / `--ctrl-h` / `--ctrl-h-lg`); the text stays
//! 14px on every rung (`docs/DESIGN_RULES.md` R1).

use std::rc::Rc;
use std::time::Duration;

use gpui_kit::{
    div, prelude::*, svg, Animation, AnimationExt, App, ElementId, Hsla, SharedString,
    Transformation, Window,
};
use moduo_tokens::Token;

use super::pressable::{pressable, OnPress};
use crate::icon::{Icon, IconName, IconSize};
use crate::space::sp;
use crate::text::{self, Family};
use crate::theme;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonVariant {
    /// The one primary action of a surface (accent).
    #[default]
    Default,
    Secondary,
    Outline,
    Ghost,
    Destructive,
    Link,
}

impl ButtonVariant {
    pub const ALL: [ButtonVariant; 6] = [
        Self::Default,
        Self::Secondary,
        Self::Outline,
        Self::Ghost,
        Self::Destructive,
        Self::Link,
    ];
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonSize {
    Sm,
    #[default]
    Md,
    Lg,
    /// Square, an icon alone.
    Icon,
}

impl ButtonSize {
    pub const ALL: [ButtonSize; 4] = [Self::Sm, Self::Md, Self::Lg, Self::Icon];
}

#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    label: Option<SharedString>,
    icon: Option<IconName>,
    variant: ButtonVariant,
    size: ButtonSize,
    pressed: bool,
    loading: bool,
    disabled: bool,
    invalid: bool,
    on_click: Option<OnPress>,
}

impl Button {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: Some(label.into()),
            icon: None,
            variant: ButtonVariant::default(),
            size: ButtonSize::default(),
            pressed: false,
            loading: false,
            disabled: false,
            invalid: false,
            on_click: None,
        }
    }

    /// A square icon button; `label` is its accessible name.
    pub fn icon(id: impl Into<ElementId>, icon: IconName, label: impl Into<SharedString>) -> Self {
        let mut b = Self::new(id, label);
        b.icon = Some(icon);
        b.size = ButtonSize::Icon;
        b.variant = ButtonVariant::Ghost;
        b
    }

    /// An icon before the label.
    pub fn leading(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: ButtonSize) -> Self {
        self.size = size;
        self
    }

    /// A toggle that is on (`aria-pressed`).
    pub fn pressed(mut self, pressed: bool) -> Self {
        self.pressed = pressed;
        self
    }

    /// Busy: a spinner takes the icon's place and presses are ignored; the width stays.
    pub fn loading(mut self, loading: bool) -> Self {
        self.loading = loading;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        self.invalid = invalid;
        self
    }

    pub fn on_click(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(f));
        self
    }

    /// The fill at rest (None is transparent).
    pub fn fill(variant: ButtonVariant, pressed: bool, cx: &App) -> Option<Hsla> {
        let c = |t: Token| theme::color(cx, t);
        match variant {
            ButtonVariant::Default => Some(c(Token::Primary)),
            ButtonVariant::Secondary => Some(c(Token::StateActive)),
            ButtonVariant::Destructive => Some(c(Token::Destructive)),
            ButtonVariant::Outline | ButtonVariant::Ghost if pressed => Some(c(Token::StateActive)),
            ButtonVariant::Outline | ButtonVariant::Ghost | ButtonVariant::Link => None,
        }
    }

    /// Hover and press fills: one step up the ladder for a filled button (DESIGN_RULES).
    fn hover_active(
        variant: ButtonVariant,
        pressed: bool,
        cx: &App,
    ) -> (Option<Hsla>, Option<Hsla>) {
        let c = |t: Token| theme::color(cx, t);
        match variant {
            ButtonVariant::Default => (
                Some(theme::color_alpha(cx, Token::Primary, 90.0)),
                Some(theme::color_alpha(cx, Token::Primary, 80.0)),
            ),
            ButtonVariant::Secondary => (
                Some(c(Token::StateActiveHover)),
                Some(c(Token::StateActiveHover)),
            ),
            ButtonVariant::Destructive => {
                (Some(theme::color_alpha(cx, Token::Destructive, 90.0)), None)
            }
            ButtonVariant::Outline | ButtonVariant::Ghost if pressed => (
                Some(c(Token::StateActiveHover)),
                Some(c(Token::StateActiveHover)),
            ),
            ButtonVariant::Outline | ButtonVariant::Ghost => {
                (Some(c(Token::StateHover)), Some(c(Token::StateActive)))
            }
            ButtonVariant::Link => (None, None),
        }
    }

    fn foreground(variant: ButtonVariant) -> Token {
        match variant {
            ButtonVariant::Default => Token::PrimaryForeground,
            ButtonVariant::Destructive => Token::DestructiveForeground,
            ButtonVariant::Link => Token::Primary,
            _ => Token::Foreground,
        }
    }
}

impl RenderOnce for Button {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let busy = self.loading || self.disabled;
        let press = if busy { None } else { self.on_click.clone() };
        let (el, _) = pressable(self.id.clone(), self.disabled, press, window, cx);
        let height = match self.size {
            ButtonSize::Sm => theme::px(cx, Token::CtrlHSm),
            ButtonSize::Md | ButtonSize::Icon => theme::px(cx, Token::CtrlH),
            ButtonSize::Lg => theme::px(cx, Token::CtrlHLg),
        };
        let icon_size = if self.size == ButtonSize::Lg {
            IconSize::Md
        } else {
            IconSize::Sm
        };
        let (hover, active) = Self::hover_active(self.variant, self.pressed, cx);
        let el = el
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .gap(sp(1.5))
            .whitespace_nowrap()
            .h(height)
            .rounded(theme::px(cx, Token::RadiusMd))
            .text_color(theme::color(cx, Self::foreground(self.variant)))
            .when_some(Self::fill(self.variant, self.pressed, cx), |el, fill| {
                el.bg(fill)
            })
            .when(self.variant == ButtonVariant::Outline, |el| {
                el.border_1()
                    .border_color(theme::color(cx, Token::Hairline))
            })
            .when(self.disabled, |el| el.opacity(0.5))
            .when(self.invalid, |el| el.shadow(vec![invalid_ring(cx)]));
        let el = match self.size {
            ButtonSize::Icon => el.w(height),
            ButtonSize::Sm => el.px(sp(2.5)),
            ButtonSize::Md => el.px(sp(4.)),
            ButtonSize::Lg => el.px(sp(6.)),
        };
        let el = if busy {
            el
        } else {
            let el = match hover {
                Some(h) => el.hover(move |s| s.bg(h)),
                None if self.variant == ButtonVariant::Link => el.hover(|s| s.underline()),
                None => el,
            };
            match active {
                Some(a) => el.active(move |s| s.bg(a)),
                None => el,
            }
        };
        let fg = theme::color(cx, Self::foreground(self.variant));
        let label = (self.size != ButtonSize::Icon)
            .then_some(self.label)
            .flatten();
        // Loading keeps the width: a spinner takes the icon's place, or, with no icon, sits over the
        // label, which stays laid out but unseen.
        let el = if !self.loading {
            el.children(self.icon.map(|i| Icon::new(i).size(icon_size)))
                .children(label)
        } else if self.icon.is_some() || label.is_none() {
            el.child(spinner(icon_size, fg, cx)).children(label)
        } else {
            el.relative()
                .child(div().invisible().children(label))
                .child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(spinner(icon_size, fg, cx)),
                )
        };
        text::font(
            el,
            Family::Display,
            Token::TextBase,
            Token::FontWeightMedium,
            cx,
        )
    }
}

/// `aria-invalid:ring-2 ring-destructive/40`.
fn invalid_ring(cx: &App) -> gpui_kit::BoxShadow {
    let mut ring = crate::focus::ring_shadow(cx);
    ring.color = theme::color_alpha(cx, Token::Destructive, 40.0);
    ring
}

/// A turning loader (still under reduced motion, where it simply shows).
fn spinner(size: IconSize, color: Hsla, cx: &App) -> impl IntoElement {
    let px = gpui_kit::px(size.px(theme::tokens(cx)));
    let icon = svg()
        .path(IconName::Loader2.path())
        .size(px)
        .flex_none()
        .text_color(color);
    if theme::duration(cx, Token::MotionBase).is_zero() {
        return icon.into_any_element();
    }
    let turn = Duration::from_millis(1000); // design-literal: Tailwind's animate-spin period
    icon.with_animation(
        "button-spinner",
        Animation::new(turn).repeat(),
        |icon, t| icon.with_transformation(Transformation::rotate(gpui_kit::percentage(t))),
    )
    .into_any_element()
}
