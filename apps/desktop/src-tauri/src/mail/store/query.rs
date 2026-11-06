//! Read paths, all on the reader connection: keyset thread lists, unread
//! counts, thread load, FTS search and storage stats.

use super::{
    Address, AttachmentRow, Counts, ListCursor, ListInput, ListPage, MailboxRow, MessageRow,
    SearchQuery, StorageStats, Store, StoreResult, TabRef, ThreadDetail, ThreadRow, ViewRef,
};
use crate::mail::contracts::{BodyState, MailboxRole, TabKind, FLAG_SEEN};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use std::collections::HashMap;

const ROW_COLS: &str = "thread_id, account_id, subject, snippet, senders_json, last_date_ms,
  message_count, unread_count, pinned, has_attachments, has_invite, tab, priority, muted, snoozed_until_ms";

pub const MAX_PAGE: u32 = 500;

/// Decodes a JSON column, surfacing corrupt data as a row error instead of an empty value.
pub(crate) fn json_col<T: serde::de::DeserializeOwned>(
    idx: usize,
    raw: &str,
) -> rusqlite::Result<T> {
    serde_json::from_str(raw).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(idx, rusqlite::types::Type::Text, Box::new(e))
    })
}

fn thread_row(r: &Row) -> rusqlite::Result<ThreadRow> {
    let senders: String = r.get(4)?;
    let tab: String = r.get(11)?;
    Ok(ThreadRow {
        thread_id: r.get(0)?,
        account_id: r.get(1)?,
        subject: r.get(2)?,
        snippet: r.get(3)?,
        senders: json_col(4, &senders)?,
        last_date_ms: r.get(5)?,
        message_count: r.get(6)?,
        unread: r.get::<_, i64>(7)? > 0,
        pinned: r.get(8)?,
        has_attachments: r.get(9)?,
        has_invite: r.get(10)?,
        tab: TabRef::decode(&tab).kind,
        priority: r.get(12)?,
        muted: r.get(13)?,
        snoozed_until_ms: r.get(14)?,
        follow_up_at_ms: None,
        return_reason: None,
        outbox_state: None,
    })
}

/// Per-thread row flags that live outside `thread_views` (specs/mail-v3.md decision 7):
/// the follow-up kv, the return reason kv and the send outbox. Each set is small, so
/// one read per window beats a lookup per row.
pub(crate) struct RowFlags {
    follow_up: HashMap<String, i64>,
    returned: HashMap<String, String>,
    outbox: HashMap<String, String>,
}

fn kv_prefix(conn: &Connection, prefix: &str) -> rusqlite::Result<Vec<(String, String)>> {
    // `:` + 1 is `;`, so this is every key that starts with `prefix:`.
    let hi = format!("{};", prefix.trim_end_matches(':'));
    let mut s = conn.prepare_cached("SELECT key, value FROM kv WHERE key >= ?1 AND key < ?2")?;
    let v = s
        .query_map(params![prefix, hi], |r| {
            let k: String = r.get(0)?;
            Ok((k[prefix.len()..].to_string(), r.get(1)?))
        })?
        .collect::<Result<_, _>>()?;
    Ok(v)
}

impl RowFlags {
    pub(crate) fn load(conn: &Connection) -> StoreResult<Self> {
        let follow_up = kv_prefix(conn, "followup:")?
            .into_iter()
            .filter_map(|(t, v)| {
                let due = serde_json::from_str::<serde_json::Value>(&v).ok()?["dueMs"].as_i64()?;
                Some((t, due))
            })
            .collect();
        let returned = kv_prefix(conn, "returned:")?
            .into_iter()
            .filter(|(_, v)| v == "snooze" || v == "reply")
            .collect();
        let mut outbox = HashMap::new();
        let mut s = conn.prepare_cached(
            "SELECT d.thread_id, o.state FROM outbox o JOIN drafts d ON d.id = o.draft_id
             WHERE o.state IN ('pending', 'in_flight') AND d.thread_id IS NOT NULL",
        )?;
        let mut rows = s.query([])?;
        while let Some(r) = rows.next()? {
            let (t, state): (String, String) = (r.get(0)?, r.get(1)?);
            // In flight beats pending when a thread has two sends queued.
            if state == "in_flight" || !outbox.contains_key(&t) {
                outbox.insert(t, state);
            }
        }
        Ok(RowFlags {
            follow_up,
            returned,
            outbox,
        })
    }

    pub(crate) fn apply(&self, row: &mut ThreadRow) {
        row.follow_up_at_ms = self.follow_up.get(&row.thread_id).copied();
        row.return_reason = self.returned.get(&row.thread_id).cloned();
        if row.outbox_state.is_none() {
            row.outbox_state = self.outbox.get(&row.thread_id).cloned();
        }
    }

    pub(crate) fn apply_all(&self, rows: &mut [ThreadRow]) {
        for r in rows {
            self.apply(r);
        }
    }
}

/// `mailViewKey` from runtime.types.mail-engine.ts.
pub fn view_key(view: &ViewRef, tab: Option<&str>) -> String {
    let v = match view {
        ViewRef::Unified(role) => format!("unified:{}", role.as_str()),
        ViewRef::Mailbox(id) => format!("mailbox:{id}"),
        ViewRef::Snoozed => "snoozed".to_string(),
    };
    match tab {
        Some(t) => format!("{v}|{t}"),
        None => v,
    }
}

impl Store {
    /// One keyset window of a view. The first window (no cursor) leads with the
    /// view's pinned threads; the keyset body skips them, so cursors stay stable.
    pub fn list_threads(&self, input: &ListInput) -> StoreResult<ListPage> {
        let limit = input.limit.clamp(1, MAX_PAGE);
        let conn = self.r();
        let mut filter = String::new();
        let mut args: Vec<Value> = Vec::new();
        match &input.view {
            ViewRef::Unified(role) => {
                filter.push_str("role = ?");
                args.push(Value::Text(role.as_str().into()));
            }
            ViewRef::Mailbox(id) => {
                filter.push_str("mailbox_id = ?");
                args.push(Value::Text(id.clone()));
            }
            ViewRef::Snoozed => filter.push_str("snoozed_until_ms IS NOT NULL"),
        }
        if let Some(t) = &input.tab {
            filter.push_str(" AND tab = ?");
            args.push(Value::Text(t.encode()));
        }
        // A thread in two mailboxes of one view (Snoozed, or two same-role
        // folders) reads once: the rows are identical apart from mailbox_id.
        let mut rows: Vec<ThreadRow> = Vec::new();
        if input.after.is_none() {
            let sql = format!(
                "SELECT DISTINCT {ROW_COLS} FROM thread_views INDEXED BY tv_pinned WHERE pinned = 1 AND {filter}
                 ORDER BY last_date_ms DESC, thread_id DESC LIMIT {MAX_PAGE}"
            );
            let mut s = conn.prepare_cached(&sql)?;
            rows.extend(
                s.query_map(params_from_iter(args.iter()), thread_row)?
                    .collect::<Result<Vec<_>, _>>()?,
            );
        }
        let mut body_args = args.clone();
        let mut keyset = String::new();
        if let Some(c) = &input.after {
            keyset.push_str(" AND (last_date_ms, thread_id) < (?, ?)");
            body_args.push(Value::Integer(c.last_date_ms));
            body_args.push(Value::Text(c.thread_id.clone()));
        }
        let sql = format!(
            "SELECT DISTINCT {ROW_COLS} FROM thread_views WHERE {filter} AND pinned = 0{keyset}
             ORDER BY last_date_ms DESC, thread_id DESC LIMIT {limit}"
        );
        let mut s = conn.prepare_cached(&sql)?;
        let body: Vec<ThreadRow> = s
            .query_map(params_from_iter(body_args.iter()), thread_row)?
            .collect::<Result<_, _>>()?;
        let next = (body.len() as u32 == limit).then(|| {
            let last = body.last().expect("non-empty");
            ListCursor {
                last_date_ms: last.last_date_ms,
                thread_id: last.thread_id.clone(),
            }
        });
        rows.extend(body);
        RowFlags::load(&conn)?.apply_all(&mut rows);
        Ok(ListPage { rows, next })
    }

    /// Unread-thread counts per view key (`mailbox:<id>[|tab]`, `unified:<role>[|tab]`)
    /// and the badge (unified Inbox, Personal tab; MR-8 applies the badge setting).
    pub fn counts(&self) -> StoreResult<Counts> {
        let conn = self.r();
        let mut s = conn.prepare_cached(
            "SELECT mailbox_id, tab, role, COUNT(*) FROM thread_views INDEXED BY tv_unread
             WHERE unread_count > 0 GROUP BY mailbox_id, tab",
        )?;
        let mut out = Counts::default();
        let mut rows = s.query([])?;
        while let Some(r) = rows.next()? {
            let mailbox: String = r.get(0)?;
            let tab: String = r.get(1)?;
            let role: String = r.get(2)?;
            let n: i64 = r.get(3)?;
            for key in [
                format!("mailbox:{mailbox}"),
                format!("mailbox:{mailbox}|{tab}"),
                format!("unified:{role}"),
                format!("unified:{role}|{tab}"),
            ] {
                *out.by_view_key.entry(key).or_insert(0) += n;
            }
        }
        out.badge = out
            .by_view_key
            .get(&format!("unified:inbox|{}", TabKind::Personal.as_str()))
            .copied()
            .unwrap_or(0);
        out.outbox = conn
            .prepare_cached("SELECT COUNT(*) FROM outbox WHERE state IN ('pending', 'in_flight')")?
            .query_row([], |r| r.get(0))?;
        // System ops (rule effects, mute) are the engine's, not saved actions.
        out.pending_ops = conn
            .prepare_cached(
                "SELECT COUNT(*) FROM ops WHERE state IN ('pending', 'in_flight')
                   AND COALESCE(json_extract(args_json, '$.system'), 0) = 0",
            )?
            .query_row([], |r| r.get(0))?;
        Ok(out)
    }

    pub fn list_mailboxes(&self, account_id: &str) -> StoreResult<Vec<MailboxRow>> {
        let conn = self.r();
        let mut s = conn.prepare_cached(
            "SELECT mb.id, mb.account_id, mb.name, mb.path, mb.role,
               (SELECT COUNT(*) FROM thread_views tv WHERE tv.mailbox_id = mb.id AND tv.unread_count > 0),
               (SELECT COUNT(*) FROM thread_views tv WHERE tv.mailbox_id = mb.id)
             FROM mailboxes mb WHERE mb.account_id = ?1 ORDER BY mb.path",
        )?;
        let v = s
            .query_map([account_id], |r| {
                let role: String = r.get(4)?;
                Ok(MailboxRow {
                    id: r.get(0)?,
                    account_id: r.get(1)?,
                    name: r.get(2)?,
                    path: r.get(3)?,
                    role: MailboxRole::parse(&role).unwrap_or(MailboxRole::Custom),
                    unread: r.get(5)?,
                    total: r.get(6)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(v)
    }

    /// The whole conversation, oldest first, with bodies where downloaded.
    pub fn get_thread(&self, thread_id: &str) -> StoreResult<Option<ThreadDetail>> {
        let conn = self.r();
        let Some(mut row) = best_row(&conn, thread_id)? else {
            return Ok(None);
        };
        RowFlags::load(&conn)?.apply(&mut row);
        let mut s = conn.prepare_cached(
            "SELECT m.id, m.ext_id, m.message_id, m.from_name, m.from_email, m.to_json, m.cc_json,
               m.date_ms, m.subject, m.snippet, m.flags, m.body_state, b.html, b.text,
               b.quote_offset, b.tracker_count, m.list_unsubscribe, m.has_invite
             FROM messages m LEFT JOIN bodies b ON b.message_id = m.id
             WHERE m.thread_id = ?1 AND (m.flags & 16) = 0 ORDER BY m.date_ms",
        )?;
        let mut ids = Vec::new();
        let mut messages: Vec<MessageRow> = s
            .query_map([thread_id], |r| {
                ids.push(r.get::<_, i64>(0)?);
                let to: String = r.get(5)?;
                let cc: String = r.get(6)?;
                let flags: u32 = r.get(10)?;
                let state: String = r.get(11)?;
                Ok(MessageRow {
                    id: r.get(1)?,
                    message_id: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    from: Address {
                        name: r.get(3)?,
                        email: r.get(4)?,
                    },
                    to: json_col(5, &to)?,
                    cc: json_col(6, &cc)?,
                    date_ms: r.get(7)?,
                    subject: r.get(8)?,
                    snippet: r.get(9)?,
                    unread: flags & FLAG_SEEN == 0,
                    body_state: BodyState::parse(&state).unwrap_or(BodyState::None),
                    html: r.get(12)?,
                    text: r.get(13)?,
                    quote_offset: r.get(14)?,
                    tracker_count: r.get::<_, Option<i64>>(15)?.unwrap_or(0),
                    attachments: Vec::new(),
                    list_unsubscribe: r.get(16)?,
                    has_invite: r.get(17)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut a = conn.prepare_cached(
            "SELECT a.message_id, a.id, a.filename, a.mime, a.size, a.is_inline, a.content_id
             FROM attachments a JOIN messages m ON m.id = a.message_id
             WHERE m.thread_id = ?1 ORDER BY a.id",
        )?;
        let mut rows = a.query([thread_id])?;
        while let Some(r) = rows.next()? {
            let mid: i64 = r.get(0)?;
            if let Some(pos) = ids.iter().position(|x| *x == mid) {
                messages[pos].attachments.push(AttachmentRow {
                    id: r.get::<_, i64>(1)?.to_string(),
                    filename: r.get(2)?,
                    mime: r.get(3)?,
                    size: r.get(4)?,
                    is_inline: r.get(5)?,
                    content_id: r.get(6)?,
                });
            }
        }
        // The newest sender's "Always load images" (decision 11).
        let images_allowed = match messages.last() {
            Some(m) if !m.from.email.is_empty() => conn
                .prepare_cached("SELECT EXISTS(SELECT 1 FROM kv WHERE key = ?1)")?
                .query_row([images_allow_key(&m.from.email)], |r| r.get(0))?,
            _ => false,
        };
        Ok(Some(ThreadDetail {
            row,
            messages,
            images_allowed,
        }))
    }

    /// ⌘K search: FTS5 for words and from/to/subject, indexed columns for the
    /// rest. Returns one row per thread, newest match first.
    pub fn search(&self, q: &SearchQuery) -> StoreResult<Vec<ThreadRow>> {
        let limit = q.limit.clamp(1, MAX_PAGE);
        let conn = self.r();
        let fts = fts_expression(q);
        // Walk messages newest first and stop at `limit` distinct threads. The
        // FTS match is materialized once as a rowid set, so a common word costs
        // one index walk to the limit instead of sorting every match.
        let mut sql =
            String::from("SELECT m.thread_id FROM messages m INDEXED BY messages_date WHERE 1");
        let mut args: Vec<Value> = Vec::new();
        if let Some(expr) = &fts {
            sql.push_str(
                " AND m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)",
            );
            args.push(Value::Text(expr.clone()));
        }
        sql.push_str(" AND (m.flags & 16) = 0");
        if q.has_attachment {
            sql.push_str(" AND m.has_attachments = 1");
        }
        if q.is_unread {
            sql.push_str(" AND (m.flags & 1) = 0");
        }
        if q.is_pinned {
            sql.push_str(
                " AND EXISTS (SELECT 1 FROM threads t WHERE t.id = m.thread_id AND t.pinned = 1)",
            );
        }
        if let Some(role) = q.in_role {
            sql.push_str(
                " AND EXISTS (SELECT 1 FROM message_mailboxes mm JOIN mailboxes mb ON mb.id = mm.mailbox_id
                   WHERE mm.message_id = m.id AND mb.role = ?)",
            );
            args.push(Value::Text(role.as_str().into()));
        }
        if let Some(mb) = &q.in_mailbox_id {
            sql.push_str(" AND EXISTS (SELECT 1 FROM message_mailboxes mm WHERE mm.message_id = m.id AND mm.mailbox_id = ?)");
            args.push(Value::Text(mb.clone()));
        }
        if let Some(b) = q.before_ms {
            sql.push_str(" AND m.date_ms < ?");
            args.push(Value::Integer(b));
        }
        if let Some(a) = q.after_ms {
            sql.push_str(" AND m.date_ms >= ?");
            args.push(Value::Integer(a));
        }
        if let Some(acc) = &q.account_id {
            sql.push_str(" AND m.account_id = ?");
            args.push(Value::Text(acc.clone()));
        }
        sql.push_str(" ORDER BY m.date_ms DESC");
        let mut threads: Vec<String> = Vec::new();
        {
            let mut s = conn.prepare(&sql)?;
            let mut rows = s.query(params_from_iter(args.iter()))?;
            while let Some(r) = rows.next()? {
                let t: String = r.get(0)?;
                if !threads.contains(&t) {
                    threads.push(t);
                    if threads.len() as u32 == limit {
                        break;
                    }
                }
            }
        }
        let mut out = Vec::with_capacity(threads.len());
        for t in threads {
            if let Some(r) = best_row(&conn, &t)? {
                out.push(r);
            }
        }
        RowFlags::load(&conn)?.apply_all(&mut out);
        Ok(out)
    }

    pub fn storage_stats(&self) -> StoreResult<Vec<StorageStats>> {
        let conn = self.r();
        let mut s = conn.prepare_cached(
            "SELECT a.id, a.disk_cap_bytes,
               (SELECT COALESCE(SUM(b.bytes), 0) FROM bodies b JOIN messages m ON m.id = b.message_id WHERE m.account_id = a.id),
               (SELECT COALESCE(SUM(t.stored_bytes), 0) FROM attachments t JOIN messages m ON m.id = t.message_id WHERE m.account_id = a.id),
               (SELECT COUNT(*) FROM messages m WHERE m.account_id = a.id)
             FROM accounts a ORDER BY a.id",
        )?;
        let v = s
            .query_map([], |r| {
                Ok(StorageStats {
                    account_id: r.get(0)?,
                    disk_cap_bytes: r.get(1)?,
                    mail_bytes: r.get(2)?,
                    attachment_bytes: r.get(3)?,
                    message_count: r.get(4)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(v)
    }
}

/// The engine kv key of a sender's "Always load images" (decision 11).
pub fn images_allow_key(address: &str) -> String {
    format!("images_allow:{}", address.trim().to_ascii_lowercase())
}

/// The list row a thread shows outside a view: its Inbox row if it has one.
pub(crate) fn best_row(conn: &Connection, thread_id: &str) -> StoreResult<Option<ThreadRow>> {
    let sql = format!(
        "SELECT {ROW_COLS} FROM thread_views WHERE thread_id = ?1
         ORDER BY (role = 'inbox') DESC, mailbox_id LIMIT 1"
    );
    Ok(conn
        .prepare_cached(&sql)?
        .query_row(params![thread_id], thread_row)
        .optional()?)
}

/// One FTS5 term: a quoted phrase (quotes doubled) with a prefix star, so user
/// text can never inject FTS syntax.
fn term(col: Option<&str>, raw: &str) -> Option<String> {
    let clean: String = raw.chars().filter(|c| !c.is_control()).collect();
    let clean = clean.trim();
    if clean.is_empty() {
        return None;
    }
    let phrase = format!("\"{}\"*", clean.replace('"', "\"\""));
    Some(match col {
        Some(c) => format!("{c} : {phrase}"),
        None => phrase,
    })
}

pub fn fts_expression(q: &SearchQuery) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    parts.extend(q.words.iter().filter_map(|w| term(None, w)));
    parts.extend(q.from.iter().filter_map(|w| term(Some("from_t"), w)));
    parts.extend(q.to.iter().filter_map(|w| term(Some("to_t"), w)));
    parts.extend(q.subject.iter().filter_map(|w| term(Some("subject"), w)));
    (!parts.is_empty()).then(|| parts.join(" AND "))
}
