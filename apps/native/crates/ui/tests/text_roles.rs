use moduo_tokens::{Appearance, Tokens};
use moduo_ui::text::TextRole;

#[test]
fn a_heading_is_display_text_2xl_semibold_without_tracking() {
    let r = Tokens::load().resolve(&Appearance::default());
    let h = TextRole::Heading.style(&r);
    assert_eq!((h.size, h.weight, h.tracking), (24.0, 600.0, 0.0));
}

#[test]
fn a_font_the_app_does_not_bundle_draws_in_geist() {
    let tokens = Tokens::load();
    for font in ["inter", "pilat", "cal", "fraunces", "serif"] {
        let r = tokens.resolve(&Appearance::default().with("font", font));
        assert_eq!(TextRole::Body.style(&r).face, "Geist", "font={font}");
    }
    let r = tokens.resolve(&Appearance::default());
    assert_eq!(TextRole::Mono.style(&r).face, "Geist Mono");
}

#[test]
fn chrome_and_eyebrows_take_the_body_leading() {
    let r = Tokens::load().resolve(&Appearance::default());
    assert_eq!(TextRole::Chrome.style(&r).line_height, 1.5);
    assert_eq!(TextRole::Eyebrow.style(&r).line_height, 1.5);
}
