use super::*;
use crate::mail::contracts::MailboxRole;
use crate::mail::store::*;

pub(super) fn store(tag: &str) -> Store {
    let d = std::env::temp_dir().join(format!(
        "moduo-mail-reader-{tag}-{}-{}",
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
    for (id, role) in [("inbox", MailboxRole::Inbox), ("sent", MailboxRole::Sent)] {
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

pub(super) fn msg(ext: &str, mailbox: &str, thread: &str, from: &str, date: i64) -> MessageInput {
    MessageInput {
        classify: None,
        account_id: "a1".into(),
        ext_id: ext.into(),
        mailbox_id: mailbox.into(),
        uid: date,
        modseq: None,
        message_id: Some(format!("<{ext}@x>")),
        in_reply_to: None,
        references: vec![],
        thread_id: thread.into(),
        from: Address {
            name: String::new(),
            email: from.into(),
        },
        to: vec![],
        cc: vec![],
        subject: format!("S {ext}"),
        snippet: String::new(),
        date_ms: date,
        flags: 0,
        size: 10,
        list_unsubscribe: Some("<https://u.test/x>".into()),
        list_unsubscribe_post: Some("List-Unsubscribe=One-Click".into()),
        precedence: None,
        auto_submitted: None,
        has_invite: false,
        tab: Some(TabRef::of(TabKind::Personal)),
        priority: false,
        attachments: vec![AttachmentInput {
            part_id: "2".into(),
            filename: "invite.ics".into(),
            mime: "text/calendar".into(),
            size: 100,
            is_inline: false,
            content_id: None,
        }],
    }
}

#[test]
fn followups_show_when_due_and_clear_on_counterpart_reply() {
    let s = store("fu");
    s.ingest(&[msg("m1", "sent", "t1", "me@x.test", 1_000)])
        .unwrap();
    s.set_follow_up("t1", Some(5_000), 2_000).unwrap();
    assert!(s.followup_rows(4_000).unwrap().is_empty(), "not due yet");
    assert_eq!(s.followup_rows(6_000).unwrap()[0].thread_id, "t1");
    // a self-reply never clears it
    s.ingest(&[msg("m2", "sent", "t1", "ME@x.test", 3_000)])
        .unwrap();
    assert_eq!(s.followup_rows(6_000).unwrap().len(), 1);
    // the counterpart replies: gone, and stays gone
    s.ingest(&[msg("m3", "inbox", "t1", "anna@y.test", 4_000)])
        .unwrap();
    assert!(s.followup_rows(6_000).unwrap().is_empty());
    assert!(s.follow_up("t1").unwrap().is_none());
    // clearing by hand
    s.set_follow_up("t1", Some(1), 9_000).unwrap();
    s.set_follow_up("t1", None, 9_000).unwrap();
    assert!(s.followup_rows(99_000).unwrap().is_empty());
}

#[test]
fn new_senders_list_held_inbox_threads_until_released() {
    let s = store("ns");
    s.ingest(&[
        msg("m1", "inbox", "t1", "new@y.test", 1),
        msg("m2", "inbox", "t2", "new2@y.test", 2),
        msg("m3", "sent", "t3", "me@x.test", 3),
    ])
    .unwrap();
    s.set_screened(&["t1".into(), "t2".into(), "t3".into()], true)
        .unwrap();
    let ids: Vec<_> = s
        .new_sender_rows()
        .unwrap()
        .into_iter()
        .map(|r| r.thread_id)
        .collect();
    assert_eq!(ids, vec!["t2", "t1"], "inbox only, newest first");
    s.set_screened(&["t2".into()], false).unwrap();
    assert_eq!(s.new_sender_rows().unwrap().len(), 1);
}

#[test]
fn outbox_rows_come_from_pending_sends() {
    let s = store("ob");
    assert!(s.outbox_rows().unwrap().is_empty());
    let doc = DraftDoc {
        from_addr: "me@x.test".into(),
        to: vec!["b@y.test".into()],
        subject: "Hello".into(),
        text: "Body  text".into(),
        ..DraftDoc::default()
    };
    let id = s.save_draft_at(None, "a1", None, doc, 1_000).unwrap();
    let h = s.queue_send_at(&id, 5, 1_000).unwrap();
    let rows = s.outbox_rows().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].subject, "Hello");
    assert_eq!(rows[0].snippet, "Body text");
    assert_eq!(rows[0].thread_id, format!("outbox:{}", h.outbox_id));
    assert_eq!(rows[0].senders[0].email, "b@y.test");
    s.undo_send(&h.outbox_id).unwrap();
    assert!(s.outbox_rows().unwrap().is_empty());
}

#[test]
fn message_and_attachment_refs_stay_inside_their_thread() {
    let s = store("ref");
    s.ingest(&[
        msg("m1", "inbox", "t1", "a@y.test", 1),
        msg("m2", "inbox", "t2", "a@y.test", 2),
    ])
    .unwrap();
    let r = s.message_ref("t1", "m1").unwrap().unwrap();
    assert_eq!(r.account_id, "a1");
    assert_eq!(
        r.list_unsubscribe_post.as_deref(),
        Some("List-Unsubscribe=One-Click")
    );
    assert!(s.message_ref("t2", "m1").unwrap().is_none());
    let att = s.invite_attachment(r.row_id).unwrap().unwrap();
    assert!(s.thread_attachment("t1", att).unwrap().is_some());
    assert!(s.thread_attachment("t2", att).unwrap().is_none());
    assert_eq!(s.mailbox_account("inbox").unwrap().as_deref(), Some("a1"));
    assert_eq!(s.thread_account("t2").unwrap().as_deref(), Some("a1"));
    assert!(s.thread_needs_bodies("t1").unwrap());
}

#[test]
fn avatar_cache_expires() {
    let s = store("av");
    assert!(s.avatar_cached("acme.io", 0, 10).unwrap().is_none());
    s.avatar_put("acme.io", "image/png", Some(b"png"), 100)
        .unwrap();
    assert_eq!(
        s.avatar_cached("acme.io", 105, 10).unwrap(),
        Some(Some(("image/png".into(), b"png".to_vec())))
    );
    assert!(s.avatar_cached("acme.io", 200, 10).unwrap().is_none());
    s.avatar_put("none.io", "none", None, 100).unwrap();
    assert_eq!(s.avatar_cached("none.io", 101, 10).unwrap(), Some(None));
}

#[test]
fn invite_view_maps_times_and_status() {
    let ics = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:Sync\r\nDTSTART:20261105T100000Z\r\nDTEND:20261105T110000Z\r\nORGANIZER;CN=Anna:mailto:anna@y.test\r\nATTENDEE;PARTSTAT=ACCEPTED:mailto:me@x.test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let inv = crate::mail::invite::parse_invite(ics).unwrap();
    let v = invite_view(&inv, &["ME@x.test".into()]).unwrap();
    assert_eq!(v.uid, "u1");
    assert_eq!(v.method, "REQUEST");
    assert_eq!(v.end_ms - v.start_ms, 3_600_000);
    assert_eq!(v.start_ms, 1_793_872_800_000);
    assert_eq!(v.my_status.as_deref(), Some("ACCEPTED"));
    assert_eq!(v.organizer.unwrap().email, "anna@y.test");
    assert!(v.can_rsvp);
    assert!(ics_time_ms("20261105").is_some());
    assert!(ics_time_ms("junk").is_none());
}

#[test]
fn snippet_skips_salutations() {
    let text =
        "Hi Robin,\n\nFollowing up on today's call.  Can we\nlock the dates?\n\nBest,\nJonas";
    assert_eq!(
        substance_snippet(Some(text), "Hi Robin, Following up", "Pilot"),
        "Following up on today's call. Can we"
    );
    // Inline: the greeting and the name go, the sentence stays.
    assert_eq!(
        substance_snippet(None, "Hi Robin, following up on the deck", "Deck"),
        "following up on the deck"
    );
    for (greeting, want) in [
        (
            "Dear Ms Lee:\nThe contract is attached.",
            "The contract is attached.",
        ),
        (
            "Good morning team!\nStandup moves to 10.",
            "Standup moves to 10.",
        ),
        ("Cześć Kasia,\nDzięki za plik.", "Dzięki za plik."),
        ("Hello\n\nQuick one.", "Quick one."),
        (
            "Hiring update: three offers out.",
            "Hiring update: three offers out.",
        ),
        ("> quoted\nReal line", "Real line"),
    ] {
        assert_eq!(
            substance_snippet(Some(greeting), "", "S"),
            want,
            "{greeting}"
        );
    }
    // A long clause after "Hi" isn't a salutation.
    assert_eq!(
        substance_snippet(Some("Hi there is a problem with the build, again"), "", "S"),
        "Hi there is a problem with the build, again"
    );
    // Only a salutation (and a sign-off): the subject.
    assert_eq!(
        substance_snippet(Some("Hi Robin,\n\nThanks,\n"), "", "Pilot"),
        "Pilot"
    );
    assert_eq!(substance_snippet(Some("  "), "", "Pilot"), "Pilot");
    // Capped at 140 characters.
    let long = "word ".repeat(80);
    assert_eq!(substance_snippet(Some(&long), "", "S").chars().count(), 140);
}
