use std::collections::BTreeSet;
use std::time::Instant;

use moduo_tokens::{Appearance, Tokens, Unresolved, Value};

#[test]
fn each_axis_overrides_only_its_own_tokens() {
    let tokens = Tokens::load();
    let base = tokens.resolve(&Appearance::default());
    for (axis, value) in [
        ("theme", "light"),
        ("shade", "warm"),
        ("accent", "violet"),
        ("density", "dense"),
        ("radius", "sharp"),
        ("font", "inter"),
        ("motion", "reduced"),
    ] {
        let changed = tokens.resolve(&Appearance::default().with(axis, value));
        let differ: BTreeSet<&str> = tokens
            .names()
            .filter(|name| base.get(name) != changed.get(name))
            .collect();
        let allowed = tokens.affected_by(axis);
        assert!(!differ.is_empty(), "{axis}={value} changed nothing");
        let stray: Vec<_> = differ.iter().filter(|n| !allowed.contains(**n)).collect();
        assert!(stray.is_empty(), "{axis}={value} changed tokens it doesn't own: {stray:?}");
    }
}

#[test]
fn a_var_cycle_is_an_error_not_a_hang() {
    let tokens = Tokens::from_json(
        r#"{"source":"test","layers":[{"when":[{}],"set":{
            "a":{"var":"b"},
            "b":{"mix":{"space":"oklab","a":{"var":"a"},"pa":50,"b":{"keyword":"transparent"},"pb":null}},
            "c":{"var":"missing"},
            "d":{"var":"missing","fallback":{"num":4,"unit":"px"}}
        }}]}"#,
    )
    .unwrap();
    let started = Instant::now();
    let resolved = tokens.resolve(&Appearance::default());
    assert!(started.elapsed().as_millis() < 100);
    assert_eq!(resolved.get("a"), Some(&Value::Unresolved(Unresolved::Cycle)));
    assert_eq!(resolved.get("b"), Some(&Value::Unresolved(Unresolved::Cycle)));
    assert_eq!(resolved.get("c"), Some(&Value::Unresolved(Unresolved::Missing)));
    assert_eq!(resolved.px("d"), Some(4.0));
}

#[test]
fn reduced_motion_shortens_durations() {
    let tokens = Tokens::load();
    let full = tokens.resolve(&Appearance::default());
    let reduced = tokens.resolve(&Appearance::default().with("motion", "reduced"));
    let system = tokens.resolve(&Appearance::default().prefers_reduced_motion(true));
    let forced_full = tokens.resolve(&Appearance::default().prefers_reduced_motion(true).with("motion", "full"));
    assert_eq!(full.ms("motion-base"), Some(180.0));
    assert_eq!(reduced.ms("motion-base"), Some(0.0));
    assert_eq!(reduced.ms("motion-fade"), Some(80.0));
    // The system setting reduces too, unless the person chose full motion in the app.
    assert_eq!(system.ms("motion-base"), Some(0.0));
    assert_eq!(forced_full.ms("motion-base"), Some(180.0));
}

#[test]
fn colour_maths_matches_css_color_4() {
    let tokens = Tokens::from_json(
        r#"{"source":"test","layers":[{"when":[{}],"set":{
            "white":{"oklch":[1,0,0,1]},
            "red":{"rgb":[255,0,0,1]},
            "half":{"mix":{"space":"oklab","a":{"var":"white"},"pa":50,"b":{"keyword":"transparent"},"pb":null}},
            "hsl":{"hsl":[120,100,50,1]}
        }}]}"#,
    )
    .unwrap();
    let r = tokens.resolve(&Appearance::default());
    let white = r.color("white").unwrap();
    assert!((white.r - 1.0).abs() < 1e-3 && (white.b - 1.0).abs() < 1e-3);
    assert_eq!(r.color("red").unwrap().r, 1.0);
    let half = r.color("half").unwrap();
    // Mixing with transparent keeps the colour and halves its alpha (premultiplied).
    assert!((half.r - 1.0).abs() < 1e-3 && (half.a - 0.5).abs() < 1e-6);
    let green = r.color("hsl").unwrap();
    assert!(green.g > 0.999 && green.r < 1e-6);
}
