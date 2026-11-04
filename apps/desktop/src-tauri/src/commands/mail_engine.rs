//! The `mail_*` commands behind `MailEngine` (apps/app/src/lib/runtime.types.mail-engine.ts,
//! MR-16a). Inputs come from the webview and are validated here; every command
//! reads or writes the signed-in user's store through [`MailHost`].

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::mail::contracts::{MailboxRole, OpKind, TabKind};
use crate::mail::host::{list_accounts, AccountRow, MailHost};
use crate::mail::ops::{OpRequest, UndoOutcome};
use crate::mail::store::{
    now_ms, Counts, ListCursor, ListInput, ListPage, MailboxRow, SearchQuery, TabRef, ThreadDetail,
    ThreadRow, ViewRef,
};
use crate::mail::sync::events::MailEvent;

const MAX_IDS: usize = 5_000;
const MAX_ID_LEN: usize = 512;

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return Err("invalid_id".into());
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ViewIn {
    Unified { role: MailboxRole },
    Mailbox { mailbox_id: String },
    Snoozed,
    Followups,
    NewSenders,
    Outbox,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabIn {
    pub kind: TabKind,
    #[serde(default)]
    pub custom_tab_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListIn {
    pub view: ViewIn,
    #[serde(default)]
    pub tab: Option<TabIn>,
    #[serde(default)]
    pub after: Option<ListCursor>,
    pub limit: u32,
}

/// The store's view, or None for views the store does not list yet.
pub fn to_list_input(i: ListIn) -> Result<Option<ListInput>, String> {
    let view = match i.view {
        ViewIn::Unified { role } => ViewRef::Unified(role),
        ViewIn::Mailbox { mailbox_id } => {
            check_id(&mailbox_id)?;
            ViewRef::Mailbox(mailbox_id)
        }
        ViewIn::Snoozed => ViewRef::Snoozed,
        ViewIn::Followups | ViewIn::NewSenders | ViewIn::Outbox => return Ok(None),
    };
    let tab = match i.tab {
        None => None,
        Some(TabIn {
            kind: TabKind::Custom,
            custom_tab_id,
        }) => {
            let id = custom_tab_id.ok_or("custom_tab_requires_id")?;
            check_id(&id)?;
            Some(TabRef {
                kind: TabKind::Custom,
                custom_id: Some(id),
            })
        }
        Some(t) => Some(TabRef::of(t.kind)),
    };
    Ok(Some(ListInput {
        view,
        tab,
        after: i.after,
        limit: i.limit,
    }))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpArgsIn {
    pub mailbox_id: Option<String>,
    pub until_ms: Option<i64>,
    pub label: Option<String>,
    pub destination: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpIn {
    pub kind: OpKind,
    pub thread_ids: Vec<String>,
    #[serde(default)]
    pub args: Option<OpArgsIn>,
}

pub fn to_op_request(i: OpIn) -> Result<OpRequest, String> {
    if i.thread_ids.is_empty() || i.thread_ids.len() > MAX_IDS {
        return Err("invalid_thread_ids".into());
    }
    for t in &i.thread_ids {
        check_id(t)?;
    }
    let args = i.args.unwrap_or_default();
    let mut req = OpRequest::new(i.kind, i.thread_ids);
    match i.kind {
        OpKind::Move => {
            let to = args.mailbox_id.ok_or("move_requires_mailbox")?;
            check_id(&to)?;
            req.to_mailbox_id = Some(to);
        }
        OpKind::Snooze => {
            let until = args.until_ms.ok_or("snooze_requires_until")?;
            if until <= 0 {
                return Err("invalid_until".into());
            }
            req.snooze_until_ms = Some(until);
        }
        OpKind::LabelAdd | OpKind::LabelRemove => {
            // Gmail labels are folders: the label's mailbox id (MR gaps).
            let label = args.mailbox_id.ok_or("label_requires_mailbox")?;
            check_id(&label)?;
            req.to_mailbox_id = Some(label);
        }
        _ => {
            if let Some(m) = args.mailbox_id {
                check_id(&m)?;
                req.to_mailbox_id = Some(m);
            }
        }
    }
    Ok(req)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIn {
    pub query: SearchQuery,
    pub limit: u32,
    #[serde(default)]
    pub account_id: Option<String>,
}

pub fn to_search(i: SearchIn) -> Result<SearchQuery, String> {
    let mut q = i.query;
    if let Some(a) = &i.account_id {
        check_id(a)?;
    }
    q.account_id = i.account_id;
    q.limit = i.limit.clamp(1, 500);
    Ok(q)
}

#[tauri::command]
pub fn mail_list_accounts(host: State<'_, MailHost>) -> Result<Vec<AccountRow>, String> {
    list_accounts(&*host.store()?)
}

#[tauri::command]
pub fn mail_list_mailboxes(
    account_id: String,
    host: State<'_, MailHost>,
) -> Result<Vec<MailboxRow>, String> {
    check_id(&account_id)?;
    host.store()?.list_mailboxes(&account_id).map_err(s)
}

#[tauri::command]
pub fn mail_list_threads(input: ListIn, host: State<'_, MailHost>) -> Result<ListPage, String> {
    // Follow-ups, New senders and Outbox are small: one unpaged window.
    let extra = match input.view {
        ViewIn::Followups => Some(host.store()?.followup_rows(now_ms())),
        ViewIn::NewSenders => Some(host.store()?.new_sender_rows()),
        ViewIn::Outbox => Some(host.store()?.outbox_rows()),
        _ => None,
    };
    if let Some(rows) = extra {
        let rows = if input.after.is_some() { vec![] } else { rows.map_err(s)? };
        return Ok(ListPage { rows, next: None });
    }
    match to_list_input(input)? {
        Some(i) => host.store()?.list_threads(&i).map_err(s),
        None => Ok(ListPage {
            rows: vec![],
            next: None,
        }),
    }
}

#[tauri::command]
pub fn mail_counts(host: State<'_, MailHost>) -> Result<Counts, String> {
    host.store()?.counts().map_err(s)
}

#[tauri::command]
pub fn mail_get_thread(
    thread_id: String,
    host: State<'_, MailHost>,
) -> Result<Option<ThreadDetail>, String> {
    check_id(&thread_id)?;
    let store = host.store()?;
    let detail = store.get_thread(&thread_id).map_err(s)?;
    // Opening a thread downloads what it lacks; the reader re-reads on the event.
    if let Some(d) = &detail {
        if store.thread_needs_bodies(&thread_id).unwrap_or(false) {
            host.ondemand.load_thread_bg(
                store.clone(),
                host.events.clone(),
                d.row.account_id.clone(),
                thread_id.clone(),
            );
        }
    }
    Ok(detail)
}

fn changed(host: &MailHost, thread_ids: Vec<String>) {
    host.events.emit(MailEvent::ThreadsChanged {
        view_keys: vec![],
        thread_ids,
    });
    if let Ok(counts) = host.store().and_then(|st| st.counts().map_err(s)) {
        host.events.emit(MailEvent::Counts { counts });
    }
}

/// Applies locally now; the returned id is the action's undo handle.
#[tauri::command]
pub fn mail_apply_op(input: OpIn, host: State<'_, MailHost>) -> Result<Value, String> {
    let req = to_op_request(input)?;
    let ids = req.thread_ids.clone();
    let h = host.store()?.enqueue_op(&req).map_err(s)?;
    changed(&host, ids);
    Ok(json!({ "opIds": [h.action_id] }))
}

#[tauri::command]
pub fn mail_undo_op(op_id: String, host: State<'_, MailHost>) -> Result<(), String> {
    check_id(&op_id)?;
    match host.store()?.undo_action(&op_id).map_err(s)? {
        UndoOutcome::Nothing => {}
        UndoOutcome::Cancelled | UndoOutcome::Compensated(_) => changed(&host, vec![]),
    }
    Ok(())
}

#[tauri::command]
pub fn mail_list_failed_ops(host: State<'_, MailHost>) -> Result<Vec<Value>, String> {
    let store = host.store()?;
    let ops = store.failed_ops().map_err(s)?;
    Ok(ops
        .into_iter()
        .map(|o| {
            let created: i64 = store
                .r()
                .query_row(
                    "SELECT created_at_ms FROM ops WHERE id = ?1",
                    [&o.id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            json!({
                "opId": o.id,
                "kind": o.kind,
                "threadIds": o.thread_ids,
                "state": "failed",
                "attempts": o.attempts,
                "lastError": o.error,
                "createdAtMs": created,
            })
        })
        .collect())
}

#[tauri::command]
pub fn mail_retry_op(op_id: String, host: State<'_, MailHost>) -> Result<(), String> {
    check_id(&op_id)?;
    host.store()?.retry_op(&op_id, now_ms()).map_err(s)?;
    Ok(())
}

#[tauri::command]
pub fn mail_discard_op(op_id: String, host: State<'_, MailHost>) -> Result<(), String> {
    check_id(&op_id)?;
    if host.store()?.discard_op(&op_id).map_err(s)? {
        changed(&host, vec![]);
    }
    Ok(())
}

#[tauri::command]
pub fn mail_search(input: SearchIn, host: State<'_, MailHost>) -> Result<Vec<ThreadRow>, String> {
    let q = to_search(input)?;
    host.store()?.search(&q).map_err(s)
}

#[tauri::command]
pub fn mail_set_foreground(foreground: bool, host: State<'_, MailHost>) {
    host.set_foreground(foreground);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(v: Value) -> Result<Option<ListInput>, String> {
        to_list_input(serde_json::from_value(v).map_err(s)?)
    }

    #[test]
    fn list_inputs_map_from_the_ts_shape() {
        let i = list(json!({"view": {"kind": "unified", "role": "inbox"}, "tab": {"kind": "personal"}, "limit": 50}))
            .unwrap()
            .unwrap();
        assert_eq!(i.view, ViewRef::Unified(MailboxRole::Inbox));
        assert_eq!(i.tab, Some(TabRef::of(TabKind::Personal)));
        let i = list(json!({"view": {"kind": "mailbox", "mailboxId": "m1"}, "tab": {"kind": "custom", "customTabId": "t"},
            "after": {"lastDateMs": 5, "threadId": "x"}, "limit": 10}))
        .unwrap()
        .unwrap();
        assert_eq!(i.view, ViewRef::Mailbox("m1".into()));
        assert_eq!(i.tab.unwrap().encode(), "custom:t");
        assert_eq!(i.after.unwrap().thread_id, "x");
        assert!(list(json!({"view": {"kind": "outbox"}, "limit": 10})).unwrap().is_none());
        assert!(list(json!({"view": {"kind": "mailbox", "mailboxId": ""}, "limit": 10})).is_err());
        assert!(list(json!({"view": {"kind": "unified", "role": "nope"}, "limit": 10})).is_err());
    }

    fn op(v: Value) -> Result<OpRequest, String> {
        to_op_request(serde_json::from_value(v).map_err(s)?)
    }

    #[test]
    fn op_inputs_are_validated() {
        let r = op(json!({"kind": "move", "threadIds": ["t1"], "args": {"mailboxId": "a-archive"}})).unwrap();
        assert_eq!(r.to_mailbox_id.as_deref(), Some("a-archive"));
        assert!(op(json!({"kind": "move", "threadIds": ["t1"]})).is_err());
        assert_eq!(
            op(json!({"kind": "snooze", "threadIds": ["t"], "args": {"untilMs": 9}})).unwrap().snooze_until_ms,
            Some(9)
        );
        assert!(op(json!({"kind": "done", "threadIds": []})).is_err());
        assert!(op(json!({"kind": "bogus", "threadIds": ["t"]})).is_err());
        let l = op(json!({"kind": "label_add", "threadIds": ["t"], "args": {"mailboxId": "g-work"}})).unwrap();
        assert_eq!(l.to_mailbox_id.as_deref(), Some("g-work"));
        assert!(op(json!({"kind": "label_remove", "threadIds": ["t"]})).is_err());
        assert!(op(json!({"kind": "done", "threadIds": ["x".repeat(600)]})).is_err());
    }

    #[test]
    fn search_input_carries_limit_and_account() {
        let q = to_search(serde_json::from_value(json!({"query": {"words": ["hi"], "inRole": "inbox"}, "limit": 9999, "accountId": "a"})).unwrap()).unwrap();
        assert_eq!(q.limit, 500);
        assert_eq!(q.account_id.as_deref(), Some("a"));
        assert_eq!(q.in_role, Some(MailboxRole::Inbox));
    }
}
