use std::collections::HashMap;

use tauri::{Manager, State};

use self::account_config::{ensure_account_config, select_mailbox_for_folder};
use self::body_fetch::fetch_body_from_imap;
use self::constants::*;
use self::flags::{
    flush_flag_outbox_for_account, queue_flag_outbox, update_envelope_flag_optimistic,
};
use self::parsing::decode_maybe_mime_header;
use self::storage::{
    envelope_key, get_body_cache, list_envelopes_filtered, parse_json_value,
    patch_account_sync_state, resolve_accounts_for_target, touch_body_cache,
};
use self::sync::sync_account_folder_envelopes;
use crate::email_sync::{
    now_iso, EmailActivityStateRecord, EMAIL_BODY_MAX_BYTES_PER_ACCOUNT,
    EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT, EMAIL_DEFAULT_LIST_LIMIT, EMAIL_PREFETCH_DEFAULT_LIMIT,
};
use crate::AppState;

pub mod account_commands;
mod account_config;
mod body_fetch;
mod connection;
mod constants;
mod flags;
mod graph_outbox;
mod model;
mod parsing;
mod realtime;
pub mod send_commands;
mod smtp;
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
        for account in accounts {
            match sync_account_folder_envelopes(&state, &account, &folder, force_sync) {
                Ok(()) => {
                    let _ = patch_account_sync_state(&state, &account.id, "active", None);
                    let _ = flush_flag_outbox_for_account(&state, &account);
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
        .map(|item| EmailEnvelopeDto {
            id: item.id,
            message_key: item.message_key,
            account_id: item.account_id.clone(),
            folder: item.folder.clone(),
            uid: item.uid,
            sender: decode_maybe_mime_header(&item.sender),
            sender_email: item.sender_email,
            to: item.to,
            subject: decode_maybe_mime_header(&item.subject),
            preview: decode_maybe_mime_header(&item.preview),
            date: item.date,
            read: item.read,
            starred: item.starred,
            size: item.size,
            message_id: item.message_id,
            in_reply_to: item.in_reply_to,
            thread_id: item.thread_id,
            has_cached_body: get_body_cache(&state, &item.account_id, &item.folder, item.uid)
                .is_some(),
        })
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
