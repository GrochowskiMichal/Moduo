//! Rules about the workspace itself.

use std::fs;
use std::path::{Path, PathBuf};

/// The crate that wraps the component library, the way `components/ui` wraps shadcn.
const UI_CRATE: &str = "ui";

/// Names that reach the component library or the GPUI crates under it.
const LIBRARY_NAMES: [&str; 5] = [
    "gpui_kit",
    "gpui-kit",
    "gpui_component",
    "gpui-component",
    "gpui_base",
];

fn crates_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("apps/native")
        .join("crates")
}

fn files_under(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name != "target") {
                files_under(&path, out);
            }
        } else if path
            .extension()
            .is_some_and(|ext| ext == "rs" || ext == "toml")
        {
            out.push(path);
        }
    }
}

#[test]
fn only_moduo_ui_names_the_component_library() {
    let crates = crates_dir();
    let mut offenders = Vec::new();
    let mut seen_ui = false;
    for entry in fs::read_dir(&crates).expect("apps/native/crates").flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().is_some_and(|name| name == UI_CRATE) {
            seen_ui = true;
            continue;
        }
        let mut files = Vec::new();
        files_under(&path, &mut files);
        for file in files {
            let text = fs::read_to_string(&file).expect("a readable source file");
            for (number, line) in text.lines().enumerate() {
                if LIBRARY_NAMES.iter().any(|name| line.contains(name)) {
                    offenders.push(format!(
                        "{}:{}: {}",
                        file.display(),
                        number + 1,
                        line.trim()
                    ));
                }
            }
        }
    }
    assert!(
        seen_ui,
        "crates/{UI_CRATE} is missing: this test would pass on anything"
    );
    assert!(
        offenders.is_empty(),
        "only crates/{UI_CRATE} may name the component library; use moduo_ui instead:\n{}",
        offenders.join("\n")
    );
}

/// Patterns that write a design value by hand instead of reading a token.
const LITERALS: [&str; 6] = ["rgb(", "rgba(", "hsla(", "hsl(", "px(", "rems("];

/// A line may keep a literal only with a reason: `// design-literal: <why>`.
const ALLOW: &str = "design-literal:";

fn is_literal_call(line: &str, pattern: &str) -> bool {
    line.match_indices(pattern).any(|(i, _)| {
        let before = line[..i].chars().last();
        let after = line[i + pattern.len()..].trim_start().chars().next();
        // A whole call (not `.px(` on a builder, not `some_px(`) with a number inside.
        !before.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '.')
            && after.is_some_and(|c| c.is_ascii_digit())
    })
}

/// `.px_4()`, `.gap_2()`, `.text_xs()`: the style shorthands, fixed sizes in disguise.
fn is_shorthand(line: &str) -> bool {
    let shorthands = [
        ".p_", ".px_", ".py_", ".pt_", ".pb_", ".pl_", ".pr_", ".m_", ".mx_", ".my_", ".mt_", ".mb_",
        ".ml_", ".mr_", ".gap_", ".gap_x_", ".gap_y_", ".w_", ".h_", ".size_", ".rounded_", ".shadow_",
    ];
    let sized = shorthands.iter().any(|s| {
        line.match_indices(s).any(|(i, _)| line[i + s.len()..].chars().next().is_some_and(|c| c.is_ascii_digit()))
    });
    let text = ["text_xs()", "text_sm()", "text_base()", "text_lg()", "text_xl()", "text_2xl()"].iter().any(|t| line.contains(t));
    let corners = ["rounded_sm()", "rounded_md()", "rounded_lg()", "rounded_xl()"].iter().any(|t| line.contains(t));
    sized || text || corners
}

#[test]
fn no_design_literals_outside_moduo_tokens() {
    let mut offenders = Vec::new();
    for entry in fs::read_dir(crates_dir()).expect("apps/native/crates").flatten() {
        let path = entry.path();
        if !path.is_dir() || path.file_name().is_some_and(|n| n == "tokens") {
            continue;
        }
        let mut files = Vec::new();
        files_under(&path.join("src"), &mut files);
        for file in files.iter().filter(|f| f.extension().is_some_and(|e| e == "rs")) {
            let text = fs::read_to_string(file).expect("a readable source file");
            for (number, line) in text.lines().enumerate() {
                let code = line.split("//").next().unwrap_or_default();
                let literal = LITERALS.iter().any(|p| is_literal_call(code, p)) || is_shorthand(code);
                if literal && !line.contains(ALLOW) {
                    offenders.push(format!("{}:{}: {}", file.display(), number + 1, line.trim()));
                }
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "read design values from moduo_tokens (moduo_ui::theme), or mark the line '// {ALLOW} <why>':\n{}",
        offenders.join("\n")
    );
}

#[test]
fn the_literal_check_bites() {
    assert!(is_literal_call("div().w(px(12.))", "px("));
    assert!(is_literal_call("let c = rgba(0x000000ff);", "rgba("));
    assert!(!is_literal_call("div().w(px(size))", "px("));
    assert!(!is_literal_call("div().px(theme::px(cx, Token::PadX))", "px("));
    assert!(is_shorthand("div().px_4().py_0p5()"));
    assert!(is_shorthand("div().text_xs()"));
    assert!(!is_shorthand("div().size_full().w_full()"));
}
