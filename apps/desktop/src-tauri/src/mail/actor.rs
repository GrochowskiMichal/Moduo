//! Per-account actor and session pool (MR-2, decision 4).
//!
//! Commands never open their own login: they check a session out of the
//! account's pool (≤ [`MAX_COMMAND_SESSIONS`]), reuse it, and return it. Every
//! checkout runs [`ensure_fresh`] first, so the token is refreshed before
//! every IMAP use on every path (AC10). A terminal auth error parks the actor
//! in `Reconnect`: later checkouts fail fast without touching the network, so
//! no worker spins and none downgrades for good. Transient failures back off
//! with jitter, capped at 5 minutes, and reset on the next success.

use std::future::Future;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tokio::sync::Semaphore;

use super::auth::{ensure_fresh, AuthError, CredentialStore, LoginMethod, TokenRefresher};
use super::contracts::SyncState;

pub const MAX_COMMAND_SESSIONS: usize = 3;
pub const BACKOFF_CAP: Duration = Duration::from_secs(300);

/// Jittered exponential backoff: 2s, 4s, 8s … capped at 5 min, ±25 % jitter.
pub fn backoff(attempt: u32, jitter_unit: f64) -> Duration {
    let base = 2f64.powi(attempt.min(16) as i32 + 1).min(BACKOFF_CAP.as_secs_f64());
    let jitter = 0.75 + 0.5 * jitter_unit.clamp(0.0, 1.0);
    Duration::from_secs_f64((base * jitter).min(BACKOFF_CAP.as_secs_f64()))
}

/// Opens a logged-in session (the real one is [`super::session::open`]).
pub trait Connector: Send + Sync {
    type Session: Send;
    fn connect(&self, login: &LoginMethod) -> impl Future<Output = Result<Self::Session, String>> + Send;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckoutError {
    Auth(AuthError),
    Connect(String),
}

pub struct AccountActor<S: CredentialStore, R: TokenRefresher, C: Connector> {
    pub account_id: String,
    pub user: String,
    store: S,
    refresher: R,
    connector: C,
    idle: Mutex<Vec<C::Session>>,
    permits: Semaphore,
    state: Mutex<SyncState>,
    failures: AtomicU32,
    clock: fn() -> i64,
}

/// A checked-out session; give it back with [`AccountActor::checkin`] or drop it
/// (a broken session is simply dropped and the slot frees).
pub struct Lease<'a, T> {
    pub session: Option<T>,
    _permit: tokio::sync::SemaphorePermit<'a>,
}

impl<S: CredentialStore, R: TokenRefresher, C: Connector> AccountActor<S, R, C> {
    pub fn new(account_id: &str, user: &str, store: S, refresher: R, connector: C, clock: fn() -> i64) -> Self {
        Self {
            account_id: account_id.into(),
            user: user.into(),
            store,
            refresher,
            connector,
            idle: Mutex::new(Vec::new()),
            permits: Semaphore::new(MAX_COMMAND_SESSIONS),
            state: Mutex::new(SyncState::Idle),
            failures: AtomicU32::new(0),
            clock,
        }
    }

    pub fn state(&self) -> SyncState {
        *self.state.lock().unwrap()
    }

    fn set_state(&self, s: SyncState) {
        *self.state.lock().unwrap() = s;
    }

    pub fn store(&self) -> &S {
        &self.store
    }

    /// Fresh login material; shared by IDLE, command and SMTP paths.
    pub async fn login(&self) -> Result<LoginMethod, CheckoutError> {
        if self.state() == SyncState::Reconnect {
            return Err(CheckoutError::Auth(AuthError::Reconnect));
        }
        match ensure_fresh(&self.store, &self.refresher, &self.account_id, &self.user, (self.clock)()).await {
            Ok(l) => Ok(l),
            Err(e) => {
                if e.is_terminal() {
                    self.set_state(SyncState::Reconnect);
                    self.store.mark_reconnect(&self.account_id);
                }
                Err(CheckoutError::Auth(e))
            }
        }
    }

    /// Open a dedicated session (the IDLE one), after a refresh.
    pub async fn open_dedicated(&self) -> Result<C::Session, CheckoutError> {
        let login = self.login().await?;
        self.connect(&login).await
    }

    async fn connect(&self, login: &LoginMethod) -> Result<C::Session, CheckoutError> {
        match self.connector.connect(login).await {
            Ok(s) => {
                self.failures.store(0, Ordering::SeqCst);
                if self.state() == SyncState::Offline || self.state() == SyncState::Error {
                    self.set_state(SyncState::Idle);
                }
                Ok(s)
            }
            Err(e) => {
                if super::session::is_auth_rejection(&e) && matches!(login, LoginMethod::Password { .. }) {
                    self.set_state(SyncState::Reconnect);
                    self.store.mark_reconnect(&self.account_id);
                    return Err(CheckoutError::Auth(AuthError::Reconnect));
                }
                self.failures.fetch_add(1, Ordering::SeqCst);
                self.set_state(SyncState::Offline);
                Err(CheckoutError::Connect(e))
            }
        }
    }

    /// Check a command session out of the pool, reusing an idle one when there
    /// is one. The token is refreshed first either way.
    pub async fn checkout(&self) -> Result<Lease<'_, C::Session>, CheckoutError> {
        let login = self.login().await?;
        let permit = self.permits.acquire().await.expect("pool semaphore closed");
        let pooled = self.idle.lock().unwrap().pop();
        let session = match pooled {
            Some(s) => s,
            None => self.connect(&login).await?,
        };
        Ok(Lease { session: Some(session), _permit: permit })
    }

    pub fn checkin(&self, mut lease: Lease<'_, C::Session>) {
        if let Some(s) = lease.session.take() {
            self.idle.lock().unwrap().push(s);
        }
    }

    /// Delay before the next reconnect attempt.
    pub fn next_backoff(&self) -> Duration {
        backoff(self.failures.load(Ordering::SeqCst), fastrand::f64())
    }

    /// Close every pooled session (disconnect or shutdown).
    pub fn shutdown(&self) {
        self.idle.lock().unwrap().clear();
        self.set_state(SyncState::Idle);
    }

    pub fn pooled(&self) -> usize {
        self.idle.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::auth::testing::*;
    use crate::mail::auth::RefreshError;
    use std::sync::atomic::AtomicUsize;

    #[derive(Default)]
    struct FakeConn {
        logins: Mutex<Vec<LoginMethod>>,
        fail: Mutex<Option<String>>,
    }
    impl Connector for &FakeConn {
        type Session = usize;
        async fn connect(&self, login: &LoginMethod) -> Result<usize, String> {
            if let Some(e) = self.fail.lock().unwrap().clone() {
                return Err(e);
            }
            let mut l = self.logins.lock().unwrap();
            l.push(login.clone());
            Ok(l.len())
        }
    }

    static NOW: AtomicUsize = AtomicUsize::new(1_000);
    fn clock() -> i64 {
        NOW.load(Ordering::SeqCst) as i64
    }

    fn block<F: Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    #[test]
    fn refresh_before_every_use() {
        let store = MemStore::default();
        store.save("a", &oauth("old", 0)).unwrap();
        let refresher = FakeRefresher::ok("fresh");
        let conn = FakeConn::default();
        let actor = AccountActor::new("a", "me@x.com", store, refresher, &conn, clock);
        block(async {
            // Command path refreshes the expired token before logging in.
            let lease = actor.checkout().await.unwrap();
            actor.checkin(lease);
            // IDLE path goes through the same refresh.
            actor.open_dedicated().await.unwrap();
        });
        let logins = conn.logins.lock().unwrap();
        assert!(logins.iter().all(|l| *l == LoginMethod::Xoauth2 { user: "me@x.com".into(), access_token: "fresh".into() }));
        // One refresh: the second use found a fresh token (no needless network).
        assert_eq!(actor.refresher.calls(), 1);
        // The token expires again → the next use refreshes again.
        actor.store().save("a", &oauth("stale", 0)).unwrap();
        block(async { actor.login().await.unwrap() });
        assert_eq!(actor.refresher.calls(), 2);
    }

    #[test]
    fn invalid_grant_marks_reconnect_without_spinning() {
        let store = MemStore::default();
        store.save("a", &oauth("old", 0)).unwrap();
        let conn = FakeConn::default();
        let actor = AccountActor::new("a", "u", store, FakeRefresher::err(RefreshError::InvalidGrant), &conn, clock);
        block(async {
            assert!(matches!(actor.checkout().await, Err(CheckoutError::Auth(AuthError::Reconnect))));
            for _ in 0..5 {
                assert!(actor.checkout().await.is_err());
            }
        });
        assert_eq!(actor.state(), SyncState::Reconnect);
        assert_eq!(actor.refresher.calls(), 1, "no retry loop after a refused refresh");
        assert!(conn.logins.lock().unwrap().is_empty());
    }

    #[test]
    fn pool_reuses_one_login() {
        let store = MemStore::default();
        store.save("a", &crate::mail::auth::Credential::Password { password: "p".into() }).unwrap();
        let conn = FakeConn::default();
        let actor = AccountActor::new("a", "u", store, FakeRefresher::ok("x"), &conn, clock);
        block(async {
            for _ in 0..10 {
                let lease = actor.checkout().await.unwrap();
                actor.checkin(lease);
            }
            // Concurrent leases open at most MAX sessions.
            let a = actor.checkout().await.unwrap();
            let b = actor.checkout().await.unwrap();
            let c = actor.checkout().await.unwrap();
            assert_eq!(actor.permits.available_permits(), 0);
            actor.checkin(a);
            actor.checkin(b);
            actor.checkin(c);
        });
        assert_eq!(conn.logins.lock().unwrap().len(), 3);
        assert_eq!(actor.pooled(), 3);
    }

    #[test]
    fn transient_connect_failure_goes_offline_then_recovers() {
        let store = MemStore::default();
        store.save("a", &crate::mail::auth::Credential::Password { password: "p".into() }).unwrap();
        let conn = FakeConn::default();
        *conn.fail.lock().unwrap() = Some("connection refused".into());
        let actor = AccountActor::new("a", "u", store, FakeRefresher::ok("x"), &conn, clock);
        block(async { assert!(matches!(actor.checkout().await, Err(CheckoutError::Connect(_)))) });
        assert_eq!(actor.state(), SyncState::Offline);
        *conn.fail.lock().unwrap() = None;
        block(async { actor.checkout().await.unwrap() });
        assert_eq!(actor.state(), SyncState::Idle);
    }

    #[test]
    fn password_rejection_marks_reconnect() {
        let store = MemStore::default();
        store.save("a", &crate::mail::auth::Credential::Password { password: "p".into() }).unwrap();
        let conn = FakeConn::default();
        *conn.fail.lock().unwrap() = Some("imap_auth_failed:NO [AUTHENTICATIONFAILED]".into());
        let actor = AccountActor::new("a", "u", store, FakeRefresher::ok("x"), &conn, clock);
        block(async { assert!(actor.checkout().await.is_err()) });
        assert_eq!(actor.state(), SyncState::Reconnect);
    }

    #[test]
    fn backoff_is_jittered_and_capped() {
        assert!(backoff(0, 0.5) >= Duration::from_secs(1));
        assert!(backoff(3, 0.0) < backoff(4, 0.0));
        for a in 0..40 {
            assert!(backoff(a, 1.0) <= BACKOFF_CAP);
        }
        assert_eq!(backoff(30, 0.5), BACKOFF_CAP);
    }
}
