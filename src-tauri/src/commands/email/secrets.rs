//! Email account secret storage.
//!
//! Secrets live in the **OS keychain** (never redb-cleartext, never the cloud).
//! Legacy accounts stored their password as a cleartext JSON string in redb; this
//! module migrates those lazily on first read — write to the keychain, then wipe
//! redb — and never drops a secret if the keychain is momentarily locked
//! (assumption 3: a startup sweep would lose secrets).
//!
//! The migration logic is a pure function over [`SecretBackend`] so the read →
//! keychain-write → legacy-wipe sequence is unit-testable without a real keychain
//! or redb (EM-1 test: `secrets.rs unit · keychain migration`).

use serde::{Deserialize, Serialize};

use super::account_config::account_secret_key;
use super::constants::EMAIL_NAMESPACE;
use crate::AppState;

/// A stored mail credential. `Password` covers app-password / custom-IMAP accounts;
/// `Oauth` (EM-2) carries refreshable Google tokens for a "Sign in with Google"
/// Gmail account. The serde tag (`"kind"`) discriminates them in the keychain
/// payload so both live under the same keychain scope.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum StoredMailSecret {
    Password {
        password: String,
    },
    Oauth {
        access_token: String,
        /// Long-lived; a refresh response usually omits it, so we keep the original.
        refresh_token: Option<String>,
        /// Absolute Unix-seconds expiry of `access_token` (issue time + `expires_in`).
        expires_at: i64,
    },
}

// Consumers destructure `StoredMailSecret` directly (see `ensure_account_config`),
// so the type carries no accessor methods.

/// Keychain account handle for an email account, scoped per signed-in user so two
/// users on one machine never collide (mirrors the calendar/CalDAV convention
/// `calendar_{provider}_{user}_{id}`).
pub(super) fn email_keychain_account(user_id: &str, account_id: &str) -> String {
    format!("email_{user_id}_{account_id}")
}

/// Injection seam for [`resolve_secret`] so the migration sequence can be tested
/// without a real keychain or redb store.
pub(super) trait SecretBackend {
    /// Raw JSON payload stored in the keychain for this keychain-account, if any.
    fn keychain_get(&self, kc_account: &str) -> Result<Option<String>, String>;
    /// Persist the raw JSON payload to the keychain.
    fn keychain_set(&self, kc_account: &str, value: &str) -> Result<(), String>;
    /// The legacy redb-cleartext password for this account id, if any.
    fn legacy_get(&self, account_id: &str) -> Result<Option<String>, String>;
    /// Remove the legacy redb-cleartext password.
    fn legacy_delete(&self, account_id: &str) -> Result<(), String>;
}

/// Resolve an account's secret, keychain-first, migrating a legacy redb-cleartext
/// password on the way.
///
/// `user_id` is `None` when there is no authenticated session. In that case we
/// **never migrate or wipe**: the legacy redb secret is un-scoped, and writing it
/// under the "no-session" fallback scope + wiping legacy would strand it once a
/// real user id returns (the account would falsely flip to reauth). We just read
/// legacy and leave it — migration waits for a real session. (Same "never drop a
/// secret" discipline the locked-keychain case already follows.)
///
/// With a session:
/// - keychain hit → decode and return (legacy untouched).
/// - keychain miss + legacy hit → return the legacy secret and *best-effort*
///   migrate it: write the keychain, and **only if that write succeeds** wipe
///   redb. A locked keychain keeps the legacy copy so the next read retries.
/// - neither → `None`.
pub(super) fn resolve_secret<B: SecretBackend>(
    backend: &B,
    user_id: Option<&str>,
    account_id: &str,
) -> Result<Option<StoredMailSecret>, String> {
    let Some(user_id) = user_id else {
        // No session: read legacy only, never migrate/wipe.
        return legacy_secret(backend, account_id);
    };

    let kc_account = email_keychain_account(user_id, account_id);
    if let Some(raw) = backend.keychain_get(&kc_account)? {
        return Ok(Some(decode_secret(&raw)?));
    }

    let Some(secret) = legacy_secret(backend, account_id)? else {
        return Ok(None);
    };
    if let Ok(encoded) = serde_json::to_string(&secret) {
        // Persist FIRST; wipe legacy ONLY on a confirmed keychain write.
        if backend.keychain_set(&kc_account, &encoded).is_ok() {
            let _ = backend.legacy_delete(account_id);
        }
    }
    Ok(Some(secret))
}

/// Read the legacy un-scoped redb-cleartext secret (no migration, no wipe).
fn legacy_secret<B: SecretBackend>(
    backend: &B,
    account_id: &str,
) -> Result<Option<StoredMailSecret>, String> {
    Ok(backend
        .legacy_get(account_id)?
        .map(|password| StoredMailSecret::Password { password }))
}

fn decode_secret(raw: &str) -> Result<StoredMailSecret, String> {
    serde_json::from_str::<StoredMailSecret>(raw)
        .map_err(|e| format!("email_secret_decode_failed:{e}"))
}

// ── Real backend (keychain + redb) ─────────────────────────────────────────────

struct AppSecretBackend<'a> {
    state: &'a AppState,
    service: String,
}

impl<'a> SecretBackend for AppSecretBackend<'a> {
    fn keychain_get(&self, kc_account: &str) -> Result<Option<String>, String> {
        // `get_secret` maps a locked keychain (NoStorageAccess) to `Ok(None)` — a
        // locked keychain reads as "not migrated yet", falling through to legacy.
        crate::keychain::get_secret(&self.service, kc_account).map_err(|e| e.to_string())
    }

    fn keychain_set(&self, kc_account: &str, value: &str) -> Result<(), String> {
        crate::keychain::set_secret(&self.service, kc_account, value).map_err(|e| e.to_string())
    }

    fn legacy_get(&self, account_id: &str) -> Result<Option<String>, String> {
        let raw = self
            .state
            .store
            .kv_get(EMAIL_NAMESPACE, &account_secret_key(account_id))
            .map_err(|e| e.to_string())?;
        match raw {
            None => Ok(None),
            Some(value) => serde_json::from_value::<String>(value)
                .map(Some)
                .map_err(|e| e.to_string()),
        }
    }

    fn legacy_delete(&self, account_id: &str) -> Result<(), String> {
        self.state
            .store
            .kv_remove(EMAIL_NAMESPACE, &account_secret_key(account_id))
            .map_err(|e| e.to_string())
    }
}

/// The signed-in user's id, or `None` when there's no session (signed out or the
/// session mutex is momentarily unavailable). Deliberately NOT a `"local"`
/// fallback — the keychain scope must be a real, stable user id or not written at
/// all (see `resolve_secret`).
fn session_user_id(state: &AppState) -> Option<String> {
    state
        .session
        .lock()
        .ok()
        .and_then(|v| v.as_ref().map(|s| s.user.id.clone()))
}

fn backend(state: &AppState) -> AppSecretBackend<'_> {
    AppSecretBackend {
        state,
        service: state.config.keychain_service.clone(),
    }
}

/// The account's stored secret of any kind (password OR oauth), keychain-first.
/// `None` means the account must be reconnected.
pub(super) fn get_secret(
    state: &AppState,
    account_id: &str,
) -> Result<Option<StoredMailSecret>, String> {
    let user_id = session_user_id(state);
    resolve_secret(&backend(state), user_id.as_deref(), account_id)
}

/// Whether the account has *any* usable secret (password or oauth). Used by the
/// account list to decide `reauth_required` — an OAuth account has no password, so
/// a `get_password`-based check would wrongly flag it.
pub(super) fn account_has_secret(state: &AppState, account_id: &str) -> Result<bool, String> {
    Ok(get_secret(state, account_id)?.is_some())
}

/// Store an account's OAuth tokens in the OS keychain (Gmail "Sign in with Google"
/// connect + refresh). Requires an authenticated session — same guard as
/// [`save_password`].
pub(super) fn save_oauth_secret(
    state: &AppState,
    account_id: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    expires_at: i64,
) -> Result<(), String> {
    let user_id = session_user_id(state).ok_or_else(|| "email_no_session".to_string())?;
    let kc_account = email_keychain_account(&user_id, account_id);
    let encoded = serde_json::to_string(&StoredMailSecret::Oauth {
        access_token: access_token.to_string(),
        refresh_token: refresh_token.map(str::to_string),
        expires_at,
    })
    .map_err(|e| format!("email_secret_serialize_failed:{e}"))?;
    crate::keychain::set_secret(&state.config.keychain_service, &kc_account, &encoded)
        .map_err(|e| format!("email_secret_store_failed:{e}"))
}

/// Store an account password in the OS keychain (connect flow). Requires an
/// authenticated session — connect always runs inside a signed-in workspace, so
/// the scope exists; the guard just refuses to write an un-scopable secret.
pub(super) fn save_password(
    state: &AppState,
    account_id: &str,
    password: &str,
) -> Result<(), String> {
    let user_id = session_user_id(state).ok_or_else(|| "email_no_session".to_string())?;
    let kc_account = email_keychain_account(&user_id, account_id);
    let encoded = serde_json::to_string(&StoredMailSecret::Password {
        password: password.to_string(),
    })
    .map_err(|e| format!("email_secret_serialize_failed:{e}"))?;
    crate::keychain::set_secret(&state.config.keychain_service, &kc_account, &encoded)
        .map_err(|e| format!("email_secret_store_failed:{e}"))
}

/// Remove an account's secret from the keychain (if a session scopes it), and
/// clear any legacy redb copy (disconnect flow). Best-effort — a missing entry is
/// not an error.
pub(super) fn delete_account_secret(state: &AppState, account_id: &str) -> Result<(), String> {
    if let Some(user_id) = session_user_id(state) {
        let kc_account = email_keychain_account(&user_id, account_id);
        let _ = crate::keychain::delete_secret(&state.config.keychain_service, &kc_account);
    }
    let _ = state
        .store
        .kv_remove(EMAIL_NAMESPACE, &account_secret_key(account_id));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn password_of(secret: &StoredMailSecret) -> Option<&str> {
        match secret {
            StoredMailSecret::Password { password } => Some(password),
            StoredMailSecret::Oauth { .. } => None,
        }
    }

    /// In-memory backend recording call counts + a locked-keychain toggle.
    #[derive(Default)]
    struct FakeBackend {
        keychain: RefCell<std::collections::HashMap<String, String>>,
        legacy: RefCell<std::collections::HashMap<String, String>>,
        keychain_locked: bool,
        legacy_reads: RefCell<usize>,
    }

    impl SecretBackend for FakeBackend {
        fn keychain_get(&self, kc_account: &str) -> Result<Option<String>, String> {
            // A locked keychain reads as empty (mirrors the real `get_secret`).
            if self.keychain_locked {
                return Ok(None);
            }
            Ok(self.keychain.borrow().get(kc_account).cloned())
        }
        fn keychain_set(&self, kc_account: &str, value: &str) -> Result<(), String> {
            if self.keychain_locked {
                return Err("keychain_locked".to_string());
            }
            self.keychain
                .borrow_mut()
                .insert(kc_account.to_string(), value.to_string());
            Ok(())
        }
        fn legacy_get(&self, account_id: &str) -> Result<Option<String>, String> {
            *self.legacy_reads.borrow_mut() += 1;
            Ok(self.legacy.borrow().get(account_id).cloned())
        }
        fn legacy_delete(&self, account_id: &str) -> Result<(), String> {
            self.legacy.borrow_mut().remove(account_id);
            Ok(())
        }
    }

    const USER: &str = "user-1";
    const ACCT: &str = "gmail:me@gmail.com";

    #[test]
    fn migrates_legacy_into_keychain_and_wipes_redb() {
        let b = FakeBackend::default();
        b.legacy
            .borrow_mut()
            .insert(ACCT.to_string(), "hunter2".to_string());

        let got = resolve_secret(&b, Some(USER), ACCT).unwrap().unwrap();
        assert_eq!(password_of(&got), Some("hunter2"));

        // Keychain now holds it under the user-scoped account handle...
        let kc_account = email_keychain_account(USER, ACCT);
        let stored = b.keychain.borrow().get(&kc_account).cloned().unwrap();
        assert_eq!(
            decode_secret(&stored).unwrap(),
            StoredMailSecret::Password {
                password: "hunter2".to_string()
            }
        );
        // ...and the legacy cleartext copy is gone.
        assert!(b.legacy.borrow().get(ACCT).is_none());
    }

    #[test]
    fn keychain_hit_never_reads_legacy() {
        let b = FakeBackend::default();
        let kc_account = email_keychain_account(USER, ACCT);
        b.keychain.borrow_mut().insert(
            kc_account,
            serde_json::to_string(&StoredMailSecret::Password {
                password: "fromkeychain".to_string(),
            })
            .unwrap(),
        );

        let got = resolve_secret(&b, Some(USER), ACCT).unwrap().unwrap();
        assert_eq!(password_of(&got), Some("fromkeychain"));
        // The legacy store is never touched on a keychain hit.
        assert_eq!(*b.legacy_reads.borrow(), 0);
    }

    #[test]
    fn locked_keychain_preserves_legacy_and_still_returns_secret() {
        let mut b = FakeBackend::default();
        b.legacy
            .borrow_mut()
            .insert(ACCT.to_string(), "hunter2".to_string());
        b.keychain_locked = true;

        // The send/read must still succeed from the legacy copy...
        let got = resolve_secret(&b, Some(USER), ACCT).unwrap().unwrap();
        assert_eq!(password_of(&got), Some("hunter2"));
        // ...and the legacy secret must NOT be dropped (migration retries later).
        assert_eq!(b.legacy.borrow().get(ACCT).map(String::as_str), Some("hunter2"));
    }

    #[test]
    fn absent_everywhere_is_none() {
        let b = FakeBackend::default();
        assert!(resolve_secret(&b, Some(USER), ACCT).unwrap().is_none());
    }

    #[test]
    fn no_session_reads_legacy_without_migrating() {
        // Regression for the migration-scoping bug: with no authenticated session
        // we must return the legacy secret but NEVER write the keychain (under a
        // fallback scope) or wipe legacy — else a real user id later can't find it.
        let b = FakeBackend::default();
        b.legacy
            .borrow_mut()
            .insert(ACCT.to_string(), "hunter2".to_string());

        let got = resolve_secret(&b, None, ACCT).unwrap().unwrap();
        assert_eq!(password_of(&got), Some("hunter2"));
        assert!(
            b.keychain.borrow().is_empty(),
            "must not write the keychain without a session scope"
        );
        assert_eq!(
            b.legacy.borrow().get(ACCT).map(String::as_str),
            Some("hunter2"),
            "must not wipe legacy without a session"
        );
    }

    #[test]
    fn secret_json_round_trips_with_tag() {
        let secret = StoredMailSecret::Password {
            password: "pw".to_string(),
        };
        let json = serde_json::to_string(&secret).unwrap();
        assert!(json.contains("\"kind\":\"password\""));
        assert_eq!(decode_secret(&json).unwrap(), secret);
    }

    #[test]
    fn oauth_secret_round_trips_and_exposes_the_right_accessor() {
        let secret = StoredMailSecret::Oauth {
            access_token: "ya29.access".to_string(),
            refresh_token: Some("1//refresh".to_string()),
            expires_at: 1_700_000_000,
        };
        let json = serde_json::to_string(&secret).unwrap();
        assert!(json.contains("\"kind\":\"oauth\""), "{json}");
        assert_eq!(decode_secret(&json).unwrap(), secret);
        // An oauth secret carries the access token, never a password (so the
        // XOAUTH2 path is taken and the basic-auth path is never reachable).
        let StoredMailSecret::Oauth { access_token, .. } = &secret else {
            panic!("expected an oauth secret");
        };
        assert_eq!(access_token, "ya29.access");
        assert_eq!(password_of(&secret), None);
    }
}
