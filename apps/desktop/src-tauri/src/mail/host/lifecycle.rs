//! Account lifecycle on the store: register a connected account, set its
//! history depth, and the full local purge behind disconnect (AC37, AC38, AC6).
//! The network halves (login check, OAuth, keychain) live in
//! `commands/mail_accounts.rs`; everything here is store-only and unit-tested.

use rusqlite::params;

use crate::mail::accounts::{AccountData, MailAccount};
use crate::mail::contracts::{Provider, SyncState};
use crate::mail::migrate::endpoints_key;
use crate::mail::rules::SettingsItem;
use crate::mail::store::{AccountInput, Store, StoreError, StoreResult};
use crate::mail::sync::classify::ClassifyConfig;

/// kv key for the last settings items the webview pushed (rules, tabs,
/// Priority, blocks), so a worker classifies right before the mirror loads.
pub const CLASSIFY_ITEMS_KEY: &str = "classify_items_v1";

/// The webview's depth names (`features/email/history-depth.ts`) → days.
/// `None` is Everything.
pub fn depth_days(depth: &str) -> Result<Option<i64>, String> {
    match depth {
        "threeMonths" => Ok(Some(90)),
        "sixMonths" => Ok(Some(180)),
        "twelveMonths" => Ok(Some(365)),
        "everything" => Ok(None),
        _ => Err("invalid_history_depth".into()),
    }
}

/// Days → the webview's depth name (unknown day counts round to the nearest).
pub fn depth_name(days: Option<i64>) -> &'static str {
    match days {
        None => "everything",
        Some(d) if d <= 90 => "threeMonths",
        Some(d) if d <= 180 => "sixMonths",
        Some(_) => "twelveMonths",
    }
}

/// The connect dialog's provider names → the engine's (`custom` is IMAP).
pub fn provider_from_ui(raw: &str) -> Result<Provider, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "custom" | "imap" => Ok(Provider::Imap),
        other => Provider::parse(other).ok_or_else(|| "invalid_provider".to_string()),
    }
}

/// Writes (or re-writes, on a reconnect) a connected account: the row, its
/// depth, its endpoints, and `first_sync` so the list shows it working.
pub fn register_account(
    store: &Store,
    account: &MailAccount,
    display_name: &str,
    depth: Option<i64>,
) -> StoreResult<()> {
    store.upsert_account(&AccountInput {
        id: account.id.clone(),
        address: account.email.clone(),
        display_name: display_name.to_string(),
        provider: account.provider.as_str().to_string(),
        hue: hue_of(&account.id),
    })?;
    store.w().execute(
        "UPDATE accounts SET history_depth_days = ?2, sync_state = ?3, last_error = NULL WHERE id = ?1",
        params![account.id, depth, SyncState::FirstSync.as_str()],
    )?;
    let endpoints =
        serde_json::to_string(account).map_err(|e| StoreError::Invalid(e.to_string()))?;
    store.kv_set(&endpoints_key(&account.id), &endpoints)
}

/// A stable 0–359 hue per account id, so the rail colour never changes.
pub fn hue_of(id: &str) -> i64 {
    let h = id
        .bytes()
        .fold(2166136261u32, |h, b| (h ^ b as u32).wrapping_mul(16777619));
    (h % 360) as i64
}

/// Changes the depth; false when no such account.
pub fn set_depth(store: &Store, account_id: &str, depth: Option<i64>) -> StoreResult<bool> {
    let n = store.w().execute(
        "UPDATE accounts SET history_depth_days = ?2 WHERE id = ?1",
        params![account_id, depth],
    )?;
    Ok(n > 0)
}

pub fn account_exists(store: &Store, account_id: &str) -> StoreResult<bool> {
    Ok(store
        .r()
        .query_row("SELECT 1 FROM accounts WHERE id = ?1", [account_id], |_| Ok(()))
        .map(|_| true)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(false),
            e => Err(e),
        })?)
}

pub fn endpoints(store: &Store, account_id: &str) -> Option<MailAccount> {
    store
        .kv_get(&endpoints_key(account_id))
        .ok()
        .flatten()
        .and_then(|j| serde_json::from_str(&j).ok())
}

/// The classify config the workers share: defaults plus the pushed items.
pub fn classify_config(items: &[SettingsItem]) -> ClassifyConfig {
    let mut cfg = ClassifyConfig::default();
    crate::mail::rules::apply_settings_items(&mut cfg, items);
    cfg
}

/// The items last pushed, from kv (empty when none). A corrupt blob is an
/// error, never an empty list; malformed single rows are skipped.
pub fn stored_classify_items(store: &Store) -> StoreResult<Vec<SettingsItem>> {
    let Some(j) = store.kv_get(CLASSIFY_ITEMS_KEY)? else {
        return Ok(Vec::new());
    };
    let rows: Vec<serde_json::Value> = serde_json::from_str(&j)
        .map_err(|e| StoreError::Invalid(format!("classify items: {e}")))?;
    Ok(rows
        .into_iter()
        .filter_map(|r| serde_json::from_value(r).ok())
        .collect())
}

fn delete_kv_prefix(store: &Store, prefix: &str) -> StoreResult<()> {
    store.w().execute(
        "DELETE FROM kv WHERE substr(key, 1, length(?1)) = ?1",
        [prefix],
    )?;
    Ok(())
}

impl AccountData for Store {
    fn unsent_outbox_count(&self, account_id: &str) -> Result<u32, String> {
        self.r()
            .query_row(
                "SELECT COUNT(*) FROM outbox WHERE account_id = ?1 AND state <> 'sent'",
                [account_id],
                |r| r.get::<_, i64>(0),
            )
            .map(|n| n.max(0) as u32)
            .map_err(|e| e.to_string())
    }

    /// Rows, bodies, attachments, drafts, ops, outbox and index entries (by
    /// `delete_account`), plus every kv entry keyed by the account or its
    /// mailboxes and drafts.
    fn purge_account(&self, account_id: &str) -> Result<(), String> {
        let s = |e: StoreError| e.to_string();
        let drafts: Vec<String> = {
            let c = self.r();
            let mut q = c
                .prepare("SELECT id FROM drafts WHERE account_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = q
                .query_map([account_id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string());
            rows?
        };
        for d in &drafts {
            delete_kv_prefix(self, &format!("mail_draft_uploaded:{d}")).map_err(s)?;
            delete_kv_prefix(self, &format!("mail_draft_server_delete:{d}:")).map_err(s)?;
        }
        self.delete_account(account_id).map_err(s)?;
        for key in [
            endpoints_key(account_id),
            format!("mail_send_graph:{account_id}"),
        ] {
            self.w()
                .execute("DELETE FROM kv WHERE key = ?1", [&key])
                .map_err(|e| e.to_string())?;
        }
        delete_kv_prefix(self, &format!("flagdiff:{account_id}|")).map_err(s)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::accounts::{disconnect, oauth_account, password_account, DisconnectOutcome};
    use crate::mail::auth::testing::MemStore;
    use crate::mail::auth::{CredentialStore, Credential};
    use crate::mail::host::list_accounts;
    use crate::mail::store::{now_ms, MailboxInput};
    use crate::mail::contracts::MailboxRole;

    fn store(tag: &str) -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("moduo-mail-life-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (Store::open(&dir).unwrap(), dir)
    }

    #[test]
    fn depth_names_round_trip() {
        for n in ["threeMonths", "sixMonths", "twelveMonths", "everything"] {
            assert_eq!(depth_name(depth_days(n).unwrap()), n);
        }
        assert!(depth_days("forever").is_err());
        assert_eq!(provider_from_ui("custom").unwrap(), Provider::Imap);
        assert_eq!(provider_from_ui("icloud").unwrap(), Provider::Icloud);
        assert!(provider_from_ui("pigeon").is_err());
    }

    #[test]
    fn register_creates_the_row_with_depth_and_endpoints() {
        let (st, dir) = store("reg");
        let a = password_account(Provider::Icloud, "me@icloud.com", None).unwrap();
        register_account(&st, &a, "Me", Some(180)).unwrap();
        let rows = list_accounts(&st).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "icloud:me@icloud.com");
        assert_eq!(rows[0].sync_state, "first_sync");
        assert_eq!(rows[0].history_depth, "sixMonths");
        assert_eq!(endpoints(&st, &a.id).unwrap(), a);
        // A reconnect re-registers in place and clears the error.
        st.set_account_sync(&a.id, "reconnect", None, Some("reconnect")).unwrap();
        register_account(&st, &a, "Me", Some(365)).unwrap();
        let rows = list_accounts(&st).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].sync_state, "first_sync");
        assert_eq!(rows[0].last_error, None);
        assert!(set_depth(&st, &a.id, None).unwrap());
        assert_eq!(list_accounts(&st).unwrap()[0].history_depth, "everything");
        assert!(!set_depth(&st, "nope", None).unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn disconnect_purges_every_local_trace() {
        let (st, dir) = store("purge");
        let a = oauth_account(Provider::Gmail, "a@gmail.com").unwrap();
        let b = password_account(Provider::Icloud, "b@icloud.com", None).unwrap();
        register_account(&st, &a, "", Some(365)).unwrap();
        register_account(&st, &b, "", Some(365)).unwrap();
        st.upsert_mailbox(&MailboxInput {
            id: format!("{}|INBOX", a.id),
            account_id: a.id.clone(),
            path: "INBOX".into(),
            name: "Inbox".into(),
            role: MailboxRole::Inbox,
            delimiter: Some("/".into()),
            live: true,
        })
        .unwrap();
        st.kv_set(&format!("flagdiff:{}|INBOX", a.id), "5").unwrap();
        st.kv_set(&format!("flagdiff:{}|INBOX", b.id), "5").unwrap();
        st.kv_set(&format!("mail_send_graph:{}", a.id), "1").unwrap();
        st.w()
            .execute(
                "INSERT INTO outbox (id, account_id, mime, state, not_before_ms, created_at_ms)
                 VALUES ('o1', ?1, x'00', 'pending', 0, ?2)",
                params![a.id, now_ms()],
            )
            .unwrap();
        let secrets = MemStore::default();
        secrets
            .save(&a.id, &Credential::Password { password: "p".into() })
            .unwrap();
        // Unsent mail asks first.
        assert_eq!(
            disconnect(&st, &secrets, &a.id, false, || panic!("asked first")).unwrap(),
            DisconnectOutcome::NeedsConfirm { unsent: 1 }
        );
        assert_eq!(
            disconnect(&st, &secrets, &a.id, true, || {}).unwrap(),
            DisconnectOutcome::Purged
        );
        let ids: Vec<String> = list_accounts(&st).unwrap().into_iter().map(|r| r.id).collect();
        assert_eq!(ids, vec![b.id.clone()]);
        assert!(st.list_mailboxes(&a.id).unwrap().is_empty());
        assert!(endpoints(&st, &a.id).is_none());
        assert!(st.kv_get(&format!("flagdiff:{}|INBOX", a.id)).unwrap().is_none());
        assert!(st.kv_get(&format!("mail_send_graph:{}", a.id)).unwrap().is_none());
        assert!(st.kv_get(&format!("flagdiff:{}|INBOX", b.id)).unwrap().is_some());
        assert!(endpoints(&st, &b.id).is_some(), "other accounts untouched");
        assert_eq!(secrets.load(&a.id).unwrap(), None);
        assert_eq!(st.unsent_outbox_count(&a.id).unwrap(), 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn classify_items_load_from_kv() {
        let (st, dir) = store("classify");
        assert!(stored_classify_items(&st).unwrap().is_empty());
        st.kv_set(
            CLASSIFY_ITEMS_KEY,
            r#"[{"id":"1","kind":"blocked_sender","position":0,"value":{"address":"Spam@X.io"}},
                {"id":"2","kind":"priority_person","position":1,"value":{"address":"boss@x.io"}},
                {"bogus":true}]"#,
        )
        .unwrap();
        let items = stored_classify_items(&st).unwrap();
        assert_eq!(items.len(), 2);
        let cfg = classify_config(&items);
        assert_eq!(cfg.blocked, vec!["spam@x.io".to_string()]);
        assert!(cfg.priority_people.contains("boss@x.io"));
        st.kv_set(CLASSIFY_ITEMS_KEY, "not json").unwrap();
        assert!(stored_classify_items(&st).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
