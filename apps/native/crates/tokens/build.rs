//! Generates the `Token` enum from `tokens.json`, so a token name is checked when the app compiles.

use std::{env, fs, path::Path};

fn variant(name: &str) -> String {
    name.split('-')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

fn main() {
    println!("cargo:rerun-if-changed=tokens.json");
    let json = fs::read_to_string("tokens.json").expect("tokens.json (bun run native:tokens)");
    let export: serde_json::Value = serde_json::from_str(&json).expect("tokens.json parses");
    let mut names: Vec<String> = export["layers"]
        .as_array()
        .expect("layers")
        .iter()
        .flat_map(|l| l["set"].as_object().expect("set").keys().cloned())
        .collect();
    names.sort();
    names.dedup();

    let mut out = String::from(
        "/// Every token in `tokens.css`, by its name in CamelCase (`--ctrl-h-sm` is `CtrlHSm`).\n\
         #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]\n\
         pub enum Token {\n",
    );
    for name in &names {
        out += &format!("    /// `--{name}`\n    {},\n", variant(name));
    }
    out += "}\n\nimpl Token {\n    /// Every token, sorted by name.\n    pub const ALL: &[Token] = &[\n";
    for name in &names {
        out += &format!("        Token::{},\n", variant(name));
    }
    out += "    ];\n\n    /// The name without its `--`.\n    pub const fn name(self) -> &'static str {\n        match self {\n";
    for name in &names {
        out += &format!("            Token::{} => \"{name}\",\n", variant(name));
    }
    out += "        }\n    }\n}\n";
    let dest = Path::new(&env::var("OUT_DIR").expect("OUT_DIR")).join("token.rs");
    fs::write(dest, out).expect("write token.rs");
}
