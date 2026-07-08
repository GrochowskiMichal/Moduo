use std::collections::HashSet;

use crate::email_sync::EmailSyncCursorRecord;
use crate::AppState;

use super::connection::{open_imap_session, ImapSession};
use super::parsing::{
    decode_header_value_bytes, parse_address, parse_header_value, parse_references, thread_id_from,
    to_millis_from_date, truncate_with_ellipsis, within_sync_window,
};
use super::storage::{
    envelope_key, list_envelopes_filtered, load_folder_cursor, message_key, parse_json_value,
    remove_body_cache, remove_envelope, save_folder_cursor, upsert_account_v2, upsert_envelope,
    workspace_id_or_default,
};
use super::{
    ensure_account_config, now_iso, queue_graph_upsert_for_envelope, select_mailbox_for_folder,
    StoredEmailAccount, StoredEnvelope, FLAG_RECONCILE_WINDOW, FLAG_RECONCILE_WINDOW_LIGHT,
    SYNC_ENVELOPE_WINDOW_DAYS, SYNC_ENVELOPE_WINDOW_UIDS,
};

pub(super) fn fetch_envelopes_for_uids(
    session: &mut ImapSession,
    account: &StoredEmailAccount,
    folder: &str,
    uid_validity: Option<u32>,
    uids: &[u32],
) -> Result<Vec<StoredEnvelope>, String> {
    if uids.is_empty() {
        return Ok(Vec::new());
    }

    let query = uids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");

    let fetches = session
        .uid_fetch(
            query,
            "(UID ENVELOPE FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO REFERENCES LIST-UNSUBSCRIBE PRECEDENCE AUTO-SUBMITTED)])",
        )
        .map_err(|e| format!("uid_fetch_failed:{}", e))?;

    let workspace_id = workspace_id_or_default(account.workspace_id.as_deref());
    let mut rows = Vec::new();

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
        let date = env
            .date
            .as_ref()
            .map(|v| decode_header_value_bytes(v))
            .unwrap_or_else(now_iso);
        let (sender, sender_email) =
            if let Some(addr) = env.from.as_ref().and_then(|list| list.first()) {
                parse_address(
                    addr.mailbox.as_deref(),
                    addr.host.as_deref(),
                    addr.name.as_deref(),
                )
            } else {
                ("Unknown sender".to_string(), String::new())
            };
        let to = if let Some(to_list) = &env.to {
            to_list
                .iter()
                .filter_map(|addr| {
                    let (_, email) = parse_address(
                        addr.mailbox.as_deref(),
                        addr.host.as_deref(),
                        addr.name.as_deref(),
                    );
                    if email.is_empty() {
                        None
                    } else {
                        Some(email)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ")
        } else {
            String::new()
        };
        let cc = if let Some(cc_list) = &env.cc {
            cc_list
                .iter()
                .filter_map(|addr| {
                    let (_, email) = parse_address(
                        addr.mailbox.as_deref(),
                        addr.host.as_deref(),
                        addr.name.as_deref(),
                    );
                    if email.is_empty() {
                        None
                    } else {
                        Some(email)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ")
        } else {
            String::new()
        };
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
        // References + the smart-inbox signals aren't in the ENVELOPE — parse them
        // from the fetched HEADER.FIELDS block (read once).
        let header_block = item.header();
        let references = header_block.map(parse_references).unwrap_or_default();
        let list_unsubscribe =
            header_block.and_then(|h| parse_header_value(h, "list-unsubscribe"));
        let precedence = header_block.and_then(|h| parse_header_value(h, "precedence"));
        let auto_submitted = header_block.and_then(|h| parse_header_value(h, "auto-submitted"));
        let preview = truncate_with_ellipsis(&subject, 120);
        let timestamp_ms = to_millis_from_date(&date);
        let mut read = false;
        let mut starred = false;
        for flag in item.flags() {
            if matches!(flag, imap::types::Flag::Seen) {
                read = true;
            }
            if matches!(flag, imap::types::Flag::Flagged) {
                starred = true;
            }
        }

        let thread_id = thread_id_from(
            &subject,
            &references,
            in_reply_to.as_deref(),
            message_id.as_deref(),
        );
        let message_key = message_key(&account.id, uid_validity, uid);
        rows.push(StoredEnvelope {
            id: format!("{}::{}::{}", account.id, folder, uid),
            message_key: message_key.clone(),
            account_id: account.id.clone(),
            workspace_id: workspace_id.clone(),
            folder: folder.to_string(),
            uid,
            uid_validity,
            sender,
            sender_email,
            to,
            cc,
            subject,
            preview,
            date,
            timestamp_ms,
            read,
            starred,
            size: item.size,
            message_id,
            in_reply_to,
            references,
            list_unsubscribe,
            precedence,
            auto_submitted,
            thread_id,
            updated_at: now_iso(),
        });
    }

    Ok(rows)
}

pub(super) fn uid_window_start(end_uid: u32, window: u32) -> u32 {
    if end_uid == 0 {
        return 0;
    }
    end_uid.saturating_sub(window.saturating_sub(1)).max(1)
}

pub(super) fn collect_uid_range(start_uid: u32, end_uid: u32) -> Vec<u32> {
    if start_uid == 0 || end_uid == 0 || start_uid > end_uid {
        return Vec::new();
    }
    (start_uid..=end_uid).collect::<Vec<_>>()
}

pub(super) fn resolve_uid_next(
    session: &mut ImapSession,
    mailbox_uid_next: Option<u32>,
) -> Result<u32, String> {
    if let Some(uid_next) = mailbox_uid_next {
        return Ok(uid_next);
    }
    let all_uid_set = session
        .uid_search("ALL")
        .map_err(|e| format!("uid_search_failed:{}", e))?;
    let max_uid = all_uid_set.iter().copied().max().unwrap_or(0);
    Ok(max_uid.saturating_add(1))
}

fn search_uid_window(
    session: &mut ImapSession,
    start_uid: u32,
    end_uid: u32,
) -> Result<HashSet<u32>, String> {
    if start_uid == 0 || end_uid == 0 || start_uid > end_uid {
        return Ok(HashSet::new());
    }
    let query = format!("{}:{}", start_uid, end_uid);
    let result = session
        .uid_search(query)
        .map_err(|e| format!("uid_search_failed:{}", e))?;
    Ok(result.iter().copied().collect::<HashSet<_>>())
}

pub(super) fn sync_account_folder_envelopes(
    state: &AppState,
    account: &StoredEmailAccount,
    folder: &str,
    force_sync: bool,
) -> Result<(), String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let (capabilities, idle_supported, condstore_supported) = session
        .capabilities()
        .map(|caps| {
            let values = caps
                .iter()
                .map(|cap| format!("{:?}", cap))
                .collect::<Vec<_>>();
            let idle = caps.has_str("IDLE");
            let condstore = caps.has_str("CONDSTORE");
            (values, idle, condstore)
        })
        .unwrap_or((vec![], false, false));

    let (resolved_mailbox, mailbox_info) =
        select_mailbox_for_folder(&mut session, account.provider.as_str(), folder)?;
    let uid_validity = mailbox_info.uid_validity;
    let uid_next = resolve_uid_next(&mut session, mailbox_info.uid_next)?;
    let exists = mailbox_info.exists;
    let latest_uid = uid_next.saturating_sub(1);

    let current_cursor = load_folder_cursor(state, &account.id, folder);
    let current_local = list_envelopes_filtered(state, Some(&account.id), folder)?;
    let should_full_reset = current_cursor.is_none()
        || current_cursor
            .as_ref()
            .map(|cursor| cursor.uid_validity != uid_validity)
            .unwrap_or(true);

    let uids_to_fetch = if should_full_reset {
        let start_uid = uid_window_start(latest_uid, SYNC_ENVELOPE_WINDOW_UIDS);
        collect_uid_range(start_uid, latest_uid)
    } else {
        let last_seen = current_cursor
            .as_ref()
            .and_then(|cursor| cursor.last_seen_uid)
            .unwrap_or_default();
        let mut delta = collect_uid_range(last_seen.saturating_add(1), latest_uid);
        if delta.is_empty() && (current_local.is_empty() || force_sync) {
            let start_uid = uid_window_start(latest_uid, SYNC_ENVELOPE_WINDOW_UIDS);
            delta = collect_uid_range(start_uid, latest_uid);
        }
        delta
    };

    // Bound the initial window to ~90 days as well as the UID cap (whichever is
    // smaller) — a high-volume folder shouldn't drag in a year of history.
    let window_cutoff_now_ms = chrono::Utc::now().timestamp_millis();
    for chunk in uids_to_fetch.chunks(50) {
        let rows = fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
        for row in rows {
            if !within_sync_window(row.timestamp_ms, window_cutoff_now_ms, SYNC_ENVELOPE_WINDOW_DAYS)
            {
                continue;
            }
            upsert_envelope(state, &row)?;
            let _ = queue_graph_upsert_for_envelope(state, &row);
        }
    }

    if should_full_reset {
        let fetched_set = uids_to_fetch.iter().copied().collect::<HashSet<u32>>();
        for row in current_local {
            if !fetched_set.contains(&row.uid) {
                let _ = remove_envelope(state, &row.account_id, &row.folder, row.uid);
                let _ = remove_body_cache(state, &row.account_id, &row.folder, row.uid);
            }
        }
    }

    let reconcile_window = if force_sync {
        FLAG_RECONCILE_WINDOW
    } else {
        FLAG_RECONCILE_WINDOW_LIGHT
    };
    let reconcile_start = uid_window_start(latest_uid, reconcile_window);
    let reconcile_uids = collect_uid_range(reconcile_start, latest_uid);
    let mut reconciled_with_condstore = false;
    if condstore_supported && !reconcile_uids.is_empty() {
        let uid_set = format!("{}:{}", reconcile_start, latest_uid);
        // We currently do not persist MODSEQ from fetch responses with this IMAP crate,
        // so we use CHANGEDSINCE 1 to let compliant servers optimize flags-only deltas.
        let condstore_query = "(UID FLAGS) (CHANGEDSINCE 1)";
        if let Ok(fetches) = session.uid_fetch(uid_set, condstore_query) {
            let mut missing_uids = Vec::<u32>::new();
            for item in fetches.iter() {
                let uid = item.uid.unwrap_or_default();
                if uid == 0 {
                    continue;
                }
                let existing = state
                    .store
                    .get_email_envelope(&envelope_key(&account.id, folder, uid))
                    .map_err(|e| e.to_string())?
                    .and_then(parse_json_value::<StoredEnvelope>);
                if let Some(mut envelope) = existing {
                    let mut read = false;
                    let mut starred = false;
                    for flag in item.flags() {
                        if matches!(flag, imap::types::Flag::Seen) {
                            read = true;
                        }
                        if matches!(flag, imap::types::Flag::Flagged) {
                            starred = true;
                        }
                    }
                    envelope.read = read;
                    envelope.starred = starred;
                    envelope.updated_at = now_iso();
                    upsert_envelope(state, &envelope)?;
                } else {
                    missing_uids.push(uid);
                }
            }
            for chunk in missing_uids.chunks(50) {
                let rows =
                    fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
                for row in rows {
                    upsert_envelope(state, &row)?;
                }
            }
            reconciled_with_condstore = true;
        }
    }
    if !reconciled_with_condstore {
        for chunk in reconcile_uids.chunks(50) {
            let rows =
                fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
            for row in rows {
                upsert_envelope(state, &row)?;
            }
        }
    }

    let recent_server_uids = search_uid_window(&mut session, reconcile_start, latest_uid)?;
    let local_rows = list_envelopes_filtered(state, Some(&account.id), folder)?;
    for row in local_rows {
        if row.uid >= reconcile_start
            && row.uid <= latest_uid
            && !recent_server_uids.contains(&row.uid)
        {
            let _ = remove_envelope(state, &row.account_id, &row.folder, row.uid);
            let _ = remove_body_cache(state, &row.account_id, &row.folder, row.uid);
        }
    }

    // Safety net: if server reports messages but local index is empty, rebuild latest window.
    let post_reconcile_count = list_envelopes_filtered(state, Some(&account.id), folder)?.len();
    if post_reconcile_count == 0 && exists > 0 && latest_uid > 0 {
        let recovery_start = uid_window_start(latest_uid, SYNC_ENVELOPE_WINDOW_UIDS);
        let recovery_uids = collect_uid_range(recovery_start, latest_uid);
        for chunk in recovery_uids.chunks(50) {
            let rows =
                fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
            for row in rows {
                upsert_envelope(state, &row)?;
                let _ = queue_graph_upsert_for_envelope(state, &row);
            }
        }
    }

    let previous_seen = current_cursor
        .as_ref()
        .and_then(|cursor| cursor.last_seen_uid)
        .unwrap_or_default();
    let next_last_seen = previous_seen.max(latest_uid);

    let cursor = EmailSyncCursorRecord {
        account_id: account.id.clone(),
        folder: folder.to_string(),
        uid_validity,
        uid_next: Some(uid_next),
        last_seen_uid: if next_last_seen == 0 {
            None
        } else {
            Some(next_last_seen)
        },
        exists,
        idle_supported,
        idle_strategy: Some(if idle_supported {
            "idle".to_string()
        } else {
            "polling".to_string()
        }),
        idle_failed_attempts: 0,
        last_idle_event_at: Some(now_iso()),
        updated_at: now_iso(),
    };
    save_folder_cursor(state, &cursor)?;
    upsert_account_v2(
        state,
        account,
        Some(capabilities),
        Some(idle_supported),
        Some((folder, &resolved_mailbox)),
    )?;

    let _ = session.logout();
    Ok(())
}
