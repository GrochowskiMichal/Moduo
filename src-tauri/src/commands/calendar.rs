use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use url::Url;

use crate::AppState;

const OAUTH_TIMEOUT_SECS: u64 = 180;

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

#[derive(Debug)]
struct OAuthCallbackResult {
    code: String,
    redirect_uri: String,
}

#[derive(Debug, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    token_type: Option<String>,
    scope: Option<String>,
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
struct GoogleEventsListResponse {
    items: Option<Vec<GoogleEventItem>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleEventItem {
    id: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    location: Option<String>,
    status: Option<String>,
    start: Option<GoogleEventDateTime>,
    end: Option<GoogleEventDateTime>,
    #[serde(rename = "iCalUID")]
    ical_uid: Option<String>,
    updated: Option<String>,
    created: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleEventDateTime {
    date: Option<String>,
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
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

fn save_calendar_tokens_to_keychain(
    service: &str,
    provider: &str,
    user_id: &str,
    account_id: &str,
    tokens: &OAuthTokenResponse,
) -> Result<(), String> {
    let encoded = serde_json::to_string(tokens)
        .map_err(|e| format!("calendar_keychain_serialize_failed:{e}"))?;
    crate::keychain::set_secret(service, &calendar_keychain_account(provider, user_id, account_id), &encoded)
        .map_err(|e| format!("calendar_keychain_save_failed:{e}"))
}

fn load_calendar_tokens_from_keychain(
    service: &str,
    provider: &str,
    user_id: &str,
    account_id: &str,
) -> Option<OAuthTokenResponse> {
    let raw = crate::keychain::get_secret(service, &calendar_keychain_account(provider, user_id, account_id))
        .ok()
        .flatten()?;
    serde_json::from_str::<OAuthTokenResponse>(&raw).ok()
}

fn random_b64url(bytes: usize) -> String {
    let mut data = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut data);
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

async fn run_oauth_authorization_code_flow(
    auth_endpoint: &str,
    token_endpoint: &str,
    client_id: &str,
    client_secret: Option<&str>,
    scopes: &[&str],
) -> Result<OAuthTokenResponse, String> {
    let verifier = random_b64url(64);
    let challenge = pkce_challenge(&verifier);
    let client_id_owned = client_id.to_string();
    let auth_endpoint_owned = auth_endpoint.to_string();
    let scopes_owned = scopes.iter().map(|scope| scope.to_string()).collect::<Vec<_>>();
    let challenge_owned = challenge.clone();
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
                    let params = parsed.query_pairs().into_owned().collect::<std::collections::HashMap<_, _>>();

                    if let Some(error) = params.get("error") {
                        write_callback_response(
                            stream,
                            "<html><body><h3>Calendar connection failed</h3><p>You can close this tab and return to Moduo.</p></body></html>",
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
                            "<html><body><h3>Calendar connection failed</h3><p>State mismatch. You can close this tab.</p></body></html>",
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
                        "<html><body><h3>Calendar connected</h3><p>You can close this tab and return to Moduo.</p></body></html>",
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
            let name = cal.summary.unwrap_or_else(|| format!("Google Calendar {}", idx + 1));
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
            let name = cal.name.unwrap_or_else(|| format!("Outlook Calendar {}", idx + 1));
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

    Ok(CalendarOAuthStartResult {
        account_id: format!("outlook:{email}"),
        email: email.clone(),
        display_name,
        calendars,
    })
}

#[tauri::command]
pub async fn calendar_events_list(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    state
        .store
        .list_calendar_events()
        .map_err(|e| format!("calendar_events_list_failed:{e}"))
}

#[tauri::command]
pub async fn calendar_events_upsert(
    state: State<'_, AppState>,
    event: serde_json::Value,
) -> Result<(), String> {
    let Some(id) = event
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
    else {
        return Err("calendar_events_upsert_missing_id".to_string());
    };
    state
        .store
        .put_calendar_event(id, &event)
        .map_err(|e| format!("calendar_events_upsert_failed:{e}"))
}

#[tauri::command]
pub async fn calendar_events_delete(state: State<'_, AppState>, event_id: String) -> Result<(), String> {
    state
        .store
        .remove_calendar_event(&event_id)
        .map_err(|e| format!("calendar_events_delete_failed:{e}"))
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarGoogleSyncResult {
    pub upserted: usize,
}

fn google_access_token_for_account(state: &AppState, account_id: &str) -> Result<String, String> {
    let user_id = current_user_id(state);
    let Some(tokens) = load_calendar_tokens_from_keychain(
        &state.config.keychain_service,
        "google",
        &user_id,
        account_id,
    ) else {
        return Err("google_calendar_missing_tokens:reconnect_google_account".to_string());
    };
    if tokens.access_token.trim().is_empty() {
        return Err("google_calendar_missing_access_token:reconnect_google_account".to_string());
    }
    Ok(tokens.access_token)
}

#[tauri::command]
pub async fn calendar_google_events_sync(
    state: State<'_, AppState>,
    account_id: String,
    calendar_source_ids: Vec<String>,
    time_min: String,
    time_max: String,
) -> Result<CalendarGoogleSyncResult, String> {
    let access_token = google_access_token_for_account(&state, &account_id)?;
    let client = reqwest::Client::new();
    let mut upserted = 0usize;

    for source_id in calendar_source_ids {
        // Expected format: google:{email}:{calendarId}
        let cal_id = source_id
            .splitn(3, ':')
            .nth(2)
            .ok_or_else(|| format!("google_calendar_source_id_invalid:{source_id}"))?
            .to_string();

        let mut page_token: Option<String> = None;
        loop {
            let mut req = client
                .get(format!(
                    "https://www.googleapis.com/calendar/v3/calendars/{cal_id}/events"
                ))
                .bearer_auth(&access_token)
                .query(&[
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
                .json::<GoogleEventsListResponse>()
                .await
                .map_err(|e| format!("google_events_parse_failed:{e}"))?;

            for item in payload.items.unwrap_or_default() {
                if item.status.as_deref() == Some("cancelled") {
                    continue;
                }
                let Some(external_id) = item.id.clone().filter(|v| !v.trim().is_empty()) else {
                    continue;
                };
                let start = item
                    .start
                    .as_ref()
                    .and_then(|s| s.date_time.clone().or_else(|| s.date.clone()))
                    .unwrap_or_default();
                let end = item
                    .end
                    .as_ref()
                    .and_then(|s| s.date_time.clone().or_else(|| s.date.clone()))
                    .unwrap_or_default();
                if start.is_empty() || end.is_empty() {
                    continue;
                }
                let all_day = item.start.as_ref().and_then(|s| s.date.as_ref()).is_some();
                let now = chrono::Utc::now().to_rfc3339();
                let record = serde_json::json!({
                    "id": format!("gcal:{source_id}:{external_id}"),
                    "calendarId": source_id,
                    "title": item.summary.unwrap_or_else(|| "Untitled".to_string()),
                    "description": item.description.unwrap_or_default(),
                    "location": item.location.unwrap_or_default(),
                    "startTime": start,
                    "endTime": end,
                    "allDay": all_day,
                    "color": "#3a3a3a",
                    "recurring": false,
                    "recurrenceRule": null,
                    "attendees": [],
                    "reminders": [],
                    "tags": [],
                    "createdAt": item.created.unwrap_or_else(|| now.clone()),
                    "updatedAt": item.updated.unwrap_or_else(|| now.clone()),
                    "deletedAt": null,
                    "externalProvider": "google",
                    "externalId": external_id,
                    "externalICalUid": item.ical_uid,
                });
                let id = record.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                state
                    .store
                    .put_calendar_event(id, &record)
                    .map_err(|e| format!("calendar_events_store_failed:{e}"))?;
                upserted += 1;
            }

            page_token = payload.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
    }

    Ok(CalendarGoogleSyncResult { upserted })
}

#[tauri::command]
pub async fn calendar_google_event_upsert(
    state: State<'_, AppState>,
    account_id: String,
    event: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let access_token = google_access_token_for_account(&state, &account_id)?;
    let Some(calendar_source_id) = event.get("calendarId").and_then(|v| v.as_str()) else {
        return Err("google_event_missing_calendarId".to_string());
    };
    let cal_id = calendar_source_id
        .splitn(3, ':')
        .nth(2)
        .ok_or_else(|| "google_event_calendar_source_invalid".to_string())?;

    let title = event.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
    let description = event.get("description").and_then(|v| v.as_str()).unwrap_or("");
    let location = event.get("location").and_then(|v| v.as_str()).unwrap_or("");
    let start_time = event.get("startTime").and_then(|v| v.as_str()).unwrap_or("");
    let end_time = event.get("endTime").and_then(|v| v.as_str()).unwrap_or("");
    let all_day = event.get("allDay").and_then(|v| v.as_bool()).unwrap_or(false);

    let (start_obj, end_obj) = if all_day {
        let start_date = start_time.split('T').next().unwrap_or(start_time);
        let end_date = end_time.split('T').next().unwrap_or(end_time);
        (
            serde_json::json!({ "date": start_date }),
            serde_json::json!({ "date": end_date }),
        )
    } else {
        (
            serde_json::json!({ "dateTime": start_time }),
            serde_json::json!({ "dateTime": end_time }),
        )
    };

    let payload = serde_json::json!({
        "summary": title,
        "description": description,
        "location": location,
        "start": start_obj,
        "end": end_obj,
    });

    let external_id = event.get("externalId").and_then(|v| v.as_str()).map(|s| s.to_string());
    let client = reqwest::Client::new();
    let resp = if let Some(ref id) = external_id {
        client
            .put(format!(
                "https://www.googleapis.com/calendar/v3/calendars/{cal_id}/events/{id}"
            ))
            .bearer_auth(&access_token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("google_event_update_request_failed:{e}"))?
    } else {
        client
            .post(format!(
                "https://www.googleapis.com/calendar/v3/calendars/{cal_id}/events"
            ))
            .bearer_auth(&access_token)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("google_event_create_request_failed:{e}"))?
    };
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("google_event_upsert_failed:{body}"));
    }
    let created = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("google_event_upsert_parse_failed:{e}"))?;
    let new_external_id = created
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .map(|v| v.to_string());

    let mut merged = event;
    if let Some(id) = new_external_id {
        merged["externalProvider"] = serde_json::Value::String("google".to_string());
        merged["externalId"] = serde_json::Value::String(id);
    }

    Ok(merged)
}

#[tauri::command]
pub async fn calendar_google_event_delete(
    state: State<'_, AppState>,
    account_id: String,
    calendar_source_id: String,
    external_id: String,
) -> Result<(), String> {
    let access_token = google_access_token_for_account(&state, &account_id)?;
    let cal_id = calendar_source_id
        .splitn(3, ':')
        .nth(2)
        .ok_or_else(|| "google_event_calendar_source_invalid".to_string())?;
    let client = reqwest::Client::new();
    let resp = client
        .delete(format!(
            "https://www.googleapis.com/calendar/v3/calendars/{cal_id}/events/{external_id}"
        ))
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("google_event_delete_request_failed:{e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("google_event_delete_failed:{body}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn calendar_apple_oauth_start() -> Result<CalendarOAuthStartResult, String> {
    Err("apple_calendar_oauth_not_supported: iCloud Calendar uses CalDAV/app-specific-password flow".to_string())
}
