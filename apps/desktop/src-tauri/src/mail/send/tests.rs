use super::*;
use crate::mail::invite::parse_invite;
use crate::mail::store::{AccountInput, MailboxInput};

const T0: i64 = 1_800_000_000_000;

#[derive(Default)]
struct Fake {
    smtp: Vec<(String, Vec<String>, Vec<u8>)>,
    graph: Vec<Vec<u8>>,
    appends: Vec<(String, Vec<String>, Vec<u8>)>,
    deletes: Vec<(String, i64)>,
    smtp_fail: Option<SendError>,
    next_uid: i64,
}
impl SendTransport for Fake {
    fn smtp_send(&mut self, _a: &str, from: &str, rcpts: &[String], mime: &[u8]) -> Result<(), SendError> {
        if let Some(e) = &self.smtp_fail {
            return Err(e.clone());
        }
        self.smtp.push((from.into(), rcpts.to_vec(), mime.to_vec()));
        Ok(())
    }
    fn graph_send(&mut self, _a: &str, mime: &[u8]) -> Result<(), SendError> {
        self.graph.push(mime.to_vec());
        Ok(())
    }
    fn append(&mut self, _a: &str, path: &str, flags: &[&str], mime: &[u8]) -> Result<Option<i64>, SendError> {
        self.appends
            .push((path.into(), flags.iter().map(|s| s.to_string()).collect(), mime.to_vec()));
        self.next_uid += 1;
        Ok(Some(self.next_uid))
    }
    fn delete_uid(&mut self, _a: &str, path: &str, uid: i64) -> Result<(), SendError> {
        self.deletes.push((path.into(), uid));
        Ok(())
    }
}

fn store(tag: &str, provider: &str) -> Store {
    let d = std::env::temp_dir().join(format!("moduo-mail-send-{tag}-{}-{}", std::process::id(), now_ms()));
    let _ = std::fs::remove_dir_all(&d);
    let s = Store::open(&d).unwrap();
    s.upsert_account(&AccountInput {
        id: "a".into(),
        address: "me@x.test".into(),
        display_name: "Me".into(),
        provider: provider.into(),
        hue: 1,
    })
    .unwrap();
    for (id, role) in [("sent", MailboxRole::Sent), ("drafts", MailboxRole::Drafts)] {
        s.upsert_mailbox(&MailboxInput {
            id: format!("a-{id}"),
            account_id: "a".into(),
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

fn doc() -> DraftDoc {
    DraftDoc {
        from_addr: "me@x.test".into(),
        to: vec!["Anna <anna@y.test>".into()],
        bcc: vec!["hidden@z.test".into()],
        subject: "Hello".into(),
        text: "Hi Anna".into(),
        in_reply_to: Some("p1@y.test".into()),
        references: vec!["<p0@y.test>".into(), "p1@y.test".into()],
        ..DraftDoc::default()
    }
}

fn s(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

#[test]
fn draft_append_replace() {
    let st = store("drafts", "imap");
    let mut t = Fake::default();
    let id = st.save_draft_at(None, "a", Some("th1"), doc(), T0).unwrap();
    let mid = st.draft(&id).unwrap().unwrap().doc.message_id;
    assert!(mid.starts_with('<') && mid.ends_with("@x.test>"));
    // Inside the debounce: nothing uploads.
    assert!(st.sync_drafts(&mut t, T0 + 1_000).unwrap().uploaded.is_empty());
    // ≤ 3 s after typing stops: uploaded as \Draft.
    assert_eq!(st.sync_drafts(&mut t, T0 + 2_000).unwrap().uploaded, vec![id.clone()]);
    assert_eq!(t.appends[0].0, "DRAFTS");
    assert!(t.appends[0].1.contains(&"\\Draft".to_string()));
    assert!(s(&t.appends[0].2).contains(&mid));
    assert_eq!(st.draft(&id).unwrap().unwrap().server_uid, Some(1));
    // Unchanged: no re-upload.
    assert!(st.sync_drafts(&mut t, T0 + 9_000).unwrap().uploaded.is_empty());
    // An edit keeps the Message-ID, uploads again, deletes the old copy.
    let mut d2 = doc();
    d2.text = "Hi Anna, edited".into();
    st.save_draft_at(Some(&id), "a", Some("th1"), d2, T0 + 10_000).unwrap();
    let r = st.draft(&id).unwrap().unwrap();
    assert_eq!(r.doc.message_id, mid);
    st.sync_drafts(&mut t, T0 + 12_000).unwrap();
    assert_eq!(t.appends.len(), 2);
    assert!(s(&t.appends[1].2).contains("edited"));
    assert_eq!(t.deletes, vec![("DRAFTS".to_string(), 1)]);
    assert_eq!(st.draft(&id).unwrap().unwrap().server_uid, Some(2));
    // Discard deletes the server copy on the next sync.
    assert!(st.discard_draft(&id).unwrap());
    assert!(st.draft(&id).unwrap().is_none());
    let rep = st.sync_drafts(&mut t, T0 + 20_000).unwrap();
    assert_eq!(rep.deleted_server_copies, 1);
    assert_eq!(t.deletes.last(), Some(&("DRAFTS".to_string(), 2)));
    // Persisted: a reopened store still has drafts (restore after restart).
    let id2 = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
    let root = st.root().to_path_buf();
    drop(st);
    assert!(Store::open(&root).unwrap().draft(&id2).unwrap().is_some());
}

#[test]
fn undo_window_cancel() {
    let st = store("undo", "imap");
    let mut t = Fake::default();
    let id = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
    let h = st.queue_send_at(&id, 10, T0).unwrap();
    assert_eq!(h.send_at_ms, T0 + 10_000);
    assert!(st.draft(&id).unwrap().unwrap().queued);
    // A queued draft is never uploaded to Drafts, and can't be discarded.
    assert!(st.sync_drafts(&mut t, T0 + 5_000).unwrap().uploaded.is_empty());
    assert!(st.discard_draft(&id).is_err());
    // Not due yet.
    assert!(st.run_due_sends(&mut t, T0 + 9_999).unwrap().sent.is_empty());
    // Undo / Edit returns the draft, intact.
    assert_eq!(st.undo_send(&h.outbox_id).unwrap(), Some(id.clone()));
    assert!(!st.draft(&id).unwrap().unwrap().queued);
    assert!(st.run_due_sends(&mut t, T0 + 60_000).unwrap().sent.is_empty());
    assert!(t.smtp.is_empty());
    // Undo choices snap to the setting's values.
    assert_eq!(undo_window_ms(30), 30_000);
    assert_eq!(undo_window_ms(7), 10_000);
}

#[test]
fn smtp_send_and_sent_copy() {
    let st = store("sent", "imap");
    let mut t = Fake::default();
    let id = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
    st.sync_drafts(&mut t, T0 + 3_000).unwrap(); // server draft uid 1
    let h = st.queue_send_at(&id, 5, T0 + 4_000).unwrap();
    let rep = st.run_due_sends(&mut t, T0 + 9_000).unwrap();
    assert_eq!(rep.sent, vec![(h.outbox_id, Some(id.clone()))]);
    let (from, rcpts, mime) = &t.smtp[0];
    assert_eq!(from, "me@x.test");
    assert_eq!(rcpts, &vec!["anna@y.test".to_string(), "hidden@z.test".to_string()]);
    let m = s(mime);
    assert!(m.contains("In-Reply-To: <p1@y.test>"));
    assert!(m.contains("References: <p0@y.test> <p1@y.test>"));
    assert!(!m.contains("hidden@z.test"), "Bcc stays out of the headers");
    // One Sent copy, \Seen.
    let sent: Vec<_> = t.appends.iter().filter(|a| a.0 == "SENT").collect();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].1, vec!["\\Seen".to_string()]);
    // The draft is gone, its server copy deleted on the next sync.
    assert!(st.draft(&id).unwrap().is_none());
    st.sync_drafts(&mut t, T0 + 10_000).unwrap();
    assert!(t.deletes.contains(&("DRAFTS".to_string(), 1)));
    assert_eq!(st.unsent_count("a").unwrap(), 0);

    // Gmail and Microsoft save Sent themselves: no APPEND.
    for p in ["gmail", "google_workspace", "outlook"] {
        let st = store(&format!("sent-{p}"), p);
        let mut t = Fake::default();
        let id = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
        st.queue_send_at(&id, 5, T0).unwrap();
        assert_eq!(st.run_due_sends(&mut t, T0 + 5_000).unwrap().sent.len(), 1);
        assert!(t.appends.iter().all(|a| a.0 != "SENT"), "{p}");
    }
}

#[test]
fn offline_outbox_drains() {
    let st = store("offline", "imap");
    let mut t = Fake {
        smtp_fail: Some(SendError::Transient("connection refused".into())),
        ..Fake::default()
    };
    let id = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
    st.queue_send_at(&id, 5, T0).unwrap();
    let rep = st.run_due_sends(&mut t, T0 + 5_000).unwrap();
    assert_eq!(rep.retrying.len(), 1);
    let items = st.outbox_items("").unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].subject, "Hello");
    assert_eq!(items[0].attempts, 1);
    assert_eq!(items[0].last_error.as_deref(), Some("connection refused"));
    assert_eq!(st.unsent_count("a").unwrap(), 1);
    // Back online: wake drains at once, without waiting for the backoff.
    t.smtp_fail = None;
    assert_eq!(st.wake_sends("a", T0 + 5_100).unwrap(), 1);
    let rep = st.run_due_sends(&mut t, T0 + 5_100).unwrap();
    assert_eq!(rep.sent.len(), 1);
    assert_eq!(t.smtp.len(), 1);
    assert!(st.outbox_items("").unwrap().is_empty());
    // A crash mid-send retries the row.
    let id = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
    let h = st.queue_send_at(&id, 5, T0).unwrap();
    st.w()
        .execute("UPDATE outbox SET state = 'in_flight' WHERE id = ?1", [&h.outbox_id])
        .unwrap();
    assert_eq!(st.undo_send(&h.outbox_id).unwrap(), None, "too late to undo");
    st.recover_in_flight_sends().unwrap();
    assert_eq!(st.run_due_sends(&mut t, T0 + 6_000).unwrap().sent.len(), 1);
}

#[test]
fn failure_back_to_drafts() {
    let st = store("fail", "imap");
    let mut t = Fake {
        smtp_fail: Some(SendError::Permanent("550 5.1.1 no such user".into())),
        ..Fake::default()
    };
    let id = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
    st.queue_send_at(&id, 5, T0).unwrap();
    let rep = st.run_due_sends(&mut t, T0 + 5_000).unwrap();
    assert_eq!(rep.failed, vec![(Some(id.clone()), "550 5.1.1 no such user".to_string())]);
    let d = st.draft(&id).unwrap().unwrap();
    assert!(!d.queued);
    assert_eq!(d.doc.last_error.as_deref(), Some("550 5.1.1 no such user"));
    assert!(st.outbox_items("").unwrap().is_empty());

    // Transient for 24 h also gives up into Drafts.
    t.smtp_fail = Some(SendError::Transient("timeout".into()));
    st.queue_send_at(&id, 5, T0).unwrap();
    let rep = st.run_due_sends(&mut t, T0 + SEND_GIVE_UP_MS + 1).unwrap();
    assert_eq!(rep.failed.len(), 1);

    // No recipients / too large are refused before queueing (E45).
    let mut none = doc();
    none.to.clear();
    none.bcc.clear();
    let nid = st.save_draft_at(None, "a", None, none, T0).unwrap();
    assert!(st.queue_send_at(&nid, 5, T0).unwrap_err().to_string().contains("missing_recipients"));
    let icloud = store("big", "icloud");
    let big = staging::stage_bytes(icloud.root(), &vec![7u8; 21 * 1024 * 1024]).unwrap();
    let mut d = doc();
    d.attachments.push(OutAttachment {
        filename: "big.bin".into(),
        content_type: "application/octet-stream".into(),
        id: big,
    });
    let bid = icloud.save_draft_at(None, "a", None, d, T0).unwrap();
    let e = icloud.queue_send_at(&bid, 5, T0).unwrap_err().to_string();
    assert!(e.contains(&format!("too_large:{}", 20 * 1024 * 1024)), "{e}");
}

#[test]
fn graph_send_fallback_on_5_7_139() {
    let st = store("graph", "outlook");
    let mut t = Fake {
        smtp_fail: Some(SendError::Permanent(
            "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled".into(),
        )),
        ..Fake::default()
    };
    let id = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
    st.queue_send_at(&id, 5, T0).unwrap();
    let rep = st.run_due_sends(&mut t, T0 + 5_000).unwrap();
    assert_eq!(rep.sent.len(), 1);
    assert_eq!(rep.via_graph.len(), 1);
    assert_eq!(t.graph.len(), 1);
    assert!(rep.failed.is_empty());
    // Remembered: the next send goes straight to Graph.
    t.smtp_fail = None;
    let id = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
    st.queue_send_at(&id, 5, T0).unwrap();
    st.run_due_sends(&mut t, T0 + 5_000).unwrap();
    assert_eq!(t.graph.len(), 2);
    assert!(t.smtp.is_empty());
    assert_eq!(size_limit(Provider::Outlook, true), 3 * 1024 * 1024);

    // Other providers never fall back.
    let st = store("graph-imap", "imap");
    let mut t = Fake {
        smtp_fail: Some(SendError::Permanent("535 5.7.139".into())),
        ..Fake::default()
    };
    let id = st.save_draft_at(None, "a", None, doc(), T0).unwrap();
    st.queue_send_at(&id, 5, T0).unwrap();
    assert_eq!(st.run_due_sends(&mut t, T0 + 5_000).unwrap().failed.len(), 1);
    assert!(t.graph.is_empty());
}

#[test]
fn rsvp_sends_itip_reply() {
    let ics = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:ev1@y\r\nSUMMARY:Sync\r\nDTSTART:20261110T100000Z\r\nORGANIZER:mailto:anna@y.test\r\nATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@x.test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let inv = parse_invite(ics).unwrap();
    let st = store("rsvp", "imap");
    let mut t = Fake::default();
    let h = st
        .queue_rsvp_at("a", Some("th"), &inv, Rsvp::Accept, Some("Me"), Some("<inv@y>"), T0)
        .unwrap();
    assert_eq!(h.send_at_ms, T0 + 5_000);
    // Never uploaded as a draft.
    assert!(st.sync_drafts(&mut t, T0 + 4_000).unwrap().uploaded.is_empty());
    st.run_due_sends(&mut t, T0 + 5_000).unwrap();
    let (_, rcpts, mime) = &t.smtp[0];
    assert_eq!(rcpts, &vec!["anna@y.test".to_string()]);
    let m = s(mime);
    assert!(m.contains("Subject: Accepted: Sync"));
    assert!(m.contains("text/calendar; method=REPLY"));
    assert!(m.contains("In-Reply-To: <inv@y>"));
}

#[test]
fn mime_never_reads_a_path_outside_staging() {
    let st = store("hostile", "icloud");
    std::fs::write(st.root().join("secret"), b"s").unwrap();
    for bad in ["/etc/passwd", "../secret", "../../../etc/hosts"] {
        let mut d = doc();
        d.attachments.push(OutAttachment {
            filename: "x".into(),
            content_type: "text/plain".into(),
            id: bad.into(),
        });
        let e = mime::build(&d, true, st.root()).unwrap_err();
        assert!(e.starts_with("attachment_unreadable:x:invalid_attachment"), "{e}");
    }
}
