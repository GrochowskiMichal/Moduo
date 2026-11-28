//! A field's label (`label.tsx`: font-sans text-sm font-medium leading-none). Pressing it focuses
//! the control it names, as a `<label for>` does.

use gpui_kit::{div, prelude::*, relative, App, FocusHandle, SharedString, Window};
use moduo_tokens::Token;

use crate::space::sp;
use crate::text::{self, Family};
use crate::theme;

#[derive(IntoElement)]
pub struct Label {
    text: SharedString,
    control: Option<FocusHandle>,
    disabled: bool,
}

impl Label {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self {
            text: text.into(),
            control: None,
            disabled: false,
        }
    }

    /// The control a press on the label focuses.
    pub fn for_control(mut self, handle: &FocusHandle) -> Self {
        self.control = Some(handle.clone());
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

impl RenderOnce for Label {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let el = div()
            .id(SharedString::from(format!("label-{}", self.text)))
            .flex()
            .items_center()
            .gap(sp(2.))
            .line_height(relative(1.)) // design-literal: leading-none
            .text_color(theme::color(cx, Token::Foreground))
            .when(self.disabled, |el| el.opacity(0.5))
            .child(self.text.clone());
        let el = match self.control {
            Some(handle) if !self.disabled => {
                el.on_click(move |_, window, cx| handle.focus(window, cx))
            }
            _ => el,
        };
        text::font(el, Family::Sans, Token::TextSm, Token::FontWeightMedium, cx)
    }
}
