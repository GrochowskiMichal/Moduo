use serde::{Deserialize, Serialize};
use tauri::State;
use url::Url;

use super::oauth_flow::{
    refresh_access_token, run_oauth_authorization_code_flow, should_refresh, OAuthRefreshError,
    OAuthTokenResponse,
};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOAuthCalendar {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOAuthStartResult {
    pub account_id: String,
    pub email: String,
    pub display_name: String,
    pub calendars: Vec<CalendarOAuthCalendar>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfoResponse {
    email: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarListResponse {
    items: Option<Vec<GoogleCalendarItem>>,
}

#[derive(Debug, Deserialize)]
struct GoogleCalendarItem {
    id: Option<String>,
    summary: Option<String>,
    #[serde(rename = "backgroundColor")]
    background_color: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MicrosoftMeResponse {
    #[serde(rename = "userPrincipalName")]
    user_principal_name: Option<String>,
    mail: Option<String>,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MicrosoftCalendarsResponse {
    value: Vec<MicrosoftCalendarItem>,
}

#[derive(Debug, Deserialize)]
struct MicrosoftCalendarItem {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "hexColor")]
    hex_color: Option<String>,
}

fn current_user_id(state: &AppState) -> String {
    state
        .session
        .lock()
        .ok()
        .and_then(|v| v.as_ref().map(|s| s.user.id.clone()))
        .unwrap_or_else(|| "local".to_string())
}

fn calendar_keychain_account(provider: &str, user_id: &str, account_id: &str) -> String {
    format!("calendar_{provider}_{user_id}_{account_id}")
}

const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const MICROSOFT_TOKEN_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
/// Microsoft's refresh grant names its scopes again; Google's keeps the granted ones.
const MICROSOFT_CALENDAR_SCOPES: &str = "offline_access User.Read Calendars.Read";
/// Refresh this long before the access token runs out.
const CALENDAR_REFRESH_SKEW_SECS: i64 = 120;

/// What the keychain holds for a calendar login: the provider's token response
/// plus when its access token runs out. Entries saved before `expires_at` existed
/// read as `None` (refresh on first use).
#[derive(Serialize, Deserialize, Clone)]
struct StoredCalendarTokens {
    #[serde(flatten)]
    tokens: OAuthTokenResponse,
    #[serde(default)]
    expires_at: Option<i64>,
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

fn save_calendar_tokens_to_keychain(
    service: &str,
    provider: &str,
    user_id: &str,
    account_id: &str,
    tokens: &OAuthTokenResponse,
) -> Result<(), String> {
    let stored = StoredCalendarTokens {
        tokens: tokens.clone(),
        expires_at: Some(now_secs() + tokens.expires_in.unwrap_or(3600)),
    };
    let encoded = serde_json::to_string(&stored)
        .map_err(|e| format!("calendar_keychain_serialize_failed:{e}"))?;
    crate::keychain::set_secret(
        service,
        &calendar_keychain_account(provider, user_id, account_id),
        &encoded,
    )
    .map_err(|e| format!("calendar_keychain_save_failed:{e}"))
}

fn load_calendar_tokens_from_keychain(
    service: &str,
    provider: &str,
    user_id: &str,
    account_id: &str,
) -> Option<OAuthTokenResponse> {
    let raw = crate::keychain::get_secret(
        service,
        &calendar_keychain_account(provider, user_id, account_id),
    )
    .ok()
    .flatten()?;
    serde_json::from_str::<OAuthTokenResponse>(&raw).ok()
}

fn load_stored_calendar_tokens(
    service: &str,
    provider: &str,
    user_id: &str,
    account_id: &str,
) -> Option<StoredCalendarTokens> {
    let raw = crate::keychain::get_secret(
        service,
        &calendar_keychain_account(provider, user_id, account_id),
    )
    .ok()
    .flatten()?;
    serde_json::from_str::<StoredCalendarTokens>(&raw).ok()
}

/// What to do with a stored token before a sync: use it, or refresh it first.
fn needs_refresh(stored: &StoredCalendarTokens, now: i64) -> bool {
    match stored.expires_at {
        Some(expires_at) => should_refresh(expires_at, now, CALENDAR_REFRESH_SKEW_SECS),
        // Saved before expires_at was kept: its age is unknown, so refresh once.
        None => true,
    }
}

/// A calendar login's access token, refreshed and saved back when it is about to
/// run out. Access tokens last about an hour, so without this every sync after
/// the first hour failed. A revoked sign-in answers `<provider>_calendar_reauth`
/// (reconnect); a refresh that fails for any other reason (offline, a 5xx) is a
/// transient error, and a token of unknown age is tried as is.
async fn calendar_access_token(
    state: &AppState,
    provider: &str,
    account_id: &str,
) -> Result<String, String> {
    let user_id = current_user_id(state);
    let service = &state.config.keychain_service;
    let label = if provider == "microsoft" { "outlook" } else { "google" };
    let Some(stored) = load_stored_calendar_tokens(service, provider, &user_id, account_id) else {
        return Err(format!(
            "{label}_calendar_missing_tokens:reconnect_{label}_account"
        ));
    };
    if stored.tokens.access_token.trim().is_empty() {
        return Err(format!(
            "{label}_calendar_missing_access_token:reconnect_{label}_account"
        ));
    }
    let now = now_secs();
    if !needs_refresh(&stored, now) {
        return Ok(stored.tokens.access_token);
    }
    let unknown_age = stored.expires_at.is_none();
    let Some(refresh) = stored.tokens.refresh_token.clone().filter(|t| !t.is_empty()) else {
        return if unknown_age {
            Ok(stored.tokens.access_token)
        } else {
            Err(format!("{label}_calendar_reauth:reconnect_{label}_account"))
        };
    };
    let (endpoint, client_id, client_secret, scope) = if provider == "microsoft" {
        (
            MICROSOFT_TOKEN_ENDPOINT,
            state.config.calendar_microsoft_client_id.clone(),
            None,
            Some(MICROSOFT_CALENDAR_SCOPES),
        )
    } else {
        (
            GOOGLE_TOKEN_ENDPOINT,
            state.config.calendar_google_client_id.clone(),
            state.config.calendar_google_client_secret.clone(),
            None,
        )
    };
    // A build without the client can't refresh: the stored token is all there is.
    let Some(client_id) = client_id else {
        return Ok(stored.tokens.access_token);
    };
    match refresh_access_token(endpoint, &client_id, client_secret.as_deref(), &refresh, scope)
        .await
    {
        Ok(fresh) => {
            // Google's refresh answer omits refresh_token; Microsoft rotates it.
            let kept = OAuthTokenResponse {
                refresh_token: fresh.refresh_token.clone().or(Some(refresh)),
                ..fresh
            };
            save_calendar_tokens_to_keychain(service, provider, &user_id, account_id, &kept)?;
            Ok(kept.access_token)
        }
        Err(OAuthRefreshError::InvalidGrant) => {
            Err(format!("{label}_calendar_reauth:reconnect_{label}_account"))
        }
        Err(OAuthRefreshError::Other(err)) => {
            if unknown_age {
                Ok(stored.tokens.access_token)
            } else {
                Err(err)
            }
        }
    }
}

fn google_calendar_events_url(calendar_id: &str) -> Result<Url, String> {
    let mut url = Url::parse("https://www.googleapis.com/calendar/v3/calendars/")
        .map_err(|e| format!("google_url_parse_failed:{e}"))?;
    {
        let mut segs = url
            .path_segments_mut()
            .map_err(|_| "google_url_invalid_base".to_string())?;
        segs.pop_if_empty();
        segs.push(calendar_id);
        segs.push("events");
    }
    Ok(url)
}

#[tauri::command]
pub async fn calendar_google_oauth_start(
    state: State<'_, AppState>,
) -> Result<CalendarOAuthStartResult, String> {
    let client_id = state
        .config
        .calendar_google_client_id
        .as_deref()
        .ok_or_else(|| {
            "missing_google_client_id:set MODUO_CALENDAR_GOOGLE_CLIENT_ID".to_string()
        })?;

    let client_secret = state.config.calendar_google_client_secret.as_deref();

    let token = run_oauth_authorization_code_flow(
        "https://accounts.google.com/o/oauth2/v2/auth",
        "https://oauth2.googleapis.com/token",
        client_id,
        client_secret,
        &[
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/calendar.events",
        ],
        "Calendar",
    )
    .await?;

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
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| "google_userinfo_missing_email".to_string())?;
    let display_name = user
        .name
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| email.clone());

    let calendars_resp = client
        .get("https://www.googleapis.com/calendar/v3/users/me/calendarList")
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|e| format!("google_calendars_request_failed:{e}"))?;
    if !calendars_resp.status().is_success() {
        let body = calendars_resp.text().await.unwrap_or_default();
        return Err(format!("google_calendars_failed:{body}"));
    }
    let payload = calendars_resp
        .json::<GoogleCalendarListResponse>()
        .await
        .map_err(|e| format!("google_calendars_parse_failed:{e}"))?;

    let calendars = payload
        .items
        .unwrap_or_default()
        .into_iter()
        .enumerate()
        .filter_map(|(idx, cal)| {
            let id = cal.id?;
            let name = cal
                .summary
                .unwrap_or_else(|| format!("Google Calendar {}", idx + 1));
            let color = cal
                .background_color
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "#3a3a3a".to_string());
            Some(CalendarOAuthCalendar {
                id: format!("google:{email}:{id}"),
                name,
                color,
            })
        })
        .collect::<Vec<_>>();

    let account_id = format!("google:{email}");
    let user_id = current_user_id(&state);
    save_calendar_tokens_to_keychain(
        &state.config.keychain_service,
        "google",
        &user_id,
        &account_id,
        &token,
    )?;

    Ok(CalendarOAuthStartResult {
        account_id,
        email: email.clone(),
        display_name,
        calendars,
    })
}

#[tauri::command]
pub async fn calendar_outlook_oauth_start(
    state: State<'_, AppState>,
) -> Result<CalendarOAuthStartResult, String> {
    let client_id = state
        .config
        .calendar_microsoft_client_id
        .as_deref()
        .ok_or_else(|| {
            "missing_microsoft_client_id:set MODUO_CALENDAR_MICROSOFT_CLIENT_ID".to_string()
        })?;

    let token = run_oauth_authorization_code_flow(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        client_id,
        None,
        &["offline_access", "User.Read", "Calendars.Read"],
        "Calendar",
    )
    .await?;

    let client = reqwest::Client::new();
    let me = client
        .get("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName")
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|e| format!("microsoft_me_request_failed:{e}"))?;
    if !me.status().is_success() {
        let body = me.text().await.unwrap_or_default();
        return Err(format!("microsoft_me_failed:{body}"));
    }
    let me = me
        .json::<MicrosoftMeResponse>()
        .await
        .map_err(|e| format!("microsoft_me_parse_failed:{e}"))?;
    let email = me
        .mail
        .filter(|value| !value.trim().is_empty())
        .or(me.user_principal_name.clone())
        .ok_or_else(|| "microsoft_me_missing_email".to_string())?;
    let display_name = me
        .display_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| email.clone());

    let calendars_resp = client
        .get("https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,hexColor")
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|e| format!("microsoft_calendars_request_failed:{e}"))?;
    if !calendars_resp.status().is_success() {
        let body = calendars_resp.text().await.unwrap_or_default();
        return Err(format!("microsoft_calendars_failed:{body}"));
    }
    let payload = calendars_resp
        .json::<MicrosoftCalendarsResponse>()
        .await
        .map_err(|e| format!("microsoft_calendars_parse_failed:{e}"))?;

    let calendars = payload
        .value
        .into_iter()
        .enumerate()
        .filter_map(|(idx, cal)| {
            let id = cal.id?;
            let name = cal
                .name
                .unwrap_or_else(|| format!("Outlook Calendar {}", idx + 1));
            let color = cal
                .hex_color
                .filter(|value| !value.trim().is_empty())
                .map(|value| {
                    if value.starts_with('#') {
                        value
                    } else {
                        format!("#{value}")
                    }
                })
                .unwrap_or_else(|| "#3a3a3a".to_string());
            Some(CalendarOAuthCalendar {
                id: format!("outlook:{email}:{id}"),
                name,
                color,
            })
        })
        .collect::<Vec<_>>();

    let account_id = format!("outlook:{email}");
    let user_id = current_user_id(&state);
    save_calendar_tokens_to_keychain(
        &state.config.keychain_service,
        "microsoft",
        &user_id,
        &account_id,
        &token,
    )?;

    Ok(CalendarOAuthStartResult {
        account_id,
        email: email.clone(),
        display_name,
        calendars,
    })
}

#[tauri::command]
pub async fn calendar_google_events_sync(
    state: State<'_, AppState>,
    account_id: String,
    time_min: String,
    time_max: String,
) -> Result<Vec<serde_json::Value>, String> {
    let access_token = calendar_access_token(&state, "google", &account_id).await?;
    let client = reqwest::Client::new();

    // Fetch the account's calendarList so we iterate every calendar.
    let calendars_resp = client
        .get("https://www.googleapis.com/calendar/v3/users/me/calendarList")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("google_calendars_request_failed:{e}"))?;
    if !calendars_resp.status().is_success() {
        let body = calendars_resp.text().await.unwrap_or_default();
        return Err(format!("google_calendars_failed:{body}"));
    }
    let calendar_list = calendars_resp
        .json::<GoogleCalendarListResponse>()
        .await
        .map_err(|e| format!("google_calendars_parse_failed:{e}"))?;

    // account_id has the form `google:{email}`, and the OAuth flow attributes
    // calendars as `google:{email}:{calendarId}` — reuse account_id as the prefix
    // so the TS mapper's calendarId matches exactly.
    let mut results: Vec<serde_json::Value> = Vec::new();

    for cal in calendar_list.items.unwrap_or_default() {
        let Some(cal_id) = cal.id.filter(|v| !v.trim().is_empty()) else {
            continue;
        };
        let source_id = format!("{account_id}:{cal_id}");

        let mut page_token: Option<String> = None;
        loop {
            let url = google_calendar_events_url(&cal_id)?;
            let mut req = client.get(url).bearer_auth(&access_token).query(&[
                ("timeMin", time_min.as_str()),
                ("timeMax", time_max.as_str()),
                ("singleEvents", "true"),
                ("orderBy", "startTime"),
                ("maxResults", "2500"),
                ("showDeleted", "false"),
            ]);
            if let Some(ref token) = page_token {
                req = req.query(&[("pageToken", token.as_str())]);
            }
            let resp = req
                .send()
                .await
                .map_err(|e| format!("google_events_request_failed:{e}"))?;
            if !resp.status().is_success() {
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("google_events_failed:{body}"));
            }
            let payload = resp
                .json::<serde_json::Value>()
                .await
                .map_err(|e| format!("google_events_parse_failed:{e}"))?;

            if let Some(items) = payload.get("items").and_then(|v| v.as_array()) {
                for item in items {
                    let mut event = item.clone();
                    if let Some(obj) = event.as_object_mut() {
                        obj.insert(
                            "calendarId".to_string(),
                            serde_json::Value::String(source_id.clone()),
                        );
                    }
                    results.push(event);
                }
            }

            page_token = payload
                .get("nextPageToken")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if page_token.is_none() {
                break;
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn calendar_outlook_events_sync(
    state: State<'_, AppState>,
    account_id: String,
    time_min: String,
    time_max: String,
) -> Result<Vec<serde_json::Value>, String> {
    let access_token = calendar_access_token(&state, "microsoft", &account_id).await?;
    let client = reqwest::Client::new();

    // Fetch the account's calendar list so we iterate every calendar.
    let calendars_resp = client
        .get("https://graph.microsoft.com/v1.0/me/calendars?$select=id,name")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("microsoft_calendars_request_failed:{e}"))?;
    if !calendars_resp.status().is_success() {
        let body = calendars_resp.text().await.unwrap_or_default();
        return Err(format!("microsoft_calendars_failed:{body}"));
    }
    let calendar_list = calendars_resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("microsoft_calendars_parse_failed:{e}"))?;

    let calendar_ids: Vec<String> = calendar_list
        .get("value")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("id")
                        .and_then(|v| v.as_str())
                        .filter(|v| !v.trim().is_empty())
                        .map(|v| v.to_string())
                })
                .collect()
        })
        .unwrap_or_default();

    let mut results: Vec<serde_json::Value> = Vec::new();

    for cal_id in calendar_ids {
        // account_id has the form `outlook:{email}`, and the OAuth flow attributes
        // calendars as `outlook:{email}:{calendarId}` — reuse account_id as the prefix.
        let source_id = format!("{account_id}:{cal_id}");

        let mut next_link: Option<String> = None;
        loop {
            let resp = if let Some(ref link) = next_link {
                client
                    .get(link)
                    .bearer_auth(&access_token)
                    .header("Prefer", "outlook.timezone=\"UTC\"")
                    .send()
                    .await
            } else {
                let url = format!(
                    "https://graph.microsoft.com/v1.0/me/calendars/{cal_id}/calendarView"
                );
                client
                    .get(&url)
                    .bearer_auth(&access_token)
                    .header("Prefer", "outlook.timezone=\"UTC\"")
                    .query(&[
                        ("startDateTime", time_min.as_str()),
                        ("endDateTime", time_max.as_str()),
                        ("$top", "250"),
                    ])
                    .send()
                    .await
            }
            .map_err(|e| format!("microsoft_events_request_failed:{e}"))?;

            if !resp.status().is_success() {
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("microsoft_events_failed:{body}"));
            }
            let payload = resp
                .json::<serde_json::Value>()
                .await
                .map_err(|e| format!("microsoft_events_parse_failed:{e}"))?;

            if let Some(items) = payload.get("value").and_then(|v| v.as_array()) {
                for item in items {
                    let mut event = item.clone();
                    if let Some(obj) = event.as_object_mut() {
                        obj.insert(
                            "calendarId".to_string(),
                            serde_json::Value::String(source_id.clone()),
                        );
                    }
                    results.push(event);
                }
            }

            next_link = payload
                .get("@odata.nextLink")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if next_link.is_none() {
                break;
            }
        }
    }

    Ok(results)
}

/// Copy the desktop Google Calendar refresh token into `user_integrations`
/// (`provider = google_calendar`) so a guest can book while this app is closed.
#[tauri::command]
pub async fn calendar_google_publish_booking_token(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<(), String> {
    let user_id = current_user_id(&state);
    if user_id == "local" {
        return Err("sign_in_required".to_string());
    }
    let stored = load_calendar_tokens_from_keychain(
        &state.config.keychain_service,
        "google",
        &user_id,
        &account_id,
    )
    .ok_or_else(|| "google_calendar_not_connected".to_string())?;
    let refresh = stored
        .refresh_token
        .clone()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "google_calendar_needs_reconnect".to_string())?;
    let enc_secret = state
        .config
        .token_encryption_secret
        .as_deref()
        .ok_or_else(|| "missing_token_enc_secret:set MODUO_TOKEN_ENCRYPTION_SECRET".to_string())?;
    let expires_at = stored
        .expires_in
        .map(|secs| chrono::Utc::now().timestamp() + secs);
    crate::commands::integrations::upsert_integration_in_supabase(
        &state.config.supabase_url,
        enc_secret,
        &user_id,
        "google_calendar",
        &crate::commands::integrations::IntegrationTokens {
            access_token: stored.access_token,
            refresh_token: Some(refresh),
            expires_at,
        },
        enc_secret,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(expires_at: Option<i64>) -> StoredCalendarTokens {
        StoredCalendarTokens {
            tokens: OAuthTokenResponse {
                access_token: "access".to_string(),
                refresh_token: Some("refresh".to_string()),
                expires_in: Some(3600),
                token_type: Some("Bearer".to_string()),
                scope: None,
            },
            expires_at,
        }
    }

    #[test]
    fn a_keychain_entry_saved_before_expires_at_still_reads() {
        let old = r#"{"access_token":"a","refresh_token":"r","expires_in":3599,"token_type":"Bearer","scope":null}"#;
        let parsed: StoredCalendarTokens = serde_json::from_str(old).expect("old entry parses");
        assert_eq!(parsed.tokens.access_token, "a");
        assert_eq!(parsed.expires_at, None);
        // …and the plain token response still reads a new entry (the booking upload uses it).
        let new = serde_json::to_string(&stored(Some(10))).expect("serializes");
        let plain: OAuthTokenResponse = serde_json::from_str(&new).expect("new entry parses");
        assert_eq!(plain.refresh_token.as_deref(), Some("refresh"));
        assert!(new.contains("\"expires_at\":10"));
    }

    #[test]
    fn a_token_is_refreshed_near_expiry_and_when_its_age_is_unknown() {
        assert!(!needs_refresh(&stored(Some(10_000)), 1_000));
        assert!(needs_refresh(&stored(Some(1_100)), 1_000));
        assert!(needs_refresh(&stored(Some(900)), 1_000));
        assert!(needs_refresh(&stored(None), 1_000));
    }
}
