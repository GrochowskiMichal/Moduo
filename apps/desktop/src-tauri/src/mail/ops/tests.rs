use super::*;
use crate::mail::contracts::{MailboxRole, OpKind, OpState, TabKind, FLAG_SEEN};
use crate::mail::store::{
    AccountInput, Address, ListInput, MailboxCursor, MailboxInput, MessageInput, Store, TabRef,
    ViewRef,
};

const T0: i64 = 1_000_000_000;

#[derive(Default)]
struct FakeServer {
    calls: Vec<(String, ResolvedStep)>,
    fail: Option<OpError>,
}
impl OpServer for FakeServer {
    fn run(&mut self, account_id: &str, step: &ResolvedStep) -> Result<(), OpError> {
        if let Some(e) = &self.fail {
            return Err(e.clone());
        }
        self.calls.push((account_id.to_string(), step.clone()));
        Ok(())
    }
}

fn dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!(
        "moduo-mail-ops-{tag}-{}-{}",
        std::process::id(),
        now_ms()
    ));
    let _ = std::fs::remove_dir_all(&d);
    d
}

fn account(s: &Store, a: &str) {
    s.upsert_account(&AccountInput {
        id: a.into(),
        address: format!("me@{a}.test"),
        display_name: "Me".into(),
        provider: "imap".into(),
        hue: 1,
    })
    .unwrap();
    for (id, role) in [
        ("inbox", MailboxRole::Inbox),
        ("archive", MailboxRole::Archive),
        ("trash", MailboxRole::Trash),
        ("spam", MailboxRole::Spam),
    ] {
        let mid = format!("{a}-{id}");
        s.upsert_mailbox(&MailboxInput {
            id: mid.clone(),
            account_id: a.into(),
            path: id.to_uppercase(),
            name: id.into(),
            role,
            delimiter: Some("/".into()),
            live: true,
        })
        .unwrap();
        s.set_mailbox_cursor(
            &mid,
            &MailboxCursor {
                uidvalidity: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
    }
}

fn open(d: &std::path::Path) -> Store {
    let s = Store::open(d).unwrap();
    account(&s, "a1");
    account(&s, "a2");
    s
}

fn msg(a: &str, ext: &str, mb: &str, uid: i64, thread: &str, date: i64, flags: u32) -> MessageInput {
    MessageInput {
        classify: None,
        account_id: a.into(),
        ext_id: ext.into(),
        mailbox_id: format!("{a}-{mb}"),
        uid,
        modseq: None,
        message_id: Some(format!("<{ext}@x>")),
        in_reply_to: None,
        references: vec![],
        thread_id: thread.into(),
        from: Address {
            name: "S".into(),
            email: "s@x.test".into(),
        },
        to: vec![],
        cc: vec![],
        subject: format!("Subject {thread}"),
        snippet: String::new(),
        date_ms: date,
        flags,
        size: 1,
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

fn ids(s: &Store, view: ViewRef) -> Vec<String> {
    let mut v: Vec<String> = s
        .list_threads(&ListInput {
            view,
            tab: None,
            after: None,
            limit: 100,
        })
        .unwrap()
        .rows
        .into_iter()
        .map(|r| r.thread_id)
        .collect();
    v.sort();
    v
}
fn inbox(s: &Store, a: &str) -> Vec<String> {
    ids(s, ViewRef::Mailbox(format!("{a}-inbox")))
}
fn archive(s: &Store, a: &str) -> Vec<String> {
    ids(s, ViewRef::Mailbox(format!("{a}-archive")))
}

fn seeded(tag: &str) -> (std::path::PathBuf, Store) {
    let d = dir(tag);
    let s = open(&d);
    s.ingest(&[
        msg("a1", "m1", "inbox", 10, "t1", 100, 0),
        msg("a1", "m2", "inbox", 11, "t1", 200, FLAG_SEEN),
        msg("a1", "m3", "inbox", 12, "t2", 300, 0),
    ])
    .unwrap();
    (d, s)
}

fn done(s: &Store, t: &str) -> ActionHandle {
    s.enqueue_op_at(&OpRequest::new(OpKind::Done, vec![t.into()]), T0)
        .unwrap()
}

#[test]
fn undo_inside_window_cancels() {
    let (_d, s) = seeded("cancel");
    let before = s.get_thread("t1").unwrap();
    let h = done(&s, "t1");
    assert_eq!(h.undo_until_ms, T0 + UNDO_WINDOW_MS);
    assert_eq!(inbox(&s, "a1"), vec!["t2"]);
    assert_eq!(archive(&s, "a1"), vec!["t1"]);
    assert_eq!(s.undo_action_at(&h.action_id, T0 + 3_000).unwrap(), UndoOutcome::Cancelled);
    assert_eq!(inbox(&s, "a1"), vec!["t1", "t2"]);
    assert!(archive(&s, "a1").is_empty());
    assert_eq!(s.get_thread("t1").unwrap(), before);
    assert!(s.op(&h.op_ids[0]).unwrap().is_none());
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + 60_000).unwrap();
    assert!(srv.calls.is_empty(), "a cancelled op never reaches the server");
}

#[test]
fn op_waits_out_the_window() {
    let (_d, s) = seeded("window");
    let h = done(&s, "t1");
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + UNDO_WINDOW_MS - 1).unwrap();
    assert!(srv.calls.is_empty());
    let r = s.run_due_ops(&mut srv, T0 + UNDO_WINDOW_MS).unwrap();
    assert_eq!(r.done, h.op_ids);
    assert_eq!(srv.calls.len(), 1);
    let step = &srv.calls[0].1;
    assert_eq!(step.mailbox_path, "INBOX");
    assert_eq!(step.uids, vec![10, 11]);
    assert_eq!(
        step.action,
        StepAction::MoveTo {
            mailbox_id: "a1-archive".into(),
            path: "ARCHIVE".into()
        }
    );
}

#[test]
fn reload_inside_window_keeps_hidden() {
    let (d, s) = seeded("reload");
    let h = done(&s, "t1");
    drop(s);
    let s = Store::open(&d).unwrap();
    assert_eq!(inbox(&s, "a1"), vec!["t2"]);
    // A sync round still sees t1 in the server's INBOX.
    s.ingest(&[
        msg("a1", "m1", "inbox", 10, "t1", 100, 0),
        msg("a1", "m2", "inbox", 11, "t1", 200, FLAG_SEEN),
    ])
    .unwrap();
    s.reapply_pending_ops().unwrap();
    assert_eq!(inbox(&s, "a1"), vec!["t2"]);
    assert_eq!(s.undo_action_at(&h.action_id, T0 + 5_000).unwrap(), UndoOutcome::Cancelled);
    assert_eq!(inbox(&s, "a1"), vec!["t1", "t2"]);
    assert!(archive(&s, "a1").is_empty(), "undo restores exactly one copy");
    assert_eq!(s.get_thread("t1").unwrap().unwrap().messages.len(), 2);
}

#[test]
fn compensate_after_flush() {
    let (_d, s) = seeded("comp");
    let h = done(&s, "t1");
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    let UndoOutcome::Compensated(c) = s.undo_action_at(&h.action_id, T0 + 20_000).unwrap() else {
        panic!("expected a compensating op");
    };
    assert_eq!(inbox(&s, "a1"), vec!["t1", "t2"]);
    let row = s.op(&c.op_ids[0]).unwrap().unwrap();
    assert_eq!(row.kind, OpKind::Undone);
    // The server's archive copies get new UIDs, learned by the next sync.
    let r = s.run_due_ops(&mut srv, T0 + 20_000).unwrap();
    assert_eq!(r.retrying, c.op_ids, "waits for the server copy {r:?} {:?}", s.op(&c.op_ids[0]));
    s.ingest(&[
        msg("a1", "m1", "archive", 500, "t1", 100, 0),
        msg("a1", "m2", "archive", 501, "t1", 200, FLAG_SEEN),
    ])
    .unwrap();
    s.reapply_pending_ops().unwrap();
    assert!(archive(&s, "a1").is_empty());
    let r = s.run_due_ops(&mut srv, T0 + 60_000).unwrap();
    assert_eq!(r.done, c.op_ids);
    let back = &srv.calls.last().unwrap().1;
    assert_eq!(back.mailbox_path, "ARCHIVE");
    assert_eq!(back.uids, vec![500, 501]);
    assert!(matches!(&back.action, StepAction::MoveTo { path, .. } if path == "INBOX"));
}

#[test]
fn failure_never_dropped() {
    let (_d, s) = seeded("fail");
    let h = done(&s, "t1");
    let mut srv = FakeServer {
        fail: Some(OpError::Transient("offline".into())),
        ..Default::default()
    };
    let mut now = T0 + UNDO_WINDOW_MS;
    let mut last = Vec::new();
    for _ in 0..2_000 {
        let r = s.run_due_ops(&mut srv, now).unwrap();
        if !r.failed.is_empty() {
            last = r.failed;
            break;
        }
        let row = s.op(&h.op_ids[0]).unwrap().unwrap();
        assert!(row.not_before_ms - now <= MAX_BACKOFF_MS);
        now = row.not_before_ms;
    }
    assert_eq!(last, h.op_ids);
    assert!(now - T0 >= GIVE_UP_AFTER_MS);
    let f = s.failed_ops().unwrap();
    assert_eq!(f.len(), 1);
    assert_eq!(f[0].error, "offline");
    assert_eq!(f[0].thread_ids, vec!["t1"]);
    // Still failed later: never dropped.
    s.run_due_ops(&mut srv, now + GIVE_UP_AFTER_MS * 3).unwrap();
    assert_eq!(s.failed_ops().unwrap().len(), 1);
}

#[test]
fn permanent_error_fails_at_once_and_retry_requeues() {
    let (_d, s) = seeded("perm");
    let h = done(&s, "t1");
    let mut srv = FakeServer {
        fail: Some(OpError::Permanent("NO [TRYCREATE]".into())),
        ..Default::default()
    };
    let r = s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert_eq!(r.failed, h.op_ids);
    assert!(s.retry_op(&h.op_ids[0], T0 + 10_000).unwrap());
    srv.fail = None;
    let r = s.run_due_ops(&mut srv, T0 + 10_000).unwrap();
    assert_eq!(r.done, h.op_ids);
    assert!(s.failed_ops().unwrap().is_empty());
}

#[test]
fn discard_restores_server_state() {
    let (_d, s) = seeded("discard");
    let h = done(&s, "t1");
    let mut srv = FakeServer {
        fail: Some(OpError::Permanent("refused".into())),
        ..Default::default()
    };
    s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert_eq!(inbox(&s, "a1"), vec!["t2"]);
    assert!(s.discard_op(&h.op_ids[0]).unwrap());
    assert_eq!(inbox(&s, "a1"), vec!["t1", "t2"]);
    assert!(archive(&s, "a1").is_empty());
    assert!(s.failed_ops().unwrap().is_empty());
}

#[test]
fn uid_validity_change_retargets_by_message_id() {
    let (_d, s) = seeded("retarget");
    let h = done(&s, "t1");
    s.reset_mailbox("a1-inbox", 2).unwrap();
    s.ingest(&[
        msg("a1", "m1", "inbox", 70, "t1", 100, 0),
        msg("a1", "m2", "inbox", 71, "t1", 200, FLAG_SEEN),
        msg("a1", "m3", "inbox", 72, "t2", 300, 0),
    ])
    .unwrap();
    assert!(s.retarget_ops("a1-inbox").unwrap().is_empty());
    s.reapply_pending_ops().unwrap();
    assert_eq!(inbox(&s, "a1"), vec!["t2"]);
    let mut srv = FakeServer::default();
    let r = s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert_eq!(r.done, h.op_ids);
    assert_eq!(srv.calls[0].1.uids, vec![70, 71]);
    assert_eq!(srv.calls[0].1.uidvalidity, Some(2));
}

#[test]
fn uid_validity_change_without_the_message_fails_with_reason() {
    let (_d, s) = seeded("retarget-miss");
    let h = done(&s, "t1");
    s.reset_mailbox("a1-inbox", 2).unwrap();
    s.ingest(&[msg("a1", "m3", "inbox", 72, "t2", 300, 0)]).unwrap();
    assert_eq!(s.retarget_ops("a1-inbox").unwrap(), h.op_ids);
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert!(srv.calls.is_empty(), "never applied to the wrong message");
    let f = s.failed_ops().unwrap();
    assert!(f[0].error.contains("rebuilt"), "{}", f[0].error);
}

fn with_rfc(mut m: MessageInput, rfc: &str) -> MessageInput {
    m.message_id = Some(rfc.into());
    m
}

#[test]
fn retarget_prefers_exact_message_over_message_id_twin() {
    let (_d, s) = seeded("retarget-exact");
    let h = done(&s, "t1");
    s.reset_mailbox("a1-inbox", 2).unwrap();
    s.ingest(&[
        msg("a1", "m1", "inbox", 70, "t1", 100, 0),
        msg("a1", "m2", "inbox", 71, "t1", 200, FLAG_SEEN),
        // A different message reusing m1's Message-ID at a higher UID.
        with_rfc(msg("a1", "twin", "inbox", 90, "t9", 400, 0), "<m1@x>"),
    ])
    .unwrap();
    assert!(s.retarget_ops("a1-inbox").unwrap().is_empty());
    let mut srv = FakeServer::default();
    let r = s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert_eq!(r.done, h.op_ids);
    assert_eq!(srv.calls[0].1.uids, vec![70, 71], "never the twin's UID");
}

#[test]
fn retarget_refuses_ambiguous_message_id() {
    let (_d, s) = seeded("retarget-ambiguous");
    let h = done(&s, "t1");
    s.reset_mailbox("a1-inbox", 2).unwrap();
    s.ingest(&[
        with_rfc(msg("a1", "x1", "inbox", 80, "t8", 100, 0), "<m1@x>"),
        with_rfc(msg("a1", "x2", "inbox", 81, "t8", 110, 0), "<m1@x>"),
        msg("a1", "m2", "inbox", 71, "t1", 200, FLAG_SEEN),
        msg("a1", "m3", "inbox", 72, "t2", 300, 0),
    ])
    .unwrap();
    assert_eq!(s.retarget_ops("a1-inbox").unwrap(), h.op_ids);
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert!(srv.calls.is_empty(), "never applied to a guessed message");
    let f = s.failed_ops().unwrap();
    assert!(f[0].error.contains("more than one"), "{}", f[0].error);
}

#[test]
fn retarget_fails_when_any_target_is_missing() {
    let (_d, s) = seeded("retarget-partial");
    let h = done(&s, "t1");
    s.reset_mailbox("a1-inbox", 2).unwrap();
    // m1 came back, m2 did not: no stale UID may be kept for m2.
    s.ingest(&[msg("a1", "m1", "inbox", 70, "t1", 100, 0)]).unwrap();
    assert_eq!(s.retarget_ops("a1-inbox").unwrap(), h.op_ids);
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert!(srv.calls.is_empty());
    assert_eq!(s.failed_ops().unwrap().len(), 1);
}

#[test]
fn bulk_done_across_accounts_is_one_undo() {
    let (_d, s) = seeded("bulk");
    s.ingest(&[msg("a2", "n1", "inbox", 5, "u1", 400, 0)]).unwrap();
    let h = s
        .enqueue_op_at(
            &OpRequest::new(OpKind::Done, vec!["t1".into(), "t2".into(), "u1".into()]),
            T0,
        )
        .unwrap();
    assert_eq!(h.op_ids.len(), 2, "one row per account");
    assert!(inbox(&s, "a1").is_empty() && inbox(&s, "a2").is_empty());
    assert_eq!(s.undo_action_at(&h.action_id, T0 + 1).unwrap(), UndoOutcome::Cancelled);
    assert_eq!(inbox(&s, "a1"), vec!["t1", "t2"]);
    assert_eq!(inbox(&s, "a2"), vec!["u1"]);
}

#[test]
fn get_me_to_zero_picks_only_older_threads() {
    let (_d, s) = seeded("zero");
    let h = s
        .zero_out_older(&ViewRef::Unified(MailboxRole::Inbox), None, 250, T0)
        .unwrap()
        .unwrap();
    assert_eq!(inbox(&s, "a1"), vec!["t2"]);
    s.undo_action_at(&h.action_id, T0 + 1).unwrap();
    assert_eq!(inbox(&s, "a1"), vec!["t1", "t2"]);
    assert!(s
        .zero_out_older(&ViewRef::Unified(MailboxRole::Inbox), None, 50, T0)
        .unwrap()
        .is_none());
}

#[test]
fn mark_read_touches_only_unread_and_undo_restores_flags() {
    let (_d, s) = seeded("read");
    let h = s
        .enqueue_op_at(&OpRequest::new(OpKind::MarkRead, vec!["t1".into()]), T0)
        .unwrap();
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert_eq!(srv.calls[0].1.uids, vec![10]);
    assert_eq!(srv.calls[0].1.action, StepAction::AddFlags { bits: FLAG_SEEN });
    let UndoOutcome::Compensated(c) = s.undo_action_at(&h.action_id, T0 + 10_000).unwrap() else {
        panic!()
    };
    s.run_due_ops(&mut srv, T0 + 10_000).unwrap();
    assert_eq!(s.op(&c.op_ids[0]).unwrap().unwrap().state, OpState::Done);
    let last = &srv.calls.last().unwrap().1;
    assert_eq!(last.uids, vec![10], "m2 was already read and stays read");
    assert_eq!(last.action, StepAction::RemoveFlags { bits: FLAG_SEEN });
    let t = s.get_thread("t1").unwrap().unwrap();
    assert_eq!(t.messages.iter().filter(|m| !m.unread).count(), 1);
}

#[test]
fn pin_and_snooze_are_local_and_undoable() {
    let (_d, s) = seeded("pin");
    let p = s
        .enqueue_op_at(&OpRequest::new(OpKind::Pin, vec!["t2".into()]), T0)
        .unwrap();
    let mut req = OpRequest::new(OpKind::Snooze, vec!["t1".into()]);
    req.snooze_until_ms = Some(T0 + 3_600_000);
    s.enqueue_op_at(&req, T0).unwrap();
    assert_eq!(ids(&s, ViewRef::Snoozed), vec!["t1"]);
    let mut srv = FakeServer::default();
    let r = s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert_eq!(r.done.len(), 2);
    assert!(srv.calls.is_empty());
    s.undo_action_at(&p.action_id, T0 + 10_000).unwrap();
    s.run_due_ops(&mut srv, T0 + 10_000).unwrap();
    let rows = s
        .list_threads(&ListInput {
            view: ViewRef::Mailbox("a1-inbox".into()),
            tab: None,
            after: None,
            limit: 10,
        })
        .unwrap()
        .rows;
    assert!(rows.iter().all(|r| !r.pinned));
}

#[test]
fn delete_and_spam_move_out_of_every_folder() {
    let (_d, s) = seeded("delete");
    s.ingest(&[msg("a1", "m1", "archive", 90, "t1", 100, 0)]).unwrap();
    s.enqueue_op_at(&OpRequest::new(OpKind::Delete, vec!["t1".into()]), T0)
        .unwrap();
    assert_eq!(inbox(&s, "a1"), vec!["t2"]);
    assert!(archive(&s, "a1").is_empty());
    assert_eq!(ids(&s, ViewRef::Mailbox("a1-trash".into())), vec!["t1"]);
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    let paths: Vec<_> = srv.calls.iter().map(|c| c.1.mailbox_path.clone()).collect();
    assert_eq!(paths, vec!["ARCHIVE", "INBOX"]);
    s.enqueue_op_at(&OpRequest::new(OpKind::Spam, vec!["t2".into()]), T0)
        .unwrap();
    assert!(inbox(&s, "a1").is_empty());
    assert_eq!(ids(&s, ViewRef::Mailbox("a1-spam".into())), vec!["t2"]);
}

#[test]
fn backoff_caps_at_five_minutes() {
    assert_eq!(backoff_ms(1), 2_000);
    assert_eq!(backoff_ms(2), 4_000);
    assert_eq!(backoff_ms(50), MAX_BACKOFF_MS);
}

fn gmail(tag: &str) -> (std::path::PathBuf, Store) {
    let d = dir(tag);
    let s = Store::open(&d).unwrap();
    s.upsert_account(&AccountInput {
        id: "g".into(),
        address: "me@gmail.com".into(),
        display_name: "Me".into(),
        provider: "gmail".into(),
        hue: 1,
    })
    .unwrap();
    for (id, path, role) in [
        ("inbox", "INBOX", MailboxRole::Inbox),
        ("all", "[Gmail]/All Mail", MailboxRole::All),
        ("work", "Work", MailboxRole::Custom),
    ] {
        let mid = format!("g-{id}");
        s.upsert_mailbox(&MailboxInput {
            id: mid.clone(),
            account_id: "g".into(),
            path: path.into(),
            name: id.into(),
            role,
            delimiter: Some("/".into()),
            live: true,
        })
        .unwrap();
        s.set_mailbox_cursor(
            &mid,
            &MailboxCursor {
                uidvalidity: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
    }
    s.ingest(&[
        msg("g", "m1", "inbox", 10, "t1", 100, 0),
        msg("g", "m1", "all", 100, "t1", 100, 0),
    ])
    .unwrap();
    (d, s)
}

fn label_req(kind: OpKind) -> OpRequest {
    let mut r = OpRequest::new(kind, vec!["t1".into()]);
    r.to_mailbox_id = Some("g-work".into());
    r
}

#[test]
fn gmail_label_add_copies_from_all_mail_once() {
    let (_d, s) = gmail("label-add");
    s.enqueue_op_at(&label_req(OpKind::LabelAdd), T0).unwrap();
    assert_eq!(ids(&s, ViewRef::Mailbox("g-work".into())), vec!["t1"]);
    assert_eq!(ids(&s, ViewRef::Mailbox("g-inbox".into())), vec!["t1"], "a label keeps the inbox");
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    assert_eq!(srv.calls.len(), 1);
    let step = &srv.calls[0].1;
    assert_eq!(step.mailbox_path, "[Gmail]/All Mail");
    assert_eq!(step.uids, vec![100]);
    assert!(matches!(&step.action, StepAction::CopyTo { path, .. } if path == "Work"));
}

#[test]
fn gmail_label_remove_moves_to_all_mail_and_undo_copies_back() {
    let (_d, s) = gmail("label-rm");
    s.ingest(&[msg("g", "m1", "work", 7, "t1", 100, 0)]).unwrap();
    let h = s.enqueue_op_at(&label_req(OpKind::LabelRemove), T0).unwrap();
    assert!(ids(&s, ViewRef::Mailbox("g-work".into())).is_empty());
    assert_eq!(ids(&s, ViewRef::Mailbox("g-inbox".into())), vec!["t1"]);
    let mut srv = FakeServer::default();
    s.run_due_ops(&mut srv, T0 + 9_000).unwrap();
    let step = &srv.calls[0].1;
    assert_eq!((step.mailbox_path.as_str(), step.uids.clone()), ("Work", vec![7]));
    assert!(matches!(&step.action, StepAction::MoveTo { path, .. } if path == "[Gmail]/All Mail"));
    let UndoOutcome::Compensated(c) = s.undo_action_at(&h.action_id, T0 + 20_000).unwrap() else {
        panic!("expected a compensating op");
    };
    assert_eq!(s.op(&c.op_ids[0]).unwrap().unwrap().kind, OpKind::LabelAdd);
    s.run_due_ops(&mut srv, T0 + 30_000).unwrap();
    let back = &srv.calls.last().unwrap().1;
    assert_eq!(back.mailbox_path, "[Gmail]/All Mail");
    // Never expunge from All Mail (that deletes on Gmail): re-adding is a COPY.
    assert!(matches!(&back.action, StepAction::CopyTo { path, .. } if path == "Work"), "{back:?}");
}

#[test]
fn labels_need_gmail_and_a_label_folder() {
    let (_d, s) = seeded("label-imap");
    let mut r = OpRequest::new(OpKind::LabelAdd, vec!["t1".into()]);
    r.to_mailbox_id = Some("a1-archive".into());
    assert!(s.enqueue_op_at(&r, T0).is_err());
    let (_d2, g) = gmail("label-none");
    assert!(g.enqueue_op_at(&OpRequest::new(OpKind::LabelAdd, vec!["t1".into()]), T0).is_err());
    let mut bad = label_req(OpKind::LabelAdd);
    bad.to_mailbox_id = Some("g-inbox".into());
    assert!(g.enqueue_op_at(&bad, T0).is_err(), "a system folder is not a label");
}
