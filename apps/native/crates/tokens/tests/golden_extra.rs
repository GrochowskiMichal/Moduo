//! More of the resolver against Chromium (`golden.json`): the appearances that need their own
//! page (the system's reduced motion, the smallest window, a font), the font stacks and easing
//! curves the typed probes can't read, and that every exported token was probed at all.

use std::collections::BTreeSet;

use moduo_tokens::{Appearance, Resolved, Tokens, Value};
use serde_json::Value as Json;

const GOLDEN: &str = include_str!("golden.json");
const CHANNEL: f32 = 1.0 / 255.0 + 1e-4;

fn golden() -> Json {
    serde_json::from_str(GOLDEN).unwrap()
}

/// Colours, lengths, times and numbers, as `golden.rs` checks them.
fn compare_typed(
    name: &str,
    resolved: &Resolved,
    probes: &Json,
    failures: &mut Vec<String>,
) -> usize {
    let mut checked = 0;
    for (token, probe) in probes.as_object().unwrap() {
        let mut fail = |what: String| failures.push(format!("{name} --{token}: {what}"));
        if let Some(c) = probe.get("color").and_then(Json::as_array) {
            let want: Vec<f32> = c
                .iter()
                .map(|v| (v.as_f64().unwrap() as f32).clamp(0.0, 1.0))
                .collect();
            match resolved.color(token) {
                Some(got) => {
                    let got = [got.r, got.g, got.b, got.a];
                    if got.iter().zip(&want).any(|(g, w)| (g - w).abs() > CHANNEL) {
                        fail(format!("colour {got:?}, browser {want:?}"));
                    }
                }
                None => fail(format!("not a colour: {:?}", resolved.get(token))),
            }
        } else if let Some(px) = probe.get("px").and_then(Json::as_f64) {
            match (resolved.px(token), resolved.get(token)) {
                (Some(got), _) if (got - px as f32).abs() <= 0.01 => {}
                (None, Some(Value::Unresolved(moduo_tokens::Unresolved::FontRelative))) => continue,
                (got, _) => fail(format!("{got:?}px, browser {px}px")),
            }
        } else if let Some(ms) = probe.get("ms").and_then(Json::as_f64) {
            if resolved
                .ms(token)
                .is_none_or(|got| (got - ms as f32).abs() > 0.01)
            {
                fail(format!("{:?}ms, browser {ms}ms", resolved.ms(token)));
            }
        } else if let Some(n) = probe.get("number").and_then(Json::as_f64) {
            if resolved
                .number(token)
                .is_none_or(|got| (got - n as f32).abs() > 1e-4)
            {
                fail(format!("{:?}, browser {n}", resolved.number(token)));
            }
        } else {
            continue;
        }
        checked += 1;
    }
    checked
}

#[test]
fn the_system_setting_the_smallest_window_and_a_font_match_the_browser() {
    let golden = golden();
    let tokens = Tokens::load();
    let mut failures = Vec::new();
    let mut checked = 0;
    for entry in golden["extra"]["appearances"].as_array().unwrap() {
        let name = entry["name"].as_str().unwrap();
        let mut appearance = Appearance::default()
            .cleared()
            .viewport(
                entry["viewport"]["width"].as_f64().unwrap() as f32,
                entry["viewport"]["height"].as_f64().unwrap() as f32,
            )
            .prefers_reduced_motion(entry["reducedMotion"] == "reduce");
        for (axis, value) in entry["attrs"].as_object().unwrap() {
            appearance = appearance.with(axis, value.as_str().unwrap());
        }
        let resolved = tokens.resolve(&appearance);
        checked += compare_typed(
            name,
            &resolved,
            &golden["extra"]["tokens"][name],
            &mut failures,
        );
    }
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(checked > 500, "only {checked} values checked");
}

/// '"Geist", "Inter", system-ui' → ["Geist", "Inter", "system-ui"].
fn names_of(text: &str) -> Vec<String> {
    text.split(',')
        .map(|s| s.trim().trim_matches('"').to_owned())
        .collect()
}

#[test]
fn font_stacks_and_curves_match_the_browser_text() {
    let golden = golden();
    let tokens = Tokens::load();
    let mut failures = Vec::new();
    let mut checked = 0;
    let sets = [("appearances", "tokens"), ("extra", "extra")];
    for (list, _) in sets {
        let (entries, probes) = if list == "appearances" {
            (&golden["appearances"], &golden["tokens"])
        } else {
            (&golden["extra"]["appearances"], &golden["extra"]["tokens"])
        };
        for entry in entries.as_array().unwrap() {
            let name = entry["name"].as_str().unwrap();
            let mut appearance = Appearance::default().cleared();
            for (axis, value) in entry["attrs"].as_object().unwrap() {
                appearance = appearance.with(axis, value.as_str().unwrap());
            }
            let resolved = tokens.resolve(&appearance);
            for (token, probe) in probes[name].as_object().unwrap() {
                let text = probe["text"].as_str().unwrap();
                match resolved.get(token) {
                    Some(Value::Names(got)) => {
                        if *got != names_of(text) {
                            failures.push(format!("{name} --{token}: {got:?}, browser {text}"));
                        }
                        checked += 1;
                    }
                    Some(Value::Bezier(got)) => {
                        let want: Vec<f32> = text
                            .trim_start_matches("cubic-bezier(")
                            .trim_end_matches(')')
                            .split(',')
                            .map(|v| v.trim().parse().unwrap())
                            .collect();
                        if got.as_slice() != want.as_slice() {
                            failures.push(format!("{name} --{token}: {got:?}, browser {text}"));
                        }
                        checked += 1;
                    }
                    _ => {}
                }
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    assert!(checked > 100, "only {checked} stacks and curves checked");
}

#[test]
fn every_exported_token_was_probed() {
    let golden = golden();
    let probed: BTreeSet<&str> = golden["tokens"]["dark"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    let tokens = Tokens::load();
    let exported: BTreeSet<&str> = tokens.names().collect();
    assert_eq!(
        exported, probed,
        "run bun run native:golden after bun run native:tokens"
    );
}
