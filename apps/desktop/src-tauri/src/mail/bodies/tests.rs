use super::fetch::*;
use super::*;
use crate::mail::contracts::{BodyState, MailboxRole, TabKind};
use crate::mail::store::*;
use std::collections::HashMap;

fn store(tag: &str) -> Store {
    let d = std::env::temp_dir().join(format!(
        "moduo-mail-bodies-{tag}-{}-{}",
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
    s.upsert_mailbox(&MailboxInput {
        id: "inbox".into(),
        account_id: "a1".into(),
        path: "INBOX".into(),
        name: "Inbox".into(),
        role: MailboxRole::Inbox,
        delimiter: Some("/".into()),
        live: true,
    })
    .unwrap();
    s
}

fn msg(
    ext: &str,
    uid: i64,
    thread: &str,
    date: i64,
    size: i64,
    atts: Vec<AttachmentInput>,
) -> MessageInput {
    MessageInput {
        account_id: "a1".into(),
        ext_id: ext.into(),
        mailbox_id: "inbox".into(),
        uid,
        modseq: None,
        message_id: Some(format!("<{ext}@x>")),
        in_reply_to: None,
        references: vec![],
        thread_id: thread.into(),
        from: Address {
            name: "Anna".into(),
            email: "anna@x.test".into(),
        },
        to: vec![],
        cc: vec![],
        subject: format!("Subject {ext}"),
        snippet: String::new(),
        date_ms: date,
        flags: 0,
        size,
        list_unsubscribe: None,
        list_unsubscribe_post: None,
        precedence: None,
        auto_submitted: None,
        has_invite: false,
        tab: Some(TabRef::of(TabKind::Personal)),
        priority: false,
        attachments: atts,
    }
}

fn raw(word: &str) -> Vec<u8> {
    format!(
        "From: Anna <anna@x.test>\r\nSubject: s\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"B\"\r\n\r\n--B\r\nContent-Type: text/plain\r\n\r\n{word} body\r\n--B\r\nContent-Type: image/png; name=\"pic.png\"\r\nContent-Disposition: attachment; filename=\"pic.png\"\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--B--\r\n"
    )
    .into_bytes()
}

#[derive(Default)]
struct Fake {
    mail: HashMap<u32, Vec<u8>>,
    calls: Vec<(u32, FetchWhat)>,
    offline: bool,
}

impl RawSource for Fake {
    async fn fetch(&mut self, _mb: &str, uid: u32, what: FetchWhat) -> Result<Vec<u8>, String> {
        self.calls.push((uid, what.clone()));
        if self.offline {
            return Err("offline".into());
        }
        if let FetchWhat::Part(_) = what {
            return Ok(
                b"Content-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8="
                    .to_vec(),
            );
        }
        let m = self.mail.get(&uid).ok_or("missing")?;
        Ok(match what {
            FetchWhat::Whole => m.clone(),
            FetchWhat::Prefix(n) => {
                let split = m.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
                let end = (split + n as usize).min(m.len());
                m[..end].to_vec()
            }
            FetchWhat::Part(_) => unreachable!(),
        })
    }
}

fn id_of(s: &Store, ext: &str) -> i64 {
    s.message_row_id("a1", ext).unwrap().unwrap()
}

fn state_of(s: &Store, ext: &str) -> BodyState {
    let t = s.body_target(id_of(s, ext)).unwrap().unwrap();
    t.body_state
}

fn pic() -> AttachmentInput {
    AttachmentInput {
        part_id: "2".into(),
        filename: "pic.png".into(),
        mime: "image/png".into(),
        size: 5,
        is_inline: false,
        content_id: None,
    }
}

#[test]
fn queue_priority_dedupe_and_visible() {
    let mut q = PrefetchQueue::new();
    q.push(1, Priority::Recent);
    q.push(2, Priority::NewestInbox);
    q.push(3, Priority::IndexOnly);
    q.push(1, Priority::Opened); // raised
    q.push(2, Priority::IndexOnly); // never lowered
    assert_eq!(q.len(), 3);
    q.set_visible(&[4, 5]);
    q.set_visible(&[5]);
    assert_eq!(q.pop(), Some((1, Priority::Opened)));
    assert_eq!(q.pop(), Some((5, Priority::Visible)));
    assert_eq!(q.pop(), Some((2, Priority::NewestInbox)));
    assert_eq!(q.pop(), Some((3, Priority::IndexOnly)));
    assert!(q.is_empty());
}

#[test]
fn partial_fetch_plan() {
    let now = 1_000 * RECENT_WINDOW_MS;
    let recent = now - 1000;
    let old = now - 2 * RECENT_WINDOW_MS;
    assert_eq!(
        plan(1000, recent, now, Priority::NewestInbox),
        FetchPlan::Whole
    );
    assert_eq!(
        plan(WHOLE_MAX_BYTES + 1, recent, now, Priority::Opened),
        FetchPlan::Prefix {
            max: LARGE_PREFIX_BYTES,
            full: true
        }
    );
    assert_eq!(
        plan(1000, old, now, Priority::Recent),
        FetchPlan::Prefix {
            max: INDEX_TEXT_BYTES,
            full: false
        }
    );
    // Opening old mail gets the full body.
    assert_eq!(plan(1000, old, now, Priority::Opened), FetchPlan::Whole);
}

#[tokio::test]
async fn open_thread_one_source_and_attachments_stored() {
    let s = store("open");
    let now = now_ms();
    s.ingest(&[
        msg("m1", 1, "t1", now - 2000, 300, vec![pic()]),
        msg("m2", 2, "t1", now - 1000, 300, vec![]),
    ])
    .unwrap();
    let mut src = Fake::default();
    src.mail.insert(1, raw("zebra"));
    src.mail.insert(2, raw("yak"));
    assert_eq!(load_thread(&s, &mut src, "t1").await.unwrap(), 2);
    assert_eq!(src.calls.len(), 2);
    assert!(src.calls.iter().all(|(_, w)| *w == FetchWhat::Whole));
    assert_eq!(state_of(&s, "m1"), BodyState::Full);
    // Attachment bytes from the whole fetch are kept, no second download.
    let att_id: i64 = s
        .r()
        .query_row("SELECT id FROM attachments", [], |r| r.get(0))
        .unwrap();
    let p = fetch_attachment(&s, &mut src, att_id).await.unwrap();
    assert_eq!(std::fs::read(p).unwrap(), b"hello");
    assert_eq!(src.calls.len(), 2);
    // Downloaded thread: no fetch at all on reopen.
    assert_eq!(load_thread(&s, &mut src, "t1").await.unwrap(), 0);
    let d = s.get_thread("t1").unwrap().unwrap();
    assert!(d.messages[0].text.as_deref().unwrap().contains("zebra"));
    // Body text is indexed.
    let hits = s
        .search(&SearchQuery {
            words: vec!["zebra".into()],
            limit: 10,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(hits.len(), 1);
}

#[tokio::test]
async fn attachment_on_demand_by_section() {
    let s = store("att");
    s.ingest(&[msg("m1", 1, "t1", now_ms(), 300, vec![pic()])])
        .unwrap();
    let mut src = Fake::default();
    let att_id: i64 = s
        .r()
        .query_row("SELECT id FROM attachments", [], |r| r.get(0))
        .unwrap();
    let p = fetch_attachment(&s, &mut src, att_id).await.unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"hello");
    assert_eq!(src.calls, vec![(1, FetchWhat::Part("2".into()))]);
    // Cached now.
    fetch_attachment(&s, &mut src, att_id).await.unwrap();
    assert_eq!(src.calls.len(), 1);
}

#[tokio::test]
async fn text_only_index_fetch_for_old_mail() {
    let s = store("index");
    let old = now_ms() - 2 * RECENT_WINDOW_MS;
    s.ingest(&[msg("m1", 1, "t1", old, 300, vec![])]).unwrap();
    let mut src = Fake::default();
    src.mail.insert(1, raw("quokka"));
    let mut q = PrefetchQueue::new();
    for (id, p) in s.prefetch_candidates("a1", now_ms(), 100).unwrap() {
        assert_eq!(p, Priority::IndexOnly);
        q.push(id, p);
    }
    assert_eq!(drain_prefetch(&s, &mut src, &mut q, 10).await.unwrap(), 1);
    assert_eq!(src.calls[0].1, FetchWhat::Prefix(INDEX_TEXT_BYTES));
    assert_eq!(state_of(&s, "m1"), BodyState::TextOnly);
    let hits = s
        .search(&SearchQuery {
            words: vec!["quokka".into()],
            limit: 10,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(hits.len(), 1);
    // Opening it later upgrades to the full body.
    load_thread(&s, &mut src, "t1").await.unwrap();
    assert_eq!(state_of(&s, "m1"), BodyState::Full);
}

#[tokio::test]
async fn offline_keeps_queue_and_reports() {
    let s = store("offline");
    s.ingest(&[msg("m1", 1, "t1", now_ms(), 300, vec![])])
        .unwrap();
    let mut src = Fake {
        offline: true,
        ..Default::default()
    };
    let mut q = PrefetchQueue::new();
    q.push(id_of(&s, "m1"), Priority::Opened);
    assert!(matches!(
        drain_prefetch(&s, &mut src, &mut q, 5).await,
        Err(BodyError::Offline(_))
    ));
    assert_eq!(q.len(), 1);
    assert_eq!(state_of(&s, "m1"), BodyState::None);
}

#[tokio::test]
async fn show_original_returns_raw() {
    let s = store("orig");
    s.ingest(&[msg("m1", 1, "t1", now_ms(), 300, vec![])])
        .unwrap();
    let mut src = Fake::default();
    src.mail.insert(1, raw("raw"));
    let o = show_original(&s, &mut src, id_of(&s, "m1")).await.unwrap();
    assert!(o.starts_with("From: Anna"));
    assert!(o.contains("aGVsbG8="));
}

#[tokio::test]
async fn disk_cap_lru_eviction_and_clear() {
    let s = store("cap");
    let now = now_ms();
    s.ingest(&[
        msg("m1", 1, "t1", now - 3000, 300, vec![pic()]),
        msg("m2", 2, "t2", now - 2000, 300, vec![]),
        msg("m3", 3, "t3", now - 1000, 300, vec![]),
    ])
    .unwrap();
    let mut src = Fake::default();
    for (u, w) in [(1, "alpha"), (2, "bravo"), (3, "charlie")] {
        src.mail.insert(u, raw(w));
    }
    for t in ["t1", "t2", "t3"] {
        load_thread(&s, &mut src, t).await.unwrap();
    }
    // Make t1 the oldest opened, then t3, then t2 (most recent).
    for (t, at) in [("t1", 10), ("t3", 20), ("t2", 30)] {
        s.w()
            .execute(
                "UPDATE bodies SET last_access_ms = ?2 WHERE message_id IN (SELECT id FROM messages WHERE thread_id = ?1)",
                rusqlite::params![t, at],
            )
            .unwrap();
    }
    s.w()
        .execute("UPDATE attachments SET last_access_ms = 15", [])
        .unwrap();
    let (b, a) = s.account_usage("a1").unwrap();
    assert_eq!(a, 5);
    let body_each = b / 3;
    // Room for one body only.
    s.set_disk_cap("a1", body_each + 1).unwrap();
    let ev = s.enforce_disk_cap("a1").unwrap();
    assert_eq!(ev.bodies, 2);
    assert_eq!(ev.attachments, 1);
    assert_eq!(state_of(&s, "m1"), BodyState::Evicted);
    assert_eq!(state_of(&s, "m3"), BodyState::Evicted);
    assert_eq!(state_of(&s, "m2"), BodyState::Full);
    let (b2, a2) = s.account_usage("a1").unwrap();
    assert!(b2 + a2 <= body_each + 1);
    assert_eq!(
        std::fs::read_dir(s.root().join("files").join("a1"))
            .unwrap()
            .count(),
        0
    );
    // Headers stay; evicted body text is still searchable.
    let q = |w: &str| {
        s.search(&SearchQuery {
            words: vec![w.into()],
            limit: 10,
            ..Default::default()
        })
        .unwrap()
        .len()
    };
    assert_eq!(q("alpha"), 1);
    assert_eq!(s.get_thread("t1").unwrap().unwrap().messages.len(), 1);
    // Under the cap: nothing more to evict.
    assert_eq!(s.enforce_disk_cap("a1").unwrap(), cap::Evicted::default());

    // Clear all downloaded mail: bodies gone and body text drops from the index.
    assert_eq!(s.clear_downloaded("a1").unwrap(), 3);
    assert_eq!(s.account_usage("a1").unwrap(), (0, 0));
    assert_eq!(q("alpha"), 0);
    assert_eq!(q("bravo"), 0);
    assert_eq!(q("Subject"), 3);
    assert_eq!(state_of(&s, "m2"), BodyState::None);
}

#[tokio::test]
async fn clear_attachments_only() {
    let s = store("clearatt");
    s.ingest(&[msg("m1", 1, "t1", now_ms(), 300, vec![pic()])])
        .unwrap();
    let mut src = Fake::default();
    src.mail.insert(1, raw("x"));
    load_thread(&s, &mut src, "t1").await.unwrap();
    assert_eq!(s.clear_attachments("a1").unwrap(), 1);
    let (b, a) = s.account_usage("a1").unwrap();
    assert!(b > 0);
    assert_eq!(a, 0);
}
