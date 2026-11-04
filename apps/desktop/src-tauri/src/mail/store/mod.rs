//! SQLite mail store (MR-1, specs/mail-rebuild.md decisions 2–3).
//!
//! One file per signed-in user (`<app data>/mail/<user_id>/mail.db`), WAL, FTS5.
//! A writer connection and a reader connection share the file, so list reads
//! never wait behind a sync transaction. Attachment bytes live beside it as
//! content-addressed files under `files/<account_id>/`.

pub mod query;
pub mod schema;
pub mod types;
pub mod write;

#[cfg(test)]
mod perf;
#[cfg(test)]
mod tests;
#[cfg(test)]
pub(crate) use perf::load_into as perf_load_into;

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

pub use types::*;

pub type StoreResult<T> = Result<T, StoreError>;

#[derive(Debug)]
pub enum StoreError {
    Sql(rusqlite::Error),
    Io(std::io::Error),
    Invalid(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Sql(e) => write!(f, "mail store: {e}"),
            StoreError::Io(e) => write!(f, "mail store io: {e}"),
            StoreError::Invalid(s) => write!(f, "mail store: {s}"),
        }
    }
}
impl std::error::Error for StoreError {}
impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Sql(e)
    }
}
impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        StoreError::Io(e)
    }
}

pub struct Store {
    root: PathBuf,
    writer: Mutex<Connection>,
    reader: Mutex<Connection>,
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    // 16 MB page cache per connection keeps the engine well under the AC7 budget.
    conn.pragma_update(None, "cache_size", -16_000)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

impl Store {
    /// Opens (creating and migrating) `<dir>/mail.db`.
    pub fn open(dir: &Path) -> StoreResult<Store> {
        std::fs::create_dir_all(dir)?;
        let db = dir.join("mail.db");
        let mut writer = Connection::open(&db)?;
        configure(&writer)?;
        schema::migrate(&mut writer)?;
        let reader = Connection::open_with_flags(
            &db,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        configure(&reader)?;
        Ok(Store {
            root: dir.to_path_buf(),
            writer: Mutex::new(writer),
            reader: Mutex::new(reader),
        })
    }

    /// `<app data>/mail/<user_id>/`.
    pub fn user_dir(app_data: &Path, user_id: &str) -> StoreResult<PathBuf> {
        let ok = !user_id.is_empty()
            && user_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if !ok {
            return Err(StoreError::Invalid(format!("bad user id {user_id:?}")));
        }
        Ok(app_data.join("mail").join(user_id))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn files_dir(&self, account_id: &str) -> PathBuf {
        self.root.join("files").join(safe_segment(account_id))
    }

    pub(crate) fn w(&self) -> MutexGuard<'_, Connection> {
        self.writer.lock().unwrap_or_else(|p| p.into_inner())
    }
    pub(crate) fn r(&self) -> MutexGuard<'_, Connection> {
        self.reader.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// Account ids become directory names: hex-encode anything outside [A-Za-z0-9_-].
pub(crate) fn safe_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02x}"));
        }
    }
    out
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
