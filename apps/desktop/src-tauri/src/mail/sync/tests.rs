//! Sync correctness against the in-memory server (AC5, AC6, AC8, AC9). The
//! same scenarios run against Dovecot in `tests/mail_it.rs` (`MODUO_MAIL_IT=1`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use super::classify::ClassifyConfig;
use super::engine::{mailbox_id, MailboxPlan, FIRST_BATCH};
use super::events::{EventBus, MailEvent};
use super::live::AccountSync;
use super::testing::{store, Fake};
use crate::mail::contracts::{MailboxRole, FLAG_FLAGGED, FLAG_SEEN};
use crate::mail::store::{ListInput, Store, ViewRef};

fn server(condstore: bool) -> Fake {
    let f = Fake::new(condstore, false);
    f.add_folder("INBOX", &[]);
    f.add_folder("Sent", &["\\Sent"]);
    f.add_folder("Archive", &["\\Archive"]);
    f
}

fn sync(tag: &str) -> (Arc<Store>, AccountSync) {
    let s = Arc::new(store(tag));
    let a = AccountSync::new(
        "a1",
        s.clone(),
        EventBus::new(),
        Arc::new(RwLock::new(ClassifyConfig::default())),
        None,
    );
    (s, a)
}

fn inbox_rows(s: &Store) -> Vec<crate::mail::store::ThreadRow> {
    let mut out = vec![];
    let mut after = None;
    loop {
        let p = s
            .list_threads(&ListInput {
                view: ViewRef::Mailbox(mailbox_id("a1", "INBOX")),
                tab: None,
                after,
                limit: 500,
            })
            .unwrap();
        out.extend(p.rows);
        match p.next {
            Some(n) => after = Some(n),
            None => return out,
        }
    }
}

fn stored_uids(s: &Store, path: &str) -> Vec<i64> {
    let c = s.r();
    let mut st = c
        .prepare("SELECT uid FROM message_mailboxes WHERE mailbox_id = ?1 ORDER BY uid")
        .unwrap();
    st.query_map([mailbox_id("a1", path)], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn inbox(plans: &[MailboxPlan]) -> MailboxPlan {
    plans
        .iter()
        .find(|p| p.role == MailboxRole::Inbox)
        .unwrap()
        .clone()
}

#[tokio::test]
async fn first_sync_newest_first() {
    let f = server(true);
    for i in 0..(FIRST_BATCH as i64 + 50) {
        f.append("INBOX", &format!("m{i}"), 1_000_000 + i * 1_000);
    }
    let (s, a) = sync("first");
    let mut srv = f.session();
    let plans = a.first_round(&mut srv).await.unwrap();
    // The first round takes only the newest batch, newest UID first.
    let fetched = f.fetched();
    assert_eq!(fetched.len(), FIRST_BATCH);
    assert_eq!(fetched[0], FIRST_BATCH as u32 + 50, "newest first");
    let rows = inbox_rows(&s);
    assert_eq!(rows.len(), FIRST_BATCH);
    assert_eq!(rows[0].subject, format!("Subject m{}", FIRST_BATCH + 49));
    // Roles came from SPECIAL-USE.
    assert!(plans
        .iter()
        .any(|p| p.path == "Sent" && p.role == MailboxRole::Sent));
    assert!(plans
        .iter()
        .any(|p| p.path == "Archive" && p.role == MailboxRole::Archive));
}

/// Delegates to the fake and raises `cancel` after `n` header fetches, so the
/// cancel lands deterministically between backfill chunks.
struct CancelAfter {
    inner: Fake,
    n: usize,
    cancel: Arc<AtomicBool>,
}

impl super::server::MailServer for CancelAfter {
    fn caps(&self) -> &crate::mail::session::Capabilities {
        self.inner.caps()
    }
    async fn list_folders(&mut self) -> super::server::SrvResult<Vec<super::roles::FolderInfo>> {
        self.inner.list_folders().await
    }
    async fn select(&mut self, p: &str) -> super::server::SrvResult<super::server::SelectInfo> {
        self.inner.select(p).await
    }
    async fn search_uids(&mut self, s: Option<i64>) -> super::server::SrvResult<Vec<u32>> {
        self.inner.search_uids(s).await
    }
    async fn fetch_headers(
        &mut self,
        u: &[u32],
    ) -> super::server::SrvResult<Vec<super::server::FetchedHeader>> {
        let r = self.inner.fetch_headers(u).await;
        if self.n > 0 {
            self.n -= 1;
            if self.n == 0 {
                self.cancel.store(true, Ordering::SeqCst);
            }
        }
        r
    }
    async fn fetch_flags(
        &mut self,
        lo: u32,
        hi: Option<u32>,
        c: Option<u64>,
    ) -> super::server::SrvResult<Vec<super::server::FlagUpdate>> {
        self.inner.fetch_flags(lo, hi, c).await
    }
    async fn status(&mut self, p: &str) -> super::server::SrvResult<super::server::StatusInfo> {
        self.inner.status(p).await
    }
}

#[tokio::test]
async fn backfill_progress_and_cancel() {
    use super::server::MailServer;
    let f = server(true);
    let n = FIRST_BATCH + 3 * super::engine::BACKFILL_CHUNK;
    for i in 0..n as i64 {
        f.append("INBOX", &format!("m{i}"), 1_000 + i);
    }
    let (s, a) = sync("backfill");
    let mut srv = f.session();
    let plans = a.first_round(&mut srv).await.unwrap();
    let mut rx = a.events.subscribe();
    // One backfill chunk is BACKFILL_CHUNK / FETCH_CHUNK header fetches.
    let per_chunk = super::engine::BACKFILL_CHUNK / super::engine::FETCH_CHUNK;
    let mut c = CancelAfter {
        inner: f.session(),
        n: per_chunk,
        cancel: a.cancel_backfill.clone(),
    };
    let _ = c.caps();
    let r = a.backfill_all(&mut c, &plans).await;
    assert!(
        matches!(r, Err(super::engine::SyncError::Cancelled)),
        "{r:?}"
    );
    let mut seen = vec![];
    while let Ok(e) = rx.try_recv() {
        if let MailEvent::SyncStatus {
            progress: Some(p), ..
        } = e
        {
            seen.push(p);
        }
    }
    assert!(seen.len() >= 2, "{seen:?}");
    assert!(
        seen.windows(2).all(|w| w[0] < w[1]),
        "determinate, increasing: {seen:?}"
    );
    assert!(seen[0] > 0.0 && *seen.last().unwrap() < 1.0);
    let after_cancel = inbox_rows(&s).len();
    assert_eq!(after_cancel, FIRST_BATCH + super::engine::BACKFILL_CHUNK);
    // Resuming finishes from the kept floor without refetching.
    f.fetched();
    a.backfill_all(&mut srv, &plans).await.unwrap();
    assert_eq!(inbox_rows(&s).len(), n);
    assert_eq!(f.fetched().len(), n - after_cancel);
}

async fn deep_history(condstore: bool, tag: &str) {
    let f = server(condstore);
    for i in 0..1200 {
        f.append("INBOX", &format!("m{i}"), 1_000 + i);
    }
    let (s, a) = sync(tag);
    let mut srv = f.session();
    let plans = a.first_round(&mut srv).await.unwrap();
    a.backfill_all(&mut srv, &plans).await.unwrap();
    assert_eq!(inbox_rows(&s).len(), 1200);
    // Another client flags message 3 (deep in history) and reads message 7.
    f.set_flags("INBOX", 3, FLAG_FLAGGED | FLAG_SEEN);
    f.set_flags("INBOX", 7, FLAG_SEEN);
    let ib = inbox(&plans);
    let r = a.round(&mut srv, &plans, &ib).await.unwrap();
    assert_eq!(r.flag_updates, 2, "one round");
    let flags: Vec<u32> = [3, 7]
        .iter()
        .map(|u| s.r().query_row(
            "SELECT m.flags FROM message_mailboxes mm JOIN messages m ON m.id = mm.message_id WHERE mm.mailbox_id = ?1 AND mm.uid = ?2",
            rusqlite::params![mailbox_id("a1", "INBOX"), u], |r| r.get(0)).unwrap())
        .collect();
    assert_eq!(flags, vec![FLAG_FLAGGED | FLAG_SEEN, FLAG_SEEN]);
}

#[tokio::test]
async fn external_flag_change_deep_history() {
    deep_history(true, "flags-cs").await;
}

#[tokio::test]
async fn external_flag_change_deep_history_without_condstore() {
    // The chunked diff covers the whole range; 1200 < FLAG_DIFF_CHUNK, so one round.
    deep_history(false, "flags-diff").await;
}

#[tokio::test]
async fn external_expunge_deep_history() {
    let f = server(true);
    for i in 0..300 {
        f.append("INBOX", &format!("m{i}"), 1_000 + i);
    }
    let (s, a) = sync("expunge");
    let mut srv = f.session();
    let plans = a.first_round(&mut srv).await.unwrap();
    a.backfill_all(&mut srv, &plans).await.unwrap();
    f.expunge("INBOX", 2);
    f.expunge("INBOX", 150);
    let r = a.round(&mut srv, &plans, &inbox(&plans)).await.unwrap();
    assert_eq!(r.expunged, vec![2, 150]);
    let uids = stored_uids(&s, "INBOX");
    assert_eq!(uids.len(), 298);
    assert!(!uids.contains(&2) && !uids.contains(&150));
    let gone: i64 = s
        .r()
        .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(gone, 298, "orphaned messages are deleted");
}

#[tokio::test]
async fn burst_of_200_no_gaps() {
    let f = server(true);
    f.append("INBOX", "seed", 1);
    let (s, a) = sync("burst");
    let mut srv = f.session();
    let plans = a.first_round(&mut srv).await.unwrap();
    for i in 0..200 {
        if i % 7 == 0 {
            f.skip_uids("INBOX", 3); // non-contiguous UIDs
        }
        f.append("INBOX", &format!("b{i}"), 10 + i);
    }
    let mut rx = a.events.subscribe();
    let r = a.round(&mut srv, &plans, &inbox(&plans)).await.unwrap();
    assert_eq!(r.new_uids.len(), 200);
    assert_eq!(inbox_rows(&s).len(), 201);
    let server_uids: Vec<i64> = f.st.lock().unwrap().boxes["INBOX"]
        .msgs
        .keys()
        .map(|u| *u as i64)
        .collect();
    assert_eq!(stored_uids(&s, "INBOX"), server_uids);
    let mut new_mail = 0;
    while let Ok(e) = rx.try_recv() {
        if let MailEvent::NewMail { thread_ids, .. } = e {
            new_mail += thread_ids.len();
        }
    }
    assert_eq!(new_mail, 200);
}

#[tokio::test]
async fn uidvalidity_reset_resyncs_without_stale_rows() {
    let f = server(true);
    for i in 0..10 {
        f.append("INBOX", &format!("m{i}"), 1_000 + i);
    }
    let (s, a) = sync("uidv");
    let mut srv = f.session();
    let plans = a.first_round(&mut srv).await.unwrap();
    let before: Vec<String> = inbox_rows(&s).into_iter().map(|r| r.thread_id).collect();
    f.recreate("INBOX");
    let r = a.round(&mut srv, &plans, &inbox(&plans)).await.unwrap();
    assert!(r.reset);
    let uids = stored_uids(&s, "INBOX");
    assert_eq!(
        uids,
        (1000..1010).collect::<Vec<i64>>(),
        "only the new UIDs remain"
    );
    let after: Vec<String> = inbox_rows(&s).into_iter().map(|r| r.thread_id).collect();
    assert_eq!(before, after, "same messages, same threads");
}

#[tokio::test]
async fn idle_new_mail_reaches_event_stream() {
    let f = server(true);
    f.append("INBOX", "seed", 1);
    let (_s, a) = sync("idle");
    let a = Arc::new(a);
    let mut srv = f.session();
    let plans = a.first_round(&mut srv).await.unwrap();
    let mut rx = a.events.subscribe();
    let stop = Arc::new(AtomicBool::new(false));
    let (a2, stop2, p2, idle_srv) = (a.clone(), stop.clone(), plans.clone(), f.session());
    let task = tokio::spawn(async move { a2.idle_loop(idle_srv, &p2, &stop2).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    let started = std::time::Instant::now();
    f.append("INBOX", "live", 5);
    let got = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(MailEvent::NewMail { thread_ids, .. }) = rx.recv().await {
                return thread_ids;
            }
        }
    })
    .await
    .expect("new mail within 5 s");
    assert_eq!(got.len(), 1);
    assert!(started.elapsed() < Duration::from_secs(5));
    stop.store(true, Ordering::SeqCst);
    f.append("INBOX", "wake", 6); // wakes the IDLE so the loop sees stop
    let _ = tokio::time::timeout(Duration::from_secs(5), task).await;
}

#[tokio::test]
async fn status_sweep_only_rounds_moved_folders() {
    let f = server(true);
    f.append("Sent", "s1", 1);
    let (s, a) = sync("sweep");
    let mut srv = f.session();
    let plans = a.first_round(&mut srv).await.unwrap();
    let mut sched = super::live::Schedule::default();
    let idle = mailbox_id("a1", "INBOX");
    assert_eq!(
        a.sweep(&mut srv, &plans, &mut sched, Some(&idle), 0)
            .await
            .unwrap(),
        0,
        "nothing moved"
    );
    f.append("Sent", "s2", 2);
    assert_eq!(
        a.sweep(&mut srv, &plans, &mut sched, Some(&idle), 30_000)
            .await
            .unwrap(),
        0,
        "not due yet"
    );
    assert_eq!(
        a.sweep(&mut srv, &plans, &mut sched, Some(&idle), 60_000)
            .await
            .unwrap(),
        1
    );
    assert_eq!(stored_uids(&s, "Sent").len(), 2);
}

#[tokio::test]
async fn threading_and_tabs_at_ingest() {
    let f = server(true);
    use super::testing::raw;
    // The reply arrives (newer UID) and is synced in the same batch as its parent.
    f.append_raw(
        "INBOX",
        raw("p@x", &[], "Ann <ann@x.test>", "Plan", 1_000),
        1_000,
        &[],
    );
    f.append_raw(
        "INBOX",
        raw("r@x", &["p@x"], "Bob <bob@x.test>", "Re: Plan", 2_000),
        2_000,
        &[],
    );
    let mut news = raw("n@x", &[], "Paper <news@paper.test>", "Digest", 3_000);
    news.splice(
        0..0,
        b"List-Unsubscribe: <https://paper.test/u>\r\n"
            .iter()
            .copied(),
    );
    f.append_raw("INBOX", news, 3_000, &[]);
    let (s, a) = sync("thread");
    let mut srv = f.session();
    a.first_round(&mut srv).await.unwrap();
    let rows = inbox_rows(&s);
    assert_eq!(rows.len(), 2, "parent and reply are one thread");
    let plan = rows
        .iter()
        .find(|r| r.subject == "Plan" || r.subject == "Re: Plan")
        .unwrap();
    assert_eq!(plan.message_count, 2);
    let digest = rows.iter().find(|r| r.subject == "Digest").unwrap();
    assert_eq!(digest.tab, crate::mail::contracts::TabKind::Newsletters);
}

#[tokio::test]
async fn sync_round_inside_undo_window_keeps_thread_hidden() {
    let f = server(true);
    f.append("INBOX", "m1", 1_000);
    f.append("INBOX", "m2", 2_000);
    let (s, a) = sync("reload");
    let mut srv = f.session();
    let plans = a.first_round(&mut srv).await.unwrap();
    let t = inbox_rows(&s)[0].thread_id.clone();
    s.enqueue_op(&crate::mail::ops::OpRequest::new(crate::mail::contracts::OpKind::Done, vec![t.clone()]))
        .unwrap();
    assert!(inbox_rows(&s).iter().all(|r| r.thread_id != t));
    // The server still has it in INBOX (the op hasn't flushed); a new message
    // arrives too, so the round ingests and re-touches the inbox.
    f.append("INBOX", "m3", 3_000);
    f.set_flags("INBOX", 2, FLAG_SEEN);
    a.round(&mut srv, &plans, &inbox(&plans)).await.unwrap();
    let rows = inbox_rows(&s);
    assert!(rows.iter().all(|r| r.thread_id != t), "no resurrection inside the window");
    assert_eq!(rows.len(), 2);
}
