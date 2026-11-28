//! The first page: every colour token as a swatch, the type roles, the radius ladder, the shadows
//! and the icon ladder, all in the current appearance.

use moduo_tokens::Token;
use moduo_ui::gpui::{div, prelude::*, AnyElement, App, Window};
use moduo_ui::icon::{Icon, IconName, IconSize};
use moduo_ui::mark::ModuoMark;
use moduo_ui::style;
use moduo_ui::text::{self, TextRole};
use moduo_ui::theme;

use crate::Page;

pub struct TokensPage;

const COLORS: &[Token] = &[
    Token::Background,
    Token::Foreground,
    Token::Card,
    Token::Popover,
    Token::Muted,
    Token::MutedForeground,
    Token::SubtleForeground,
    Token::Primary,
    Token::PrimaryHover,
    Token::PrimaryForeground,
    Token::Ring,
    Token::Hairline,
    Token::Border,
    Token::Input,
    Token::StateHover,
    Token::StateActive,
    Token::StateActiveHover,
    Token::StateSelected,
    Token::StateSelectedRing,
    Token::Success,
    Token::Warning,
    Token::Danger,
    Token::Info,
    Token::Link,
    Token::Destructive,
    Token::ScrollThumb,
];

const ROLES: &[(TextRole, &str)] = &[
    (TextRole::Heading, "Heading · page titles"),
    (TextRole::Chrome, "Chrome · buttons and labels"),
    (
        TextRole::Body,
        "Body · titles, values, descriptions — Zażółć gęślą jaźń",
    ),
    (TextRole::Eyebrow, "Eyebrow · section labels"),
    (TextRole::Mono, "Mono · code only"),
];

const RADII: &[Token] = &[
    Token::RadiusSm,
    Token::RadiusMd,
    Token::RadiusLg,
    Token::RadiusXl,
];
const SHADOWS: &[Token] = &[
    Token::ShadowXs,
    Token::ShadowSm,
    Token::ShadowMd,
    Token::ShadowLg,
    Token::ShadowOverlay,
];
const SIZES: &[IconSize] = &[IconSize::Xs, IconSize::Sm, IconSize::Md, IconSize::Lg];

fn section(title: &'static str, body: impl IntoElement, cx: &App) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(theme::px(cx, Token::PanelGap))
        .pb(theme::px(cx, Token::PanelInset))
        .child(text::styled(
            div()
                .text_color(theme::color(cx, Token::MutedForeground))
                .child(title.to_uppercase()),
            TextRole::Eyebrow,
            cx,
        ))
        .child(body)
}

fn wrap(cx: &App) -> gpui_div::Div {
    div().flex().flex_wrap().gap(theme::px(cx, Token::PanelGap))
}

mod gpui_div {
    pub use moduo_ui::gpui::Div;
}

impl Page for TokensPage {
    fn name(&self) -> &'static str {
        "Tokens"
    }

    fn render(&self, _: &mut Window, cx: &mut App) -> AnyElement {
        let swatch = theme::px(cx, Token::CtrlHLg);
        let mut colors = wrap(cx);
        for token in COLORS {
            colors = colors.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(theme::px(cx, Token::PadYSm))
                    .w(theme::px(cx, Token::WidthRail) / 2.)
                    .child(
                        div()
                            .h(swatch)
                            .rounded(theme::px(cx, Token::RadiusMd))
                            .border_1()
                            .border_color(theme::color(cx, Token::Hairline))
                            .bg(theme::color(cx, *token)),
                    )
                    .child(text::styled(div().child(token.name()), TextRole::Mono, cx)),
            );
        }

        let mut roles = div().flex().flex_col().gap(theme::px(cx, Token::PanelGap));
        for (role, sample) in ROLES {
            let shown = if text::TextRole::Eyebrow == *role {
                sample.to_uppercase()
            } else {
                sample.to_string()
            };
            roles = roles.child(text::styled(div().child(shown), *role, cx));
        }

        let mut radii = wrap(cx);
        for token in RADII {
            radii = radii.child(
                div()
                    .size(swatch)
                    .rounded(theme::px(cx, *token))
                    .bg(theme::color(cx, Token::StateActive))
                    .border_1()
                    .border_color(theme::color(cx, Token::Hairline)),
            );
        }

        let mut shadows = wrap(cx);
        for token in SHADOWS {
            shadows = shadows.child(
                div()
                    .size(swatch * 2.)
                    .rounded(theme::px(cx, Token::RadiusLg))
                    .bg(theme::color(cx, Token::Card))
                    .shadow(style::shadow(cx, *token)),
            );
        }

        let mut icons = div().flex().flex_col().gap(theme::px(cx, Token::PanelGap));
        for size in SIZES {
            icons = icons.child(
                div()
                    .flex()
                    .items_center()
                    .gap(theme::px(cx, Token::PanelGap))
                    .child(ModuoMark::new(*size))
                    .children(
                        IconName::ALL
                            .iter()
                            .take(24)
                            .map(|name| Icon::new(*name).size(*size)),
                    ),
            );
        }

        div()
            .flex()
            .flex_col()
            .child(section("Colour", colors, cx))
            .child(section("Type", roles, cx))
            .child(section("Radius", radii, cx))
            .child(section("Shadow", shadows, cx))
            .child(section("Icons", icons, cx))
            .into_any_element()
    }
}
