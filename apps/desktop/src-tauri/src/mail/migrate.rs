//! First-launch cutover from the legacy redb mail engine (MR-16, AC39,
//! specs/mail-rebuild.md decision 24).
//!
//! 1. Accounts are read from the legacy redb blob (`NOTES_META` key
//!    `email:accounts_v1`, plus `email_accounts_v2` rows) into SQLite.
//! 2. Keychain secrets are reused as they are: the account id is carried over
//!    verbatim, so `auth::keychain_account(user, id)` names the same entry the
//!    legacy engine wrote (no re-login).
//! 3. The redb mail tables are deleted.
//!
//! The legacy JSON is read loosely (`serde_json::Value`) so this module never
//! depends on the old engine's types and survives its deletion. A done marker in
//! the SQLite `kv` table makes the run idempotent.

use serde_json::Value;

use super::accounts::{default_endpoints, Endpoint2, MailAccount};
use super::contracts::Provider;
use super::store::{AccountInput, Store, StoreResult};
use crate::store_redb::RedbStore;
use redb::TableHandle;

pub const DONE_KEY: &str = "legacy_migration_v1";
const LEGACY_NAMESPACE: &str = "email";
const LEGACY_ACCOUNTS_KEY: &str = "accounts_v1";

/// One account recovered from the legacy store.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LegacyAccount {
    pub account: MailAccount,
    pub history_depth_days: Option<i64>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct MigrationReport {
    pub accounts: usize,
    pub tables_dropped: usize,
    pub skipped: Vec<String>,
    pub already_done: bool,
}

fn provider_of(raw: &str) -> Option<Provider> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "custom" | "imap" => Some(Provider::Imap),
        other => Provider::parse(other),
    }
}

fn depth_days(raw: Option<&str>) -> Option<i64> {
    match raw.unwrap_or("twelveMonths") {
        "threeMonths" => Some(90),
        "sixMonths" => Some(180),
        "everything" => None,
        _ => Some(365),
    }
}

fn str_field<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str).filter(|s| !s.trim().is_empty())
}

fn port_field(v: &Value, k: &str) -> Option<u16> {
    v.get(k)
        .and_then(Value::as_u64)
        .and_then(|p| u16::try_from(p).ok())
}

/// Parses one legacy row (either shape); `Err` names why it was skipped.
pub fn parse_legacy(row: &Value) -> Result<LegacyAccount, String> {
    let id = str_field(row, "id").ok_or("missing id")?;
    let email = str_field(row, "email").ok_or_else(|| format!("{id}: missing email"))?;
    let raw_provider = str_field(row, "provider").unwrap_or("custom");
    let provider =
        provider_of(raw_provider).ok_or_else(|| format!("{id}: unknown provider {raw_provider}"))?;
    let defaults = default_endpoints(provider);
    let endpoint = |host: &str, port: &str, fallback: u16, default: Option<&Endpoint2>| {
        match (str_field(row, host), default) {
            (Some(h), d) => Some(Endpoint2 {
                host: h.trim().to_string(),
                port: port_field(row, port)
                    .or(d.map(|d| d.port))
                    .unwrap_or(fallback),
            }),
            (None, Some(d)) => Some(d.clone()),
            (None, None) => None,
        }
    };
    let imap = endpoint("imapHost", "imapPort", 993, defaults.as_ref().map(|d| &d.0))
        .ok_or_else(|| format!("{id}: missing IMAP host"))?;
    let smtp = endpoint("smtpHost", "smtpPort", 465, defaults.as_ref().map(|d| &d.1))
        .ok_or_else(|| format!("{id}: missing SMTP host"))?;
    Ok(LegacyAccount {
        account: MailAccount {
            // Verbatim: the keychain entry is keyed by this id.
            id: id.to_string(),
            provider,
            email: email.trim().to_lowercase(),
            imap,
            smtp,
        },
        history_depth_days: depth_days(str_field(row, "historyDepth")),
    })
}

/// Every legacy account, de-duplicated by id (`accounts_v1` wins over v2).
pub fn read_legacy(redb: &RedbStore) -> anyhow::Result<(Vec<LegacyAccount>, Vec<String>)> {
    let mut rows: Vec<Value> = match redb.kv_get(LEGACY_NAMESPACE, LEGACY_ACCOUNTS_KEY)? {
        Some(Value::Array(a)) => a,
        _ => vec![],
    };
    // A file from before the v2 table existed has none: not an error. Any other
    // read failure aborts the cutover, because the tables are dropped next and a
    // swallowed error would lose those accounts for good.
    let v2_exists = redb
        .table_names()?
        .iter()
        .any(|t| t == crate::store_redb::LEGACY_EMAIL_TABLES[0].name());
    if v2_exists {
        rows.extend(redb.list_email_accounts_v2()?);
    }
    let mut out: Vec<LegacyAccount> = vec![];
    let mut skipped = vec![];
    for row in &rows {
        match parse_legacy(row) {
            Ok(a) if out.iter().any(|o| o.account.id == a.account.id) => {}
            Ok(a) => out.push(a),
            Err(e) => skipped.push(e),
        }
    }
    Ok((out, skipped))
}

pub fn endpoints_key(account_id: &str) -> String {
    format!("account_endpoints:{account_id}")
}

fn write_account(store: &Store, a: &LegacyAccount) -> StoreResult<()> {
    store.upsert_account(&AccountInput {
        id: a.account.id.clone(),
        address: a.account.email.clone(),
        display_name: String::new(),
        provider: a.account.provider.as_str().to_string(),
        hue: 0,
    })?;
    store.w().execute(
        "UPDATE accounts SET history_depth_days = ?2, sync_state = 'first_sync' WHERE id = ?1",
        rusqlite::params![a.account.id, a.history_depth_days],
    )?;
    let endpoints = serde_json::to_string(&a.account)
        .map_err(|e| super::store::StoreError::Invalid(e.to_string()))?;
    store.kv_set(&endpoints_key(&a.account.id), &endpoints)
}

/// Runs the cutover once. Accounts are written before the tables are dropped,
/// so a crash in between re-runs safely (the done marker is set last).
pub fn run(redb: &RedbStore, store: &Store) -> anyhow::Result<MigrationReport> {
    if store.kv_get(DONE_KEY).map_err(anyhow_store)?.is_some() {
        return Ok(MigrationReport {
            already_done: true,
            ..Default::default()
        });
    }
    let (accounts, skipped) = read_legacy(redb)?;
    for a in &accounts {
        write_account(store, a).map_err(anyhow_store)?;
    }
    let tables_dropped = redb.drop_legacy_email_tables()?;
    redb.kv_remove(LEGACY_NAMESPACE, LEGACY_ACCOUNTS_KEY)?;
    store.kv_set(DONE_KEY, "1").map_err(anyhow_store)?;
    Ok(MigrationReport {
        accounts: accounts.len(),
        tables_dropped,
        skipped,
        already_done: false,
    })
}

fn anyhow_store(e: super::store::StoreError) -> anyhow::Error {
    anyhow::anyhow!(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::auth::keychain_account;
    use crate::store_redb::LEGACY_EMAIL_TABLES;
    use serde_json::json;

    fn fixtures(tag: &str) -> (RedbStore, Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "moduo-mail-migrate-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let redb = RedbStore::open(&dir.join("legacy.redb")).unwrap();
        let store = Store::open(&dir.join("mail")).unwrap();
        (redb, store, dir)
    }

    fn seed(redb: &RedbStore) {
        redb.create_legacy_email_tables().unwrap();
        redb.kv_set(
            "email",
            "accounts_v1",
            &json!([
                { "id": "gmail:me@x.test", "provider": "gmail", "email": "Me@x.test",
                  "status": "connected", "historyDepth": "sixMonths" },
                { "id": "custom:me@corp.test:imap.corp.test", "provider": "custom",
                  "email": "me@corp.test", "imapHost": "imap.corp.test", "imapPort": 1993,
                  "smtpHost": "smtp.corp.test", "smtpPort": 2465, "status": "connected" },
                { "id": "bad", "provider": "carrier-pigeon", "email": "a@b.test" }
            ]),
        )
        .unwrap();
        redb.put_email_account_v2(
            "outlook:o@x.test",
            &json!({ "id": "outlook:o@x.test", "workspaceId": "w", "provider": "outlook",
                     "email": "o@x.test", "status": "connected" }),
        )
        .unwrap();
        redb.put_email_account_v2(
            "gmail:me@x.test",
            &json!({ "id": "gmail:me@x.test", "provider": "gmail", "email": "me@x.test" }),
        )
        .unwrap();
    }

    fn ids(store: &Store) -> Vec<String> {
        store
            .storage_stats()
            .unwrap()
            .into_iter()
            .map(|s| s.account_id)
            .collect()
    }

    #[test]
    fn legacy_accounts_carry_over() {
        let (redb, store, dir) = fixtures("carry");
        seed(&redb);
        let report = run(&redb, &store).unwrap();
        assert_eq!(report.accounts, 3);
        assert_eq!(report.skipped.len(), 1, "unknown provider is skipped, not fatal");
        assert_eq!(
            ids(&store),
            vec![
                "custom:me@corp.test:imap.corp.test",
                "gmail:me@x.test",
                "outlook:o@x.test"
            ]
        );
        // Custom endpoints survive; known providers get their defaults.
        let custom: MailAccount = serde_json::from_str(
            &store
                .kv_get(&endpoints_key("custom:me@corp.test:imap.corp.test"))
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(custom.provider, Provider::Imap);
        assert_eq!(custom.imap.host, "imap.corp.test");
        assert_eq!(custom.imap.port, 1993);
        assert_eq!(custom.smtp.port, 2465);
        let depth: Option<i64> = store
            .r()
            .query_row(
                "SELECT history_depth_days FROM accounts WHERE id = 'gmail:me@x.test'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(depth, Some(180));
        // No re-login: the id is verbatim, so the keychain entry name is unchanged.
        assert_eq!(
            keychain_account("u1", "gmail:me@x.test"),
            "email_u1_gmail:me@x.test"
        );
        // Idempotent.
        assert!(run(&redb, &store).unwrap().already_done);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn fresh_redb_has_no_legacy_mail_tables() {
        let (redb, _store, dir) = fixtures("fresh");
        let names = redb.table_names().unwrap();
        assert!(!names.iter().any(|t| t.starts_with("email_")), "{names:?}");
        assert!(read_legacy(&redb).unwrap().0.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn redb_mail_tables_dropped() {
        let (redb, store, dir) = fixtures("drop");
        seed(&redb);
        redb.kv_set("other", "keep", &json!(1)).unwrap();
        let before = redb.table_names().unwrap();
        assert!(before.iter().any(|t| t == "email_envelopes"));
        let report = run(&redb, &store).unwrap();
        assert_eq!(report.tables_dropped, LEGACY_EMAIL_TABLES.len());
        let after = redb.table_names().unwrap();
        for def in LEGACY_EMAIL_TABLES {
            assert!(!after.iter().any(|t| t == def.name()), "{} left", def.name());
        }
        assert!(redb.kv_get("email", "accounts_v1").unwrap().is_none());
        assert_eq!(redb.kv_get("other", "keep").unwrap(), Some(json!(1)));
        assert_eq!(redb.drop_legacy_email_tables().unwrap(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn empty_legacy_store_migrates_nothing() {
        let (redb, store, dir) = fixtures("empty");
        let report = run(&redb, &store).unwrap();
        assert_eq!(report.accounts, 0);
        assert!(ids(&store).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
