use moduo_tokens::{Appearance, Tokens};
use moduo_ui::fonts;
use moduo_ui::text::TextRole;

#[test]
fn each_type_role_resolves_family_size_weight_and_leading_from_tokens() {
    let tokens = Tokens::load();
    let r = tokens.resolve(&Appearance::default());

    let body = TextRole::Body.style(&r);
    assert_eq!((body.family.as_str(), body.size, body.weight, body.line_height), ("Geist", 14.0, 400.0, 1.5));

    // Chrome (buttons, labels): the display role, medium (button.tsx: font-display font-medium).
    let chrome = TextRole::Chrome.style(&r);
    assert_eq!((chrome.family.as_str(), chrome.size, chrome.weight), ("Geist", 14.0, 500.0));

    // Eyebrows: body at text-2xs, medium, uppercase, wide tracking (eyebrow.tsx).
    let eyebrow = TextRole::Eyebrow.style(&r);
    assert_eq!((eyebrow.size, eyebrow.weight, eyebrow.uppercase), (11.0, 500.0, true));
    assert!((eyebrow.tracking - 0.04 * 11.0).abs() < 1e-4);

    let mono = TextRole::Mono.style(&r);
    assert_eq!(mono.family.as_str(), "Geist Mono");

    // The font axis moves body and chrome together (R9).
    let inter = tokens.resolve(&Appearance::default().with("font", "inter"));
    assert_eq!(TextRole::Body.style(&inter).family.as_str(), "Inter");
    assert_eq!(TextRole::Chrome.style(&inter).family.as_str(), "Inter");
}

#[test]
fn the_bundled_faces_cover_polish() {
    for (name, bytes) in fonts::FACES {
        let face = ttf_parser::Face::parse(bytes, 0).unwrap_or_else(|_| panic!("{name} parses"));
        for ch in "Zażółć gęślą jaźń ZAŻÓŁĆ GĘŚLĄ JAŹŃ".chars() {
            assert!(face.glyph_index(ch).is_some(), "{name} has no glyph for {ch}");
        }
    }
}

#[test]
fn bundles_the_weights_the_app_uses() {
    let names: Vec<&str> = fonts::FACES.iter().map(|(n, _)| *n).collect();
    for want in ["Geist-Regular", "Geist-Medium", "Geist-SemiBold", "Geist-Bold", "GeistMono-Regular", "GeistMono-Medium"] {
        assert!(names.contains(&want), "missing {want}");
    }
}
