use gpui_kit::test::{TestSupportExt as _, TestWindowExt as _};
use gpui_kit::AnyWindowHandle;
use moduo_ui::gpui::{
    self, div, point, prelude::*, px, Context, Modifiers, TestAppContext, Window,
};
use moduo_ui::primitives::{Align, Button, Popover, Side};

/// A popover from a button, a second popover inside it, and the trigger placed at the bottom.
struct Harness {
    at_bottom: bool,
}

fn inner() -> Popover {
    Popover::new("inner", Button::new("open-inner", "More")).content(|_, _| {
        div()
            .id("inner-content")
            .test_support()
            .w_32()
            .h_16()
            .into_any_element()
    })
}

impl Render for Harness {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let popover = Popover::new("outer", Button::new("open", "Open"))
            .side(Side::Bottom)
            .align(Align::Start)
            .content(|_, _| {
                div()
                    .id("content")
                    .test_support()
                    .w_48()
                    .h_32()
                    .flex()
                    .flex_col()
                    .child(inner())
                    .into_any_element()
            });
        div()
            .size_full()
            .flex()
            .flex_col()
            .when(self.at_bottom, |el| el.justify_end())
            .child(div().flex().child(popover))
    }
}

fn mount(cx: &mut TestAppContext, at_bottom: bool) -> AnyWindowHandle {
    cx.update(moduo_ui::init);
    let window = cx.add_window(move |_, _| Harness { at_bottom });
    window
        .update(cx, |_, window, _| window.activate_window())
        .unwrap();
    cx.run_until_parked();
    window.into()
}

fn open(cx: &mut TestAppContext, handle: AnyWindowHandle) -> bool {
    cx.update_window(handle, |_, window, cx| {
        window.render_frame(cx);
        window.try_find("content").is_some_and(|c| c.visible())
    })
    .unwrap()
}

#[gpui::test]
fn outside_press_closes_press_inside_does_not(cx: &mut TestAppContext) {
    let h = mount(cx, false);
    cx.update_window(h, |_, window, cx| window.click("open", cx))
        .unwrap();
    assert!(open(cx, h), "the press opens it");
    cx.update_window(h, |_, window, cx| window.click("content", cx))
        .unwrap();
    assert!(open(cx, h), "a press inside keeps it");
    let mut vcx = gpui::VisualTestContext::from_window(h, cx);
    vcx.simulate_click(point(px(1500.), px(900.)), Modifiers::none());
    assert!(!open(cx, h), "a press outside closes it");
}

#[gpui::test]
fn esc_closes_the_top_surface_and_returns_focus(cx: &mut TestAppContext) {
    let h = mount(cx, false);
    cx.update_window(h, |_, window, cx| window.click("open", cx))
        .unwrap();
    assert!(open(cx, h));
    cx.update_window(h, |_, window, cx| window.press("escape", cx))
        .unwrap();
    assert!(!open(cx, h), "Esc closes it");
    let focused = cx.update_window(h, |_, window, cx| {
        window.render_frame(cx);
        window.find("open").focused()
    });
    assert_eq!(focused.unwrap(), Some(true), "focus is back on the trigger");
}

#[gpui::test]
fn nested_surfaces_close_innermost_first(cx: &mut TestAppContext) {
    let h = mount(cx, false);
    cx.update_window(h, |_, window, cx| window.click("open", cx))
        .unwrap();
    cx.update_window(h, |_, window, cx| window.click("open-inner", cx))
        .unwrap();
    let inner_open = |cx: &mut TestAppContext| {
        cx.update_window(h, |_, window, cx| {
            window.render_frame(cx);
            window
                .try_find("inner-content")
                .is_some_and(|c| c.visible())
        })
        .unwrap()
    };
    assert!(inner_open(cx));
    cx.update_window(h, |_, window, cx| window.press("escape", cx))
        .unwrap();
    assert!(!inner_open(cx), "the inner one closes first");
    assert!(open(cx, h), "the outer one stays");
    cx.update_window(h, |_, window, cx| window.press("escape", cx))
        .unwrap();
    assert!(!open(cx, h));
}

#[gpui::test]
fn flips_at_the_window_edge_and_stays_inside(cx: &mut TestAppContext) {
    let h = mount(cx, true);
    cx.update_window(h, |_, window, cx| window.click("open", cx))
        .unwrap();
    let (content, trigger, viewport) = cx
        .update_window(h, |_, window, cx| {
            window.render_frame(cx);
            (
                window.find("content").bounds(),
                window.find("open").bounds(),
                window.viewport_size(),
            )
        })
        .unwrap();
    assert!(
        content.bottom() <= viewport.height,
        "{content:?} leaves the window ({viewport:?})"
    );
    assert!(
        content.bottom() <= trigger.top(),
        "with no room below, it opens above: {content:?} vs {trigger:?}"
    );
}
