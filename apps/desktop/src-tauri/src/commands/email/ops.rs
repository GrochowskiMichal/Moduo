//! Triage op outbox (EM-5): archive / move / delete.
//!
//! The generalized sibling of the flag outbox. Each op is planned by the pure
//! [`plan_op`] (provider × op → IMAP steps — unit-testable without a fake server)
//! and executed by [`flush_op_outbox_for_account`]. Optimistic-local (the caller
//! removes the envelope immediately) + queued-remote with retry/backoff, so an
//! offline or failed op never wedges the UI and never storms retries.

use crate::AppState;

use super::account_config::mailbox_candidates;
use super::connection::open_imap_session;
use super::model::{EmailFolderDto, StoredMailOpEntry};
use super::storage::parse_json_value;
use super::{ensure_account_config, now_iso, select_mailbox_for_folder, StoredEmailAccount};

/// One IMAP step in an op plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum OpStep {
    /// COPY the message to the first mailbox in this candidate list that exists.
    CopyTo(Vec<String>),
    /// Set `\Deleted` on the message and EXPUNGE it from the current mailbox.
    /// (We only ever flag one UID, so a plain EXPUNGE removes just it — UIDPLUS not
    /// required.)
    DeleteExpunge,
}

/// The IMAP steps for a triage op. Pure — the AC5 planner test drives this.
/// - **archive**: Gmail = expunge-from-INBOX (stays in All Mail); others =
///   copy-to-Archive then expunge.
/// - **move**: copy-to-dest then expunge.
/// - **delete**: copy-to-Trash then expunge (all providers).
pub(super) fn plan_op(
    provider: &str,
    op: &str,
    dest_folder: Option<&str>,
) -> Result<Vec<OpStep>, String> {
    match op {
        "archive" => {
            if provider == "gmail" {
                Ok(vec![OpStep::DeleteExpunge])
            } else {
                Ok(vec![
                    OpStep::CopyTo(mailbox_candidates(provider, "archive")),
                    OpStep::DeleteExpunge,
                ])
            }
        }
        "move" => {
            let dest = dest_folder
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "missing_dest_folder".to_string())?;
            Ok(vec![
                OpStep::CopyTo(vec![dest.to_string()]),
                OpStep::DeleteExpunge,
            ])
        }
        "delete" => Ok(vec![
            OpStep::CopyTo(mailbox_candidates(provider, "trash")),
            OpStep::DeleteExpunge,
        ]),
        other => Err(format!("unsupported_op:{other}")),
    }
}

pub(super) fn queue_op(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
    op: &str,
    dest_folder: Option<&str>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let entry = StoredMailOpEntry {
        id: id.clone(),
        account_id: account_id.to_string(),
        folder: folder.to_string(),
        uid,
        op: op.to_string(),
        dest_folder: dest_folder.map(str::to_string),
        copied: false,
        retry_count: 0,
        next_retry_at: now_iso(),
        last_error: None,
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    state
        .store
        .put_email_op_outbox(&id, &serde_json::to_value(entry).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Flush queued triage ops for one account. Returns whether any op ran. Mirrors the
/// flag outbox's retry/backoff (cap 8, exponential + jitter).
pub(super) fn flush_op_outbox_for_account(
    state: &AppState,
    account: &StoredEmailAccount,
) -> Result<bool, String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    // Prefer UID EXPUNGE (UIDPLUS) so a delete removes ONLY our flagged message; a
    // bare EXPUNGE would purge any other `\Deleted` message in the mailbox (one left
    // by another client, or by a prior failed op in this flush).
    let uidplus = session
        .capabilities()
        .map(|caps| caps.has_str("UIDPLUS"))
        .unwrap_or(false);
    let now = chrono::Utc::now();
    let mut any_success = false;

    let entries = state
        .store
        .list_email_op_outbox()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredMailOpEntry>)
        .filter(|entry| entry.account_id == account.id)
        .collect::<Vec<_>>();

    for mut entry in entries {
        let next_retry_at = chrono::DateTime::parse_from_rfc3339(&entry.next_retry_at)
            .map(|value| value.with_timezone(&chrono::Utc))
            .unwrap_or(now);
        if next_retry_at > now {
            continue;
        }

        let plan = match plan_op(
            account.provider.as_str(),
            &entry.op,
            entry.dest_folder.as_deref(),
        ) {
            Ok(plan) => plan,
            Err(_) => {
                // A malformed op can never succeed — drop it (no poison-pill wedge).
                let _ = state.store.remove_email_op_outbox(&entry.id);
                continue;
            }
        };

        match run_op(&mut session, account, &mut entry, &plan, uidplus) {
            Ok(()) => {
                any_success = true;
                let _ = state.store.remove_email_op_outbox(&entry.id);
            }
            Err(error) => {
                entry.retry_count = entry.retry_count.saturating_add(1);
                if entry.retry_count > 8 {
                    let _ = state.store.remove_email_op_outbox(&entry.id);
                    continue;
                }
                let jitter_ms = fastrand::u32(..1500) as i64;
                let delay = (2_i64.pow(entry.retry_count.min(6))) + jitter_ms / 1000;
                entry.next_retry_at =
                    (chrono::Utc::now() + chrono::Duration::seconds(delay)).to_rfc3339();
                entry.last_error = Some(error);
                entry.updated_at = now_iso();
                let _ = state.store.put_email_op_outbox(
                    &entry.id,
                    &serde_json::to_value(&entry).map_err(|e| e.to_string())?,
                );
            }
        }
    }

    let _ = session.logout();
    Ok(any_success)
}

/// Execute a plan against the SOURCE mailbox. Mutates `entry.copied` after a
/// successful COPY so that if a later step fails and the op is retried, the COPY is
/// NOT repeated (which would duplicate the message in the destination). The caller
/// persists the (possibly-updated) entry on failure.
fn run_op(
    session: &mut super::connection::ImapSession,
    account: &StoredEmailAccount,
    entry: &mut StoredMailOpEntry,
    plan: &[OpStep],
    uidplus: bool,
) -> Result<(), String> {
    let _ = select_mailbox_for_folder(session, account.provider.as_str(), &entry.folder)?;
    let uid = entry.uid.to_string();

    for step in plan {
        match step {
            OpStep::CopyTo(candidates) => {
                // Skip a COPY already committed on a prior attempt.
                if entry.copied {
                    continue;
                }
                let mut copied = false;
                for mailbox in candidates {
                    if session.uid_copy(&uid, mailbox).is_ok() {
                        copied = true;
                        break;
                    }
                }
                if !copied {
                    return Err(format!("op_copy_failed:{}", entry.op));
                }
                entry.copied = true;
            }
            OpStep::DeleteExpunge => {
                session
                    .uid_store(&uid, "+FLAGS.SILENT (\\Deleted)")
                    .map_err(|e| format!("op_flag_failed:{e}"))?;
                if uidplus {
                    session
                        .uid_expunge(&uid)
                        .map_err(|e| format!("op_expunge_failed:{e}"))?;
                } else {
                    // No UIDPLUS: fall back to a bare EXPUNGE. Safe because we set
                    // `\Deleted` on exactly one UID immediately before this and never
                    // batch-flag — but any foreign `\Deleted` in the box would also go.
                    session
                        .expunge()
                        .map_err(|e| format!("op_expunge_failed:{e}"))?;
                }
            }
        }
    }
    Ok(())
}

/// LIST the account's server folders (delimiter-aware), for the move popover (EM-5).
pub(super) fn list_folders_blocking(
    state: &AppState,
    account: &StoredEmailAccount,
) -> Result<Vec<EmailFolderDto>, String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let names = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("list_folders_failed:{e}"))?;

    let mut folders = names
        .iter()
        .map(|name| {
            let full = name.name().to_string();
            let selectable = !name
                .attributes()
                .iter()
                .any(|attr| matches!(attr, imap::types::NameAttribute::NoSelect));
            let display_name = name
                .delimiter()
                .and_then(|delim| full.rsplit(delim).next())
                .map(str::to_string)
                .unwrap_or_else(|| full.clone());
            EmailFolderDto {
                name: full,
                display_name,
                delimiter: name.delimiter().map(str::to_string),
                selectable,
            }
        })
        .collect::<Vec<_>>();

    let _ = session.logout();
    folders.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(folders)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gmail_archive_only_expunges_from_the_label() {
        // Gmail archive removes the INBOX label (the mail stays in All Mail) — no
        // COPY, just \Deleted + EXPUNGE in the source.
        assert_eq!(
            plan_op("gmail", "archive", None).unwrap(),
            vec![OpStep::DeleteExpunge]
        );
    }

    #[test]
    fn generic_archive_copies_then_expunges() {
        let plan = plan_op("icloud", "archive", None).unwrap();
        assert!(matches!(plan[0], OpStep::CopyTo(_)));
        assert_eq!(plan[1], OpStep::DeleteExpunge);
        if let OpStep::CopyTo(candidates) = &plan[0] {
            assert!(candidates.iter().any(|m| m == "Archive"));
        }
    }

    #[test]
    fn move_requires_a_destination_and_copies_to_it() {
        assert_eq!(
            plan_op("custom", "move", Some("Projects/Acme")).unwrap(),
            vec![
                OpStep::CopyTo(vec!["Projects/Acme".to_string()]),
                OpStep::DeleteExpunge
            ]
        );
        assert!(plan_op("custom", "move", None).is_err());
        assert!(plan_op("custom", "move", Some("   ")).is_err());
    }

    #[test]
    fn delete_copies_to_trash_then_expunges() {
        let plan = plan_op("gmail", "delete", None).unwrap();
        assert!(matches!(plan[0], OpStep::CopyTo(_)));
        assert_eq!(plan[1], OpStep::DeleteExpunge);
        if let OpStep::CopyTo(candidates) = &plan[0] {
            assert!(candidates.iter().any(|m| m.contains("Trash")));
        }
    }

    #[test]
    fn unsupported_op_is_rejected() {
        assert!(plan_op("gmail", "frobnicate", None).is_err());
    }
}
