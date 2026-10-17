use crate::AppState;

use super::connection::open_imap_session;
use super::storage::{envelope_key, parse_json_value, upsert_envelope};
use super::{
    ensure_account_config, now_iso, select_mailbox_for_folder, StoredEmailAccount, StoredEnvelope,
    StoredFlagOutboxEntry,
};

pub(super) fn queue_flag_outbox(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
    flag: &str,
    value: bool,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let entry = StoredFlagOutboxEntry {
        id: id.clone(),
        account_id: account_id.to_string(),
        folder: folder.to_string(),
        uid,
        flag: flag.to_string(),
        value,
        retry_count: 0,
        next_retry_at: now_iso(),
        last_error: None,
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    state
        .store
        .put_email_flag_outbox(
            &id,
            &serde_json::to_value(entry).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    Ok(id)
}

pub(super) fn update_envelope_flag_optimistic(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
    flag: &str,
    value: bool,
) -> Result<(), String> {
    let key = envelope_key(account_id, folder, uid);
    let Some(mut envelope) = state
        .store
        .get_email_envelope(&key)
        .map_err(|e| e.to_string())?
        .and_then(parse_json_value::<StoredEnvelope>)
    else {
        return Ok(());
    };
    match flag {
        "seen" => envelope.read = value,
        "starred" => envelope.starred = value,
        _ => {}
    }
    envelope.updated_at = now_iso();
    upsert_envelope(state, &envelope)
}

pub(super) fn flush_flag_outbox_for_account(
    state: &AppState,
    account: &StoredEmailAccount,
) -> Result<bool, String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let now = chrono::Utc::now();
    let mut any_success = false;

    let entries = state
        .store
        .list_email_flag_outbox()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredFlagOutboxEntry>)
        .filter(|entry| entry.account_id == account.id)
        .collect::<Vec<_>>();

    for mut entry in entries {
        let next_retry_at = chrono::DateTime::parse_from_rfc3339(&entry.next_retry_at)
            .map(|v| v.with_timezone(&chrono::Utc))
            .unwrap_or(now);
        if next_retry_at > now {
            continue;
        }

        let _ = select_mailbox_for_folder(&mut session, account.provider.as_str(), &entry.folder)?;
        let imap_flag = match entry.flag.as_str() {
            "seen" => "\\Seen",
            "starred" => "\\Flagged",
            _ => {
                let _ = state.store.remove_email_flag_outbox(&entry.id);
                continue;
            }
        };
        let query = if entry.value {
            format!("+FLAGS.SILENT ({})", imap_flag)
        } else {
            format!("-FLAGS.SILENT ({})", imap_flag)
        };
        match session.uid_store(entry.uid.to_string(), query) {
            Ok(_) => {
                any_success = true;
                let _ = state.store.remove_email_flag_outbox(&entry.id);
                let _ = update_envelope_flag_optimistic(
                    state,
                    &entry.account_id,
                    &entry.folder,
                    entry.uid,
                    &entry.flag,
                    entry.value,
                );
            }
            Err(error) => {
                entry.retry_count = entry.retry_count.saturating_add(1);
                if entry.retry_count > 8 {
                    let _ = state.store.remove_email_flag_outbox(&entry.id);
                    continue;
                }
                let jitter_ms = fastrand::u32(..1500) as i64;
                let delay = (2_i64.pow(entry.retry_count.min(6))) + jitter_ms / 1000;
                entry.next_retry_at =
                    (chrono::Utc::now() + chrono::Duration::seconds(delay)).to_rfc3339();
                entry.last_error = Some(error.to_string());
                entry.updated_at = now_iso();
                let _ = state.store.put_email_flag_outbox(
                    &entry.id,
                    &serde_json::to_value(&entry).map_err(|e| e.to_string())?,
                );
            }
        }
    }

    let _ = session.logout();
    Ok(any_success)
}
