use std::time::Duration;

use gpui_kit::test::{TestSupportExt as _, TestWindowExt as _};
use moduo_ui::gpui::{self, div, prelude::*, Context, TestAppContext, Window};
use moduo_ui::icon::IconName;
use moduo_ui::primitives::{Button, IconButton, TOOLTIP_DELAY};

struct Harness;

impl Render for Harness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .gap_4()
            .child(Button::new("save", "Save").tooltip("Save the task"))
            .child(IconButton::new("add", IconName::Plus, "Add a task"))
            .child(div().id("away").test_support().size_8())
    }
}

#[gpui::test]
fn opens_after_the_delay(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    let window = cx.add_window(|_, _| Harness);
    window.update(cx, |_, window, _| window.activate_window()).unwrap();
    let h: gpui::AnyWindowHandle = window.into();
    assert_eq!(TOOLTIP_DELAY, Duration::from_millis(150));
    cx.update_window(h, |_, window, cx| window.hover("save", cx)).unwrap();
    let shown = |cx: &mut TestAppContext| {
        cx.update_window(h, |_, window, cx| {
            window.render_frame(cx);
            window.try_find("tooltip").is_some()
        })
        .unwrap()
    };
    assert!(!shown(cx), "not before the delay");
    cx.executor().advance_clock(TOOLTIP_DELAY + Duration::from_millis(10));
    cx.run_until_parked();
    assert!(shown(cx), "after the delay");
}

#[gpui::test]
fn the_icon_buttons_label_is_its_tooltip_and_accessible_name(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    let window = cx.add_window(|_, _| Harness);
    window.update(cx, |_, window, _| window.activate_window()).unwrap();
    let h: gpui::AnyWindowHandle = window.into();
    let label = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            window.find("add").label().map(str::to_owned)
        })
        .unwrap();
    assert_eq!(label.as_deref(), Some("Add a task"));
    cx.update_window(h, |_, window, cx| window.hover("add", cx)).unwrap();
    cx.executor().advance_clock(TOOLTIP_DELAY + Duration::from_millis(10));
    cx.run_until_parked();
    let text = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            window.try_find("tooltip").and_then(|t| t.label().map(str::to_owned))
        })
        .unwrap();
    assert_eq!(text.as_deref(), Some("Add a task"));
}
