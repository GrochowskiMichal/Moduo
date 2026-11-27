/// The client side of the `manage-integration` Edge Function: hands a desktop
/// Google Calendar login's tokens to the server, so booking links can create
/// events and Meet links while the app is closed (`calendar.rs`
/// `calendar_google_publish_booking_token`).
///
/// The tokens go in plaintext over TLS, authenticated by the person's own
/// Supabase session; the function encrypts them into `user_integrations`
/// (MOD-554). The encryption secret never ships in the desktop app.
///
/// Zoom and Google Meet connect through booking links (`booking-zoom-connect`
/// and the Google Calendar row) on every platform; the desktop has no sign-in
/// of its own for them (EB-1).
use serde::{Deserialize, Serialize};
use url::Url;

use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IntegrationTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix timestamp (seconds) at which the access_token expires.
    pub expires_at: Option<i64>,
}

/// The signed-in person's id and Supabase access token (the webview mirrors a
/// fresh session into AppState on every refresh).
pub(crate) fn signed_in(state: &AppState) -> Result<(String, String), String> {
    let guard = state
        .session
        .lock()
        .map_err(|_| "integration_session_lock".to_string())?;
    guard
        .as_ref()
        .map(|s| (s.user.id.clone(), s.access_token.clone()))
        .ok_or_else(|| "integration_not_signed_in".to_string())
}

fn manage_integration_url(supabase_url: &str) -> Result<Url, String> {
    let base = format!(
        "{}/functions/v1/manage-integration",
        supabase_url.trim_end_matches('/')
    );
    Url::parse(&base).map_err(|e| format!("integration_supabase_url_invalid:{e}"))
}

/// Hand the person's own tokens to `manage-integration`, which encrypts and
/// stores them for the session's user (never a user id from here).
pub(crate) async fn upsert_integration_in_supabase(
    supabase_url: &str,
    access_jwt: &str,
    provider: &str,
    tokens: &IntegrationTokens,
) -> Result<(), String> {
    let body = serde_json::json!({
        "provider": provider,
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "expires_at": tokens.expires_at,
    });
    let resp = reqwest::Client::new()
        .post(manage_integration_url(supabase_url)?)
        .bearer_auth(access_jwt)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("integration_supabase_request_failed:{e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("integration_supabase_upsert_failed:{text}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manage_integration_url_names_no_user_or_provider() {
        let url = manage_integration_url("https://x.supabase.co/").unwrap();
        assert_eq!(
            url.as_str(),
            "https://x.supabase.co/functions/v1/manage-integration"
        );
        assert_eq!(url.query(), None);
        let bare = manage_integration_url("https://x.supabase.co").unwrap();
        assert_eq!(
            bare.as_str(),
            "https://x.supabase.co/functions/v1/manage-integration"
        );
    }
}
