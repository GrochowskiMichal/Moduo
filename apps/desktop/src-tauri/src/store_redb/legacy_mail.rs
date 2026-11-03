//! The legacy mail engine's redb tables, kept only so the MR-16 cutover
//! (`crate::mail::migrate`) can read the accounts out and then drop them.
//! Nothing new may write here (redb is paused; mail lives in SQLite).

use redb::{TableDefinition, TableHandle};

use super::{
    RedbStore, EMAIL_ACCOUNTS_V2, EMAIL_BODIES, EMAIL_BODY_LRU, EMAIL_BODY_TEXT,
    EMAIL_ENVELOPES, EMAIL_ENVELOPE_ORDER, EMAIL_FLAG_OUTBOX, EMAIL_FOLDER_STATE,
    EMAIL_OP_OUTBOX, EMAIL_UI_STATE,
};

/// Every redb table the legacy mail engine owned.
pub const LEGACY_EMAIL_TABLES: [TableDefinition<&str, &str>; 10] = [
    EMAIL_ACCOUNTS_V2,
    EMAIL_FOLDER_STATE,
    EMAIL_ENVELOPES,
    EMAIL_ENVELOPE_ORDER,
    EMAIL_BODIES,
    EMAIL_BODY_LRU,
    EMAIL_BODY_TEXT,
    EMAIL_FLAG_OUTBOX,
    EMAIL_OP_OUTBOX,
    EMAIL_UI_STATE,
];

impl RedbStore {
    /// Names of the tables that exist in the file right now.
    pub fn table_names(&self) -> anyhow::Result<Vec<String>> {
        let read_txn = self.db.begin_read()?;
        let names = read_txn
            .list_tables()?
            .map(|t| t.name().to_string())
            .collect();
        Ok(names)
    }

    /// Deletes every legacy mail table in one transaction; returns how many
    /// existed. Idempotent: a second call deletes nothing.
    pub fn drop_legacy_email_tables(&self) -> anyhow::Result<usize> {
        let _lock = self
            .write_guard
            .lock()
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
        let write_txn = self.db.begin_write()?;
        let mut dropped = 0;
        for def in LEGACY_EMAIL_TABLES {
            if write_txn.delete_table(def)? {
                dropped += 1;
            }
        }
        write_txn.commit()?;
        Ok(dropped)
    }
}
