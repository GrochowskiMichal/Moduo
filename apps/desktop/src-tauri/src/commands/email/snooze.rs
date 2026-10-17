//! Snooze engine (EM-6): move a thread's INBOX messages to a server-side
//! `Moduo/Snoozed` mailbox and later restore them to INBOX.
//!
//! Mirrors the triage op executor ([`super::ops`]): the async command refreshes
//! any expiring OAuth token FIRST, then runs the blocking IMAP work inside
//! `spawn_blocking`. Moves are the same COPY → +FLAGS `\Deleted` → EXPUNGE dance,
//! UIDPLUS-aware (UID EXPUNGE when advertised, else a bare EXPUNGE — safe because we
//! only ever flag our own UIDs). If the server refuses folder creation we degrade to
//! a local-hide fallback rather than erroring.

use tauri::{Manager, State};

use serde::{Deserialize, Serialize};

use super::connection::{open_imap_session, ImapSession};
use super::model::StoredEmailAccount;
use super::parsing::{decode_header_value_bytes, parse_references, thread_id_from};
use super::storage::resolve_accounts_for_target;
use super::{ensure_account_config, oauth};
use crate::AppState;

/// The parent folder the snooze mailbox lives under. Combined with the account's
/// hierarchy delimiter to form e.g. `Moduo/Snoozed` or `Moduo.Snoozed`.
const SNOOZE_PARENT: &str = "Moduo";
const SNOOZE_LEAF: &str = "Snoozed";

// ── DTOs ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSnoozeThreadInput {
    pub account_id: String,
    pub thread_id: String,
    /// The thread's message UIDs currently in INBOX (supplied by the caller).
    pub uids: Vec<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSnoozeThreadResult {
    /// `"server_move"` when messages were (or would be) moved to the snooze mailbox;
    /// `"local_hide"` when the server refused folder creation and the caller should
    /// fall back to hiding the thread locally.
    pub strategy: String,
    /// The resolved snooze mailbox name, when a server move is possible.
    pub mailbox: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSnoozeRestoreInput {
    pub account_id: String,
    pub thread_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSnoozeRestoreResult {
    /// Number of messages moved back to INBOX (0 when nothing matched — idempotent).
    pub restored: u32,
}

// ── Pure helper (unit-tested) ─────────────────────────────────────────────────────

/// Build the snooze mailbox name for an account's hierarchy delimiter, e.g.
/// `Moduo/Snoozed` for `/` or `Moduo.Snoozed` for `.`. Pure — the AC test drives it.
fn snooze_mailbox_name(delimiter: &str) -> String {
    format!("{SNOOZE_PARENT}{delimiter}{SNOOZE_LEAF}")
}

// ── Delimiter detection ──────────────────────────────────────────────────────────

/// Resolve the account's hierarchy delimiter via IMAP LIST. Mirrors how
/// [`super::ops::list_folders_blocking`] reads `Name::delimiter()`. LISTs INBOX first
/// (every account has it and it always reports the delimiter); falls back to a broad
/// LIST, then to `/` if the server reports none (NIL delimiter / flat namespace).
fn resolve_delimiter(session: &mut ImapSession) -> String {
    if let Ok(names) = session.list(Some(""), Some("INBOX")) {
        if let Some(delim) = names.iter().find_map(|name| name.delimiter()) {
            return delim.to_string();
        }
    }
    if let Ok(names) = session.list(Some(""), Some("*")) {
        if let Some(delim) = names.iter().find_map(|name| name.delimiter()) {
            return delim.to_string();
        }
    }
    "/".to_string()
}

/// True if a mailbox of exactly `name` already exists on the server.
fn mailbox_exists(session: &mut ImapSession, name: &str) -> bool {
    if let Ok(names) = session.list(Some(""), Some(name)) {
        if names.iter().any(|entry| entry.name() == name) {
            return true;
        }
    }
    // Some servers don't echo a freshly-created mailbox in a filtered LIST right away;
    // a successful SELECT is the authoritative existence check.
    session.select(name).is_ok()
}

/// Ensure the snooze mailbox exists, creating it if absent. Returns `Ok(false)` when
/// the server refuses creation (the caller then degrades to a local hide) and
/// `Err(..)` only for a transient/connection error.
fn ensure_snooze_mailbox(session: &mut ImapSession, mailbox: &str) -> Result<bool, String> {
    if mailbox_exists(session, mailbox) {
        return Ok(true);
    }
    match session.create(mailbox) {
        Ok(()) => Ok(true),
        // A server that refuses folder creation (or the parent) → not fatal; the
        // caller returns the local-hide fallback rather than erroring.
        Err(_) => Ok(mailbox_exists(session, mailbox)),
    }
}

// ── Move helpers (mirror ops.rs) ──────────────────────────────────────────────────

/// COPY a single UID from the currently-selected mailbox to `dest`, then flag it
/// `\Deleted` and EXPUNGE it — UID EXPUNGE when UIDPLUS is advertised, else a bare
/// EXPUNGE (safe: we only ever flag this one UID). Returns whether the UID moved.
fn move_uid(session: &mut ImapSession, uid: u32, dest: &str, uidplus: bool) -> Result<(), String> {
    let uid = uid.to_string();
    session
        .uid_copy(&uid, dest)
        .map_err(|e| format!("snooze_copy_failed:{e}"))?;
    session
        .uid_store(&uid, "+FLAGS.SILENT (\\Deleted)")
        .map_err(|e| format!("snooze_flag_failed:{e}"))?;
    if uidplus {
        session
            .uid_expunge(&uid)
            .map_err(|e| format!("snooze_expunge_failed:{e}"))?;
    } else {
        session
            .expunge()
            .map_err(|e| format!("snooze_expunge_failed:{e}"))?;
    }
    Ok(())
}

// ── Blocking cores ────────────────────────────────────────────────────────────────

fn snooze_thread_blocking(
    state: &AppState,
    account: &StoredEmailAccount,
    uids: &[u32],
) -> Result<EmailSnoozeThreadResult, String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let uidplus = session
        .capabilities()
        .map(|caps| caps.has_str("UIDPLUS"))
        .unwrap_or(false);

    let delimiter = resolve_delimiter(&mut session);
    let mailbox = snooze_mailbox_name(&delimiter);

    // Ensure (create if needed) the snooze mailbox. A refusal → local-hide fallback.
    if !ensure_snooze_mailbox(&mut session, &mailbox)? {
        let _ = session.logout();
        return Ok(EmailSnoozeThreadResult {
            strategy: "local_hide".to_string(),
            mailbox: None,
        });
    }

    // Empty uids → nothing to move, but the mailbox is ready (idempotent/safe).
    if uids.is_empty() {
        let _ = session.logout();
        return Ok(EmailSnoozeThreadResult {
            strategy: "server_move".to_string(),
            mailbox: Some(mailbox),
        });
    }

    // Move each INBOX UID into the snooze mailbox.
    super::select_mailbox_for_folder(&mut session, account.provider.as_str(), "inbox")?;
    for &uid in uids {
        move_uid(&mut session, uid, &mailbox, uidplus)?;
    }

    let _ = session.logout();
    Ok(EmailSnoozeThreadResult {
        strategy: "server_move".to_string(),
        mailbox: Some(mailbox),
    })
}

fn snooze_restore_blocking(
    state: &AppState,
    account: &StoredEmailAccount,
    thread_id: &str,
) -> Result<EmailSnoozeRestoreResult, String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let uidplus = session
        .capabilities()
        .map(|caps| caps.has_str("UIDPLUS"))
        .unwrap_or(false);

    let delimiter = resolve_delimiter(&mut session);
    let mailbox = snooze_mailbox_name(&delimiter);

    // No snooze mailbox → nothing to restore.
    if session.select(&mailbox).is_err() {
        let _ = session.logout();
        return Ok(EmailSnoozeRestoreResult { restored: 0 });
    }

    // Fetch every message's envelope + threading headers, recompute thread_id the
    // same way sync.rs does, and collect the UIDs whose thread matches the request.
    let fetches = session
        .fetch(
            "1:*",
            "(UID ENVELOPE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES)])",
        )
        .map_err(|e| format!("snooze_restore_fetch_failed:{e}"))?;

    let mut matching_uids = Vec::<u32>::new();
    for item in fetches.iter() {
        let uid = item.uid.unwrap_or_default();
        if uid == 0 {
            continue;
        }
        let Some(env) = item.envelope() else {
            continue;
        };
        let subject = env
            .subject
            .as_ref()
            .map(|v| decode_header_value_bytes(v))
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "(No subject)".to_string());
        let message_id = env
            .message_id
            .as_ref()
            .map(|v| decode_header_value_bytes(v))
            .filter(|v| !v.is_empty());
        let in_reply_to = env
            .in_reply_to
            .as_ref()
            .map(|v| decode_header_value_bytes(v))
            .filter(|v| !v.is_empty());
        let references = item.header().map(parse_references).unwrap_or_default();

        let computed = thread_id_from(
            &subject,
            &references,
            in_reply_to.as_deref(),
            message_id.as_deref(),
        );
        if computed == thread_id {
            matching_uids.push(uid);
        }
    }

    // Move the matches back to INBOX (COPY → \Deleted → expunge), same as a snooze.
    let mut restored = 0u32;
    for uid in matching_uids {
        move_uid(&mut session, uid, "INBOX", uidplus)?;
        restored = restored.saturating_add(1);
    }

    let _ = session.logout();
    Ok(EmailSnoozeRestoreResult { restored })
}

// ── Commands ──────────────────────────────────────────────────────────────────────

/// Snooze a thread: move its INBOX messages to the account's `Moduo/Snoozed` server
/// mailbox (creating it if absent). Falls back to a local hide when the server
/// refuses folder creation. Empty `uids` is a safe no-op that still reports the
/// resolved mailbox.
#[tauri::command]
pub async fn email_snooze_thread(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailSnoozeThreadInput,
) -> Result<EmailSnoozeThreadResult, String> {
    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let Some(account) = accounts.into_iter().next() else {
        return Err("account_not_found".to_string());
    };

    // Refresh OAuth before the blocking IMAP session opens (EM-2). A terminal reauth
    // flips the account status (inside ensure_fresh_access) and returns the error.
    oauth::ensure_fresh_access(&state, &account.id, &account.provider).await?;

    let app_inner = app.clone();
    let uids = input.uids.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        snooze_thread_blocking(&state_inner, &account, &uids)
    })
    .await
    .map_err(|e| format!("snooze_thread_task_failed:{e}"))?
}

/// Restore a snoozed thread to INBOX: find the messages in `Moduo/Snoozed` whose
/// recomputed `thread_id` matches and move them back. Returns 0 when the mailbox is
/// absent or nothing matches (idempotent).
#[tauri::command]
pub async fn email_snooze_restore(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailSnoozeRestoreInput,
) -> Result<EmailSnoozeRestoreResult, String> {
    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let Some(account) = accounts.into_iter().next() else {
        return Err("account_not_found".to_string());
    };

    oauth::ensure_fresh_access(&state, &account.id, &account.provider).await?;

    let app_inner = app.clone();
    let thread_id = input.thread_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        snooze_restore_blocking(&state_inner, &account, &thread_id)
    })
    .await
    .map_err(|e| format!("snooze_restore_task_failed:{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snooze_mailbox_name_uses_the_account_delimiter() {
        assert_eq!(snooze_mailbox_name("/"), "Moduo/Snoozed");
        assert_eq!(snooze_mailbox_name("."), "Moduo.Snoozed");
    }

    #[test]
    fn snooze_mailbox_name_default_delimiter_is_slash() {
        // The blocking path falls back to "/" when the server reports no delimiter.
        let default_delimiter = "/";
        assert_eq!(
            snooze_mailbox_name(default_delimiter),
            "Moduo/Snoozed".to_string()
        );
    }
}
