//! Floating (NF-11): tooltips after the hover delay, icon buttons, and popovers on each side.

use moduo_tokens::Token;
use moduo_ui::gpui::{div, prelude::*, AnyElement, App, Window};
use moduo_ui::icon::IconName;
use moduo_ui::primitives::{
    Align, Button, ButtonVariant, Eyebrow, IconButton, IconButtonSize, Popover, Side,
};
use moduo_ui::theme;

use crate::Page;

pub struct FloatingPage;

fn block(title: &'static str, body: impl IntoElement, cx: &App) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(theme::px(cx, Token::PanelGap))
        .pb(theme::px(cx, Token::PanelInset))
        .child(Eyebrow::new(title))
        .child(body)
}

fn row(cx: &App) -> moduo_ui::gpui::Div {
    div()
        .flex()
        .items_center()
        .gap(theme::px(cx, Token::PanelGap))
}

fn popover(id: &'static str, label: &'static str, side: Side, align: Align) -> Popover {
    Popover::new(
        id,
        Button::new(format!("{id}-trigger"), label).variant(ButtonVariant::Outline),
    )
    .side(side)
    .align(align)
    .content(move |_, _| {
        // Nested: a popover opened from inside this one closes first.
        div()
            .flex()
            .flex_col()
            .child(format!("{label} popover"))
            .child(
                Popover::new(
                    format!("{id}-inner"),
                    Button::new(format!("{id}-inner-trigger"), "Nested")
                        .variant(ButtonVariant::Ghost),
                )
                .content(|_, _| div().child("Inner popover").into_any_element()),
            )
            .into_any_element()
    })
}

impl Page for FloatingPage {
    fn name(&self) -> &'static str {
        "Floating"
    }

    fn render(&self, _: &mut Window, cx: &mut App) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .child(block(
                "Tooltip (150ms)",
                row(cx).child(Button::new("tip-save", "Save").tooltip("Save the task")),
                cx,
            ))
            .child(block(
                "IconButton (label is the tooltip and the name)",
                row(cx)
                    .child(IconButton::new("ib-add", IconName::Plus, "Add a task"))
                    .child(
                        IconButton::new("ib-add-sm", IconName::Plus, "Add a task")
                            .size(IconButtonSize::Sm),
                    )
                    .child(IconButton::new("ib-pressed", IconName::Plus, "Pressed").pressed(true))
                    .child(IconButton::new("ib-off", IconName::Plus, "Disabled").disabled(true)),
                cx,
            ))
            .child(block(
                "Popover (Esc or a press outside closes)",
                row(cx)
                    .child(popover(
                        "pop-bs",
                        "Bottom start",
                        Side::Bottom,
                        Align::Start,
                    ))
                    .child(popover(
                        "pop-bc",
                        "Bottom center",
                        Side::Bottom,
                        Align::Center,
                    ))
                    .child(popover("pop-te", "Top end", Side::Top, Align::End)),
                cx,
            ))
            .into_any_element()
    }
}
