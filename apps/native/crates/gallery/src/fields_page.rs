//! Text fields (NF-10): the three surfaces at both sizes, a number field and a growing composer.

use moduo_tokens::Token;
use moduo_ui::gpui::{div, prelude::*, AnyElement, App, Window};
use moduo_ui::primitives::{Eyebrow, FieldSize, FieldVariant, Label, NumberInput, TextField};
use moduo_ui::theme;

use crate::Page;

pub struct FieldsPage;

fn block(title: &'static str, body: impl IntoElement, cx: &App) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(theme::px(cx, Token::PanelGap))
        .pb(theme::px(cx, Token::PanelInset))
        .child(Eyebrow::new(title))
        .child(body)
}

impl Page for FieldsPage {
    fn name(&self) -> &'static str {
        "Text fields"
    }

    fn render(&self, window: &mut Window, cx: &mut App) -> AnyElement {
        let width = theme::px(cx, Token::WidthRail);
        let mut grid = div()
            .flex()
            .flex_col()
            .gap(theme::px(cx, Token::PanelGap))
            .w(width);
        for (name, variant) in [
            ("Filled", FieldVariant::Filled),
            ("Ghost", FieldVariant::Ghost),
            ("Bare", FieldVariant::Bare),
        ] {
            for (size_name, size) in [("md", FieldSize::Md), ("sm", FieldSize::Sm)] {
                let key = format!("field-{name}-{size_name}");
                let id = key.clone();
                let field = window.use_keyed_state(key, cx, move |window, cx| {
                    TextField::single_line(id, window, cx)
                        .variant(variant)
                        .size(size)
                        .placeholder(format!("{name} · {size_name}"))
                });
                grid = grid.child(field);
            }
        }
        let number = window.use_keyed_state("field-number", cx, |window, cx| {
            NumberInput::new("number", Some(3), window, cx).range(0, 10)
        });
        let composer = window.use_keyed_state("field-composer", cx, |window, cx| {
            TextField::multi_line("composer", 1, 4, window, cx).placeholder("Write a comment")
        });
        div()
            .flex()
            .flex_col()
            .child(block("TextField", grid, cx))
            .child(block(
                "NumberInput (0–10, ↑ ↓)",
                div()
                    .w(width)
                    .flex()
                    .flex_col()
                    .gap(theme::px(cx, Token::PadYSm))
                    .child(Label::new("Estimate"))
                    .child(number),
                cx,
            ))
            .child(block(
                "Multi-line, grows to 4 rows (⌘Enter commits)",
                div().w(width).child(composer),
                cx,
            ))
            .into_any_element()
    }
}
