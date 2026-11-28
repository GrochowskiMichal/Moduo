//! Keyboard focus: a ring only when focus came from the keyboard (`focus-visible`), outside the
//! box in the ring colour at half strength (`focus-visible:ring-2 ring-ring/50`, button.tsx).
//! Drawn as an outset shadow, so it moves nothing and keeps a control's own border.

use gpui_kit::{prelude::*, App, BoxShadow, FocusHandle, Hsla, Window};
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

/// The ring as a shadow: two pixels outside the box.
pub fn ring_shadow(cx: &App) -> BoxShadow {
    BoxShadow {
        color: ring_color(cx),
        offset: gpui_kit::point(gpui_kit::px(0.), gpui_kit::px(0.)), // design-literal: a ring has no offset
        blur_radius: gpui_kit::px(0.), // design-literal: a ring is sharp
        spread_radius: gpui_kit::px(2.), // design-literal: ring-2
        inset: false,
    }
}

/// Shows the ring on an element that tracks focus, when focus came from the keyboard. A parent
/// that clips needs room for it (`.claude/rules/tasks-ui.md`: 4px in the detail panel).
pub fn ring<E: InteractiveElement + Styled>(element: E, cx: &App) -> E {
    let shadow = ring_shadow(cx);
    element.focus_visible(move |s| s.shadow(vec![shadow]))
}
