//! A checkbox (`checkbox.tsx`): 16px, rounded-sm, filled with the accent when checked.

use std::rc::Rc;

use gpui_kit::{prelude::*, svg, App, ElementId, Window};
use moduo_tokens::Token;

use super::pressable::pressable;
use crate::icon::IconName;
use crate::space::sp;
use crate::theme;

type OnChange = Rc<dyn Fn(bool, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Checkbox {
    id: ElementId,
    checked: bool,
    disabled: bool,
    invalid: bool,
    on_change: Option<OnChange>,
}

impl Checkbox {
    pub fn new(id: impl Into<ElementId>, checked: bool) -> Self {
        Self {
            id: id.into(),
            checked,
            disabled: false,
            invalid: false,
            on_change: None,
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        self.invalid = invalid;
        self
    }

    /// Called with the new value.
    pub fn on_change(mut self, f: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for Checkbox {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let next = !self.checked;
        let press = self.on_change.filter(|_| !self.disabled).map(|f| {
            Rc::new(move |w: &mut Window, cx: &mut App| f(next, w, cx)) as super::pressable::OnPress
        });
        let (el, _) = pressable(self.id, self.disabled, press, window, cx);
        let edge = if self.invalid {
            Token::Destructive
        } else if self.checked {
            Token::Primary
        } else {
            Token::Border
        };
        el.flex_none()
            .flex()
            .items_center()
            .justify_center()
            .size(sp(4.))
            .rounded(theme::px(cx, Token::RadiusSm))
            .border_1()
            .border_color(theme::color(cx, edge))
            .bg(theme::color(
                cx,
                if self.checked {
                    Token::Primary
                } else {
                    Token::Input
                },
            ))
            .when(self.disabled, |el| el.opacity(0.5))
            .when(self.checked, |el| {
                el.child(
                    svg()
                        .path(IconName::Check.path())
                        .size(sp(3.5))
                        .text_color(theme::color(cx, Token::PrimaryForeground)),
                )
            })
    }
}
