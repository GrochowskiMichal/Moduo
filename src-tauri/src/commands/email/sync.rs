use std::collections::HashSet;

use crate::email_sync::EmailSyncCursorRecord;
use crate::AppState;

use super::connection::{open_imap_session, ImapSession};
use super::parsing::{
    decode_header_value_bytes, parse_address, parse_header_value, parse_references, thread_id_from,
    to_millis_from_date, truncate_with_ellipsis,
};
use super::storage::{
    envelope_key, list_envelopes_filtered, load_folder_cursor, message_key, parse_json_value,
    remove_body_cache, remove_envelope, save_folder_cursor, upsert_account_v2, upsert_envelopes,
    workspace_id_or_default,
};
use super::{
    ensure_account_config, now_iso, select_mailbox_for_folder, EmailHistoryDepth,
    StoredEmailAccount, StoredEnvelope, BACKFILL_BATCH_UIDS, FLAG_RECONCILE_WINDOW,
    FLAG_RECONCILE_WINDOW_LIGHT, SYNC_ENVELOPE_WINDOW_UIDS,
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

/// The depth window a configured [`EmailHistoryDepth`] resolves to.
pub(super) struct DepthWindow {
    /// The IMAP `SINCE` date to search from, already formatted `DD-Mon-YYYY`.
    /// `None` for `Everything` — search `ALL` instead.
    pub(super) since: Option<String>,
    /// Timestamp floor (ms): an envelope older than this is outside the window.
    /// `None` for `Everything` — nothing is ever outside it.
    pub(super) floor_ms: Option<i64>,
}

/// Resolve a depth choice into an IMAP `SINCE` date and a timestamp floor.
///
/// Calendar months, not 30-day approximations, so "3 months" means what the user
/// reads it as. This replaces the old "fetch the newest 1000 UIDs, then throw away
/// anything older than 90 days client-side" — which paid full bandwidth for data it
/// discarded (specs/import.md assumption 5).
/// Returns `None` when the window can't be computed (an implausible clock). That is
/// **fail-closed on purpose**: falling back to `Everything` would turn a 3-month
/// account into `UID SEARCH ALL`, and — once the reached floor is recorded — would
/// stick an unbounded floor in the cursor that permanently disables pruning and gap
/// detection. The caller skips the backfill for the round instead.
pub(super) fn depth_window(depth: EmailHistoryDepth, now_ms: i64) -> Option<DepthWindow> {
    let months = match depth {
        EmailHistoryDepth::ThreeMonths => 3,
        EmailHistoryDepth::SixMonths => 6,
        EmailHistoryDepth::TwelveMonths => 12,
        EmailHistoryDepth::Everything => {
            return Some(DepthWindow {
                since: None,
                floor_ms: None,
            })
        }
    };
    let now = chrono::DateTime::from_timestamp_millis(now_ms)?;
    let cutoff = now.checked_sub_months(chrono::Months::new(months))?;
    // IMAP `SINCE` compares whole *dates* against INTERNALDATE, so the server's
    // answer is date-granular. Truncate the local floor to that date's midnight so
    // the two agree — otherwise every round re-fetches up to a day of mail that
    // `in_depth_window` then silently discards, which is the exact
    // pay-bandwidth-for-nothing pattern this block set out to remove.
    let midnight = cutoff.date_naive().and_hms_opt(0, 0, 0)?.and_utc();
    Some(DepthWindow {
        since: Some(midnight.format("%d-%b-%Y").to_string()),
        floor_ms: Some(midnight.timestamp_millis()),
    })
}

/// The next slice of the backwards walk: the newest `limit` target UIDs strictly
/// below the resume frontier, newest-first.
///
/// Bounded per sync round on purpose — the engine emits no progress events until
/// IM-2c, so a 12-month first sync must fill in over successive rounds rather than
/// blocking one long sync and looking like a hang.
pub(super) fn backfill_batch(
    target: &HashSet<u32>,
    frontier: Option<u32>,
    limit: usize,
) -> Vec<u32> {
    let ceiling = frontier.unwrap_or(u32::MAX);
    let mut older = target
        .iter()
        .copied()
        .filter(|uid| *uid > 0 && *uid < ceiling)
        .collect::<Vec<_>>();
    older.sort_unstable_by(|a, b| b.cmp(a));
    older.truncate(limit);
    older
}

/// Is this envelope inside the depth window? A row with no usable date is kept,
/// matching the pre-IM-2b behavior of `within_sync_window`.
pub(super) fn in_depth_window(timestamp_ms: i64, floor_ms: Option<i64>) -> bool {
    if timestamp_ms <= 0 {
        return true;
    }
    floor_ms.is_none_or(|floor| timestamp_ms >= floor)
}

/// The floor a prune may delete below: the deeper (older) of the configured depth
/// and the depth already reached, where `None` means unbounded — never prune.
///
/// This is what makes lowering the depth non-destructive (AC8): the configured floor
/// moves up, the reached floor does not, so nothing already synced becomes prunable.
/// A `reached` of `None` also covers "we don't know how deep we are yet", where not
/// pruning is the safe answer.
pub(super) fn deepest_floor(configured: Option<i64>, reached: Option<i64>) -> Option<i64> {
    match (configured, reached) {
        (None, _) | (_, None) => None,
        (Some(configured), Some(reached)) => Some(configured.min(reached)),
    }
}

/// Advance the reached floor once a walk completes.
///
/// **Not** [`deepest_floor`]: there, `None` means "unbounded". Here the two `None`s
/// are different states — `reached: None` means *nothing reached yet* (so the floor
/// we just walked to simply wins), while `just_reached: None` means *walked
/// `Everything`* (genuinely unbounded). Collapsing them makes `None` a fixed point,
/// which silently kills both the prune gate and depth-increase detection.
pub(super) fn advance_reached_floor(
    reached: Option<i64>,
    just_reached: Option<i64>,
) -> Option<i64> {
    match (reached, just_reached) {
        // Walked the whole mailbox — deeper than any dated floor.
        (_, None) => None,
        (None, Some(just_reached)) => Some(just_reached),
        (Some(reached), Some(just_reached)) => Some(reached.min(just_reached)),
    }
}

/// Is there any target UID left below the frontier? The completion signal, without
/// [`backfill_batch`]'s allocate-and-sort (for `Everything` the target set is the
/// whole mailbox).
pub(super) fn has_older_target(target: &HashSet<u32>, frontier: Option<u32>) -> bool {
    let ceiling = frontier.unwrap_or(u32::MAX);
    target.iter().any(|uid| *uid > 0 && *uid < ceiling)
}

/// The backfill's per-folder state, as carried in the sync cursor.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(super) struct BackfillState {
    pub(super) oldest_synced_uid: Option<u32>,
    pub(super) history_floor_ms: Option<i64>,
    pub(super) complete: bool,
}

/// The state a sync round starts from.
///
/// **`generation_changed` discards everything.** When the server's `uid_validity`
/// differs from the cursor's, the mailbox was recreated and the UID space is new: a
/// recorded frontier, floor or "complete" flag all describe numbering that no longer
/// exists. Carrying them over is how a recreated mailbox ends up with `complete =
/// true` (so the walk never re-runs) while every stored UID sits above the new
/// high-water mark. Resetting makes the walk re-fetch the window under the new
/// numbering.
///
/// Otherwise: carry the stored state, seed the frontier from the oldest row already
/// held (so an upgraded store doesn't re-fetch what it has), and re-open a completed
/// walk when the configured depth now reaches past the depth reached (AC8).
pub(super) fn backfill_state_for_round(
    stored: BackfillState,
    generation_changed: bool,
    configured_floor: Option<i64>,
    local_oldest_uid: Option<u32>,
) -> BackfillState {
    if generation_changed {
        return BackfillState::default();
    }
    BackfillState {
        oldest_synced_uid: stored.oldest_synced_uid.or(local_oldest_uid),
        history_floor_ms: stored.history_floor_ms,
        complete: stored.complete && !depth_gap_reopens(configured_floor, stored.history_floor_ms),
    }
}

/// The floor to record when a walk completes.
///
/// Never shallower than the oldest row already stored. Recording the *configured*
/// floor alone is unsafe: a 12-month walk that got back to 6 months and is then
/// lowered to 3 finds nothing below its new frontier, reports "complete", and would
/// record a 3-month floor — after which the depth-gated prune is free to delete the
/// 3-to-6-month mail it had already fetched (AC8).
pub(super) fn completed_floor(
    configured: Option<i64>,
    oldest_stored_ms: Option<i64>,
) -> Option<i64> {
    let configured = configured?;
    Some(match oldest_stored_ms {
        Some(oldest) if oldest > 0 => configured.min(oldest),
        _ => configured,
    })
}

/// Local UIDs above the server's high-water mark. After a `uid_validity` change the
/// mailbox was recreated, so any local UID at or above the new `uid_next` provably
/// does not exist on the server — removing those is not a depth decision, so it is
/// allowed even though the depth-gated prune keeps everything inside the window
/// (AC10). Without this they accumulate as permanent ghost rows that list but can
/// never be opened.
pub(super) fn ghost_uids(local: impl IntoIterator<Item = u32>, server_latest_uid: u32) -> Vec<u32> {
    if server_latest_uid == 0 {
        return Vec::new();
    }
    local
        .into_iter()
        .filter(|uid| *uid > server_latest_uid)
        .collect()
}

/// True when the configured depth now reaches further back than this store has
/// actually synced — the user raised the depth, so there is a gap to backfill and a
/// completed walk has to re-open (AC8). Lowering the depth returns false: fetching
/// stops, nothing is deleted.
pub(super) fn depth_gap_reopens(configured: Option<i64>, reached: Option<i64>) -> bool {
    match (configured, reached) {
        // Raised to `Everything` from a bounded depth — always a gap.
        (None, Some(_)) => true,
        // Already unbounded, or lowered from `Everything`: nothing new to fetch.
        (None, None) | (Some(_), None) => false,
        (Some(configured), Some(reached)) => configured < reached,
    }
}

/// UIDs the full-reset prune may remove: locally stored, absent from what this
/// round fetched, **and** outside the depth window.
///
/// The old prune deleted every local row missing from the just-fetched UID set, so
/// a `uid_validity` change (or simply a bounded backfill batch) erased backfilled
/// history. Depth is a floor, not a ceiling that evicts (AC10, assumption 7).
pub(super) fn prunable_uids(
    local: impl IntoIterator<Item = (u32, i64)>,
    fetched: &HashSet<u32>,
    prune_floor: Option<i64>,
) -> Vec<u32> {
    let Some(floor) = prune_floor else {
        return Vec::new();
    };
    local
        .into_iter()
        .filter(|(uid, timestamp_ms)| {
            !fetched.contains(uid) && *timestamp_ms > 0 && *timestamp_ms < floor
        })
        .map(|(uid, _)| uid)
        .collect()
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

/// The server-side UID set for the depth window: `UID SEARCH SINCE <date>`, or
/// `ALL` for `Everything`. Asking the server which UIDs fall in the window is both
/// correct and cheaper than fetching the newest N and discarding the rest.
fn search_depth_window(
    session: &mut ImapSession,
    since: Option<&str>,
) -> Result<HashSet<u32>, String> {
    let query = match since {
        Some(date) => format!("SINCE {date}"),
        None => "ALL".to_string(),
    };
    let result = session
        .uid_search(query)
        .map_err(|e| format!("uid_search_failed:{e}"))?;
    Ok(result.iter().copied().collect::<HashSet<_>>())
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

    let now_ms = chrono::Utc::now().timestamp_millis();
    let window = depth_window(account.history_depth, now_ms);

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

    // The recent window: keep only what's inside the configured depth. `Everything`
    // has no floor, so nothing is filtered out.
    for chunk in uids_to_fetch.chunks(50) {
        let rows = fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
        let in_window = rows
            .into_iter()
            .filter(|row| {
                in_depth_window(row.timestamp_ms, window.as_ref().and_then(|w| w.floor_ms))
            })
            .collect::<Vec<_>>();
        upsert_envelopes(state, &in_window)?;
    }

    // ── Backwards backfill (IM-2b) ────────────────────────────────────────────
    // Walk older UIDs toward the configured depth, resuming from the cursor's floor.
    // `UID SEARCH SINCE` asks the server which UIDs are in the window instead of
    // over-fetching newest-N and discarding the rest.
    let configured_floor = window.as_ref().and_then(|w| w.floor_ms);
    // A `uid_validity` change discards the recorded state — see
    // `backfill_state_for_round`.
    let generation_changed = current_cursor
        .as_ref()
        .is_some_and(|cursor| cursor.uid_validity != uid_validity);
    let mut backfill = backfill_state_for_round(
        BackfillState {
            oldest_synced_uid: current_cursor.as_ref().and_then(|c| c.oldest_synced_uid),
            history_floor_ms: current_cursor.as_ref().and_then(|c| c.history_floor_ms),
            complete: current_cursor.as_ref().is_some_and(|c| c.backfill_complete),
        },
        generation_changed,
        configured_floor,
        current_local.iter().map(|row| row.uid).min(),
    );
    let mut backfill_last_error = current_cursor
        .as_ref()
        .and_then(|cursor| cursor.backfill_last_error.clone());

    // Skipped entirely when the window is unknown (fail-closed `depth_window`).
    if let (false, Some(window)) = (backfill.complete, window.as_ref()) {
        // The backfill must never fail the round: forward sync, the reconciles and
        // the cursor save all still have to happen, or a deterministic failure
        // (one poison UID, a slow `UID SEARCH`) pins the account at `error` forever.
        // It stays retried rather than skipped — a transient network failure is far
        // likelier than a poison UID — so the error is recorded on the cursor
        // instead of being swallowed, giving IM-2c something to surface.
        let mut walked = Vec::<u32>::new();
        let outcome = (|| -> Result<bool, String> {
            let target = search_depth_window(&mut session, window.since.as_deref())?;
            // ONE batch per round. Budgeting more here mis-routes: `email_sync_now`
            // hardcodes `force_sync: false`, so keying the budget on that flag gave
            // the interactive Refresh the *background* allowance. A real driver, a
            // bigger budget and the progress + cancel that makes one safe are IM-2c.
            let batch = backfill_batch(&target, backfill.oldest_synced_uid, BACKFILL_BATCH_UIDS);
            for chunk in batch.chunks(50) {
                let rows =
                    fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
                let in_window = rows
                    .into_iter()
                    .filter(|row| in_depth_window(row.timestamp_ms, window.floor_ms))
                    .collect::<Vec<_>>();
                upsert_envelopes(state, &in_window)?;
                // Record progress per *stored* chunk, so a failure mid-batch still
                // moves the frontier and never re-fetches these UIDs.
                walked.extend(chunk.iter().copied());
            }
            // Nothing older left in the target set → the walk reached the depth.
            Ok(!has_older_target(
                &target,
                walked.iter().copied().min().or(backfill.oldest_synced_uid),
            ))
        })();

        if let Some(reached) = walked.iter().copied().min() {
            backfill.oldest_synced_uid = Some(
                backfill
                    .oldest_synced_uid
                    .map_or(reached, |prev| prev.min(reached)),
            );
        }
        match outcome {
            Ok(complete) => {
                backfill_last_error = None;
                if complete {
                    backfill.complete = true;
                    // Measured, not merely configured — see `completed_floor`.
                    let oldest_stored_ms = current_local
                        .iter()
                        .map(|row| row.timestamp_ms)
                        .filter(|ms| *ms > 0)
                        .min();
                    backfill.history_floor_ms = advance_reached_floor(
                        backfill.history_floor_ms,
                        completed_floor(window.floor_ms, oldest_stored_ms),
                    );
                }
            }
            Err(error) => {
                eprintln!(
                    "[email] backfill step failed for {}::{folder} ({error}) — forward sync continues",
                    account.id
                );
                backfill_last_error = Some(error);
            }
        }
    }

    if should_full_reset {
        let fetched_set = uids_to_fetch.iter().copied().collect::<HashSet<u32>>();
        // Gate the prune on the depth floor. It used to delete every local row
        // missing from the just-fetched set, which erased backfilled history on any
        // `uid_validity` change; and gating on the *reached* floor rather than the
        // configured one is what makes lowering the depth non-destructive.
        let prune_floor = deepest_floor(configured_floor, backfill.history_floor_ms);
        let mut prunable = prunable_uids(
            current_local.iter().map(|row| (row.uid, row.timestamp_ms)),
            &fetched_set,
            prune_floor,
        )
        .into_iter()
        .collect::<HashSet<u32>>();
        // Rows above the server's high-water mark can't exist there at all — not a
        // depth call, so they go regardless of the window. Only valid while the UID
        // generation is unchanged: after a `uid_validity` change every stored UID
        // belongs to the old numbering, so "above the mark" would mean "all of it".
        if !generation_changed {
            prunable.extend(ghost_uids(
                current_local.iter().map(|row| row.uid),
                latest_uid,
            ));
        }
        for row in &current_local {
            if prunable.contains(&row.uid) {
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
            let mut reflagged = Vec::<StoredEnvelope>::new();
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
                    reflagged.push(envelope);
                } else {
                    missing_uids.push(uid);
                }
            }
            upsert_envelopes(state, &reflagged)?;
            for chunk in missing_uids.chunks(50) {
                let rows =
                    fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
                upsert_envelopes(state, &rows)?;
            }
            reconciled_with_condstore = true;
        }
    }
    if !reconciled_with_condstore {
        for chunk in reconcile_uids.chunks(50) {
            let rows =
                fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
            upsert_envelopes(state, &rows)?;
        }
    }

    // One list read for both the expunge reconcile and the empty-index safety net.
    // This runs per sync round over the whole depth window, so at a 12-month depth a
    // third full read of the folder is real cost (IM-2a made each one a prefix scan;
    // it did not make them free).
    let recent_server_uids = search_uid_window(&mut session, reconcile_start, latest_uid)?;
    let local_rows = list_envelopes_filtered(state, Some(&account.id), folder)?;
    let mut removed_by_reconcile = 0usize;
    for row in &local_rows {
        if row.uid >= reconcile_start
            && row.uid <= latest_uid
            && !recent_server_uids.contains(&row.uid)
        {
            let _ = remove_envelope(state, &row.account_id, &row.folder, row.uid);
            let _ = remove_body_cache(state, &row.account_id, &row.folder, row.uid);
            removed_by_reconcile = removed_by_reconcile.saturating_add(1);
        }
    }

    // Safety net: if server reports messages but local index is empty, rebuild latest window.
    let post_reconcile_count = local_rows.len().saturating_sub(removed_by_reconcile);
    if post_reconcile_count == 0 && exists > 0 && latest_uid > 0 {
        let recovery_start = uid_window_start(latest_uid, SYNC_ENVELOPE_WINDOW_UIDS);
        let recovery_uids = collect_uid_range(recovery_start, latest_uid);
        for chunk in recovery_uids.chunks(50) {
            let rows =
                fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
            upsert_envelopes(state, &rows)?;
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
        oldest_synced_uid: backfill.oldest_synced_uid,
        history_floor_ms: backfill.history_floor_ms,
        backfill_complete: backfill.complete,
        backfill_last_error,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-07-29T12:00:00Z — a fixed clock, so the expected `SINCE` dates are
    /// literals rather than something recomputed from the code under test.
    const NOW_MS: i64 = 1_785_326_400_000;

    fn window_of(depth: EmailHistoryDepth) -> DepthWindow {
        depth_window(depth, NOW_MS).expect("a plausible clock yields a window")
    }

    fn floor_of(depth: EmailHistoryDepth) -> Option<i64> {
        window_of(depth).floor_ms
    }

    /// AC6, AC7 — a depth choice maps to the right `SINCE` date and UID floor.
    #[test]
    fn depth_window_from_choice() {
        assert_eq!(
            window_of(EmailHistoryDepth::ThreeMonths).since.as_deref(),
            Some("29-Apr-2026"),
            "3 months back from 29 Jul 2026"
        );
        assert_eq!(
            window_of(EmailHistoryDepth::SixMonths).since.as_deref(),
            Some("29-Jan-2026"),
            "6 months back"
        );
        assert_eq!(
            window_of(EmailHistoryDepth::TwelveMonths).since.as_deref(),
            Some("29-Jul-2025"),
            "12 months back — calendar months, so the day-of-month is preserved"
        );

        // `Everything` has no SINCE and no floor: search ALL, filter nothing.
        let everything = window_of(EmailHistoryDepth::Everything);
        assert_eq!(everything.since, None);
        assert_eq!(everything.floor_ms, None);

        // Floors are ordered deepest-last, and each one actually excludes mail
        // older than itself.
        let three = floor_of(EmailHistoryDepth::ThreeMonths).expect("3m floor");
        let twelve = floor_of(EmailHistoryDepth::TwelveMonths).expect("12m floor");
        assert!(twelve < three, "12 months reaches further back than 3");
        assert!(!in_depth_window(twelve - 1, Some(three)));
        assert!(in_depth_window(NOW_MS, Some(twelve)));
        // The pre-IM-2b rule for a message with no usable date: keep it.
        assert!(in_depth_window(0, Some(three)));
        // `Everything` keeps everything, including mail from 1990.
        assert!(in_depth_window(631_152_000_000, None));
    }

    /// The `SINCE` date and the local floor must agree, or every round re-fetches
    /// up to a day of mail the filter then discards.
    #[test]
    fn depth_window_floor_matches_its_since_date() {
        let window = window_of(EmailHistoryDepth::TwelveMonths);
        let floor = window.floor_ms.expect("12m floor");
        let midnight = chrono::DateTime::from_timestamp_millis(floor).expect("valid floor");
        assert_eq!(
            midnight.format("%d-%b-%Y").to_string(),
            window.since.expect("12m since"),
            "the floor is midnight of the SINCE date"
        );
        assert_eq!(
            (midnight.timestamp_millis() % 86_400_000),
            0,
            "floor is truncated to a whole UTC day, matching IMAP's date-granular SINCE"
        );
    }

    /// An implausible clock must NOT degrade to `Everything` — that would turn a
    /// 3-month account into `UID SEARCH ALL` and, once recorded, stick an unbounded
    /// floor in the cursor that disables pruning and gap detection for good.
    #[test]
    fn depth_window_fails_closed_on_a_broken_clock() {
        assert!(depth_window(EmailHistoryDepth::ThreeMonths, i64::MIN).is_none());
        assert!(depth_window(EmailHistoryDepth::TwelveMonths, i64::MAX).is_none());
        // `Everything` needs no clock at all, so it still resolves.
        assert!(depth_window(EmailHistoryDepth::Everything, i64::MIN).is_some());
    }

    /// AC8, AC10 — the reached-floor state machine, end to end.
    ///
    /// This is the test that catches the mistake the first cut shipped: advancing the
    /// reached floor with [`deepest_floor`] (where `None` means *unbounded*) made
    /// `None` a fixed point, so `history_floor_ms` could never become `Some`. Every
    /// pure-function test still passed while, in the engine, the prune gate was dead
    /// and raising the depth backfilled nothing.
    #[test]
    fn reached_floor_advances_and_reopens_on_a_depth_increase() {
        let three = floor_of(EmailHistoryDepth::ThreeMonths);
        let twelve = floor_of(EmailHistoryDepth::TwelveMonths);

        // Round 1: nothing reached yet, the walk completes at 3 months.
        let after_first = advance_reached_floor(None, three);
        assert_eq!(
            after_first, three,
            "the first completed walk MUST record its floor — `None` is not a fixed point"
        );
        // With a floor recorded, the prune finally has a gate to work with — before
        // the fix this was `None`, i.e. the gate was never armed at all.
        assert_eq!(deepest_floor(three, after_first), three);

        // Raise 3 -> 12: a gap re-opens, so a completed backfill resumes.
        assert!(depth_gap_reopens(twelve, after_first));
        // Round 2 completes at 12 months; the reached floor deepens.
        let after_second = advance_reached_floor(after_first, twelve);
        assert_eq!(after_second, twelve);
        assert!(!depth_gap_reopens(twelve, after_second), "no gap left");

        // Lower 12 -> 3: no gap, and the prune still uses the DEEPER reached floor,
        // so nothing between 3 and 12 months becomes prunable (AC8).
        assert!(!depth_gap_reopens(three, after_second));
        assert_eq!(deepest_floor(three, after_second), twelve);

        // Raise to Everything: a gap re-opens, and completing it records an
        // unbounded floor that never prunes again.
        assert!(depth_gap_reopens(None, after_second));
        let after_everything = advance_reached_floor(after_second, None);
        assert_eq!(after_everything, None);
        assert_eq!(deepest_floor(three, after_everything), None);
        assert!(!depth_gap_reopens(None, after_everything));
    }

    /// AC10 — a recreated mailbox must not keep the old UID space's backfill state.
    ///
    /// The bug this pins: carrying `complete: true` and a recorded floor across a
    /// `uid_validity` change left every stored UID above the new high-water mark
    /// (so the ghost sweep would delete the whole history, in-window mail included)
    /// while `complete` kept the walk from ever re-running.
    #[test]
    fn a_uid_validity_change_resets_the_backfill_state() {
        let twelve = floor_of(EmailHistoryDepth::TwelveMonths);
        let walked = BackfillState {
            oldest_synced_uid: Some(4_000),
            history_floor_ms: twelve,
            complete: true,
        };

        let after = backfill_state_for_round(walked, true, twelve, Some(4_000));
        assert_eq!(
            after,
            BackfillState::default(),
            "a new UID generation invalidates the frontier, the floor AND completion"
        );

        // Same generation: the state is carried, and a matching depth stays complete.
        let carried = backfill_state_for_round(walked, false, twelve, Some(4_000));
        assert_eq!(carried, walked);

        // Same generation, no recorded frontier (an upgraded store): seed from the
        // oldest row already held rather than re-fetching it.
        let upgraded =
            backfill_state_for_round(BackfillState::default(), false, twelve, Some(1_200));
        assert_eq!(upgraded.oldest_synced_uid, Some(1_200));
        assert!(!upgraded.complete);

        // Same generation, depth raised: completion re-opens so the walk resumes.
        let raised = backfill_state_for_round(
            BackfillState {
                history_floor_ms: floor_of(EmailHistoryDepth::ThreeMonths),
                ..walked
            },
            false,
            twelve,
            Some(4_000),
        );
        assert!(!raised.complete, "a depth increase re-opens the walk");
        assert_eq!(
            raised.oldest_synced_uid,
            Some(4_000),
            "but keeps the frontier"
        );
    }

    /// AC8 — completing a walk must not record a floor shallower than what is
    /// already stored, or the prune is later free to delete mail already fetched.
    #[test]
    fn completing_a_walk_records_a_measured_floor() {
        let three = floor_of(EmailHistoryDepth::ThreeMonths);
        let six = floor_of(EmailHistoryDepth::SixMonths);

        // A 12-month walk reached 6 months, then the user drops to 3. The 3-month
        // target has nothing below the frontier, so the round reports "complete" —
        // recording the configured 3-month floor would make the 3-to-6-month mail
        // prunable.
        assert_eq!(
            completed_floor(three, six),
            six,
            "the recorded floor is as deep as the oldest row actually stored"
        );
        // Nothing stored yet, or an undated row: the configured floor is all we know.
        assert_eq!(completed_floor(three, None), three);
        assert_eq!(completed_floor(three, Some(0)), three);
        // A shallower store than the configured depth doesn't shrink the promise.
        assert_eq!(completed_floor(six, three), six);
        // `Everything` stays unbounded.
        assert_eq!(completed_floor(None, six), None);

        // End to end: the shallow completion can no longer strand the deeper mail.
        let recorded = advance_reached_floor(None, completed_floor(three, six));
        assert_eq!(deepest_floor(three, recorded), six);
    }

    /// A recreated mailbox leaves local UIDs above the server's high-water mark.
    /// They provably don't exist there, so removing them isn't a depth decision —
    /// otherwise they'd list forever and never open.
    #[test]
    fn ghost_rows_above_the_server_high_water_mark_are_removable() {
        assert_eq!(
            ghost_uids(vec![5u32, 100, 101, 4_000], 100),
            vec![101, 4_000]
        );
        // An empty mailbox reports no high-water mark — refuse to treat everything
        // as a ghost.
        assert!(ghost_uids(vec![5u32, 100], 0).is_empty());
        assert!(ghost_uids(Vec::<u32>::new(), 100).is_empty());
    }

    /// The cheap completion signal must agree with `backfill_batch`.
    #[test]
    fn has_older_target_matches_the_batch() {
        let target = HashSet::from([3u32, 7, 9]);
        for frontier in [None, Some(1u32), Some(4), Some(8), Some(10), Some(u32::MAX)] {
            assert_eq!(
                has_older_target(&target, frontier),
                !backfill_batch(&target, frontier, 1).is_empty(),
                "frontier {frontier:?}"
            );
        }
    }

    /// AC9 — a cursor with a recorded floor resumes backwards instead of restarting.
    #[test]
    fn backfill_resumes_from_floor() {
        let target = (1u32..=1_000).collect::<HashSet<u32>>();

        // First round, nothing recorded yet: take the newest slice.
        let first = backfill_batch(&target, None, 10);
        assert_eq!(first.first().copied(), Some(1_000), "newest-first");
        assert_eq!(first.last().copied(), Some(991));

        // Second round resumes strictly below the recorded frontier — it does NOT
        // re-walk 991..1000 (the bug this test exists for: a restart from zero).
        let second = backfill_batch(&target, Some(991), 10);
        assert_eq!(second.first().copied(), Some(990));
        assert_eq!(second.last().copied(), Some(981));
        assert!(
            second.iter().all(|uid| *uid < 991),
            "resume must never re-fetch at or above the frontier"
        );

        // The walk is bounded per round, so a huge window can't block one sync.
        assert_eq!(backfill_batch(&target, None, 500).len(), 500);

        // Reaching the bottom yields nothing — the engine's "backfill complete"
        // signal. UID 0 is not a real UID and never appears.
        assert!(backfill_batch(&target, Some(1), 10).is_empty());
        assert!(backfill_batch(&HashSet::new(), None, 10).is_empty());

        // A UID set with holes (expunged mail) still walks downward correctly.
        let sparse = HashSet::from([5u32, 40, 41, 900]);
        assert_eq!(backfill_batch(&sparse, Some(900), 10), vec![41, 40, 5]);
    }

    /// AC10 — a `uid_validity` change does not prune rows inside the configured
    /// depth. The old prune deleted every local row missing from the just-fetched
    /// UID set, which erased backfilled history on any mailbox recreation.
    #[test]
    fn full_reset_preserves_in_window_history() {
        let floor = floor_of(EmailHistoryDepth::TwelveMonths).expect("12m floor");
        let day = 86_400_000_i64;
        let local = vec![
            (10u32, NOW_MS - day),    // yesterday, in window
            (11, floor + day),        // just inside the floor
            (12, floor - day),        // just outside — genuinely prunable
            (13, NOW_MS - 200 * day), // ~7 months old, in window
        ];
        // A full reset that fetched only the recent window: 11 and 13 are absent
        // from it purely because the backfill hasn't re-walked them yet.
        let fetched = HashSet::from([10u32]);

        let prunable = prunable_uids(local.clone(), &fetched, Some(floor));
        assert_eq!(
            prunable,
            vec![12],
            "only mail older than the depth floor may go — backfilled history stays"
        );

        // `Everything` (no floor) never prunes on depth grounds at all.
        assert!(prunable_uids(local.clone(), &fetched, None).is_empty());
        // A row with no usable date is never pruned either.
        assert!(prunable_uids(vec![(20u32, 0)], &HashSet::new(), Some(floor)).is_empty());
    }

    /// AC8 — reducing the depth stops fetching but removes nothing.
    #[test]
    fn lowering_depth_never_deletes() {
        let deep = floor_of(EmailHistoryDepth::TwelveMonths).expect("12m floor");
        let shallow = floor_of(EmailHistoryDepth::ThreeMonths).expect("3m floor");
        let day = 86_400_000_i64;

        // The store already walked back 12 months; the user drops the setting to 3.
        // Mail between 3 and 12 months is now outside the *configured* window.
        let reached = Some(deep);
        let configured = Some(shallow);
        let prune_floor = deepest_floor(configured, reached);
        assert_eq!(
            prune_floor, reached,
            "the prune is gated on what we already promised, not the new setting"
        );

        let six_months_old = deep + 180 * day;
        assert!(
            prunable_uids(vec![(7u32, six_months_old)], &HashSet::new(), prune_floor).is_empty(),
            "mail inside the OLD depth survives a depth reduction"
        );
        // And it stops fetching: no gap re-opens, so no backwards walk restarts.
        assert!(!depth_gap_reopens(configured, reached));

        // Raising the depth is the opposite: a gap re-opens so the walk resumes.
        assert!(depth_gap_reopens(Some(deep), Some(shallow)));
        // 3 -> Everything re-opens; Everything -> 3 does not.
        assert!(depth_gap_reopens(None, Some(shallow)));
        assert!(!depth_gap_reopens(Some(shallow), None));
        // Same depth twice is not a gap.
        assert!(!depth_gap_reopens(configured, configured));

        // Reaching `Everything` records an unbounded floor, which never prunes.
        assert_eq!(deepest_floor(None, reached), None);
    }
}
