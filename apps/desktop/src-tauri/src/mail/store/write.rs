//! Write paths. Every public method is one transaction; list rows
//! (`thread_views`) are recomputed for each touched thread before commit, so a
//! reader never sees a message without its row or a row without its message.

use super::{
    now_ms, AccountInput, BodyInput, ClassifyReason, MailboxCursor, MailboxInput, MessageInput,
    Store, StoreResult, TabRef,
};
use crate::mail::contracts::{MailboxRole, TabKind, FLAG_DELETED, FLAG_SEEN};
use rusqlite::{params, OptionalExtension, Transaction};
use std::collections::BTreeSet;

type Touched = BTreeSet<String>;

impl Store {
    pub fn upsert_account(&self, a: &AccountInput) -> StoreResult<()> {
        self.w().execute(
            "INSERT INTO accounts (id, address, display_name, provider, hue, created_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET address = excluded.address,
               display_name = excluded.display_name, provider = excluded.provider, hue = excluded.hue",
            params![a.id, a.address, a.display_name, a.provider, a.hue, now_ms()],
        )?;
        Ok(())
    }

    pub fn set_account_sync(
        &self,
        account_id: &str,
        state: &str,
        progress: Option<f64>,
        last_error: Option<&str>,
    ) -> StoreResult<()> {
        self.w().execute(
            "UPDATE accounts SET sync_state = ?2, backfill_progress = ?3, last_error = ?4 WHERE id = ?1",
            params![account_id, state, progress, last_error],
        )?;
        Ok(())
    }

    /// A finished sync round (store v2): when, and whether new mail is pushed (IDLE).
    pub fn stamp_synced(&self, account_id: &str, now: i64, push: Option<bool>) -> StoreResult<()> {
        self.w().execute(
            "UPDATE accounts SET last_synced_ms = ?2, push = COALESCE(?3, push) WHERE id = ?1",
            params![account_id, now, push],
        )?;
        Ok(())
    }

    /// Removes every local trace of the account: rows (by cascade), its index
    /// entries and its attachment files (AC38's store half).
    pub fn delete_account(&self, account_id: &str) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM messages_fts WHERE rowid IN (SELECT id FROM messages WHERE account_id = ?1)",
            [account_id],
        )?;
        tx.execute(
            "DELETE FROM thread_views WHERE account_id = ?1",
            [account_id],
        )?;
        tx.execute("DELETE FROM accounts WHERE id = ?1", [account_id])?;
        tx.commit()?;
        drop(conn);
        let dir = self.files_dir(account_id);
        if dir.exists() {
            std::fs::remove_dir_all(dir)?;
        }
        Ok(())
    }

    pub fn upsert_mailbox(&self, m: &MailboxInput) -> StoreResult<()> {
        self.w().execute(
            "INSERT INTO mailboxes (id, account_id, path, name, role, delimiter, live)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET path = excluded.path, name = excluded.name,
               role = excluded.role, delimiter = excluded.delimiter, live = excluded.live",
            params![
                m.id,
                m.account_id,
                m.path,
                m.name,
                m.role.as_str(),
                m.delimiter,
                m.live
            ],
        )?;
        // A role change moves the mailbox's rows between unified views.
        self.w().execute(
            "UPDATE thread_views SET role = ?2 WHERE mailbox_id = ?1",
            params![m.id, m.role.as_str()],
        )?;
        Ok(())
    }

    pub fn set_mailbox_cursor(&self, mailbox_id: &str, c: &MailboxCursor) -> StoreResult<()> {
        self.w().execute(
            "UPDATE mailboxes SET uidvalidity = ?2, uidnext = ?3, highestmodseq = ?4,
               floor_uid = ?5, backfill_state = ?6 WHERE id = ?1",
            params![
                mailbox_id,
                c.uidvalidity,
                c.uidnext,
                c.highestmodseq,
                c.floor_uid,
                c.backfill_state
            ],
        )?;
        Ok(())
    }

    pub fn mailbox_cursor(&self, mailbox_id: &str) -> StoreResult<Option<MailboxCursor>> {
        Ok(self
            .r()
            .query_row(
                "SELECT uidvalidity, uidnext, highestmodseq, floor_uid, backfill_state
                 FROM mailboxes WHERE id = ?1",
                [mailbox_id],
                |r| {
                    Ok(MailboxCursor {
                        uidvalidity: r.get(0)?,
                        uidnext: r.get(1)?,
                        highestmodseq: r.get(2)?,
                        floor_uid: r.get(3)?,
                        backfill_state: r.get(4)?,
                    })
                },
            )
            .optional()?)
    }

    /// Ingests a batch of header-time messages in one transaction: upserts each
    /// message, records its (mailbox, uid), indexes it and refreshes its thread's rows.
    pub fn ingest(&self, batch: &[MessageInput]) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let mut touched = Touched::new();
        for m in batch {
            ingest_one(&tx, m, &mut touched)?;
        }
        for t in &touched {
            refresh_thread(&tx, t)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Applies server flags (CONDSTORE delta or diff) to (mailbox, uid) pairs.
    pub fn set_flags(
        &self,
        mailbox_id: &str,
        updates: &[(i64, u32, Option<i64>)],
    ) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let mut touched = Touched::new();
        {
            let mut find = tx.prepare_cached(
                "SELECT mm.message_id, m.thread_id FROM message_mailboxes mm
                 JOIN messages m ON m.id = mm.message_id WHERE mm.mailbox_id = ?1 AND mm.uid = ?2",
            )?;
            let mut setf = tx.prepare_cached("UPDATE messages SET flags = ?2 WHERE id = ?1")?;
            let mut setm = tx.prepare_cached(
                "UPDATE message_mailboxes SET modseq = ?3 WHERE mailbox_id = ?1 AND uid = ?2",
            )?;
            for (uid, flags, modseq) in updates {
                let hit: Option<(i64, String)> = find
                    .query_row(params![mailbox_id, uid], |r| Ok((r.get(0)?, r.get(1)?)))
                    .optional()?;
                if let Some((id, thread)) = hit {
                    setf.execute(params![id, flags])?;
                    if modseq.is_some() {
                        setm.execute(params![mailbox_id, uid, modseq])?;
                    }
                    touched.insert(thread);
                }
            }
        }
        for t in &touched {
            refresh_thread(&tx, t)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Local-first flag change on every message of the threads (MR-5's local effect).
    pub fn set_thread_flag(&self, thread_ids: &[String], flag: u32, on: bool) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        for t in thread_ids {
            if on {
                tx.execute(
                    "UPDATE messages SET flags = flags | ?2 WHERE thread_id = ?1",
                    params![t, flag],
                )?;
            } else {
                tx.execute(
                    "UPDATE messages SET flags = flags & ~?2 WHERE thread_id = ?1",
                    params![t, flag],
                )?;
            }
            refresh_thread(&tx, t)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Puts every message of these threads in `tab` with the reason that did it
    /// (a rule applied to existing mail), and refreshes their rows.
    pub fn retab_threads(
        &self,
        thread_ids: &[String],
        tab: &TabRef,
        reason: &ClassifyReason,
    ) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        for t in thread_ids {
            tx.execute(
                "UPDATE messages SET tab = ?2, classify_stage = ?3, classify_rule_id = ?4
                 WHERE thread_id = ?1",
                params![t, tab.encode(), reason.stage.as_str(), reason.rule_id],
            )?;
            refresh_thread(&tx, t)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Pin / mute / snooze: thread state that is not an IMAP flag.
    pub fn set_thread_state(
        &self,
        thread_id: &str,
        pinned: Option<bool>,
        muted: Option<bool>,
        snoozed_until_ms: Option<Option<i64>>,
    ) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let account: Option<String> = tx
            .query_row(
                "SELECT account_id FROM messages WHERE thread_id = ?1 LIMIT 1",
                [thread_id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(account) = account else {
            return Ok(());
        };
        tx.execute(
            "INSERT OR IGNORE INTO threads (id, account_id) VALUES (?1, ?2)",
            params![thread_id, account],
        )?;
        if let Some(p) = pinned {
            tx.execute(
                "UPDATE threads SET pinned = ?2 WHERE id = ?1",
                params![thread_id, p],
            )?;
        }
        if let Some(m) = muted {
            tx.execute(
                "UPDATE threads SET muted = ?2 WHERE id = ?1",
                params![thread_id, m],
            )?;
        }
        if let Some(s) = snoozed_until_ms {
            tx.execute(
                "UPDATE threads SET snoozed_until_ms = ?2 WHERE id = ?1",
                params![thread_id, s],
            )?;
        }
        refresh_thread(&tx, thread_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Moves a thread's membership locally (MR-5 move/done/delete local effect):
    /// every (from_mailbox, uid) of the thread becomes a provisional row in `to`.
    /// Provisional uids are negative until the server's COPYUID/sync replaces them.
    pub fn move_thread_local(
        &self,
        thread_id: &str,
        from_mailbox: &str,
        to_mailbox: Option<&str>,
    ) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let ids: Vec<i64> = {
            let mut s = tx.prepare(
                "SELECT mm.message_id FROM message_mailboxes mm JOIN messages m ON m.id = mm.message_id
                 WHERE mm.mailbox_id = ?1 AND m.thread_id = ?2",
            )?;
            let v = s
                .query_map(params![from_mailbox, thread_id], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            v
        };
        tx.execute(
            "DELETE FROM message_mailboxes WHERE mailbox_id = ?1 AND message_id IN
               (SELECT id FROM messages WHERE thread_id = ?2)",
            params![from_mailbox, thread_id],
        )?;
        if let Some(to) = to_mailbox {
            for id in ids {
                let min: i64 = tx.query_row(
                    "SELECT MIN(0, COALESCE(MIN(uid), 0)) FROM message_mailboxes WHERE mailbox_id = ?1",
                    [to],
                    |r| r.get(0),
                )?;
                tx.execute(
                    "INSERT OR IGNORE INTO message_mailboxes (mailbox_id, uid, message_id) VALUES (?1, ?2, ?3)",
                    params![to, min - 1, id],
                )?;
            }
        }
        refresh_thread(&tx, thread_id)?;
        tx.commit()?;
        Ok(())
    }

    /// Expunge: drops (mailbox, uid) memberships; a message left in no mailbox is deleted.
    pub fn remove_uids(&self, mailbox_id: &str, uids: &[i64]) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let mut touched = Touched::new();
        {
            let mut find = tx.prepare_cached(
                "SELECT mm.message_id, m.thread_id FROM message_mailboxes mm
                 JOIN messages m ON m.id = mm.message_id WHERE mm.mailbox_id = ?1 AND mm.uid = ?2",
            )?;
            let mut del = tx.prepare_cached(
                "DELETE FROM message_mailboxes WHERE mailbox_id = ?1 AND uid = ?2",
            )?;
            for uid in uids {
                let hit: Option<(i64, String)> = find
                    .query_row(params![mailbox_id, uid], |r| Ok((r.get(0)?, r.get(1)?)))
                    .optional()?;
                if let Some((id, thread)) = hit {
                    del.execute(params![mailbox_id, uid])?;
                    purge_if_orphan(&tx, id)?;
                    touched.insert(thread);
                }
            }
        }
        for t in &touched {
            refresh_thread(&tx, t)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// The server recreated the mailbox (`uid_validity` changed): forget every
    /// membership so the next sync re-downloads it, and record the new validity.
    pub fn reset_mailbox(&self, mailbox_id: &str, uidvalidity: i64) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let rows: Vec<(i64, String)> = {
            let mut s = tx.prepare(
                "SELECT mm.message_id, m.thread_id FROM message_mailboxes mm
                 JOIN messages m ON m.id = mm.message_id WHERE mm.mailbox_id = ?1",
            )?;
            let v = s
                .query_map([mailbox_id], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<_, _>>()?;
            v
        };
        tx.execute(
            "DELETE FROM message_mailboxes WHERE mailbox_id = ?1",
            [mailbox_id],
        )?;
        let mut touched = Touched::new();
        for (id, t) in rows {
            purge_if_orphan(&tx, id)?;
            touched.insert(t);
        }
        tx.execute(
            "UPDATE mailboxes SET uidvalidity = ?2, uidnext = NULL, highestmodseq = NULL,
               floor_uid = NULL, backfill_state = NULL WHERE id = ?1",
            params![mailbox_id, uidvalidity],
        )?;
        for t in &touched {
            refresh_thread(&tx, t)?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Stores a downloaded body and indexes its text (MR-4 calls this).
    pub fn put_body(&self, account_id: &str, ext_id: &str, b: &BodyInput) -> StoreResult<()> {
        self.put_bodies(&[(account_id, ext_id, b)])
    }

    /// Batch form of `put_body`: one transaction for the whole prefetch batch.
    pub fn put_bodies(&self, batch: &[(&str, &str, &BodyInput)]) -> StoreResult<()> {
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let now = now_ms();
        for (account_id, ext_id, b) in batch {
            let id: Option<i64> = tx
                .prepare_cached("SELECT id FROM messages WHERE account_id = ?1 AND ext_id = ?2")?
                .query_row(params![account_id, ext_id], |r| r.get(0))
                .optional()?;
            let Some(id) = id else {
                continue;
            };
            let bytes =
                b.html.as_ref().map_or(0, |s| s.len()) + b.text.as_ref().map_or(0, |s| s.len());
            tx.prepare_cached(
                "INSERT OR REPLACE INTO bodies (message_id, html, text, quote_offset, tracker_count, bytes, last_access_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?
            .execute(params![id, b.html, b.text, b.quote_offset, b.tracker_count, bytes as i64, now])?;
            tx.prepare_cached("UPDATE messages SET body_state = ?2 WHERE id = ?1")?
                .execute(params![id, b.state.as_str()])?;
            reindex(&tx, id, b.text.as_deref())?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Records that a thread was opened (LRU order for MR-4's disk cap).
    pub fn touch_thread_bodies(&self, thread_id: &str) -> StoreResult<()> {
        self.w().execute(
            "UPDATE bodies SET last_access_ms = ?2 WHERE message_id IN
               (SELECT id FROM messages WHERE thread_id = ?1)",
            params![thread_id, now_ms()],
        )?;
        Ok(())
    }

    /// Writes attachment bytes as a content-addressed file and records it.
    pub fn put_attachment_bytes(&self, attachment_id: i64, bytes: &[u8]) -> StoreResult<()> {
        use sha2::{Digest, Sha256};
        let account: String = self.r().query_row(
            "SELECT m.account_id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = ?1",
            [attachment_id],
            |r| r.get(0),
        )?;
        let hash: String = Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let dir = self.files_dir(&account);
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(&hash);
        if !path.exists() {
            let tmp = dir.join(format!("{hash}.tmp"));
            std::fs::write(&tmp, bytes)?;
            std::fs::rename(&tmp, &path)?;
        }
        self.w().execute(
            "UPDATE attachments SET blob_hash = ?2, stored_bytes = ?3, last_access_ms = ?4 WHERE id = ?1",
            params![attachment_id, hash, bytes.len() as i64, now_ms()],
        )?;
        Ok(())
    }

    /// Path of a stored attachment's bytes, if downloaded.
    pub fn attachment_path(&self, attachment_id: i64) -> StoreResult<Option<std::path::PathBuf>> {
        let hit: Option<(String, Option<String>)> = self
            .r()
            .query_row(
                "SELECT m.account_id, a.blob_hash FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = ?1",
                [attachment_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        Ok(match hit {
            Some((acc, Some(h))) => Some(self.files_dir(&acc).join(h)),
            _ => None,
        })
    }

    pub fn kv_set(&self, key: &str, value: &str) -> StoreResult<()> {
        self.w().execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn kv_get(&self, key: &str) -> StoreResult<Option<String>> {
        Ok(self
            .r()
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }
}

fn ingest_one(tx: &Transaction, m: &MessageInput, touched: &mut Touched) -> StoreResult<()> {
    let to_json = serde_json::to_string(&m.to).unwrap_or_else(|_| "[]".into());
    let cc_json = serde_json::to_string(&m.cc).unwrap_or_else(|_| "[]".into());
    let refs = (!m.references.is_empty()).then(|| m.references.join(" "));
    let tab = m.tab.as_ref().map(TabRef::encode);
    let has_att = m.attachments.iter().any(|a| !a.is_inline);
    let mut up = tx.prepare_cached(
        "INSERT INTO messages (account_id, ext_id, message_id, in_reply_to, refs, thread_id,
           from_name, from_email, to_json, cc_json, subject, snippet, date_ms, flags, size,
           list_unsubscribe, list_unsubscribe_post, precedence, auto_submitted,
           has_attachments, has_invite, tab, priority, classify_stage, classify_rule_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)
         ON CONFLICT(account_id, ext_id) DO UPDATE SET flags = excluded.flags,
           thread_id = excluded.thread_id, tab = COALESCE(excluded.tab, messages.tab),
           classify_rule_id = CASE WHEN excluded.classify_stage IS NULL THEN messages.classify_rule_id ELSE excluded.classify_rule_id END,
           classify_stage = COALESCE(excluded.classify_stage, messages.classify_stage),
           priority = excluded.priority, snippet = CASE WHEN excluded.snippet = '' THEN messages.snippet ELSE excluded.snippet END
         RETURNING id",
    )?;
    // A re-thread must refresh the thread the message left too.
    let prev_thread: Option<String> = tx
        .prepare_cached("SELECT thread_id FROM messages WHERE account_id = ?1 AND ext_id = ?2")?
        .query_row(params![m.account_id, m.ext_id], |r| r.get(0))
        .optional()?;
    let id: i64 = up.query_row(
        params![
            m.account_id,
            m.ext_id,
            m.message_id,
            m.in_reply_to,
            refs,
            m.thread_id,
            m.from.name,
            m.from.email,
            to_json,
            cc_json,
            m.subject,
            m.snippet,
            m.date_ms,
            m.flags,
            m.size,
            m.list_unsubscribe,
            m.list_unsubscribe_post,
            m.precedence,
            m.auto_submitted,
            has_att,
            m.has_invite,
            tab,
            m.priority,
            m.classify.as_ref().map(|c| c.stage.as_str()),
            m.classify.as_ref().and_then(|c| c.rule_id.clone())
        ],
        |r| r.get(0),
    )?;
    let fresh = prev_thread.is_none();
    if fresh {
        // A newer message on a snoozed thread: a later unsnooze reads "reply" (decision 7).
        // Your own message (an account's address, or a copy in a Sent folder) isn't one.
        tx.prepare_cached(
            "INSERT OR IGNORE INTO kv (key, value)
             SELECT 'snooze_reply:' || t.id, '1' FROM threads t
             WHERE t.id = ?1 AND t.snoozed_until_ms IS NOT NULL
               AND ?2 > COALESCE((SELECT MAX(date_ms) FROM messages WHERE thread_id = ?1 AND id != ?3), 0)
               AND NOT EXISTS (SELECT 1 FROM accounts WHERE lower(address) = lower(?4))
               AND NOT EXISTS (SELECT 1 FROM mailboxes WHERE id = ?5 AND role = ?6)",
        )?
        .execute(params![
            m.thread_id,
            m.date_ms,
            id,
            m.from.email.trim(),
            m.mailbox_id,
            MailboxRole::Sent.as_str()
        ])?;
    }
    if let Some(p) = prev_thread {
        if p != m.thread_id {
            touched.insert(p);
        }
    }
    tx.prepare_cached(
        "INSERT INTO message_mailboxes (mailbox_id, uid, message_id, modseq) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(mailbox_id, uid) DO UPDATE SET message_id = excluded.message_id, modseq = excluded.modseq",
    )?
    .execute(params![m.mailbox_id, m.uid, id, m.modseq])?;
    if fresh {
        let mut ins = tx.prepare_cached(
            "INSERT INTO attachments (message_id, part_id, filename, mime, size, is_inline, content_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for a in &m.attachments {
            ins.execute(params![
                id,
                a.part_id,
                a.filename,
                a.mime,
                a.size,
                a.is_inline,
                a.content_id
            ])?;
        }
        reindex(tx, id, None)?;
    }
    touched.insert(m.thread_id.clone());
    Ok(())
}

/// Rewrites one message's FTS entry. A contentless table needs every column,
/// so header columns come from `messages`; the body is the given text, or empty
/// at header time.
pub(crate) fn reindex(tx: &Transaction, id: i64, body: Option<&str>) -> StoreResult<()> {
    let (subject, from, to, cc): (String, String, String, String) = tx.query_row(
        "SELECT subject, from_name || ' ' || from_email, to_json, cc_json FROM messages WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let addr_text = |idx: usize, j: &str| -> rusqlite::Result<String> {
        Ok(super::query::json_col::<Vec<super::Address>>(idx, j)?
            .into_iter()
            .map(|a| format!("{} {}", a.name, a.email))
            .collect::<Vec<_>>()
            .join(" "))
    };
    let to_t = format!("{} {}", addr_text(2, &to)?, addr_text(3, &cc)?);
    let att: String = {
        let mut s = tx.prepare_cached("SELECT filename FROM attachments WHERE message_id = ?1")?;
        let names: Vec<String> = s.query_map([id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        names.join(" ")
    };
    tx.prepare_cached("DELETE FROM messages_fts WHERE rowid = ?1")?
        .execute([id])?;
    tx.prepare_cached(
        "INSERT INTO messages_fts (rowid, subject, from_t, to_t, body, attachments) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )?
    .execute(params![id, subject, from, to_t, body.unwrap_or(""), att])?;
    Ok(())
}

fn purge_if_orphan(tx: &Transaction, message_id: i64) -> StoreResult<()> {
    let left: i64 = tx
        .prepare_cached("SELECT COUNT(*) FROM message_mailboxes WHERE message_id = ?1")?
        .query_row([message_id], |r| r.get(0))?;
    if left == 0 {
        tx.prepare_cached("DELETE FROM messages_fts WHERE rowid = ?1")?
            .execute([message_id])?;
        tx.prepare_cached("DELETE FROM messages WHERE id = ?1")?
            .execute([message_id])?;
    }
    Ok(())
}

/// Recomputes every `thread_views` row of one thread from its messages.
pub(crate) fn refresh_thread(tx: &Transaction, thread_id: &str) -> StoreResult<()> {
    struct Msg {
        from_name: String,
        from_email: String,
        subject: String,
        snippet: String,
        date: i64,
        flags: u32,
        att: bool,
        invite: bool,
        tab: Option<String>,
        priority: bool,
    }
    let msgs: Vec<Msg> = {
        let mut s = tx.prepare_cached(
            "SELECT from_name, from_email, subject, snippet, date_ms, flags, has_attachments, has_invite, tab, priority
             FROM messages WHERE thread_id = ?1 ORDER BY date_ms",
        )?;
        let v = s
            .query_map([thread_id], |r| {
                Ok(Msg {
                    from_name: r.get(0)?,
                    from_email: r.get(1)?,
                    subject: r.get(2)?,
                    snippet: r.get(3)?,
                    date: r.get(4)?,
                    flags: r.get(5)?,
                    att: r.get(6)?,
                    invite: r.get(7)?,
                    tab: r.get(8)?,
                    priority: r.get(9)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        v
    };
    let msgs: Vec<Msg> = msgs
        .into_iter()
        .filter(|m| m.flags & FLAG_DELETED == 0)
        .collect();
    tx.prepare_cached("DELETE FROM thread_views WHERE thread_id = ?1")?
        .execute([thread_id])?;
    let Some(newest) = msgs.last() else {
        tx.prepare_cached("DELETE FROM threads WHERE id = ?1")?
            .execute([thread_id])?;
        return Ok(());
    };
    let (pinned, muted, snoozed): (bool, bool, Option<i64>) = tx
        .prepare_cached("SELECT pinned, muted, snoozed_until_ms FROM threads WHERE id = ?1")?
        .query_row([thread_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?
        .unwrap_or((false, false, None));
    // Senders: distinct by address, newest last, at most 3.
    let mut senders: Vec<super::Address> = Vec::new();
    for m in msgs.iter().rev() {
        if senders
            .iter()
            .any(|s| s.email.eq_ignore_ascii_case(&m.from_email))
        {
            continue;
        }
        senders.insert(
            0,
            super::Address {
                name: m.from_name.clone(),
                email: m.from_email.clone(),
            },
        );
        if senders.len() == 3 {
            break;
        }
    }
    let tab = msgs
        .iter()
        .rev()
        .find_map(|m| m.tab.clone())
        .unwrap_or_else(|| TabKind::Personal.as_str().to_string());
    let subject = msgs
        .iter()
        .find(|m| !m.subject.is_empty())
        .map_or("", |m| &m.subject);
    let unread = msgs.iter().filter(|m| m.flags & FLAG_SEEN == 0).count() as i64;
    let flagged = msgs
        .iter()
        .any(|m| m.flags & crate::mail::contracts::FLAG_FLAGGED != 0);
    let att = msgs.iter().any(|m| m.att);
    let invite = msgs.iter().any(|m| m.invite);
    let priority = msgs.iter().any(|m| m.priority);
    let senders_json = serde_json::to_string(&senders).unwrap_or_else(|_| "[]".into());
    tx.prepare_cached(
        "INSERT INTO thread_views (thread_id, mailbox_id, account_id, role, tab, last_date_ms,
           message_count, unread_count, flagged, has_attachments, has_invite, priority,
           pinned, muted, snoozed_until_ms, subject, snippet, senders_json)
         SELECT DISTINCT ?1, mb.id, mb.account_id, mb.role, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
         FROM messages m JOIN message_mailboxes mm ON mm.message_id = m.id
         JOIN mailboxes mb ON mb.id = mm.mailbox_id
         WHERE m.thread_id = ?1 AND (m.flags & 16) = 0",
    )?
    .execute(params![
        thread_id,
        tab,
        newest.date,
        msgs.len() as i64,
        unread,
        flagged,
        att,
        invite,
        priority,
        pinned,
        muted,
        snoozed,
        subject,
        newest.snippet,
        senders_json
    ])?;
    Ok(())
}
