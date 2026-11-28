//! Which Supabase project the app talks to.
//!
//! In order: the process environment (`MODUO_SUPABASE_*`, then `PUBLIC_SUPABASE_*`), the repo's
//! gitignored `.env.local` (development), then the values baked in at build time. `--cloud`
//! reads `.env.cloud.local` instead, and wins over the shell, so a terminal set up for the local
//! stack can't send cloud writes somewhere else. The publishable key is public by design; nothing
//! here ever holds a session token.

use std::fmt;

const URL_KEYS: [&str; 2] = ["MODUO_SUPABASE_URL", "PUBLIC_SUPABASE_URL"];
const KEY_KEYS: [&str; 2] = [
    "MODUO_SUPABASE_PUBLISHABLE_KEY",
    "PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];
const LOCAL_FILE: &str = ".env.local";
const CLOUD_FILE: &str = ".env.cloud.local";

/// The backend, as resolved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Backend {
    /// Without a trailing slash.
    pub url: String,
    pub publishable_key: String,
}

impl Backend {
    /// Anything but the local stack: changes there are real.
    pub fn is_cloud(&self) -> bool {
        !(self.url.contains("://127.0.0.1") || self.url.contains("://localhost"))
    }

    /// What the window title says about where it is.
    pub fn label(&self) -> &'static str {
        if self.is_cloud() {
            "CLOUD (production data)"
        } else {
            "local stack"
        }
    }
}

/// Values compiled into a release build (`option_env!` at build time).
#[derive(Clone, Copy, Debug)]
pub struct Baked {
    pub url: Option<&'static str>,
    pub key: Option<&'static str>,
}

/// Everything the resolution reads, so tests can supply it.
pub struct Sources<'a> {
    pub args: &'a [&'a str],
    pub env: Box<dyn Fn(&str) -> Option<String> + 'a>,
    /// Reads one of the repo's env files by name, when there is a repo.
    pub file: Box<dyn Fn(&str) -> Option<String> + 'a>,
    pub baked: Baked,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    NoUrl,
    NoKey,
    /// `--cloud` without `.env.cloud.local`.
    NoCloudFile,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ConfigError::NoUrl => {
                "no Supabase URL: set MODUO_SUPABASE_URL or run from the repo (.env.local)"
            }
            ConfigError::NoKey => {
                "no publishable key: set MODUO_SUPABASE_PUBLISHABLE_KEY or run from the repo"
            }
            ConfigError::NoCloudFile => "--cloud needs .env.cloud.local in the repo root",
        })
    }
}

impl std::error::Error for ConfigError {}

/// `KEY=value`, `export KEY="value"`; comments and blank lines skipped.
fn read_key(src: &str, key: &str) -> Option<String> {
    src.lines()
        .filter_map(|line| line.trim().strip_prefix("export ").or(Some(line.trim())))
        .filter(|line| !line.starts_with('#'))
        .find_map(|line| {
            let (k, v) = line.split_once('=')?;
            (k.trim() == key).then(|| v.trim().trim_matches(|c| c == '"' || c == '\'').to_owned())
        })
        .filter(|v| !v.is_empty())
}

pub fn resolve(sources: &Sources<'_>) -> Result<Backend, ConfigError> {
    let cloud = sources.args.contains(&"--cloud");
    let file = if cloud {
        Some((sources.file)(CLOUD_FILE).ok_or(ConfigError::NoCloudFile)?)
    } else {
        (sources.file)(LOCAL_FILE)
    };
    let pick = |keys: &[&str], baked: Option<&'static str>| -> Option<String> {
        let from_env = || {
            keys.iter()
                .find_map(|k| (sources.env)(k).filter(|v| !v.is_empty()))
        };
        let from_file = || {
            file.as_deref()
                .and_then(|f| keys.iter().find_map(|k| read_key(f, k)))
        };
        let from_build = || baked.map(str::to_owned);
        if cloud {
            from_file()
        } else {
            from_env().or_else(from_file).or_else(from_build)
        }
    };
    let url = pick(&URL_KEYS, sources.baked.url).ok_or(ConfigError::NoUrl)?;
    let publishable_key = pick(&KEY_KEYS, sources.baked.key).ok_or(ConfigError::NoKey)?;
    Ok(Backend {
        url: url.trim_end_matches('/').to_owned(),
        publishable_key,
    })
}

/// The values this build carries, for a release that runs outside the repo.
pub const BAKED: Baked = Baked {
    url: option_env!("PUBLIC_SUPABASE_URL"),
    key: option_env!("PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
};

/// The process's own sources: its arguments, its environment, the repo's env files (found by
/// walking up from the working directory) and [`BAKED`].
pub fn from_process() -> Result<Backend, ConfigError> {
    let owned: Vec<String> = std::env::args().collect();
    let args: Vec<&str> = owned.iter().map(String::as_str).collect();
    let sources = Sources {
        args: &args,
        env: Box::new(|k| std::env::var(k).ok()),
        file: Box::new(|name| {
            let mut dir = std::env::current_dir().ok()?;
            loop {
                if let Ok(text) = std::fs::read_to_string(dir.join(name)) {
                    return Some(text);
                }
                if !dir.pop() {
                    return None;
                }
            }
        }),
        baked: BAKED,
    };
    resolve(&sources)
}
