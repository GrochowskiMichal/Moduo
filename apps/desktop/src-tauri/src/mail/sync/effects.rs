//! New mail acts (specs/mail-v3.md decisions 4 and 12): after each sync round,
//! the rule effects of genuinely new Inbox mail and the mute rule become
//! `system` ops in the ops outbox.

use std::collections::BTreeSet;

use super::engine::{RoundReport, SyncCtx};
use super::events::MailEvent;
use crate::mail::contracts::OpKind;
use crate::mail::ops::OpRequest;
use crate::mail::rules::{plan_effects, StoreFolders};
use crate::mail::store::Store;

/// The ops a round's new mail calls for: each rule effect (move, mark read, skip
/// Inbox, label, block) and, for a reply in a muted thread, Done (decisions 4 and 12).
pub fn round_ops(store: &Store, report: &RoundReport) -> Vec<OpRequest> {
    let mut reqs = plan_effects(&report.effects, &StoreFolders(store));
    let leaves = |t: &String| {
        reqs.iter().any(|r| {
            matches!(
                r.kind,
                OpKind::Done | OpKind::Move | OpKind::Delete | OpKind::Spam
            ) && r.thread_ids.contains(t)
        })
    };
    let muted: Vec<String> = report
        .new_inbox_thread_ids
        .iter()
        .filter(|t| !leaves(t))
        .filter(|t| {
            store
                .r()
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM threads WHERE id = ?1 AND muted = 1)",
                    [t.as_str()],
                    |r| r.get::<_, bool>(0),
                )
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    if !muted.is_empty() {
        reqs.push(OpRequest::new(OpKind::Done, muted));
    }
    reqs.into_iter().map(OpRequest::system).collect()
}

/// Queues [`round_ops`] as `system` ops: applied locally now, run on the server
/// at the next tick, never in the undo toast, listed only if they fail. One
/// that cannot be planned (a folder gone, labels off Gmail) is skipped.
pub fn act_on_round(ctx: &SyncCtx<'_>, report: &RoundReport) {
    let mut touched: BTreeSet<String> = BTreeSet::new();
    for req in round_ops(ctx.store, report) {
        match ctx.store.enqueue_op(&req) {
            Ok(_) => touched.extend(req.thread_ids.iter().cloned()),
            Err(e) => eprintln!(
                "[mail] {}: system {} skipped: {e}",
                ctx.account_id,
                req.kind.as_str()
            ),
        }
    }
    if !touched.is_empty() {
        // Moves reach views beyond this mailbox's: no keys refreshes every window.
        ctx.events.emit(MailEvent::ThreadsChanged {
            view_keys: vec![],
            thread_ids: touched.into_iter().collect(),
        });
    }
}

#[cfg(test)]
mod tests {
    use crate::mail::contracts::FLAG_SEEN;
    use crate::mail::contracts::{RuleAction, RuleCondition};
    use crate::mail::sync::classify::ClassifyConfig;
    use crate::mail::sync::classify::Rule;
    use crate::mail::sync::events::EventBus;
    use crate::mail::sync::live::AccountSync;
    use crate::mail::sync::testing::{raw, store, Fake};
    use std::sync::{Arc, RwLock};

    #[tokio::test]
    async fn round_runs_rule_effects() {
        let f = Fake::new(true, false);
        f.add_folder("INBOX", &[]);
        f.add_folder("Archive", &["\\Archive"]);
        f.add_folder("Receipts", &[]);
        let from_shop = |id: &str, date: i64| {
            f.append_raw(
                "INBOX",
                raw(
                    id,
                    &[],
                    "Shop <billing@shop.test>",
                    &format!("Receipt {id}"),
                    date,
                ),
                date,
                &[],
            )
        };
        from_shop("old", 1_000);
        let cfg = ClassifyConfig {
            rules: vec![
                Rule {
                    id: "r-receipts".into(),
                    conditions: vec![(RuleCondition::From, "billing@shop.test".into())],
                    actions: vec![
                        (RuleAction::MoveToFolder, Some("Receipts".into())),
                        (RuleAction::MarkRead, None),
                    ],
                },
                Rule {
                    id: "r-ci".into(),
                    conditions: vec![(RuleCondition::From, "bot@ci.test".into())],
                    actions: vec![(RuleAction::SkipInbox, None)],
                },
            ],
            ..ClassifyConfig::default()
        };
        let s = Arc::new(store("rule-effects"));
        let a = AccountSync::new(
            "a1",
            s.clone(),
            EventBus::new(),
            Arc::new(RwLock::new(cfg)),
            None,
        );
        let mut srv = f.session();
        let plans = a.first_round(&mut srv).await.unwrap();
        let inbox = plans.iter().find(|p| p.path == "INBOX").unwrap().clone();
        let ops = || -> Vec<(String, bool)> {
            let c = s.r();
            let mut st = c
                .prepare("SELECT kind, json_extract(args_json, '$.system') FROM ops ORDER BY kind")
                .unwrap();
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        assert!(ops().is_empty(), "the first sync never runs rules");
        // New mail: the rules act.
        from_shop("new", 2_000);
        f.append_raw(
            "INBOX",
            raw("ci", &[], "CI <bot@ci.test>", "Build green", 3_000),
            3_000,
            &[],
        );
        f.append_raw(
            "INBOX",
            raw("hi", &[], "Ann <ann@x.test>", "Hello", 4_000),
            4_000,
            &[],
        );
        a.round(&mut srv, &plans, &inbox).await.unwrap();
        assert_eq!(
            ops(),
            vec![
                ("done".to_string(), true),
                ("mark_read".to_string(), true),
                ("move".to_string(), true)
            ]
        );
        let where_is = |subject: &str| -> (Vec<String>, u32) {
            let c = s.r();
            let mut st = c
                .prepare(
                    "SELECT mb.path FROM messages m JOIN message_mailboxes mm ON mm.message_id = m.id
                     JOIN mailboxes mb ON mb.id = mm.mailbox_id WHERE m.subject = ?1 ORDER BY mb.path",
                )
                .unwrap();
            let paths = st
                .query_map([subject], |r| r.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            let flags = c
                .query_row(
                    "SELECT flags FROM messages WHERE subject = ?1",
                    [subject],
                    |r| r.get(0),
                )
                .unwrap();
            (paths, flags)
        };
        let (paths, flags) = where_is("Receipt new");
        assert_eq!(paths, vec!["Receipts"]);
        assert_ne!(flags & FLAG_SEEN, 0, "marked read");
        assert_eq!(
            where_is("Build green").0,
            vec!["Archive"],
            "skip inbox is Done"
        );
        assert_eq!(where_is("Hello").0, vec!["INBOX"], "no rule, no op");
        assert_eq!(
            where_is("Receipt old").0,
            vec!["INBOX"],
            "old mail is left alone"
        );
        // A later round neither repeats the ops nor resurrects the threads.
        a.round(&mut srv, &plans, &inbox).await.unwrap();
        assert_eq!(ops().len(), 3);
        assert_eq!(where_is("Receipt new").0, vec!["Receipts"]);
    }
}
