//! The appearance the app draws in, and the tokens it resolves to. Switching it (theme, shade,
//! accent, density, radius, font, motion) re-resolves every token, re-themes the component
//! library and redraws every window, without a restart (specs/native-foundation.md, AC3).

use std::time::Duration;

use gpui_kit::component::{Theme as KitTheme, ThemeMode};
use gpui_kit::{App, Global, Hsla, Pixels};
use moduo_tokens::{Appearance, Resolved, Rgba, Token, Tokens};

/// The current appearance and its tokens.
pub struct Theme {
    tokens: Tokens,
    appearance: Appearance,
    resolved: Resolved,
}

impl Global for Theme {}

pub(crate) fn init(cx: &mut App) {
    let tokens = Tokens::load();
    let appearance = Appearance::default();
    let resolved = tokens.resolve(&appearance);
    cx.set_global(Theme {
        tokens,
        appearance,
        resolved,
    });
    apply_to_kit(cx);
}

/// Switches the appearance everywhere, at once.
pub fn set_appearance(cx: &mut App, appearance: Appearance) {
    let theme = cx.global_mut::<Theme>();
    theme.resolved = theme.tokens.resolve(&appearance);
    theme.appearance = appearance;
    apply_to_kit(cx);
    cx.refresh_windows();
}

pub fn appearance(cx: &App) -> &Appearance {
    &cx.global::<Theme>().appearance
}

/// Every token in the current appearance.
pub fn tokens(cx: &App) -> &Resolved {
    &cx.global::<Theme>().resolved
}

/// A colour token, ready to draw. A token that is not a colour draws transparent.
pub fn color(cx: &App, token: Token) -> Hsla {
    to_hsla(tokens(cx).color(token).unwrap_or(Rgba::TRANSPARENT))
}

/// A colour token at `pct`% of its alpha (`bg-primary/90`).
pub fn color_alpha(cx: &App, token: Token, pct: f32) -> Hsla {
    to_hsla(
        tokens(cx)
            .color(token)
            .unwrap_or(Rgba::TRANSPARENT)
            .alpha(pct),
    )
}

/// A length token. A token that is not a length reads 0.
pub fn px(cx: &App, token: Token) -> Pixels {
    gpui_kit::px(tokens(cx).px(token).unwrap_or_default())
}

/// A duration token. Under reduced motion the movement ones read 0.
pub fn duration(cx: &App, token: Token) -> Duration {
    Duration::from_micros((tokens(cx).ms(token).unwrap_or_default() * 1000.0).round() as u64)
}

pub fn to_hsla(c: Rgba) -> Hsla {
    gpui_kit::Rgba {
        r: c.r,
        g: c.g,
        b: c.b,
        a: c.a,
    }
    .into()
}

/// The component library draws its own parts (inputs, lists, scrollbars) from its theme: point
/// that theme at our tokens, so nothing it draws strays from them.
fn apply_to_kit(cx: &mut App) {
    let r = tokens(cx).clone();
    let dark = appearance(cx).attr("theme") != Some("light");
    KitTheme::change(
        if dark {
            ThemeMode::Dark
        } else {
            ThemeMode::Light
        },
        None,
        cx,
    );
    let c = |t: Token| to_hsla(r.color(t).unwrap_or(Rgba::TRANSPARENT));
    let theme = KitTheme::global_mut(cx);
    let colors = &mut theme.colors;
    colors.background = c(Token::Background);
    colors.foreground = c(Token::Foreground);
    colors.border = c(Token::Hairline);
    colors.input = c(Token::Input);
    colors.ring = c(Token::Ring);
    colors.caret = c(Token::Foreground);
    colors.muted = c(Token::Muted);
    colors.muted_foreground = c(Token::MutedForeground);
    colors.popover = c(Token::Popover);
    colors.popover_foreground = c(Token::PopoverForeground);
    colors.primary = c(Token::Primary);
    colors.primary_hover = c(Token::PrimaryHover);
    colors.primary_active = c(Token::PrimaryActive);
    colors.primary_foreground = c(Token::PrimaryForeground);
    colors.secondary = c(Token::StateActive);
    colors.secondary_hover = c(Token::StateActiveHover);
    colors.secondary_active = c(Token::StateActiveHover);
    colors.secondary_foreground = c(Token::Foreground);
    colors.accent = c(Token::StateHover);
    colors.accent_foreground = c(Token::Foreground);
    colors.list_hover = c(Token::StateHover);
    colors.list_active = c(Token::StateSelected);
    colors.list_active_border = c(Token::StateSelectedEdge);
    colors.selection = c(Token::StateSelected);
    colors.danger = c(Token::Danger);
    colors.danger_foreground = c(Token::DangerForeground);
    colors.success = c(Token::Success);
    colors.success_foreground = c(Token::SuccessForeground);
    colors.warning = c(Token::Warning);
    colors.warning_foreground = c(Token::WarningForeground);
    colors.info = c(Token::Info);
    colors.info_foreground = c(Token::InfoForeground);
    colors.link = c(Token::Link);
    colors.scrollbar_thumb = c(Token::ScrollThumb);
    colors.scrollbar_thumb_hover = c(Token::ScrollThumbHover);
    colors.skeleton = c(Token::StateActive);
    theme.font_family = "Geist".into();
    theme.mono_font_family = "Geist Mono".into();
    theme.font_size = gpui_kit::px(r.px(Token::TextBase).unwrap_or_default());
    theme.radius = gpui_kit::px(r.px(Token::RadiusMd).unwrap_or_default());
    theme.radius_lg = gpui_kit::px(r.px(Token::RadiusLg).unwrap_or_default());
}
