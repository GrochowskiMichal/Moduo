//! Bulk triage over very many threads (⌘A over a big view): one action, many rows.

use super::*;

#[test]
fn bulk_over_twelve_thousand_threads_is_one_undoable_action() {
    let d = dir("bulk12k");
    let s = open(&d);
    let batch: Vec<MessageInput> = (0..12_000)
        .map(|i| {
            msg(
                "a1",
                &format!("b{i}"),
                "inbox",
                i + 1,
                &format!("bt{i}"),
                100 + i,
                0,
            )
        })
        .collect();
    s.ingest(&batch).unwrap();
    let in_inbox = || -> i64 {
        s.r()
            .query_row(
                "SELECT COUNT(*) FROM thread_views WHERE mailbox_id = 'a1-inbox'",
                [],
                |r| r.get(0),
            )
            .unwrap()
    };
    assert_eq!(in_inbox(), 12_000);
    let threads: Vec<String> = (0..12_000).map(|i| format!("bt{i}")).collect();
    let h = s
        .enqueue_op_at(&OpRequest::new(OpKind::Done, threads), T0)
        .unwrap();
    assert_eq!(in_inbox(), 0);
    // Queued in chunks, all under the one action id.
    let rows: Vec<(String, usize)> = {
        let c = s.r();
        let mut q = c
            .prepare(
                "SELECT json_extract(args_json, '$.action'), json_array_length(thread_ids_json) FROM ops",
            )
            .unwrap();
        let v = q
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        v
    };
    assert!(rows.len() > 1, "chunked");
    assert!(rows
        .iter()
        .all(|(a, n)| *a == h.action_id && *n <= OP_CHUNK));
    assert_eq!(rows.iter().map(|(_, n)| n).sum::<usize>(), 12_000);
    assert_eq!(
        s.undo_action_at(&h.action_id, T0 + 1).unwrap(),
        UndoOutcome::Cancelled
    );
    assert_eq!(in_inbox(), 12_000);
}
