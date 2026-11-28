use moduo_gallery::{pages, Gallery};
use moduo_ui::gpui::{self, TestAppContext};

#[gpui::test]
fn every_page_renders(cx: &mut TestAppContext) {
    cx.update(moduo_ui::init);
    let (gallery, cx) = cx.add_window_view(|_, cx| Gallery::new(cx));
    let names: Vec<&'static str> = pages().iter().map(|p| p.name()).collect();
    assert!(names.contains(&"Tokens"));
    for (index, name) in names.iter().enumerate() {
        gallery.update(cx, |g, cx| g.select(index, cx));
        cx.run_until_parked();
        assert!(cx.debug_bounds("gallery-page").is_some(), "{name} drew nothing");
    }
}
