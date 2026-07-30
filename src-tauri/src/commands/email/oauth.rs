//! Gmail "Sign in with Google" connect + XOAUTH2 token lifecycle (EM-2, AC2).
//!
//! Connect runs the shared PKCE flow ([`crate::commands::oauth_flow`]) with the
//! Gmail IMAP/SMTP scope, stores the tokens in the OS keychain (never redb, never
//! the cloud), and registers the account. [`ensure_fresh_access`] refreshes the
//! access token before any IMAP/SMTP use — the calendar OAuth path never refreshed,
//! so this is genuinely new. A `400 invalid_grant` (Google's testing-mode 7-day
//! cap) flips the account to `reauth_required` for a one-click reconnect.

use serde::Deserialize;
use tauri::State;

use super::account_config::account_id as build_account_id;
use super::model::{EmailAccountPublic, EmailHistoryDepth, StoredEmailAccount};
use super::realtime::schedule_idle_worker_reconcile;
use super::secrets::{self, StoredMailSecret};
use super::storage::{patch_account_sync_state, read_accounts, upsert_account_v2, write_accounts};
use crate::commands::oauth_flow::{self, OAuthRefreshError};
use crate::AppState;

/// The single scope Gmail's IMAP/SMTP servers accept (full mail access). `openid` +
/// `email` are added only so the userinfo call can resolve the address.
const GMAIL_SCOPES: &[&str] = &["https://mail.google.com/", "openid", "email"];
const GOOGLE_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
/// Refresh once we're within this many seconds of expiry (or already past).
const OAUTH_REFRESH_SKEW_SECS: i64 = 120;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmailGmailOAuthStartInput {
    pub workspace_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfoResponse {
    email: Option<String>,
    name: Option<String>,
}

/// The Gmail OAuth app credentials — the email-specific env, falling back to the
/// calendar Google app (one OAuth client can carry both scope sets).
fn google_oauth_client(state: &AppState) -> Result<(String, Option<String>), String> {
    let client_id = state
        .config
        .email_google_client_id
        .clone()
        .or_else(|| state.config.calendar_google_client_id.clone())
        .ok_or_else(|| {
            "missing_google_client_id:set MODUO_EMAIL_GOOGLE_CLIENT_ID".to_string()
        })?;
    let client_secret = state
        .config
        .email_google_client_secret
        .clone()
        .or_else(|| state.config.calendar_google_client_secret.clone());
    Ok((client_id, client_secret))
}

/// Complete the Google PKCE flow for a Gmail account, store the tokens, and
/// register the account. Returns the public account row (status `active`).
#[tauri::command]
pub async fn email_gmail_oauth_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailGmailOAuthStartInput,
) -> Result<EmailAccountPublic, String> {
    let (client_id, client_secret) = google_oauth_client(&state)?;

    let token = oauth_flow::run_oauth_authorization_code_flow(
        GOOGLE_AUTH_ENDPOINT,
        GOOGLE_TOKEN_ENDPOINT,
        &client_id,
        client_secret.as_deref(),
        GMAIL_SCOPES,
        "Email",
    )
    .await?;

    // Resolve the address (and optional display name) from the id token's userinfo.
    let client = reqwest::Client::new();
    let user = client
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|e| format!("google_userinfo_request_failed:{e}"))?;
    if !user.status().is_success() {
        let body = user.text().await.unwrap_or_default();
        return Err(format!("google_userinfo_failed:{body}"));
    }
    let user = user
        .json::<GoogleUserInfoResponse>()
        .await
        .map_err(|e| format!("google_userinfo_parse_failed:{e}"))?;
    let email = user
        .email
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty() && value.contains('@'))
        .ok_or_else(|| "google_userinfo_missing_email".to_string())?;
    let _display_name = user.name.filter(|value| !value.trim().is_empty());

    let id = build_account_id("gmail", &email, None);
    let expires_at = now_secs() + token.expires_in.unwrap_or(3600);
    // OAuth secrets go to the OS keychain (same scope as password accounts).
    secrets::save_oauth_secret(
        &state,
        &id,
        &token.access_token,
        token.refresh_token.as_deref(),
        expires_at,
    )?;

    // Register / re-activate the account row (mirrors the password connect flow;
    // an app-password → OAuth reconnect replaces the auth in place on the same id).
    let mut accounts = read_accounts(&state)?;
    if let Some(existing) = accounts.iter_mut().find(|account| account.id == id) {
        existing.workspace_id = input.workspace_id.clone();
        existing.provider = "gmail".to_string();
        existing.email = email.clone();
        existing.status = "active".to_string();
        existing.last_error = None;
    } else {
        accounts.push(StoredEmailAccount {
            id: id.clone(),
            workspace_id: input.workspace_id.clone(),
            provider: "gmail".to_string(),
            email: email.clone(),
            imap_host: None,
            smtp_host: None,
            imap_port: None,
            smtp_port: None,
            last_sync_at: None,
            status: "active".to_string(),
            last_error: None,
            // 12 months (AC6's default), same as the password connect path.
            history_depth: EmailHistoryDepth::default(),
        });
    }
    write_accounts(&state, &accounts)?;
    if let Some(saved_account) = accounts.iter().find(|account| account.id == id) {
        let _ = upsert_account_v2(&state, saved_account, Some(vec![]), Some(false), None);
    }

    let saved = accounts
        .into_iter()
        .find(|account| account.id == id)
        .ok_or_else(|| "account_save_failed".to_string())?;
    schedule_idle_worker_reconcile(&app, false);
    Ok(saved.to_public())
}

/// Refresh an OAuth account's access token if it's within the skew window of
/// expiry, re-saving the keychain secret. No-op for password accounts (or a fresh
/// token). A terminal `invalid_grant` flips the account to `reauth_required` and
/// returns `account_reauth_required`; a transient failure returns the raw error
/// (the caller keeps the stale token and lets the IMAP/SMTP attempt surface it).
///
/// **Must be called from an async context** (it does a network refresh) BEFORE any
/// blocking config build / IMAP session open.
pub(super) async fn ensure_fresh_access(
    state: &AppState,
    account_id: &str,
    provider: &str,
) -> Result<(), String> {
    if provider != "gmail" {
        return Ok(());
    }
    let Some(secret) = secrets::get_secret(state, account_id)? else {
        // No secret at all → the account is already reauth (surfaced elsewhere).
        return Ok(());
    };
    let StoredMailSecret::Oauth {
        refresh_token,
        expires_at,
        ..
    } = secret
    else {
        // A Gmail account connected via app password — nothing to refresh.
        return Ok(());
    };

    let now = now_secs();
    if !oauth_flow::should_refresh(expires_at, now, OAUTH_REFRESH_SKEW_SECS) {
        return Ok(());
    }
    let Some(refresh) = refresh_token else {
        mark_reauth(state, account_id);
        return Err("account_reauth_required".to_string());
    };

    let (client_id, client_secret) = google_oauth_client(state)?;
    match oauth_flow::refresh_access_token(
        GOOGLE_TOKEN_ENDPOINT,
        &client_id,
        client_secret.as_deref(),
        &refresh,
    )
    .await
    {
        Ok(fresh) => {
            let new_expires_at = now + fresh.expires_in.unwrap_or(3600);
            // Google's refresh response omits refresh_token — keep the original.
            let keep_refresh = fresh.refresh_token.or(Some(refresh));
            secrets::save_oauth_secret(
                state,
                account_id,
                &fresh.access_token,
                keep_refresh.as_deref(),
                new_expires_at,
            )?;
            Ok(())
        }
        Err(OAuthRefreshError::InvalidGrant) => {
            mark_reauth(state, account_id);
            Err("account_reauth_required".to_string())
        }
        // Transient (network/5xx) — do NOT flip reauth; keep the stale token.
        Err(OAuthRefreshError::Other(err)) => Err(err),
    }
}

fn mark_reauth(state: &AppState, account_id: &str) {
    let _ = patch_account_sync_state(
        state,
        account_id,
        "reauth_required",
        Some("oauth_reauth_required".to_string()),
    );
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}
