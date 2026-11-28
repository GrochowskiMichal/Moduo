//! Who the app is to macOS: its bundle id, its Keychain service and its data folder. None of them
//! is the Tauri app's (`com.moduo.desktop`): a Keychain item belongs to the app that made it, and
//! the two apps must run side by side (specs/native-foundation.md, AC14).

use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub struct Identity {
    /// The name in the Dock and the menu bar.
    pub product_name: &'static str,
    pub bundle_id: &'static str,
    /// Where the session is kept in the Keychain.
    pub keychain_service: &'static str,
}

pub const RELEASE: Identity = Identity {
    product_name: "Moduo Native",
    bundle_id: "com.moduo.native",
    keychain_service: "com.moduo.native.auth",
};

/// Debug builds are signed differently, so they keep their own Keychain items and data
/// (the Tauri app learned this the hard way, `apps/desktop/src-tauri/src/config.rs`).
pub const DEBUG: Identity = Identity {
    product_name: "Moduo Native (dev)",
    bundle_id: "com.moduo.native.dev",
    keychain_service: "com.moduo.native.dev.auth",
};

/// The Tauri app's identity, so tests can prove the native app never shares it.
pub const TAURI_BUNDLE_ID: &str = "com.moduo.desktop";
pub const TAURI_KEYCHAIN_SERVICES: [&str; 2] =
    ["com.moduo.desktop.auth", "com.moduo.desktop.dev.auth"];

/// This build's identity.
pub fn current() -> &'static Identity {
    if cfg!(debug_assertions) {
        &DEBUG
    } else {
        &RELEASE
    }
}

/// `~/Library/Application Support/<bundle id>`.
pub fn data_dir(identity: &Identity, home: &Path) -> PathBuf {
    home.join("Library/Application Support")
        .join(identity.bundle_id)
}

/// This build's data folder, from `$HOME`.
pub fn current_data_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| data_dir(current(), Path::new(&home)))
}

/// One person's folder inside the data folder. None for an id that could leave it.
pub fn person_dir(data_dir: &Path, user_id: &str) -> Option<PathBuf> {
    let safe = !user_id.is_empty()
        && user_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    safe.then(|| data_dir.join("people").join(user_id))
}
