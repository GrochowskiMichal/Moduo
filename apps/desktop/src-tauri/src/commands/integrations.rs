/// Integration OAuth (Zoom, Google Meet) — connects host accounts so the
/// Next.js booking API can auto-create meeting links on each booking.
///
/// Token flow:
///   1. PKCE or client-secret OAuth via local TCP redirect
///   2. Access + refresh tokens stored in OS keychain (plaintext, private)
///   3. Tokens handed to the `manage-integration` Edge Function over TLS,
///      authenticated by the person's own Supabase session; the function
///      encrypts them into `user_integrations` (MOD-554). The encryption
///      secret never ships in the desktop app.
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::{STANDARD as B64, URL_SAFE_NO_PAD as B64URL};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use url::Url;

use crate::AppState;

const OAUTH_TIMEOUT_SECS: u64 = 180;

// ── Shared types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IntegrationTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix timestamp (seconds) at which the access_token expires.
    pub expires_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FullOAuthTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    token_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatusItem {
    pub provider: String,
    pub connected: bool,
}

// ── Keychain helpers ──────────────────────────────────────────────────────────

fn keychain_account(provider: &str, user_id: &str) -> String {
    format!("integration_{provider}_{user_id}")
}

fn save_tokens_to_keychain(
    service: &str,
    provider: &str,
    user_id: &str,
    tokens: &IntegrationTokens,
) -> Result<(), String> {
    let encoded = serde_json::to_string(tokens)
        .map_err(|e| format!("integration_keychain_serialize_failed:{e}"))?;
    crate::keychain::set_secret(service, &keychain_account(provider, user_id), &encoded)
        .map_err(|e| format!("integration_keychain_save_failed:{e}"))
}

fn load_tokens_from_keychain(
    service: &str,
    provider: &str,
    user_id: &str,
) -> Option<IntegrationTokens> {
    let raw = crate::keychain::get_secret(service, &keychain_account(provider, user_id))
        .ok()
        .flatten()?;
    serde_json::from_str::<IntegrationTokens>(&raw).ok()
}

fn delete_tokens_from_keychain(service: &str, provider: &str, user_id: &str) {
    let _ = crate::keychain::delete_secret(service, &keychain_account(provider, user_id));
}

// ── Supabase (manage-integration) ────────────────────────────────────────────

/// Providers the desktop connects. Anything else from the webview is refused
/// before it reaches the keychain or the network.
pub(crate) const DESKTOP_MEETING_PROVIDERS: [&str; 2] = ["zoom", "google_meet"];

pub(crate) fn allowed_meeting_provider(provider: &str) -> Result<&'static str, String> {
    DESKTOP_MEETING_PROVIDERS
        .into_iter()
        .find(|p| *p == provider)
        .ok_or_else(|| "integration_unknown_provider".to_string())
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

fn manage_integration_url(supabase_url: &str, provider: Option<&str>) -> Result<Url, String> {
    let base = format!("{}/functions/v1/manage-integration", supabase_url.trim_end_matches('/'));
    let parsed = match provider {
        Some(p) => Url::parse_with_params(&base, &[("provider", p)]),
        None => Url::parse(&base),
    };
    parsed.map_err(|e| format!("integration_supabase_url_invalid:{e}"))
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
        .post(manage_integration_url(supabase_url, None)?)
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

async fn delete_integration_from_supabase(
    supabase_url: &str,
    access_jwt: &str,
    provider: &str,
) -> Result<(), String> {
    let resp = reqwest::Client::new()
        .delete(manage_integration_url(supabase_url, Some(provider))?)
        .bearer_auth(access_jwt)
        .send()
        .await
        .map_err(|e| format!("integration_supabase_delete_failed:{e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("integration_supabase_delete_error:{text}"));
    }
    Ok(())
}

// ── HTML callback response helper ─────────────────────────────────────────────

fn write_cb_response(mut stream: TcpStream, ok: bool, provider: &str) {
    let (status, body) = if ok {
        (
            "200 OK",
            format!(
                "<html><head><meta name='viewport' content='width=device-width'></head>\
                 <body style='font-family:sans-serif;background:#0e0e0e;color:#d0d0d0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0'>\
                 <div style='text-align:center'><h2 style='color:#5ec97a'>{provider} connected</h2>\
                 <p>You can close this tab and return to Moduo.</p></div></body></html>"
            ),
        )
    } else {
        (
            "400 Bad Request",
            format!(
                "<html><body style='font-family:sans-serif;background:#0e0e0e;color:#d0d0d0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0'>\
                 <div style='text-align:center'><h2 style='color:#c05555'>{provider} connection failed</h2>\
                 <p>You can close this tab and return to Moduo.</p></div></body></html>"
            ),
        )
    };
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

// ── Google Meet (PKCE) ────────────────────────────────────────────────────────

async fn run_google_meet_oauth(
    client_id: &str,
    client_secret: &str,
) -> Result<IntegrationTokens, String> {
    let client_id_owned = client_id.to_string();
    let client_secret_owned = client_secret.to_string();

    // All browser + callback work in a blocking thread (TCP accept loop).
    let cb = tauri::async_runtime::spawn_blocking(move || {
        let verifier = {
            let mut data = vec![0u8; 64];
            rand::fill(&mut data);
            B64URL.encode(&data)
        };
        let challenge = {
            let digest = Sha256::digest(verifier.as_bytes());
            B64URL.encode(digest)
        };
        let state_token = {
            let mut data = vec![0u8; 24];
            rand::fill(&mut data);
            B64URL.encode(&data)
        };

        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|e| format!("gmeet_bind_failed:{e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("gmeet_nonblocking:{e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("gmeet_addr:{e}"))?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");

        let auth_url = Url::parse_with_params(
            "https://accounts.google.com/o/oauth2/v2/auth",
            &[
                ("client_id", client_id_owned.as_str()),
                ("response_type", "code"),
                ("redirect_uri", redirect_uri.as_str()),
                (
                    "scope",
                    "https://www.googleapis.com/auth/calendar.events email profile",
                ),
                ("code_challenge", challenge.as_str()),
                ("code_challenge_method", "S256"),
                ("state", state_token.as_str()),
                ("access_type", "offline"),
                ("prompt", "consent"),
            ],
        )
        .map_err(|e| format!("gmeet_auth_url:{e}"))?
        .to_string();

        webbrowser::open(&auth_url).map_err(|e| format!("gmeet_browser:{e}"))?;

        let deadline = Instant::now() + Duration::from_secs(OAUTH_TIMEOUT_SECS);
        loop {
            if Instant::now() > deadline {
                return Err("gmeet_timeout".to_string());
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let mut buf = [0u8; 8192];
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
                    let n = stream
                        .read(&mut buf)
                        .map_err(|e| format!("gmeet_read:{e}"))?;
                    if n == 0 {
                        continue;
                    }
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let target = request
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .split_whitespace()
                        .nth(1)
                        .ok_or_else(|| "gmeet_invalid_request".to_string())?
                        .to_string();
                    let parsed = Url::parse(&format!("http://localhost{target}"))
                        .map_err(|e| format!("gmeet_parse:{e}"))?;
                    let ps: std::collections::HashMap<_, _> =
                        parsed.query_pairs().into_owned().collect();
                    if let Some(err) = ps.get("error") {
                        write_cb_response(stream, false, "Google Meet");
                        return Err(format!("gmeet_oauth_error:{err}"));
                    }
                    let code = ps
                        .get("code")
                        .cloned()
                        .ok_or_else(|| "gmeet_missing_code".to_string())?;
                    write_cb_response(stream, true, "Google Meet");
                    return Ok((code, redirect_uri, verifier));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("gmeet_accept:{e}")),
            }
        }
    })
    .await
    .map_err(|e| format!("gmeet_join:{e}"))??;

    let (code, redirect_uri, verifier) = cb;

    // Token exchange
    let client_id_again = client_id.to_string();
    let resp = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id_again.as_str()),
            ("client_secret", client_secret_owned.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("gmeet_token_req:{e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("gmeet_token_failed:{text}"));
    }

    let token: FullOAuthTokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("gmeet_token_parse:{e}"))?;

    let expires_at = token.expires_in.map(|s| chrono::Utc::now().timestamp() + s);
    Ok(IntegrationTokens {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at,
    })
}

// ── Zoom (Authorization Code, client_secret) ──────────────────────────────────

async fn run_zoom_oauth(client_id: &str, client_secret: &str) -> Result<IntegrationTokens, String> {
    let client_id_owned = client_id.to_string();
    let client_secret_owned = client_secret.to_string();

    let cb = tauri::async_runtime::spawn_blocking(move || {
        let state_token = {
            let mut data = vec![0u8; 24];
            rand::fill(&mut data);
            B64URL.encode(&data)
        };

        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("zoom_bind:{e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("zoom_nonblocking:{e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("zoom_addr:{e}"))?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");

        let auth_url = Url::parse_with_params(
            "https://zoom.us/oauth/authorize",
            &[
                ("client_id", client_id_owned.as_str()),
                ("response_type", "code"),
                ("redirect_uri", redirect_uri.as_str()),
                ("state", state_token.as_str()),
            ],
        )
        .map_err(|e| format!("zoom_auth_url:{e}"))?
        .to_string();

        webbrowser::open(&auth_url).map_err(|e| format!("zoom_browser:{e}"))?;

        let deadline = Instant::now() + Duration::from_secs(OAUTH_TIMEOUT_SECS);
        loop {
            if Instant::now() > deadline {
                return Err("zoom_timeout".to_string());
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let mut buf = [0u8; 8192];
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
                    let n = stream
                        .read(&mut buf)
                        .map_err(|e| format!("zoom_read:{e}"))?;
                    if n == 0 {
                        continue;
                    }
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let target = request
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .split_whitespace()
                        .nth(1)
                        .ok_or_else(|| "zoom_invalid_request".to_string())?
                        .to_string();
                    let parsed = Url::parse(&format!("http://localhost{target}"))
                        .map_err(|e| format!("zoom_parse:{e}"))?;
                    let ps: std::collections::HashMap<_, _> =
                        parsed.query_pairs().into_owned().collect();
                    if let Some(err) = ps.get("error") {
                        write_cb_response(stream, false, "Zoom");
                        return Err(format!("zoom_oauth_error:{err}"));
                    }
                    let code = ps
                        .get("code")
                        .cloned()
                        .ok_or_else(|| "zoom_missing_code".to_string())?;
                    write_cb_response(stream, true, "Zoom");
                    return Ok((code, redirect_uri, client_id_owned, client_secret_owned));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("zoom_accept:{e}")),
            }
        }
    })
    .await
    .map_err(|e| format!("zoom_join:{e}"))??;

    let (code, redirect_uri, cid, csecret) = cb;

    // Zoom uses Basic auth: base64(client_id:client_secret)
    let credentials = B64.encode(format!("{cid}:{csecret}"));
    let resp = reqwest::Client::new()
        .post("https://zoom.us/oauth/token")
        .header("Authorization", format!("Basic {credentials}"))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("zoom_token_req:{e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("zoom_token_failed:{text}"));
    }

    let token: FullOAuthTokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("zoom_token_parse:{e}"))?;

    let expires_at = token.expires_in.map(|s| chrono::Utc::now().timestamp() + s);
    Ok(IntegrationTokens {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at,
    })
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn integration_connect_zoom(
    state: State<'_, AppState>,
) -> Result<IntegrationStatusItem, String> {
    let config = state.config.clone();
    let (user_id, _) = signed_in(&state)?;

    let client_id = config
        .zoom_client_id
        .as_deref()
        .ok_or_else(|| "missing_zoom_client_id:set MODUO_ZOOM_CLIENT_ID".to_string())?;
    let client_secret = config
        .zoom_client_secret
        .as_deref()
        .ok_or_else(|| "missing_zoom_client_secret:set MODUO_ZOOM_CLIENT_SECRET".to_string())?;

    let tokens = run_zoom_oauth(client_id, client_secret).await?;

    save_tokens_to_keychain(&config.keychain_service, "zoom", &user_id, &tokens)?;

    // The OAuth wait can outlast the session token read above: upload with
    // the one the webview has mirrored since.
    let (still_user, access_jwt) = signed_in(&state)?;
    if still_user != user_id {
        return Err("integration_session_changed".to_string());
    }
    upsert_integration_in_supabase(&config.supabase_url, &access_jwt, "zoom", &tokens).await?;

    Ok(IntegrationStatusItem {
        provider: "zoom".to_string(),
        connected: true,
    })
}

#[tauri::command]
pub async fn integration_connect_google_meet(
    state: State<'_, AppState>,
) -> Result<IntegrationStatusItem, String> {
    let config = state.config.clone();
    let (user_id, _) = signed_in(&state)?;

    let client_id = config.google_meet_client_id.as_deref().ok_or_else(|| {
        "missing_google_meet_client_id:set MODUO_GOOGLE_MEET_CLIENT_ID".to_string()
    })?;
    let client_secret = config.google_meet_client_secret.as_deref().ok_or_else(|| {
        "missing_google_meet_client_secret:set MODUO_GOOGLE_MEET_CLIENT_SECRET".to_string()
    })?;

    let tokens = run_google_meet_oauth(client_id, client_secret).await?;

    save_tokens_to_keychain(&config.keychain_service, "google_meet", &user_id, &tokens)?;

    // The OAuth wait can outlast the session token read above: upload with
    // the one the webview has mirrored since.
    let (still_user, access_jwt) = signed_in(&state)?;
    if still_user != user_id {
        return Err("integration_session_changed".to_string());
    }
    upsert_integration_in_supabase(&config.supabase_url, &access_jwt, "google_meet", &tokens).await?;

    Ok(IntegrationStatusItem {
        provider: "google_meet".to_string(),
        connected: true,
    })
}

#[tauri::command]
pub async fn integration_get_status(
    state: State<'_, AppState>,
) -> Result<Vec<IntegrationStatusItem>, String> {
    let config = state.config.clone();
    let user_id = {
        let guard = state
            .session
            .lock()
            .map_err(|_| "integration_session_lock".to_string())?;
        guard
            .as_ref()
            .map(|s| s.user.id.clone())
            .unwrap_or_default()
    };

    let result = DESKTOP_MEETING_PROVIDERS
        .iter()
        .map(|p| {
            let connected =
                load_tokens_from_keychain(&config.keychain_service, p, &user_id).is_some();
            IntegrationStatusItem {
                provider: p.to_string(),
                connected,
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn integration_disconnect(
    provider: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let config = state.config.clone();
    let (user_id, access_jwt) = signed_in(&state)?;

    // The webview is not trusted: only a known provider, and the user is the
    // session's (MOD-554: an unencoded `provider` once smuggled a user_id).
    let provider = allowed_meeting_provider(&provider)?;
    delete_tokens_from_keychain(&config.keychain_service, provider, &user_id);

    delete_integration_from_supabase(&config.supabase_url, &access_jwt, provider).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disconnect_refuses_providers_it_does_not_connect() {
        assert_eq!(allowed_meeting_provider("zoom"), Ok("zoom"));
        assert_eq!(allowed_meeting_provider("google_meet"), Ok("google_meet"));
        // MOD-554: the webview's `provider` once smuggled a second user_id.
        let victim = "00000000-0000-0000-0000-0000000000bb";
        assert!(allowed_meeting_provider(&format!("zoom&user_id={victim}")).is_err());
        assert!(allowed_meeting_provider("google_calendar").is_err());
        assert!(allowed_meeting_provider("").is_err());
    }

    #[test]
    fn manage_integration_url_encodes_the_provider_and_names_no_user() {
        let url = manage_integration_url("https://x.supabase.co/", Some("zoom&user_id=v")).unwrap();
        let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        assert_eq!(pairs, vec![("provider".to_string(), "zoom&user_id=v".to_string())]);
        assert_eq!(url.path(), "/functions/v1/manage-integration");
        let bare = manage_integration_url("https://x.supabase.co", None).unwrap();
        assert_eq!(bare.as_str(), "https://x.supabase.co/functions/v1/manage-integration");
    }
}
