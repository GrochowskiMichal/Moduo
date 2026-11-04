//! The reader's `mail_*` commands on the real engine: "Show original",
//! attachment files (preview and Finder drag), invites and RSVP, unsubscribe,
//! sender avatars, visible-row prefetch, open-folder and backfill on demand,
//! follow-ups and the Screener hold. Ids from the webview are validated and
//! every message or attachment is resolved inside the thread it names.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::mail::avatar::{self, AvatarSource, CACHE_DAYS};
use crate::mail::bodies::fetch::{fetch_attachment, show_original, ImapSource};
use crate::mail::host::ondemand::WorkerCmd;
use crate::mail::host::reader::{invite_view, InviteView, MessageRef};
use crate::mail::host::MailHost;
use crate::mail::invite::{parse_invite, Rsvp};
use crate::mail::safe_http;
use crate::mail::send::DraftDoc;
use crate::mail::store::{now_ms, Store};
use crate::mail::sync::events::MailEvent;
use crate::mail::unsubscribe::{self, UnsubscribeMethod};

const MAX_ID_LEN: usize = 512;
const MAX_IDS: usize = 500;
/// Images and PDFs up to this size come back inline for the preview.
const PREVIEW_INLINE_MAX: u64 = 8 * 1024 * 1024;
const ICS_MAX: u64 = 1024 * 1024;

fn s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_ID_LEN || id.chars().any(char::is_control) {
        return Err("invalid_id".into());
    }
    Ok(())
}

pub fn check_ids(ids: &[String]) -> Result<(), String> {
    if ids.is_empty() || ids.len() > MAX_IDS {
        return Err("invalid_thread_ids".into());
    }
    ids.iter().try_for_each(|i| check_id(i))
}

fn message(store: &Store, thread_id: &str, message_id: &str) -> Result<MessageRef, String> {
    check_id(thread_id)?;
    check_id(message_id)?;
    store
        .message_ref(thread_id, message_id)
        .map_err(s)?
        .ok_or_else(|| "message_not_found".into())
}

/// The attachment's file, fetched over a pooled session when not cached.
async fn attachment_file(
    host: &MailHost,
    store: &Store,
    account_id: &str,
    attachment_id: i64,
) -> Result<std::path::PathBuf, String> {
    if let Some(p) = store.attachment_path(attachment_id).map_err(s)? {
        if p.exists() {
            return Ok(p);
        }
    }
    let slot = host.ondemand.slot(account_id)?;
    let mut lease = slot.actor.checkout().await.map_err(|e| format!("offline:{e:?}"))?;
    let srv = lease.session.as_mut().ok_or("offline")?;
    let p = fetch_attachment(store, &mut ImapSource::new(&mut srv.session), attachment_id)
        .await
        .map_err(s)?;
    slot.actor.checkin(lease);
    Ok(p)
}

#[tauri::command]
pub async fn mail_get_raw_message(
    thread_id: String,
    message_id: String,
    host: State<'_, MailHost>,
) -> Result<String, String> {
    let store = host.store()?;
    let m = message(&store, &thread_id, &message_id)?;
    let slot = host.ondemand.slot(&m.account_id)?;
    let mut lease = slot.actor.checkout().await.map_err(|e| format!("offline:{e:?}"))?;
    let srv = lease.session.as_mut().ok_or("offline")?;
    let raw = show_original(&store, &mut ImapSource::new(&mut srv.session), m.row_id)
        .await
        .map_err(s)?;
    slot.actor.checkin(lease);
    Ok(raw)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentFile {
    pub path: String,
    /// `file://` URL for Finder's `DownloadURL` drag.
    pub file_url: String,
    /// `data:` URL for an in-app preview (images and PDFs within the cap).
    pub data_url: Option<String>,
}

pub fn previewable(mime: &str) -> bool {
    let m = mime.to_ascii_lowercase();
    (m.starts_with("image/") && !m.starts_with("image/svg")) || m == "application/pdf"
}

#[tauri::command]
pub async fn mail_attachment_file(
    thread_id: String,
    attachment_id: String,
    host: State<'_, MailHost>,
) -> Result<AttachmentFile, String> {
    check_id(&thread_id)?;
    let id: i64 = attachment_id.parse().map_err(|_| "invalid_id")?;
    let store = host.store()?;
    let (account, mime, _) = store
        .thread_attachment(&thread_id, id)
        .map_err(s)?
        .ok_or("attachment_not_found")?;
    let path = attachment_file(&host, &store, &account, id).await?;
    let file_url = url::Url::from_file_path(&path)
        .map_err(|_| "bad_path")?
        .to_string();
    let len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(u64::MAX);
    let data_url = if previewable(&mime) && len <= PREVIEW_INLINE_MAX {
        let bytes = std::fs::read(&path).map_err(s)?;
        let safe_mime: String = mime
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || "/+.-".contains(*c))
            .collect();
        Some(format!(
            "data:{safe_mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    } else {
        None
    };
    Ok(AttachmentFile {
        path: path.to_string_lossy().into_owned(),
        file_url,
        data_url,
    })
}

async fn invite_of(
    host: &MailHost,
    store: &Store,
    m: &MessageRef,
) -> Result<Option<crate::mail::invite::Invite>, String> {
    let Some(att) = store.invite_attachment(m.row_id).map_err(s)? else {
        return Ok(None);
    };
    let path = attachment_file(host, store, &m.account_id, att).await?;
    if std::fs::metadata(&path).map(|x| x.len()).unwrap_or(u64::MAX) > ICS_MAX {
        return Ok(None);
    }
    let ics = String::from_utf8_lossy(&std::fs::read(&path).map_err(s)?).into_owned();
    Ok(parse_invite(&ics))
}

fn own_addresses(store: &Store) -> Vec<String> {
    crate::mail::host::list_accounts(store)
        .map(|v| v.into_iter().map(|a| a.address).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn mail_get_invite(
    thread_id: String,
    message_id: String,
    host: State<'_, MailHost>,
) -> Result<Option<InviteView>, String> {
    let store = host.store()?;
    let m = message(&store, &thread_id, &message_id)?;
    let Some(inv) = invite_of(&host, &store, &m).await? else {
        return Ok(None);
    };
    Ok(invite_view(&inv, &own_addresses(&store)))
}

#[tauri::command]
pub async fn mail_rsvp(
    thread_id: String,
    message_id: String,
    answer: Rsvp,
    host: State<'_, MailHost>,
) -> Result<Value, String> {
    let store = host.store()?;
    let m = message(&store, &thread_id, &message_id)?;
    let inv = invite_of(&host, &store, &m)
        .await?
        .ok_or("invite_not_found")?;
    let h = store
        .queue_rsvp_at(
            &m.account_id,
            Some(&thread_id),
            &inv,
            answer,
            None,
            m.message_id.as_deref(),
            now_ms(),
        )
        .map_err(s)?;
    Ok(json!({ "outboxId": h.outbox_id, "sendAtMs": h.send_at_ms }))
}

#[tauri::command]
pub fn mail_unsubscribe_plan(
    thread_id: String,
    message_id: String,
    host: State<'_, MailHost>,
) -> Result<Vec<UnsubscribeMethod>, String> {
    let store = host.store()?;
    let m = message(&store, &thread_id, &message_id)?;
    vetted_plan(&store, &m)
}

/// The header's plan with any mailto that isn't to the sender's (or list's)
/// own domain removed, and a mailto's subject and body fixed to
/// "unsubscribe". The confirm shows this exact recipient.
fn vetted_plan(store: &Store, m: &MessageRef) -> Result<Vec<UnsubscribeMethod>, String> {
    let sender: String = store
        .r()
        .query_row(
            "SELECT from_email FROM messages WHERE id = ?1",
            [m.row_id],
            |r| r.get(0),
        )
        .map_err(s)?;
    Ok(vet_plan(
        unsubscribe::plan(
            m.list_unsubscribe.as_deref(),
            m.list_unsubscribe_post.as_deref(),
        ),
        &sender,
        None,
    ))
}

/// `list_id` is the message's List-Id when known (the store keeps none yet).
fn vet_plan(
    plan: Vec<UnsubscribeMethod>,
    sender: &str,
    list_id: Option<&str>,
) -> Vec<UnsubscribeMethod> {
    plan.into_iter()
        .filter_map(|m| match m {
            UnsubscribeMethod::Mailto { to, .. } => {
                unsubscribe::mailto_allowed(&to, sender, list_id).then(|| {
                    UnsubscribeMethod::Mailto {
                        to,
                        subject: Some(unsubscribe::MAILTO_TEXT.into()),
                        body: Some(unsubscribe::MAILTO_TEXT.into()),
                    }
                })
            }
            other => Some(other),
        })
        .collect()
}

/// Reader settings the webview mirrors into kv; the engine reads them here
/// instead of trusting a per-call flag.
pub const READER_PREFS_KEY: &str = "reader_prefs_v1";

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReaderPrefs {
    /// Fetch sender logos from the sender's domain. Off until mirrored.
    pub sender_logos: bool,
    pub undo_send_seconds: i64,
}

impl Default for ReaderPrefs {
    fn default() -> Self {
        Self {
            sender_logos: false,
            undo_send_seconds: 10,
        }
    }
}

impl ReaderPrefs {
    fn sanitized(mut self) -> Self {
        self.undo_send_seconds = self.undo_send_seconds.clamp(5, 30);
        self
    }

    pub fn load(store: &Store) -> Self {
        // The prefs are always written whole (never read-modify-write), so a
        // corrupt value falls back to the privacy-safe defaults (logos off)
        // without risking a partial overwrite; the failure is logged.
        let Some(j) = store.kv_get(READER_PREFS_KEY).ok().flatten() else {
            return Self::default();
        };
        match serde_json::from_str::<ReaderPrefs>(&j) {
            Ok(p) => p.sanitized(),
            Err(e) => {
                eprintln!("mail reader prefs unreadable, using defaults: {e}");
                Self::default()
            }
        }
    }
}

#[tauri::command]
pub fn mail_set_reader_prefs(prefs: ReaderPrefs, host: State<'_, MailHost>) -> Result<(), String> {
    let store = host.store()?;
    let j = serde_json::to_string(&prefs.sanitized()).map_err(s)?;
    store.kv_set(READER_PREFS_KEY, &j).map_err(s)
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnsubscribeOutcome {
    /// `one_click` / `mailto` were done here; `web` is for the app to open.
    pub method: &'static str,
    pub done: bool,
    pub url: Option<String>,
    /// A preferred method failed or was not allowed; the reader names the fallback.
    pub fell_back: bool,
    pub error: Option<String>,
}

/// Unsubscribe in the RFC 8058 order: one-click POST, then the mailto (only
/// with `allow_mailto`, after the reader's confirm), then the web page.
#[tauri::command]
pub async fn mail_unsubscribe(
    thread_id: String,
    message_id: String,
    allow_mailto: bool,
    host: State<'_, MailHost>,
) -> Result<UnsubscribeOutcome, String> {
    let store = host.store()?;
    let m = message(&store, &thread_id, &message_id)?;
    let plan = vetted_plan(&store, &m)?;
    let mut error = None;
    let mut fell_back = false;
    for method in plan {
        match method {
            UnsubscribeMethod::OneClick { url } => {
                let client = safe_http::client()?;
                match unsubscribe::post_one_click(&client, &url).await {
                    Ok(()) => {
                        return Ok(UnsubscribeOutcome {
                            method: "one_click",
                            done: true,
                            url: None,
                            fell_back,
                            error,
                        })
                    }
                    Err(e) => {
                        error = Some(e);
                        fell_back = true;
                    }
                }
            }
            UnsubscribeMethod::Mailto { to, .. } => {
                if !allow_mailto {
                    fell_back = true;
                    continue;
                }
                let me: String = store
                    .r()
                    .query_row("SELECT address FROM accounts WHERE id = ?1", [&m.account_id], |r| {
                        r.get(0)
                    })
                    .map_err(s)?;
                let doc = DraftDoc {
                    from_addr: me,
                    to: vec![to],
                    subject: unsubscribe::MAILTO_TEXT.into(),
                    text: unsubscribe::MAILTO_TEXT.into(),
                    ..DraftDoc::default()
                };
                let now = now_ms();
                let id = store
                    .save_draft_at(None, &m.account_id, None, doc, now)
                    .map_err(s)?;
                // The normal undo window, so a mistaken send can be taken back.
                let undo_s = ReaderPrefs::load(&store).undo_send_seconds;
                store.queue_send_at(&id, undo_s, now).map_err(s)?;
                return Ok(UnsubscribeOutcome {
                    method: "mailto",
                    done: true,
                    url: None,
                    fell_back,
                    error,
                });
            }
            UnsubscribeMethod::Web { url } => {
                return Ok(UnsubscribeOutcome {
                    method: "web",
                    done: false,
                    url: Some(url),
                    fell_back,
                    error,
                })
            }
        }
    }
    Err(error.unwrap_or_else(|| "no_unsubscribe".into()))
}

/// `{kind: "contact", url}` · `{kind: "logo", dataUrl}` · `{kind: "initials", initials}`.
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AvatarOut {
    Contact { url: String },
    Logo { data_url: String },
    Initials { initials: String },
}

fn logo_data_url(kind: &str, data: &[u8]) -> String {
    format!(
        "data:{kind};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(data)
    )
}

/// The sender's own-domain logo, cached 30 days (misses too). BIMI needs a
/// DNS TXT lookup the app has no resolver for, so only the two icon URLs run.
async fn domain_logo(store: &Store, domain: &str, urls: &[String]) -> Option<String> {
    let now = now_ms();
    if let Ok(Some(hit)) = store.avatar_cached(domain, now, CACHE_DAYS * 86_400_000) {
        return hit.map(|(k, d)| logo_data_url(&k, &d));
    }
    let client = safe_http::client().ok()?;
    for u in urls {
        if safe_http::check_url(u).is_err() {
            continue;
        }
        let Ok(res) = client.get(u).send().await else { continue };
        if !res.status().is_success() {
            continue;
        }
        let ct = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if res.content_length().is_some_and(|n| n as usize > avatar::MAX_LOGO_BYTES) {
            continue;
        }
        let Ok(bytes) = res.bytes().await else { continue };
        if avatar::accept_logo(&ct, bytes.len()) {
            let _ = store.avatar_put(domain, &ct, Some(&bytes), now);
            return Some(logo_data_url(&ct, &bytes));
        }
    }
    let _ = store.avatar_put(domain, "none", None, now);
    None
}

#[tauri::command]
pub async fn mail_avatar(
    email: String,
    name: Option<String>,
    contact_photo: Option<String>,
    host: State<'_, MailHost>,
) -> Result<AvatarOut, String> {
    if email.len() > 320 || name.as_ref().is_some_and(|n| n.len() > 512) {
        return Err("invalid_input".into());
    }
    let photo = contact_photo.filter(|u| u.starts_with("https://") && u.len() <= 2048);
    let store = host.store()?;
    // The setting comes from the mirrored prefs, never from the caller.
    let fetch_enabled = ReaderPrefs::load(&store).sender_logos;
    for src in avatar::resolve(&email, name.as_deref(), photo.as_deref(), fetch_enabled) {
        match src {
            AvatarSource::Contact { url } => return Ok(AvatarOut::Contact { url }),
            AvatarSource::Domain { domain, urls, .. } => {
                if let Some(data_url) = domain_logo(&store, &domain, &urls).await {
                    return Ok(AvatarOut::Logo { data_url });
                }
            }
            AvatarSource::Initials { initials } => return Ok(AvatarOut::Initials { initials }),
        }
    }
    Ok(AvatarOut::Initials {
        initials: avatar::initials(name.as_deref(), &email),
    })
}

/// Rows on screen: their messages rise to Visible in the prefetch queue.
#[tauri::command]
pub fn mail_set_visible(thread_ids: Vec<String>, host: State<'_, MailHost>) -> Result<(), String> {
    if thread_ids.is_empty() {
        return Ok(());
    }
    check_ids(&thread_ids)?;
    let store = host.store()?;
    let mut by_account: std::collections::HashMap<String, Vec<i64>> = Default::default();
    for t in &thread_ids {
        let Some(acc) = store.thread_account(t).map_err(s)? else { continue };
        let ids = store.thread_missing_bodies(t).map_err(s)?;
        by_account.entry(acc).or_default().extend(ids);
    }
    for (acc, ids) in by_account {
        let _ = host.ondemand.visible(&acc, &ids);
    }
    Ok(())
}

#[tauri::command]
pub fn mail_open_folder(mailbox_id: String, host: State<'_, MailHost>) -> Result<(), String> {
    check_id(&mailbox_id)?;
    let acc = host
        .store()?
        .mailbox_account(&mailbox_id)
        .map_err(s)?
        .ok_or("mailbox_not_found")?;
    host.ondemand.queue(&acc, WorkerCmd::OpenFolder(mailbox_id))
}

#[tauri::command]
pub fn mail_backfill(account_id: String, host: State<'_, MailHost>) -> Result<(), String> {
    check_id(&account_id)?;
    host.ondemand.queue(&account_id, WorkerCmd::Backfill)
}

#[tauri::command]
pub fn mail_cancel_backfill(account_id: String, host: State<'_, MailHost>) -> Result<(), String> {
    check_id(&account_id)?;
    host.ondemand.slot(&account_id)?.sync.cancel_backfill();
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUpIn {
    pub thread_id: String,
    /// None clears (Dismiss, or the reminder removed in compose).
    pub due_ms: Option<i64>,
}

#[tauri::command]
pub fn mail_set_follow_up(input: FollowUpIn, host: State<'_, MailHost>) -> Result<(), String> {
    check_id(&input.thread_id)?;
    if input.due_ms.is_some_and(|d| d <= 0) {
        return Err("invalid_due".into());
    }
    host.store()?
        .set_follow_up(&input.thread_id, input.due_ms, now_ms())
        .map_err(s)?;
    host.events.emit(MailEvent::ThreadsChanged {
        view_keys: vec!["followups".into()],
        thread_ids: vec![input.thread_id],
    });
    Ok(())
}

/// Allow or Block decided: the threads leave New senders.
#[tauri::command]
pub fn mail_release_new_senders(thread_ids: Vec<String>, host: State<'_, MailHost>) -> Result<(), String> {
    check_ids(&thread_ids)?;
    host.store()?.set_screened(&thread_ids, false).map_err(s)?;
    host.events.emit(MailEvent::ThreadsChanged {
        view_keys: vec!["new_senders".into()],
        thread_ids,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_validated() {
        assert!(check_id("").is_err());
        assert!(check_id("a\nb").is_err());
        assert!(check_id(&"x".repeat(600)).is_err());
        assert!(check_id("t-1").is_ok());
        assert!(check_ids(&[]).is_err());
        assert!(check_ids(&vec!["a".to_string(); 501]).is_err());
    }

    #[test]
    fn mailto_is_vetted_and_fixed_text() {
        let plan = vec![
            UnsubscribeMethod::OneClick {
                url: "https://shop.com/u".into(),
            },
            UnsubscribeMethod::Mailto {
                to: "unsub@shop.com".into(),
                subject: Some("Buy now".into()),
                body: Some("anything".into()),
            },
        ];
        let v = vet_plan(plan.clone(), "news@shop.com", None);
        assert_eq!(
            v[1],
            UnsubscribeMethod::Mailto {
                to: "unsub@shop.com".into(),
                subject: Some("unsubscribe".into()),
                body: Some("unsubscribe".into()),
            }
        );
        let v = vet_plan(plan, "news@other.com", None);
        assert_eq!(v.len(), 1, "a mailto to a foreign domain is dropped");
    }

    #[test]
    fn reader_prefs_default_off_and_round_trip() {
        let d = std::env::temp_dir().join(format!(
            "moduo-reader-prefs-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let store = Store::open(&d).unwrap();
        let p = ReaderPrefs::load(&store);
        assert!(
            !p.sender_logos,
            "no logo fetching until the setting is mirrored"
        );
        assert_eq!(p.undo_send_seconds, 10);
        store
            .kv_set(
                READER_PREFS_KEY,
                r#"{"senderLogos":true,"undoSendSeconds":0}"#,
            )
            .unwrap();
        let p = ReaderPrefs::load(&store);
        assert!(p.sender_logos);
        assert_eq!(p.undo_send_seconds, 5, "0 never disables the undo window");
        store.kv_set(READER_PREFS_KEY, "garbage").unwrap();
        assert!(!ReaderPrefs::load(&store).sender_logos);
    }

    #[test]
    fn previews_only_safe_types() {
        assert!(previewable("image/png"));
        assert!(previewable("application/PDF"));
        assert!(!previewable("image/svg+xml"), "svg can carry script");
        assert!(!previewable("text/html"));
    }

    #[test]
    fn outputs_match_the_ts_shapes() {
        assert_eq!(
            serde_json::to_value(AvatarOut::Logo { data_url: "d".into() }).unwrap(),
            json!({"kind": "logo", "dataUrl": "d"})
        );
        let o = UnsubscribeOutcome {
            method: "web",
            done: false,
            url: Some("u".into()),
            fell_back: true,
            error: None,
        };
        assert_eq!(
            serde_json::to_value(o).unwrap(),
            json!({"method": "web", "done": false, "url": "u", "fellBack": true, "error": null})
        );
        let f: FollowUpIn = serde_json::from_value(json!({"threadId": "t", "dueMs": null})).unwrap();
        assert!(f.due_ms.is_none());
        assert_eq!(serde_json::from_value::<Rsvp>(json!("maybe")).unwrap(), Rsvp::Maybe);
    }
}
