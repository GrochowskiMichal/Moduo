use super::*;
use crate::mail::contracts::{BodyState, MailboxRole, TabKind, FLAG_SEEN};

pub(crate) fn temp_dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!(
        "moduo-mail-store-{tag}-{}-{}",
        std::process::id(),
        now_ms()
    ));
    let _ = std::fs::remove_dir_all(&d);
    d
}

fn store(tag: &str) -> Store {
    let s = Store::open(&temp_dir(tag)).unwrap();
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
        ("sent", MailboxRole::Sent),
        ("archive", MailboxRole::Archive),
    ] {
        s.upsert_mailbox(&MailboxInput {
            id: id.into(),
            account_id: "a1".into(),
            path: id.to_uppercase(),
            name: id.into(),
            role,
            delimiter: Some("/".into()),
            live: true,
        })
        .unwrap();
    }
    s
}

fn msg(ext: &str, mailbox: &str, uid: i64, thread: &str, date: i64, flags: u32) -> MessageInput {
    MessageInput {
        classify: None,
        account_id: "a1".into(),
        ext_id: ext.into(),
        mailbox_id: mailbox.into(),
        uid,
        modseq: None,
        message_id: Some(format!("<{ext}@x>")),
        in_reply_to: None,
        references: vec![],
        thread_id: thread.into(),
        from: Address {
            name: format!("Sender {ext}"),
            email: format!("{ext}@sender.test"),
        },
        to: vec![Address {
            name: "Me".into(),
            email: "me@x.test".into(),
        }],
        cc: vec![],
        subject: format!("Subject {thread}"),
        snippet: format!("snippet {ext}"),
        date_ms: date,
        flags,
        size: 100,
        list_unsubscribe: None,
        list_unsubscribe_post: None,
        precedence: None,
        auto_submitted: None,
        has_invite: false,
        tab: Some(TabRef::of(TabKind::Personal)),
        priority: false,
        attachments: vec![],
    }
}

fn list(s: &Store, view: ViewRef, after: Option<ListCursor>, limit: u32) -> ListPage {
    s.list_threads(&ListInput {
        view,
        tab: Some(TabRef::of(TabKind::Personal)),
        after,
        limit,
    })
    .unwrap()
}

#[test]
fn migrate_is_idempotent() {
    let dir = temp_dir("mig");
    drop(Store::open(&dir).unwrap());
    let s = Store::open(&dir).unwrap();
    let v: u32 = s
        .r()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(v as usize, schema::MIGRATIONS.len());
}

#[test]
fn keyset_pages_cover_every_thread_once_newest_first() {
    let s = store("keyset");
    let batch: Vec<_> = (0..25)
        .map(|i| {
            msg(
                &format!("m{i}"),
                "inbox",
                i,
                &format!("t{i}"),
                1000 + (i / 2),
                FLAG_SEEN,
            )
        })
        .collect();
    s.ingest(&batch).unwrap();
    let mut seen = Vec::new();
    let mut after = None;
    loop {
        let p = list(&s, ViewRef::Mailbox("inbox".into()), after, 10);
        seen.extend(p.rows.iter().map(|r| (r.last_date_ms, r.thread_id.clone())));
        match p.next {
            Some(c) => after = Some(c),
            None => break,
        }
    }
    assert_eq!(seen.len(), 25);
    let mut sorted = seen.clone();
    sorted.sort_by(|a, b| b.cmp(a));
    assert_eq!(seen, sorted);
}

#[test]
fn thread_spans_folders_and_reads_the_same_in_each() {
    let s = store("span");
    s.ingest(&[
        msg("a", "inbox", 1, "t", 10, 0),
        msg("b", "sent", 1, "t", 20, FLAG_SEEN),
    ])
    .unwrap();
    let inbox = list(&s, ViewRef::Unified(MailboxRole::Inbox), None, 10);
    let sent = list(&s, ViewRef::Unified(MailboxRole::Sent), None, 10);
    assert_eq!(inbox.rows.len(), 1);
    assert_eq!(inbox.rows[0], sent.rows[0]);
    assert_eq!(inbox.rows[0].message_count, 2);
    assert_eq!(inbox.rows[0].last_date_ms, 20);
    assert!(inbox.rows[0].unread);
    let t = s.get_thread("t").unwrap().unwrap();
    assert_eq!(
        t.messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        ["a", "b"]
    );
}

#[test]
fn same_message_in_two_mailboxes_is_one_message() {
    let s = store("labels");
    s.ingest(&[
        msg("a", "inbox", 1, "t", 10, 0),
        msg("a", "archive", 7, "t", 10, 0),
    ])
    .unwrap();
    assert_eq!(s.get_thread("t").unwrap().unwrap().messages.len(), 1);
    assert_eq!(
        list(&s, ViewRef::Mailbox("archive".into()), None, 10)
            .rows
            .len(),
        1
    );
}

#[test]
fn pinned_lead_the_first_page_only() {
    let s = store("pin");
    s.ingest(
        &(0..5)
            .map(|i| msg(&format!("m{i}"), "inbox", i, &format!("t{i}"), 100 + i, 0))
            .collect::<Vec<_>>(),
    )
    .unwrap();
    s.set_thread_state("t0", Some(true), None, None).unwrap();
    let p = list(&s, ViewRef::Mailbox("inbox".into()), None, 2);
    assert_eq!(p.rows[0].thread_id, "t0");
    assert!(p.rows[0].pinned);
    let mut all: Vec<_> = p.rows.iter().map(|r| r.thread_id.clone()).collect();
    let mut after = p.next;
    while let Some(c) = after {
        let q = list(&s, ViewRef::Mailbox("inbox".into()), Some(c), 2);
        all.extend(q.rows.iter().map(|r| r.thread_id.clone()));
        after = q.next;
    }
    assert_eq!(all, ["t0", "t4", "t3", "t2", "t1"]);
}

#[test]
fn counts_follow_flags_by_view_key() {
    let s = store("counts");
    s.ingest(&[
        msg("a", "inbox", 1, "t1", 1, 0),
        msg("b", "inbox", 2, "t2", 2, 0),
        msg("c", "inbox", 3, "t3", 3, FLAG_SEEN),
    ])
    .unwrap();
    let c = s.counts().unwrap();
    assert_eq!(c.by_view_key["unified:inbox|personal"], 2);
    assert_eq!(c.by_view_key["mailbox:inbox"], 2);
    assert_eq!(c.badge, 2);
    s.set_flags("inbox", &[(1, FLAG_SEEN, Some(5))]).unwrap();
    assert_eq!(s.counts().unwrap().badge, 1);
    s.set_thread_flag(&["t3".into()], FLAG_SEEN, false).unwrap();
    assert_eq!(s.counts().unwrap().badge, 2);
    let mbs = s.list_mailboxes("a1").unwrap();
    let inbox = mbs.iter().find(|m| m.id == "inbox").unwrap();
    assert_eq!((inbox.unread, inbox.total), (2, 3));
}

#[test]
fn expunge_drops_rows_and_orphans() {
    let s = store("expunge");
    s.ingest(&[
        msg("a", "inbox", 1, "t", 1, 0),
        msg("b", "inbox", 2, "t", 2, 0),
    ])
    .unwrap();
    s.remove_uids("inbox", &[2]).unwrap();
    assert_eq!(s.get_thread("t").unwrap().unwrap().messages.len(), 1);
    s.remove_uids("inbox", &[1]).unwrap();
    assert!(s.get_thread("t").unwrap().is_none());
    assert!(s
        .search(&SearchQuery {
            words: vec!["Subject".into()],
            limit: 10,
            ..Default::default()
        })
        .unwrap()
        .is_empty());
}

#[test]
fn uidvalidity_reset_clears_mailbox() {
    let s = store("reset");
    s.ingest(&[
        msg("a", "inbox", 1, "t", 1, 0),
        msg("a", "archive", 9, "t", 1, 0),
    ])
    .unwrap();
    s.set_mailbox_cursor(
        "inbox",
        &MailboxCursor {
            uidvalidity: Some(1),
            uidnext: Some(2),
            ..Default::default()
        },
    )
    .unwrap();
    s.reset_mailbox("inbox", 2).unwrap();
    assert!(list(&s, ViewRef::Mailbox("inbox".into()), None, 10)
        .rows
        .is_empty());
    assert_eq!(
        list(&s, ViewRef::Mailbox("archive".into()), None, 10)
            .rows
            .len(),
        1
    );
    let c = s.mailbox_cursor("inbox").unwrap().unwrap();
    assert_eq!((c.uidvalidity, c.uidnext), (Some(2), None));
}

#[test]
fn local_move_hides_from_source_and_shows_in_target() {
    let s = store("move");
    s.ingest(&[msg("a", "inbox", 1, "t", 1, 0)]).unwrap();
    s.move_thread_local("t", "inbox", Some("archive")).unwrap();
    assert!(list(&s, ViewRef::Mailbox("inbox".into()), None, 10)
        .rows
        .is_empty());
    assert_eq!(
        list(&s, ViewRef::Mailbox("archive".into()), None, 10)
            .rows
            .len(),
        1
    );
}

#[test]
fn search_words_operators_and_bodies() {
    let s = store("search");
    let mut a = msg("a", "inbox", 1, "t1", 10, 0);
    a.subject = "Quarterly invoice".into();
    a.attachments.push(AttachmentInput {
        part_id: "2".into(),
        filename: "budget-2026.xlsx".into(),
        mime: "application/vnd.ms-excel".into(),
        size: 10,
        is_inline: false,
        content_id: None,
    });
    let mut b = msg("b", "sent", 1, "t2", 20, FLAG_SEEN);
    b.subject = "Lunch".into();
    s.ingest(&[a, b]).unwrap();
    let ids = |q: SearchQuery| {
        s.search(&SearchQuery { limit: 10, ..q })
            .unwrap()
            .into_iter()
            .map(|r| r.thread_id)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        ids(SearchQuery {
            words: vec!["quart".into()],
            ..Default::default()
        }),
        ["t1"]
    );
    assert_eq!(
        ids(SearchQuery {
            words: vec!["budget".into()],
            ..Default::default()
        }),
        ["t1"]
    );
    assert_eq!(
        ids(SearchQuery {
            from: vec!["b@sender.test".into()],
            ..Default::default()
        }),
        ["t2"]
    );
    assert_eq!(
        ids(SearchQuery {
            has_attachment: true,
            ..Default::default()
        }),
        ["t1"]
    );
    assert_eq!(
        ids(SearchQuery {
            is_unread: true,
            ..Default::default()
        }),
        ["t1"]
    );
    assert_eq!(
        ids(SearchQuery {
            in_role: Some(MailboxRole::Sent),
            ..Default::default()
        }),
        ["t2"]
    );
    assert_eq!(
        ids(SearchQuery {
            after_ms: Some(15),
            ..Default::default()
        }),
        ["t2"]
    );
    // FTS syntax in user text is inert.
    assert!(ids(SearchQuery {
        words: vec!["\" OR * NEAR(".into()],
        ..Default::default()
    })
    .is_empty());
    s.put_body(
        "a1",
        "b",
        &BodyInput {
            html: None,
            text: Some("see you at the pizzeria".into()),
            quote_offset: None,
            tracker_count: 0,
            state: BodyState::Full,
        },
    )
    .unwrap();
    assert_eq!(
        ids(SearchQuery {
            words: vec!["pizzeria".into()],
            ..Default::default()
        }),
        ["t2"]
    );
    let t = s.get_thread("t2").unwrap().unwrap();
    assert_eq!(
        t.messages[0].text.as_deref(),
        Some("see you at the pizzeria")
    );
    assert_eq!(t.messages[0].body_state, BodyState::Full);
    assert_eq!(
        s.get_thread("t1").unwrap().unwrap().messages[0].attachments[0].filename,
        "budget-2026.xlsx"
    );
}

#[test]
fn storage_stats_split_mail_and_attachments_and_disconnect_purges() {
    let s = store("stats");
    let mut a = msg("a", "inbox", 1, "t", 1, 0);
    a.attachments.push(AttachmentInput {
        part_id: "2".into(),
        filename: "f.pdf".into(),
        mime: "application/pdf".into(),
        size: 4,
        is_inline: false,
        content_id: None,
    });
    s.ingest(&[a]).unwrap();
    s.put_body(
        "a1",
        "a",
        &BodyInput {
            html: Some("<p>hi</p>".into()),
            text: Some("hi".into()),
            quote_offset: None,
            tracker_count: 0,
            state: BodyState::Full,
        },
    )
    .unwrap();
    let att_id: i64 = s
        .r()
        .query_row("SELECT id FROM attachments", [], |r| r.get(0))
        .unwrap();
    s.put_attachment_bytes(att_id, b"%PDF").unwrap();
    let path = s.attachment_path(att_id).unwrap().unwrap();
    assert!(path.exists());
    let st = &s.storage_stats().unwrap()[0];
    assert_eq!(
        (st.mail_bytes, st.attachment_bytes, st.message_count),
        (11, 4, 1)
    );
    s.delete_account("a1").unwrap();
    assert!(!path.exists());
    assert!(s.storage_stats().unwrap().is_empty());
    assert!(s.get_thread("t").unwrap().is_none());
    let fts: i64 = s
        .r()
        .query_row("SELECT COUNT(*) FROM messages_fts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fts, 0);
}

#[test]
fn user_dir_rejects_traversal() {
    assert!(Store::user_dir(std::path::Path::new("/x"), "../etc").is_err());
    assert!(Store::user_dir(std::path::Path::new("/x"), "abc-123").is_ok());
}

fn queued_send(s: &Store, thread: Option<&str>, now: i64) -> String {
    let doc = crate::mail::send::DraftDoc {
        from_addr: "me@x.test".into(),
        to: vec!["ana@y.test".into()],
        subject: "Pilot terms".into(),
        text: "Signed.".into(),
        ..Default::default()
    };
    let id = s.save_draft_at(None, "a1", thread, doc, now).unwrap();
    s.queue_send_at(&id, 5, now).unwrap().outbox_id
}

#[test]
fn counts_include_outbox() {
    let s = store("counts-outbox");
    assert_eq!(s.counts().unwrap().outbox, 0);
    let o1 = queued_send(&s, None, 1_000);
    queued_send(&s, None, 2_000);
    assert_eq!(s.counts().unwrap().outbox, 2);
    s.undo_send(&o1).unwrap();
    assert_eq!(s.counts().unwrap().outbox, 1);
    let v = serde_json::to_value(s.counts().unwrap()).unwrap();
    assert_eq!(v["outbox"], 1);
}

#[test]
fn thread_row_flags() {
    use crate::mail::contracts::OpKind;
    use crate::mail::ops::OpRequest;
    let s = store("row-flags");
    s.ingest(&[
        msg("f1", "inbox", 1, "follow", 1_000, FLAG_SEEN),
        msg("r1", "inbox", 2, "reply", 2_000, FLAG_SEEN),
        msg("s1", "inbox", 3, "snooze", 3_000, FLAG_SEEN),
        msg("o1", "inbox", 4, "out", 4_000, FLAG_SEEN),
    ])
    .unwrap();
    let row = |id: &str| -> ThreadRow {
        list(&s, ViewRef::Unified(MailboxRole::Inbox), None, 50)
            .rows
            .into_iter()
            .find(|r| r.thread_id == id)
            .unwrap_or_else(|| panic!("no row {id}"))
    };
    // Follow-up: the armed due time.
    s.set_follow_up("follow", Some(99_000), 5_000).unwrap();
    assert_eq!(row("follow").follow_up_at_ms, Some(99_000));
    assert_eq!(row("reply").follow_up_at_ms, None);
    // A snooze that a reply woke reads "reply"; one that ran out reads "snooze".
    let snooze = |t: &str| {
        let mut r = OpRequest::new(OpKind::Snooze, vec![t.into()]);
        r.snooze_until_ms = Some(50_000);
        s.enqueue_op_at(&r, 6_000).unwrap();
    };
    snooze("reply");
    snooze("snooze");
    s.ingest(&[msg("r2", "inbox", 5, "reply", 7_000, 0)])
        .unwrap();
    for t in ["reply", "snooze"] {
        assert_eq!(row(t).return_reason, None, "still snoozed");
        s.enqueue_op_at(&OpRequest::new(OpKind::Unsnooze, vec![t.into()]), 8_000)
            .unwrap();
    }
    assert_eq!(row("reply").return_reason.as_deref(), Some("reply"));
    assert_eq!(row("snooze").return_reason.as_deref(), Some("snooze"));
    // Unsnoozing a thread that was never snoozed says nothing.
    s.enqueue_op_at(
        &OpRequest::new(OpKind::Unsnooze, vec!["follow".into()]),
        8_000,
    )
    .unwrap();
    assert_eq!(row("follow").return_reason, None);
    // Done clears it (the row leaves the Inbox; read it from Archive).
    s.enqueue_op_at(&OpRequest::new(OpKind::Done, vec!["snooze".into()]), 9_000)
        .unwrap();
    let archived = list(&s, ViewRef::Unified(MailboxRole::Archive), None, 50).rows;
    assert_eq!(archived[0].thread_id, "snooze");
    assert_eq!(archived[0].return_reason, None);
    // A send waiting in the Outbox for this thread.
    assert_eq!(row("out").outbox_state, None);
    queued_send(&s, Some("out"), 10_000);
    assert_eq!(row("out").outbox_state.as_deref(), Some("pending"));
    s.w()
        .execute("UPDATE outbox SET state = 'in_flight'", [])
        .unwrap();
    assert_eq!(row("out").outbox_state.as_deref(), Some("in_flight"));
    // The thread load and search carry the same flags.
    assert_eq!(
        s.get_thread("follow").unwrap().unwrap().row.follow_up_at_ms,
        Some(99_000)
    );
    let v = serde_json::to_value(row("reply")).unwrap();
    assert_eq!(v["returnReason"], "reply");
    assert!(v.get("followUpAtMs").is_some() && v.get("outboxState").is_some());
}
