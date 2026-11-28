//! A radio group (`radio-group.tsx`): one Tab stop; the arrows move the choice and wrap, as Radix
//! does. Each item is a 16px circle with the accent dot when chosen.

use std::rc::Rc;

use gpui_kit::{div, prelude::*, App, ElementId, KeyDownEvent, SharedString, Window};
use moduo_tokens::Token;

use crate::space::sp;
use crate::text::{self, Family};
use crate::theme;

type OnChange = Rc<dyn Fn(&str, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct RadioGroup {
    id: ElementId,
    selected: SharedString,
    options: Vec<(SharedString, SharedString)>,
    disabled: bool,
    on_change: Option<OnChange>,
}

impl RadioGroup {
    pub fn new(id: impl Into<ElementId>, selected: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            selected: selected.into(),
            options: Vec::new(),
            disabled: false,
            on_change: None,
        }
    }

    /// One choice: its value and its label.
    pub fn option(
        mut self,
        value: impl Into<SharedString>,
        label: impl Into<SharedString>,
    ) -> Self {
        self.options.push((value.into(), label.into()));
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_change(mut self, f: impl Fn(&str, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for RadioGroup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let handle = window
            .use_keyed_state(self.id.clone(), cx, |_, cx| cx.focus_handle())
            .read(cx)
            .clone();
        let values: Vec<SharedString> = self.options.iter().map(|(v, _)| v.clone()).collect();
        let current = values.iter().position(|v| *v == self.selected).unwrap_or(0);
        let change = self.on_change.clone().filter(|_| !self.disabled);
        let group = div()
            .id(self.id.clone())
            .track_focus(&handle)
            .flex()
            .flex_col()
            .gap(sp(3.))
            .when(self.disabled, |el| el.opacity(0.5));
        let group = if self.disabled {
            group
        } else {
            crate::focus::ring(group.tab_index(0), cx)
        };
        let group = match change.clone() {
            Some(change) => group.on_key_down(move |e: &KeyDownEvent, window, cx| {
                let n = values.len();
                if n == 0 || e.keystroke.modifiers.modified() {
                    return;
                }
                let step: isize = match e.keystroke.key.as_str() {
                    "down" | "right" => 1,
                    "up" | "left" => -1,
                    _ => return,
                };
                let next = (current as isize + step).rem_euclid(n as isize) as usize;
                cx.stop_propagation();
                change(&values[next], window, cx);
            }),
            None => group,
        };
        let mut group = group;
        for (index, (value, label)) in self.options.into_iter().enumerate() {
            let chosen = index == current && value == self.selected;
            let circle = div()
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .size(sp(4.))
                .rounded_full()
                .border_1()
                .border_color(theme::color(
                    cx,
                    if chosen {
                        Token::Primary
                    } else {
                        Token::Border
                    },
                ))
                .bg(theme::color(cx, Token::Input))
                .when(chosen, |el| {
                    el.child(
                        div()
                            .size(sp(2.))
                            .rounded_full()
                            .bg(theme::color(cx, Token::Primary)),
                    )
                });
            let focus = handle.clone();
            let change = change.clone();
            let item = div()
                .id(ElementId::Name(format!("{value}").into()))
                .flex()
                .items_center()
                .gap(sp(2.))
                .child(circle)
                .child(label)
                .when_some(change, move |el, change| {
                    el.on_click(move |_, window, cx| {
                        focus.focus(window, cx);
                        change(&value, window, cx);
                    })
                });
            group = group.child(text::font(
                item,
                Family::Sans,
                Token::TextSm,
                Token::FontWeightRegular,
                cx,
            ));
        }
        group
    }
}
