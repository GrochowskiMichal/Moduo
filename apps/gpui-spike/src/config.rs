//! Where the backend lives. Nothing is baked into the binary: the URL and the
//! publishable key come from the process environment, else from the repo's
//! gitignored env files (`.env.local`, or `.env.cloud.local` with `--cloud`).

use std::{env, fs, path::PathBuf};

use anyhow::{anyhow, Result};

const URL_KEYS: [&str; 2] = ["MODUO_SUPABASE_URL", "PUBLIC_SUPABASE_URL"];
const KEY_KEYS: [&str; 2] = ["MODUO_SUPABASE_PUBLISHABLE_KEY", "PUBLIC_SUPABASE_PUBLISHABLE_KEY"];

#[derive(Clone, Debug)]
pub struct Config {
    pub url: String,
    pub publishable_key: String,
    /// Shown in the title bar so prod is never mistaken for the local stack.
    pub label: String,
}

impl Config {
    pub fn is_local(&self) -> bool {
        self.url.contains("127.0.0.1") || self.url.contains("localhost")
    }

    pub fn load() -> Result<Self> {
        let cloud = env::args().any(|a| a == "--cloud");
        let file = if cloud { ".env.cloud.local" } else { ".env.local" };
        let from_file = find_up(file).and_then(|p| fs::read_to_string(p).ok()).unwrap_or_default();

        let pick = |keys: &[&str]| -> Option<String> {
            // `--cloud` must win over whatever the shell exported for the local stack.
            if !cloud {
                if let Some(v) = keys.iter().find_map(|k| env::var(k).ok()) {
                    return Some(v);
                }
            }
            keys.iter().find_map(|k| read_key(&from_file, k))
        };

        let url = pick(&URL_KEYS)
            .ok_or_else(|| anyhow!("no Supabase URL: set MODUO_SUPABASE_URL or run from the repo ({file})"))?;
        let publishable_key = pick(&KEY_KEYS)
            .ok_or_else(|| anyhow!("no publishable key: set MODUO_SUPABASE_PUBLISHABLE_KEY ({file})"))?;
        let url = url.trim_end_matches('/').to_string();
        let label = if url.contains("127.0.0.1") || url.contains("localhost") {
            "local stack".to_string()
        } else {
            "CLOUD (production data)".to_string()
        };
        Ok(Self { url, publishable_key, label })
    }
}

fn read_key(src: &str, key: &str) -> Option<String> {
    src.lines().find_map(|line| {
        let (k, v) = line.split_once('=')?;
        (k.trim() == key).then(|| v.trim().trim_matches('"').to_string())
    })
    .filter(|v| !v.is_empty())
}

/// Walk up from the working directory until the file is found (the crate sits
/// two levels under the repo root).
fn find_up(name: &str) -> Option<PathBuf> {
    let mut dir = env::current_dir().ok()?;
    loop {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        if !dir.pop() {
            return None;
        }
    }
}
