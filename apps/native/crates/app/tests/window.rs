use moduo_app::window::{main_window_options, open_main_window};
use moduo_ui::gpui::{self, px, size, TestAppContext, WindowBounds};

#[gpui::test]
fn opens_one_window_at_the_default_size_and_minimum(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);

    let options = cx.update(|cx| main_window_options(cx));
    let Some(WindowBounds::Windowed(bounds)) = options.window_bounds else {
        panic!("the window opens windowed, not maximised or fullscreen");
    };
    assert_eq!(bounds.size, size(px(1280.), px(840.)));
    assert_eq!(options.window_min_size, Some(size(px(1024.), px(700.))));

    let titlebar = options.titlebar.expect("a native title bar");
    assert_eq!(titlebar.title.as_deref(), Some("Moduo"));
    assert!(
        !titlebar.appears_transparent,
        "the title bar is the system's"
    );
    assert!(!options.show, "hidden until the first frame is drawn");

    cx.update(open_main_window).expect("the window opens");
    cx.run_until_parked();
    assert_eq!(cx.windows().len(), 1);
}
