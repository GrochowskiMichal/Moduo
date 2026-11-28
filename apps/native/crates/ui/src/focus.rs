//! Keyboard focus: a ring only when focus came from the keyboard (`focus-visible`), in the ring
//! colour at half strength (`focus-visible:ring-2 ring-ring/50`, button.tsx).

use gpui_kit::{prelude::*, App, FocusHandle, Hsla, Window};
use moduo_tokens::Token;

use crate::theme;

/// Whether the element should show its ring now: focused, and the last input was a key.
pub fn ring_visible(handle: &FocusHandle, window: &Window) -> bool {
    handle.is_focused(window) && window.last_input_was_keyboard()
}

/// The ring's colour.
pub fn ring_color(cx: &App) -> Hsla {
    theme::color_alpha(cx, Token::Ring, 50.0)
}

/// Draws the ring around an element that tracks `handle`, inside its own box (GPUI paints a
/// border inside, so nothing around it has to make room and no parent clips it).
pub fn ring<E: Styled>(element: E, handle: &FocusHandle, window: &Window, cx: &App) -> E {
    if ring_visible(handle, window) {
        element.border_2().border_color(ring_color(cx))
    } else {
        element
    }
}
