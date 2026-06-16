use super::account_config::{ensure_account_config, select_mailbox_for_folder};
use super::connection::open_imap_session;
use super::model::{StoredBodyCache, StoredEmailAccount};
use super::parsing::{extract_best_body, normalize_body_text};
use super::storage::{body_key, persist_body_cache};
use crate::email_sync::now_iso;
use crate::AppState;

fn body_cache_from_fetch(
    account: &StoredEmailAccount,
    folder: &str,
    uid: u32,
    raw: &[u8],
) -> StoredBodyCache {
    let mut body = String::new();
    let mut body_html = None;
    let mut attachment_count = 0usize;

    if let Ok(parsed) = mailparse::parse_mail(raw) {
        let extracted = extract_best_body(&parsed);
        body = extracted.text;
        body_html = extracted.html;
        for part in parsed.parts() {
            if matches!(
                part.get_content_disposition().disposition,
                mailparse::DispositionType::Attachment
            ) {
                attachment_count = attachment_count.saturating_add(1);
            }
        }
    }
    if body.is_empty() {
        body = normalize_body_text(&String::from_utf8_lossy(raw));
    }

    let ts = now_iso();
    StoredBodyCache {
        key: body_key(&account.id, folder, uid),
        account_id: account.id.clone(),
        folder: folder.to_string(),
        uid,
        body,
        body_html,
        byte_size: raw.len(),
        attachment_count,
        fetched_at: ts.clone(),
        last_accessed_at: ts,
    }
}

pub(super) fn fetch_body_from_imap(
    state: &AppState,
    account: &StoredEmailAccount,
    folder: &str,
    uid: u32,
) -> Result<StoredBodyCache, String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let _ = select_mailbox_for_folder(&mut session, account.provider.as_str(), folder)?;

    let fetches = session
        .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
        .map_err(|e| format!("uid_fetch_body_failed:{}", e))?;
    let Some(first) = fetches.iter().next() else {
        let _ = session.logout();
        return Err("email_not_found".to_string());
    };
    let Some(raw) = first.body() else {
        let _ = session.logout();
        return Err("email_body_missing".to_string());
    };

    let cache = body_cache_from_fetch(account, folder, uid, raw);
    persist_body_cache(state, &cache)?;
    let _ = session.logout();
    Ok(cache)
}
