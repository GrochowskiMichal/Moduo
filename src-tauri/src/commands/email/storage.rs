use serde::Deserialize;

use crate::email_sync::EmailSyncCursorRecord;
use crate::AppState;

use super::{
    now_iso, StoredBodyCache, StoredBodyLru, StoredEmailAccount, StoredEmailAccountV2,
    StoredEnvelope, ALL_ACCOUNTS_ID, DEFAULT_WORKSPACE_ID, EMAIL_ACCOUNTS_KEY,
    EMAIL_BODY_MAX_BYTES_PER_ACCOUNT, EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT, EMAIL_NAMESPACE,
};

pub(super) fn read_accounts(state: &AppState) -> Result<Vec<StoredEmailAccount>, String> {
    let raw = state
        .store
        .kv_get(EMAIL_NAMESPACE, EMAIL_ACCOUNTS_KEY)
        .map_err(|e| e.to_string())?;

    match raw {
        None => Ok(vec![]),
        Some(value) => {
            Ok(serde_json::from_value::<Vec<StoredEmailAccount>>(value).unwrap_or_else(|_| vec![]))
        }
    }
}

pub(super) fn write_accounts(
    state: &AppState,
    accounts: &[StoredEmailAccount],
) -> Result<(), String> {
    state
        .store
        .kv_set(
            EMAIL_NAMESPACE,
            EMAIL_ACCOUNTS_KEY,
            &serde_json::to_value(accounts).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

pub(super) fn resolve_accounts_for_target(
    state: &AppState,
    account_id: Option<&str>,
) -> Result<Vec<StoredEmailAccount>, String> {
    let accounts = read_accounts(state)?;
    if accounts.is_empty() {
        return Ok(vec![]);
    }

    if let Some(id) = account_id {
        if id == ALL_ACCOUNTS_ID {
            return Ok(accounts);
        }
        let matched = accounts
            .into_iter()
            .find(|account| account.id == id)
            .map(|account| vec![account])
            .ok_or_else(|| "account_not_found".to_string())?;
        return Ok(matched);
    }

    Ok(accounts)
}

pub(super) fn patch_account_sync_state(
    state: &AppState,
    account_id: &str,
    status: &str,
    last_error: Option<String>,
) -> Result<(), String> {
    let mut accounts = read_accounts(state)?;
    if let Some(account) = accounts.iter_mut().find(|item| item.id == account_id) {
        account.status = status.to_string();
        account.last_error = last_error;
        account.last_sync_at = Some(now_iso());
    }
    write_accounts(state, &accounts)
}

pub(super) fn folder_state_key(account_id: &str, folder: &str) -> String {
    format!("{}::{}", account_id, folder)
}

pub(super) fn envelope_key(account_id: &str, folder: &str, uid: u32) -> String {
    format!("{}::{}::{}", account_id, folder, uid)
}

pub(super) fn body_key(account_id: &str, folder: &str, uid: u32) -> String {
    format!("{}::{}::{}", account_id, folder, uid)
}

pub(super) fn message_key(account_id: &str, uid_validity: Option<u32>, uid: u32) -> String {
    format!(
        "{}::{}::{}",
        account_id,
        uid_validity.unwrap_or_default(),
        uid
    )
}

pub(super) fn envelope_order_key(
    account_id: &str,
    folder: &str,
    timestamp_ms: i64,
    uid: u32,
) -> String {
    let reverse_ts = i64::MAX - timestamp_ms.max(0);
    format!("{}::{}::{:020}::{}", account_id, folder, reverse_ts, uid)
}

pub(super) fn parse_json_value<T: for<'de> Deserialize<'de>>(
    value: serde_json::Value,
) -> Option<T> {
    serde_json::from_value(value).ok()
}

pub(super) fn workspace_id_or_default(raw: Option<&str>) -> String {
    raw.map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or(DEFAULT_WORKSPACE_ID)
        .to_string()
}

pub(super) fn upsert_account_v2(
    state: &AppState,
    account: &StoredEmailAccount,
    capabilities: Option<Vec<String>>,
    idle_supported: Option<bool>,
    resolved_mailbox: Option<(&str, &str)>,
) -> Result<(), String> {
    let existing = state
        .store
        .get_email_account_v2(&account.id)
        .map_err(|e| e.to_string())?
        .and_then(parse_json_value::<StoredEmailAccountV2>);

    let mut resolved_mailboxes = existing
        .as_ref()
        .map(|item| item.resolved_mailboxes.clone())
        .unwrap_or_default();
    if let Some((folder, mailbox)) = resolved_mailbox {
        resolved_mailboxes.insert(folder.to_string(), mailbox.to_string());
    }

    let next = StoredEmailAccountV2 {
        id: account.id.clone(),
        workspace_id: workspace_id_or_default(account.workspace_id.as_deref()),
        provider: account.provider.clone(),
        email: account.email.clone(),
        imap_host: account.imap_host.clone(),
        smtp_host: account.smtp_host.clone(),
        imap_port: account.imap_port,
        smtp_port: account.smtp_port,
        capabilities: capabilities
            .or_else(|| existing.as_ref().map(|item| item.capabilities.clone()))
            .unwrap_or_default(),
        idle_supported: idle_supported
            .or_else(|| existing.as_ref().map(|item| item.idle_supported))
            .unwrap_or(false),
        resolved_mailboxes,
        last_sync_at: Some(now_iso()),
        status: account.status.clone(),
        last_error: account.last_error.clone(),
        updated_at: now_iso(),
    };

    state
        .store
        .put_email_account_v2(
            &account.id,
            &serde_json::to_value(next).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

pub(super) fn remove_account_v2(state: &AppState, account_id: &str) {
    let _ = state.store.remove_email_account_v2(account_id);
}

pub(super) fn load_folder_cursor(
    state: &AppState,
    account_id: &str,
    folder: &str,
) -> Option<EmailSyncCursorRecord> {
    state
        .store
        .get_email_folder_state(&folder_state_key(account_id, folder))
        .ok()
        .flatten()
        .and_then(parse_json_value::<EmailSyncCursorRecord>)
}

pub(super) fn save_folder_cursor(
    state: &AppState,
    cursor: &EmailSyncCursorRecord,
) -> Result<(), String> {
    state
        .store
        .put_email_folder_state(
            &folder_state_key(&cursor.account_id, &cursor.folder),
            &serde_json::to_value(cursor).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

pub(super) fn update_idle_runtime_state(
    state: &AppState,
    account_id: &str,
    folder: &str,
    strategy: &str,
    failed_attempts: u32,
    touch_event_at: bool,
) {
    let key = folder_state_key(account_id, folder);
    let mut cursor = state
        .store
        .get_email_folder_state(&key)
        .ok()
        .flatten()
        .and_then(parse_json_value::<EmailSyncCursorRecord>)
        .unwrap_or(EmailSyncCursorRecord {
            account_id: account_id.to_string(),
            folder: folder.to_string(),
            uid_validity: None,
            uid_next: None,
            last_seen_uid: None,
            exists: 0,
            idle_supported: strategy == "idle",
            idle_strategy: Some(strategy.to_string()),
            idle_failed_attempts: failed_attempts,
            last_idle_event_at: None,
            updated_at: now_iso(),
        });
    cursor.idle_strategy = Some(strategy.to_string());
    cursor.idle_failed_attempts = failed_attempts;
    cursor.idle_supported = strategy == "idle";
    if touch_event_at {
        cursor.last_idle_event_at = Some(now_iso());
    }
    cursor.updated_at = now_iso();
    let _ = save_folder_cursor(state, &cursor);
}

pub(super) fn upsert_envelope(state: &AppState, envelope: &StoredEnvelope) -> Result<(), String> {
    let key = envelope_key(&envelope.account_id, &envelope.folder, envelope.uid);
    state
        .store
        .put_email_envelope(
            &key,
            &serde_json::to_value(envelope).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

    let order = serde_json::json!({
        "accountId": envelope.account_id,
        "folder": envelope.folder,
        "uid": envelope.uid,
        "timestampMs": envelope.timestamp_ms,
    });
    state
        .store
        .put_email_envelope_order(
            &envelope_order_key(
                &envelope.account_id,
                &envelope.folder,
                envelope.timestamp_ms,
                envelope.uid,
            ),
            &order,
        )
        .map_err(|e| e.to_string())
}

pub(super) fn remove_envelope(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Result<(), String> {
    state
        .store
        .remove_email_envelope(&envelope_key(account_id, folder, uid))
        .map_err(|e| e.to_string())?;

    let rows = state
        .store
        .list_email_envelope_order()
        .map_err(|e| e.to_string())?;
    for row in rows {
        let Some(v) = parse_json_value::<serde_json::Value>(row) else {
            continue;
        };
        if v.get("accountId").and_then(|x| x.as_str()) == Some(account_id)
            && v.get("folder").and_then(|x| x.as_str()) == Some(folder)
            && v.get("uid").and_then(|x| x.as_u64()) == Some(uid as u64)
        {
            let timestamp_ms = v
                .get("timestampMs")
                .and_then(|x| x.as_i64())
                .unwrap_or_default();
            let _ = state.store.remove_email_envelope_order(&envelope_order_key(
                account_id,
                folder,
                timestamp_ms,
                uid,
            ));
        }
    }
    Ok(())
}

pub(super) fn list_envelopes_filtered(
    state: &AppState,
    account_id: Option<&str>,
    folder: &str,
) -> Result<Vec<StoredEnvelope>, String> {
    let mut rows = state
        .store
        .list_email_envelopes()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredEnvelope>)
        .filter(|item| item.folder == folder)
        .filter(|item| {
            if let Some(acc) = account_id {
                return item.account_id == acc;
            }
            true
        })
        .collect::<Vec<_>>();

    rows.sort_by(|a, b| {
        b.timestamp_ms
            .cmp(&a.timestamp_ms)
            .then_with(|| b.uid.cmp(&a.uid))
    });
    Ok(rows)
}

pub(super) fn get_body_cache_from_store(
    store: &crate::store_redb::RedbStore,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Option<StoredBodyCache> {
    store
        .get_email_body(&body_key(account_id, folder, uid))
        .ok()
        .flatten()
        .and_then(parse_json_value::<StoredBodyCache>)
}

pub(super) fn get_body_cache(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Option<StoredBodyCache> {
    get_body_cache_from_store(&state.store, account_id, folder, uid)
}

pub(super) fn remove_body_cache(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Result<(), String> {
    state
        .store
        .remove_email_body(&body_key(account_id, folder, uid))
        .map_err(|e| e.to_string())?;
    let lru_rows = state
        .store
        .list_email_body_lru()
        .map_err(|e| e.to_string())?;
    for row in lru_rows {
        let Some(item) = parse_json_value::<StoredBodyLru>(row) else {
            continue;
        };
        if item.account_id == account_id && item.folder == folder && item.uid == uid {
            let _ = state.store.remove_email_body_lru(&item.key);
        }
    }
    Ok(())
}

fn prune_body_cache_lru(state: &AppState, account_id: &str) -> Result<(), String> {
    let mut entries = state
        .store
        .list_email_bodies()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredBodyCache>)
        .filter(|item| item.account_id == account_id)
        .collect::<Vec<_>>();

    let mut total_bytes = entries.iter().map(|item| item.byte_size).sum::<usize>();
    if entries.len() <= EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT
        && total_bytes <= EMAIL_BODY_MAX_BYTES_PER_ACCOUNT
    {
        return Ok(());
    }

    entries.sort_by(|a, b| a.last_accessed_at.cmp(&b.last_accessed_at));
    for entry in entries {
        if total_bytes <= EMAIL_BODY_MAX_BYTES_PER_ACCOUNT
            && state
                .store
                .list_email_bodies()
                .map_err(|e| e.to_string())?
                .into_iter()
                .filter_map(parse_json_value::<StoredBodyCache>)
                .filter(|item| item.account_id == account_id)
                .count()
                <= EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT
        {
            break;
        }
        total_bytes = total_bytes.saturating_sub(entry.byte_size);
        let _ = remove_body_cache(state, &entry.account_id, &entry.folder, entry.uid);
    }
    Ok(())
}

pub(super) fn touch_body_cache(state: &AppState, body: &StoredBodyCache) -> Result<(), String> {
    let mut next = body.clone();
    next.last_accessed_at = now_iso();
    state
        .store
        .put_email_body(
            &next.key,
            &serde_json::to_value(&next).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

    let lru = StoredBodyLru {
        key: format!(
            "{}::{}::{}::{}",
            next.account_id, next.last_accessed_at, next.folder, next.uid
        ),
        account_id: next.account_id.clone(),
        folder: next.folder.clone(),
        uid: next.uid,
        last_accessed_at: next.last_accessed_at.clone(),
    };
    state
        .store
        .put_email_body_lru(
            &lru.key,
            &serde_json::to_value(&lru).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

pub(super) fn persist_body_cache(state: &AppState, body: &StoredBodyCache) -> Result<(), String> {
    state
        .store
        .put_email_body(
            &body.key,
            &serde_json::to_value(body).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    let lru = StoredBodyLru {
        key: format!(
            "{}::{}::{}::{}",
            body.account_id, body.last_accessed_at, body.folder, body.uid
        ),
        account_id: body.account_id.clone(),
        folder: body.folder.clone(),
        uid: body.uid,
        last_accessed_at: body.last_accessed_at.clone(),
    };
    state
        .store
        .put_email_body_lru(
            &lru.key,
            &serde_json::to_value(&lru).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    prune_body_cache_lru(state, &body.account_id)
}
