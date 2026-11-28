//! NF-12 menus: one model, drawn as a dropdown from a trigger or as a context menu at the pointer.

use std::cell::Cell;
use std::rc::Rc;

use gpui_kit::test::{ClickOptions, TestSupportExt as _, TestWindowExt as _};
use gpui_kit::AnyWindowHandle;
use moduo_ui::gpui::{
    self, div, point, prelude::*, px, Context, FocusHandle, MouseButton, TestAppContext, Window,
};
use moduo_ui::primitives::{Button, ContextMenu, DropdownMenu, MenuItem, MenuModel};

struct Harness {
    pinned: Rc<Cell<bool>>,
    renamed: Rc<Cell<bool>>,
    dialog: FocusHandle,
}

fn model(h: &Harness) -> MenuModel {
    let pinned = h.pinned.clone();
    let renamed = h.renamed.clone();
    let dialog = h.dialog.clone();
    MenuModel::new(vec![
        MenuItem::label("Task"),
        MenuItem::action("rename", "Rename")
            .shortcut("⌘R")
            .on_select(move |_, _| renamed.set(true)),
        MenuItem::action("dup", "Duplicate"),
        MenuItem::checkbox("pin", "Pinned", h.pinned.get())
            .keep_open()
            .on_select(move |window, _| {
                pinned.set(!pinned.get());
                window.refresh();
            }),
        MenuItem::submenu(
            "move",
            "Move to",
            vec![
                MenuItem::action("inbox", "Inbox"),
                MenuItem::action("later", "Later"),
            ],
        ),
        MenuItem::separator(),
        MenuItem::action("delete", "Delete…")
            .destructive()
            .after_close()
            .on_select(move |window, cx| dialog.focus(window, cx)),
    ])
}

fn long_model() -> MenuModel {
    MenuModel::new(
        (0..60)
            .map(|i| MenuItem::action(format!("row-{i}"), format!("Project {i}")))
            .collect(),
    )
}

impl Render for Harness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let items = model(self);
        let again = model(self);
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .gap_4()
                    .child(DropdownMenu::new(
                        "more",
                        Button::new("more-btn", "More"),
                        move |_, _| items.clone(),
                    ))
                    .child(DropdownMenu::new(
                        "long",
                        Button::new("long-btn", "Projects"),
                        |_, _| long_model(),
                    ))
                    .child(
                        div()
                            .id("dialog")
                            .test_support()
                            .track_focus(&self.dialog)
                            .size_8(),
                    ),
            )
            .child(ContextMenu::new(
                "area",
                div().id("area").test_support().flex_1().w_full(),
                move |_, _| again.clone(),
            ))
    }
}

fn mount(cx: &mut TestAppContext) -> (AnyWindowHandle, Rc<Cell<bool>>, Rc<Cell<bool>>) {
    cx.update(moduo_ui::init);
    let pinned = Rc::new(Cell::new(false));
    let renamed = Rc::new(Cell::new(false));
    let (p, r) = (pinned.clone(), renamed.clone());
    let window = cx.add_window(move |_, cx| Harness {
        pinned: p,
        renamed: r,
        dialog: cx.focus_handle(),
    });
    window
        .update(cx, |_, window, _| window.activate_window())
        .unwrap();
    cx.run_until_parked();
    (window.into(), pinned, renamed)
}

fn act(cx: &mut TestAppContext, h: AnyWindowHandle, f: impl FnOnce(&mut Window, &mut gpui::App)) {
    cx.update_window(h, |_, window, cx| f(window, cx)).unwrap();
    cx.run_until_parked();
}

fn press(cx: &mut TestAppContext, h: AnyWindowHandle, key: &str) {
    act(cx, h, |window, cx| window.press(key, cx));
}

fn is_open(cx: &mut TestAppContext, h: AnyWindowHandle, id: &str) -> bool {
    let id = id.to_owned();
    cx.update_window(h, move |_, window, cx| {
        window.render_frame(cx);
        window
            .try_find(gpui::ElementId::Name(id.into()))
            .is_some_and(|s| s.visible())
    })
    .unwrap()
}

fn highlighted(cx: &mut TestAppContext, h: AnyWindowHandle, id: &str) -> bool {
    let id = id.to_owned();
    cx.update_window(h, move |_, window, cx| {
        window.render_frame(cx);
        window.find(gpui::ElementId::Name(id.into())).selected() == Some(true)
    })
    .unwrap()
}

#[gpui::test]
fn arrows_typeahead_submenu_esc_returns_focus(cx: &mut TestAppContext) {
    let (h, _, _) = mount(cx);
    act(cx, h, |w, cx| w.click("more-btn", cx));
    assert!(is_open(cx, h, "more-menu"), "the trigger opens the menu");
    press(cx, h, "down");
    assert!(
        highlighted(cx, h, "rename"),
        "Down highlights the first item, past the label"
    );
    press(cx, h, "down");
    assert!(highlighted(cx, h, "dup"));
    press(cx, h, "up");
    assert!(highlighted(cx, h, "rename"));
    press(cx, h, "m");
    assert!(
        highlighted(cx, h, "move"),
        "typing jumps to the item starting with that letter"
    );
    press(cx, h, "right");
    assert!(is_open(cx, h, "move-sub"), "Right opens the submenu");
    assert!(highlighted(cx, h, "inbox"), "and highlights its first item");
    press(cx, h, "escape");
    assert!(!is_open(cx, h, "more-menu"), "Esc closes the whole menu");
    assert!(!is_open(cx, h, "move-sub"));
    let focused = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            window.find("more-btn").focused()
        })
        .unwrap();
    assert_eq!(focused, Some(true), "focus is back on the trigger");
}

#[gpui::test]
fn left_closes_a_submenu_only(cx: &mut TestAppContext) {
    let (h, _, _) = mount(cx);
    act(cx, h, |w, cx| w.click("more-btn", cx));
    press(cx, h, "m");
    press(cx, h, "right");
    assert!(is_open(cx, h, "move-sub"));
    press(cx, h, "left");
    assert!(!is_open(cx, h, "move-sub"), "Left closes the submenu");
    assert!(is_open(cx, h, "more-menu"), "the menu stays");
    assert!(highlighted(cx, h, "move"), "with its trigger highlighted");
}

#[gpui::test]
fn a_checkbox_item_toggles_and_keeps_the_menu_open_when_asked(cx: &mut TestAppContext) {
    let (h, pinned, renamed) = mount(cx);
    act(cx, h, |w, cx| w.click("more-btn", cx));
    act(cx, h, |w, cx| w.click("pin", cx));
    assert!(pinned.get(), "the press toggles it");
    assert!(is_open(cx, h, "more-menu"), "keep_open leaves the menu up");
    let checked = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            window.find("pin").checked()
        })
        .unwrap();
    assert_eq!(checked, Some(true), "and shows the new state");
    act(cx, h, |w, cx| w.click("rename", cx));
    assert!(renamed.get());
    assert!(!is_open(cx, h, "more-menu"), "a plain item closes the menu");
}

#[gpui::test]
fn an_action_that_opens_a_dialog_runs_after_the_menu_has_closed(cx: &mut TestAppContext) {
    let (h, _, _) = mount(cx);
    act(cx, h, |w, cx| w.click("more-btn", cx));
    act(cx, h, |w, cx| w.click("delete", cx));
    assert!(!is_open(cx, h, "more-menu"));
    let focused = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            (
                window.find("dialog").focused(),
                window.find("more-btn").focused(),
            )
        })
        .unwrap();
    assert_eq!(
        focused,
        (Some(true), Some(false)),
        "the dialog keeps focus: the closing menu does not take it back"
    );
}

#[gpui::test]
fn a_long_menu_scrolls_and_fades_its_lower_edge(cx: &mut TestAppContext) {
    let (h, _, _) = mount(cx);
    act(cx, h, |w, cx| w.click("long-btn", cx));
    let (menu, viewport) = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            (window.find("long-menu").bounds(), window.viewport_size())
        })
        .unwrap();
    assert!(
        menu.bottom() <= viewport.height,
        "{menu:?} runs past the window"
    );
    assert!(
        is_open(cx, h, "long-menu-fade"),
        "more waits below: the foot fades"
    );
    press(cx, h, "end");
    assert!(highlighted(cx, h, "row-59"), "End reaches the last item");
    let last = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            window.find("row-59").bounds()
        })
        .unwrap();
    assert!(
        last.bottom() <= menu.bottom() + px(1.),
        "the highlight scrolls into view"
    );
    assert!(!is_open(cx, h, "long-menu-fade"), "nothing below: no fade");
}

#[gpui::test]
fn a_context_menu_opens_at_the_pointer(cx: &mut TestAppContext) {
    let (h, _, _) = mount(cx);
    let area = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            window.find("area").bounds()
        })
        .unwrap();
    let at = point(px(200.), px(150.));
    act(cx, h, |w, cx| {
        w.click_with_options(
            "area",
            ClickOptions::new()
                .with_button(MouseButton::Right)
                .with_offset(at),
            cx,
        )
    });
    let menu = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            window.find("area-menu").bounds()
        })
        .unwrap();
    let pointer = area.origin + at;
    assert!(
        (menu.left() - pointer.x).abs() <= px(2.) && (menu.top() - pointer.y).abs() <= px(2.),
        "{menu:?} is not at the pointer {pointer:?}"
    );
    press(cx, h, "escape");
    assert!(!is_open(cx, h, "area-menu"));

    // Near the bottom-right corner it moves to stay inside the window.
    let corner = point(area.size.width - px(4.), area.size.height - px(4.));
    act(cx, h, |w, cx| {
        w.click_with_options(
            "area",
            ClickOptions::new()
                .with_button(MouseButton::Right)
                .with_offset(corner),
            cx,
        )
    });
    let (menu, viewport) = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            (window.find("area-menu").bounds(), window.viewport_size())
        })
        .unwrap();
    assert!(
        menu.right() <= viewport.width && menu.bottom() <= viewport.height,
        "{menu:?} leaves the window ({viewport:?})"
    );
}
