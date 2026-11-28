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
