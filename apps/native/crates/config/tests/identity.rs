use std::path::Path;

use moduo_config::identity::{
    self, Identity, DEBUG, RELEASE, TAURI_BUNDLE_ID, TAURI_KEYCHAIN_SERVICES,
};

#[test]
fn service_bundle_id_and_data_dir_never_equal_the_tauri_apps() {
    let home = Path::new("/Users/someone");
    let tauri_data = home
        .join("Library/Application Support")
        .join(TAURI_BUNDLE_ID);
    for id in [&RELEASE, &DEBUG] {
        assert_ne!(id.bundle_id, TAURI_BUNDLE_ID);
        assert!(
            !id.bundle_id.starts_with(&format!("{TAURI_BUNDLE_ID}.")),
            "{} sits under the Tauri id",
            id.bundle_id
        );
        for service in TAURI_KEYCHAIN_SERVICES {
            assert_ne!(id.keychain_service, service);
        }
        let data = identity::data_dir(id, home);
        assert_ne!(data, tauri_data);
        assert!(!data.starts_with(&tauri_data));
        assert!(data.ends_with(id.bundle_id));
    }
}

#[test]
fn debug_and_release_use_different_keychain_services() {
    assert_ne!(RELEASE.keychain_service, DEBUG.keychain_service);
    assert_ne!(RELEASE.bundle_id, DEBUG.bundle_id);
    let current: &Identity = identity::current();
    assert_eq!(
        current,
        if cfg!(debug_assertions) {
            &DEBUG
        } else {
            &RELEASE
        }
    );
}

#[test]
fn a_persons_folder_stays_inside_the_data_folder() {
    let data = Path::new("/data");
    let ok = identity::person_dir(data, "6f1c2a9e-1b2c-4d5e-8f90-123456789abc").unwrap();
    assert_eq!(ok, data.join("people/6f1c2a9e-1b2c-4d5e-8f90-123456789abc"));
    for bad in ["", "..", "../x", "a/b", "a\\b", "."] {
        assert!(
            identity::person_dir(data, bad).is_none(),
            "{bad:?} was accepted"
        );
    }
}
