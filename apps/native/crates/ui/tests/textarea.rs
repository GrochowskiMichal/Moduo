use gpui_kit::test::TestWindowExt as _;
use gpui_kit::AnyWindowHandle;
use moduo_ui::gpui::{self, div, prelude::*, Context, Entity, TestAppContext, Window};
use moduo_ui::primitives::TextField;

struct Composer {
    field: Entity<TextField>,
}

impl Render for Composer {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        // Inside a column, so the box is as tall as the field and not the window.
        div().flex().flex_col().child(
            div()
                .w_64()
                .debug_selector(|| "composer".into())
                .child(self.field.clone()),
        )
    }
}

#[gpui::test]
fn grows_with_its_content_up_to_the_cap(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    let window = cx.add_window(|window, cx| {
        let field = cx.new(|cx| TextField::multi_line("composer-field", 1, 4, window, cx));
        Composer { field }
    });
    let handle: AnyWindowHandle = window.into();
    let mut cx = gpui::VisualTestContext::from_window(handle, cx);
    cx.run_until_parked();
    let one = cx.debug_bounds("composer").unwrap().size.height;
    cx.update(|window, cx| {
        window.click("composer-field", cx);
        window.input("one", cx);
        window.press("shift-enter", cx);
        window.input("two", cx);
        window.press("shift-enter", cx);
        window.input("three", cx);
    });
    cx.run_until_parked();
    let three = cx.debug_bounds("composer").unwrap().size.height;
    assert!(
        three > one,
        "three lines {three:?} are not taller than one {one:?}"
    );
    cx.update(|window, cx| {
        for line in ["four", "five", "six", "seven"] {
            window.press("shift-enter", cx);
            window.input(line, cx);
        }
    });
    cx.run_until_parked();
    let capped = cx.debug_bounds("composer").unwrap().size.height;
    cx.update(|window, cx| {
        window.press("shift-enter", cx);
        window.input("eight", cx);
    });
    cx.run_until_parked();
    assert_eq!(
        cx.debug_bounds("composer").unwrap().size.height,
        capped,
        "stops growing at four rows"
    );
}
