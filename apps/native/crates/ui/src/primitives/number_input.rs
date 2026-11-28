//! A number field (`NumberInput` in input.tsx): ↑ and ↓ step it inside its range, typing commits a
//! whole number on Enter or blur, text that is not a number reverts, and a typed number is clamped.

use gpui_kit::{
    prelude::*, Context, ElementId, Entity, EventEmitter, KeyDownEvent, Subscription, Window,
};

use super::text_field::{TextField, TextFieldEvent};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NumberEvent {
    /// A whole number in range, or None when cleared.
    Commit(Option<i64>),
}

pub struct NumberInput {
    field: Entity<TextField>,
    value: Option<i64>,
    min: i64,
    max: i64,
    step: i64,
    _subscription: Subscription,
}

impl EventEmitter<NumberEvent> for NumberInput {}

impl NumberInput {
    pub fn new(
        id: impl Into<ElementId>,
        value: Option<i64>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let text = value.map(|v| v.to_string()).unwrap_or_default();
        let field =
            cx.new(|cx| TextField::single_line(id, window, cx).with_value(text, window, cx));
        let _subscription = cx.subscribe_in(&field, window, Self::on_field);
        Self {
            field,
            value,
            min: i64::MIN,
            max: i64::MAX,
            step: 1,
            _subscription,
        }
    }

    pub fn range(mut self, min: i64, max: i64) -> Self {
        self.min = min;
        self.max = max;
        self
    }

    pub fn step(mut self, step: i64) -> Self {
        self.step = step;
        self
    }

    pub fn value(&self) -> Option<i64> {
        self.value
    }

    fn put(&mut self, value: Option<i64>, window: &mut Window, cx: &mut Context<Self>) {
        let value = value.map(|v| v.clamp(self.min, self.max));
        let text = value.map(|v| v.to_string()).unwrap_or_default();
        self.field.update(cx, |f, cx| f.set_value(text, window, cx));
        if value != self.value {
            self.value = value;
            cx.emit(NumberEvent::Commit(value));
        }
        cx.notify();
    }

    fn on_field(
        &mut self,
        _: &Entity<TextField>,
        event: &TextFieldEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let TextFieldEvent::Commit(text) = event {
            let text = text.trim();
            if text.is_empty() {
                self.put(None, window, cx);
            } else {
                match text.parse::<i64>() {
                    Ok(n) => self.put(Some(n), window, cx),
                    // Not a number: show the value it had.
                    Err(_) => {
                        let current = self.value;
                        self.value = None;
                        self.put(current, window, cx);
                    }
                }
            }
        }
    }

    fn nudge(&mut self, by: i64, window: &mut Window, cx: &mut Context<Self>) {
        let base = self.value.unwrap_or(self.min.max(0));
        self.put(Some(base.saturating_add(by)), window, cx);
    }
}

impl Render for NumberInput {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        gpui_kit::div()
            .w_full()
            // Before the text engine, which would move the caret on ↑ and ↓.
            .capture_key_down(cx.listener(|this, e: &KeyDownEvent, window, cx| {
                if e.keystroke.modifiers.modified() {
                    return;
                }
                let by = match e.keystroke.key.as_str() {
                    "up" => this.step,
                    "down" => -this.step,
                    _ => return,
                };
                cx.stop_propagation();
                this.nudge(by, window, cx);
            }))
            .child(self.field.clone())
    }
}
