//! Mail engine integration tests against the local Dovecot + SMTP sink
//! (`scripts/mail/test-server.sh up`, its own containers). Frozen skeletons from
//! MR-0: each is skipped unless `MODUO_MAIL_IT=1`, and fails until the block named
//! in its body implements it (specs/mail-rebuild.md, Tests table).
//!
//! ```sh
//! scripts/mail/test-server.sh up && MODUO_MAIL_IT=1 cargo test --test mail_it -- --nocapture
//! ```

fn enabled() -> bool {
    std::env::var("MODUO_MAIL_IT").as_deref() == Ok("1")
}

/// Connection details the harness prints (`scripts/mail/test-server.sh env`).
#[allow(dead_code)]
pub struct TestServer {
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_port: u16,
    pub user: String,
    pub password: String,
}

#[allow(dead_code)]
fn server() -> TestServer {
    let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
    TestServer {
        imap_host: env("MODUO_MAIL_IT_HOST", "127.0.0.1"),
        imap_port: env("MODUO_MAIL_IT_IMAP_PORT", "31143").parse().unwrap(),
        smtp_port: env("MODUO_MAIL_IT_SMTP_PORT", "31025").parse().unwrap(),
        user: env("MODUO_MAIL_IT_USER", "mike@gmail.test"),
        password: env("MODUO_MAIL_IT_PASSWORD", "moduo-test"),
    }
}

/// MR-5/MR-6 through the hosted adapters (MR-16a): the ops outbox, drafts and
/// the send outbox over a real IMAP session and the SMTP sink.
mod host_it {
    use super::{enabled, server};
    use moduo_desktop_lib::mail::contracts::{MailboxRole, OpKind};
    use moduo_desktop_lib::mail::host::imap_adapters::{ImapOps, ImapSend, SmtpLeg};
    use moduo_desktop_lib::mail::ops::OpRequest;
    use moduo_desktop_lib::mail::send::{DraftDoc, SendError};
    use moduo_desktop_lib::mail::session::Capabilities;
    use moduo_desktop_lib::mail::store::{AccountInput, ListInput, Store, ViewRef};
    use moduo_desktop_lib::mail::sync::classify::ClassifyConfig;
    use moduo_desktop_lib::mail::sync::engine::{mailbox_id, MailboxPlan};
    use moduo_desktop_lib::mail::sync::events::EventBus;
    use moduo_desktop_lib::mail::sync::imap::ImapServer;
    use moduo_desktop_lib::mail::sync::live::AccountSync;
    use std::sync::{Arc, RwLock};
    use tokio::net::TcpStream;

    type Srv = ImapServer<TcpStream>;

    fn now_ms() -> i64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
    }

    async fn connect() -> Srv {
        let s = server();
        let tcp = TcpStream::connect((s.imap_host.as_str(), s.imap_port)).await.expect("dovecot up?");
        let mut client = async_imap::Client::new(tcp);
        client.read_response().await.unwrap();
        let mut session = client.login(&s.user, &s.password).await.map_err(|(e, _)| e).unwrap();
        let caps = session.capabilities().await.unwrap();
        let atoms: Vec<String> = caps
            .iter()
            .map(|c| match c {
                async_imap::types::Capability::Imap4rev1 => "IMAP4REV1".to_string(),
                async_imap::types::Capability::Auth(a) => format!("AUTH={a}"),
                async_imap::types::Capability::Atom(a) => a.to_string(),
            })
            .collect();
        ImapServer { session, caps: Capabilities::from_atoms(atoms.iter().map(String::as_str)) }
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap()
    }

    fn tag(t: &str) -> String {
        format!("{t}-{}-{}", std::process::id(), now_ms())
    }

    /// A fresh store whose folders came from a first round against Dovecot.
    async fn account(t: &str, srv: &mut Srv) -> (Arc<Store>, AccountSync, Vec<MailboxPlan>) {
        let d = std::env::temp_dir().join(format!("moduo-mail-it-host-{}", tag(t)));
        let s = Arc::new(Store::open(&d).unwrap());
        s.upsert_account(&AccountInput { id: "a1".into(), address: server().user, display_name: "".into(), provider: "imap".into(), hue: 0 }).unwrap();
        let a = AccountSync::new("a1", s.clone(), EventBus::new(), Arc::new(RwLock::new(ClassifyConfig::default())), None);
        let plans = a.first_round(srv).await.unwrap();
        (s, a, plans)
    }

    fn msg(id: &str, n: usize) -> Vec<u8> {
        format!(
            "Message-ID: <{id}.{n}@it.test>\r\nFrom: Ann <ann@it.test>\r\nTo: me@it.test\r\nSubject: {id} {n}\r\nDate: Tue, 3 Nov 2026 10:00:{:02} +0000\r\n\r\nbody {n}\r\n",
            n % 60
        )
        .into_bytes()
    }

    async fn search(srv: &mut Srv, path: &str, q: &str) -> Vec<u32> {
        srv.session.select(path).await.unwrap();
        let mut v: Vec<u32> = srv.session.uid_search(q).await.unwrap().into_iter().collect();
        v.sort_unstable();
        v
    }

    fn role_path(plans: &[MailboxPlan], role: MailboxRole) -> String {
        plans.iter().find(|p| p.role == role).expect("role folder").path.clone()
    }

    fn no_smtp<'a>() -> SmtpLeg<'a> {
        Box::new(|_, _, _| Err(SendError::Permanent("no smtp in this test".into())))
    }

    fn draft(t: &str, text: &str) -> DraftDoc {
        DraftDoc {
            from_addr: server().user,
            to: vec!["bob@it.test".into()],
            subject: t.into(),
            text: text.into(),
            ..Default::default()
        }
    }

    #[test]
    fn uidvalidity_reset_requeues_ops() {
        if !enabled() { return; }
        rt().block_on(async {
            let mut srv = connect().await;
            let t = tag("uidv");
            let path = format!("it-{t}");
            srv.session.create(&path).await.unwrap();
            for i in 0..3 {
                srv.session.append(&path, None, None, msg(&t, i)).await.unwrap();
            }
            let (s, a, _) = account("uidv", &mut srv).await;
            let plans = a.first_round(&mut srv).await.unwrap();
            let plan = plans.iter().find(|p| p.path == path).unwrap().clone();
            let rows = s
                .list_threads(&ListInput { view: ViewRef::Mailbox(mailbox_id("a1", &path)), tab: None, after: None, limit: 50 })
                .unwrap()
                .rows;
            let target = rows.iter().find(|r| r.subject == format!("{t} 1")).expect("thread").thread_id.clone();
            let h = s.enqueue_op_at(&OpRequest::new(OpKind::MarkRead, vec![target]), now_ms() - 60_000).unwrap();

            // Another client rebuilds the folder: same messages, new UIDVALIDITY, other UIDs.
            tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
            let mut other = connect().await;
            other.session.delete(&path).await.unwrap();
            other.session.create(&path).await.unwrap();
            other.session.append(&path, None, None, msg(&t, 9)).await.unwrap();
            for i in 0..3 {
                other.session.append(&path, None, None, msg(&t, i)).await.unwrap();
            }

            // The executor refuses the stale UIDs instead of flagging whatever holds them.
            let r = s.run_due_ops(&mut ImapOps { srv: &mut srv }, now_ms()).unwrap();
            assert_eq!(r.retrying, h.op_ids, "stale validity waits for a sync round");
            assert!(search(&mut srv, &path, "SEEN").await.is_empty(), "nothing flagged by a stale UID");

            // The round resets the folder and re-targets the op by Message-ID.
            a.round(&mut srv, &plans, &plan).await.unwrap();
            let r = s.run_due_ops(&mut ImapOps { srv: &mut srv }, now_ms() + 3_600_000).unwrap();
            assert_eq!(r.done, h.op_ids);
            let seen = search(&mut srv, &path, "SEEN").await;
            let want = search(&mut srv, &path, &format!("HEADER Message-ID \"<{t}.1@it.test>\"")).await;
            assert_eq!(seen, want, "exactly the re-targeted message is read");
            assert_eq!(seen.len(), 1);
            let _ = srv.session.delete(&path).await;
        });
    }

    #[test]
    fn draft_append_replace() {
        if !enabled() { return; }
        rt().block_on(async {
            let mut srv = connect().await;
            let (s, _a, plans) = account("draft", &mut srv).await;
            let drafts = role_path(&plans, MailboxRole::Drafts);
            let t = tag("draft");
            let early = now_ms() - 60_000;
            let id = s.save_draft_at(None, "a1", None, draft(&t, "first"), early).unwrap();
            let rep = s.sync_drafts(&mut ImapSend { srv: &mut srv, smtp: no_smtp() }, now_ms()).unwrap();
            assert_eq!(rep.uploaded, vec![id.clone()], "{:?}", rep.errors);
            let first = s.draft(&id).unwrap().unwrap().server_uid.expect("uid of the uploaded copy");

            s.save_draft_at(Some(&id), "a1", None, draft(&t, "second"), early + 1).unwrap();
            let rep = s.sync_drafts(&mut ImapSend { srv: &mut srv, smtp: no_smtp() }, now_ms()).unwrap();
            assert_eq!(rep.uploaded, vec![id.clone()], "{:?}", rep.errors);
            let second = s.draft(&id).unwrap().unwrap().server_uid.unwrap();
            assert_ne!(first, second);
            let on_server = search(&mut srv, &drafts, &format!("SUBJECT \"{t}\"")).await;
            assert_eq!(on_server, vec![second as u32], "the old copy is replaced, not kept");

            // Discarding deletes the server copy on the next pass.
            s.discard_draft(&id).unwrap();
            s.sync_drafts(&mut ImapSend { srv: &mut srv, smtp: no_smtp() }, now_ms()).unwrap();
            assert!(search(&mut srv, &drafts, &format!("SUBJECT \"{t}\"")).await.is_empty());
        });
    }

    #[test]
    fn server_draft_appears() {
        if !enabled() { return; }
        rt().block_on(async {
            let mut srv = connect().await;
            let (s, a, plans) = account("srvdraft", &mut srv).await;
            let drafts = plans.iter().find(|p| p.role == MailboxRole::Drafts).unwrap().clone();
            let t = tag("srvdraft");
            let mut other = connect().await;
            other.session.append(&drafts.path, Some("(\\Draft)"), None, msg(&t, 0)).await.unwrap();
            a.round(&mut srv, &plans, &drafts).await.unwrap();
            let rows = s
                .list_threads(&ListInput { view: ViewRef::Unified(MailboxRole::Drafts), tab: None, after: None, limit: 500 })
                .unwrap()
                .rows;
            assert!(rows.iter().any(|r| r.subject == format!("{t} 0")), "a draft from another client shows in Drafts");
        });
    }

    #[test]
    fn smtp_send_and_sent_copy() {
        if !enabled() { return; }
        rt().block_on(async {
            let mut srv = connect().await;
            let (s, _a, plans) = account("send", &mut srv).await;
            let sent = role_path(&plans, MailboxRole::Sent);
            let t = tag("send");
            let id = s.save_draft_at(None, "a1", None, draft(&t, "hello"), now_ms() - 60_000).unwrap();
            s.queue_send_at(&id, 5, now_ms() - 60_000).unwrap();
            let port = server().smtp_port;
            // The sink speaks plain SMTP; production's leg is TLS-only `send_raw`.
            let smtp: SmtpLeg = Box::new(move |from, rcpts, mime| {
                use lettre::address::Envelope;
                use lettre::Transport;
                let env = Envelope::new(
                    Some(from.parse().unwrap()),
                    rcpts.iter().map(|r| r.parse().unwrap()).collect(),
                )
                .unwrap();
                lettre::SmtpTransport::builder_dangerous("127.0.0.1")
                    .port(port)
                    .build()
                    .send_raw(&env, mime)
                    .map(|_| ())
                    .map_err(|e| SendError::Transient(e.to_string()))
            });
            let rep = s.run_due_sends(&mut ImapSend { srv: &mut srv, smtp }, now_ms()).unwrap();
            assert_eq!(rep.sent.len(), 1, "{:?}", rep.failed);
            assert!(s.draft(&id).unwrap().is_none(), "a sent draft leaves Drafts");
            let copy = search(&mut srv, &sent, &format!("SUBJECT \"{t}\"")).await;
            assert_eq!(copy.len(), 1, "a generic IMAP server gets the Sent copy");
            let ui = std::env::var("MODUO_MAIL_IT_UI_PORT").unwrap_or_else(|_| "31080".into());
            let body = reqwest::get(format!("http://127.0.0.1:{ui}/api/v1/search?query=subject:{t}"))
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(body.contains(&t), "the sink received it: {body}");
        });
    }
}

/// MR-3: the sync engine against Dovecot. Each test works in its own fresh
/// folder (or the seeded INBOX for IDLE), so the tests can run in parallel.
mod sync_it {
    use super::{enabled, server};
    use moduo_desktop_lib::mail::contracts::MailboxRole;
    use moduo_desktop_lib::mail::session::Capabilities;
    use moduo_desktop_lib::mail::store::{AccountInput, ListInput, Store, ViewRef};
    use moduo_desktop_lib::mail::sync::classify::ClassifyConfig;
    use moduo_desktop_lib::mail::sync::engine::{mailbox_id, sync_folders, MailboxPlan, SyncCtx, FIRST_BATCH};
    use moduo_desktop_lib::mail::sync::events::{EventBus, MailEvent};
    use moduo_desktop_lib::mail::sync::imap::ImapServer;
    use moduo_desktop_lib::mail::sync::live::AccountSync;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, RwLock};
    use std::time::{Duration, Instant};
    use tokio::net::TcpStream;

    type Srv = ImapServer<TcpStream>;

    async fn connect() -> Srv {
        let s = server();
        let tcp = TcpStream::connect((s.imap_host.as_str(), s.imap_port)).await.expect("dovecot up?");
        let mut client = async_imap::Client::new(tcp);
        client.read_response().await.unwrap();
        let mut session = client.login(&s.user, &s.password).await.map_err(|(e, _)| e).unwrap();
        let caps = session.capabilities().await.unwrap();
        let atoms: Vec<String> = caps
            .iter()
            .map(|c| match c {
                async_imap::types::Capability::Imap4rev1 => "IMAP4REV1".to_string(),
                async_imap::types::Capability::Auth(a) => format!("AUTH={a}"),
                async_imap::types::Capability::Atom(a) => a.to_string(),
            })
            .collect();
        ImapServer { session, caps: Capabilities::from_atoms(atoms.iter().map(String::as_str)) }
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap()
    }

    fn account(tag: &str) -> (Arc<Store>, AccountSync) {
        let d = std::env::temp_dir().join(format!("moduo-mail-it-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let s = Arc::new(Store::open(&d).unwrap());
        s.upsert_account(&AccountInput { id: "a1".into(), address: server().user, display_name: "".into(), provider: "imap".into(), hue: 0 }).unwrap();
        let a = AccountSync::new("a1", s.clone(), EventBus::new(), Arc::new(RwLock::new(ClassifyConfig::default())), None);
        (s, a)
    }

    fn msg(id: &str, n: usize) -> Vec<u8> {
        format!(
            "Message-ID: <{id}.{n}@it.test>\r\nFrom: Ann <ann@it.test>\r\nTo: me@it.test\r\nSubject: {id} {n}\r\nDate: Tue, 3 Nov 2026 10:{:02}:{:02} +0000\r\n\r\nbody {n}\r\n",
            (n / 60) % 60,
            n % 60
        )
        .into_bytes()
    }

    /// A fresh folder with `n` messages; returns its plan after a folder sync.
    async fn folder(srv: &mut Srv, a: &AccountSync, name: &str, n: usize) -> (String, Vec<MailboxPlan>) {
        let path = format!("it-{name}-{}", std::process::id());
        let _ = srv.session.delete(&path).await;
        srv.session.create(&path).await.unwrap();
        for i in 0..n {
            srv.session.append(&path, None, None, msg(name, i)).await.unwrap();
        }
        let never = AtomicBool::new(false);
        let cfg = ClassifyConfig::default();
        let ctx = SyncCtx { store: &a.store, account_id: "a1", classify: &cfg, events: &a.events, since_ms: None, cancel: &never };
        let plans = sync_folders(srv, &ctx).await.unwrap();
        (path, plans)
    }

    fn plan<'p>(plans: &'p [MailboxPlan], path: &str) -> &'p MailboxPlan {
        plans.iter().find(|p| p.path == path).unwrap()
    }

    fn uids(s: &Store, path: &str) -> usize {
        s.list_mailboxes("a1").unwrap().into_iter().find(|m| m.id == mailbox_id("a1", path)).map_or(0, |m| m.total as usize)
    }

    #[test]
    fn folders_roles_special_use() {
        if !enabled() { return; }
        rt().block_on(async {
            let (_s, a) = account("roles");
            let mut srv = connect().await;
            let (_, plans) = folder(&mut srv, &a, "roles", 0).await;
            for (path, role) in [("INBOX", MailboxRole::Inbox), ("Sent", MailboxRole::Sent), ("Drafts", MailboxRole::Drafts), ("Archive", MailboxRole::Archive), ("Trash", MailboxRole::Trash), ("Junk", MailboxRole::Spam)] {
                assert_eq!(plan(&plans, path).role, role, "{path}");
            }
        });
    }

    #[test]
    fn first_sync_newest_first() {
        if !enabled() { return; }
        rt().block_on(async {
            let (s, a) = account("first");
            let mut srv = connect().await;
            let (path, plans) = folder(&mut srv, &a, "first", FIRST_BATCH + 20).await;
            let t = Instant::now();
            let r = a.round(&mut srv, &plans, plan(&plans, &path)).await.unwrap();
            assert!(t.elapsed() < Duration::from_secs(10));
            assert_eq!(r.new_uids.len(), FIRST_BATCH);
            assert_eq!(*r.new_uids.last().unwrap() as usize, FIRST_BATCH + 20, "newest UIDs first");
            assert!(r.backfill_pending);
            assert_eq!(uids(&s, &path), FIRST_BATCH);
        });
    }

    #[test]
    fn backfill_progress_and_cancel() {
        if !enabled() { return; }
        rt().block_on(async {
            let (s, a) = account("backfill");
            let mut srv = connect().await;
            let (path, plans) = folder(&mut srv, &a, "backfill", FIRST_BATCH + 1200).await;
            let only: Vec<MailboxPlan> = vec![plan(&plans, &path).clone()];
            a.round(&mut srv, &only, &only[0]).await.unwrap();
            let mut rx = a.events.subscribe();
            let cancel = a.cancel_backfill.clone();
            let watcher = tokio::spawn(async move {
                let mut seen = vec![];
                while let Ok(e) = rx.recv().await {
                    if let MailEvent::SyncStatus { progress: Some(p), .. } = e {
                        seen.push(p);
                        if seen.len() == 2 { cancel.store(true, Ordering::SeqCst); }
                    }
                    if let MailEvent::SyncStatus { progress: None, .. } = e { return seen; }
                }
                seen
            });
            let r = a.backfill_all(&mut srv, &only).await;
            let seen = watcher.await.unwrap();
            assert!(r.is_err(), "cancelled");
            assert!(seen.windows(2).all(|w| w[0] < w[1]) && seen[0] > 0.0);
            let mid = uids(&s, &path);
            assert!(mid > FIRST_BATCH && mid < FIRST_BATCH + 1200, "{mid}");
            a.backfill_all(&mut srv, &only).await.unwrap();
            assert_eq!(uids(&s, &path), FIRST_BATCH + 1200);
        });
    }

    async fn full(a: &AccountSync, srv: &mut Srv, name: &str, n: usize) -> (String, Vec<MailboxPlan>) {
        let (path, plans) = folder(srv, a, name, n).await;
        let only: Vec<MailboxPlan> = vec![plan(&plans, &path).clone()];
        a.round(srv, &only, &only[0]).await.unwrap();
        a.backfill_all(srv, &only).await.unwrap();
        (path, only)
    }

    #[test]
    fn external_flag_change_deep_history() {
        if !enabled() { return; }
        rt().block_on(async {
            let (s, a) = account("flags");
            let mut srv = connect().await;
            let (path, only) = full(&a, &mut srv, "flags", 600).await;
            // "Another client" flags UID 2, deep in history.
            let mut other = connect().await;
            other.session.select(&path).await.unwrap();
            let _: Vec<_> = futures_util::TryStreamExt::try_collect(other.session.uid_store("2", "+FLAGS (\\Flagged \\Seen)").await.unwrap()).await.unwrap();
            let r = a.round(&mut srv, &only, &only[0]).await.unwrap();
            assert_eq!(r.flag_updates, 1);
            let rows = s
                .list_threads(&ListInput { view: ViewRef::Mailbox(mailbox_id("a1", &path)), tab: None, after: None, limit: 500 })
                .unwrap()
                .rows;
            let row = rows.iter().find(|r| r.subject == "flags 1").expect("uid 2");
            assert!(!row.unread, "the other client's \\Seen arrived");
        });
    }

    #[test]
    fn external_expunge_deep_history() {
        if !enabled() { return; }
        rt().block_on(async {
            let (s, a) = account("expunge");
            let mut srv = connect().await;
            let (path, only) = full(&a, &mut srv, "expunge", 400).await;
            let mut other = connect().await;
            other.session.select(&path).await.unwrap();
            let _: Vec<_> = futures_util::TryStreamExt::try_collect(other.session.uid_store("3,77", "+FLAGS (\\Deleted)").await.unwrap()).await.unwrap();
            let _: Vec<_> = futures_util::TryStreamExt::try_collect(other.session.expunge().await.unwrap()).await.unwrap();
            let r = a.round(&mut srv, &only, &only[0]).await.unwrap();
            assert_eq!(r.expunged, vec![3, 77]);
            assert_eq!(uids(&s, &path), 398);
        });
    }

    #[test]
    fn burst_of_200_no_gaps() {
        if !enabled() { return; }
        rt().block_on(async {
            let (s, a) = account("burst");
            let mut srv = connect().await;
            let (path, only) = full(&a, &mut srv, "burst", 1).await;
            let mut other = connect().await;
            for i in 0..200 {
                other.session.append(&path, None, None, msg("burst", 1000 + i)).await.unwrap();
                if i % 9 == 0 {
                    // Leave a UID hole: append and expunge.
                    other.session.append(&path, Some("(\\Deleted)"), None, msg("hole", i)).await.unwrap();
                }
            }
            other.session.select(&path).await.unwrap();
            let _: Vec<_> = futures_util::TryStreamExt::try_collect(other.session.expunge().await.unwrap()).await.unwrap();
            let r = a.round(&mut srv, &only, &only[0]).await.unwrap();
            assert_eq!(r.new_uids.len(), 200);
            assert_eq!(uids(&s, &path), 201);
        });
    }

    #[test]
    fn idle_new_mail_reaches_event_stream() {
        if !enabled() { return; }
        rt().block_on(async {
            let (_s, a) = account("idle");
            let a = Arc::new(a);
            let mut srv = connect().await;
            let plans = a.first_round(&mut srv).await.unwrap();
            let mut rx = a.events.subscribe();
            let stop = Arc::new(AtomicBool::new(false));
            let (a2, stop2, p2) = (a.clone(), stop.clone(), plans.clone());
            let idle_srv = connect().await;
            let task = tokio::spawn(async move { a2.idle_loop(idle_srv, &p2, &stop2).await });
            tokio::time::sleep(Duration::from_millis(500)).await;
            let mut other = connect().await;
            let t = Instant::now();
            other.session.append("INBOX", None, None, msg("idle", std::process::id() as usize)).await.unwrap();
            let got = tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if let Ok(MailEvent::NewMail { thread_ids, .. }) = rx.recv().await { return thread_ids; }
                }
            })
            .await
            .expect("new mail on the event stream within 5 s");
            assert_eq!(got.len(), 1);
            assert!(t.elapsed() < Duration::from_secs(5));
            stop.store(true, Ordering::SeqCst);
            task.abort();
        });
    }
}
