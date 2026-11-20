//! Account lifecycle commands on the rebuilt engine (AC6, AC32, AC37, AC38):
//! connect (password, Google personal + Workspace OAuth, Microsoft OAuth,
//! iCloud, custom IMAP), disconnect with the full purge, history depth,
//! Sync now / Reconnect without sign-in, server search ("Search older mail")
//! and the classify config push. Every connect writes the keychain secret,
//! registers the account in the user's store and starts its worker at once.
//! The store halves are `mail::host::lifecycle` (unit-tested); the network
//! halves here are covered by the manual connect smoke.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::mail::accounts::{self, ConnectError, Endpoint2, MailAccount};
use crate::mail::auth::{
    self, google, microsoft, ensure_fresh, Credential, CredentialStore, KeychainStore, LoginMethod,
};
use crate::mail::contracts::{MailboxRole, Provider, SyncState};
use crate::mail::host::{lifecycle, list_accounts, refresher_for, AccountRow, HostConfig, MailHost};
use crate::mail::rules::SettingsItem;
use crate::mail::session::{self, Endpoint};
use crate::mail::store::now_ms;
use crate::mail::sync::events::MailEvent;
use crate::mail::sync::headers;
use crate::mail::sync::imap::ImapServer;
use crate::mail::sync::roles::{assign_roles, FolderInfo};
use crate::mail::sync::server::MailServer;

const MAX_LEN: usize = 512;
const SEARCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

fn check(s: &str, what: &'static str) -> Result<(), String> {
    if s.trim().is_empty() || s.len() > MAX_LEN {
        return Err(format!("invalid_{what}"));
    }
    Ok(())
}

fn keychain(user_id: &str, cfg: &HostConfig) -> KeychainStore<fn(&str)> {
    fn noop(_: &str) {}
    KeychainStore {
        service: cfg.keychain_service.clone(),
        user_id: user_id.to_string(),
        on_reconnect: noop,
    }
}

fn row(host: &MailHost, id: &str) -> Result<AccountRow, String> {
    list_accounts(&*host.store()?)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "account_not_found".into())
}

/// Stores the secret, registers the account and starts its worker.
fn finish_connect(
    host: &MailHost,
    account: &MailAccount,
    display_name: &str,
    depth: &Option<String>,
    credential: &Credential,
) -> Result<AccountRow, String> {
    let (user_id, cfg) = host.session()?;
    let days = lifecycle::depth_days(depth.as_deref().unwrap_or("twelveMonths"))?;
    keychain(&user_id, &cfg).save(&account.id, credential)?;
    let store = host.store()?;
    lifecycle::register_account(&store, account, display_name, days).map_err(|e| e.to_string())?;
    host.spawn_worker(&account.id)?;
    host.events.emit(MailEvent::SyncStatus {
        account_id: account.id.clone(),
        state: SyncState::FirstSync,
        progress: None,
    });
    row(host, &account.id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordConnectIn {
    pub provider: String,
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub imap_host: Option<String>,
    #[serde(default)]
    pub imap_port: Option<u16>,
    #[serde(default)]
    pub smtp_host: Option<String>,
    #[serde(default)]
    pub smtp_port: Option<u16>,
    #[serde(default)]
    pub history_depth: Option<String>,
}

/// Validates the input (the webview is not trusted) into an account.
pub fn password_input(i: &PasswordConnectIn) -> Result<MailAccount, String> {
    check(&i.email, "email")?;
    if i.password.is_empty() || i.password.len() > 1024 {
        return Err("invalid_password".into());
    }
    let provider = lifecycle::provider_from_ui(&i.provider)?;
    let custom = match (&i.imap_host, &i.smtp_host) {
        (Some(ih), Some(sh)) if provider == Provider::Imap => Some((
            Endpoint2 {
                host: ih.trim().to_ascii_lowercase(),
                port: i.imap_port.unwrap_or(993),
            },
            Endpoint2 {
                host: sh.trim().to_ascii_lowercase(),
                port: i.smtp_port.unwrap_or(465),
            },
        )),
        _ => None,
    };
    accounts::password_account(provider, &i.email, custom).map_err(|e| e.code().to_string())
}

/// Password connect (Gmail app password, iCloud, custom IMAP): checks the
/// login against the server first, so a wrong password never saves.
#[tauri::command]
pub async fn mail_connect_password(
    input: PasswordConnectIn,
    host: State<'_, MailHost>,
) -> Result<AccountRow, String> {
    let account = password_input(&input)?;
    let login = LoginMethod::Password {
        user: account.email.clone(),
        password: input.password.clone(),
    };
    session::open(&Endpoint::from(&account.imap), &login)
        .await
        .map(|(mut s, _)| {
            tauri::async_runtime::spawn(async move {
                let _ = s.logout().await;
            })
        })
        .map_err(|e| {
            if session::is_auth_rejection(&e) {
                "auth_rejected".to_string()
            } else {
                e
            }
        })?;
    finish_connect(
        &host,
        &account,
        "",
        &input.history_depth,
        &Credential::Password {
            password: input.password,
        },
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthConnectIn {
    /// `gmail` (personal or Workspace, decided by the address) or `outlook`.
    pub provider: String,
    /// Required for Microsoft (its IMAP token can't read the profile);
    /// Google reads it from the sign-in.
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub history_depth: Option<String>,
}

#[derive(Deserialize)]
struct GoogleUser {
    email: Option<String>,
    name: Option<String>,
}

fn oauth_err(provider: Provider, e: String) -> String {
    match e.strip_prefix("oauth_provider_error:").or_else(|| e.strip_prefix("oauth_token_exchange_failed:")) {
        Some(body) => auth::classify_oauth_error(provider, body).code(),
        None => e,
    }
}

/// "Sign in with Google" / "Sign in with Microsoft": the loopback PKCE flow,
/// then the account is registered and synced right away. Also the Reconnect
/// path for an OAuth account (the same id is re-registered in place).
#[tauri::command]
pub async fn mail_connect_oauth(
    input: OAuthConnectIn,
    host: State<'_, MailHost>,
) -> Result<AccountRow, String> {
    use crate::commands::oauth_flow::run_oauth_authorization_code_flow;
    let provider = lifecycle::provider_from_ui(&input.provider)?;
    let (_, cfg) = host.session()?;
    let (email, name, token) = match provider {
        Provider::Gmail | Provider::GoogleWorkspace => {
            let id = cfg.google_client_id.clone().ok_or("google_oauth_not_configured")?;
            let token = run_oauth_authorization_code_flow(
                google::AUTH_ENDPOINT,
                google::TOKEN_ENDPOINT,
                &id,
                cfg.google_client_secret.as_deref(),
                google::SCOPES,
                "Email",
            )
            .await
            .map_err(|e| oauth_err(provider, e))?;
            let user = reqwest::Client::new()
                .get("https://openidconnect.googleapis.com/v1/userinfo")
                .bearer_auth(&token.access_token)
                .send()
                .await
                .map_err(|e| format!("google_userinfo_request_failed:{e}"))?
                .json::<GoogleUser>()
                .await
                .map_err(|e| format!("google_userinfo_parse_failed:{e}"))?;
            let email = user.email.ok_or("google_userinfo_missing_email")?;
            (email, user.name.unwrap_or_default(), token)
        }
        Provider::Outlook => {
            let email = input.email.clone().unwrap_or_default();
            check(&email, "email")?;
            let id = cfg.microsoft_client_id.clone().ok_or("microsoft_oauth_not_configured")?;
            let token = run_oauth_authorization_code_flow(
                microsoft::AUTH_ENDPOINT,
                microsoft::TOKEN_ENDPOINT,
                &id,
                None,
                microsoft::SCOPES,
                "Email",
            )
            .await
            .map_err(|e| oauth_err(provider, e))?;
            (email, String::new(), token)
        }
        _ => return Err(ConnectError::InvalidHost.code().into()),
    };
    let account = accounts::oauth_account(provider, &email).map_err(|e| e.code().to_string())?;
    let credential = Credential::Oauth {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: now_ms() / 1000 + token.expires_in.unwrap_or(3600),
    };
    finish_connect(&host, &account, &name, &input.history_depth, &credential)
}

/// AC38: stops the worker, purges every local trace and the keychain secret.
/// Unsent Outbox mail answers `needs_confirm` until `confirmed`.
#[tauri::command]
pub fn mail_disconnect(
    account_id: String,
    confirmed: bool,
    host: State<'_, MailHost>,
) -> Result<accounts::DisconnectOutcome, String> {
    check(&account_id, "id")?;
    let store = host.store()?;
    if !lifecycle::account_exists(&store, &account_id).map_err(|e| e.to_string())? {
        return Err("account_not_found".into());
    }
    let (user_id, cfg) = host.session()?;
    let out = accounts::disconnect(&*store, &keychain(&user_id, &cfg), &account_id, confirmed, || {
        host.stop_worker(&account_id)
    })?;
    if out == accounts::DisconnectOutcome::Purged {
        host.events.emit(MailEvent::ThreadsChanged {
            view_keys: vec![],
            thread_ids: vec![],
        });
        if let Ok(counts) = store.counts() {
            host.events.emit(MailEvent::Counts { counts });
        }
    }
    Ok(out)
}

/// Per-device depth (AC6): raising it backfills the gap, lowering it stops
/// fetching and deletes nothing. The worker restarts to read the new floor.
#[tauri::command]
pub fn mail_set_history_depth(
    account_id: String,
    depth: String,
    host: State<'_, MailHost>,
) -> Result<AccountRow, String> {
    check(&account_id, "id")?;
    let days = lifecycle::depth_days(&depth)?;
    if !lifecycle::set_depth(&*host.store()?, &account_id, days).map_err(|e| e.to_string())? {
        return Err("account_not_found".into());
    }
    host.spawn_worker(&account_id)?;
    row(&host, &account_id)
}

/// Sync now, and Reconnect without sign-in: restarts the account's worker
/// (or every worker), which re-reads its secret and runs a round at once.
#[tauri::command]
pub fn mail_sync_now(account_id: Option<String>, host: State<'_, MailHost>) -> Result<(), String> {
    let ids = match account_id {
        Some(id) => {
            check(&id, "id")?;
            if !lifecycle::account_exists(&*host.store()?, &id).map_err(|e| e.to_string())? {
                return Err("account_not_found".into());
            }
            vec![id]
        }
        None => list_accounts(&*host.store()?)?.into_iter().map(|r| r.id).collect(),
    };
    for id in ids {
        host.spawn_worker(&id)?;
    }
    Ok(())
}

/// The mirror of rules, tabs, Priority and blocked senders, pushed by the
/// webview on load and on every change; kept in kv for the next start.
#[tauri::command]
pub fn mail_set_classify_items(items: Vec<Value>, host: State<'_, MailHost>) -> Result<(), String> {
    if items.len() > 10_000 {
        return Err("too_many_items".into());
    }
    let parsed: Vec<SettingsItem> = items
        .iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect();
    let store = host.store()?;
    store
        .kv_set(
            lifecycle::CLASSIFY_ITEMS_KEY,
            &serde_json::to_string(&items).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    host.set_classify(lifecycle::classify_config(&parsed));
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSearchIn {
    pub account_id: String,
    pub query: String,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerHit {
    /// The local thread when the message is already synced, else None.
    pub thread_id: Option<String>,
    pub message_key: Option<String>,
    pub id: String,
    pub subject: String,
    pub sender: String,
    pub sender_email: String,
    pub timestamp_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSearchOut {
    pub status: &'static str,
    pub message: Option<String>,
    pub envelopes: Vec<ServerHit>,
}

/// An IMAP quoted string's content: no quotes, backslashes or controls.
pub fn imap_quote(q: &str) -> String {
    q.chars()
        .filter(|c| !c.is_control() && *c != '"' && *c != '\\')
        .collect::<String>()
        .trim()
        .chars()
        .take(200)
        .collect()
}

/// Gmail searches All Mail with its own syntax; other servers search the
/// Inbox's text.
pub fn search_plan(gmail: bool, folders: &[FolderInfo], q: &str) -> (String, String) {
    let all = assign_roles(folders)
        .into_iter()
        .find(|(_, r)| *r == MailboxRole::All)
        .map(|(f, _)| f.path);
    match (gmail, all) {
        (true, Some(path)) => (path, format!("X-GM-RAW \"{q}\"")),
        _ => ("INBOX".into(), format!("TEXT \"{q}\"")),
    }
}

async fn server_search(
    account: &MailAccount,
    login: &LoginMethod,
    q: &str,
    limit: usize,
    local_thread: impl Fn(&str) -> Option<String>,
) -> Result<Vec<ServerHit>, String> {
    let (session, caps) = session::open(&Endpoint::from(&account.imap), login).await?;
    let mut srv = ImapServer { session, caps };
    let folders = srv.list_folders().await?;
    let (path, criteria) = search_plan(srv.caps.gmail_ext, &folders, q);
    srv.session.examine(&path).await.map_err(|e| format!("imap:{e}"))?;
    let mut uids: Vec<u32> = srv
        .session
        .uid_search(criteria)
        .await
        .map_err(|e| format!("imap:{e}"))?
        .into_iter()
        .collect();
    uids.sort_unstable();
    let newest: Vec<u32> = uids.iter().rev().take(limit).copied().collect();
    let heads = srv.fetch_headers(&newest).await?;
    let _ = srv.session.logout().await;
    let mut out: Vec<ServerHit> = heads
        .iter()
        .map(|h| {
            let p = headers::parse(&h.raw);
            ServerHit {
                thread_id: p.message_id.as_deref().and_then(&local_thread),
                message_key: p.message_id.clone(),
                id: format!("{}|{}|{}", account.id, path, h.uid),
                subject: p.subject,
                sender: p.from.name,
                sender_email: p.from.email,
                timestamp_ms: p.date_ms.or(h.internal_date_ms),
            }
        })
        .collect();
    out.sort_by(|a, b| b.timestamp_ms.cmp(&a.timestamp_ms));
    Ok(out)
}

/// ⌘K "Search older mail on <account>" (AC32): reaches past the history
/// depth on the server, with an honest status.
#[tauri::command]
pub async fn mail_search_server(
    input: ServerSearchIn,
    host: State<'_, MailHost>,
) -> Result<ServerSearchOut, String> {
    check(&input.account_id, "id")?;
    let q = imap_quote(&input.query);
    if q.is_empty() {
        return Err("invalid_query".into());
    }
    let limit = input.limit.unwrap_or(50).clamp(1, 200) as usize;
    let store = host.store()?;
    let account = lifecycle::endpoints(&store, &input.account_id).ok_or("account_not_found")?;
    let (user_id, cfg) = host.session()?;
    let login = match ensure_fresh(
        &keychain(&user_id, &cfg),
        &refresher_for(account.provider, &cfg),
        &account.id,
        &account.email,
        now_ms() / 1000,
    )
    .await
    {
        Ok(l) => l,
        Err(e) => {
            return Ok(ServerSearchOut {
                status: "error",
                message: Some(e.code()),
                envelopes: vec![],
            })
        }
    };
    let s2 = store.clone();
    let acct = account.id.clone();
    let local = move |mid: &str| -> Option<String> {
        s2.r()
            .query_row(
                "SELECT thread_id FROM messages WHERE account_id = ?1 AND message_id = ?2 LIMIT 1",
                [&acct, mid],
                |r| r.get(0),
            )
            .ok()
    };
    match tokio::time::timeout(SEARCH_TIMEOUT, server_search(&account, &login, &q, limit, local)).await {
        Err(_) => Ok(ServerSearchOut {
            status: "timeout",
            message: None,
            envelopes: vec![],
        }),
        Ok(Err(e)) => Ok(ServerSearchOut {
            status: "error",
            message: Some(e),
            envelopes: vec![],
        }),
        Ok(Ok(envelopes)) => Ok(ServerSearchOut {
            status: "ok",
            message: None,
            envelopes,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pw(v: Value) -> Result<MailAccount, String> {
        password_input(&serde_json::from_value(v).unwrap())
    }

    #[test]
    fn password_inputs_are_validated() {
        let a = pw(json!({"provider": "icloud", "email": "Me@iCloud.com", "password": "x"})).unwrap();
        assert_eq!(a.id, "icloud:me@icloud.com");
        let c = pw(json!({"provider": "custom", "email": "a@corp.io", "password": "x",
            "imapHost": "IMAP.corp.io", "imapPort": 1993, "smtpHost": "smtp.corp.io", "smtpPort": 587}))
        .unwrap();
        assert_eq!(c.provider, Provider::Imap);
        assert_eq!((c.imap.host.as_str(), c.imap.port, c.smtp.port), ("imap.corp.io", 1993, 587));
        assert_eq!(
            pw(json!({"provider": "gmail", "email": "a@acme.io", "password": "x"})).unwrap_err(),
            "oauth_required"
        );
        assert_eq!(
            pw(json!({"provider": "custom", "email": "a@x.io", "password": "x"})).unwrap_err(),
            "invalid_host"
        );
        assert_eq!(
            pw(json!({"provider": "icloud", "email": "a@x.io", "password": ""})).unwrap_err(),
            "invalid_password"
        );
        assert!(pw(json!({"provider": "fax", "email": "a@x.io", "password": "x"})).is_err());
    }

    #[test]
    fn server_search_query_is_quoted_and_planned() {
        assert_eq!(imap_quote(" a \"b\"\\ c\r\n"), "a b c");
        let f = |p: &str, a: &[&str]| FolderInfo {
            path: p.into(),
            delimiter: Some("/".into()),
            attributes: a.iter().map(|s| s.to_string()).collect(),
        };
        let folders = vec![f("INBOX", &[]), f("[Gmail]/All Mail", &["\\All"])];
        assert_eq!(
            search_plan(true, &folders, "invoice"),
            ("[Gmail]/All Mail".into(), "X-GM-RAW \"invoice\"".into())
        );
        assert_eq!(
            search_plan(false, &folders[..1], "invoice"),
            ("INBOX".into(), "TEXT \"invoice\"".into())
        );
    }

    #[test]
    fn oauth_errors_map_to_ui_codes() {
        assert_eq!(
            oauth_err(Provider::Outlook, "oauth_provider_error:AADSTS65001".into()),
            "admin_consent_required:AADSTS65001"
        );
        assert_eq!(
            oauth_err(Provider::Gmail, "oauth_callback_timeout".into()),
            "oauth_callback_timeout"
        );
    }
}
