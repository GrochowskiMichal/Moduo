//! Embeds `apps/native/assets` (icons and the mark, written by `bun run native:icons`) and
//! generates the `IconName` enum from the icon files.

use std::{env, fs, path::Path};

fn variant(name: &str) -> String {
    name.split('-')
        .map(|part| {
            let mut chars = part.chars();
            chars.next().map_or(String::new(), |c| {
                c.to_ascii_uppercase().to_string() + chars.as_str()
            })
        })
        .collect()
}

fn svgs(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap_or_else(|_| panic!("{} (bun run native:icons)", dir.display()))
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.ends_with(".svg"))
        .collect();
    names.sort();
    names
}

fn main() {
    let assets = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets");
    println!("cargo:rerun-if-changed={}", assets.display());
    let out_dir = env::var("OUT_DIR").expect("OUT_DIR");

    let mut embedded = String::from("/// Every embedded asset, by the path GPUI asks for.\npub(crate) static EMBEDDED: &[(&str, &[u8])] = &[\n");
    for sub in ["icons", "brand"] {
        for file in svgs(&assets.join(sub)) {
            let full = assets.join(sub).join(&file);
            embedded += &format!(
                "    (\"{sub}/{file}\", include_bytes!({:?})),\n",
                full.display().to_string()
            );
        }
    }
    embedded += "];\n";
    fs::write(Path::new(&out_dir).join("embedded.rs"), embedded).expect("write embedded.rs");

    let icons = svgs(&assets.join("icons"));
    let mut out = String::from(
        "/// Every icon the app draws: lucide's, named as the app imports them, plus Moduo's own.\n\
         #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]\npub enum IconName {\n",
    );
    for f in &icons {
        let name = f.trim_end_matches(".svg");
        out += &format!("    /// `{name}`\n    {},\n", variant(name));
    }
    out += "}\n\nimpl IconName {\n    pub const ALL: &[IconName] = &[\n";
    for f in &icons {
        out += &format!(
            "        IconName::{},\n",
            variant(f.trim_end_matches(".svg"))
        );
    }
    out += "    ];\n\n    /// lucide's name (`chevron-down`).\n    pub const fn name(self) -> &'static str {\n        match self {\n";
    for f in &icons {
        let name = f.trim_end_matches(".svg");
        out += &format!("            IconName::{} => \"{name}\",\n", variant(name));
    }
    out += "        }\n    }\n\n    /// The asset path GPUI loads it from.\n    pub const fn path(self) -> &'static str {\n        match self {\n";
    for f in &icons {
        out += &format!(
            "            IconName::{} => \"icons/{f}\",\n",
            variant(f.trim_end_matches(".svg"))
        );
    }
    out += "        }\n    }\n}\n";
    fs::write(Path::new(&out_dir).join("icon_name.rs"), out).expect("write icon_name.rs");
}
