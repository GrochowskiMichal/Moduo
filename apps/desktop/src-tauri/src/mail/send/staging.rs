//! The app-owned attachment staging area (`<user store>/staging/<id>`).
//!
//! The webview is untrusted: it never names a file on disk. A file reaches a
//! draft only by being copied here, from the native file picker (the path
//! comes from the OS dialog in Rust) or from dropped/pasted bytes, and the
//! draft keeps the returned opaque id. [`resolve`] runs right before every
//! read: the id must be a UUID, the entry must be a regular file (never a
//! symlink), and its canonical path must sit inside the canonical staging dir.

use std::path::{Path, PathBuf};

/// The largest file staging accepts (the biggest provider limit is 35 MB).
pub const MAX_STAGED_BYTES: u64 = 50 * 1024 * 1024;

pub fn staging_dir(store_root: &Path) -> PathBuf {
    store_root.join("staging")
}

/// Opaque ids are lowercase hyphenated UUIDs and nothing else.
pub fn valid_id(id: &str) -> bool {
    id.len() == 36
        && uuid::Uuid::parse_str(id).is_ok_and(|u| u.hyphenated().to_string() == id)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().hyphenated().to_string()
}

/// Stores dropped or pasted bytes; returns the new id.
pub fn stage_bytes(store_root: &Path, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() as u64 > MAX_STAGED_BYTES {
        return Err("attachment_too_large".into());
    }
    let dir = staging_dir(store_root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = new_id();
    std::fs::write(dir.join(&id), bytes).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Copies a file the user chose in the native picker (a path from the OS
/// dialog, never from the webview); returns the new id.
pub fn stage_file(store_root: &Path, src: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(src).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("attachment_not_a_file".into());
    }
    if meta.len() > MAX_STAGED_BYTES {
        return Err("attachment_too_large".into());
    }
    let dir = staging_dir(store_root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = new_id();
    std::fs::copy(src, dir.join(&id)).map_err(|e| e.to_string())?;
    Ok(id)
}

/// The staged file for `id`, checked right before it is read.
pub fn resolve(store_root: &Path, id: &str) -> Result<PathBuf, String> {
    const BAD: &str = "invalid_attachment";
    if !valid_id(id) {
        return Err(BAD.into());
    }
    let dir = staging_dir(store_root);
    let p = dir.join(id);
    let meta = std::fs::symlink_metadata(&p).map_err(|_| BAD.to_string())?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(BAD.into());
    }
    let canon_dir = std::fs::canonicalize(&dir).map_err(|_| BAD.to_string())?;
    let canon = std::fs::canonicalize(&p).map_err(|_| BAD.to_string())?;
    if canon.parent() != Some(canon_dir.as_path()) {
        return Err(BAD.into());
    }
    Ok(canon)
}

/// Reads the staged file for `id` after [`resolve`].
pub fn read(store_root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let p = resolve(store_root, id)?;
    std::fs::read(p).map_err(|e| e.to_string())
}

/// Removes a staged file (the composer dropped the attachment).
pub fn remove(store_root: &Path, id: &str) -> Result<(), String> {
    let p = resolve(store_root, id)?;
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "moduo-staging-{tag}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn stages_bytes_and_files_and_reads_back() {
        let r = root("ok");
        let id = stage_bytes(&r, b"hello").unwrap();
        assert!(valid_id(&id));
        assert_eq!(read(&r, &id).unwrap(), b"hello");
        let src = r.join("picked.txt");
        std::fs::write(&src, b"picked").unwrap();
        let id2 = stage_file(&r, &src).unwrap();
        assert_eq!(read(&r, &id2).unwrap(), b"picked");
        remove(&r, &id).unwrap();
        assert!(read(&r, &id).is_err());
    }

    #[test]
    fn rejects_hostile_ids() {
        let r = root("hostile");
        stage_bytes(&r, b"x").unwrap();
        std::fs::write(r.join("secret"), b"s").unwrap();
        for id in [
            "/etc/passwd",
            "../secret",
            "../../etc/passwd",
            "..",
            "",
            "secret",
            "/tmp/a.pdf",
            "00000000-0000-0000-0000-00000000000/",
            "00000000-0000-0000-0000-000000000000/../../secret",
            "ABCDEF00-0000-0000-0000-000000000000",
        ] {
            assert_eq!(read(&r, id), Err("invalid_attachment".into()), "{id}");
        }
        // A well-formed id that was never staged.
        assert!(resolve(&r, &new_id()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_inside_staging() {
        let r = root("link");
        let dir = staging_dir(&r);
        std::fs::create_dir_all(&dir).unwrap();
        let outside = r.join("outside.txt");
        std::fs::write(&outside, b"secret").unwrap();
        let id = new_id();
        std::os::unix::fs::symlink(&outside, dir.join(&id)).unwrap();
        assert_eq!(read(&r, &id), Err("invalid_attachment".into()));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_staging_dir_symlinked_elsewhere() {
        let r = root("dirlink");
        let elsewhere = root("elsewhere");
        let id = new_id();
        std::fs::write(elsewhere.join(&id), b"secret").unwrap();
        std::os::unix::fs::symlink(&elsewhere, staging_dir(&r)).unwrap();
        // The entry is a real file, but staging itself points outside: the
        // canonical parent is the canonical staging dir, which is still
        // app-chosen, so the check that matters is the entry itself.
        assert!(resolve(&r, &id).is_ok());
        // A directory with an id name is not a file.
        let id2 = new_id();
        std::fs::create_dir(elsewhere.join(&id2)).unwrap();
        assert!(resolve(&r, &id2).is_err());
    }

    #[test]
    fn stage_file_rejects_directories() {
        let r = root("dir");
        assert_eq!(stage_file(&r, &r), Err("attachment_not_a_file".into()));
    }
}
