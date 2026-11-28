//! Buttons and toggles (NF-9): every variant and size, and live toggles.

use moduo_tokens::Token;
use moduo_ui::gpui::{div, prelude::*, AnyElement, App, Window};
use moduo_ui::icon::IconName;
use moduo_ui::primitives::{
    Button, ButtonSize, ButtonVariant, Checkbox, CompleteToggle, Eyebrow, RadioGroup, Switch,
    SwitchSize,
};
use moduo_ui::theme;

use crate::Page;

pub struct ControlsPage;

/// The toggles' values, kept across renders.
#[derive(Default)]
struct Values {
    checked: bool,
    on: bool,
    small_on: bool,
    done: bool,
    view: String,
    pressed: bool,
}

fn row(cx: &App) -> moduo_ui::gpui::Div {
    div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(theme::px(cx, Token::PanelGap))
}

fn block(title: &'static str, body: impl IntoElement, cx: &App) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(theme::px(cx, Token::PanelGap))
        .pb(theme::px(cx, Token::PanelInset))
        .child(Eyebrow::new(title))
        .child(body)
}

impl Page for ControlsPage {
    fn name(&self) -> &'static str {
        "Buttons and toggles"
    }

    fn render(&self, window: &mut Window, cx: &mut App) -> AnyElement {
        let values = window.use_keyed_state("controls-values", cx, |_, _| Values {
            view: "list".into(),
            ..Default::default()
        });
        let v = values.read(cx);
        let (checked, on, small_on, done, view, pressed) = (
            v.checked,
            v.on,
            v.small_on,
            v.done,
            v.view.clone(),
            v.pressed,
        );

        let mut variants = row(cx);
        for variant in ButtonVariant::ALL {
            variants = variants.child(
                Button::new(format!("v-{variant:?}"), format!("{variant:?}")).variant(variant),
            );
        }
        let mut sizes = row(cx);
        for size in [ButtonSize::Sm, ButtonSize::Md, ButtonSize::Lg] {
            sizes = sizes.child(
                Button::new(format!("s-{size:?}"), format!("{size:?}"))
                    .size(size)
                    .variant(ButtonVariant::Secondary),
            );
        }
        sizes = sizes.child(Button::icon("s-icon", IconName::Plus, "Add"));

        let toggle = values.clone();
        let states = row(cx)
            .child(
                Button::new("st-leading", "With icon")
                    .leading(IconName::Plus)
                    .variant(ButtonVariant::Outline),
            )
            .child(
                Button::new(
                    "st-pressed",
                    if pressed { "Pressed" } else { "Not pressed" },
                )
                .variant(ButtonVariant::Ghost)
                .pressed(pressed)
                .on_click(move |_, cx| {
                    toggle.update(cx, |v, cx| {
                        v.pressed = !v.pressed;
                        cx.notify();
                    })
                }),
            )
            .child(Button::new("st-loading", "Saving").loading(true))
            .child(
                Button::new("st-loading-icon", "Uploading")
                    .leading(IconName::Upload)
                    .loading(true)
                    .variant(ButtonVariant::Secondary),
            )
            .child(Button::new("st-disabled", "Disabled").disabled(true))
            .child(
                Button::new("st-invalid", "Invalid")
                    .variant(ButtonVariant::Outline)
                    .invalid(true),
            );

        let set = |f: fn(&mut Values, bool)| {
            let values = values.clone();
            move |value: bool, _: &mut Window, cx: &mut App| {
                values.update(cx, |v, cx| {
                    f(v, value);
                    cx.notify();
                })
            }
        };
        let flip = values.clone();
        let pick = values.clone();
        let toggles = row(cx)
            .child(Checkbox::new("cb", checked).on_change(set(|v, x| v.checked = x)))
            .child(Checkbox::new("cb-disabled", true).disabled(true))
            .child(Switch::new("sw", on).on_change(set(|v, x| v.on = x)))
            .child(
                Switch::new("sw-sm", small_on)
                    .size(SwitchSize::Sm)
                    .on_change(set(|v, x| v.small_on = x)),
            )
            .child(CompleteToggle::new("done", done).on_toggle(move |_, cx| {
                flip.update(cx, |v, cx| {
                    v.done = !v.done;
                    cx.notify();
                })
            }))
            .child(CompleteToggle::new("done-disabled", false).disabled(true));
        let radio = RadioGroup::new("view", view)
            .option("list", "List")
            .option("board", "Board")
            .option("timeline", "Timeline")
            .on_change(move |value, _, cx| {
                pick.update(cx, |v, cx| {
                    v.view = value.to_string();
                    cx.notify();
                })
            });

        div()
            .flex()
            .flex_col()
            .child(block("Variant", variants, cx))
            .child(block("Size", sizes, cx))
            .child(block("State", states, cx))
            .child(block("Checkbox · Switch · Complete", toggles, cx))
            .child(block("Radio", radio, cx))
            .into_any_element()
    }
}
