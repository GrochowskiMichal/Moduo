//! Menus (NF-12): one model drawn as a dropdown and as a context menu, a long menu that scrolls.

use std::cell::Cell;
use std::rc::Rc;

use moduo_tokens::Token;
use moduo_ui::gpui::{div, prelude::*, AnyElement, App, Window};
use moduo_ui::icon::IconName;
use moduo_ui::primitives::{
    context_menu, dropdown, Button, ButtonVariant, Eyebrow, MenuItem, MenuModel,
};
use moduo_ui::theme;

use crate::Page;

#[derive(Default)]
pub struct MenusPage {
    pinned: Rc<Cell<bool>>,
    sort: Rc<Cell<u8>>,
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

fn model(pinned: &Rc<Cell<bool>>, sort: &Rc<Cell<u8>>) -> MenuModel {
    let flip = pinned.clone();
    let radio = |id: &'static str, label: &'static str, n: u8| {
        let sort = sort.clone();
        MenuItem::radio(id, label, sort.get() == n).on_select(move |window, _| {
            sort.set(n);
            window.refresh();
        })
    };
    MenuModel::new(vec![
        MenuItem::label("Task"),
        MenuItem::action("g-rename", "Rename")
            .icon(IconName::Pencil)
            .shortcut("⌘R"),
        MenuItem::action("g-dup", "Duplicate")
            .icon(IconName::Copy)
            .shortcut("⌘D"),
        MenuItem::action("g-off", "Archive").disabled(true),
        MenuItem::checkbox("g-pin", "Pinned", pinned.get())
            .keep_open()
            .on_select(move |window, _| {
                flip.set(!flip.get());
                window.refresh();
            }),
        MenuItem::separator(),
        MenuItem::label("Sort"),
        radio("g-manual", "Manual", 0),
        radio("g-due", "Due date", 1),
        MenuItem::submenu(
            "g-move",
            "Move to",
            vec![
                MenuItem::action("g-inbox", "Inbox"),
                MenuItem::action("g-later", "Later"),
                MenuItem::submenu(
                    "g-project",
                    "Project",
                    vec![
                        MenuItem::action("g-alpha", "Alpha"),
                        MenuItem::action("g-beta", "Beta"),
                    ],
                ),
            ],
        ),
        MenuItem::separator(),
        MenuItem::action("g-delete", "Delete")
            .icon(IconName::Trash2)
            .destructive(),
    ])
}

impl Page for MenusPage {
    fn name(&self) -> &'static str {
        "Menus"
    }

    fn render(&self, _: &mut Window, cx: &mut App) -> AnyElement {
        let (pinned, sort) = (self.pinned.clone(), self.sort.clone());
        let (pinned2, sort2) = (self.pinned.clone(), self.sort.clone());
        div()
            .flex()
            .flex_col()
            .child(block(
                "DropdownMenu (arrows, typing, → submenu, Esc)",
                div()
                    .flex()
                    .gap(theme::px(cx, Token::PanelGap))
                    .child(dropdown(
                        "g-menu",
                        Button::new("g-menu-btn", "Task actions").variant(ButtonVariant::Outline),
                        move |_, _| model(&pinned, &sort),
                    ))
                    .child(dropdown(
                        "g-long",
                        Button::new("g-long-btn", "60 projects").variant(ButtonVariant::Outline),
                        |_, _| {
                            MenuModel::new(
                                (0..60)
                                    .map(|i| {
                                        MenuItem::action(format!("g-p{i}"), format!("Project {i}"))
                                    })
                                    .collect(),
                            )
                        },
                    )),
                cx,
            ))
            .child(block(
                "ContextMenu (right-press the area)",
                context_menu(
                    "g-area",
                    div()
                        .id("g-area")
                        .h(theme::px(cx, Token::WidthRail))
                        .w(theme::px(cx, Token::WidthRail))
                        .rounded(theme::px(cx, Token::RadiusMd))
                        .border_1()
                        .border_color(theme::color(cx, Token::Hairline)),
                    move |_, _| model(&pinned2, &sort2),
                ),
                cx,
            ))
            .into_any_element()
    }
}
