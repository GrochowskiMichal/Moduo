//! Store perf budgets on the 100k fixture (AC1, AC3, AC4). Run with
//! `cargo test --release --lib -- --ignored mail_perf` after
//! `bun scripts/mail/write-fixture.ts --format jsonl`. Each budget is checked
//! against the median of repeated runs, after one warm-up.

use super::*;
use crate::mail::contracts::{MailboxRole, TabKind};
use crate::mail::fixture::FixtureMessage;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

pub const LIST_PAGE_BUDGET: Duration = Duration::from_millis(10);
pub const COUNTS_BUDGET: Duration = Duration::from_millis(5);
pub const THREAD_OPEN_BUDGET: Duration = Duration::from_millis(10);
pub const FTS_BUDGET: Duration = Duration::from_millis(50);

fn fixture() -> Vec<FixtureMessage> {
    let rows = crate::mail::fixture::load_fixture()
        .expect("generate the fixture first: bun scripts/mail/write-fixture.ts --format jsonl");
    assert!(
        rows.len() >= 100_000,
        "reference fixture is 100k messages, got {}",
        rows.len()
    );
    rows
}

/// The header heuristics stage of classification, enough to spread the fixture
/// across tabs (the real classifier is MR-3's).
fn tab_of(m: &FixtureMessage) -> TabKind {
    if m.list_unsubscribe.is_some() {
        TabKind::Newsletters
    } else if m.auto_submitted.is_some() || m.precedence.is_some() {
        TabKind::Notifications
    } else {
        TabKind::Personal
    }
}

pub(crate) fn load_into(store: &Store, rows: &[FixtureMessage]) {
    let mut accounts: Vec<&str> = rows.iter().map(|m| m.account_id.as_str()).collect();
    accounts.sort();
    accounts.dedup();
    for a in &accounts {
        store
            .upsert_account(&AccountInput {
                id: a.to_string(),
                address: format!("{a}@fixture.test"),
                display_name: a.to_string(),
                provider: "imap".into(),
                hue: 0,
            })
            .unwrap();
        for role in MailboxRole::ALL {
            store
                .upsert_mailbox(&MailboxInput {
                    id: format!("{a}:{}", role.as_str()),
                    account_id: a.to_string(),
                    path: role.as_str().to_uppercase(),
                    name: role.as_str().into(),
                    role: *role,
                    delimiter: Some("/".into()),
                    live: false,
                })
                .unwrap();
        }
    }
    for (chunk_i, chunk) in rows.chunks(5_000).enumerate() {
        let batch: Vec<MessageInput> = chunk
            .iter()
            .enumerate()
            .map(|(i, m)| MessageInput {
                account_id: m.account_id.clone(),
                ext_id: m.id.clone(),
                mailbox_id: format!("{}:{}", m.account_id, m.mailbox_role),
                uid: (chunk_i * 5_000 + i + 1) as i64,
                modseq: None,
                message_id: Some(m.message_id.clone()),
                in_reply_to: m.in_reply_to.clone(),
                references: m.in_reply_to.iter().cloned().collect(),
                thread_id: m.thread_id.clone(),
                from: Address {
                    name: m.from_name.clone(),
                    email: m.from_email.clone(),
                },
                to: m
                    .to
                    .iter()
                    .map(|e| Address {
                        name: String::new(),
                        email: e.clone(),
                    })
                    .collect(),
                cc: vec![],
                subject: m.subject.clone(),
                snippet: m.snippet.clone(),
                date_ms: m.date_ms,
                flags: m.flags,
                size: m.body_text.len() as i64,
                list_unsubscribe: m.list_unsubscribe.clone(),
                list_unsubscribe_post: None,
                precedence: m.precedence.clone(),
                auto_submitted: m.auto_submitted.clone(),
                has_invite: m.has_invite,
                tab: Some(TabRef::of(tab_of(m))),
                priority: false,
                attachments: m
                    .attachment_names
                    .iter()
                    .enumerate()
                    .map(|(j, n)| AttachmentInput {
                        part_id: (j + 2).to_string(),
                        filename: n.clone(),
                        mime: "application/octet-stream".into(),
                        size: 1_000,
                        is_inline: false,
                        content_id: None,
                    })
                    .collect(),
            })
            .collect();
        store.ingest(&batch).unwrap();
        let bodies: Vec<(String, String, BodyInput)> = chunk
            .iter()
            .map(|m| {
                (
                    m.account_id.clone(),
                    m.id.clone(),
                    BodyInput {
                        html: None,
                        text: Some(m.body_text.clone()),
                        quote_offset: None,
                        tracker_count: 0,
                        state: crate::mail::contracts::BodyState::Full,
                    },
                )
            })
            .collect();
        let refs: Vec<(&str, &str, &BodyInput)> = bodies
            .iter()
            .map(|(a, e, b)| (a.as_str(), e.as_str(), b))
            .collect();
        store.put_bodies(&refs).unwrap();
    }
}

struct Loaded {
    store: Store,
    thread_ids: Vec<String>,
}

fn loaded() -> &'static Loaded {
    static L: OnceLock<Loaded> = OnceLock::new();
    L.get_or_init(|| {
        let rows = fixture();
        let store = Store::open(&super::tests::temp_dir("perf")).unwrap();
        let t = Instant::now();
        load_into(&store, &rows);
        eprintln!(
            "mail_perf: loaded {} messages in {:?}",
            rows.len(),
            t.elapsed()
        );
        let mut thread_ids: Vec<String> = rows
            .iter()
            .step_by(997)
            .map(|m| m.thread_id.clone())
            .collect();
        thread_ids.dedup();
        Loaded { store, thread_ids }
    })
}

fn median(mut f: impl FnMut(usize), runs: usize) -> Duration {
    f(0);
    let mut v: Vec<Duration> = (0..runs)
        .map(|i| {
            let t = Instant::now();
            f(i);
            t.elapsed()
        })
        .collect();
    v.sort();
    v[runs / 2]
}

fn check(name: &str, took: Duration, budget: Duration) {
    eprintln!("mail_perf: {name} median {took:?} (budget {budget:?})");
    assert!(took <= budget, "{name}: {took:?} > {budget:?}");
}

#[test]
#[ignore = "perf: needs the 100k fixture"]
fn mail_perf_list_page() {
    let _g = crate::mail::perf::perf_guard();
    let l = loaded();
    let views = [
        ViewRef::Unified(MailboxRole::Inbox),
        ViewRef::Mailbox("acc-gmail:inbox".into()),
        ViewRef::Unified(MailboxRole::Archive),
    ];
    for view in views {
        // First page, then a deep page reached by its cursor.
        let first = l
            .store
            .list_threads(&ListInput {
                view: view.clone(),
                tab: Some(TabRef::of(TabKind::Personal)),
                after: None,
                limit: 50,
            })
            .unwrap();
        assert_eq!(first.rows.len(), 50);
        let mut deep = first.next.clone();
        for _ in 0..40 {
            let p = l
                .store
                .list_threads(&ListInput {
                    view: view.clone(),
                    tab: Some(TabRef::of(TabKind::Personal)),
                    after: deep.clone(),
                    limit: 50,
                })
                .unwrap();
            if p.next.is_none() {
                break;
            }
            deep = p.next;
        }
        let took = median(
            |_| {
                l.store
                    .list_threads(&ListInput {
                        view: view.clone(),
                        tab: Some(TabRef::of(TabKind::Personal)),
                        after: None,
                        limit: 50,
                    })
                    .unwrap();
            },
            21,
        );
        check(&format!("list first page {view:?}"), took, LIST_PAGE_BUDGET);
        let took = median(
            |_| {
                l.store
                    .list_threads(&ListInput {
                        view: view.clone(),
                        tab: Some(TabRef::of(TabKind::Personal)),
                        after: deep.clone(),
                        limit: 50,
                    })
                    .unwrap();
            },
            21,
        );
        check(&format!("list deep page {view:?}"), took, LIST_PAGE_BUDGET);
        let took = median(
            |_| {
                l.store
                    .list_threads(&ListInput {
                        view: view.clone(),
                        tab: None,
                        after: None,
                        limit: 50,
                    })
                    .unwrap();
            },
            21,
        );
        check(
            &format!("list no-tab page {view:?}"),
            took,
            LIST_PAGE_BUDGET,
        );
    }
}

#[test]
#[ignore = "perf: needs the 100k fixture"]
fn mail_perf_counts() {
    let _g = crate::mail::perf::perf_guard();
    let l = loaded();
    let c = l.store.counts().unwrap();
    assert!(c.badge > 0);
    let took = median(
        |_| {
            l.store.counts().unwrap();
        },
        21,
    );
    check("counts", took, COUNTS_BUDGET);
}

#[test]
#[ignore = "perf: needs the 100k fixture"]
fn mail_perf_thread_open() {
    let _g = crate::mail::perf::perf_guard();
    let l = loaded();
    let n = l.thread_ids.len();
    let took = median(
        |i| {
            let t = l.store.get_thread(&l.thread_ids[i % n]).unwrap().unwrap();
            assert!(!t.messages.is_empty());
        },
        51,
    );
    check("thread open", took, THREAD_OPEN_BUDGET);
}

#[test]
#[ignore = "perf: needs the 100k fixture"]
fn mail_perf_fts() {
    let _g = crate::mail::perf::perf_guard();
    let l = loaded();
    let queries = [
        SearchQuery {
            words: vec!["timeline".into()],
            limit: 50,
            ..Default::default()
        },
        SearchQuery {
            words: vec!["contract".into(), "draft".into()],
            limit: 50,
            ..Default::default()
        },
        SearchQuery {
            words: vec!["meet".into()],
            limit: 50,
            ..Default::default()
        },
        SearchQuery {
            from: vec!["stripe".into()],
            limit: 50,
            ..Default::default()
        },
        SearchQuery {
            subject: vec!["invoice".into()],
            is_unread: true,
            limit: 50,
            ..Default::default()
        },
        SearchQuery {
            words: vec!["review".into()],
            has_attachment: true,
            in_role: Some(MailboxRole::Inbox),
            limit: 50,
            ..Default::default()
        },
        SearchQuery {
            is_unread: true,
            in_role: Some(MailboxRole::Inbox),
            limit: 50,
            ..Default::default()
        },
    ];
    for q in queries {
        let took = median(
            |_| {
                l.store.search(&q).unwrap();
            },
            11,
        );
        check(
            &format!("fts {:?}", crate::mail::store::query::fts_expression(&q)),
            took,
            FTS_BUDGET,
        );
    }
}
