use std::collections::HashMap;

use tauri::{Manager, State};

use self::account_config::{ensure_account_config, select_mailbox_for_folder};
use self::body_fetch::fetch_body_from_imap;
use self::constants::*;
use self::flags::{
    flush_flag_outbox_for_account, queue_flag_outbox, update_envelope_flag_optimistic,
};
use self::parsing::decode_maybe_mime_header;
use self::ops::{flush_op_outbox_for_account, list_folders_blocking, queue_op};
use self::storage::{
    envelope_key, get_body_cache, list_envelopes_filtered, parse_json_value,
    patch_account_sync_state, remove_body_cache, remove_envelope, resolve_accounts_for_target,
    touch_body_cache,
};
use self::sync::sync_account_folder_envelopes;
use crate::email_sync::{
    now_iso, EmailActivityStateRecord, EMAIL_BODY_MAX_BYTES_PER_ACCOUNT,
    EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT, EMAIL_DEFAULT_LIST_LIMIT, EMAIL_PREFETCH_DEFAULT_LIMIT,
};
use crate::AppState;

pub mod account_commands;
mod account_config;
pub mod attachments;
mod body_fetch;
mod connection;
mod constants;
mod flags;
mod graph_outbox;
mod model;
pub mod oauth;
mod ops;
mod parsing;
mod realtime;
pub mod search;
mod secrets;
pub mod send_commands;
mod smtp;
pub mod snooze;
mod storage;
mod sync;

use self::graph_outbox::{queue_graph_upsert_for_envelope, schedule_graph_outbox_flush};
pub(super) use self::model::*;
pub use self::realtime::{bootstrap_idle_workers, stop_all_idle_workers};
use self::realtime::{schedule_idle_worker_reconcile, try_acquire_sync_permit};

#[tauri::command]
pub async fn email_sync_now(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailSyncNowInput,
) -> Result<EmailSyncNowResult, String> {
    let folder = input
        .folder
        .clone()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "inbox".to_string());
    let target_key = input
        .account_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(ALL_ACCOUNTS_ID);
    let sync_key = format!("{}::{}", target_key, folder);
    let Some(_permit) = try_acquire_sync_permit(sync_key) else {
        return Ok(EmailSyncNowResult {
            synced_accounts: 0,
            synced_at: now_iso(),
        });
    };
    let accounts = resolve_accounts_for_target(&state, input.account_id.as_deref())?;

    // Refresh any expiring OAuth access tokens on the async side, before the
    // blocking IMAP work reads them (EM-2). Per-account errors surface via the sync.
    for account in &accounts {
        let _ = oauth::ensure_fresh_access(&state, &account.id, &account.provider).await;
    }

    // IMAP I/O is blocking — must run on a blocking thread to avoid freezing the async executor.
    let app_inner = app.clone();
    let account_id_filter = input.account_id.clone();
    let (synced_accounts, synced_at) = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        let mut synced = 0usize;
        for account in accounts {
            match sync_account_folder_envelopes(&state_inner, &account, &folder, false) {
                Ok(()) => {
                    synced = synced.saturating_add(1);
                    let _ = patch_account_sync_state(&state_inner, &account.id, "active", None);
                    let _ = flush_flag_outbox_for_account(&state_inner, &account);
                    let _ = flush_op_outbox_for_account(&state_inner, &account);
                }
                Err(error) => {
                    let status = if error.contains("reauth_required") {
                        "reauth_required"
                    } else {
                        "error"
                    };
                    let _ =
                        patch_account_sync_state(&state_inner, &account.id, status, Some(error));
                }
            }
        }
        schedule_graph_outbox_flush(&state_inner, account_id_filter);
        (synced, now_iso())
    })
    .await
    .map_err(|e| format!("sync_task_failed:{e}"))?;

    Ok(EmailSyncNowResult {
        synced_accounts,
        synced_at,
    })
}

#[tauri::command]
pub async fn email_list_envelopes(
    state: State<'_, AppState>,
    input: EmailListEnvelopesInput,
) -> Result<EmailListEnvelopesResult, String> {
    let folder = input.folder.trim().to_lowercase();
    let limit = input
        .limit
        .unwrap_or(EMAIL_DEFAULT_LIST_LIMIT)
        .max(1)
        .min(500);
    let force_sync = input.force_sync.unwrap_or(false);
    let target_account = input.account_id.as_deref();

    let account_filter = if matches!(target_account, Some(ALL_ACCOUNTS_ID) | None) {
        None
    } else {
        target_account
    };

    let mut local_rows = list_envelopes_filtered(&state, account_filter, &folder)?;
    if force_sync {
        let accounts = resolve_accounts_for_target(&state, target_account)?;
        for account in &accounts {
            let _ = oauth::ensure_fresh_access(&state, &account.id, &account.provider).await;
        }
        for account in accounts {
            match sync_account_folder_envelopes(&state, &account, &folder, force_sync) {
                Ok(()) => {
                    let _ = patch_account_sync_state(&state, &account.id, "active", None);
                    let _ = flush_flag_outbox_for_account(&state, &account);
                    let _ = flush_op_outbox_for_account(&state, &account);
                }
                Err(error) => {
                    let status = if error.contains("reauth_required") {
                        "reauth_required"
                    } else {
                        "error"
                    };
                    let _ = patch_account_sync_state(&state, &account.id, status, Some(error));
                }
            }
        }
        schedule_graph_outbox_flush(&state, target_account.map(|value| value.to_string()));
        local_rows = list_envelopes_filtered(&state, account_filter, &folder)?;
    }

    local_rows.truncate(limit);
    let envelopes = local_rows
        .into_iter()
        .map(|item| envelope_to_dto(&state, item))
        .collect::<Vec<_>>();

    if let Some(account_id) = account_filter {
        let ui_key = format!("{}{}", EMAIL_FOLDER_UI_STATE_PREFIX, account_id);
        let _ = state.store.put_email_ui_state(
            &ui_key,
            &serde_json::json!({
                "accountId": account_id,
                "folder": folder,
                "updatedAt": now_iso(),
            }),
        );
    }

    Ok(EmailListEnvelopesResult {
        total: envelopes.len(),
        envelopes,
        synced_at: now_iso(),
    })
}

/// Map a stored envelope to the wire DTO (MIME-decoding display headers + a
/// body-cache probe). Shared by the list and thread reads.
fn envelope_to_dto(state: &AppState, item: StoredEnvelope) -> EmailEnvelopeDto {
    let has_cached_body = get_body_cache(state, &item.account_id, &item.folder, item.uid).is_some();
    EmailEnvelopeDto {
        id: item.id,
        message_key: item.message_key,
        account_id: item.account_id,
        folder: item.folder,
        uid: item.uid,
        sender: decode_maybe_mime_header(&item.sender),
        sender_email: item.sender_email,
        to: item.to,
        cc: item.cc,
        subject: decode_maybe_mime_header(&item.subject),
        preview: decode_maybe_mime_header(&item.preview),
        date: item.date,
        read: item.read,
        starred: item.starred,
        size: item.size,
        message_id: item.message_id,
        in_reply_to: item.in_reply_to,
        references: item.references,
        list_unsubscribe: item.list_unsubscribe,
        precedence: item.precedence,
        auto_submitted: item.auto_submitted,
        thread_id: item.thread_id,
        has_cached_body,
    }
}

/// All messages of a thread (EM-4), oldest → newest, across folders, deduped by
/// Message-ID so a Gmail thread appearing in INBOX + All Mail shows once.
#[tauri::command]
pub async fn email_get_thread(
    state: State<'_, AppState>,
    input: EmailGetThreadInput,
) -> Result<EmailGetThreadResult, String> {
    let mut rows = state
        .store
        .list_email_envelopes()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredEnvelope>)
        .filter(|row| row.account_id == input.account_id && row.thread_id == input.thread_id)
        .collect::<Vec<_>>();

    rows.sort_by(|a, b| {
        a.timestamp_ms
            .cmp(&b.timestamp_ms)
            .then_with(|| a.uid.cmp(&b.uid))
    });

    let mut seen = std::collections::HashSet::new();
    let messages = rows
        .into_iter()
        .filter(|row| {
            // Dedup by Message-ID when present, else by the per-folder key.
            let key = row
                .message_id
                .clone()
                .unwrap_or_else(|| row.message_key.clone());
            seen.insert(key)
        })
        .map(|item| envelope_to_dto(&state, item))
        .collect::<Vec<_>>();

    Ok(EmailGetThreadResult {
        thread_id: input.thread_id,
        messages,
    })
}

#[tauri::command]
pub async fn email_get_message_body(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailGetMessageBodyInput,
) -> Result<EmailGetMessageBodyResult, String> {
    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let Some(account) = accounts.into_iter().next() else {
        return Err("account_not_found".to_string());
    };

    // Serve from cache without touching the network.
    if let Some(cached) = get_body_cache(&state, &input.account_id, &input.folder, input.uid) {
        let _ = touch_body_cache(&state, &cached);
        return Ok(EmailGetMessageBodyResult {
            account_id: input.account_id,
            folder: input.folder,
            uid: input.uid,
            body: cached.body,
            body_html: cached.body_html,
            cached: true,
            fetched_at: cached.fetched_at,
        });
    }

    // Cache miss — fetch from IMAP. Must run on a blocking thread.
    let app_inner = app.clone();
    let account_id = input.account_id.clone();
    let folder = input.folder.clone();
    let uid = input.uid;
    let fresh = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        match fetch_body_from_imap(&state_inner, &account, &folder, uid) {
            Ok(body_cache) => {
                if let Some(envelope) = state_inner
                    .store
                    .get_email_envelope(&envelope_key(&account_id, &folder, uid))
                    .ok()
                    .flatten()
                    .and_then(parse_json_value::<StoredEnvelope>)
                {
                    let _ = queue_graph_upsert_for_envelope(&state_inner, &envelope);
                }
                schedule_graph_outbox_flush(&state_inner, Some(account_id));
                Ok(body_cache)
            }
            Err(e) => Err(e),
        }
    })
    .await
    .map_err(|e| format!("body_fetch_task_failed:{e}"))??;

    Ok(EmailGetMessageBodyResult {
        account_id: input.account_id,
        folder: input.folder,
        uid: input.uid,
        body: fresh.body,
        body_html: fresh.body_html,
        cached: false,
        fetched_at: fresh.fetched_at,
    })
}

#[tauri::command]
pub async fn email_prefetch_bodies(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailPrefetchBodiesInput,
) -> Result<EmailPrefetchBodiesResult, String> {
    let limit = input
        .limit
        .unwrap_or(EMAIL_PREFETCH_DEFAULT_LIMIT)
        .max(1)
        .min(50);
    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let Some(account) = accounts.into_iter().next() else {
        return Err("account_not_found".to_string());
    };

    // Prefetch runs on a blocking thread — IMAP I/O must not block the async executor.
    let app_inner = app.clone();
    let account_id = input.account_id.clone();
    let folder = input.folder.clone();
    let uids = input.uids;

    let prefetched = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        let mut count = 0usize;
        for uid in uids.into_iter().take(limit) {
            if get_body_cache(&state_inner, &account_id, &folder, uid).is_some() {
                continue;
            }
            if fetch_body_from_imap(&state_inner, &account, &folder, uid).is_ok() {
                if let Some(envelope) = state_inner
                    .store
                    .get_email_envelope(&envelope_key(&account_id, &folder, uid))
                    .ok()
                    .flatten()
                    .and_then(parse_json_value::<StoredEnvelope>)
                {
                    let _ = queue_graph_upsert_for_envelope(&state_inner, &envelope);
                }
                count = count.saturating_add(1);
            }
        }
        schedule_graph_outbox_flush(&state_inner, Some(account_id));
        count
    })
    .await
    .unwrap_or(0);

    Ok(EmailPrefetchBodiesResult { prefetched })
}

#[tauri::command]
pub async fn email_set_activity_state(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailSetActivityStateInput,
) -> Result<(), String> {
    // Persist activity state so IDLE workers can read poll intervals.
    let record = EmailActivityStateRecord {
        mode: input.mode.clone(),
        active_account_id: input.active_account_id.clone(),
        active_folder: input.active_folder.clone(),
        updated_at: now_iso(),
    };
    state
        .store
        .put_email_ui_state(
            EMAIL_ACTIVITY_UI_STATE_KEY,
            &serde_json::to_value(record).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

    // Worker topology changes are supervised + debounced to prevent rapid folder-switch thrash.
    schedule_idle_worker_reconcile(&app, true);

    Ok(())
}

#[tauri::command]
pub async fn email_apply_flag(
    state: State<'_, AppState>,
    input: EmailApplyFlagInput,
) -> Result<EmailApplyFlagResult, String> {
    let flag = input.flag.trim().to_lowercase();
    if flag != "seen" && flag != "starred" {
        return Err("unsupported_flag".to_string());
    }

    update_envelope_flag_optimistic(
        &state,
        &input.account_id,
        &input.folder,
        input.uid,
        &flag,
        input.value,
    )?;
    let _ = queue_flag_outbox(
        &state,
        &input.account_id,
        &input.folder,
        input.uid,
        &flag,
        input.value,
    )?;

    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let synced = if let Some(account) = accounts.first() {
        flush_flag_outbox_for_account(&state, account).unwrap_or(false)
    } else {
        false
    };

    Ok(EmailApplyFlagResult {
        accepted: true,
        synced,
    })
}

/// LIST the account's server folders (delimiter-aware) for the move popover (EM-5).
#[tauri::command]
pub async fn email_list_folders(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailListFoldersInput,
) -> Result<Vec<EmailFolderDto>, String> {
    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let Some(account) = accounts.into_iter().next() else {
        return Err("account_not_found".to_string());
    };
    // Best-effort OAuth refresh before the blocking LIST.
    let _ = oauth::ensure_fresh_access(&state, &account.id, &account.provider).await;

    let app_inner = app.clone();
    let folders = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        list_folders_blocking(&state_inner, &account)
    })
    .await
    .map_err(|e| format!("list_folders_task_failed:{e}"))??;
    Ok(folders)
}

/// Archive / move / delete a message (EM-5). Optimistic: the envelope leaves the
/// folder locally right away; the IMAP step queues in the op outbox and flushes on
/// a blocking thread (retrying on the next sync if it fails now).
#[tauri::command]
pub async fn email_apply_message_op(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailApplyMessageOpInput,
) -> Result<EmailApplyMessageOpResult, String> {
    let op = input.op.trim().to_lowercase();
    if !matches!(op.as_str(), "archive" | "move" | "delete") {
        return Err("unsupported_op".to_string());
    }
    if op == "move"
        && input
            .dest_folder
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return Err("missing_dest_folder".to_string());
    }

    // Optimistic: drop the envelope from the source folder immediately so the row
    // leaves the list now. If the queued op ultimately fails, the next full sync
    // brings it back (it's still on the server).
    let _ = remove_envelope(&state, &input.account_id, &input.folder, input.uid);
    let _ = remove_body_cache(&state, &input.account_id, &input.folder, input.uid);
    queue_op(
        &state,
        &input.account_id,
        &input.folder,
        input.uid,
        &op,
        input.dest_folder.as_deref(),
    )?;

    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let synced = if let Some(account) = accounts.into_iter().next() {
        // Refresh OAuth before the blocking flush opens an IMAP session.
        let _ = oauth::ensure_fresh_access(&state, &account.id, &account.provider).await;
        let app_inner = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let state_inner = app_inner.state::<AppState>();
            flush_op_outbox_for_account(&state_inner, &account).unwrap_or(false)
        })
        .await
        .unwrap_or(false)
    } else {
        false
    };

    Ok(EmailApplyMessageOpResult {
        accepted: true,
        synced,
    })
}

#[tauri::command]
pub async fn email_get_mailbox_status(
    state: State<'_, AppState>,
    input: EmailMailboxStatusInput,
) -> Result<Vec<EmailMailboxStatusRow>, String> {
    let account_filter = input.account_id.as_deref();
    let rows = state
        .store
        .list_email_envelopes()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredEnvelope>)
        .filter(|row| {
            account_filter
                .map(|account_id| row.account_id == account_id)
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();

    let mut grouped: HashMap<(String, String), EmailMailboxStatusRow> = HashMap::new();
    for row in rows {
        let key = (row.account_id.clone(), row.folder.clone());
        let entry = grouped.entry(key).or_insert(EmailMailboxStatusRow {
            account_id: row.account_id.clone(),
            folder: row.folder.clone(),
            total: 0,
            unread: 0,
            starred: 0,
        });
        entry.total = entry.total.saturating_add(1);
        if !row.read {
            entry.unread = entry.unread.saturating_add(1);
        }
        if row.starred {
            entry.starred = entry.starred.saturating_add(1);
        }
    }

    let mut result = grouped.into_values().collect::<Vec<_>>();
    result.sort_by(|a, b| {
        a.account_id
            .cmp(&b.account_id)
            .then_with(|| a.folder.cmp(&b.folder))
    });
    Ok(result)
}

// ── Legacy commands removed ────────────────────────────────────────────────────
// email_fetch_saved, email_connect, email_fetch, email_send have been removed.
// They used the old seq-number based fetch path which:
//   - used IMAP sequence numbers instead of UIDs
//   - fetched bodies inline for all 20 messages
//   - bypassed the StoredEnvelope / Redb persistence system
//   - opened a new IMAP connection per command call
//
// Migration:
//   Old                 → New
//   email_connect       → email_account_connect_and_save
//   email_fetch_saved   → email_list_envelopes (envelopes) + email_get_message_body (body)
//   email_fetch         → email_list_envelopes
//   email_send          → email_send_saved
// ────────────────────────────────────────────────────────────────────────────────
