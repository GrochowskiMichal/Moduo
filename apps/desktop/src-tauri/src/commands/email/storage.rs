use serde::Deserialize;

use crate::email_sync::EmailSyncCursorRecord;
use crate::store_redb::{EnvelopeWrite, RedbStore};
use crate::AppState;

use super::{
    now_iso, StoredBodyCache, StoredBodyLru, StoredBodyText, StoredEmailAccount,
    StoredEmailAccountV2, StoredEnvelope, ALL_ACCOUNTS_ID, DEFAULT_WORKSPACE_ID, EMAIL_ACCOUNTS_KEY,
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

/// The segment separator [`envelope_key`] is built from
/// (`{account}::{folder}::{uid}`). Shared with the read path so the prefix it
/// scans and the key the writer mints can't drift apart.
pub(super) const KEY_SEPARATOR: &str = "::";

pub(super) fn folder_state_key(account_id: &str, folder: &str) -> String {
    format!("{}::{}", account_id, folder)
}

pub(super) fn envelope_key(account_id: &str, folder: &str, uid: u32) -> String {
    format!("{account_id}{KEY_SEPARATOR}{folder}{KEY_SEPARATOR}{uid}")
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
    format!(
        "{account_id}{KEY_SEPARATOR}{folder}{KEY_SEPARATOR}{reverse_ts:020}{KEY_SEPARATOR}{uid}"
    )
}

/// The four fields [`stored_order_key`] needs out of a stored envelope. Parsing
/// into this instead of `serde_json::Value` keeps the write path from building a
/// whole value tree per already-stored row.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredOrderFields {
    account_id: String,
    folder: String,
    uid: u32,
    timestamp_ms: i64,
}

/// The order-index key an *already stored* envelope row was written under, minted
/// from that row's raw JSON.
///
/// The key embeds a reverse timestamp so the index sorts newest-first, which means
/// it is not stable across a timestamp change: a message with no `Date` header
/// falls back to "now" on every fetch ([`super::sync::fetch_envelopes_for_uids`]),
/// so each refetch minted a *new* key and orphaned the previous row. Recovering the
/// old key here lets the write and remove paths drop that row in the same
/// transaction, keeping exactly one order row per envelope.
///
/// Because the key is *re-minted* rather than stored, changing
/// [`envelope_order_key`]'s format would strand every existing index row. IM-2b is
/// the index's first reader — if it changes the format, it owns the rebuild.
fn stored_order_key(raw: &str) -> Option<String> {
    let stored = serde_json::from_str::<StoredOrderFields>(raw).ok()?;
    Some(envelope_order_key(
        &stored.account_id,
        &stored.folder,
        stored.timestamp_ms,
        stored.uid,
    ))
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
            // No backfill progress yet — this fallback only exists when there is no
            // cursor at all, so the next sync round starts the walk from scratch.
            oldest_synced_uid: None,
            history_floor_ms: None,
            backfill_complete: false,
            backfill_last_error: None,
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

fn envelope_write(envelope: &StoredEnvelope) -> Result<EnvelopeWrite, String> {
    let order = serde_json::json!({
        "accountId": envelope.account_id,
        "folder": envelope.folder,
        "uid": envelope.uid,
        "timestampMs": envelope.timestamp_ms,
    });
    Ok(EnvelopeWrite {
        envelope_key: envelope_key(&envelope.account_id, &envelope.folder, envelope.uid),
        envelope_json: serde_json::to_string(envelope).map_err(|e| e.to_string())?,
        order_key: envelope_order_key(
            &envelope.account_id,
            &envelope.folder,
            envelope.timestamp_ms,
            envelope.uid,
        ),
        order_json: serde_json::to_string(&order).map_err(|e| e.to_string())?,
    })
}

pub(super) fn upsert_envelope(state: &AppState, envelope: &StoredEnvelope) -> Result<(), String> {
    upsert_envelopes(state, std::slice::from_ref(envelope))
}

/// Write a whole chunk of envelopes in ONE redb transaction.
///
/// Every sync loop fetches in chunks of 50, so batching here turns 100 commits per
/// chunk (row + order row, each taking the global write guard) into one.
pub(super) fn upsert_envelopes(
    state: &AppState,
    envelopes: &[StoredEnvelope],
) -> Result<(), String> {
    upsert_envelopes_in_store(&state.store, envelopes)
}

pub(super) fn upsert_envelopes_in_store(
    store: &RedbStore,
    envelopes: &[StoredEnvelope],
) -> Result<(), String> {
    if envelopes.is_empty() {
        return Ok(());
    }
    let rows = envelopes
        .iter()
        .map(envelope_write)
        .collect::<Result<Vec<_>, String>>()?;
    store
        .write_email_envelopes(&rows, stored_order_key)
        .map_err(|e| e.to_string())
}

pub(super) fn remove_envelope(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Result<(), String> {
    remove_envelope_in_store(&state.store, account_id, folder, uid)
}

pub(super) fn remove_envelope_in_store(
    store: &RedbStore,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Result<(), String> {
    // The store reads the row inside the delete transaction to recover its
    // order-index key. The old path scanned the ENTIRE order table per removal, so
    // the full-reset prune (which removes every out-of-window row) was O(n²).
    store
        .remove_email_envelope_with_order(&envelope_key(account_id, folder, uid), stored_order_key)
        .map_err(|e| e.to_string())
}

pub(super) fn list_envelopes_filtered(
    state: &AppState,
    account_id: Option<&str>,
    folder: &str,
) -> Result<Vec<StoredEnvelope>, String> {
    list_envelopes_in_store(&state.store, account_id, folder)
}

/// Envelopes for one folder, newest first.
///
/// Sync calls this ~3× per round, so at 30k+ stored envelopes the old whole-table
/// read cost ~90k `serde_json` parses per sync — the scaling wall this block exists
/// to remove.
///
/// Scoped to an account (every sync call, and every list except "All accounts") it
/// range-scans the `{account}::{folder}::` key prefix and touches nothing else.
/// Unscoped, the account segment isn't known up front, so it walks the key index
/// and deserializes only rows whose key carries the folder. Either way the row's
/// own fields decide inclusion, so the result stays exactly what the old
/// field-filtered scan returned — including envelopes left behind by a disconnected
/// account, which still list under "All accounts" as before.
pub(super) fn list_envelopes_in_store(
    store: &RedbStore,
    account_id: Option<&str>,
    folder: &str,
) -> Result<Vec<StoredEnvelope>, String> {
    let scanned = match account_id {
        Some(id) => store
            .scan_email_envelopes_prefix(&format!("{id}{KEY_SEPARATOR}{folder}{KEY_SEPARATOR}"))
            .map_err(|e| e.to_string())?,
        None => store
            .scan_email_envelopes_in_folder(&format!("{KEY_SEPARATOR}{folder}{KEY_SEPARATOR}"))
            .map_err(|e| e.to_string())?,
    };

    let mut rows = scanned
        .into_iter()
        .filter_map(parse_json_value::<StoredEnvelope>)
        // The key narrows what gets read; the fields decide what counts. Keeping
        // both means a key/field mismatch, a folder name containing the separator,
        // or an account id containing it can't change the result set.
        .filter(|item| item.folder == folder)
        .filter(|item| account_id.is_none_or(|acc| item.account_id == acc))
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
    // Co-prune the local-search body-text sidecar (EM-9) — same key, so it never
    // outlives its body.
    state
        .store
        .remove_email_body_text(&body_key(account_id, folder, uid))
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

    // Track the remaining count locally instead of re-listing (and re-parsing)
    // every cached body on each iteration. `remove_body_cache` still scans the LRU
    // table per removal — its key embeds `last_accessed_at`, so a touched body
    // leaves rows behind that only a scan can find. That leak is IM-2b's to fix;
    // this only removes the redundant re-count.
    let mut remaining = entries.len();
    entries.sort_by(|a, b| a.last_accessed_at.cmp(&b.last_accessed_at));
    for entry in entries {
        if total_bytes <= EMAIL_BODY_MAX_BYTES_PER_ACCOUNT
            && remaining <= EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT
        {
            break;
        }
        // Only count it out once it is actually gone — a failed removal used to be
        // self-correcting via the re-count.
        if remove_body_cache(state, &entry.account_id, &entry.folder, entry.uid).is_ok() {
            total_bytes = total_bytes.saturating_sub(entry.byte_size);
            remaining = remaining.saturating_sub(1);
        }
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
    // Write the local-search body-text sidecar (EM-9): an 8KB lowercase copy,
    // keyed like the body so remove_body_cache co-prunes it.
    let text_row = StoredBodyText {
        key: body.key.clone(),
        account_id: body.account_id.clone(),
        folder: body.folder.clone(),
        uid: body.uid,
        text: super::search::body_search_text(&body.body),
    };
    state
        .store
        .put_email_body_text(
            &text_row.key,
            &serde_json::to_value(&text_row).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    prune_body_cache_lru(state, &body.account_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::email::EmailHistoryDepth;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// A throwaway redb file that deletes itself when the test ends.
    struct TempStore {
        store: RedbStore,
        path: PathBuf,
    }

    impl Drop for TempStore {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    fn temp_store() -> TempStore {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "moduo-email-storage-{}-{}.redb",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_file(&path);
        let store = RedbStore::open(&path).expect("open temp redb");
        TempStore { store, path }
    }

    fn envelope(account_id: &str, folder: &str, uid: u32, timestamp_ms: i64) -> StoredEnvelope {
        StoredEnvelope {
            id: format!("{account_id}::{folder}::{uid}"),
            message_key: format!("{account_id}::1::{uid}"),
            account_id: account_id.to_string(),
            workspace_id: DEFAULT_WORKSPACE_ID.to_string(),
            folder: folder.to_string(),
            uid,
            uid_validity: Some(1),
            sender: "Sender".to_string(),
            sender_email: "sender@example.com".to_string(),
            to: "me@example.com".to_string(),
            cc: String::new(),
            subject: format!("Message {uid}"),
            preview: format!("Message {uid}"),
            date: "2026-07-29T10:00:00Z".to_string(),
            timestamp_ms,
            read: false,
            starred: false,
            size: Some(1024),
            message_id: Some(format!("<{uid}@example.com>")),
            in_reply_to: None,
            references: Vec::new(),
            list_unsubscribe: None,
            precedence: None,
            auto_submitted: None,
            thread_id: format!("thread-{uid}"),
            updated_at: "2026-07-29T10:00:00Z".to_string(),
        }
    }

    /// AC11 — listing one folder must not deserialize the whole envelope table.
    ///
    /// The proof is rows planted *outside* the prefix whose values are not even
    /// valid JSON: the old whole-table read (`list_email_envelopes`) chokes on them,
    /// so a list that succeeds is evidence the scan never read them — not just that
    /// the field filter worked.
    #[test]
    fn list_envelopes_uses_prefix_scan() {
        let temp = temp_store();
        let store = &temp.store;

        // One batch, several rows — the sync path writes a whole 50-UID chunk at a
        // time, so the multi-row transaction is the shape that matters.
        upsert_envelopes_in_store(
            store,
            &[
                envelope("gmail:a@x.com", "inbox", 2, 2_000),
                envelope("gmail:a@x.com", "inbox", 1, 1_000),
                // Same account, different folder — inside the account block, outside
                // the folder prefix.
                envelope("gmail:a@x.com", "sent", 9, 9_000),
                // A second account, so the all-accounts path spans more than one.
                envelope("gmail:b@x.com", "inbox", 4, 4_000),
                // An account id containing the key separator (a custom IMAP account
                // on an IPv6 literal host mints one): it must not disappear from
                // either listing.
                envelope("custom:me@x.com:[::1]", "inbox", 3, 3_000),
            ],
        )
        .expect("write batch");

        // Two unparseable rows, each just past a boundary the scan must respect.
        // `inboxx` sorts immediately after this account's `inbox::` block, so
        // reaching it means the folder prefix wasn't honored; the trailing account
        // sorts after every real key.
        store
            .put_email_envelope_raw("gmail:a@x.com::inboxx::1", "{not json at all")
            .expect("plant adjacent-folder poison row");
        store
            .put_email_envelope_raw("zzz-poison:c@x.com::sent::1", "{not json at all")
            .expect("plant trailing-account poison row");

        // Non-vacuity: the path this block replaced genuinely fails on those rows.
        assert!(
            store.list_email_envelopes().is_err(),
            "the whole-table read should choke on the poison rows — otherwise this \
             test proves nothing"
        );

        let inbox = list_envelopes_in_store(store, Some("gmail:a@x.com"), "inbox")
            .expect("scoped list must not read outside its prefix");
        assert_eq!(
            inbox.iter().map(|row| row.uid).collect::<Vec<_>>(),
            vec![2, 1],
            "only that account's inbox rows, newest first"
        );

        let separator_account =
            list_envelopes_in_store(store, Some("custom:me@x.com:[::1]"), "inbox")
                .expect("scoped list for a separator-bearing account id");
        assert_eq!(
            separator_account
                .iter()
                .map(|row| row.uid)
                .collect::<Vec<_>>(),
            vec![3],
            "an account id containing `::` still lists"
        );

        let all_inboxes = list_envelopes_in_store(store, None, "inbox")
            .expect("all-accounts list must not deserialize rows in other folders");
        assert_eq!(
            all_inboxes
                .iter()
                .map(|row| (row.account_id.as_str(), row.uid))
                .collect::<Vec<_>>(),
            vec![
                ("gmail:b@x.com", 4),
                ("custom:me@x.com:[::1]", 3),
                ("gmail:a@x.com", 2),
                ("gmail:a@x.com", 1),
            ],
            "every account's inbox, newest first, and nothing from other folders"
        );
    }

    /// AC8 — an account blob written before IM-2b added `historyDepth` must still
    /// deserialize.
    ///
    /// This is the one that can lose the user's whole setup: `read_accounts`
    /// swallows a deserialize error into an **empty list**, so a non-defaulted new
    /// field would silently disconnect every mailbox on upgrade — and the app would
    /// look like a fresh install rather than broken (specs/import.md assumption 4).
    #[test]
    fn accounts_v1_old_shape_still_loads() {
        // Verbatim pre-IM-2b shape: no `historyDepth` key at all.
        let legacy = serde_json::json!([{
            "id": "gmail:a@x.com",
            "workspaceId": null,
            "provider": "gmail",
            "email": "a@x.com",
            "imapHost": null,
            "smtpHost": null,
            "imapPort": null,
            "smtpPort": null,
            "lastSyncAt": "2026-07-01T10:00:00Z",
            "status": "active",
            "lastError": null,
        }]);

        let accounts = serde_json::from_value::<Vec<StoredEmailAccount>>(legacy)
            .expect("a pre-IM-2b account blob must still deserialize");
        assert_eq!(accounts.len(), 1, "the account survives the upgrade");
        assert_eq!(accounts[0].id, "gmail:a@x.com");
        assert_eq!(
            accounts[0].history_depth,
            EmailHistoryDepth::TwelveMonths,
            "a missing depth defaults to 12 months (AC6)"
        );

        // And the field round-trips, so a written depth is read back — not reset to
        // the default on every load.
        let mut deeper = accounts;
        deeper[0].history_depth = EmailHistoryDepth::Everything;
        let round_tripped = serde_json::from_value::<Vec<StoredEmailAccount>>(
            serde_json::to_value(&deeper).expect("serialize"),
        )
        .expect("deserialize");
        assert_eq!(
            round_tripped[0].history_depth,
            EmailHistoryDepth::Everything
        );

        // A depth value this build doesn't know — what a rollback past a future
        // variant looks like. It must degrade to the default, NOT fail: a failure
        // here becomes an empty account list, i.e. every mailbox disconnected.
        let unknown = serde_json::json!([{
            "id": "gmail:b@x.com",
            "provider": "gmail",
            "email": "b@x.com",
            "lastSyncAt": null,
            "status": "active",
            "lastError": null,
            "historyDepth": "twentyFourMonths",
        }]);
        let rolled_back = serde_json::from_value::<Vec<StoredEmailAccount>>(unknown)
            .expect("an unknown depth must not take the account list down with it");
        assert_eq!(rolled_back.len(), 1);
        assert_eq!(
            rolled_back[0].history_depth,
            EmailHistoryDepth::TwelveMonths
        );
    }

    /// AC10 — a message with no `Date` header gets `now_iso()` on every fetch, so
    /// its reverse-timestamp order key changes each time. Refetching must replace
    /// the index row, not leave the previous one orphaned.
    #[test]
    fn envelope_order_key_stable_without_date() {
        let temp = temp_store();
        let store = &temp.store;

        let first = envelope("gmail:a@x.com", "inbox", 7, 1_700_000_000_000);
        // The same message, refetched: no Date header means the timestamp is
        // whatever "now" was, so it moves.
        let refetched = envelope("gmail:a@x.com", "inbox", 7, 1_700_000_060_000);
        assert_ne!(
            envelope_order_key(
                &first.account_id,
                &first.folder,
                first.timestamp_ms,
                first.uid
            ),
            envelope_order_key(
                &refetched.account_id,
                &refetched.folder,
                refetched.timestamp_ms,
                refetched.uid
            ),
            "setup must actually move the order key, or the test is vacuous"
        );

        upsert_envelopes_in_store(store, &[first]).expect("first write");
        // The refetch arrives in a batch beside an unrelated row *and* beside a
        // second copy of itself — a duplicate FETCH response for one UID puts the
        // same key in one transaction, so the stale-row drop has to read its own
        // uncommitted write, not just the previous transaction's.
        upsert_envelopes_in_store(
            store,
            &[
                envelope("gmail:a@x.com", "inbox", 8, 1_700_000_030_000),
                envelope("gmail:a@x.com", "inbox", 7, 1_700_000_045_000),
                refetched.clone(),
            ],
        )
        .expect("refetch write");

        let order_rows = store.list_email_envelope_order().expect("read order table");
        assert_eq!(
            order_rows.len(),
            2,
            "a refetched date-less message must leave exactly one order row (plus \
             the unrelated row written beside it)"
        );
        let order_rows = order_rows
            .into_iter()
            .filter(|row| row.get("uid").and_then(|v| v.as_u64()) == Some(u64::from(refetched.uid)))
            .collect::<Vec<_>>();
        assert_eq!(
            order_rows.len(),
            1,
            "exactly one order row for the refetched message"
        );
        assert_eq!(
            order_rows[0].get("timestampMs").and_then(|v| v.as_i64()),
            Some(refetched.timestamp_ms),
            "the surviving row is the current one"
        );
        assert_eq!(
            store.list_email_envelopes().expect("read envelopes").len(),
            2,
            "the refetched message is still a single upserted row"
        );

        remove_envelope_in_store(
            store,
            &refetched.account_id,
            &refetched.folder,
            refetched.uid,
        )
        .expect("remove");
        assert_eq!(
            store
                .list_email_envelope_order()
                .expect("read order table")
                .len(),
            1,
            "removing an envelope removes its order row — and only its own"
        );

        // A row whose JSON no longer parses must still be deletable: the order key
        // can't be derived, but the envelope has to go.
        store
            .put_email_envelope_raw("gmail:a@x.com::inbox::99", "{corrupt")
            .expect("plant corrupt row");
        remove_envelope_in_store(store, "gmail:a@x.com", "inbox", 99).expect("remove corrupt row");
        assert!(
            store
                .get_email_envelope("gmail:a@x.com::inbox::99")
                .expect("read back")
                .is_none(),
            "a corrupt envelope row is still removable"
        );
    }
}
