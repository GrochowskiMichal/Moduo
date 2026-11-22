// HV-15 variant of benchmarks/escapes/509-5-decode-failure-then-delete (fixed): a
// follow-up that wouldn't decode was deleted by the Follow-ups view's read. It is now
// left as it is.
// Run: cargo test --lib unreadable_followup

use super::tests::{msg, store};

/// A follow-up in a shape this build can't read (older/newer build, partial write).
const RAW: &str = r#"{"dueMs":5000}"#;

#[test]
fn an_unreadable_follow_up_survives_the_followups_read() {
    let s = store("fu-unreadable");
    s.kv_set("followup:t1", RAW).unwrap();
    let _ = s.followup_rows(6_000);
    assert_eq!(
        s.kv_get("followup:t1").unwrap().as_deref(),
        Some(RAW),
        "the armed follow-up was deleted because it didn't decode"
    );
}

// Hardening: wrong fixes that keep the blob but break the view, rewrite the
// blob, or let it go once the thread has mail.

#[test]
fn the_view_still_lists_the_readable_ones_and_keeps_the_blob_byte_for_byte() {
    let s = store("fu-mixed");
    s.ingest(&[
        msg("m1", "sent", "t1", "me@x.test", 1_000),
        msg("m2", "sent", "t2", "me@x.test", 1_000),
    ])
    .unwrap();
    s.kv_set("followup:t1", RAW).unwrap();
    s.set_follow_up("t2", Some(5_000), 2_000).unwrap();
    // An error would empty the whole Follow-ups view; the unreadable one is
    // not shown (its due time is unknown), the readable one is.
    let rows = s
        .followup_rows(6_000)
        .expect("an unreadable follow-up fails the view");
    let ids: Vec<_> = rows.iter().map(|r| r.thread_id.as_str()).collect();
    assert_eq!(ids, ["t2"]);
    // Read twice: still the same bytes (not repaired or re-encoded).
    let _ = s.followup_rows(7_000).unwrap();
    assert_eq!(s.kv_get("followup:t1").unwrap().as_deref(), Some(RAW));
    assert!(s.follow_up("t1").unwrap().is_none(), "reads as not armed");
}

#[test]
fn a_counterpart_reply_does_not_delete_an_unreadable_follow_up() {
    let s = store("fu-replied");
    s.ingest(&[
        msg("m1", "sent", "t1", "me@x.test", 1_000),
        msg("m2", "inbox", "t1", "anna@y.test", 3_000),
    ])
    .unwrap();
    s.kv_set("followup:t1", RAW).unwrap();
    let _ = s.followup_rows(9_000).unwrap();
    assert_eq!(s.kv_get("followup:t1").unwrap().as_deref(), Some(RAW));
    // The person still decides: clearing it by hand removes it.
    s.set_follow_up("t1", None, 9_000).unwrap();
    assert!(s.kv_get("followup:t1").unwrap().is_none());
}
