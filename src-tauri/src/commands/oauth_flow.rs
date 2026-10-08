//! Shared Google/Microsoft OAuth 2.0 PKCE machinery.
//!
//! Extracted from `calendar.rs` (EM-2) so both the calendar sync and the Gmail
//! email connect share ONE loopback-redirect PKCE flow. The email module adds two
//! things the calendar path never had: **token refresh** (`refresh_access_token`,
//! calendar previously only ever read the first access token) and the **XOAUTH2**
//! SASL string for IMAP/SMTP.
//!
//! The pure helpers (`should_refresh`, `xoauth2_sasl`) are unit-tested; the flow
//! itself is exercised by the manual OAuth smoke (headless-incompatible — it opens
//! a browser).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

const OAUTH_TIMEOUT_SECS: u64 = 180;

/// The token payload returned by the authorization-code exchange (and by a
/// refresh). A refresh response typically omits `refresh_token` — callers keep the
/// original.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub(crate) struct OAuthTokenResponse {
    pub(crate) access_token: String,
    pub(crate) refresh_token: Option<String>,
    pub(crate) expires_in: Option<i64>,
    pub(crate) token_type: Option<String>,
    pub(crate) scope: Option<String>,
}

#[derive(Debug)]
struct OAuthCallbackResult {
    code: String,
    redirect_uri: String,
}

/// Why a refresh failed. `InvalidGrant` is terminal — the refresh token was
/// revoked/expired (Google testing-mode 7-day cap), so the account must be
/// reconnected. `Other` is transient (network / 5xx) and must NOT flip the account
/// to `reauth_required`.
#[derive(Debug)]
pub(crate) enum OAuthRefreshError {
    InvalidGrant,
    Other(String),
}

fn random_b64url(bytes: usize) -> String {
    let mut data = vec![0u8; bytes];
    rand::fill(&mut data);
    URL_SAFE_NO_PAD.encode(data)
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn write_callback_response(mut stream: TcpStream, body: &str, status: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Run a loopback-redirect PKCE authorization-code flow and return the token
/// response. `flow_label` names the product in the browser callback page
/// ("Calendar" / "Email").
pub(crate) async fn run_oauth_authorization_code_flow(
    auth_endpoint: &str,
    token_endpoint: &str,
    client_id: &str,
    client_secret: Option<&str>,
    scopes: &[&str],
    flow_label: &str,
) -> Result<OAuthTokenResponse, String> {
    let verifier = random_b64url(64);
    let challenge = pkce_challenge(&verifier);
    let client_id_owned = client_id.to_string();
    let auth_endpoint_owned = auth_endpoint.to_string();
    let scopes_owned = scopes
        .iter()
        .map(|scope| scope.to_string())
        .collect::<Vec<_>>();
    let challenge_owned = challenge.clone();
    let label = flow_label.to_string();
    let callback = tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("oauth_callback_bind_failed:{e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("oauth_callback_config_failed:{e}"))?;
        let callback_port = listener
            .local_addr()
            .map_err(|e| format!("oauth_callback_addr_failed:{e}"))?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{callback_port}/oauth/callback");
        let state = random_b64url(24);

        let scope_value = scopes_owned.join(" ");
        let auth_url = Url::parse_with_params(
            &auth_endpoint_owned,
            &[
                ("client_id", client_id_owned.as_str()),
                ("response_type", "code"),
                ("redirect_uri", redirect_uri.as_str()),
                ("scope", scope_value.as_str()),
                ("code_challenge", challenge_owned.as_str()),
                ("code_challenge_method", "S256"),
                ("state", state.as_str()),
                ("access_type", "offline"),
                ("prompt", "consent"),
            ],
        )
        .map_err(|e| format!("oauth_auth_url_failed:{e}"))?
        .to_string();

        webbrowser::open(&auth_url).map_err(|e| format!("oauth_browser_open_failed:{e}"))?;

        let deadline = Instant::now() + Duration::from_secs(OAUTH_TIMEOUT_SECS);
        loop {
            if Instant::now() > deadline {
                return Err("oauth_callback_timeout".to_string());
            }

            match listener.accept() {
                Ok((mut stream, _addr)) => {
                    let mut buffer = [0u8; 8192];
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
                    let read_size = stream
                        .read(&mut buffer)
                        .map_err(|e| format!("oauth_callback_read_failed:{e}"))?;
                    if read_size == 0 {
                        continue;
                    }
                    let request = String::from_utf8_lossy(&buffer[..read_size]);
                    let request_line = request.lines().next().unwrap_or_default();
                    let target = request_line
                        .split_whitespace()
                        .nth(1)
                        .ok_or_else(|| "oauth_callback_invalid_request".to_string())?;
                    let parsed = Url::parse(&format!("http://localhost{target}"))
                        .map_err(|e| format!("oauth_callback_parse_failed:{e}"))?;
                    let params = parsed
                        .query_pairs()
                        .into_owned()
                        .collect::<std::collections::HashMap<_, _>>();

                    if let Some(error) = params.get("error") {
                        write_callback_response(
                            stream,
                            &format!("<html><body><h3>{label} connection failed</h3><p>You can close this tab and return to Moduo.</p></body></html>"),
                            "400 Bad Request",
                        );
                        return Err(format!("oauth_provider_error:{error}"));
                    }

                    let returned_state = params
                        .get("state")
                        .cloned()
                        .ok_or_else(|| "oauth_callback_missing_state".to_string())?;
                    if returned_state != state {
                        write_callback_response(
                            stream,
                            &format!("<html><body><h3>{label} connection failed</h3><p>State mismatch. You can close this tab.</p></body></html>"),
                            "400 Bad Request",
                        );
                        return Err("oauth_state_mismatch".to_string());
                    }

                    let code = params
                        .get("code")
                        .cloned()
                        .ok_or_else(|| "oauth_callback_missing_code".to_string())?;

                    write_callback_response(
                        stream,
                        &format!("<html><body><h3>{label} connected</h3><p>You can close this tab and return to Moduo.</p></body></html>"),
                        "200 OK",
                    );
                    return Ok(OAuthCallbackResult { code, redirect_uri });
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(err) => return Err(format!("oauth_callback_accept_failed:{err}")),
            }
        }
    })
    .await
    .map_err(|e| format!("oauth_callback_join_failed:{e}"))??;

    let client = reqwest::Client::new();
    let mut form_params: Vec<(&str, &str)> = vec![
        ("client_id", client_id),
        ("grant_type", "authorization_code"),
        ("code", callback.code.as_str()),
        ("redirect_uri", callback.redirect_uri.as_str()),
        ("code_verifier", verifier.as_str()),
    ];
    let secret_owned = client_secret.map(|s| s.to_string());
    if let Some(ref s) = secret_owned {
        form_params.push(("client_secret", s.as_str()));
    }
    let token = client
        .post(token_endpoint)
        .form(&form_params)
        .send()
        .await
        .map_err(|e| format!("oauth_token_request_failed:{e}"))?;

    if !token.status().is_success() {
        let body = token.text().await.unwrap_or_default();
        return Err(format!("oauth_token_exchange_failed:{body}"));
    }

    token
        .json::<OAuthTokenResponse>()
        .await
        .map_err(|e| format!("oauth_token_parse_failed:{e}"))
}

/// Exchange a refresh token for a fresh access token. Google's refresh response
/// omits `refresh_token` — the caller preserves the stored one. A `400
/// invalid_grant` maps to [`OAuthRefreshError::InvalidGrant`] (terminal → reauth).
pub(crate) async fn refresh_access_token(
    token_endpoint: &str,
    client_id: &str,
    client_secret: Option<&str>,
    refresh_token: &str,
) -> Result<OAuthTokenResponse, OAuthRefreshError> {
    let client = reqwest::Client::new();
    let mut form_params: Vec<(&str, &str)> = vec![
        ("client_id", client_id),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
    ];
    if let Some(secret) = client_secret {
        form_params.push(("client_secret", secret));
    }
    let resp = client
        .post(token_endpoint)
        .form(&form_params)
        .send()
        .await
        .map_err(|e| OAuthRefreshError::Other(format!("oauth_refresh_request_failed:{e}")))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        // Google returns 400 + `{"error":"invalid_grant"}` when the refresh token
        // is revoked/expired — the only terminal case (everything else is retryable).
        if body.contains("invalid_grant") {
            return Err(OAuthRefreshError::InvalidGrant);
        }
        return Err(OAuthRefreshError::Other(format!(
            "oauth_refresh_failed:{status}:{body}"
        )));
    }

    resp.json::<OAuthTokenResponse>()
        .await
        .map_err(|e| OAuthRefreshError::Other(format!("oauth_refresh_parse_failed:{e}")))
}

/// Whether a cached access token should be refreshed: true once we're within
/// `skew_secs` of the absolute expiry (or already past it). Pure — the refresh
/// decision is unit-testable without a network.
pub(crate) fn should_refresh(expires_at: i64, now: i64, skew_secs: i64) -> bool {
    now.saturating_add(skew_secs) >= expires_at
}

/// The SASL `XOAUTH2` initial-response string for IMAP/SMTP. The `imap` crate and
/// lettre both base64-encode this themselves, so we return the RAW SASL string
/// (`user=<addr>\x01auth=Bearer <token>\x01\x01`).
pub(crate) fn xoauth2_sasl(user: &str, access_token: &str) -> String {
    format!("user={user}\x01auth=Bearer {access_token}\x01\x01")
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;

    #[test]
    fn should_refresh_within_skew_window() {
        // Expired already → refresh.
        assert!(should_refresh(1_000, 1_000, 120));
        assert!(should_refresh(1_000, 2_000, 120));
        // Comfortably valid → don't.
        assert!(!should_refresh(10_000, 1_000, 120));
        // Inside the 120s skew of expiry → refresh proactively.
        assert!(should_refresh(1_120, 1_000, 120));
        assert!(!should_refresh(1_121, 1_000, 120));
    }

    #[test]
    fn xoauth2_sasl_is_rfc_shaped_and_base64_round_trips() {
        let sasl = xoauth2_sasl("me@gmail.com", "ya29.TOKEN");
        assert_eq!(sasl, "user=me@gmail.com\x01auth=Bearer ya29.TOKEN\x01\x01");
        // The control bytes are the SASL separators, and the string base64-decodes
        // back to itself (what the server sees after the transport encodes it).
        let encoded = BASE64_STANDARD.encode(&sasl);
        let decoded = BASE64_STANDARD.decode(encoded).unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), sasl);
    }
}
