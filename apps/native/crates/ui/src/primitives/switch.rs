//! A switch (`switch.tsx`): a pill track, the accent when on, the thumb sliding across.

use std::rc::Rc;

use gpui_kit::{div, prelude::*, App, ElementId, Window};
use moduo_tokens::Token;

use super::pressable::pressable;
use crate::space::sp;
use crate::theme;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SwitchSize {
    /// h-4 w-7, a 12px thumb (section headers).
    Sm,
    /// h-5 w-9, a 16px thumb.
    #[default]
    Default,
}

type OnChange = Rc<dyn Fn(bool, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Switch {
    id: ElementId,
    on: bool,
    size: SwitchSize,
    disabled: bool,
    on_change: Option<OnChange>,
}

impl Switch {
    pub fn new(id: impl Into<ElementId>, on: bool) -> Self {
        Self {
            id: id.into(),
            on,
            size: SwitchSize::default(),
            disabled: false,
            on_change: None,
        }
    }

    pub fn size(mut self, size: SwitchSize) -> Self {
        self.size = size;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_change(mut self, f: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for Switch {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let next = !self.on;
        let press = self.on_change.filter(|_| !self.disabled).map(|f| {
            Rc::new(move |w: &mut Window, cx: &mut App| f(next, w, cx)) as super::pressable::OnPress
        });
        let (el, _) = pressable(self.id, self.disabled, press, window, cx);
        let (w, h, thumb) = match self.size {
            SwitchSize::Sm => (sp(7.), sp(4.), sp(3.)),
            SwitchSize::Default => (sp(9.), sp(5.), sp(4.)),
        };
        // translate-x-px off, translate-x-[calc(100%-2px)] on, inside a 1px transparent border.
        let edge = sp(0.25);
        let offset = if self.on { w - thumb - edge * 3. } else { edge };
        el.flex_none()
            .flex()
            .items_center()
            .w(w)
            .h(h)
            .rounded_full()
            .border_1()
            .border_color(gpui_kit::transparent_black())
            .bg(theme::color(
                cx,
                if self.on {
                    Token::Primary
                } else {
                    Token::Muted
                },
            ))
            .when(self.disabled, |el| el.opacity(0.5))
            .child(div().ml(offset).size(thumb).rounded_full().bg(theme::color(
                cx,
                if self.on {
                    Token::PrimaryForeground
                } else {
                    Token::Foreground
                },
            )))
    }
}
