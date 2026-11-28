//! Icons: lucide's, as the web app draws them, sized on the density ladder.

use gpui_kit::{prelude::*, px, svg, App, Hsla, Window};
use moduo_tokens::{Resolved, Token};

use crate::theme;

include!(concat!(env!("OUT_DIR"), "/icon_name.rs"));

/// The icon ladder (`--icon-xs` … `--icon-lg`): it scales with density, so an icon inside a
/// control grows and shrinks with the control.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum IconSize {
    /// Dense inline meta.
    Xs,
    /// The default inside a control or a row.
    #[default]
    Sm,
    /// A primary, standalone icon.
    Md,
    /// Emphasis.
    Lg,
}

impl IconSize {
    pub fn token(self) -> Token {
        match self {
            IconSize::Xs => Token::IconXs,
            IconSize::Sm => Token::IconSm,
            IconSize::Md => Token::Icon,
            IconSize::Lg => Token::IconLg,
        }
    }

    /// Pixels in this appearance.
    pub fn px(self, tokens: &Resolved) -> f32 {
        tokens.px(self.token()).unwrap_or_default()
    }
}

/// One icon, in the current text colour unless told otherwise.
#[derive(IntoElement)]
pub struct Icon {
    name: IconName,
    size: IconSize,
    color: Option<Hsla>,
}

impl Icon {
    pub fn new(name: IconName) -> Self {
        Self {
            name,
            size: IconSize::default(),
            color: None,
        }
    }

    pub fn size(mut self, size: IconSize) -> Self {
        self.size = size;
        self
    }

    pub fn color(mut self, color: impl Into<Hsla>) -> Self {
        self.color = Some(color.into());
        self
    }
}

impl RenderOnce for Icon {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let size = px(self.size.px(theme::tokens(cx)));
        let color = self.color.unwrap_or_else(|| window.text_style().color);
        svg()
            .path(self.name.path())
            .size(size)
            .flex_none()
            .text_color(color)
    }
}
