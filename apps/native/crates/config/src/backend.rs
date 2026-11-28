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
        let rest = self
            .url
            .split_once("://")
            .map_or(self.url.as_str(), |(_, r)| r);
        let host = if let Some(v6) = rest.strip_prefix('[') {
            v6.split(']').next().unwrap_or_default()
        } else {
            rest.split([':', '/']).next().unwrap_or_default()
        };
        !matches!(host, "127.0.0.1" | "localhost" | "::1")
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

/// Looks a value up by name: an environment variable, or one of the repo's env files.
pub type Lookup<'a> = Box<dyn Fn(&str) -> Option<String> + 'a>;

/// Everything the resolution reads, so tests can supply it.
pub struct Sources<'a> {
    pub args: &'a [&'a str],
    pub env: Lookup<'a>,
    /// Reads one of the repo's env files by name, when there is a repo.
    pub file: Lookup<'a>,
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

/// `KEY=value`, `export KEY="value"`, `KEY=value # note`; comments and blank lines skipped.
/// A later line does not override an earlier one (as `scripts/local/env.ts` edits the first).
fn read_key(src: &str, key: &str) -> Option<String> {
    src.lines().find_map(|line| {
        let line = line.trim();
        let line = line
            .strip_prefix("export")
            .filter(|rest| rest.starts_with([' ', '\t']))
            .map_or(line, str::trim_start);
        if line.starts_with('#') {
            return None;
        }
        let (k, v) = line.split_once('=')?;
        (k.trim() == key)
            .then(|| unquote(v.trim()))
            .filter(|v| !v.is_empty())
    })
}

/// A value: a matching pair of quotes is removed; an unquoted value ends at " #".
fn unquote(v: &str) -> String {
    for q in ['"', '\''] {
        if let Some(inner) = v.strip_prefix(q).and_then(|r| r.split_once(q)) {
            return inner.0.to_owned();
        }
    }
    v.split(" #").next().unwrap_or_default().trim().to_owned()
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

/// The process's own sources: its arguments, its environment, the repo's env files and
/// [`BAKED`]. Only a debug build reads env files (found by walking up from the working directory
/// to the repo that holds `apps/native`): a release build started inside some other project must
/// never pick up that project's backend.
pub fn from_process() -> Result<Backend, ConfigError> {
    let owned: Vec<String> = std::env::args().collect();
    let args: Vec<&str> = owned.iter().map(String::as_str).collect();
    let sources = Sources {
        args: &args,
        env: Box::new(|k| std::env::var(k).ok()),
        file: Box::new(|name| {
            if !cfg!(debug_assertions) {
                return None;
            }
            let mut dir = std::env::current_dir().ok()?;
            loop {
                if dir.join("apps/native/Cargo.toml").is_file() {
                    return std::fs::read_to_string(dir.join(name)).ok();
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

#[cfg(test)]
mod tests {
    use super::{read_key, Backend};

    #[test]
    fn reads_the_lines_an_env_file_has() {
        let src = "# comment\nA=plain\nexport\tB=\"quoted # kept\"\nC=value # note\nD='single'\nE=\"mismatched'\nA=second\n";
        assert_eq!(read_key(src, "A").as_deref(), Some("plain"));
        assert_eq!(read_key(src, "B").as_deref(), Some("quoted # kept"));
        assert_eq!(read_key(src, "C").as_deref(), Some("value"));
        assert_eq!(read_key(src, "D").as_deref(), Some("single"));
        assert_eq!(read_key(src, "E").as_deref(), Some("\"mismatched'"));
        assert_eq!(read_key(src, "F"), None);
    }

    #[test]
    fn only_the_local_hosts_are_local() {
        let local = |url: &str| {
            !Backend {
                url: url.into(),
                publishable_key: String::new(),
            }
            .is_cloud()
        };
        assert!(local("http://127.0.0.1:54321"));
        assert!(local("http://localhost:54321"));
        assert!(local("http://[::1]:54321"));
        assert!(!local("http://localhost.example.com"));
        assert!(!local("https://wtoonrvuqumihpkbvwvs.supabase.co"));
    }
}
