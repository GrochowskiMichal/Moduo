//! Store-side support for the reader commands and the views the thread store
//! does not list itself (Follow-ups, New senders, Outbox).
//!
//! - Messages and attachments are addressed by (thread, ext id) and
//!   (thread, attachment id), so a webview id never reaches another thread.
//! - Follow-ups live in `kv` `followup:<thread>` = `{dueMs, armedAtMs}`; a due
//!   one shows until a counterpart (any address that is not one of the user's
//!   accounts) writes after it was armed, which also clears it.
//! - The Screener's hold is `kv` `screened:<thread>`, set at ingest; a thread
//!   shows in New senders while held and still in an inbox.
//! - Outbox rows are synthesized from `outbox` + `drafts` (pending and in-flight
//!   sends), one row per send.

use chrono::{NaiveDate, NaiveDateTime, TimeZone};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::mail::contracts::{ClassifyStage, TabKind};
use crate::mail::invite::Invite;
use crate::mail::send::DraftDoc;
use crate::mail::store::query::{best_row, images_allow_key, json_col, RowFlags};
use crate::mail::store::{Address, Store, StoreResult, TabRef, ThreadRow};
use crate::mail::sync::classify::{classify, ClassifyConfig};
use crate::mail::sync::headers::ParsedHeader;

const FOLLOWUP: &str = "followup:";
const SCREENED: &str = "screened:";
const VIEW_CAP: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUp {
    pub due_ms: i64,
    pub armed_at_ms: i64,
}

/// Why a thread sits in its tab (`MailExplain`, specs/mail-v3.md decision 3).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Explain {
    /// None only when the thread has no stored reason and no headers to re-run.
    pub stage: Option<ClassifyStage>,
    pub rule_id: Option<String>,
    pub custom_tab_id: Option<String>,
    /// The sender the decision was about (the newest message's).
    pub address: String,
    pub tab: TabKind,
}

/// One message's addressing for on-demand fetches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageRef {
    pub row_id: i64,
    pub account_id: String,
    pub message_id: Option<String>,
    pub list_unsubscribe: Option<String>,
    pub list_unsubscribe_post: Option<String>,
}

/// `MailInvite` in features/email/reader/invite-card.tsx.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteView {
    pub uid: String,
    pub method: String,
    pub summary: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub location: Option<String>,
    pub organizer: Option<Address>,
    pub my_status: Option<String>,
    pub can_rsvp: bool,
}

/// Keys between `prefix` and the next code point after its last character.
fn prefix_bounds(prefix: &str) -> (String, String) {
    let mut hi = prefix.to_string();
    let last = hi.pop().expect("non-empty prefix");
    hi.push(char::from_u32(last as u32 + 1).expect("ascii prefix"));
    (prefix.to_string(), hi)
}

impl Store {
    fn kv_scan(&self, prefix: &str) -> StoreResult<Vec<(String, String)>> {
        let (lo, hi) = prefix_bounds(prefix);
        let conn = self.r();
        let mut s =
            conn.prepare_cached("SELECT key, value FROM kv WHERE key >= ?1 AND key < ?2")?;
        let v = s
            .query_map(params![lo, hi], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<(String, String)>, _>>()?;
        Ok(v
            .into_iter()
            .map(|(k, v)| (k[prefix.len()..].to_string(), v))
            .collect())
    }

    fn kv_delete(&self, key: &str) -> StoreResult<()> {
        self.w().execute("DELETE FROM kv WHERE key = ?1", [key])?;
        Ok(())
    }

    /// A message of this thread by its ext id, or None.
    pub fn message_ref(&self, thread_id: &str, ext_id: &str) -> StoreResult<Option<MessageRef>> {
        Ok(self
            .r()
            .prepare_cached(
                "SELECT id, account_id, message_id, list_unsubscribe, list_unsubscribe_post
                 FROM messages WHERE thread_id = ?1 AND ext_id = ?2",
            )?
            .query_row(params![thread_id, ext_id], |r| {
                Ok(MessageRef {
                    row_id: r.get(0)?,
                    account_id: r.get(1)?,
                    message_id: r.get(2)?,
                    list_unsubscribe: r.get(3)?,
                    list_unsubscribe_post: r.get(4)?,
                })
            })
            .optional()?)
    }

    /// (account, mime, filename) of an attachment that belongs to this thread.
    pub fn thread_attachment(
        &self,
        thread_id: &str,
        attachment_id: i64,
    ) -> StoreResult<Option<(String, String, String)>> {
        Ok(self
            .r()
            .prepare_cached(
                "SELECT m.account_id, a.mime, a.filename FROM attachments a
                 JOIN messages m ON m.id = a.message_id
                 WHERE a.id = ?1 AND m.thread_id = ?2",
            )?
            .query_row(params![attachment_id, thread_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?)
    }

    /// The message's `text/calendar` part, if it has one.
    pub fn invite_attachment(&self, row_id: i64) -> StoreResult<Option<i64>> {
        Ok(self
            .r()
            .prepare_cached(
                "SELECT id FROM attachments WHERE message_id = ?1
                 AND lower(mime) LIKE 'text/calendar%' ORDER BY id LIMIT 1",
            )?
            .query_row([row_id], |r| r.get(0))
            .optional()?)
    }

    /// The account a mailbox belongs to.
    pub fn mailbox_account(&self, mailbox_id: &str) -> StoreResult<Option<String>> {
        Ok(self
            .r()
            .prepare_cached("SELECT account_id FROM mailboxes WHERE id = ?1")?
            .query_row([mailbox_id], |r| r.get(0))
            .optional()?)
    }

    /// The account a thread belongs to.
    pub fn thread_account(&self, thread_id: &str) -> StoreResult<Option<String>> {
        Ok(self
            .r()
            .prepare_cached("SELECT account_id FROM messages WHERE thread_id = ?1 LIMIT 1")?
            .query_row([thread_id], |r| r.get(0))
            .optional()?)
    }

    /// Row ids of a thread's messages that still lack a full body.
    pub fn thread_needs_bodies(&self, thread_id: &str) -> StoreResult<bool> {
        Ok(self.r().prepare_cached(
            "SELECT EXISTS(SELECT 1 FROM messages WHERE thread_id = ?1 AND body_state != 'full' AND (flags & 16) = 0)",
        )?
        .query_row([thread_id], |r| r.get(0))?)
    }

    // ---- Follow-ups ----

    /// Arms (`Some(due)`) or clears (`None`) a thread's follow-up.
    pub fn set_follow_up(&self, thread_id: &str, due_ms: Option<i64>, now: i64) -> StoreResult<()> {
        let key = format!("{FOLLOWUP}{thread_id}");
        match due_ms {
            Some(due) => self.kv_set(
                &key,
                &serde_json::to_string(&FollowUp {
                    due_ms: due,
                    armed_at_ms: now,
                })
                .expect("serializable"),
            ),
            None => self.kv_delete(&key),
        }
    }

    pub fn follow_up(&self, thread_id: &str) -> StoreResult<Option<FollowUp>> {
        Ok(self
            .kv_get(&format!("{FOLLOWUP}{thread_id}"))?
            .and_then(|v| serde_json::from_str(&v).ok()))
    }

    fn counterpart_replied(&self, thread_id: &str, since_ms: i64) -> StoreResult<bool> {
        Ok(self.r().prepare_cached(
            "SELECT EXISTS(SELECT 1 FROM messages m WHERE m.thread_id = ?1 AND m.date_ms > ?2
               AND (m.flags & 16) = 0 AND m.from_email != ''
               AND lower(m.from_email) NOT IN (SELECT lower(address) FROM accounts))",
        )?
        .query_row(params![thread_id, since_ms], |r| r.get(0))?)
    }

    /// Due follow-ups with no counterpart reply, newest first. A reply clears
    /// its follow-up for good (E: "the counterpart replied from another device").
    pub fn followup_rows(&self, now: i64) -> StoreResult<Vec<ThreadRow>> {
        let mut out = Vec::new();
        for (thread_id, raw) in self.kv_scan(FOLLOWUP)? {
            let Ok(f) = serde_json::from_str::<FollowUp>(&raw) else {
                self.kv_delete(&format!("{FOLLOWUP}{thread_id}"))?;
                continue;
            };
            if self.counterpart_replied(&thread_id, f.armed_at_ms)? {
                self.kv_delete(&format!("{FOLLOWUP}{thread_id}"))?;
                continue;
            }
            if f.due_ms > now {
                continue;
            }
            if let Some(r) = best_row(&self.r(), &thread_id)? {
                out.push(r);
            }
        }
        sort_rows(&mut out);
        RowFlags::load(&self.r())?.apply_all(&mut out);
        Ok(out)
    }

    // ---- Screener ----

    pub fn set_screened(&self, thread_ids: &[String], held: bool) -> StoreResult<()> {
        for t in thread_ids {
            let key = format!("{SCREENED}{t}");
            if held {
                self.kv_set(&key, "1")?;
            } else {
                self.kv_delete(&key)?;
            }
        }
        Ok(())
    }

    /// Held threads still in an inbox, newest first.
    pub fn new_sender_rows(&self) -> StoreResult<Vec<ThreadRow>> {
        let mut out = Vec::new();
        for (thread_id, _) in self.kv_scan(SCREENED)? {
            let in_inbox: bool = self.r().prepare_cached(
                "SELECT EXISTS(SELECT 1 FROM thread_views WHERE thread_id = ?1 AND role = 'inbox')",
            )?
            .query_row([&thread_id], |r| r.get(0))?;
            if !in_inbox {
                continue;
            }
            if let Some(r) = best_row(&self.r(), &thread_id)? {
                out.push(r);
            }
        }
        sort_rows(&mut out);
        RowFlags::load(&self.r())?.apply_all(&mut out);
        Ok(out)
    }

    // ---- Outbox ----

    /// Pending and in-flight sends as list rows (the send's id when it has no thread).
    pub fn outbox_rows(&self) -> StoreResult<Vec<ThreadRow>> {
        let conn = self.r();
        let mut s = conn.prepare_cached(
            "SELECT o.id, o.account_id, o.created_at_ms, d.thread_id, d.json, o.state
             FROM outbox o LEFT JOIN drafts d ON d.id = o.draft_id
             WHERE o.state IN ('pending', 'in_flight')
             ORDER BY o.created_at_ms DESC, o.id DESC",
        )?;
        let rows = s
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows
            .into_iter()
            .take(VIEW_CAP)
            .map(|(id, account_id, created, thread_id, json, state)| {
                let doc: DraftDoc = match json.as_deref().map(serde_json::from_str) {
                    None => DraftDoc::default(),
                    Some(Ok(doc)) => doc,
                    Some(Err(e)) => {
                        // Keep the pending send visible; the stored draft stays untouched.
                        eprintln!("[mail] outbox {id}: unreadable draft: {e}");
                        DraftDoc {
                            subject: "(unreadable draft)".into(),
                            ..DraftDoc::default()
                        }
                    }
                };
                let mut snippet: String = doc.text.chars().take(140).collect();
                snippet = snippet.split_whitespace().collect::<Vec<_>>().join(" ");
                ThreadRow {
                    thread_id: thread_id.unwrap_or_else(|| format!("outbox:{id}")),
                    account_id,
                    subject: doc.subject,
                    snippet,
                    senders: doc
                        .to
                        .iter()
                        .map(|e| Address {
                            name: String::new(),
                            email: e.clone(),
                        })
                        .collect(),
                    last_date_ms: created,
                    message_count: 1,
                    unread: false,
                    pinned: false,
                    has_attachments: !doc.attachments.is_empty(),
                    has_invite: doc.calendar_reply.is_some(),
                    tab: TabKind::Personal,
                    priority: false,
                    muted: false,
                    snoozed_until_ms: None,
                    follow_up_at_ms: None,
                    return_reason: None,
                    outbox_state: Some(state),
                }
            })
            .collect())
    }

    // ---- Why here (decision 3) ----

    /// The newest message's stored classifier reason; a thread classified before
    /// store v2 is re-classified on its stored headers with the current settings.
    pub fn explain_thread(
        &self,
        thread_id: &str,
        cfg: &ClassifyConfig,
    ) -> StoreResult<Option<Explain>> {
        let conn = self.r();
        let Some(row) = best_row(&conn, thread_id)? else {
            return Ok(None);
        };
        type Newest = (
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        );
        let newest: Option<Newest> = conn
            .prepare_cached(
                "SELECT from_name, from_email, to_json, cc_json, subject, list_unsubscribe,
                   list_unsubscribe_post, precedence, auto_submitted, classify_stage,
                   classify_rule_id, tab
                 FROM messages WHERE thread_id = ?1 AND (flags & 16) = 0
                 ORDER BY date_ms DESC, id DESC LIMIT 1",
            )?
            .query_row([thread_id], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                ))
            })
            .optional()?;
        let Some((name, email, to, cc, subject, lu, lup, prec, auto, stage, rule_id, tab)) = newest
        else {
            return Ok(None);
        };
        drop(conn);
        if let Some(stage) = stage.as_deref().and_then(ClassifyStage::parse) {
            let custom_tab_id = (stage == ClassifyStage::CustomTabs)
                .then(|| tab.as_deref().map(TabRef::decode).and_then(|t| t.custom_id))
                .flatten();
            return Ok(Some(Explain {
                stage: Some(stage),
                rule_id,
                custom_tab_id,
                address: email,
                tab: row.tab,
            }));
        }
        if email.is_empty() {
            return Ok(Some(Explain {
                stage: None,
                rule_id: None,
                custom_tab_id: None,
                address: email,
                tab: row.tab,
            }));
        }
        let h = ParsedHeader {
            from: Address {
                name,
                email: email.clone(),
            },
            to: json_col(2, &to)?,
            cc: json_col(3, &cc)?,
            subject,
            list_unsubscribe: lu,
            list_unsubscribe_post: lup,
            precedence: prec,
            auto_submitted: auto,
            ..ParsedHeader::default()
        };
        let o = classify(&h, cfg);
        Ok(Some(Explain {
            stage: Some(o.stage),
            rule_id: o.rule_id,
            custom_tab_id: o.tab.custom_id,
            address: email,
            tab: o.tab.kind,
        }))
    }

    // ---- Images (decision 11) ----

    /// "Always load images" from this sender, on this Mac (or forget it).
    pub fn set_image_allow(&self, address: &str, allow: bool) -> StoreResult<()> {
        let key = images_allow_key(address);
        if allow {
            self.kv_set(&key, "1")
        } else {
            self.kv_delete(&key)
        }
    }

    // ---- Avatars ----

    /// A cached logo for the domain: `Some(Some(bytes+type))`, `Some(None)` when
    /// the domain has none, `None` when not cached or older than `max_age_ms`.
    pub fn avatar_cached(
        &self,
        domain: &str,
        now: i64,
        max_age_ms: i64,
    ) -> StoreResult<Option<Option<(String, Vec<u8>)>>> {
        let row: Option<(String, Option<Vec<u8>>, i64)> = self
            .r()
            .prepare_cached("SELECT kind, data, fetched_at_ms FROM avatars WHERE domain = ?1")?
            .query_row([domain], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()?;
        Ok(match row {
            Some((_, _, at)) if now - at > max_age_ms => None,
            Some((kind, Some(data), _)) if kind != "none" => Some(Some((kind, data))),
            Some(_) => Some(None),
            None => None,
        })
    }

    /// `kind` is the logo's content type, or `none`.
    pub fn avatar_put(&self, domain: &str, kind: &str, data: Option<&[u8]>, now: i64) -> StoreResult<()> {
        self.w().execute(
            "INSERT INTO avatars (domain, kind, data, fetched_at_ms) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(domain) DO UPDATE SET kind = ?2, data = ?3, fetched_at_ms = ?4",
            params![domain, kind, data, now],
        )?;
        Ok(())
    }
}

fn sort_rows(rows: &mut Vec<ThreadRow>) {
    rows.sort_by(|a, b| {
        b.last_date_ms
            .cmp(&a.last_date_ms)
            .then_with(|| b.thread_id.cmp(&a.thread_id))
    });
    rows.truncate(VIEW_CAP);
}

/// An ICS DATE or DATE-TIME as epoch ms: `Z` is UTC, a floating or TZID time
/// is read as local time (the card is a preview; Calendar owns the zone math).
pub fn ics_time_ms(v: &str) -> Option<i64> {
    let v = v.trim();
    if let Some(utc) = v.strip_suffix('Z') {
        let t = NaiveDateTime::parse_from_str(utc, "%Y%m%dT%H%M%S").ok()?;
        return Some(t.and_utc().timestamp_millis());
    }
    let t = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S")
        .ok()
        .or_else(|| NaiveDate::parse_from_str(v, "%Y%m%d").ok()?.and_hms_opt(0, 0, 0))?;
    chrono::Local
        .from_local_datetime(&t)
        .earliest()
        .map(|d| d.timestamp_millis())
}

/// The card's view of a parsed invite; None without a usable start.
pub fn invite_view(inv: &Invite, me: &[String]) -> Option<InviteView> {
    let start_ms = ics_time_ms(inv.dtstart.as_deref()?)?;
    let end_ms = inv
        .dtend
        .as_deref()
        .and_then(ics_time_ms)
        .filter(|e| *e >= start_ms)
        .unwrap_or(start_ms + if inv.all_day { 86_400_000 } else { 3_600_000 });
    let method = match inv.method.as_deref().map(str::to_ascii_uppercase) {
        _ if inv.cancelled => "CANCEL".to_string(),
        Some(m) if m == "REPLY" => m,
        _ => "REQUEST".to_string(),
    };
    let my_status = inv
        .attendees
        .iter()
        .find(|a| me.iter().any(|m| m.eq_ignore_ascii_case(&a.email)))
        .and_then(|a| a.partstat.clone())
        .map(|p| p.to_ascii_uppercase())
        .filter(|p| matches!(p.as_str(), "ACCEPTED" | "TENTATIVE" | "DECLINED"));
    Some(InviteView {
        uid: inv.uid.clone().unwrap_or_default(),
        method,
        summary: inv.summary.clone(),
        start_ms,
        end_ms,
        location: inv.location.clone(),
        organizer: inv.organizer.as_ref().map(|o| Address {
            name: o.name.clone().unwrap_or_default(),
            email: o.email.clone(),
        }),
        my_status,
        can_rsvp: inv.can_rsvp,
    })
}

// ---- Collapsed-message snippets (specs/mail-improve.md §4, AC17) ----

/// Greetings a message opens with, lower-case; a salutation is one of these, an
/// optional short name, then a comma, colon, exclamation mark or line end.
const GREETINGS: &[&str] = &[
    "good morning",
    "good afternoon",
    "good evening",
    "dzień dobry",
    "hello",
    "hallo",
    "hola",
    "cześć",
    "dear",
    "hey",
    "hi",
];

/// Sign-off lines ("Best,", "Thanks,") that end a message and carry no substance.
const SIGN_OFFS: &[&str] = &[
    "best",
    "best regards",
    "kind regards",
    "regards",
    "thanks",
    "thank you",
    "cheers",
    "pozdrawiam",
    "sent from my iphone",
];

const SNIPPET_CHARS: usize = 140;

/// Strips a leading salutation ("Hi Robin," / "Dear Ms Lee:") from one line and
/// returns what follows it; `None` when the line doesn't open with one.
fn after_salutation(line: &str) -> Option<&str> {
    let lower = line.to_lowercase();
    let greeting = GREETINGS.iter().find(|g| {
        lower.starts_with(*g)
            && lower[g.len()..]
                .chars()
                .next()
                .is_none_or(|c| !c.is_alphanumeric())
    })?;
    // The greeting's byte length is the same in `line` (lower-casing these keeps lengths).
    let rest = &line[greeting.len()..];
    match rest.find([',', ':', '!']) {
        // A name of at most four words between the greeting and the mark.
        Some(at) if rest[..at].split_whitespace().count() <= 4 => Some(rest[at + 1..].trim()),
        Some(_) => None,
        None if rest.split_whitespace().count() <= 3 => Some(""),
        None => None,
    }
}

fn is_sign_off(line: &str) -> bool {
    let bare = line.trim_end_matches([',', '.', '!']).trim().to_lowercase();
    SIGN_OFFS.contains(&bare.as_str())
}

/// The collapsed row's first line of substance, read from the message's text (or its
/// stored snippet): salutations and sign-offs skipped, quoted lines skipped,
/// whitespace collapsed; a message that is only a salutation falls back to the
/// subject. Applied at read time, so stored rows never change.
pub fn substance_snippet(text: Option<&str>, stored: &str, subject: &str) -> String {
    let source = text.filter(|t| !t.trim().is_empty()).unwrap_or(stored);
    let mut first = None;
    for raw in source.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('>') || is_sign_off(line) {
            continue;
        }
        let body = after_salutation(line).unwrap_or(line);
        if body.is_empty() {
            continue;
        }
        first = Some(body);
        break;
    }
    let Some(first) = first else {
        return subject.to_string();
    };
    let joined = first.split_whitespace().collect::<Vec<_>>().join(" ");
    joined.chars().take(SNIPPET_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::contracts::MailboxRole;
    use crate::mail::store::*;

    fn store(tag: &str) -> Store {
        let d = std::env::temp_dir().join(format!(
            "moduo-mail-reader-{tag}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = std::fs::remove_dir_all(&d);
        let s = Store::open(&d).unwrap();
        s.upsert_account(&AccountInput {
            id: "a1".into(),
            address: "me@x.test".into(),
            display_name: "Me".into(),
            provider: "imap".into(),
            hue: 1,
        })
        .unwrap();
        for (id, role) in [("inbox", MailboxRole::Inbox), ("sent", MailboxRole::Sent)] {
            s.upsert_mailbox(&MailboxInput {
                id: id.into(),
                account_id: "a1".into(),
                path: id.into(),
                name: id.into(),
                role,
                delimiter: Some("/".into()),
                live: true,
            })
            .unwrap();
        }
        s
    }

    fn msg(ext: &str, mailbox: &str, thread: &str, from: &str, date: i64) -> MessageInput {
        MessageInput {
            classify: None,
            account_id: "a1".into(),
            ext_id: ext.into(),
            mailbox_id: mailbox.into(),
            uid: date,
            modseq: None,
            message_id: Some(format!("<{ext}@x>")),
            in_reply_to: None,
            references: vec![],
            thread_id: thread.into(),
            from: Address {
                name: String::new(),
                email: from.into(),
            },
            to: vec![],
            cc: vec![],
            subject: format!("S {ext}"),
            snippet: String::new(),
            date_ms: date,
            flags: 0,
            size: 10,
            list_unsubscribe: Some("<https://u.test/x>".into()),
            list_unsubscribe_post: Some("List-Unsubscribe=One-Click".into()),
            precedence: None,
            auto_submitted: None,
            has_invite: false,
            tab: Some(TabRef::of(TabKind::Personal)),
            priority: false,
            attachments: vec![AttachmentInput {
                part_id: "2".into(),
                filename: "invite.ics".into(),
                mime: "text/calendar".into(),
                size: 100,
                is_inline: false,
                content_id: None,
            }],
        }
    }

    #[test]
    fn followups_show_when_due_and_clear_on_counterpart_reply() {
        let s = store("fu");
        s.ingest(&[msg("m1", "sent", "t1", "me@x.test", 1_000)]).unwrap();
        s.set_follow_up("t1", Some(5_000), 2_000).unwrap();
        assert!(s.followup_rows(4_000).unwrap().is_empty(), "not due yet");
        assert_eq!(s.followup_rows(6_000).unwrap()[0].thread_id, "t1");
        // a self-reply never clears it
        s.ingest(&[msg("m2", "sent", "t1", "ME@x.test", 3_000)]).unwrap();
        assert_eq!(s.followup_rows(6_000).unwrap().len(), 1);
        // the counterpart replies: gone, and stays gone
        s.ingest(&[msg("m3", "inbox", "t1", "anna@y.test", 4_000)]).unwrap();
        assert!(s.followup_rows(6_000).unwrap().is_empty());
        assert!(s.follow_up("t1").unwrap().is_none());
        // clearing by hand
        s.set_follow_up("t1", Some(1), 9_000).unwrap();
        s.set_follow_up("t1", None, 9_000).unwrap();
        assert!(s.followup_rows(99_000).unwrap().is_empty());
    }

    #[test]
    fn new_senders_list_held_inbox_threads_until_released() {
        let s = store("ns");
        s.ingest(&[
            msg("m1", "inbox", "t1", "new@y.test", 1),
            msg("m2", "inbox", "t2", "new2@y.test", 2),
            msg("m3", "sent", "t3", "me@x.test", 3),
        ])
        .unwrap();
        s.set_screened(&["t1".into(), "t2".into(), "t3".into()], true).unwrap();
        let ids: Vec<_> = s.new_sender_rows().unwrap().into_iter().map(|r| r.thread_id).collect();
        assert_eq!(ids, vec!["t2", "t1"], "inbox only, newest first");
        s.set_screened(&["t2".into()], false).unwrap();
        assert_eq!(s.new_sender_rows().unwrap().len(), 1);
    }

    #[test]
    fn outbox_rows_come_from_pending_sends() {
        let s = store("ob");
        assert!(s.outbox_rows().unwrap().is_empty());
        let doc = DraftDoc {
            from_addr: "me@x.test".into(),
            to: vec!["b@y.test".into()],
            subject: "Hello".into(),
            text: "Body  text".into(),
            ..DraftDoc::default()
        };
        let id = s.save_draft_at(None, "a1", None, doc, 1_000).unwrap();
        let h = s.queue_send_at(&id, 5, 1_000).unwrap();
        let rows = s.outbox_rows().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].subject, "Hello");
        assert_eq!(rows[0].snippet, "Body text");
        assert_eq!(rows[0].thread_id, format!("outbox:{}", h.outbox_id));
        assert_eq!(rows[0].senders[0].email, "b@y.test");
        s.undo_send(&h.outbox_id).unwrap();
        assert!(s.outbox_rows().unwrap().is_empty());
    }

    #[test]
    fn message_and_attachment_refs_stay_inside_their_thread() {
        let s = store("ref");
        s.ingest(&[msg("m1", "inbox", "t1", "a@y.test", 1), msg("m2", "inbox", "t2", "a@y.test", 2)])
            .unwrap();
        let r = s.message_ref("t1", "m1").unwrap().unwrap();
        assert_eq!(r.account_id, "a1");
        assert_eq!(r.list_unsubscribe_post.as_deref(), Some("List-Unsubscribe=One-Click"));
        assert!(s.message_ref("t2", "m1").unwrap().is_none());
        let att = s.invite_attachment(r.row_id).unwrap().unwrap();
        assert!(s.thread_attachment("t1", att).unwrap().is_some());
        assert!(s.thread_attachment("t2", att).unwrap().is_none());
        assert_eq!(s.mailbox_account("inbox").unwrap().as_deref(), Some("a1"));
        assert_eq!(s.thread_account("t2").unwrap().as_deref(), Some("a1"));
        assert!(s.thread_needs_bodies("t1").unwrap());
    }

    #[test]
    fn avatar_cache_expires() {
        let s = store("av");
        assert!(s.avatar_cached("acme.io", 0, 10).unwrap().is_none());
        s.avatar_put("acme.io", "image/png", Some(b"png"), 100).unwrap();
        assert_eq!(
            s.avatar_cached("acme.io", 105, 10).unwrap(),
            Some(Some(("image/png".into(), b"png".to_vec())))
        );
        assert!(s.avatar_cached("acme.io", 200, 10).unwrap().is_none());
        s.avatar_put("none.io", "none", None, 100).unwrap();
        assert_eq!(s.avatar_cached("none.io", 101, 10).unwrap(), Some(None));
    }

    #[test]
    fn invite_view_maps_times_and_status() {
        let ics = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:Sync\r\nDTSTART:20261105T100000Z\r\nDTEND:20261105T110000Z\r\nORGANIZER;CN=Anna:mailto:anna@y.test\r\nATTENDEE;PARTSTAT=ACCEPTED:mailto:me@x.test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let inv = crate::mail::invite::parse_invite(ics).unwrap();
        let v = invite_view(&inv, &["ME@x.test".into()]).unwrap();
        assert_eq!(v.uid, "u1");
        assert_eq!(v.method, "REQUEST");
        assert_eq!(v.end_ms - v.start_ms, 3_600_000);
        assert_eq!(v.start_ms, 1_793_872_800_000);
        assert_eq!(v.my_status.as_deref(), Some("ACCEPTED"));
        assert_eq!(v.organizer.unwrap().email, "anna@y.test");
        assert!(v.can_rsvp);
        assert!(ics_time_ms("20261105").is_some());
        assert!(ics_time_ms("junk").is_none());
    }

    #[test]
    fn snippet_skips_salutations() {
        let text =
            "Hi Robin,\n\nFollowing up on today's call.  Can we\nlock the dates?\n\nBest,\nJonas";
        assert_eq!(
            substance_snippet(Some(text), "Hi Robin, Following up", "Pilot"),
            "Following up on today's call. Can we"
        );
        // Inline: the greeting and the name go, the sentence stays.
        assert_eq!(
            substance_snippet(None, "Hi Robin, following up on the deck", "Deck"),
            "following up on the deck"
        );
        for (greeting, want) in [
            (
                "Dear Ms Lee:\nThe contract is attached.",
                "The contract is attached.",
            ),
            (
                "Good morning team!\nStandup moves to 10.",
                "Standup moves to 10.",
            ),
            ("Cześć Kasia,\nDzięki za plik.", "Dzięki za plik."),
            ("Hello\n\nQuick one.", "Quick one."),
            (
                "Hiring update: three offers out.",
                "Hiring update: three offers out.",
            ),
            ("> quoted\nReal line", "Real line"),
        ] {
            assert_eq!(
                substance_snippet(Some(greeting), "", "S"),
                want,
                "{greeting}"
            );
        }
        // A long clause after "Hi" isn't a salutation.
        assert_eq!(
            substance_snippet(Some("Hi there is a problem with the build, again"), "", "S"),
            "Hi there is a problem with the build, again"
        );
        // Only a salutation (and a sign-off): the subject.
        assert_eq!(
            substance_snippet(Some("Hi Robin,\n\nThanks,\n"), "", "Pilot"),
            "Pilot"
        );
        assert_eq!(substance_snippet(Some("  "), "", "Pilot"), "Pilot");
        // Capped at 140 characters.
        let long = "word ".repeat(80);
        assert_eq!(substance_snippet(Some(&long), "", "S").chars().count(), 140);
    }
}
