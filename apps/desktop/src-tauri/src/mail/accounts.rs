//! Accounts: provider endpoints, connect validation and disconnect with a full
//! local purge (MR-2, AC37/AC38). Storage is behind [`AccountData`] so the
//! SQLite store (MR-1) and the engine (MR-3) plug in without this module
//! knowing their tables.

use serde::{Deserialize, Serialize};

use super::auth::{google, microsoft, CredentialStore};
use super::contracts::Provider;
use super::session::Endpoint;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAccount {
    pub id: String,
    pub provider: Provider,
    pub email: String,
    pub imap: Endpoint2,
    pub smtp: Endpoint2,
}

/// Serializable endpoint (the session's `Endpoint` is runtime-only).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Endpoint2 {
    pub host: String,
    pub port: u16,
}

impl From<&Endpoint2> for Endpoint {
    fn from(e: &Endpoint2) -> Self {
        Endpoint { host: e.host.clone(), port: e.port }
    }
}

/// Account id, the legacy format (`<provider>:<email>`), so ids carry over.
pub fn account_id(provider: Provider, email: &str) -> String {
    let p = match provider {
        // Workspace accounts were "gmail" in the legacy engine; keep the id stable.
        Provider::GoogleWorkspace => "gmail",
        other => other.as_str(),
    };
    format!("{p}:{}", email.trim().to_lowercase())
}

/// Default IMAP/SMTP endpoints per provider; custom IMAP passes its own.
pub fn default_endpoints(provider: Provider) -> Option<(Endpoint2, Endpoint2)> {
    let e = |h: &str, p: u16| Endpoint2 { host: h.into(), port: p };
    match provider {
        Provider::Gmail | Provider::GoogleWorkspace => Some((e(google::IMAP_HOST, 993), e(google::SMTP_HOST, 465))),
        Provider::Icloud => Some((e("imap.mail.me.com", 993), e("smtp.mail.me.com", 587))),
        Provider::Outlook => Some((e(microsoft::IMAP_HOST, 993), e(microsoft::SMTP_HOST, microsoft::SMTP_PORT))),
        Provider::Imap => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectError {
    InvalidEmail,
    InvalidHost,
    /// Workspace (and any non-personal Google domain) must use Sign in with Google.
    OauthRequired,
}

impl ConnectError {
    pub fn code(&self) -> &'static str {
        match self {
            ConnectError::InvalidEmail => "invalid_email",
            ConnectError::InvalidHost => "invalid_host",
            ConnectError::OauthRequired => "oauth_required",
        }
    }
}

fn valid_host(h: &str) -> bool {
    !h.is_empty() && h.len() <= 253 && h.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// Validate a password connect (the webview is not trusted) and build the account.
pub fn password_account(
    provider: Provider,
    email: &str,
    custom: Option<(Endpoint2, Endpoint2)>,
) -> Result<MailAccount, ConnectError> {
    let email = email.trim().to_lowercase();
    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 || parts[0].is_empty() || !parts[1].contains('.') {
        return Err(ConnectError::InvalidEmail);
    }
    if matches!(provider, Provider::Gmail | Provider::GoogleWorkspace) && !google::app_password_allowed(&email) {
        return Err(ConnectError::OauthRequired);
    }
    if provider == Provider::Outlook {
        return Err(ConnectError::OauthRequired);
    }
    let (imap, smtp) = match (default_endpoints(provider), custom) {
        (_, Some(c)) if provider == Provider::Imap => c,
        (Some(d), _) => d,
        (None, _) => return Err(ConnectError::InvalidHost),
    };
    if !valid_host(&imap.host) || !valid_host(&smtp.host) || imap.port == 0 || smtp.port == 0 {
        return Err(ConnectError::InvalidHost);
    }
    Ok(MailAccount { id: account_id(provider, &email), provider, email, imap, smtp })
}

/// Build an OAuth account once the provider returned the address.
pub fn oauth_account(provider: Provider, email: &str) -> Result<MailAccount, ConnectError> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(ConnectError::InvalidEmail);
    }
    let provider = match provider {
        Provider::Gmail | Provider::GoogleWorkspace => google::provider_for_oauth(&email),
        p => p,
    };
    let (imap, smtp) = default_endpoints(provider).ok_or(ConnectError::InvalidHost)?;
    Ok(MailAccount { id: account_id(provider, &email), provider, email, imap, smtp })
}

/// Everything local that belongs to an account.
pub trait AccountData {
    /// Unsent messages queued in the outbox.
    fn unsent_outbox_count(&self, account_id: &str) -> Result<u32, String>;
    /// Delete rows, bodies, attachments, drafts, ops, outbox and index entries.
    fn purge_account(&self, account_id: &str) -> Result<(), String>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum DisconnectOutcome {
    /// The UI must ask first ("1 unsent message will be discarded").
    NeedsConfirm { unsent: u32 },
    Purged,
}

/// Disconnect: confirm unsent mail, stop the actor, purge data, remove the secret.
pub fn disconnect<D: AccountData, S: CredentialStore>(
    data: &D,
    secrets: &S,
    account_id: &str,
    confirmed: bool,
    stop_actor: impl FnOnce(),
) -> Result<DisconnectOutcome, String> {
    let unsent = data.unsent_outbox_count(account_id)?;
    if unsent > 0 && !confirmed {
        return Ok(DisconnectOutcome::NeedsConfirm { unsent });
    }
    stop_actor();
    data.purge_account(account_id)?;
    secrets.delete(account_id)?;
    Ok(DisconnectOutcome::Purged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::auth::testing::MemStore;
    use crate::mail::auth::Credential;
    use std::cell::{Cell, RefCell};

    struct FakeData {
        unsent: u32,
        purged: RefCell<Vec<String>>,
    }
    impl AccountData for FakeData {
        fn unsent_outbox_count(&self, _: &str) -> Result<u32, String> {
            Ok(self.unsent)
        }
        fn purge_account(&self, id: &str) -> Result<(), String> {
            self.purged.borrow_mut().push(id.into());
            Ok(())
        }
    }

    #[test]
    fn disconnect_purges_everything() {
        let data = FakeData { unsent: 0, purged: RefCell::default() };
        let secrets = MemStore::default();
        secrets.save("gmail:a@gmail.com", &Credential::Password { password: "p".into() }).unwrap();
        secrets.save("imap:b@x.io", &Credential::Password { password: "q".into() }).unwrap();
        let stopped = Cell::new(false);
        let out = disconnect(&data, &secrets, "gmail:a@gmail.com", false, || stopped.set(true)).unwrap();
        assert_eq!(out, DisconnectOutcome::Purged);
        assert!(stopped.get());
        assert_eq!(*data.purged.borrow(), vec!["gmail:a@gmail.com".to_string()]);
        assert_eq!(secrets.load("gmail:a@gmail.com").unwrap(), None);
        assert!(secrets.load("imap:b@x.io").unwrap().is_some(), "other accounts untouched");
    }

    #[test]
    fn disconnect_asks_first_with_unsent_outbox() {
        let data = FakeData { unsent: 1, purged: RefCell::default() };
        let secrets = MemStore::default();
        secrets.save("a", &Credential::Password { password: "p".into() }).unwrap();
        let out = disconnect(&data, &secrets, "a", false, || panic!("must not stop")).unwrap();
        assert_eq!(out, DisconnectOutcome::NeedsConfirm { unsent: 1 });
        assert!(data.purged.borrow().is_empty());
        assert!(secrets.load("a").unwrap().is_some());
        assert_eq!(disconnect(&data, &secrets, "a", true, || {}).unwrap(), DisconnectOutcome::Purged);
    }

    #[test]
    fn connect_validation_per_provider() {
        let a = password_account(Provider::Icloud, " Me@iCloud.com ", None).unwrap();
        assert_eq!(a.id, "icloud:me@icloud.com");
        assert_eq!(a.imap.host, "imap.mail.me.com");
        assert_eq!(password_account(Provider::Gmail, "a@acme.io", None), Err(ConnectError::OauthRequired));
        assert_eq!(password_account(Provider::Outlook, "a@outlook.com", None), Err(ConnectError::OauthRequired));
        assert_eq!(password_account(Provider::Imap, "a@x.io", None), Err(ConnectError::InvalidHost));
        let bad = (Endpoint2 { host: "evil host;".into(), port: 993 }, Endpoint2 { host: "smtp.x.io".into(), port: 465 });
        assert_eq!(password_account(Provider::Imap, "a@x.io", Some(bad)), Err(ConnectError::InvalidHost));
        assert_eq!(password_account(Provider::Icloud, "nope", None), Err(ConnectError::InvalidEmail));
        let ws = oauth_account(Provider::Gmail, "anna@acme.io").unwrap();
        assert_eq!(ws.provider, Provider::GoogleWorkspace);
        assert_eq!(ws.id, "gmail:anna@acme.io");
        assert_eq!(oauth_account(Provider::Outlook, "a@contoso.com").unwrap().smtp.port, 587);
    }
}
