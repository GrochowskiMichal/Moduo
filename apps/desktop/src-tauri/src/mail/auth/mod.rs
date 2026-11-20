//! Mail auth (MR-2, AC10/AC37): password, Google (personal + Workspace) and
//! Microsoft XOAUTH2, with a refresh **before every IMAP/SMTP use**.
//!
//! Every session the account actor opens goes through [`ensure_fresh`], so no
//! path (IDLE, command pool, SMTP) can use a stale token. A refused refresh
//! (`invalid_grant`) is terminal: the account flips to `Reconnect` and the
//! caller gets [`AuthError::Reconnect`], which the actor never retries.
//! Transient failures keep the stored token and are retried with backoff.

pub mod google;
pub mod microsoft;

use serde::{Deserialize, Serialize};

use crate::mail::contracts::Provider;

/// Refresh once within this many seconds of expiry (or past it).
pub const REFRESH_SKEW_SECS: i64 = 120;

/// A stored mail credential. The serde shape (`kind` tag, snake_case) is the
/// legacy engine's `StoredMailSecret`, so keychain payloads carry over without
/// re-login (decision 24). `scope` is new and optional (Microsoft names it on
/// refresh); legacy payloads deserialize with `None`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Credential {
    Password {
        password: String,
    },
    Oauth {
        access_token: String,
        refresh_token: Option<String>,
        expires_at: i64,
    },
}

/// What a session needs to log in: LOGIN or XOAUTH2.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoginMethod {
    Password { user: String, password: String },
    Xoauth2 { user: String, access_token: String },
}

impl LoginMethod {
    pub fn user(&self) -> &str {
        match self {
            LoginMethod::Password { user, .. } | LoginMethod::Xoauth2 { user, .. } => user,
        }
    }
}

/// A fresh token from a provider's refresh grant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RefreshedToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RefreshError {
    /// The provider refused the refresh token (revoked, expired, testing-mode cap).
    InvalidGrant,
    /// Network / 5xx: retryable.
    Transient(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthError {
    /// Terminal: the user must reconnect. Never retried by the actor.
    Reconnect,
    /// The org's admin must allow Moduo (AC37 honest copy). Carries the provider code.
    AdminConsentRequired { provider_code: String },
    /// No secret in the keychain for this account.
    MissingSecret,
    /// Retryable.
    Transient(String),
}

impl AuthError {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            AuthError::Reconnect | AuthError::AdminConsentRequired { .. } | AuthError::MissingSecret
        )
    }

    /// The wire code the UI maps to copy.
    pub fn code(&self) -> String {
        match self {
            AuthError::Reconnect => "account_reauth_required".into(),
            AuthError::AdminConsentRequired { provider_code } => {
                format!("admin_consent_required:{provider_code}")
            }
            AuthError::MissingSecret => "account_secret_missing".into(),
            AuthError::Transient(e) => format!("auth_transient:{e}"),
        }
    }
}

/// Exchanges a refresh token for a new access token (one impl per provider).
pub trait TokenRefresher: Send + Sync {
    fn refresh(
        &self,
        refresh_token: &str,
    ) -> impl std::future::Future<Output = Result<RefreshedToken, RefreshError>> + Send;
}

/// Where credentials live and where Reconnect is recorded.
pub trait CredentialStore: Send + Sync {
    fn load(&self, account_id: &str) -> Result<Option<Credential>, String>;
    fn save(&self, account_id: &str, credential: &Credential) -> Result<(), String>;
    fn delete(&self, account_id: &str) -> Result<(), String>;
    fn mark_reconnect(&self, account_id: &str);
}

/// Load the account's credential, refreshing an OAuth token first when it is
/// within [`REFRESH_SKEW_SECS`] of expiry. Called before **every** session open.
pub async fn ensure_fresh<S: CredentialStore, R: TokenRefresher>(
    store: &S,
    refresher: &R,
    account_id: &str,
    user: &str,
    now: i64,
) -> Result<LoginMethod, AuthError> {
    let credential = store
        .load(account_id)
        .map_err(AuthError::Transient)?
        .ok_or(AuthError::MissingSecret)?;
    match credential {
        Credential::Password { password } => Ok(LoginMethod::Password {
            user: user.to_string(),
            password,
        }),
        Credential::Oauth {
            access_token,
            refresh_token,
            expires_at,
        } => {
            if now.saturating_add(REFRESH_SKEW_SECS) < expires_at {
                return Ok(LoginMethod::Xoauth2 {
                    user: user.to_string(),
                    access_token,
                });
            }
            let Some(refresh) = refresh_token else {
                store.mark_reconnect(account_id);
                return Err(AuthError::Reconnect);
            };
            match refresher.refresh(&refresh).await {
                Ok(fresh) => {
                    let saved = Credential::Oauth {
                        access_token: fresh.access_token.clone(),
                        // Google omits refresh_token on refresh; Microsoft rotates it.
                        refresh_token: fresh.refresh_token.or(Some(refresh)),
                        expires_at: now + fresh.expires_in.unwrap_or(3600),
                    };
                    store.save(account_id, &saved).map_err(AuthError::Transient)?;
                    Ok(LoginMethod::Xoauth2 {
                        user: user.to_string(),
                        access_token: fresh.access_token,
                    })
                }
                Err(RefreshError::InvalidGrant) => {
                    store.mark_reconnect(account_id);
                    Err(AuthError::Reconnect)
                }
                Err(RefreshError::Transient(e)) => Err(AuthError::Transient(e)),
            }
        }
    }
}

/// Classify a provider's OAuth error body (authorize redirect or token endpoint).
pub fn classify_oauth_error(provider: Provider, body: &str) -> AuthError {
    match provider {
        Provider::Outlook => microsoft::classify_error(body),
        Provider::Gmail | Provider::GoogleWorkspace => google::classify_error(body),
        _ => AuthError::Transient(body.to_string()),
    }
}

/// Keychain account handle, identical to the legacy engine's
/// (`email_{user_id}_{account_id}`), so secrets are reused without re-login.
pub fn keychain_account(user_id: &str, account_id: &str) -> String {
    format!("email_{user_id}_{account_id}")
}

/// The OS keychain store, scoped per signed-in user. Reconnect marks are
/// forwarded to `on_reconnect` (the account repo, wired by the engine).
pub struct KeychainStore<F: Fn(&str) + Send + Sync> {
    pub service: String,
    pub user_id: String,
    pub on_reconnect: F,
}

impl<F: Fn(&str) + Send + Sync> CredentialStore for KeychainStore<F> {
    fn load(&self, account_id: &str) -> Result<Option<Credential>, String> {
        let raw = crate::keychain::get_secret_strict(
            &self.service,
            &keychain_account(&self.user_id, account_id),
        )
        .map_err(|e| e.to_string())?;
        raw.map(|raw| serde_json::from_str(&raw).map_err(|e| format!("secret_decode_failed:{e}")))
            .transpose()
    }

    fn save(&self, account_id: &str, credential: &Credential) -> Result<(), String> {
        let encoded = serde_json::to_string(credential).map_err(|e| e.to_string())?;
        crate::keychain::set_secret(
            &self.service,
            &keychain_account(&self.user_id, account_id),
            &encoded,
        )
        .map_err(|e| e.to_string())
    }

    fn delete(&self, account_id: &str) -> Result<(), String> {
        crate::keychain::delete_secret(&self.service, &keychain_account(&self.user_id, account_id))
            .map_err(|e| e.to_string())
    }

    fn mark_reconnect(&self, account_id: &str) {
        (self.on_reconnect)(account_id)
    }
}

/// Map the generic OAuth refresh call into a [`TokenRefresher`] for one provider.
pub struct HttpRefresher {
    pub token_endpoint: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    /// Microsoft names the scopes again on refresh; Google doesn't.
    pub scope: Option<String>,
}

impl TokenRefresher for HttpRefresher {
    async fn refresh(&self, refresh_token: &str) -> Result<RefreshedToken, RefreshError> {
        use crate::commands::oauth_flow::{refresh_access_token, OAuthRefreshError};
        match refresh_access_token(
            &self.token_endpoint,
            &self.client_id,
            self.client_secret.as_deref(),
            refresh_token,
            self.scope.as_deref(),
        )
        .await
        {
            Ok(t) => Ok(RefreshedToken {
                access_token: t.access_token,
                refresh_token: t.refresh_token,
                expires_in: t.expires_in,
            }),
            Err(OAuthRefreshError::InvalidGrant) => Err(RefreshError::InvalidGrant),
            Err(OAuthRefreshError::Other(e)) => Err(RefreshError::Transient(e)),
        }
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct MemStore {
        pub secrets: Mutex<HashMap<String, Credential>>,
        pub reconnects: Mutex<Vec<String>>,
    }

    impl CredentialStore for MemStore {
        fn load(&self, id: &str) -> Result<Option<Credential>, String> {
            Ok(self.secrets.lock().unwrap().get(id).cloned())
        }
        fn save(&self, id: &str, c: &Credential) -> Result<(), String> {
            self.secrets.lock().unwrap().insert(id.into(), c.clone());
            Ok(())
        }
        fn delete(&self, id: &str) -> Result<(), String> {
            self.secrets.lock().unwrap().remove(id);
            Ok(())
        }
        fn mark_reconnect(&self, id: &str) {
            self.reconnects.lock().unwrap().push(id.into());
        }
    }

    pub struct FakeRefresher {
        pub result: Result<RefreshedToken, RefreshError>,
        pub calls: AtomicUsize,
    }

    impl FakeRefresher {
        pub fn ok(token: &str) -> Self {
            Self {
                result: Ok(RefreshedToken {
                    access_token: token.into(),
                    refresh_token: None,
                    expires_in: Some(3600),
                }),
                calls: AtomicUsize::new(0),
            }
        }
        pub fn err(e: RefreshError) -> Self {
            Self {
                result: Err(e),
                calls: AtomicUsize::new(0),
            }
        }
        pub fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl TokenRefresher for FakeRefresher {
        async fn refresh(&self, _r: &str) -> Result<RefreshedToken, RefreshError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.result.clone()
        }
    }

    pub fn oauth(token: &str, expires_at: i64) -> Credential {
        Credential::Oauth {
            access_token: token.into(),
            refresh_token: Some("rt".into()),
            expires_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    fn block<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }

    #[test]
    fn legacy_secret_payload_decodes_unchanged() {
        let legacy = r#"{"kind":"oauth","access_token":"a","refresh_token":"r","expires_at":5}"#;
        let c: Credential = serde_json::from_str(legacy).unwrap();
        assert_eq!(c, Credential::Oauth { access_token: "a".into(), refresh_token: Some("r".into()), expires_at: 5 });
        let pw: Credential = serde_json::from_str(r#"{"kind":"password","password":"p"}"#).unwrap();
        assert_eq!(pw, Credential::Password { password: "p".into() });
        assert_eq!(keychain_account("u", "gmail:a@b.c"), "email_u_gmail:a@b.c");
    }

    #[test]
    fn fresh_token_is_used_without_refresh() {
        let store = MemStore::default();
        store.save("a", &oauth("live", 10_000)).unwrap();
        let r = FakeRefresher::ok("new");
        let login = block(ensure_fresh(&store, &r, "a", "me@x.com", 1_000)).unwrap();
        assert_eq!(login, LoginMethod::Xoauth2 { user: "me@x.com".into(), access_token: "live".into() });
        assert_eq!(r.calls(), 0);
    }

    #[test]
    fn expiring_token_refreshes_and_keeps_refresh_token() {
        let store = MemStore::default();
        store.save("a", &oauth("old", 1_050)).unwrap();
        let r = FakeRefresher::ok("new");
        let login = block(ensure_fresh(&store, &r, "a", "me@x.com", 1_000)).unwrap();
        assert_eq!(login.user(), "me@x.com");
        assert_eq!(r.calls(), 1);
        assert_eq!(store.load("a").unwrap(), Some(Credential::Oauth { access_token: "new".into(), refresh_token: Some("rt".into()), expires_at: 4_600 }));
    }

    #[test]
    fn invalid_grant_marks_reconnect() {
        let store = MemStore::default();
        store.save("a", &oauth("old", 0)).unwrap();
        let r = FakeRefresher::err(RefreshError::InvalidGrant);
        let err = block(ensure_fresh(&store, &r, "a", "me@x.com", 1_000)).unwrap_err();
        assert_eq!(err, AuthError::Reconnect);
        assert!(err.is_terminal());
        assert_eq!(*store.reconnects.lock().unwrap(), vec!["a".to_string()]);
        // The stored token is untouched (a later Reconnect replaces it).
        assert_eq!(store.load("a").unwrap(), Some(oauth("old", 0)));
    }

    #[test]
    fn transient_refresh_failure_is_retryable_and_not_reconnect() {
        let store = MemStore::default();
        store.save("a", &oauth("old", 0)).unwrap();
        let r = FakeRefresher::err(RefreshError::Transient("503".into()));
        let err = block(ensure_fresh(&store, &r, "a", "me@x.com", 1_000)).unwrap_err();
        assert!(!err.is_terminal());
        assert!(store.reconnects.lock().unwrap().is_empty());
    }

    #[test]
    fn password_and_missing_secret() {
        let store = MemStore::default();
        let r = FakeRefresher::ok("x");
        assert_eq!(block(ensure_fresh(&store, &r, "a", "u", 0)).unwrap_err(), AuthError::MissingSecret);
        store.save("a", &Credential::Password { password: "pw".into() }).unwrap();
        assert_eq!(
            block(ensure_fresh(&store, &r, "a", "u", 0)).unwrap(),
            LoginMethod::Password { user: "u".into(), password: "pw".into() }
        );
        assert_eq!(r.calls(), 0);
    }
}
