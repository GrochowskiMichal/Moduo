//! The resolver against Chromium: `golden.json` is what the browser computes for every token in
//! six appearances (`bun scripts/native/tokens-golden.ts` writes it). A colour must match within
//! 1/255 per channel; a length, a time and a number must match exactly (to rounding).

use std::collections::BTreeSet;

use moduo_tokens::{Appearance, Rgba, Tokens, Unresolved, Value};
use serde_json::Value as Json;

const GOLDEN: &str = include_str!("golden.json");
const CHANNEL: f32 = 1.0 / 255.0 + 1e-4;

fn appearance(golden: &Json, entry: &Json) -> Appearance {
    let viewport = &golden["viewport"];
    let mut appearance = Appearance::default().viewport(
        viewport["width"].as_f64().unwrap() as f32,
        viewport["height"].as_f64().unwrap() as f32,
    );
    // The golden page sets every attribute it lists and no other.
    appearance = appearance.cleared();
    for (axis, value) in entry["attrs"].as_object().unwrap() {
        appearance = appearance.with(axis, value.as_str().unwrap());
    }
    appearance
}

/// A number followed by em, ch or lh, or a percentage, in the browser's own text of the value.
fn is_font_relative(text: &str) -> bool {
    let bytes = text.as_bytes();
    ["em", "ch", "lh", "%"].iter().any(|unit| {
        text.match_indices(unit).any(|(i, _)| {
            i > 0
                && (bytes[i - 1].is_ascii_digit() || bytes[i - 1] == b'.')
                && !text[..i].ends_with('r')
        })
    })
}

fn clamp(c: [f32; 4]) -> [f32; 4] {
    c.map(|v| v.clamp(0.0, 1.0))
}

/// "rgba(0, 0, 0, 0.45) 0px 4px 12px 0px" → (rgba 0–1, [x, y, blur, spread]).
fn chrome_shadow(text: &str) -> ([f32; 4], [f32; 4]) {
    let (color, rest) = text.split_at(text.find(')').unwrap() + 1);
    let channels: Vec<f32> = color
        .trim_start_matches("rgba(")
        .trim_start_matches("rgb(")
        .trim_end_matches(')')
        .split(',')
        .map(|s| s.trim().parse().unwrap())
        .collect();
    let a = channels.get(3).copied().unwrap_or(1.0);
    let lengths: Vec<f32> = rest
        .split_whitespace()
        .map(|s| s.trim_end_matches("px").parse().unwrap())
        .collect();
    (
        [
            channels[0] / 255.0,
            channels[1] / 255.0,
            channels[2] / 255.0,
            a,
        ],
        [
            lengths[0],
            lengths[1],
            lengths[2],
            lengths.get(3).copied().unwrap_or(0.0),
        ],
    )
}

#[test]
fn resolved_tokens_match_the_browser_for_six_appearances() {
    let golden: Json = serde_json::from_str(GOLDEN).unwrap();
    let tokens = Tokens::load();
    let mut failures = Vec::new();
    let mut checked = 0;
    let mut font_relative = BTreeSet::new();

    for entry in golden["appearances"].as_array().unwrap() {
        let name = entry["name"].as_str().unwrap();
        let resolved = tokens.resolve(&appearance(&golden, entry));
        for (token, probe) in golden["tokens"][name].as_object().unwrap() {
            let mut fail = |what: String| failures.push(format!("{name} --{token}: {what}"));
            if let Some(c) = probe.get("color") {
                let want: Vec<f32> = c
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v.as_f64().unwrap() as f32)
                    .collect();
                let want = clamp([want[0], want[1], want[2], want[3]]);
                match resolved.color(token) {
                    Some(Rgba { r, g, b, a }) => {
                        let got = [r, g, b, a];
                        if got.iter().zip(want).any(|(g, w)| (g - w).abs() > CHANNEL) {
                            fail(format!("colour {got:?}, browser {want:?}"));
                        }
                    }
                    None => fail(format!("not a colour: {:?}", resolved.get(token))),
                }
                checked += 1;
            } else if let Some(px) = probe.get("px").and_then(Json::as_f64) {
                match resolved.px(token) {
                    Some(got) if (got - px as f32).abs() <= 0.01 => {}
                    Some(got) => fail(format!("{got}px, browser {px}px")),
                    None => match resolved.get(token) {
                        // Only a length the browser itself resolved through the font may stay open.
                        Some(Value::Unresolved(Unresolved::FontRelative))
                            if is_font_relative(probe["text"].as_str().unwrap_or("")) =>
                        {
                            font_relative.insert(token.clone());
                        }
                        other => fail(format!("not a length: {other:?}")),
                    },
                }
                checked += 1;
            } else if let Some(ms) = probe.get("ms").and_then(Json::as_f64) {
                match resolved.ms(token) {
                    Some(got) if (got - ms as f32).abs() <= 0.01 => {}
                    other => fail(format!("{other:?}ms, browser {ms}ms")),
                }
                checked += 1;
            } else if let Some(n) = probe.get("number").and_then(Json::as_f64) {
                match resolved.number(token) {
                    Some(got) if (got - n as f32).abs() <= 1e-4 => {}
                    other => fail(format!("{other:?}, browser {n}")),
                }
                checked += 1;
            } else if let Some(text) = probe.get("shadow").and_then(Json::as_str) {
                let (want_color, want_len) = chrome_shadow(text);
                match resolved.shadows(token) {
                    Some([shadow]) => {
                        let c = shadow.color;
                        let got_color = clamp([c.r, c.g, c.b, c.a]);
                        let got_len = [shadow.x, shadow.y, shadow.blur, shadow.spread];
                        let off = got_color
                            .iter()
                            .zip(want_color)
                            .any(|(g, w)| (g - w).abs() > CHANNEL)
                            || got_len
                                .iter()
                                .zip(want_len)
                                .any(|(g, w)| (g - w).abs() > 0.01);
                        if off {
                            fail(format!("shadow {shadow:?}, browser {text}"));
                        }
                    }
                    other => fail(format!("not one shadow: {other:?}, browser {text}")),
                }
                checked += 1;
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
    // Lengths in ch, em or lh need the font of the element that uses them; a handful at most.
    assert!(
        font_relative.len() <= 12,
        "too many font-relative lengths: {font_relative:?}"
    );
    assert!(checked > 1000, "only {checked} values checked");
}

#[test]
fn font_stacks_and_curves_read_as_written() {
    let resolved = Tokens::load().resolve(&Appearance::default());
    assert_eq!(
        resolved.fonts("font-body").unwrap(),
        ["Geist", "Inter", "system-ui", "-apple-system", "sans-serif"]
    );
    assert_eq!(resolved.bezier("ease-out"), Some([0.16, 1.0, 0.3, 1.0]));
}
