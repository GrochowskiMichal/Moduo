//! Anonymous install id for staged update rollouts (PLAT-6).
//!
//! A random UUID minted on first launch and kept in the app data folder. The updater sends it as
//! `Moduo-Install-Id` so the update server (`infra/update-server`) can put this install in a
//! stable rollout bucket. It names no person or account. The updater sends it with every update
//! request it makes, so the GitHub fallback endpoint and the download hosts see it too.

use std::{fs, path::Path};

pub const HEADER: &str = "Moduo-Install-Id";
const FILE: &str = "install-id";

fn is_valid(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// The id stored in `dir`, or a new one written there. If the folder can't be written, the id
/// is still returned (this launch gets a bucket; the next launch may get another).
pub fn load_or_create(dir: &Path) -> String {
    let path = dir.join(FILE);
    if let Ok(stored) = fs::read_to_string(&path) {
        let stored = stored.trim();
        if is_valid(stored) {
            return stored.to_string();
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    if fs::create_dir_all(dir).is_ok() {
        let _ = fs::write(&path, &id);
    }
    id
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("moduo-install-id-{name}-{}", uuid::Uuid::new_v4()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn mints_once_and_keeps_it() {
        let dir = scratch("keep");
        let first = load_or_create(&dir);
        assert!(is_valid(&first));
        assert_eq!(load_or_create(&dir), first);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn replaces_a_damaged_file() {
        let dir = scratch("damaged");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE), "not an id\n../../x").unwrap();
        let id = load_or_create(&dir);
        assert!(is_valid(&id));
        assert_eq!(fs::read_to_string(dir.join(FILE)).unwrap(), id);
        let _ = fs::remove_dir_all(&dir);
    }
}
