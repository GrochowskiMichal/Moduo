//! The shared interaction styling: the state layer (`docs/DESIGN_RULES.md`, "state-layer ladder"),
//! the minimum pointer target, and the two selection recipes.

use gpui_kit::{prelude::*, App, Hsla};
use moduo_tokens::Token;

use crate::theme;

/// How a control answers hover and press.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    /// Transparent at rest: hover is `state-hover`, press `state-active` (ghost buttons, rows).
    Quiet,
    /// Filled at rest with `state-active`: hover and press go one step up the ladder.
    Raised,
    /// Selected: `state-selected`, hover one step up.
    Selected,
}

/// The fills of one tone: rest, hover, active.
pub fn fills(tone: Tone, cx: &App) -> (Option<Hsla>, Hsla, Hsla) {
    let c = |t: Token| theme::color(cx, t);
    match tone {
        Tone::Quiet => (None, c(Token::StateHover), c(Token::StateActive)),
        Tone::Raised => (
            Some(c(Token::StateActive)),
            c(Token::StateActiveHover),
            c(Token::StateActiveHover),
        ),
        Tone::Selected => (
            Some(c(Token::StateSelected)),
            c(Token::StateSelectedHover),
            c(Token::StateSelectedHover),
        ),
    }
}

/// Gives an interactive element its state layer. A disabled one sits at half opacity and answers
/// nothing.
pub fn state_layer<E: StatefulInteractiveElement + Styled>(
    element: E,
    tone: Tone,
    disabled: bool,
    cx: &App,
) -> E {
    let (rest, hover, active) = fills(tone, cx);
    let element = match rest {
        Some(fill) => element.bg(fill),
        None => element,
    };
    if disabled {
        return element.opacity(0.5);
    }
    crate::focus::ring(element, cx)
        .hover(move |s| s.bg(hover))
        .active(move |s| s.bg(active))
}

/// The smallest pointer target (`--hit-min`, `.hit-min` in global.css).
pub fn hit_min<E: Styled>(element: E, cx: &App) -> E {
    let min = theme::px(cx, Token::HitMin);
    element.min_w(min).min_h(min)
}

/// A small control (a 16px circle) whose pointer target must reach `--hit-min` without growing
/// the space it takes: padding grows the bounds GPUI hit-tests, a negative margin gives the space
/// back. Draw the visible part as a child (a filled box would grow with the padding).
pub fn hit_min_pad<E: Styled>(element: E, cx: &App) -> E {
    let pad = (theme::px(cx, Token::HitMin) - crate::space::sp(4.)) / 2.;
    element.p(pad).m(-pad)
}

/// A selected row: the tint and an inset ring at the selection edge (`SELECTED_ROW`). The ring is
/// an inset shadow, as in CSS, so selecting a row never moves its content.
pub fn selected_row<E: Styled>(element: E, cx: &App) -> E {
    element
        .bg(theme::color(cx, Token::StateSelected))
        .shadow(vec![inset_ring(theme::color(cx, Token::StateSelectedEdge))])
}

/// A one-pixel ring drawn inside the box.
pub fn inset_ring(color: Hsla) -> gpui_kit::BoxShadow {
    gpui_kit::BoxShadow {
        color,
        offset: gpui_kit::point(gpui_kit::px(0.), gpui_kit::px(0.)), // design-literal: a ring has no offset
        blur_radius: gpui_kit::px(0.), // design-literal: a ring is sharp
        spread_radius: gpui_kit::px(1.), // design-literal: ring-1
        inset: true,
    }
}

/// A selected card or option: the tint and the 32% ring (`SELECTED_OPTION`). Its unselected
/// state must carry a transparent 1px border too, so the box keeps its size.
pub fn selected_option<E: Styled>(element: E, cx: &App) -> E {
    element
        .bg(theme::color(cx, Token::StateSelected))
        .border_1()
        .border_color(theme::color(cx, Token::StateSelectedRing))
}

/// Anything that floats (popovers, menus, tooltips): the popover fill, a hairline, radius md and
/// the medium shadow (`FLOATING_SURFACE`; `docs/DESIGN_RULES.md` R13).
pub fn floating_surface<E: Styled>(element: E, cx: &App) -> E {
    element
        .bg(theme::color(cx, Token::Popover))
        .text_color(theme::color(cx, Token::PopoverForeground))
        .border_1()
        .border_color(theme::color(cx, Token::Hairline))
        .rounded(theme::px(cx, Token::RadiusMd))
        .shadow(shadow(cx, Token::ShadowMd))
}

/// A shadow token as GPUI box shadows.
pub fn shadow(cx: &App, token: Token) -> Vec<gpui_kit::BoxShadow> {
    theme::tokens(cx)
        .shadows(token)
        .unwrap_or_default()
        .iter()
        .map(|s| gpui_kit::BoxShadow {
            color: theme::to_hsla(s.color),
            offset: gpui_kit::point(gpui_kit::px(s.x), gpui_kit::px(s.y)),
            blur_radius: gpui_kit::px(s.blur),
            spread_radius: gpui_kit::px(s.spread),
            inset: s.inset,
        })
        .collect()
}
