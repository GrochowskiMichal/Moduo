//! An icon-only button (`icon-button.tsx`): a ghost button whose label is required, shown as its
//! tooltip and read as its name.

use std::rc::Rc;

use gpui_kit::{prelude::*, App, ElementId, SharedString, Window};

use super::button::{Button, ButtonSize, ButtonVariant};
use super::pressable::OnPress;
use crate::icon::IconName;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum IconButtonSize {
    /// `--ctrl-h-sm`.
    Sm,
    /// `--ctrl-h`.
    #[default]
    Md,
}

#[derive(IntoElement)]
pub struct IconButton {
    id: ElementId,
    icon: IconName,
    label: SharedString,
    size: IconButtonSize,
    variant: ButtonVariant,
    pressed: bool,
    disabled: bool,
    on_click: Option<OnPress>,
}

impl IconButton {
    pub fn new(id: impl Into<ElementId>, icon: IconName, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            icon,
            label: label.into(),
            size: IconButtonSize::default(),
            variant: ButtonVariant::Ghost,
            pressed: false,
            disabled: false,
            on_click: None,
        }
    }

    pub fn size(mut self, size: IconButtonSize) -> Self {
        self.size = size;
        self
    }

    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn pressed(mut self, pressed: bool) -> Self {
        self.pressed = pressed;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_click(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for IconButton {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let mut button = Button::icon(self.id, self.icon, self.label.clone())
            .size(match self.size {
                IconButtonSize::Sm => ButtonSize::IconSm,
                IconButtonSize::Md => ButtonSize::Icon,
            })
            .variant(self.variant)
            .pressed(self.pressed)
            .disabled(self.disabled)
            .tooltip(self.label);
        if let Some(f) = self.on_click {
            button = button.on_click(move |w, cx| f(w, cx));
        }
        button
    }
}
