use moduo_tokens::{Appearance, Tokens};
use moduo_ui::assets;
use moduo_ui::icon::{IconName, IconSize};

#[test]
fn every_icon_name_has_an_embedded_svg() {
    assert!(IconName::ALL.len() > 100);
    for icon in IconName::ALL {
        let svg = assets::embedded(icon.path()).unwrap_or_else(|| panic!("{} is not embedded", icon.path()));
        assert!(svg.starts_with(b"<svg"), "{} is not an SVG", icon.path());
    }
    assert!(assets::embedded(moduo_ui::mark::MODUO_MARK_PATH).is_some());
}

#[test]
fn an_icon_inside_a_control_follows_the_density_ladder() {
    let tokens = Tokens::load();
    let comfortable = tokens.resolve(&Appearance::default());
    let dense = tokens.resolve(&Appearance::default().with("density", "dense"));
    assert_eq!(IconSize::Xs.px(&comfortable), 12.0);
    assert_eq!(IconSize::Sm.px(&comfortable), 14.0);
    assert_eq!(IconSize::Md.px(&comfortable), 16.0);
    assert_eq!(IconSize::Lg.px(&comfortable), 20.0);
    assert_eq!(IconSize::Sm.px(&dense), 12.5);
    assert_eq!(IconSize::Lg.px(&dense), 16.0);
}

#[test]
fn the_web_apps_named_icons_exist() {
    // components/ui/icon.tsx names these; the native names follow lucide's.
    for name in ["bell", "settings", "trash-2", "search", "ground-roots", "chevron-down", "x"] {
        assert!(IconName::ALL.iter().any(|i| i.name() == name), "no {name}");
    }
}
