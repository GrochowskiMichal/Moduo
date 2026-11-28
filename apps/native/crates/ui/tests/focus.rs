use moduo_ui::focus;
use moduo_ui::gpui::{self, div, point, prelude::*, px, Context, FocusHandle, Modifiers, TestAppContext, Window};

struct Field {
    handle: FocusHandle,
}

impl Render for Field {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let ring = focus::ring_visible(&self.handle, window);
        div()
            .id("field")
            .size_full()
            .track_focus(&self.handle)
            .children(ring.then(|| div().debug_selector(|| "ring".into()).size_full()))
    }
}

#[gpui::test]
fn the_ring_shows_on_tab_not_on_click(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    let (view, cx) = cx.add_window_view(|_, cx| Field { handle: cx.focus_handle() });

    // Focus arrives from the keyboard: the ring shows.
    cx.update(|window, cx| view.read(cx).handle.clone().focus(window, cx));
    cx.simulate_keystrokes("tab");
    cx.run_until_parked();
    assert!(cx.debug_bounds("ring").is_some(), "no ring after a key");

    // The same element pressed with the pointer: focused, no ring.
    cx.simulate_click(point(px(10.), px(10.)), Modifiers::none());
    cx.run_until_parked();
    assert!(cx.update(|window, cx| view.read(cx).handle.is_focused(window)));
    assert!(cx.debug_bounds("ring").is_none(), "a ring after a click");
}
