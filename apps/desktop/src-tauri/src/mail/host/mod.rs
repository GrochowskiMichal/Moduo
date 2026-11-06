//! Hosting the engine in the desktop app (MR-16a).
//!
//! [`MailHost`] is managed Tauri state. When a user signs in it opens that
//! user's SQLite store, runs the one-time legacy cutover ([`super::migrate`]:
//! accounts and keychain entries carry over, the redb mail tables are dropped),
//! and starts one worker per account. Each worker owns an [`AccountActor`]
//! (refresh before every login, session pool, Reconnect parking) and runs the
//! first round, the IDLE loop, the STATUS sweep, the ops outbox and the drafts
//! and send outbox. Sign-out stops the workers.

pub mod imap_adapters;
pub mod ondemand;
pub mod reader;
pub mod lifecycle;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::Serialize;

use super::accounts::MailAccount as AccountEndpoints;
use super::actor::{AccountActor, CheckoutError, Connector};
use super::auth::{
    google, microsoft, AuthError, Credential, CredentialStore, HttpRefresher, KeychainStore, LoginMethod, RefreshError, RefreshedToken, TokenRefresher,
};
use super::contracts::{Provider, SyncState};
use super::migrate;
use super::send::graph::{self, GraphFallback, GraphLeg};
use super::send::smtp::{send_raw, SmtpAuth};
use super::session::{self, Endpoint};
use super::store::{now_ms, Store};
use super::sync::classify::ClassifyConfig;
use super::sync::events::{EventBus, MailEvent};
use super::sync::imap::ImapServer;
use super::sync::live::{AccountSync, Schedule};
use crate::store_redb::RedbStore;
use imap_adapters::{ImapOps, ImapSend};

/// How often the outbox and STATUS sweep tick while the window is in front.
pub const TICK_FOREGROUND: Duration = Duration::from_secs(5);
pub const TICK_BACKGROUND: Duration = Duration::from_secs(30);

/// One account row as `MailAccount` in runtime.types.mail-engine.ts.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRow {
    pub id: String,
    pub address: String,
    pub display_name: String,
    pub provider: String,
    pub hue: i64,
    pub sync_state: String,
    pub backfill_progress: Option<f64>,
    pub last_error: Option<String>,
    /// The webview's depth name (`threeMonths` … `everything`).
    pub history_depth: String,
    /// When this account last finished a sync round on this Mac (store v2).
    pub last_synced_ms: Option<i64>,
    /// True when new mail is pushed (IDLE); false when polled every minute.
    pub push: bool,
}

/// Every account in the store, oldest first.
pub fn list_accounts(store: &Store) -> Result<Vec<AccountRow>, String> {
    let c = store.r();
    let mut s = c
        .prepare_cached(
            "SELECT id, address, display_name, provider, hue, sync_state, backfill_progress, last_error,
                    history_depth_days, last_synced_ms, push
             FROM accounts ORDER BY created_at_ms, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = s
        .query_map([], |r| {
            Ok(AccountRow {
                id: r.get(0)?,
                address: r.get(1)?,
                display_name: r.get(2)?,
                provider: r.get(3)?,
                hue: r.get(4)?,
                sync_state: r.get(5)?,
                backfill_progress: r.get(6)?,
                last_error: r.get(7)?,
                history_depth: lifecycle::depth_name(r.get(8)?).to_string(),
                last_synced_ms: r.get(9)?,
                push: r.get::<_, Option<bool>>(10)?.unwrap_or(false),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// One `op_failed` per newly failed op, carrying its thread ids and the first
/// thread's subject (AC9: the failed line names each action and its thread).
pub fn failed_op_events(store: &Store, failed: &[String]) -> Vec<MailEvent> {
    failed
        .iter()
        .filter_map(|id| store.op_record(id).ok().flatten())
        .filter_map(|op| serde_json::to_value(op).ok())
        .map(|op| MailEvent::OpFailed { op })
        .collect()
}

/// What the host needs from the app's config.
#[derive(Clone, Debug, Default)]
pub struct HostConfig {
    pub keychain_service: String,
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    pub microsoft_client_id: Option<String>,
}

/// The provider's refresh grant, or none (password accounts never refresh).
pub enum AnyRefresher {
    Http(HttpRefresher),
    None,
}

impl TokenRefresher for AnyRefresher {
    async fn refresh(&self, refresh_token: &str) -> Result<RefreshedToken, RefreshError> {
        match self {
            AnyRefresher::Http(h) => h.refresh(refresh_token).await,
            AnyRefresher::None => Err(RefreshError::Transient("no_oauth_client".into())),
        }
    }
}

pub fn refresher_for(provider: Provider, cfg: &HostConfig) -> AnyRefresher {
    match provider {
        Provider::Gmail | Provider::GoogleWorkspace => match &cfg.google_client_id {
            Some(id) => AnyRefresher::Http(HttpRefresher {
                token_endpoint: google::TOKEN_ENDPOINT.into(),
                client_id: id.clone(),
                client_secret: cfg.google_client_secret.clone(),
                scope: None,
            }),
            None => AnyRefresher::None,
        },
        Provider::Outlook => match &cfg.microsoft_client_id {
            Some(id) => AnyRefresher::Http(HttpRefresher {
                token_endpoint: microsoft::TOKEN_ENDPOINT.into(),
                client_id: id.clone(),
                client_secret: None,
                scope: Some(microsoft::refresh_scope()),
            }),
            None => AnyRefresher::None,
        },
        _ => AnyRefresher::None,
    }
}

/// Opens TLS IMAP sessions to one endpoint.
pub struct ImapConnector {
    pub endpoint: Endpoint,
}

impl Connector for ImapConnector {
    type Session = ImapServer;
    async fn connect(&self, login: &LoginMethod) -> Result<ImapServer, String> {
        let (session, caps) = session::open(&self.endpoint, login).await?;
        Ok(ImapServer { session, caps })
    }
}

type Reconnect = Box<dyn Fn(&str) + Send + Sync>;
pub(crate) type Actor = AccountActor<KeychainStore<Reconnect>, AnyRefresher, ImapConnector>;

fn now_s() -> i64 {
    now_ms() / 1000
}

struct WorkerHandle {
    stop: Arc<AtomicBool>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl WorkerHandle {
    fn halt(self) {
        self.stop.store(true, Ordering::SeqCst);
        self.task.abort();
    }
}

struct Running {
    user_id: String,
    store: Arc<Store>,
    cfg: HostConfig,
    classify: Arc<RwLock<ClassifyConfig>>,
    workers: std::collections::HashMap<String, WorkerHandle>,
}

/// The managed engine host.
pub struct MailHost {
    pub events: EventBus,
    foreground: Arc<AtomicBool>,
    running: Mutex<Option<Running>>,
    /// Running accounts' actors, sync and worker queues for the reader commands.
    pub ondemand: Arc<ondemand::OnDemand>,
}

impl MailHost {
    pub fn new(events: EventBus) -> Self {
        Self {
            events,
            foreground: Arc::new(AtomicBool::new(true)),
            running: Mutex::new(None),
            ondemand: Arc::default(),
        }
    }

    /// The signed-in user's store, or `mail_not_started`.
    pub fn store(&self) -> Result<Arc<Store>, String> {
        self.running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .map(|r| r.store.clone())
            .ok_or_else(|| "mail_not_started".to_string())
    }

    /// The user the engine is running for, if any.
    pub fn running_user(&self) -> Option<String> {
        self.running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .map(|r| r.user_id.clone())
    }

    pub fn set_foreground(&self, fg: bool) {
        self.foreground.store(fg, Ordering::SeqCst);
    }

    /// Opens the user's store, runs the legacy cutover once, then starts a
    /// worker per account. Idempotent for the same user.
    pub fn start(
        &self,
        app_data: &std::path::Path,
        user_id: &str,
        redb: &RedbStore,
        cfg: &HostConfig,
    ) -> Result<(), String> {
        {
            let guard = self.running.lock().unwrap_or_else(|p| p.into_inner());
            if guard.as_ref().is_some_and(|r| r.user_id == user_id) {
                return Ok(());
            }
        }
        self.stop();
        let dir = Store::user_dir(app_data, user_id).map_err(|e| e.to_string())?;
        let store = Arc::new(Store::open(&dir).map_err(|e| e.to_string())?);
        // The cutover must finish before any worker reads accounts.
        match migrate::run(redb, &store) {
            Ok(r) if !r.already_done => eprintln!(
                "[mail] legacy cutover: {} accounts, {} tables dropped, skipped {:?}",
                r.accounts, r.tables_dropped, r.skipped
            ),
            Ok(_) => {}
            Err(e) => eprintln!("[mail] legacy cutover failed (retried next start): {e}"),
        }
        store.recover_in_flight_ops().map_err(|e| e.to_string())?;
        store.recover_in_flight_sends().map_err(|e| e.to_string())?;
        let items = match lifecycle::stored_classify_items(&store) {
            Ok(items) => items,
            Err(e) => {
                // Defaults until the app pushes the settings again; the stored blob stays.
                eprintln!("[mail] classify items unreadable, using defaults: {e}");
                Vec::new()
            }
        };
        let classify = Arc::new(RwLock::new(lifecycle::classify_config(&items)));
        *self.running.lock().unwrap_or_else(|p| p.into_inner()) = Some(Running {
            user_id: user_id.to_string(),
            store: store.clone(),
            cfg: cfg.clone(),
            classify,
            workers: Default::default(),
        });
        for a in list_accounts(&store)? {
            self.spawn_worker(&a.id)?;
        }
        Ok(())
    }

    /// (Re)starts one account's worker: a new account, a reconnect, a new
    /// depth or Sync now. A parked (Reconnect) worker re-reads its secret.
    pub fn spawn_worker(&self, account_id: &str) -> Result<(), String> {
        let mut guard = self.running.lock().unwrap_or_else(|p| p.into_inner());
        let r = guard.as_mut().ok_or("mail_not_started")?;
        if let Some(old) = r.workers.remove(account_id) {
            old.halt();
        }
        let Some(endpoints) = lifecycle::endpoints(&r.store, account_id) else {
            eprintln!("[mail] {account_id}: no endpoints; skipped");
            return Ok(());
        };
        let stop = Arc::new(AtomicBool::new(false));
        let w = Worker {
            account_id: account_id.to_string(),
            user_id: r.user_id.clone(),
            endpoints,
            store: r.store.clone(),
            events: self.events.clone(),
            cfg: r.cfg.clone(),
            classify: r.classify.clone(),
            stop: stop.clone(),
            foreground: self.foreground.clone(),
            ondemand: self.ondemand.clone(),
        };
        let task = tauri::async_runtime::spawn(w.run());
        r.workers
            .insert(account_id.to_string(), WorkerHandle { stop, task });
        Ok(())
    }

    /// Stops one account's worker (disconnect).
    pub fn stop_worker(&self, account_id: &str) {
        if let Some(r) = self.running.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
            if let Some(w) = r.workers.remove(account_id) {
                w.halt();
            }
        }
    }

    /// Every account with a worker slot (Sync now with no account).
    pub fn account_ids(&self) -> Vec<String> {
        self.running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .map(|r| r.workers.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// The running user and host config (connect needs both for the keychain).
    pub fn session(&self) -> Result<(String, HostConfig), String> {
        self.running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .map(|r| (r.user_id.clone(), r.cfg.clone()))
            .ok_or_else(|| "mail_not_started".to_string())
    }

    /// A copy of the shared classify config ("Why here?", Apply to existing).
    pub fn classify_config(&self) -> Result<ClassifyConfig, String> {
        self.running
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .map(|r| r.classify.read().unwrap_or_else(|p| p.into_inner()).clone())
            .ok_or_else(|| "mail_not_started".to_string())
    }

    /// Replaces the shared classify config (rules, tabs, Priority, blocks).
    /// Workers read it at every ingest, so the change applies to new mail.
    pub fn set_classify(&self, cfg: ClassifyConfig) {
        if let Some(r) = self.running.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            *r.classify.write().unwrap_or_else(|p| p.into_inner()) = cfg;
        }
    }

    /// Stops every worker (sign-out, quit).
    pub fn stop(&self) {
        self.ondemand.clear();
        if let Some(r) = self.running.lock().unwrap_or_else(|p| p.into_inner()).take() {
            for (_, w) in r.workers {
                w.halt();
            }
        }
    }
}

struct Worker {
    account_id: String,
    user_id: String,
    endpoints: AccountEndpoints,
    store: Arc<Store>,
    events: EventBus,
    cfg: HostConfig,
    classify: Arc<RwLock<ClassifyConfig>>,
    stop: Arc<AtomicBool>,
    foreground: Arc<AtomicBool>,
    ondemand: Arc<ondemand::OnDemand>,
}

impl Worker {
    fn actor(&self) -> Actor {
        let s = self.store.clone();
        let events = self.events.clone();
        let on_reconnect: Reconnect = Box::new(move |id: &str| {
            let _ = s.set_account_sync(id, SyncState::Reconnect.as_str(), None, Some("reconnect"));
            events.emit(MailEvent::SyncStatus {
                account_id: id.to_string(),
                state: SyncState::Reconnect,
                progress: None,
            });
        });
        AccountActor::new(
            &self.account_id,
            &self.endpoints.email,
            KeychainStore {
                service: self.cfg.keychain_service.clone(),
                user_id: self.user_id.clone(),
                on_reconnect,
            },
            refresher_for(self.endpoints.provider, &self.cfg),
            ImapConnector {
                endpoint: Endpoint::from(&self.endpoints.imap),
            },
            now_s,
        )
    }

    fn since_ms(&self) -> Option<i64> {
        let days: Option<i64> = self
            .store
            .r()
            .query_row(
                "SELECT history_depth_days FROM accounts WHERE id = ?1",
                [&self.account_id],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        days.map(|d| now_ms() - d * 86_400_000)
    }

    async fn run(self) {
        let actor = Arc::new(self.actor());
        let sync = Arc::new(AccountSync::new(
            &self.account_id,
            self.store.clone(),
            self.events.clone(),
            self.classify.clone(),
            self.since_ms(),
        ));
        self.ondemand
            .register(&self.account_id, actor.clone(), sync.clone());
        while !self.stop.load(Ordering::SeqCst) {
            match self.session_life(&actor, &sync).await {
                Err(CheckoutError::Auth(AuthError::Reconnect)) => {
                    // Parked until the user reconnects (a new start re-reads it).
                    return;
                }
                Err(e) => {
                    let why = format!("{e:?}");
                    let _ = self.store.set_account_sync(
                        &self.account_id,
                        SyncState::Offline.as_str(),
                        None,
                        Some(&why),
                    );
                    self.events.emit(MailEvent::SyncStatus {
                        account_id: self.account_id.clone(),
                        state: SyncState::Offline,
                        progress: None,
                    });
                }
                Ok(()) => {}
            }
            tokio::time::sleep(actor.next_backoff()).await;
        }
        actor.shutdown();
    }

    /// One connected stretch: first round, then IDLE beside a periodic tick
    /// (STATUS sweep, ops, drafts, sends). Returns on the first error.
    async fn session_life(
        &self,
        actor: &Arc<Actor>,
        sync: &Arc<AccountSync>,
    ) -> Result<(), CheckoutError> {
        let mut lease = actor.checkout().await?;
        let srv = lease.session.as_mut().expect("leased session");
        let plans = sync
            .first_round(srv)
            .await
            .map_err(|e| CheckoutError::Connect(e.to_string()))?;
        let idle_srv = actor.open_dedicated().await?;
        let (s2, p2, stop2) = (sync.clone(), plans.clone(), self.stop.clone());
        let idle = tauri::async_runtime::spawn(async move {
            let _ = s2.idle_loop(idle_srv, &p2, &stop2).await;
        });
        let gmail = srv.caps.gmail_ext;
        let idle_id = AccountSync::idle_target(&plans, gmail).map(|p| p.id.clone());
        let mut sched = Schedule::default();
        let result = loop {
            if self.stop.load(Ordering::SeqCst) {
                break Ok(());
            }
            if let Err(e) = sync
                .sweep(srv, &plans, &mut sched, idle_id.as_deref(), now_ms())
                .await
            {
                break Err(CheckoutError::Connect(e.to_string()));
            }
            if let Err(e) = self.outbox_tick(actor, srv).await {
                break Err(CheckoutError::Connect(e));
            }
            if let Err(e) = self
                .ondemand
                .worker_tick(&self.account_id, srv, &plans, &self.store, &self.events)
                .await
            {
                break Err(CheckoutError::Connect(e));
            }
            let tick = if self.foreground.load(Ordering::SeqCst) {
                TICK_FOREGROUND
            } else {
                TICK_BACKGROUND
            };
            self.ondemand.wait(&self.account_id, tick).await;
        };
        idle.abort();
        if result.is_ok() {
            actor.checkin(lease);
        }
        result
    }

    /// Decision 14: a Microsoft account sends through Graph `sendMail` when the
    /// tenant has SMTP AUTH off. The `Mail.Send` token comes from the account's
    /// refresh token, requested per send (the store only calls this after a
    /// `5.7.139` or once the account is known to need Graph).
    fn graph_leg(&self, actor: &Arc<Actor>) -> Option<GraphLeg<'static>> {
        if self.endpoints.provider != Provider::Outlook {
            return None;
        }
        let client_id = self.cfg.microsoft_client_id.clone()?;
        let refresh_token = match actor.store().load(&self.account_id) {
            Ok(Some(Credential::Oauth { refresh_token, .. })) => refresh_token?,
            _ => return None,
        };
        let refresher = HttpRefresher {
            token_endpoint: microsoft::TOKEN_ENDPOINT.into(),
            client_id,
            client_secret: None,
            scope: Some(graph::send_scope()),
        };
        let client = reqwest::Client::new();
        let handle = tokio::runtime::Handle::current();
        Some(Box::new(move |mime: &[u8]| {
            handle.block_on(async {
                let token = refresher
                    .refresh(&refresh_token)
                    .await
                    .map_err(graph::token_error)?;
                graph::send_mime(&client, &token.access_token, mime).await
            })
        }))
    }

    async fn outbox_tick(&self, actor: &Arc<Actor>, srv: &mut ImapServer) -> Result<(), String> {
        let now = now_ms();
        let report = self
            .store
            .run_due_ops(&mut ImapOps { srv: &mut *srv }, now)
            .map_err(|e| e.to_string())?;
        for e in failed_op_events(&self.store, &report.failed) {
            self.events.emit(e);
        }
        if !report.done.is_empty() || !report.failed.is_empty() {
            if let Ok(counts) = self.store.counts() {
                self.events.emit(MailEvent::Counts { counts });
            }
        }
        // SMTP needs fresh login material on every send (AC10).
        let login = actor.login().await.map_err(|e| format!("{e:?}"))?;
        let smtp = self.endpoints.smtp.clone();
        let user = self.endpoints.email.clone();
        let graph_leg = self.graph_leg(actor);
        let mut send = GraphFallback {
            leg: graph_leg,
            inner: ImapSend {
                srv: &mut *srv,
                smtp: Box::new(move |from: &str, rcpts: &[String], mime: &[u8]| {
                    let auth = match &login {
                        LoginMethod::Password { password, .. } => SmtpAuth::Password(password),
                        LoginMethod::Xoauth2 { access_token, .. } => SmtpAuth::OAuth(access_token),
                    };
                    send_raw(&smtp.host, smtp.port, &user, auth, from, rcpts, mime)
                }),
            },
        };
        self.store
            .sync_drafts_and_emit(&mut send, now, &self.events)
            .map_err(|e| e.to_string())?;
        let sends = self
            .store
            .run_due_sends(&mut send, now)
            .map_err(|e| e.to_string())?;
        for d in sends
            .sent
            .iter()
            .filter_map(|(_, d)| d.clone())
            .chain(sends.failed.iter().filter_map(|(d, _)| d.clone()))
        {
            self.events.emit(MailEvent::DraftChanged {
                draft_id: d,
                server_uid: None,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::contracts::{MailboxRole, OpKind, TabKind};
    use crate::mail::ops::{OpError, OpRequest, OpServer, ResolvedStep};
    use crate::mail::store::{AccountInput, Address, MailboxInput, MessageInput, TabRef};

    fn store(tag: &str) -> Store {
        let d = std::env::temp_dir().join(format!(
            "moduo-mail-host-{tag}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = std::fs::remove_dir_all(&d);
        let s = Store::open(&d).unwrap();
        s.upsert_account(&AccountInput {
            id: "a1".into(),
            address: "me@x.test".into(),
            display_name: "Me".into(),
            provider: "imap".into(),
            hue: 1,
        })
        .unwrap();
        for (id, role) in [
            ("inbox", MailboxRole::Inbox),
            ("archive", MailboxRole::Archive),
        ] {
            s.upsert_mailbox(&MailboxInput {
                id: id.into(),
                account_id: "a1".into(),
                path: id.into(),
                name: id.into(),
                role,
                delimiter: Some("/".into()),
                live: true,
            })
            .unwrap();
        }
        s
    }

    fn put(s: &Store, ext: &str, thread: &str, subject: &str, from: &str, date: i64) {
        s.ingest(&[MessageInput {
            classify: None,
            account_id: "a1".into(),
            ext_id: ext.into(),
            mailbox_id: "inbox".into(),
            uid: date,
            modseq: None,
            message_id: Some(format!("<{ext}@x>")),
            in_reply_to: None,
            references: vec![],
            thread_id: thread.into(),
            from: Address {
                name: "Ann".into(),
                email: from.into(),
            },
            to: vec![],
            cc: vec![],
            subject: subject.into(),
            snippet: String::new(),
            date_ms: date,
            flags: 0,
            size: 1,
            list_unsubscribe: None,
            list_unsubscribe_post: None,
            precedence: None,
            auto_submitted: None,
            has_invite: false,
            tab: Some(TabRef::of(TabKind::Personal)),
            priority: false,
            attachments: vec![],
        }])
        .unwrap();
    }

    struct Refuse;
    impl OpServer for Refuse {
        fn run(&mut self, _a: &str, _s: &ResolvedStep) -> Result<(), OpError> {
            Err(OpError::Permanent(
                "The folder is read-only on the server".into(),
            ))
        }
    }

    #[test]
    fn op_failed_carries_thread_ids_and_subject() {
        let s = store("opf");
        put(&s, "m1", "t1", "Workshop materials", "ann@y.test", 1_000);
        put(&s, "m2", "t2", "Studio rent", "bob@y.test", 2_000);
        let h = s
            .enqueue_op_at(
                &OpRequest::new(OpKind::Done, vec!["t1".into(), "t2".into()]),
                10_000,
            )
            .unwrap();
        let report = s.run_due_ops(&mut Refuse, 20_000).unwrap();
        assert_eq!(report.failed, h.op_ids);
        let events = failed_op_events(&s, &report.failed);
        assert_eq!(events.len(), 1);
        let MailEvent::OpFailed { op } = &events[0] else {
            panic!("not op_failed: {:?}", events[0]);
        };
        assert_eq!(op["threadIds"], serde_json::json!(["t1", "t2"]));
        assert_eq!(op["subject"], "Workshop materials");
        assert_eq!(op["kind"], "done");
        assert_eq!(op["state"], "failed");
        assert_eq!(op["lastError"], "The folder is read-only on the server");
        assert_eq!(op["createdAtMs"], 10_000);
        // The failed list carries the same record.
        let listed = s.op_record(&h.op_ids[0]).unwrap().unwrap();
        assert_eq!(listed.subject.as_deref(), Some("Workshop materials"));
        assert_eq!(listed.thread_ids, vec!["t1", "t2"]);
        // A missing op yields no event.
        assert!(failed_op_events(&s, &["nope".into()]).is_empty());
    }

    #[test]
    fn explain_falls_back_to_reclassify() {
        use crate::mail::contracts::{ClassifyStage, RuleAction, RuleCondition};
        use crate::mail::sync::classify::Rule;
        let s = store("explain");
        // Classified before store v2: no stored stage, only headers.
        put(&s, "m1", "t1", "Invoice 7", "billing@shop.test", 1_000);
        let cfg = ClassifyConfig {
            rules: vec![Rule {
                id: "r-invoices".into(),
                conditions: vec![(RuleCondition::SubjectContains, "invoice".into())],
                actions: vec![(RuleAction::PutInTab, Some("notifications".into()))],
            }],
            ..ClassifyConfig::default()
        };
        let e = s.explain_thread("t1", &cfg).unwrap().unwrap();
        assert_eq!(e.stage, Some(ClassifyStage::Rules));
        assert_eq!(e.rule_id.as_deref(), Some("r-invoices"));
        assert_eq!(e.tab, TabKind::Notifications);
        assert_eq!(e.address, "billing@shop.test");
        // A stored reason wins over a re-run with today's settings.
        s.w()
            .execute(
                "UPDATE messages SET classify_stage = 'known_contact' WHERE thread_id = 't1'",
                [],
            )
            .unwrap();
        let e = s.explain_thread("t1", &cfg).unwrap().unwrap();
        assert_eq!(e.stage, Some(ClassifyStage::KnownContact));
        assert_eq!((e.rule_id, e.tab), (None, TabKind::Personal));
        // No stored reason and no headers to re-run: stage is null.
        put(&s, "m2", "t2", "Hi", "", 2_000);
        let e = s.explain_thread("t2", &cfg).unwrap().unwrap();
        assert_eq!(e.stage, None);
        assert!(s.explain_thread("missing", &cfg).unwrap().is_none());
        // Serializes as `MailExplain`.
        let v = serde_json::to_value(s.explain_thread("t1", &ClassifyConfig::default()).unwrap())
            .unwrap();
        assert_eq!(v["stage"], "known_contact");
        assert!(v.get("customTabId").is_some() && v.get("ruleId").is_some());
    }

    #[test]
    fn image_allow_is_read_in_get_thread() {
        let s = store("img");
        put(&s, "m1", "t1", "Look", "News@Shop.test", 1_000);
        assert!(!s.get_thread("t1").unwrap().unwrap().images_allowed);
        s.set_image_allow("news@shop.test", true).unwrap();
        assert!(s.get_thread("t1").unwrap().unwrap().images_allowed);
        s.set_image_allow("NEWS@shop.test", false).unwrap();
        assert!(!s.get_thread("t1").unwrap().unwrap().images_allowed);
    }
}
