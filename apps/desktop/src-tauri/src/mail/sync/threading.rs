//! Threading at ingest (decision 7). A message joins the thread of any message it
//! names (its own Message-ID, In-Reply-To or References) already in the batch or
//! the store; otherwise its thread id is derived from the root of its References
//! chain, so a parent that arrives after its replies (newest-first backfill)
//! lands in the same thread without a lookup. Messages without references fall
//! back to the normalized subject, only for reply/forward subjects whose
//! participants overlap within 14 days. Threads are per account.
//!
//! async-imap 0.12 exposes no X-GM-THRID accessor, so Gmail threads the same way
//! (recorded in docs/decisions/email.md, MR-3).

use std::collections::HashMap;

use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

use super::headers::{normalize_subject, ParsedHeader};
use crate::mail::store::{Store, StoreResult};

pub const SUBJECT_WINDOW_MS: i64 = 14 * 24 * 3600 * 1000;

pub fn thread_id_for_root(account_id: &str, root: &str) -> String {
    let h = Sha256::digest(format!("{account_id}\0{root}").as_bytes());
    let hex: String = h.iter().take(10).map(|b| format!("{b:02x}")).collect();
    format!("t{hex}")
}

fn candidates(h: &ParsedHeader) -> Vec<String> {
    let mut v = Vec::new();
    if let Some(m) = &h.message_id {
        v.push(m.clone());
    }
    if let Some(i) = &h.in_reply_to {
        v.push(i.clone());
    }
    for r in &h.references {
        if !v.contains(r) {
            v.push(r.clone());
        }
    }
    v
}

fn root_of(h: &ParsedHeader, ext_id: &str) -> String {
    h.references
        .first()
        .or(h.in_reply_to.as_ref())
        .or(h.message_id.as_ref())
        .cloned()
        .unwrap_or_else(|| format!("ext:{ext_id}"))
}

fn is_reply_subject(s: &str) -> bool {
    let n = normalize_subject(s);
    !n.is_empty()
        && n != s
            .trim()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
}

/// Assigns thread ids to one batch, in place of a per-message lookup storm:
/// one indexed query per referenced id that the batch itself can't answer.
pub struct Threader<'a> {
    store: &'a Store,
    account_id: String,
    batch: HashMap<String, String>,
}

impl<'a> Threader<'a> {
    pub fn new(store: &'a Store, account_id: &str) -> Self {
        Self {
            store,
            account_id: account_id.to_string(),
            batch: HashMap::new(),
        }
    }

    fn stored_thread(&self, message_id: &str) -> StoreResult<Option<String>> {
        Ok(self
            .store
            .r()
            .prepare_cached(
                "SELECT thread_id FROM messages WHERE account_id = ?1 AND message_id = ?2
                 ORDER BY date_ms LIMIT 1",
            )?
            .query_row(params![self.account_id, message_id], |r| r.get(0))
            .optional()?)
    }

    fn subject_thread(&self, h: &ParsedHeader, date_ms: i64) -> StoreResult<Option<String>> {
        if !is_reply_subject(&h.subject) {
            return Ok(None);
        }
        let core = normalize_subject(&h.subject);
        let mut me: Vec<String> = h.to.iter().chain(&h.cc).map(|a| a.email.clone()).collect();
        me.push(h.from.email.clone());
        let conn = self.store.r();
        let mut st = conn.prepare_cached(
            "SELECT thread_id, subject, from_email, to_json, cc_json FROM messages
             WHERE account_id = ?1 AND date_ms BETWEEN ?2 AND ?3 AND subject LIKE ?4
             ORDER BY date_ms DESC LIMIT 50",
        )?;
        let like = format!("%{}%", core.replace(['%', '_'], ""));
        let rows = st.query_map(
            params![
                self.account_id,
                date_ms - SUBJECT_WINDOW_MS,
                date_ms + SUBJECT_WINDOW_MS,
                like
            ],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            },
        )?;
        for row in rows {
            let (thread, subject, from, to, cc) = row?;
            if normalize_subject(&subject) != core {
                continue;
            }
            let overlap = me.iter().any(|e| {
                !e.is_empty() && (*e == from || to.contains(e.as_str()) || cc.contains(e.as_str()))
            });
            if overlap {
                return Ok(Some(thread));
            }
        }
        Ok(None)
    }

    /// The thread for one message; call in ascending date order within a batch.
    pub fn assign(&mut self, ext_id: &str, h: &ParsedHeader, date_ms: i64) -> StoreResult<String> {
        let cands = candidates(h);
        let mut found = cands.iter().find_map(|c| self.batch.get(c).cloned());
        if found.is_none() {
            for c in &cands {
                if let Some(t) = self.stored_thread(c)? {
                    found = Some(t);
                    break;
                }
            }
        }
        if found.is_none() && h.in_reply_to.is_none() && h.references.is_empty() {
            found = self.subject_thread(h, date_ms)?;
        }
        let thread =
            found.unwrap_or_else(|| thread_id_for_root(&self.account_id, &root_of(h, ext_id)));
        for c in cands {
            self.batch.entry(c).or_insert_with(|| thread.clone());
        }
        Ok(thread)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::store::Address;

    fn h(id: &str, irt: Option<&str>, refs: &[&str], subject: &str) -> ParsedHeader {
        ParsedHeader {
            message_id: Some(id.into()),
            in_reply_to: irt.map(Into::into),
            references: refs.iter().map(|s| s.to_string()).collect(),
            subject: subject.into(),
            from: Address {
                name: "".into(),
                email: "ann@x.test".into(),
            },
            to: vec![Address {
                name: "".into(),
                email: "me@y.test".into(),
            }],
            ..Default::default()
        }
    }

    #[test]
    fn reply_before_parent_shares_thread() {
        let s = crate::mail::sync::testing::store("thr1");
        let mut t = Threader::new(&s, "a1");
        let reply = t
            .assign("2", &h("b", Some("a"), &["a"], "Re: x"), 2)
            .unwrap();
        let mut t2 = Threader::new(&s, "a1");
        let parent = t2.assign("1", &h("a", None, &[], "x"), 1).unwrap();
        assert_eq!(reply, parent);
        let other = t2.assign("3", &h("c", None, &[], "y"), 3).unwrap();
        assert_ne!(other, parent);
        assert_ne!(
            thread_id_for_root("a1", "a"),
            thread_id_for_root("a2", "a"),
            "per account"
        );
    }

    #[test]
    fn subject_fallback_only_for_replies_with_overlap() {
        let s = crate::mail::sync::testing::store("thr2");
        crate::mail::sync::testing::put(&s, "inbox", 1, "orig@x", "tORIG", "Lunch", 1_000);
        let mut t = Threader::new(&s, "a1");
        let mut r = h("r1", None, &[], "Re: Lunch");
        assert_eq!(t.assign("r1", &r, 2_000).unwrap(), "tORIG");
        r.message_id = Some("r2".into());
        r.subject = "Lunch".into();
        let mut t = Threader::new(&s, "a1");
        assert_ne!(
            t.assign("r2", &r, 2_000).unwrap(),
            "tORIG",
            "not a reply subject"
        );
        let mut far = h("r3", None, &[], "Re: Lunch");
        far.from.email = "z@z".into();
        far.to = vec![];
        assert_ne!(
            t.assign("r3", &far, 2_000).unwrap(),
            "tORIG",
            "no shared participant"
        );
    }
}
