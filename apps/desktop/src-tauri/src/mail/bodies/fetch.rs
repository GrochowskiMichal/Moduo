//! Body, attachment and original-source downloads (AC3, AC16, AC17 engine).
//!
//! Everything goes through one [`RawSource`] (a session checked out of the
//! account actor's pool), so opening an undownloaded thread costs one login
//! that is reused, not one per message or per attachment. [`ImapSource`]
//! remembers the selected mailbox and EXAMINEs (read-only) only on change;
//! every fetch uses `BODY.PEEK`, so downloading never marks mail read.

use std::future::Future;
use std::path::PathBuf;

use futures_util::TryStreamExt;
use rusqlite::{params, OptionalExtension};

use super::{plan, FetchPlan, Priority};
use crate::mail::contracts::BodyState;
use crate::mail::mime::{self, ParsedMail};
use crate::mail::session::Session;
use crate::mail::store::{now_ms, BodyInput, Store, StoreError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchWhat {
    Whole,
    /// Header plus the first `max` bytes of the body text.
    Prefix(u32),
    /// One MIME part by IMAP section (`"2"`, `"1.2"`): its MIME header plus body.
    Part(String),
}

pub trait RawSource: Send {
    fn fetch(
        &mut self,
        mailbox_path: &str,
        uid: u32,
        what: FetchWhat,
    ) -> impl Future<Output = Result<Vec<u8>, String>> + Send;
}

#[derive(Debug)]
pub enum BodyError {
    Store(StoreError),
    NotFound,
    /// No connection: the reader shows "Available when you're back online".
    Offline(String),
}

impl std::fmt::Display for BodyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BodyError::Store(e) => write!(f, "{e}"),
            BodyError::NotFound => write!(f, "message not found"),
            BodyError::Offline(e) => write!(f, "unavailable offline: {e}"),
        }
    }
}
impl std::error::Error for BodyError {}
impl From<StoreError> for BodyError {
    fn from(e: StoreError) -> Self {
        BodyError::Store(e)
    }
}
impl From<rusqlite::Error> for BodyError {
    fn from(e: rusqlite::Error) -> Self {
        BodyError::Store(e.into())
    }
}

/// Where a message can be fetched from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub id: i64,
    pub account_id: String,
    pub ext_id: String,
    pub mailbox_path: String,
    pub uid: u32,
    pub size: i64,
    pub date_ms: i64,
    pub body_state: BodyState,
}

impl Store {
    pub fn body_target(&self, id: i64) -> Result<Option<Target>, BodyError> {
        let conn = self.r();
        let t = conn
            .prepare_cached(
                "SELECT m.id, m.account_id, m.ext_id, mb.path, mm.uid, m.size, m.date_ms, m.body_state
                 FROM messages m
                 JOIN message_mailboxes mm ON mm.message_id = m.id
                 JOIN mailboxes mb ON mb.id = mm.mailbox_id
                 WHERE m.id = ?1
                 ORDER BY (mb.role = 'all') DESC, (mb.role = 'inbox') DESC, mb.id LIMIT 1",
            )?
            .query_row([id], |r| {
                Ok(Target {
                    id: r.get(0)?,
                    account_id: r.get(1)?,
                    ext_id: r.get(2)?,
                    mailbox_path: r.get(3)?,
                    uid: r.get::<_, i64>(4)? as u32,
                    size: r.get(5)?,
                    date_ms: r.get(6)?,
                    body_state: BodyState::parse(&r.get::<_, String>(7)?)
                        .unwrap_or(BodyState::None),
                })
            })
            .optional()?;
        Ok(t)
    }

    /// Row id of (account, ext_id); the reader addresses messages by ext_id.
    pub fn message_row_id(&self, account_id: &str, ext_id: &str) -> Result<Option<i64>, BodyError> {
        Ok(self
            .r()
            .prepare_cached("SELECT id FROM messages WHERE account_id = ?1 AND ext_id = ?2")?
            .query_row(params![account_id, ext_id], |r| r.get(0))
            .optional()?)
    }

    /// Messages of a thread still lacking a readable body.
    pub fn thread_missing_bodies(&self, thread_id: &str) -> Result<Vec<i64>, BodyError> {
        let conn = self.r();
        let mut s = conn.prepare_cached(
            "SELECT id FROM messages WHERE thread_id = ?1 AND body_state != 'full' ORDER BY date_ms DESC",
        )?;
        let v = s
            .query_map([thread_id], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(v)
    }

    /// Prefetch seeds for an account: newest inbox mail first, then the last
    /// 3 months, then older mail for text-only indexing.
    pub fn prefetch_candidates(
        &self,
        account_id: &str,
        now: i64,
        limit: u32,
    ) -> Result<Vec<(i64, Priority)>, BodyError> {
        let conn = self.r();
        let mut s = conn.prepare_cached(
            "SELECT m.id, m.date_ms,
               EXISTS (SELECT 1 FROM message_mailboxes mm JOIN mailboxes mb ON mb.id = mm.mailbox_id
                       WHERE mm.message_id = m.id AND mb.role = 'inbox')
             FROM messages m
             WHERE m.account_id = ?1 AND m.body_state = 'none'
             ORDER BY m.date_ms DESC LIMIT ?2",
        )?;
        let rows = s.query_map(params![account_id, limit], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, bool>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, date, inbox) = row?;
            let p = if now - date > super::RECENT_WINDOW_MS {
                Priority::IndexOnly
            } else if inbox {
                Priority::NewestInbox
            } else {
                Priority::Recent
            };
            out.push((id, p));
        }
        Ok(out)
    }

    /// Saves a parsed message: body (+ FTS), plus any attachment bytes that
    /// came with it, matched to the header-time rows by name and content id.
    pub fn store_parsed(
        &self,
        t: &Target,
        p: &ParsedMail,
        state: BodyState,
    ) -> Result<(), BodyError> {
        let input = BodyInput {
            html: if state == BodyState::Full {
                p.html.clone()
            } else {
                None
            },
            text: p.text.clone(),
            quote_offset: if state == BodyState::Full {
                p.quote_offset
            } else {
                None
            },
            tracker_count: p.tracker_count,
            state,
        };
        self.put_body(&t.account_id, &t.ext_id, &input)?;
        if state != BodyState::Full || p.attachments.is_empty() {
            return Ok(());
        }
        let rows: Vec<(i64, String, Option<String>, bool)> = {
            let conn = self.r();
            let mut s = conn.prepare_cached(
                "SELECT id, filename, content_id, blob_hash IS NOT NULL FROM attachments WHERE message_id = ?1 ORDER BY id",
            )?;
            let v = s
                .query_map([t.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
                .collect::<Result<_, _>>()?;
            v
        };
        let mut used = vec![false; rows.len()];
        for a in &p.attachments {
            let hit = rows.iter().enumerate().position(|(i, (_, name, cid, _))| {
                !used[i]
                    && (a.content_id.is_some()
                        && cid.as_deref().map(|c| c.trim_matches(['<', '>']))
                            == a.content_id.as_deref()
                        || *name == a.filename)
            });
            if let Some(i) = hit {
                used[i] = true;
                if !rows[i].3 {
                    self.put_attachment_bytes(rows[i].0, &a.bytes)?;
                }
            }
        }
        Ok(())
    }
}

/// Downloads and stores one message's body per [`plan`]. A message that is
/// already `full` (or `text_only` when only index text is wanted) is skipped.
pub async fn load_body<S: RawSource>(
    store: &Store,
    src: &mut S,
    id: i64,
    priority: Priority,
) -> Result<BodyState, BodyError> {
    let t = store.body_target(id)?.ok_or(BodyError::NotFound)?;
    let fetch_plan = plan(t.size, t.date_ms, now_ms(), priority);
    let have = t.body_state;
    if have == BodyState::Full
        || (have == BodyState::TextOnly
            && matches!(fetch_plan, FetchPlan::Prefix { full: false, .. }))
    {
        return Ok(have);
    }
    let (what, state) = match fetch_plan {
        FetchPlan::Whole => (FetchWhat::Whole, BodyState::Full),
        FetchPlan::Prefix { max, full } => (
            FetchWhat::Prefix(max),
            if full {
                BodyState::Full
            } else {
                BodyState::TextOnly
            },
        ),
    };
    let raw = src
        .fetch(&t.mailbox_path, t.uid, what)
        .await
        .map_err(BodyError::Offline)?;
    let mut parsed = mime::parse(&raw);
    if state == BodyState::TextOnly {
        if let Some(text) = parsed.text.as_mut() {
            truncate_chars(text, super::INDEX_TEXT_BYTES as usize);
        }
    }
    store.store_parsed(&t, &parsed, state)?;
    Ok(state)
}

/// Opening a thread: every message missing a body, newest first, over one
/// source (one login). Returns how many were downloaded.
pub async fn load_thread<S: RawSource>(
    store: &Store,
    src: &mut S,
    thread_id: &str,
) -> Result<usize, BodyError> {
    let ids = store.thread_missing_bodies(thread_id)?;
    for &id in &ids {
        load_body(store, src, id, Priority::Opened).await?;
    }
    store.touch_thread_bodies(thread_id)?;
    Ok(ids.len())
}

/// Drains up to `budget` queue entries; stops (keeping the entry) when offline.
pub async fn drain_prefetch<S: RawSource>(
    store: &Store,
    src: &mut S,
    queue: &mut super::PrefetchQueue,
    budget: usize,
) -> Result<usize, BodyError> {
    let mut done = 0;
    while done < budget {
        let Some((id, p)) = queue.pop() else { break };
        match load_body(store, src, id, p).await {
            Ok(_) | Err(BodyError::NotFound) => done += 1,
            Err(e @ BodyError::Offline(_)) => {
                queue.push(id, p);
                return Err(e);
            }
            Err(e) => return Err(e),
        }
    }
    Ok(done)
}

/// An attachment on demand: the cached file, or one part fetched and decoded.
pub async fn fetch_attachment<S: RawSource>(
    store: &Store,
    src: &mut S,
    attachment_id: i64,
) -> Result<PathBuf, BodyError> {
    if let Some(p) = store.attachment_path(attachment_id)? {
        if p.exists() {
            store.w().execute(
                "UPDATE attachments SET last_access_ms = ?2 WHERE id = ?1",
                params![attachment_id, now_ms()],
            )?;
            return Ok(p);
        }
    }
    let (message_id, part_id, filename): (i64, String, String) = store
        .r()
        .query_row(
            "SELECT message_id, part_id, filename FROM attachments WHERE id = ?1",
            [attachment_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(BodyError::NotFound)?;
    let t = store.body_target(message_id)?.ok_or(BodyError::NotFound)?;
    let bytes = if valid_section(&part_id) {
        let raw = src
            .fetch(&t.mailbox_path, t.uid, FetchWhat::Part(part_id))
            .await
            .map_err(BodyError::Offline)?;
        decode_part(&raw)
    } else {
        // No usable section: take the whole message and pick the part by name.
        let raw = src
            .fetch(&t.mailbox_path, t.uid, FetchWhat::Whole)
            .await
            .map_err(BodyError::Offline)?;
        mime::parse(&raw)
            .attachments
            .into_iter()
            .find(|a| a.filename == filename)
            .map(|a| a.bytes)
            .ok_or(BodyError::NotFound)?
    };
    store.put_attachment_bytes(attachment_id, &bytes)?;
    store
        .attachment_path(attachment_id)?
        .ok_or(BodyError::NotFound)
}

/// "Show original": the raw source, never stored (it would double the cap).
pub async fn show_original<S: RawSource>(
    store: &Store,
    src: &mut S,
    id: i64,
) -> Result<String, BodyError> {
    let t = store.body_target(id)?.ok_or(BodyError::NotFound)?;
    let raw = src
        .fetch(&t.mailbox_path, t.uid, FetchWhat::Whole)
        .await
        .map_err(BodyError::Offline)?;
    Ok(mime::original_text(&raw))
}

fn valid_section(s: &str) -> bool {
    !s.is_empty()
        && s.split('.').all(|n| {
            !n.is_empty() && n.len() <= 4 && n.bytes().all(|b| b.is_ascii_digit()) && n != "0"
        })
}

/// A part's MIME header + body, decoded by mail-parser's transfer decoding.
fn decode_part(raw: &[u8]) -> Vec<u8> {
    use mail_parser::{MessageParser, PartType};
    let parsed = std::panic::catch_unwind(|| {
        let m = MessageParser::default().parse(raw)?;
        let part = m.parts.first()?;
        Some(match &part.body {
            PartType::Binary(b) | PartType::InlineBinary(b) => b.to_vec(),
            PartType::Text(t) | PartType::Html(t) => t.as_bytes().to_vec(),
            PartType::Message(msg) => msg.raw_message().to_vec(),
            PartType::Multipart(_) => return None,
        })
    });
    parsed.ok().flatten().unwrap_or_else(|| raw.to_vec())
}

fn truncate_chars(s: &mut String, max: usize) {
    if s.len() > max {
        let mut cut = max;
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s.truncate(cut);
    }
}

/// The real source: an async-imap session from the actor's pool.
pub struct ImapSource<'a> {
    session: &'a mut Session,
    selected: Option<String>,
}

impl<'a> ImapSource<'a> {
    pub fn new(session: &'a mut Session) -> Self {
        ImapSource {
            session,
            selected: None,
        }
    }
}

fn quote_mailbox(path: &str) -> String {
    format!("\"{}\"", path.replace('\\', "\\\\").replace('"', "\\\""))
}

impl RawSource for ImapSource<'_> {
    async fn fetch(
        &mut self,
        mailbox_path: &str,
        uid: u32,
        what: FetchWhat,
    ) -> Result<Vec<u8>, String> {
        use async_imap::imap_proto::{MessageSection, SectionPath};
        if self.selected.as_deref() != Some(mailbox_path) {
            self.session
                .examine(quote_mailbox(mailbox_path))
                .await
                .map_err(|e| e.to_string())?;
            self.selected = Some(mailbox_path.to_string());
        }
        let query = match &what {
            FetchWhat::Whole => "BODY.PEEK[]".to_string(),
            FetchWhat::Prefix(max) => format!("(BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.{max}>)"),
            FetchWhat::Part(p) => format!("(BODY.PEEK[{p}.MIME] BODY.PEEK[{p}])"),
        };
        let fetches: Vec<_> = self
            .session
            .uid_fetch(uid.to_string(), &query)
            .await
            .map_err(|e| e.to_string())?
            .try_collect()
            .await
            .map_err(|e| e.to_string())?;
        let f = fetches
            .iter()
            .find(|f| f.uid == Some(uid))
            .or(fetches.first())
            .ok_or_else(|| format!("uid {uid} not on server"))?;
        let out = match what {
            FetchWhat::Whole => f.body().map(<[u8]>::to_vec),
            FetchWhat::Prefix(_) => f.header().map(|h| {
                let mut v = h.to_vec();
                v.extend_from_slice(f.text().unwrap_or_default());
                v
            }),
            FetchWhat::Part(p) => {
                let nums: Vec<u32> = p.split('.').filter_map(|n| n.parse().ok()).collect();
                let body = f.section(&SectionPath::Part(nums.clone(), None));
                body.map(|b| {
                    let mut v = f
                        .section(&SectionPath::Part(nums, Some(MessageSection::Mime)))
                        .unwrap_or_default()
                        .to_vec();
                    if v.is_empty() {
                        v.extend_from_slice(b"\r\n");
                    }
                    v.extend_from_slice(b);
                    v
                })
            }
        };
        out.ok_or_else(|| "empty fetch response".to_string())
    }
}
