//! Hybrid search (EM-9).
//!
//! Two halves:
//! - **Local body scan** ([`email_search_bodies`]) — a bounded scan of the 8KB
//!   lowercase body-text sidecar (written on body cache, co-pruned with the LRU),
//!   returning the matching envelopes. The envelope-field half (sender / subject /
//!   recipients) is done instantly client-side over the already-synced envelopes;
//!   this covers the "cached bodies" that the 120-char preview misses.
//! - **Server escalation** ([`email_search_server`]) — an explicit, per-account
//!   full-mailbox search: Gmail via `X-GM-RAW` in All Mail, standard IMAP via
//!   `SEARCH CHARSET UTF-8 TEXT` → ASCII fallback → honest `unsupported`. Hits are
//!   upserted into the store so opening a result fetches its body normally.
//!
//! The query-shaping + error-classification helpers here are pure and unit-tested
//! (the AC12 `search.rs` test); the IMAP work rides `spawn_blocking` with the async
//! OAuth refresh pre-step, like every other engine command.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use crate::AppState;

use super::account_config::{ensure_account_config, select_mailbox_for_folder};
use super::connection::{open_imap_session, ImapSession};
use super::storage::{parse_json_value, read_accounts, upsert_envelope};
use super::sync::fetch_envelopes_for_uids;
use super::{EmailEnvelopeDto, StoredBodyText, StoredEnvelope};

/// Max bytes of lowercase body text kept per message for local search (EM-9). The
/// preview is only 120 chars, so this catches deep-body matches without an index.
pub(super) const BODY_TEXT_SIDECAR_MAX_BYTES: usize = 8 * 1024;
/// Cap on locally-returned body hits (bounds the scan cost + the render list).
const LOCAL_SEARCH_HIT_CAP: usize = 200;
/// Cap on server-returned hits (the most-recent N UIDs — bounds the envelope fetch).
const SERVER_SEARCH_DEFAULT_LIMIT: usize = 100;
const SERVER_SEARCH_MAX_LIMIT: usize = 200;

/// Lowercase + 8KB-truncate (on a char boundary) a plain body for the search
/// sidecar. Called by `persist_body_cache`.
pub(super) fn body_search_text(plain: &str) -> String {
    let lowered = plain.to_lowercase();
    if lowered.len() <= BODY_TEXT_SIDECAR_MAX_BYTES {
        return lowered;
    }
    let mut end = BODY_TEXT_SIDECAR_MAX_BYTES;
    while end > 0 && !lowered.is_char_boundary(end) {
        end -= 1;
    }
    lowered[..end].to_string()
}

/// Escape a raw query for an IMAP quoted-string: strip CR/LF (a quoted string is
/// one line) and backslash-escape `\` and `"`.
pub(super) fn escape_imap_quoted(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 4);
    for c in raw.chars() {
        match c {
            '\r' | '\n' => {}
            '\\' | '"' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

/// The UTF-8 IMAP text-search argument (`CHARSET UTF-8 TEXT "…"`).
pub(super) fn imap_text_search_utf8(query: &str) -> String {
    format!("CHARSET UTF-8 TEXT \"{}\"", escape_imap_quoted(query))
}

/// The ASCII fallback (`TEXT "…"`), only when the query is representable — a
/// non-ASCII query the server rejected under UTF-8 can't be honestly downgraded.
pub(super) fn imap_text_search_ascii(query: &str) -> Option<String> {
    if query.is_ascii() {
        Some(format!("TEXT \"{}\"", escape_imap_quoted(query)))
    } else {
        None
    }
}

/// The Gmail extended-search argument — the raw string IS Gmail's own query syntax.
pub(super) fn gmail_raw_search(query: &str) -> String {
    format!("X-GM-RAW \"{}\"", escape_imap_quoted(query))
}

/// Map an IMAP error string to the honest UI state: a network/timeout condition vs
/// a server that refused the SEARCH (unsupported charset / command).
pub(super) fn classify_search_error(err: &str) -> &'static str {
    let lower = err.to_lowercase();
    if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("os error 60")
        || lower.contains("broken pipe")
        || lower.contains("connection reset")
        || lower.contains("connection aborted")
        || lower.contains("would block")
    {
        "timeout"
    } else {
        "unsupported"
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSearchLocalInput {
    /// `None` scans every account.
    pub account_id: Option<String>,
    /// `None` scans every folder; the inbox surface passes `"inbox"` so body hits
    /// match the instant envelope scope (never surfacing Sent/Trash bodies).
    pub folder: Option<String>,
    pub query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSearchServerInput {
    pub account_id: String,
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailServerSearchResult {
    /// `"ok" | "timeout" | "unsupported" | "error"`.
    pub status: String,
    pub message: Option<String>,
    pub envelopes: Vec<EmailEnvelopeDto>,
}

impl EmailServerSearchResult {
    fn ok(envelopes: Vec<EmailEnvelopeDto>) -> Self {
        Self {
            status: "ok".to_string(),
            message: None,
            envelopes,
        }
    }
    fn state(status: &str, message: String) -> Self {
        Self {
            status: status.to_string(),
            message: Some(message),
            envelopes: Vec::new(),
        }
    }
}

/// Local body-text scan (EM-9). Pure store read — no IMAP — so it runs inline like
/// the non-force-sync list path. Returns the matching envelopes (deduped by key by
/// construction: the sidecar is keyed 1:1 with the body cache).
#[tauri::command]
pub async fn email_search_bodies(
    state: State<'_, AppState>,
    input: EmailSearchLocalInput,
) -> Result<Vec<EmailEnvelopeDto>, String> {
    let needle = input.query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let account_filter = input.account_id.as_deref();
    let folder_filter = input.folder.as_deref();
    let rows = state
        .store
        .list_email_body_text()
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let Some(item) = parse_json_value::<StoredBodyText>(row) else {
            continue;
        };
        if account_filter.is_some_and(|acc| item.account_id != acc) {
            continue;
        }
        if folder_filter.is_some_and(|folder| item.folder != folder) {
            continue;
        }
        if !item.text.contains(&needle) {
            continue;
        }
        // Resolve the sidecar key (== envelope key) back to its envelope.
        if let Ok(Some(value)) = state.store.get_email_envelope(&item.key) {
            if let Some(env) = parse_json_value::<StoredEnvelope>(value) {
                out.push(super::envelope_to_dto(&state, env));
            }
        }
        if out.len() >= LOCAL_SEARCH_HIT_CAP {
            break;
        }
    }
    Ok(out)
}

/// Per-account server escalation (EM-9). Gmail → `X-GM-RAW` in All Mail; standard
/// IMAP → `SEARCH CHARSET UTF-8 TEXT` with an ASCII fallback. Never throws for a
/// search failure — it returns an honest `status` the UI renders.
#[tauri::command]
pub async fn email_search_server(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailSearchServerInput,
) -> Result<EmailServerSearchResult, String> {
    let query = input.query.trim().to_string();
    if query.is_empty() {
        return Ok(EmailServerSearchResult::ok(Vec::new()));
    }
    let Some(account) = read_accounts(&state)?
        .into_iter()
        .find(|a| a.id == input.account_id)
    else {
        return Err("account_not_found".to_string());
    };
    // OAuth refresh is an async pre-step (reqwest::blocking panics on the worker).
    let _ = super::oauth::ensure_fresh_access(&state, &account.id, &account.provider).await;
    let limit = input
        .limit
        .unwrap_or(SERVER_SEARCH_DEFAULT_LIMIT)
        .clamp(1, SERVER_SEARCH_MAX_LIMIT);

    let app_inner = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        run_server_search(&state_inner, &account, &query, limit)
    })
    .await
    .map_err(|e| format!("search_task_failed:{e}"))
}

/// Blocking core of the server search. Owns the honest-status logic; only a caller
/// bug bubbles up as `Err`.
fn run_server_search(
    state: &AppState,
    account: &super::StoredEmailAccount,
    query: &str,
    limit: usize,
) -> EmailServerSearchResult {
    let config = match ensure_account_config(state, account) {
        Ok(config) => config,
        Err(err) => return EmailServerSearchResult::state("error", err),
    };
    let mut session = match open_imap_session(&config) {
        Ok(session) => session,
        Err(err) => {
            let status = classify_search_error(&err);
            // A connect refusal isn't "unsupported search"; surface it as an error.
            let status = if status == "timeout" { "timeout" } else { "error" };
            return EmailServerSearchResult::state(status, err);
        }
    };
    let is_gmail = account.provider == "gmail";

    // The mailboxes to search. Gmail's All Mail covers the whole account via
    // X-GM-RAW; a standard IMAP server has no cross-folder SEARCH, so we iterate
    // every selectable folder and union the hits — the honest "entire mailbox".
    let mailboxes: Vec<String> = if is_gmail {
        match select_mailbox_for_folder(&mut session, account.provider.as_str(), "archive") {
            Ok((mailbox, _info)) => vec![mailbox],
            Err(err) => {
                let _ = session.logout();
                return EmailServerSearchResult::state("error", err);
            }
        }
    } else {
        match session.list(Some(""), Some("*")) {
            Ok(names) => names
                .iter()
                .filter(|name| {
                    !name
                        .attributes()
                        .iter()
                        .any(|attr| matches!(attr, imap::types::NameAttribute::NoSelect))
                })
                .map(|name| name.name().to_string())
                .collect(),
            Err(err) => {
                let _ = session.logout();
                let msg = err.to_string();
                return EmailServerSearchResult::state(classify_search_error(&msg), msg);
            }
        }
    };

    let mut envelopes: Vec<StoredEnvelope> = Vec::new();
    let mut any_ok = false;
    let mut last_err: Option<String> = None;

    for mailbox in mailboxes {
        // A folder that lists as selectable can still fail SELECT (raced rename /
        // ACL) — skip it, don't fail the whole search.
        let Ok(info) = session.select(mailbox.as_str()) else {
            continue;
        };
        match search_current_folder(&mut session, is_gmail, query) {
            Ok(uids) => {
                any_ok = true;
                if uids.is_empty() {
                    continue;
                }
                // Highest UIDs = most-recent within the folder; cap per folder.
                let mut uids: Vec<u32> = uids.into_iter().collect();
                uids.sort_unstable_by(|a, b| b.cmp(a));
                uids.truncate(limit);
                match fetch_envelopes_for_uids(
                    &mut session,
                    account,
                    &mailbox,
                    info.uid_validity,
                    &uids,
                ) {
                    Ok(rows) => envelopes.extend(rows),
                    Err(err) => last_err = Some(err),
                }
            }
            Err(err) => last_err = Some(err),
        }
    }

    let _ = session.logout();

    if !any_ok {
        // No folder could be searched — report the honest failure.
        return match last_err {
            Some(err) => EmailServerSearchResult::state(classify_search_error(&err), err),
            None => EmailServerSearchResult::ok(Vec::new()),
        };
    }

    // Union across folders, newest-first, capped. Upsert so a result's body fetches
    // normally; each envelope carries its own folder, so none leak into the inbox
    // list (which filters folder == "inbox").
    envelopes
        .sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms).then_with(|| b.uid.cmp(&a.uid)));
    envelopes.truncate(limit);
    let mut dtos = Vec::with_capacity(envelopes.len());
    for env in envelopes {
        let _ = upsert_envelope(state, &env);
        dtos.push(super::envelope_to_dto(state, env));
    }
    EmailServerSearchResult::ok(dtos)
}

/// Run the escalation search on the currently-selected mailbox: Gmail X-GM-RAW,
/// else UTF-8 `TEXT` with an ASCII fallback (a non-ASCII query a server rejects has
/// no honest downgrade, so its error propagates for classification).
fn search_current_folder(
    session: &mut ImapSession,
    is_gmail: bool,
    query: &str,
) -> Result<HashSet<u32>, String> {
    if is_gmail {
        return session.uid_search(gmail_raw_search(query)).map_err(|e| e.to_string());
    }
    match session.uid_search(imap_text_search_utf8(query)) {
        Ok(set) => Ok(set),
        Err(first) => match imap_text_search_ascii(query) {
            Some(ascii) => session.uid_search(ascii).map_err(|e| e.to_string()),
            None => Err(first.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_quotes_and_backslashes_and_strips_newlines() {
        assert_eq!(escape_imap_quoted(r#"a "b" \c"#), r#"a \"b\" \\c"#);
        assert_eq!(escape_imap_quoted("line1\r\nline2"), "line1line2");
    }

    #[test]
    fn gmail_raw_wraps_the_query() {
        assert_eq!(gmail_raw_search("from:ana is:unread"), "X-GM-RAW \"from:ana is:unread\"");
        // A quote in the raw query is escaped, not left to break the token.
        assert_eq!(gmail_raw_search(r#"subject:"q3 plan""#), r#"X-GM-RAW "subject:\"q3 plan\"""#);
    }

    #[test]
    fn utf8_search_declares_charset_ascii_omits_it() {
        assert_eq!(imap_text_search_utf8("hello"), "CHARSET UTF-8 TEXT \"hello\"");
        assert_eq!(imap_text_search_ascii("hello"), Some("TEXT \"hello\"".to_string()));
    }

    #[test]
    fn non_ascii_has_no_ascii_fallback() {
        // A café search can't downgrade to ASCII — the UI reports unsupported.
        assert_eq!(imap_text_search_ascii("café"), None);
        // …but the UTF-8 form still escapes correctly.
        assert_eq!(imap_text_search_utf8("café"), "CHARSET UTF-8 TEXT \"café\"");
    }

    #[test]
    fn classifies_timeout_vs_unsupported() {
        assert_eq!(classify_search_error("read timed out (os error 60)"), "timeout");
        assert_eq!(classify_search_error("connection reset by peer"), "timeout");
        assert_eq!(
            classify_search_error("a BAD Command Argument Error. 12 SEARCH"),
            "unsupported"
        );
    }

    #[test]
    fn body_text_lowercases_and_truncates_on_a_char_boundary() {
        assert_eq!(body_search_text("Hello WORLD"), "hello world");
        // A multi-byte char straddling the 8KB cap is dropped whole (no panic, valid UTF-8).
        let big = "é".repeat(BODY_TEXT_SIDECAR_MAX_BYTES); // 2 bytes each
        let out = body_search_text(&big);
        assert!(out.len() <= BODY_TEXT_SIDECAR_MAX_BYTES);
        assert!(out.chars().all(|c| c == 'é'));
    }
}
