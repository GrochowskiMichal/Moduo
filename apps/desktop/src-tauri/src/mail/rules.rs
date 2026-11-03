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

use serde::Deserialize;
use serde_json::Value;

use crate::mail::contracts::{BlockDestination, OpKind, RuleAction, RuleCondition};
use crate::mail::ops::OpRequest;
use crate::mail::store::TabRef;
use crate::mail::sync::classify::{classify, ClassifyConfig, CustomTab, Outcome, Rule};
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
}

impl<F: Fn(&str, &str) -> Option<String>> FolderResolver for F {
    fn by_path(&self, thread_id: &str, path: &str) -> Option<String> {
        self(thread_id, path)
    }
}

/// Turns outcomes into batched op requests, one per (kind, target). Blocked
/// mail goes where the setting says (AC28); a rule's move/skip-inbox/mark-read
/// become Move/Done/MarkRead (AC26). Screened mail needs no op: it stays held
/// in New senders by its `screened` mark. Labels are local-only until the ops
/// outbox grows a label target (MR-12 decision).
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
