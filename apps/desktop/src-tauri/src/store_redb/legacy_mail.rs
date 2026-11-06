//! The legacy mail engine's redb tables, kept only so the MR-16 cutover
//! (`crate::mail::migrate`) can read the accounts out and then drop them.
//! Nothing new may write here (redb is paused; mail lives in SQLite).

use redb::{ReadableTable, TableDefinition, TableHandle};

use super::RedbStore;

pub const EMAIL_ACCOUNTS_V2: TableDefinition<&str, &str> =
    TableDefinition::new("email_accounts_v2");
const EMAIL_FOLDER_STATE: TableDefinition<&str, &str> = TableDefinition::new("email_folder_state");
const EMAIL_ENVELOPES: TableDefinition<&str, &str> = TableDefinition::new("email_envelopes");
const EMAIL_ENVELOPE_ORDER: TableDefinition<&str, &str> =
    TableDefinition::new("email_envelope_order");
const EMAIL_BODIES: TableDefinition<&str, &str> = TableDefinition::new("email_bodies");
const EMAIL_BODY_LRU: TableDefinition<&str, &str> = TableDefinition::new("email_body_lru");
const EMAIL_BODY_TEXT: TableDefinition<&str, &str> = TableDefinition::new("email_body_text");
const EMAIL_FLAG_OUTBOX: TableDefinition<&str, &str> = TableDefinition::new("email_flag_outbox");
const EMAIL_OP_OUTBOX: TableDefinition<&str, &str> = TableDefinition::new("email_op_outbox");
const EMAIL_UI_STATE: TableDefinition<&str, &str> = TableDefinition::new("email_ui_state");

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
    /// The legacy account rows the cutover reads (empty when the table is gone).
    pub fn list_email_accounts_v2(&self) -> anyhow::Result<Vec<serde_json::Value>> {
        let read_txn = self.db.begin_read()?;
        let table = match read_txn.open_table(EMAIL_ACCOUNTS_V2) {
            Ok(t) => t,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(vec![]),
            Err(e) => return Err(e.into()),
        };
        let mut out = vec![];
        for row in table.iter()? {
            let (_, v) = row?;
            out.push(serde_json::from_str(v.value())?);
        }
        Ok(out)
    }

    /// Test seam: creates every legacy table, as a pre-cutover redb file has them
    /// (`ensure_schema` no longer does).
    #[cfg(test)]
    pub fn create_legacy_email_tables(&self) -> anyhow::Result<()> {
        let write_txn = self.db.begin_write()?;
        for def in LEGACY_EMAIL_TABLES {
            let _ = write_txn.open_table(def)?;
        }
        write_txn.commit()?;
        Ok(())
    }

    /// Test seam: writes a legacy account row as the old engine did.
    #[cfg(test)]
    pub fn put_email_account_v2(&self, key: &str, value: &serde_json::Value) -> anyhow::Result<()> {
        self.put_json(EMAIL_ACCOUNTS_V2, key, value)
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreadable_legacy_account_is_an_error_not_empty() {
        let dir = std::env::temp_dir().join(format!("moduo-legacy-mail-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let store = RedbStore::open(&dir.join("legacy.redb")).unwrap();
        assert!(store.list_email_accounts_v2().unwrap().is_empty());
        let write_txn = store.db.begin_write().unwrap();
        {
            let mut table = write_txn.open_table(EMAIL_ACCOUNTS_V2).unwrap();
            table.insert("gmail:me@x.test", "{not json").unwrap();
        }
        write_txn.commit().unwrap();
        // The cutover drops this table next: a row it can't read must stop it,
        // never read as "no accounts" and be deleted for good.
        assert!(store.list_email_accounts_v2().is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
