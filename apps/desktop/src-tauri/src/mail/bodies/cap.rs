//! Disk cap and LRU eviction (decision 8, edge case "Disk cap reached").
//!
//! Bodies and attachment files are evicted least-recently-opened first until
//! the account is under its cap. Headers and the FTS index are never evicted:
//! an evicted body keeps its indexed text (the FTS table is contentless), so
//! search still finds it until "Clear all downloaded mail", which reindexes
//! without bodies.

use rusqlite::params;

use crate::mail::contracts::BodyState;
use crate::mail::store::{write::reindex, Store, StoreResult};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Evicted {
    pub bodies: usize,
    pub attachments: usize,
    pub bytes: i64,
}

impl Store {
    /// Bytes this account holds on disk: (bodies, attachments).
    pub fn account_usage(&self, account_id: &str) -> StoreResult<(i64, i64)> {
        Ok(self.r().query_row(
            "SELECT
               (SELECT COALESCE(SUM(b.bytes), 0) FROM bodies b JOIN messages m ON m.id = b.message_id WHERE m.account_id = ?1),
               (SELECT COALESCE(SUM(t.stored_bytes), 0) FROM attachments t JOIN messages m ON m.id = t.message_id WHERE m.account_id = ?1)",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?)
    }

    pub fn set_disk_cap(&self, account_id: &str, bytes: i64) -> StoreResult<()> {
        self.w().execute(
            "UPDATE accounts SET disk_cap_bytes = ?2 WHERE id = ?1",
            params![account_id, bytes.max(0)],
        )?;
        Ok(())
    }

    /// Evicts LRU bodies and attachments until the account fits its cap.
    pub fn enforce_disk_cap(&self, account_id: &str) -> StoreResult<Evicted> {
        let cap: i64 = self.r().query_row(
            "SELECT disk_cap_bytes FROM accounts WHERE id = ?1",
            [account_id],
            |r| r.get(0),
        )?;
        let (b, a) = self.account_usage(account_id)?;
        let mut over = b + a - cap;
        let mut out = Evicted::default();
        if over <= 0 {
            return Ok(out);
        }
        // (kind, id, bytes) oldest first; kind 0 = body (message id), 1 = attachment id.
        let victims: Vec<(i64, i64, i64)> = {
            let conn = self.r();
            let mut s = conn.prepare_cached(
                "SELECT 0, b.message_id, b.bytes, b.last_access_ms FROM bodies b
                   JOIN messages m ON m.id = b.message_id WHERE m.account_id = ?1
                 UNION ALL
                 SELECT 1, t.id, t.stored_bytes, COALESCE(t.last_access_ms, 0) FROM attachments t
                   JOIN messages m ON m.id = t.message_id
                   WHERE m.account_id = ?1 AND t.blob_hash IS NOT NULL
                 ORDER BY 4 ASC, 2 ASC",
            )?;
            let rows = s.query_map([account_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            let mut v = Vec::new();
            for row in rows {
                let row: (i64, i64, i64) = row?;
                if over <= 0 {
                    break;
                }
                over -= row.2;
                v.push(row);
            }
            v
        };
        let mut atts = Vec::new();
        {
            let mut conn = self.w();
            let tx = conn.transaction()?;
            for (kind, id, bytes) in &victims {
                if *kind == 0 {
                    tx.execute("DELETE FROM bodies WHERE message_id = ?1", [id])?;
                    tx.execute(
                        "UPDATE messages SET body_state = ?2 WHERE id = ?1",
                        params![id, BodyState::Evicted.as_str()],
                    )?;
                    out.bodies += 1;
                } else {
                    atts.push(*id);
                }
                out.bytes += bytes;
            }
            tx.commit()?;
        }
        out.attachments = atts.len();
        self.drop_attachment_files(account_id, &atts)?;
        Ok(out)
    }

    /// Settings → "Clear attachments": every downloaded attachment of the account.
    pub fn clear_attachments(&self, account_id: &str) -> StoreResult<usize> {
        let ids: Vec<i64> = {
            let conn = self.r();
            let mut s = conn.prepare(
                "SELECT t.id FROM attachments t JOIN messages m ON m.id = t.message_id
                 WHERE m.account_id = ?1 AND t.blob_hash IS NOT NULL",
            )?;
            let v = s
                .query_map([account_id], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            v
        };
        self.drop_attachment_files(account_id, &ids)?;
        Ok(ids.len())
    }

    /// Settings → "Clear all downloaded mail": bodies, attachments and the
    /// indexed body text. Headers, subjects and attachment names stay searchable.
    pub fn clear_downloaded(&self, account_id: &str) -> StoreResult<usize> {
        self.clear_attachments(account_id)?;
        let mut conn = self.w();
        let tx = conn.transaction()?;
        let ids: Vec<i64> = {
            let mut s = tx.prepare(
                "SELECT b.message_id FROM bodies b JOIN messages m ON m.id = b.message_id
                 WHERE m.account_id = ?1
                 UNION SELECT id FROM messages WHERE account_id = ?1 AND body_state = 'evicted'",
            )?;
            let v = s
                .query_map([account_id], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            v
        };
        for id in &ids {
            tx.execute("DELETE FROM bodies WHERE message_id = ?1", [id])?;
            tx.execute(
                "UPDATE messages SET body_state = 'none' WHERE id = ?1",
                [id],
            )?;
            reindex(&tx, *id, None)?;
        }
        tx.commit()?;
        Ok(ids.len())
    }

    /// Unlinks attachment rows from their blobs and deletes blobs no row uses.
    fn drop_attachment_files(&self, account_id: &str, ids: &[i64]) -> StoreResult<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut hashes = Vec::new();
        {
            let mut conn = self.w();
            let tx = conn.transaction()?;
            for id in ids {
                let h: Option<String> = tx.query_row(
                    "SELECT blob_hash FROM attachments WHERE id = ?1",
                    [id],
                    |r| r.get(0),
                )?;
                tx.execute(
                    "UPDATE attachments SET blob_hash = NULL, stored_bytes = 0 WHERE id = ?1",
                    [id],
                )?;
                if let Some(h) = h {
                    hashes.push(h);
                }
            }
            tx.commit()?;
        }
        hashes.sort();
        hashes.dedup();
        let dir = self.files_dir(account_id);
        for h in hashes {
            let still_used: bool = self.r().query_row(
                "SELECT EXISTS (SELECT 1 FROM attachments t JOIN messages m ON m.id = t.message_id
                   WHERE m.account_id = ?1 AND t.blob_hash = ?2)",
                params![account_id, h],
                |r| r.get(0),
            )?;
            if !still_used {
                match std::fs::remove_file(dir.join(&h)) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
        }
        Ok(())
    }
}
