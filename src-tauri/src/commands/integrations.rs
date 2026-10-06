/// Integration OAuth (Zoom, Google Meet) — connects host accounts so the
/// Next.js booking API can auto-create meeting links on each booking.
///
/// Token flow:
///   1. PKCE or client-secret OAuth via local TCP redirect
///   2. Access + refresh tokens stored in OS keychain (plaintext, private)
///   3. Tokens stored in Supabase `user_integrations` (AES-256-GCM encrypted)
///      so the Next.js server side can decrypt and call provider APIs.
///
/// Encryption key = SHA-256(TOKEN_ENCRYPTION_SECRET ":" user_id) → 32 bytes.
/// On the Next.js side: `crypto.createHash('sha256').update(secret+':'+uid).digest()`
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng as AesOsRng};
use aes_gcm::{Aes256Gcm, Key};
use base64::engine::general_purpose::{STANDARD as B64, URL_SAFE_NO_PAD as B64URL};
use base64::Engine;
use rand::RngCore;
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

// ── AES-256-GCM encryption ────────────────────────────────────────────────────
// Key = SHA256(encryption_secret ":" user_id)   → 32 bytes
// Format stored in Supabase: base64(12-byte nonce || ciphertext+16-byte GCM tag)

fn derive_key(secret: &str, user_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(b":");
    hasher.update(user_id.as_bytes());
    hasher.finalize().into()
}

fn encrypt_token(plaintext: &str, secret: &str, user_id: &str) -> Result<String, String> {
    let key_bytes = derive_key(secret, user_id);
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut AesOsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| format!("integration_encrypt_failed:{e}"))?;
    let mut blob = nonce.to_vec();
    blob.extend_from_slice(&ciphertext);
    Ok(B64.encode(blob))
}

// ── Supabase upsert ───────────────────────────────────────────────────────────

pub(crate) async fn upsert_integration_in_supabase(
    supabase_url: &str,
    shared_secret: &str,
    user_id: &str,
    provider: &str,
    tokens: &IntegrationTokens,
    encryption_secret: &str,
) -> Result<(), String> {
    let access_enc = encrypt_token(&tokens.access_token, encryption_secret, user_id)?;
    let refresh_enc = tokens
        .refresh_token
        .as_deref()
        .map(|rt| encrypt_token(rt, encryption_secret, user_id))
        .transpose()?;

    let expiry_iso = tokens.expires_at.map(|ts| {
        chrono::DateTime::from_timestamp(ts, 0)
            .unwrap_or_default()
            .to_rfc3339()
    });

    let body = serde_json::json!({
        "user_id": user_id,
        "provider": provider,
        "access_token_enc": access_enc,
        "refresh_token_enc": refresh_enc,
        "token_expiry": expiry_iso,
        "updated_at": chrono::Utc::now().to_rfc3339(),
    });

    let url = format!("{supabase_url}/functions/v1/manage-integration");
    let resp = reqwest::Client::new()
        .post(&url)
        .header("X-Moduo-Secret", shared_secret)
        .header("Content-Type", "application/json")
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
    shared_secret: &str,
    user_id: &str,
    provider: &str,
) -> Result<(), String> {
    let url = format!(
        "{supabase_url}/functions/v1/manage-integration?provider={provider}&user_id={user_id}"
    );
    let client = reqwest::Client::new();
    let resp = client
        .delete(&url)
        .header("X-Moduo-Secret", shared_secret)
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
            rand::rngs::OsRng.fill_bytes(&mut data);
            B64URL.encode(&data)
        };
        let challenge = {
            let digest = Sha256::digest(verifier.as_bytes());
            B64URL.encode(digest)
        };
        let state_token = {
            let mut data = vec![0u8; 24];
            rand::rngs::OsRng.fill_bytes(&mut data);
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
            rand::rngs::OsRng.fill_bytes(&mut data);
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
    let user_id = {
        let guard = state
            .session
            .lock()
            .map_err(|_| "integration_session_lock".to_string())?;
        guard
            .as_ref()
            .map(|s| s.user.id.clone())
            .ok_or_else(|| "integration_not_signed_in".to_string())?
    };

    let client_id = config
        .zoom_client_id
        .as_deref()
        .ok_or_else(|| "missing_zoom_client_id:set MODUO_ZOOM_CLIENT_ID".to_string())?;
    let client_secret = config
        .zoom_client_secret
        .as_deref()
        .ok_or_else(|| "missing_zoom_client_secret:set MODUO_ZOOM_CLIENT_SECRET".to_string())?;
    let enc_secret = config
        .token_encryption_secret
        .as_deref()
        .ok_or_else(|| "missing_token_enc_secret:set MODUO_TOKEN_ENCRYPTION_SECRET".to_string())?;

    let tokens = run_zoom_oauth(client_id, client_secret).await?;

    save_tokens_to_keychain(&config.keychain_service, "zoom", &user_id, &tokens)?;

    upsert_integration_in_supabase(
        &config.supabase_url,
        enc_secret,
        &user_id,
        "zoom",
        &tokens,
        enc_secret,
    )
    .await?;

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
    let user_id = {
        let guard = state
            .session
            .lock()
            .map_err(|_| "integration_session_lock".to_string())?;
        guard
            .as_ref()
            .map(|s| s.user.id.clone())
            .ok_or_else(|| "integration_not_signed_in".to_string())?
    };

    let client_id = config.google_meet_client_id.as_deref().ok_or_else(|| {
        "missing_google_meet_client_id:set MODUO_GOOGLE_MEET_CLIENT_ID".to_string()
    })?;
    let client_secret = config.google_meet_client_secret.as_deref().ok_or_else(|| {
        "missing_google_meet_client_secret:set MODUO_GOOGLE_MEET_CLIENT_SECRET".to_string()
    })?;
    let enc_secret = config
        .token_encryption_secret
        .as_deref()
        .ok_or_else(|| "missing_token_enc_secret:set MODUO_TOKEN_ENCRYPTION_SECRET".to_string())?;

    let tokens = run_google_meet_oauth(client_id, client_secret).await?;

    save_tokens_to_keychain(&config.keychain_service, "google_meet", &user_id, &tokens)?;

    upsert_integration_in_supabase(
        &config.supabase_url,
        enc_secret,
        &user_id,
        "google_meet",
        &tokens,
        enc_secret,
    )
    .await?;

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

    let providers = ["zoom", "google_meet"];
    let result = providers
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
    let user_id = {
        let guard = state
            .session
            .lock()
            .map_err(|_| "integration_session_lock".to_string())?;
        guard
            .as_ref()
            .map(|s| s.user.id.clone())
            .ok_or_else(|| "integration_not_signed_in".to_string())?
    };
    let enc_secret = config
        .token_encryption_secret
        .as_deref()
        .ok_or_else(|| "missing_token_enc_secret:set MODUO_TOKEN_ENCRYPTION_SECRET".to_string())?;

    delete_tokens_from_keychain(&config.keychain_service, &provider, &user_id);

    delete_integration_from_supabase(&config.supabase_url, enc_secret, &user_id, &provider).await?;

    Ok(())
}
