//! Sender intelligence glue (MR-12, AC25–AC28): builds the classifier's
//! `ClassifyConfig` from the local mirror of `email_settings_items` (MR-7),
//! turns classification outcomes into ops-outbox requests (new mail as it
//! arrives, via `RoundReport.effects`), and runs rules over existing mail on
//! demand ("Apply to existing mail").
//!
//! Item value shapes (jsonb, owned by the app's settings UI):
//! - `rule`: `{ conditions: [{ field, value }], actions: [{ action, arg? }] }`
//! - `custom_tab`: `{ id?, name, senders: [], domains: [] }` (the row id if no `id`)
//! - `priority_person`: `{ address }`
//! - `blocked_sender`: `{ address }` (an address, `@domain` or `domain`)
//! - `screener_decision`: `{ address, decision: "allow" | "block" }`
//! - `sender_override`: `{ address, section }` (section = tab key, e.g. `newsletters`, `custom:<id>`)
//! Unknown kinds, actions and conditions are skipped (a newer build's rows).

use std::collections::BTreeMap;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::mail::contracts::{
    BlockDestination, ClassifyStage, OpKind, RuleAction, RuleCondition, FLAG_DELETED,
};
use crate::mail::ops::OpRequest;
use crate::mail::store::query::json_col;
use crate::mail::store::{Address, ClassifyReason, Store, StoreError, StoreResult, TabRef};
use crate::mail::sync::classify::{
    classify, rule_matches, ClassifyConfig, CustomTab, Outcome, Rule,
};
use crate::mail::sync::headers::ParsedHeader;

#[derive(Debug, Clone, Deserialize)]
pub struct SettingsItem {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub position: f64,
    pub value: Value,
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k)
        .and_then(Value::as_str)
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
}
fn list(v: &Value, k: &str) -> Vec<String> {
    v.get(k)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|x| x.trim().to_ascii_lowercase())
                .filter(|x| !x.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Fills the settings-derived parts of `base` (contacts, correspondents, own
/// addresses, the Screener switch and block destination stay the caller's).
/// Rules and custom tabs keep their `position` order: list order decides.
pub fn apply_settings_items(base: &mut ClassifyConfig, items: &[SettingsItem]) {
    let mut sorted: Vec<&SettingsItem> = items.iter().collect();
    sorted.sort_by(|a, b| a.position.total_cmp(&b.position).then(a.id.cmp(&b.id)));
    for it in sorted {
        let v = &it.value;
        match it.kind.as_str() {
            "rule" => {
                let conditions: Vec<(RuleCondition, String)> = v
                    .get("conditions")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|c| {
                        Some((
                            RuleCondition::parse(c.get("field")?.as_str()?)?,
                            c.get("value").and_then(Value::as_str).unwrap_or("").to_string(),
                        ))
                    })
                    .collect();
                let actions: Vec<(RuleAction, Option<String>)> = v
                    .get("actions")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|a| {
                        Some((RuleAction::parse(a.get("action")?.as_str()?)?, s(a, "arg")))
                    })
                    .collect();
                if !conditions.is_empty() && !actions.is_empty() {
                    base.rules.push(Rule {
                        id: it.id.clone(),
                        conditions,
                        actions,
                    });
                }
            }
            "custom_tab" => base.custom_tabs.push(CustomTab {
                id: s(v, "id").unwrap_or_else(|| it.id.clone()),
                senders: list(v, "senders"),
                domains: list(v, "domains"),
            }),
            "priority_person" => {
                if let Some(a) = s(v, "address") {
                    base.priority_people.insert(a.to_ascii_lowercase());
                }
            }
            "blocked_sender" => {
                if let Some(a) = s(v, "address") {
                    base.blocked.push(a.to_ascii_lowercase());
                }
            }
            "screener_decision" => {
                if let Some(a) = s(v, "address") {
                    let a = a.to_ascii_lowercase();
                    match s(v, "decision").as_deref() {
                        Some("block") => base.blocked.push(a),
                        // Allowed senders are treated as correspondents: never screened again.
                        _ => {
                            base.correspondents.insert(a);
                        }
                    }
                }
            }
            "sender_override" => {
                if let (Some(a), Some(sec)) = (s(v, "address"), s(v, "section")) {
                    base.sender_overrides
                        .insert(a.to_ascii_lowercase(), TabRef::decode(&sec));
                }
            }
            _ => {}
        }
    }
}

/// Resolves a folder target (a path or a role name) to a mailbox id for the
/// thread's account; `None` when that account has no such folder.
pub trait FolderResolver {
    fn by_path(&self, thread_id: &str, path: &str) -> Option<String>;
    /// A label's mailbox for the thread's account (Gmail labels are folders).
    fn label(&self, thread_id: &str, label: &str) -> Option<String> {
        self.by_path(thread_id, label)
    }
}

/// Folder targets resolved against the store: a path, a folder name or a role
/// name (`archive`, `trash` …) in the thread's account. Labels resolve only on
/// Gmail accounts, to a label folder (custom role).
pub struct StoreFolders<'a>(pub &'a Store);

impl FolderResolver for StoreFolders<'_> {
    fn by_path(&self, thread_id: &str, path: &str) -> Option<String> {
        self.0
            .r()
            .prepare_cached(
                "SELECT mb.id FROM mailboxes mb
                 WHERE mb.account_id = (SELECT account_id FROM messages WHERE thread_id = ?1 LIMIT 1)
                   AND (mb.path = ?2 COLLATE NOCASE OR mb.name = ?2 COLLATE NOCASE
                        OR (mb.role != 'custom' AND mb.role = lower(?2)))
                 ORDER BY mb.path = ?2 DESC, mb.path LIMIT 1",
            )
            .and_then(|mut s| s.query_row(params![thread_id, path.trim()], |r| r.get(0)).optional())
            .ok()
            .flatten()
    }

    fn label(&self, thread_id: &str, label: &str) -> Option<String> {
        self.0
            .r()
            .prepare_cached(
                "SELECT mb.id FROM mailboxes mb JOIN accounts a ON a.id = mb.account_id
                 WHERE mb.account_id = (SELECT account_id FROM messages WHERE thread_id = ?1 LIMIT 1)
                   AND a.provider IN ('gmail', 'google_workspace') AND mb.role = 'custom'
                   AND (mb.path = ?2 COLLATE NOCASE OR mb.name = ?2 COLLATE NOCASE)
                 ORDER BY mb.path LIMIT 1",
            )
            .and_then(|mut s| s.query_row(params![thread_id, label.trim()], |r| r.get(0)).optional())
            .ok()
            .flatten()
    }
}

impl<F: Fn(&str, &str) -> Option<String>> FolderResolver for F {
    fn by_path(&self, thread_id: &str, path: &str) -> Option<String> {
        self(thread_id, path)
    }
}

/// Turns outcomes into batched op requests, one per (kind, target). Blocked
/// mail goes where the setting says (AC28); a rule's move/skip-inbox/mark-read
/// become Move/Done/MarkRead (AC26). Screened mail needs no op: it stays held
/// in New senders by its `screened` mark. A label becomes a LabelAdd when the
/// resolver finds its label folder (Gmail); elsewhere it is skipped.
pub fn plan_effects(effects: &[(String, Outcome)], folders: &dyn FolderResolver) -> Vec<OpRequest> {
    let mut groups: BTreeMap<(&'static str, Option<String>), Vec<String>> = BTreeMap::new();
    let mut push = |kind: OpKind, to: Option<String>, t: &str| {
        let ids = groups.entry((kind.as_str(), to)).or_default();
        if !ids.iter().any(|x| x == t) {
            ids.push(t.to_string());
        }
    };
    for (t, o) in effects {
        if let Some((dest, folder)) = &o.blocked {
            match dest {
                BlockDestination::Trash => push(OpKind::Delete, None, t),
                BlockDestination::Spam => push(OpKind::Spam, None, t),
                BlockDestination::Archive => push(OpKind::Done, None, t),
                BlockDestination::Folder => {
                    match folder.as_deref().and_then(|f| folders.by_path(t, f)) {
                        Some(id) => push(OpKind::Move, Some(id), t),
                        // A missing folder falls back to the default, Trash.
                        None => push(OpKind::Delete, None, t),
                    }
                }
            }
            continue;
        }
        if o.mark_read {
            push(OpKind::MarkRead, None, t);
        }
        for l in &o.labels {
            if let Some(id) = folders.label(t, l) {
                push(OpKind::LabelAdd, Some(id), t);
            }
        }
        if let Some(id) = o.move_to.as_deref().and_then(|f| folders.by_path(t, f)) {
            push(OpKind::Move, Some(id), t);
        } else if o.skip_inbox {
            push(OpKind::Done, None, t);
        }
    }
    groups
        .into_iter()
        .map(|((k, to), ids)| {
            let mut r = OpRequest::new(OpKind::parse(k).expect("own kind"), ids);
            r.to_mailbox_id = to;
            r
        })
        .collect()
}

/// "Apply to existing mail": classify each (thread, header) with the current
/// rules and plan the ops. Only rule and block outcomes act; the Screener
/// never re-holds mail you already have.
pub fn apply_to_existing(
    messages: &[(String, ParsedHeader)],
    cfg: &ClassifyConfig,
    folders: &dyn FolderResolver,
) -> Vec<OpRequest> {
    let effects: Vec<(String, Outcome)> = messages
        .iter()
        .map(|(t, h)| {
            let mut o = classify(h, cfg);
            o.screened = false;
            (t.clone(), o)
        })
        .filter(|(_, o)| {
            o.blocked.is_some() || o.mark_read || o.skip_inbox || o.move_to.is_some()
        })
        .collect();
    plan_effects(&effects, folders)
}

/// Threads per queued op when a rule runs over existing mail (decision 5).
pub const APPLY_CHUNK: usize = 500;

/// `MailApplyRuleResult`: threads matched (dry run) or acted on, and the one
/// undoable bulk action (empty on a dry run or when nothing needed an op).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRuleResult {
    pub count: usize,
    pub op_ids: Vec<String>,
}

/// Every live message's stored headers (not in Trash or Spam) that `rule` matches.
fn rule_hits(store: &Store, rule: &Rule) -> StoreResult<Vec<(String, ParsedHeader)>> {
    let conn = store.r();
    let mut s = conn.prepare(
        "SELECT m.thread_id, m.from_name, m.from_email, m.to_json, m.cc_json, m.subject,
           m.list_unsubscribe, m.list_unsubscribe_post, m.precedence, m.auto_submitted
         FROM messages m
         WHERE (m.flags & ?1) = 0 AND EXISTS (SELECT 1 FROM thread_views tv
           WHERE tv.thread_id = m.thread_id AND tv.role NOT IN ('trash', 'spam'))
         ORDER BY m.date_ms DESC, m.id DESC",
    )?;
    let mut rows = s.query([FLAG_DELETED])?;
    let mut out = Vec::new();
    while let Some(r) = rows.next()? {
        let to: String = r.get(3)?;
        let cc: String = r.get(4)?;
        let h = ParsedHeader {
            from: Address {
                name: r.get(1)?,
                email: r.get(2)?,
            },
            to: json_col(3, &to)?,
            cc: json_col(4, &cc)?,
            subject: r.get(5)?,
            list_unsubscribe: r.get(6)?,
            list_unsubscribe_post: r.get(7)?,
            precedence: r.get(8)?,
            auto_submitted: r.get(9)?,
            ..ParsedHeader::default()
        };
        if rule_matches(rule, &h) {
            out.push((r.get(0)?, h));
        }
    }
    Ok(out)
}

/// "Also apply to the N already on this Mac" (`mail_apply_rule_existing`, AC7).
/// The dry run counts the matching threads. The apply queues the rule's ops in
/// chunks of [`APPLY_CHUNK`] threads under one action id (one `z` undoes it all)
/// and returns once every chunk is queued; a Put-in-tab rule re-tabs them too.
pub fn apply_rule_existing(
    store: &Store,
    cfg: &ClassifyConfig,
    rule_id: &str,
    dry_run: bool,
    now: i64,
) -> StoreResult<ApplyRuleResult> {
    let rule = cfg
        .rules
        .iter()
        .find(|r| r.id == rule_id)
        .cloned()
        .ok_or_else(|| StoreError::Invalid("rule_not_found".into()))?;
    let hits = rule_hits(store, &rule)?;
    let mut threads: Vec<String> = Vec::new();
    for (t, _) in &hits {
        if !threads.contains(t) {
            threads.push(t.clone());
        }
    }
    let count = threads.len();
    if dry_run || count == 0 {
        return Ok(ApplyRuleResult {
            count,
            op_ids: vec![],
        });
    }
    // Only this rule acts: the block list and the other rules stay out of it.
    let one = ClassifyConfig {
        rules: vec![rule.clone()],
        block_destination: cfg.block_destination,
        block_folder: cfg.block_folder.clone(),
        ..ClassifyConfig::default()
    };
    if let Some((_, arg)) = rule
        .actions
        .iter()
        .find(|(a, _)| *a == RuleAction::PutInTab)
    {
        let tab = TabRef::decode(arg.as_deref().unwrap_or("personal"));
        let reason = ClassifyReason {
            stage: ClassifyStage::Rules,
            rule_id: Some(rule.id.clone()),
        };
        for chunk in threads.chunks(APPLY_CHUNK) {
            store.retab_threads(chunk, &tab, &reason)?;
        }
    }
    let folders = StoreFolders(store);
    let reqs = apply_to_existing(&hits, &one, &folders);
    let action = uuid::Uuid::new_v4().to_string();
    let mut queued = false;
    for req in reqs {
        for chunk in req.thread_ids.chunks(APPLY_CHUNK) {
            let mut r = OpRequest::new(req.kind, chunk.to_vec());
            r.to_mailbox_id = req.to_mailbox_id.clone();
            if let Err(e) = store.enqueue_in_action(&r, &action, now) {
                // All or nothing: drop the chunks already queued.
                if queued {
                    let _ = store.undo_action_at(&action, now);
                }
                return Err(e);
            }
            queued = true;
        }
    }
    Ok(ApplyRuleResult {
        count,
        op_ids: if queued { vec![action] } else { vec![] },
    })
}

/// Whether a new-mail outcome should raise a notification: Priority people
/// always notify when that switch is on; otherwise only with notify-Personal
/// on and a Personal, unscreened, unblocked message (AC27, A2).
pub fn should_notify(o: &Outcome, notify_personal: bool, priority_always: bool) -> bool {
    if o.blocked.is_some() || o.screened || o.mark_read {
        return false;
    }
    (o.priority && priority_always)
        || (notify_personal && o.tab.kind == crate::mail::contracts::TabKind::Personal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::contracts::TabKind;
    use crate::mail::store::Address;
    use serde_json::json;

    fn h(from: &str, subject: &str) -> ParsedHeader {
        ParsedHeader {
            from: Address {
                name: "".into(),
                email: from.into(),
            },
            subject: subject.into(),
            ..Default::default()
        }
    }
    fn item(id: &str, kind: &str, pos: f64, value: Value) -> SettingsItem {
        SettingsItem {
            id: id.into(),
            kind: kind.into(),
            position: pos,
            value,
        }
    }
    fn folders(_t: &str, p: &str) -> Option<String> {
        (p != "Missing").then(|| format!("acc|{p}"))
    }

    #[test]
    fn apply_existing_counts_then_applies_in_chunks() {
        use crate::mail::contracts::{MailboxRole, TabKind};
        use crate::mail::store::{
            now_ms, AccountInput, ListInput, MailboxInput, MessageInput, ViewRef,
        };
        let d = std::env::temp_dir().join(format!(
            "moduo-mail-rules-apply-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = std::fs::remove_dir_all(&d);
        let st = Store::open(&d).unwrap();
        st.upsert_account(&AccountInput {
            id: "a1".into(),
            address: "me@x.test".into(),
            display_name: "Me".into(),
            provider: "imap".into(),
            hue: 1,
        })
        .unwrap();
        for (id, role) in [
            ("inbox", MailboxRole::Inbox),
            ("archive", MailboxRole::Archive),
            ("trash", MailboxRole::Trash),
        ] {
            st.upsert_mailbox(&MailboxInput {
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
        let msg = |i: usize, from: &str, mailbox: &str| MessageInput {
            classify: None,
            account_id: "a1".into(),
            ext_id: format!("e{i}"),
            mailbox_id: mailbox.into(),
            uid: i as i64 + 1,
            modseq: None,
            message_id: Some(format!("<e{i}@x>")),
            in_reply_to: None,
            references: vec![],
            thread_id: format!("t{i}"),
            from: Address {
                name: String::new(),
                email: from.into(),
            },
            to: vec![],
            cc: vec![],
            subject: format!("Receipt {i}"),
            snippet: String::new(),
            date_ms: 1_000 + i as i64,
            flags: 0,
            size: 1,
            list_unsubscribe: None,
            list_unsubscribe_post: None,
            precedence: None,
            auto_submitted: None,
            has_invite: false,
            tab: Some(TabRef::of(TabKind::Personal)),
            priority: false,
            attachments: vec![],
        };
        let mut batch: Vec<MessageInput> = (0..1_200)
            .map(|i| msg(i, "billing@shop.test", "inbox"))
            .collect();
        batch.push(msg(5_000, "friend@y.test", "inbox"));
        batch.push(msg(5_001, "billing@shop.test", "trash"));
        st.ingest(&batch).unwrap();
        let mut cfg = ClassifyConfig::default();
        apply_settings_items(
            &mut cfg,
            &[item(
                "r-bills",
                "rule",
                0.0,
                json!({"conditions":[{"field":"from","value":"billing@shop.test"}],"actions":[{"action":"skip_inbox"},{"action":"put_in_tab","arg":"notifications"}]}),
            )],
        );
        let inbox_count = || {
            let mut n = 0;
            let mut after = None;
            loop {
                let p = st
                    .list_threads(&ListInput {
                        view: ViewRef::Unified(MailboxRole::Inbox),
                        tab: None,
                        after,
                        limit: 500,
                    })
                    .unwrap();
                n += p.rows.len();
                match p.next {
                    Some(c) => after = Some(c),
                    None => return n,
                }
            }
        };
        let ops = || -> Vec<(String, String)> {
            let c = st.r();
            let mut s = c
                .prepare("SELECT json_extract(args_json, '$.action'), thread_ids_json FROM ops")
                .unwrap();
            s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        // Dry run: counts the 1,200 (not the one in Trash), touches nothing.
        let dry = apply_rule_existing(&st, &cfg, "r-bills", true, 10_000).unwrap();
        assert_eq!(
            dry,
            ApplyRuleResult {
                count: 1_200,
                op_ids: vec![]
            }
        );
        assert!(ops().is_empty());
        assert_eq!(inbox_count(), 1_201);
        // Apply: one action, queued as 500 + 500 + 200.
        let done = apply_rule_existing(&st, &cfg, "r-bills", false, 10_000).unwrap();
        assert_eq!(done.count, 1_200);
        assert_eq!(done.op_ids.len(), 1);
        let rows = ops();
        let sizes: Vec<usize> = rows
            .iter()
            .map(|(_, t)| serde_json::from_str::<Vec<String>>(t).unwrap().len())
            .collect();
        assert_eq!(sizes, vec![500, 500, 200]);
        assert!(
            rows.iter().all(|(a, _)| *a == done.op_ids[0]),
            "one bulk id"
        );
        assert_eq!(inbox_count(), 1, "only the friend stays");
        let tab: String = st
            .r()
            .query_row(
                "SELECT tab FROM thread_views WHERE thread_id = 't7'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tab, "notifications");
        // One z undoes every chunk.
        st.undo_action_at(&done.op_ids[0], 11_000).unwrap();
        assert!(ops().is_empty());
        assert_eq!(inbox_count(), 1_201);
        assert!(apply_rule_existing(&st, &cfg, "nope", true, 0).is_err());
    }

    #[test]
    fn settings_items_build_config_in_position_order() {
        let mut cfg = ClassifyConfig::default();
        apply_settings_items(
            &mut cfg,
            &[
                item("b", "rule", 2.0, json!({"conditions":[{"field":"from","value":"a@x.test"}],"actions":[{"action":"move_to_folder","arg":"Two"}]})),
                item("a", "rule", 1.0, json!({"conditions":[{"field":"domain","value":"x.test"}],"actions":[{"action":"move_to_folder","arg":"One"},{"action":"teleport"}]})),
                item("t", "custom_tab", 0.0, json!({"name":"Team","senders":["Ann@X.test"],"domains":[]})),
                item("p", "priority_person", 0.0, json!({"address":"Boss@X.test"})),
                item("k", "blocked_sender", 0.0, json!({"address":"@spam.test"})),
                item("s1", "screener_decision", 0.0, json!({"address":"ok@new.test","decision":"allow"})),
                item("s2", "screener_decision", 0.0, json!({"address":"no@new.test","decision":"block"})),
                item("o", "sender_override", 0.0, json!({"address":"n@x.test","section":"newsletters"})),
                item("z", "future_kind", 0.0, json!({})),
            ],
        );
        assert_eq!(cfg.rules.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(cfg.rules[0].actions.len(), 1, "unknown action skipped");
        assert_eq!(cfg.custom_tabs[0].id, "t");
        assert_eq!(cfg.custom_tabs[0].senders, ["ann@x.test"]);
        assert!(cfg.priority_people.contains("boss@x.test"));
        assert!(cfg.blocked.contains(&"@spam.test".to_string()));
        assert!(cfg.blocked.contains(&"no@new.test".to_string()));
        assert!(cfg.correspondents.contains("ok@new.test"));
        assert_eq!(cfg.sender_overrides["n@x.test"].kind, TabKind::Newsletters);
        let o = classify(&h("a@x.test", "hi"), &cfg);
        assert_eq!(o.move_to.as_deref(), Some("One"), "first in list order wins");
    }

    #[test]
    fn apply_to_existing() {
        let mut cfg = ClassifyConfig {
            screener: true,
            blocked: vec!["bad@x.test".into()],
            block_destination: BlockDestination::Spam,
            ..Default::default()
        };
        apply_settings_items(
            &mut cfg,
            &[item("r", "rule", 0.0, json!({"conditions":[{"field":"subject_contains","value":"invoice"}],"actions":[{"action":"move_to_folder","arg":"Finance"},{"action":"mark_read"}]})),
              item("r2", "rule", 1.0, json!({"conditions":[{"field":"from","value":"bot@ci.test"}],"actions":[{"action":"skip_inbox"}]}))],
        );
        let msgs = vec![
            ("t1".to_string(), h("a@x.test", "Invoice 1")),
            ("t2".to_string(), h("b@x.test", "Invoice 2")),
            ("t3".to_string(), h("bad@x.test", "Invoice 3")),
            ("t4".to_string(), h("bot@ci.test", "build")),
            ("t5".to_string(), h("stranger@x.test", "hello")),
        ];
        let ops = super::apply_to_existing(&msgs, &cfg, &folders);
        let find = |k: OpKind| ops.iter().find(|o| o.kind == k).map(|o| (o.thread_ids.clone(), o.to_mailbox_id.clone()));
        assert_eq!(find(OpKind::Move), Some((vec!["t1".into(), "t2".into()], Some("acc|Finance".into()))));
        assert_eq!(find(OpKind::MarkRead).unwrap().0, vec!["t1", "t2"]);
        assert_eq!(find(OpKind::Spam).unwrap().0, vec!["t3"], "block wins over rules");
        assert_eq!(find(OpKind::Done).unwrap().0, vec!["t4"]);
        assert!(ops.iter().all(|o| !o.thread_ids.contains(&"t5".to_string())), "screener never re-holds");
    }

    #[test]
    fn blocked_destination_folder_falls_back_to_trash() {
        let mut o = classify(&h("x@y.test", "s"), &ClassifyConfig::default());
        o.blocked = Some((BlockDestination::Folder, Some("Missing".into())));
        let ops = plan_effects(&[("t".into(), o.clone())], &folders);
        assert_eq!(ops[0].kind, OpKind::Delete);
        o.blocked = Some((BlockDestination::Folder, Some("Blocked".into())));
        let ops = plan_effects(&[("t".into(), o)], &folders);
        assert_eq!((ops[0].kind, ops[0].to_mailbox_id.as_deref()), (OpKind::Move, Some("acc|Blocked")));
    }

    #[test]
    fn priority_notify() {
        let mut cfg = ClassifyConfig::default();
        cfg.priority_people.insert("boss@x.test".into());
        let boss = classify(&h("boss@x.test", "s"), &cfg);
        let peer = classify(&h("peer@x.test", "s"), &cfg);
        assert!(should_notify(&boss, false, true));
        assert!(!should_notify(&boss, false, false));
        assert!(!should_notify(&peer, false, true), "badge-only by default");
        assert!(should_notify(&peer, true, true));
        cfg.screener = true;
        let stranger = classify(&h("new@x.test", "s"), &cfg);
        assert!(!should_notify(&stranger, true, true), "screened mail stays quiet");
    }
}
