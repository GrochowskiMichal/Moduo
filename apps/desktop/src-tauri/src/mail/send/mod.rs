//! Send, drafts and the Microsoft send fallback (MR-6; specs/mail-rebuild.md
//! decisions 13–14 and 20, AC18 RSVP, AC21, AC22, AC37 send).
//!
//! - **Drafts** are local rows saved on every change. Two seconds after the last
//!   change ([`DRAFT_DEBOUNCE_MS`]) [`Store::sync_drafts`] APPENDs the draft to
//!   the server's Drafts folder (`\Draft \Seen`) and deletes the previous server
//!   copy, whose UID came back from UIDPLUS `APPENDUID`. One stable Message-ID
//!   per draft ties the copies together.
//! - **Send** builds the MIME once and queues it in `outbox` with
//!   `not_before = now + undo`. Undo inside the window deletes the row and the
//!   draft is untouched, so Edit reopens it. [`Store::run_due_sends`] drains the
//!   queue: transient failures (offline) back off and retry for 24 h and
//!   [`Store::wake_sends`] drains them at once on reconnect; a permanent failure
//!   (or 24 h) returns the message to Drafts with the reason.
//! - **Sent copy**: APPENDed `\Seen` except on Gmail and Microsoft, which file
//!   it themselves.
//! - **Microsoft**: SMTP `535 5.7.139` (SMTP AUTH off for the tenant) re-sends
//!   the same MIME through Graph `POST /me/sendMail`, and the account then
//!   sends through Graph from then on ([`graph`]).
//!
//! The server side is the [`SendTransport`] trait (the account actor runs the
//! real one on a blocking thread; tests use a fake), like the ops outbox.

pub mod graph;
pub mod mime;
pub mod smtp;

#[cfg(test)]
mod tests;

use super::auth::microsoft;
use super::contracts::{MailboxRole, Provider};
use super::invite::{itip_reply, Invite, Rsvp};
use super::ops::backoff_ms;
use super::store::{now_ms, Store, StoreError, StoreResult};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Drafts upload this long after typing stops (AC21: ≤ 3 s).
pub const DRAFT_DEBOUNCE_MS: i64 = 2_000;
/// The undo-send setting's choices; anything else snaps to the default.
pub const UNDO_CHOICES_S: &[i64] = &[5, 10, 20, 30];
pub const UNDO_DEFAULT_S: i64 = 10;
/// Transient send failures retry this long before the message returns to Drafts.
pub const SEND_GIVE_UP_MS: i64 = 24 * 3_600_000;

const MB: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutAttachment {
    pub filename: String,
    pub content_type: String,
    /// The file compose saved (drag, paste or forward); read when the MIME is built.
    pub path: String,
}

/// A draft's content, as compose edits it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DraftDoc {
    /// Generated on first save when empty; stable for the draft's life.
    pub message_id: String,
    pub from_name: Option<String>,
    pub from_addr: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub text: String,
    pub html: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub attachments: Vec<OutAttachment>,
    /// An iTIP REPLY (`text/calendar; method=REPLY`) for an RSVP.
    pub calendar_reply: Option<String>,
    /// Why the last send failed (set when a failure returns it to Drafts).
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRow {
    pub id: String,
    pub account_id: String,
    pub thread_id: Option<String>,
    pub doc: DraftDoc,
    pub updated_at_ms: i64,
    pub server_uid: Option<i64>,
    /// An outbox row holds it (in the undo window, waiting offline or sending).
    pub queued: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendHandle {
    pub outbox_id: String,
    pub draft_id: String,
    pub send_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItem {
    pub id: String,
    pub account_id: String,
    pub draft_id: Option<String>,
    pub subject: String,
    pub to: Vec<String>,
    pub state: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub not_before_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendError {
    /// Offline, timeout, 4xx: retried with backoff.
    Transient(String),
    /// Refused for good (5xx, bad recipient, too large).
    Permanent(String),
}

impl SendError {
    pub fn message(&self) -> &str {
        match self {
            SendError::Transient(s) | SendError::Permanent(s) => s,
        }
    }
}

/// The server half, implemented by the account actor (and a fake in tests).
pub trait SendTransport {
    fn smtp_send(
        &mut self,
        account_id: &str,
        from: &str,
        rcpts: &[String],
        mime: &[u8],
    ) -> Result<(), SendError>;
    /// Graph `POST /me/sendMail` with the MIME (Microsoft, SMTP AUTH off).
    fn graph_send(&mut self, account_id: &str, mime: &[u8]) -> Result<(), SendError>;
    /// IMAP APPEND; returns the UIDPLUS `APPENDUID` when the server gives one.
    fn append(
        &mut self,
        account_id: &str,
        mailbox_path: &str,
        flags: &[&str],
        mime: &[u8],
    ) -> Result<Option<i64>, SendError>;
    /// `UID STORE +FLAGS \Deleted` plus `UID EXPUNGE` of one message.
    fn delete_uid(&mut self, account_id: &str, mailbox_path: &str, uid: i64)
        -> Result<(), SendError>;
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SendReport {
    /// (outbox id, draft id).
    pub sent: Vec<(String, Option<String>)>,
    /// (draft id, reason): back in Drafts, to notify.
    pub failed: Vec<(Option<String>, String)>,
    pub retrying: Vec<String>,
    /// Sent via Graph because SMTP AUTH is off.
    pub via_graph: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DraftSyncReport {
    pub uploaded: Vec<String>,
    pub deleted_server_copies: usize,
    pub errors: Vec<(String, String)>,
}

/// Provider message-size limits for the whole encoded message (E45). Graph's
/// sendMail takes at most 4 MB of base64 request body, so ≈ 3 MB of MIME.
pub fn size_limit(provider: Provider, via_graph: bool) -> usize {
    if via_graph {
        return 3 * MB;
    }
    match provider {
        Provider::Gmail | Provider::GoogleWorkspace => 25 * MB,
        Provider::Icloud => 20 * MB,
        Provider::Outlook => 25 * MB,
        Provider::Imap => 25 * MB,
    }
}

/// Gmail and Microsoft file the sent message themselves (decision 13).
pub fn server_saves_sent(provider: Provider) -> bool {
    matches!(
        provider,
        Provider::Gmail | Provider::GoogleWorkspace | Provider::Outlook
    )
}

pub fn undo_window_ms(seconds: i64) -> i64 {
    let s = if UNDO_CHOICES_S.contains(&seconds) {
        seconds
    } else {
        UNDO_DEFAULT_S
    };
    s * 1000
}

fn err(s: impl Into<String>) -> StoreError {
    StoreError::Invalid(s.into())
}

fn graph_key(account: &str) -> String {
    format!("mail_send_graph:{account}")
}
fn rev_key(draft: &str) -> String {
    format!("mail_draft_uploaded:{draft}")
}
const DEL_PREFIX: &str = "mail_draft_server_delete:";

#[derive(Serialize, Deserialize)]
struct ServerDelete {
    account_id: String,
    mailbox_path: String,
    uid: i64,
}

impl Store {
    fn provider_of(&self, account_id: &str) -> StoreResult<Provider> {
        let p: Option<String> = self
            .w()
            .query_row(
                "SELECT provider FROM accounts WHERE id = ?1",
                [account_id],
                |r| r.get(0),
            )
            .optional()?;
        let p = p.ok_or_else(|| err(format!("unknown account {account_id}")))?;
        Ok(Provider::parse(&p).unwrap_or(Provider::Imap))
    }

    fn role_path(&self, account_id: &str, role: MailboxRole) -> StoreResult<Option<(String, String)>> {
        Ok(self
            .w()
            .query_row(
                "SELECT id, path FROM mailboxes WHERE account_id = ?1 AND role = ?2 ORDER BY id LIMIT 1",
                params![account_id, role.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }

    fn sends_via_graph(&self, account_id: &str) -> StoreResult<bool> {
        Ok(self.kv_get(&graph_key(account_id))?.as_deref() == Some("1"))
    }

    /// Saves a draft (creating it when `id` is None). Every keystroke may call this.
    pub fn save_draft_at(
        &self,
        id: Option<&str>,
        account_id: &str,
        thread_id: Option<&str>,
        mut doc: DraftDoc,
        now: i64,
    ) -> StoreResult<String> {
        self.provider_of(account_id)?;
        let id = id
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if doc.message_id.trim().is_empty() {
            let prev: Option<String> = self
                .w()
                .query_row("SELECT json FROM drafts WHERE id = ?1", [&id], |r| r.get(0))
                .optional()?;
            doc.message_id = prev
                .and_then(|j| serde_json::from_str::<DraftDoc>(&j).ok())
                .map(|d| d.message_id)
                .filter(|m| !m.is_empty())
                .unwrap_or_else(|| mime::generate_message_id(&doc.from_addr));
        }
        let json = serde_json::to_string(&doc).map_err(|e| err(e.to_string()))?;
        self.w().execute(
            "INSERT INTO drafts (id, account_id, thread_id, json, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET json = excluded.json, thread_id = excluded.thread_id,
               updated_at_ms = MAX(drafts.updated_at_ms + 1, excluded.updated_at_ms)",
            params![id, account_id, thread_id, json, now],
        )?;
        Ok(id)
    }

    pub fn save_draft(
        &self,
        id: Option<&str>,
        account_id: &str,
        thread_id: Option<&str>,
        doc: DraftDoc,
    ) -> StoreResult<String> {
        self.save_draft_at(id, account_id, thread_id, doc, now_ms())
    }

    fn drafts_where(&self, clause: &str, arg: &str) -> StoreResult<Vec<DraftRow>> {
        let c = self.w();
        let mut s = c.prepare(&format!(
            "SELECT d.id, d.account_id, d.thread_id, d.json, d.updated_at_ms, d.server_uid,
                    EXISTS (SELECT 1 FROM outbox o WHERE o.draft_id = d.id)
             FROM drafts d WHERE {clause} ORDER BY d.updated_at_ms DESC"
        ))?;
        let rows = s
            .query_map([arg], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, bool>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(id, account_id, thread_id, json, updated_at_ms, server_uid, queued)| {
                let doc = serde_json::from_str(&json)
                    .map_err(|e| err(format!("corrupt draft {id}: {e}")))?;
                Ok(DraftRow {
                    id,
                    account_id,
                    thread_id,
                    doc,
                    updated_at_ms,
                    server_uid,
                    queued,
                })
            })
            .collect()
    }

    pub fn draft(&self, id: &str) -> StoreResult<Option<DraftRow>> {
        Ok(self.drafts_where("d.id = ?1", id)?.into_iter().next())
    }

    /// Every local draft, newest first (`account_id` "" for all accounts).
    pub fn drafts(&self, account_id: &str) -> StoreResult<Vec<DraftRow>> {
        self.drafts_where("(?1 = '' OR d.account_id = ?1)", account_id)
    }

    /// Deletes the local draft; its server copy is deleted on the next sync.
    pub fn discard_draft(&self, id: &str) -> StoreResult<bool> {
        let Some(row) = self.draft(id)? else {
            return Ok(false);
        };
        if row.queued {
            return Err(err("draft_is_sending"));
        }
        self.drop_draft(&row)?;
        Ok(true)
    }

    fn drop_draft(&self, row: &DraftRow) -> StoreResult<()> {
        if let (Some(uid), Some((_, path))) =
            (row.server_uid, self.role_path(&row.account_id, MailboxRole::Drafts)?)
        {
            let v = serde_json::to_string(&ServerDelete {
                account_id: row.account_id.clone(),
                mailbox_path: path,
                uid,
            })
            .map_err(|e| err(e.to_string()))?;
            self.kv_set(&format!("{DEL_PREFIX}{}:{uid}", row.id), &v)?;
        }
        let c = self.w();
        c.execute("DELETE FROM drafts WHERE id = ?1", [&row.id])?;
        c.execute("DELETE FROM kv WHERE key = ?1", [rev_key(&row.id)])?;
        Ok(())
    }

    /// Uploads drafts idle for [`DRAFT_DEBOUNCE_MS`] and deletes superseded
    /// server copies. Queued drafts are left alone (the send owns them).
    pub fn sync_drafts<T: SendTransport>(&self, t: &mut T, now: i64) -> StoreResult<DraftSyncReport> {
        let mut rep = DraftSyncReport::default();
        // 1. Pending server deletes (discarded or sent drafts, replaced copies).
        let dels: Vec<(String, String)> = {
            let c = self.w();
            let mut s = c.prepare("SELECT key, value FROM kv WHERE key LIKE ?1 || '%'")?;
            let v = s
                .query_map([DEL_PREFIX], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<_, _>>()?;
            v
        };
        for (key, v) in dels {
            let Ok(d) = serde_json::from_str::<ServerDelete>(&v) else {
                self.w().execute("DELETE FROM kv WHERE key = ?1", [&key])?;
                continue;
            };
            match t.delete_uid(&d.account_id, &d.mailbox_path, d.uid) {
                Ok(()) | Err(SendError::Permanent(_)) => {
                    self.w().execute("DELETE FROM kv WHERE key = ?1", [&key])?;
                    rep.deleted_server_copies += 1;
                }
                Err(SendError::Transient(e)) => rep.errors.push((key, e)),
            }
        }
        // 2. Uploads.
        for row in self.drafts("")? {
            if row.queued || row.updated_at_ms > now - DRAFT_DEBOUNCE_MS {
                continue;
            }
            let rev = row.updated_at_ms.to_string();
            if self.kv_get(&rev_key(&row.id))?.as_deref() == Some(rev.as_str()) {
                continue;
            }
            let Some((mailbox_id, path)) = self.role_path(&row.account_id, MailboxRole::Drafts)? else {
                continue; // No Drafts folder: local only.
            };
            let bytes = match mime::build(&row.doc, false) {
                Ok(b) => b,
                Err(e) => {
                    rep.errors.push((row.id.clone(), e));
                    continue;
                }
            };
            match t.append(&row.account_id, &path, &["\\Draft", "\\Seen"], &bytes) {
                Ok(new_uid) => {
                    if let Some(old) = row.server_uid {
                        if t.delete_uid(&row.account_id, &path, old).is_err() {
                            let v = serde_json::to_string(&ServerDelete {
                                account_id: row.account_id.clone(),
                                mailbox_path: path.clone(),
                                uid: old,
                            })
                            .map_err(|e| err(e.to_string()))?;
                            self.kv_set(&format!("{DEL_PREFIX}{}:{old}", row.id), &v)?;
                        }
                    }
                    let changed = {
                        let c = self.w();
                        c.execute(
                            "UPDATE drafts SET server_uid = ?2, server_mailbox_id = ?3 WHERE id = ?1",
                            params![row.id, new_uid, mailbox_id],
                        )?
                    };
                    if changed == 0 {
                        // Discarded or sent while uploading: drop this copy too.
                        if let Some(u) = new_uid {
                            let _ = t.delete_uid(&row.account_id, &path, u);
                        }
                        continue;
                    }
                    self.kv_set(&rev_key(&row.id), &rev)?;
                    rep.uploaded.push(row.id.clone());
                }
                Err(e) => rep.errors.push((row.id.clone(), e.message().to_string())),
            }
        }
        Ok(rep)
    }

    /// Queues the draft for sending after the undo window (`undo_s` seconds).
    /// Errors: `missing_recipients`, `too_large:<limit bytes>`, bad addresses.
    pub fn queue_send_at(&self, draft_id: &str, undo_s: i64, now: i64) -> StoreResult<SendHandle> {
        let row = self
            .draft(draft_id)?
            .ok_or_else(|| err(format!("unknown draft {draft_id}")))?;
        if row.queued {
            return Err(err("draft_is_sending"));
        }
        let provider = self.provider_of(&row.account_id)?;
        mime::envelope_recipients(&row.doc).map_err(err)?;
        let bytes = mime::build(&row.doc, true).map_err(err)?;
        let limit = size_limit(provider, self.sends_via_graph(&row.account_id)?);
        if bytes.len() > limit {
            return Err(err(format!("too_large:{limit}")));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let send_at = now + undo_window_ms(undo_s);
        self.w().execute(
            "INSERT INTO outbox (id, account_id, draft_id, mime, not_before_ms, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, row.account_id, draft_id, bytes, send_at, now],
        )?;
        Ok(SendHandle {
            outbox_id: id,
            draft_id: draft_id.to_string(),
            send_at_ms: send_at,
        })
    }

    pub fn queue_send(&self, draft_id: &str, undo_s: i64) -> StoreResult<SendHandle> {
        self.queue_send_at(draft_id, undo_s, now_ms())
    }

    /// Undo (or Edit) before the message leaves: deletes the outbox row and
    /// returns the draft id to reopen. `None` once it is sending or sent.
    pub fn undo_send(&self, outbox_id: &str) -> StoreResult<Option<String>> {
        let c = self.w();
        let draft: Option<Option<String>> = c
            .query_row(
                "SELECT draft_id FROM outbox WHERE id = ?1 AND state = 'pending'",
                [outbox_id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(draft) = draft else { return Ok(None) };
        c.execute("DELETE FROM outbox WHERE id = ?1", [outbox_id])?;
        Ok(draft)
    }

    /// Reconnect: messages waiting offline go now, not at their backoff time.
    /// Rows still in their undo window (no attempt yet) keep it.
    pub fn wake_sends(&self, account_id: &str, now: i64) -> StoreResult<usize> {
        Ok(self.w().execute(
            "UPDATE outbox SET not_before_ms = ?2
             WHERE state = 'pending' AND attempts > 0 AND not_before_ms > ?2
               AND (?1 = '' OR account_id = ?1)",
            params![account_id, now],
        )?)
    }

    /// After a crash: an in-flight send is retried (a rare duplicate beats a loss).
    pub fn recover_in_flight_sends(&self) -> StoreResult<()> {
        self.w()
            .execute("UPDATE outbox SET state = 'pending' WHERE state = 'in_flight'", [])?;
        Ok(())
    }

    /// The Outbox view (and disconnect's "N unsent messages" prompt).
    pub fn outbox_items(&self, account_id: &str) -> StoreResult<Vec<OutboxItem>> {
        let rows: Vec<(String, String, Option<String>, String, i64, Option<String>, i64)> = {
            let c = self.w();
            let mut s = c.prepare(
                "SELECT id, account_id, draft_id, state, attempts, last_error, not_before_ms
                 FROM outbox WHERE (?1 = '' OR account_id = ?1) ORDER BY created_at_ms",
            )?;
            let v = s
                .query_map([account_id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
                })?
                .collect::<Result<_, _>>()?;
            v
        };
        rows.into_iter()
            .map(|(id, account_id, draft_id, state, attempts, last_error, not_before_ms)| {
                let doc = match &draft_id {
                    Some(d) => self.draft(d)?.map(|r| r.doc).unwrap_or_default(),
                    None => DraftDoc::default(),
                };
                Ok(OutboxItem {
                    id,
                    account_id,
                    draft_id,
                    subject: doc.subject,
                    to: doc.to,
                    state,
                    attempts,
                    last_error,
                    not_before_ms,
                })
            })
            .collect()
    }

    pub fn unsent_count(&self, account_id: &str) -> StoreResult<i64> {
        Ok(self.w().query_row(
            "SELECT COUNT(*) FROM outbox WHERE account_id = ?1",
            [account_id],
            |r| r.get(0),
        )?)
    }

    fn fail_send(&self, outbox_id: &str, draft_id: Option<&str>, reason: &str) -> StoreResult<()> {
        self.w().execute("DELETE FROM outbox WHERE id = ?1", [outbox_id])?;
        if let Some(d) = draft_id {
            if let Some(mut row) = self.draft(d)? {
                row.doc.last_error = Some(reason.to_string());
                let json = serde_json::to_string(&row.doc).map_err(|e| err(e.to_string()))?;
                self.w()
                    .execute("UPDATE drafts SET json = ?2 WHERE id = ?1", params![d, json])?;
            }
        }
        Ok(())
    }

    /// Sends every due outbox row.
    pub fn run_due_sends<T: SendTransport>(&self, t: &mut T, now: i64) -> StoreResult<SendReport> {
        let due: Vec<(String, String, Option<String>, Vec<u8>, i64, i64)> = {
            let c = self.w();
            let mut s = c.prepare(
                "SELECT id, account_id, draft_id, mime, attempts, created_at_ms FROM outbox
                 WHERE state = 'pending' AND not_before_ms <= ?1 ORDER BY not_before_ms",
            )?;
            let v = s
                .query_map([now], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
                })?
                .collect::<Result<_, _>>()?;
            v
        };
        let mut rep = SendReport::default();
        for (id, account, draft_id, bytes, attempts, created) in due {
            let claimed = self.w().execute(
                "UPDATE outbox SET state = 'in_flight' WHERE id = ?1 AND state = 'pending'",
                [&id],
            )?;
            if claimed == 0 {
                continue; // Undone meanwhile.
            }
            let draft = match &draft_id {
                Some(d) => self.draft(d)?,
                None => None,
            };
            let Some(draft) = draft else {
                self.fail_send(&id, draft_id.as_deref(), "draft_missing")?;
                rep.failed.push((draft_id, "draft_missing".into()));
                continue;
            };
            let provider = self.provider_of(&account)?;
            let rcpts = match mime::envelope_recipients(&draft.doc) {
                Ok(r) => r,
                Err(e) => {
                    self.fail_send(&id, draft_id.as_deref(), &e)?;
                    rep.failed.push((draft_id, e));
                    continue;
                }
            };
            let from = draft.doc.from_addr.trim().to_string();
            let mut via_graph = provider == Provider::Outlook && self.sends_via_graph(&account)?;
            let mut res = if via_graph {
                t.graph_send(&account, &bytes)
            } else {
                t.smtp_send(&account, &from, &rcpts, &bytes)
            };
            if let Err(SendError::Permanent(m)) = &res {
                if provider == Provider::Outlook && microsoft::is_smtp_auth_disabled(m) {
                    self.kv_set(&graph_key(&account), "1")?;
                    via_graph = true;
                    res = if bytes.len() > size_limit(provider, true) {
                        Err(SendError::Permanent(format!(
                            "too_large:{}",
                            size_limit(provider, true)
                        )))
                    } else {
                        t.graph_send(&account, &bytes)
                    };
                }
            }
            match res {
                Ok(()) => {
                    if via_graph {
                        rep.via_graph.push(id.clone());
                    }
                    if !server_saves_sent(provider) {
                        if let Some((_, sent)) = self.role_path(&account, MailboxRole::Sent)? {
                            // Best effort: the message is out either way.
                            let _ = t.append(&account, &sent, &["\\Seen"], &bytes);
                        }
                    }
                    self.w().execute("DELETE FROM outbox WHERE id = ?1", [&id])?;
                    self.drop_draft(&draft)?;
                    rep.sent.push((id, draft_id));
                }
                Err(SendError::Transient(m)) if now - created < SEND_GIVE_UP_MS => {
                    self.w().execute(
                        "UPDATE outbox SET state = 'pending', attempts = attempts + 1,
                           last_error = ?2, not_before_ms = ?3 WHERE id = ?1",
                        params![id, m, now + backoff_ms(attempts + 1)],
                    )?;
                    rep.retrying.push(id);
                }
                Err(e) => {
                    let reason = e.message().to_string();
                    self.fail_send(&id, draft_id.as_deref(), &reason)?;
                    rep.failed.push((draft_id, reason));
                }
            }
        }
        Ok(rep)
    }

    /// RSVP (AC18): saves a draft carrying the iTIP REPLY to the organizer and
    /// queues it with no undo window beyond the shortest choice.
    pub fn queue_rsvp_at(
        &self,
        account_id: &str,
        thread_id: Option<&str>,
        inv: &Invite,
        answer: Rsvp,
        me_name: Option<&str>,
        in_reply_to: Option<&str>,
        now: i64,
    ) -> StoreResult<SendHandle> {
        let me: String = self.w().query_row(
            "SELECT address FROM accounts WHERE id = ?1",
            [account_id],
            |r| r.get(0),
        )?;
        let stamp = chrono::DateTime::from_timestamp_millis(now)
            .unwrap_or_default()
            .format("%Y%m%dT%H%M%SZ")
            .to_string();
        let ics = itip_reply(inv, &me, me_name, answer, &stamp).map_err(err)?;
        let org = inv.organizer.as_ref().ok_or_else(|| err("invite_not_rsvpable"))?;
        let doc = DraftDoc {
            from_name: me_name.map(str::to_string),
            from_addr: me.clone(),
            to: vec![org.email.clone()],
            subject: format!("{}: {}", answer.subject_prefix(), inv.summary),
            text: format!(
                "{} has {} this invitation.",
                me_name.unwrap_or(&me),
                match answer {
                    Rsvp::Accept => "accepted",
                    Rsvp::Maybe => "tentatively accepted",
                    Rsvp::Decline => "declined",
                }
            ),
            in_reply_to: in_reply_to.map(str::to_string),
            calendar_reply: Some(ics),
            ..DraftDoc::default()
        };
        let id = self.save_draft_at(None, account_id, thread_id, doc, now)?;
        // Mark it uploaded so the RSVP never lands in the server's Drafts.
        let rev = self.draft(&id)?.map(|r| r.updated_at_ms).unwrap_or(now);
        self.kv_set(&rev_key(&id), &rev.to_string())?;
        self.queue_send_at(&id, UNDO_CHOICES_S[0], now)
    }
}
