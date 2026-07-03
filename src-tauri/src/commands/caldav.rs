// CAL-8 — the CalDAV/ICS basic-auth engine (read-only). The CAL-6b split holds:
// Rust does credentials + provider HTTP and returns RAW ICS text to JS; the
// pure `ics-mirror.ts` mapper normalizes it and the frontend mirrors it to
// Supabase. No outward write path exists (read-only is structural).
//
// Credentials live in the OS keychain ONLY, one secret per (server, username)
// — shared by all of that server's calendar rows so a password rotation is one
// write. ICS feed URLs are credentials too (Google-style "secret address"
// URLs); a feed's cloud `external_id` is just the derived key.
//
// https is enforced here (webcal:// normalizes to https://) — basic auth must
// never travel unencrypted (designer-ratified, spec AC15).

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use url::Url;

use crate::AppState;

const DAV_NS: &str = "DAV:";
const CALDAV_NS: &str = "urn:ietf:params:xml:ns:caldav";
const APPLE_ICAL_NS: &str = "http://apple.com/ns/ical/";
const MAX_REDIRECTS: usize = 5;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaldavCalendar {
    pub url: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaldavCredentials {
    server_url: String,
    username: String,
    password: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IcsFeedSecret {
    url: String,
}

// ── url + key helpers ─────────────────────────────────────────────────────────

/// Normalize user input to a secure URL: trim, `webcal://` → `https://`, add a
/// scheme when missing, then REFUSE anything that isn't https (basic auth in
/// the clear is an instant credential leak).
pub(crate) fn normalize_secure_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("caldav_url_empty".to_string());
    }
    let lowered = trimmed.to_ascii_lowercase();
    let candidate = if let Some(rest) = lowered
        .starts_with("webcal://")
        .then(|| &trimmed["webcal://".len()..])
    {
        format!("https://{rest}")
    } else if lowered.starts_with("http://") {
        return Err("caldav_insecure_url:https_required".to_string());
    } else if lowered.starts_with("https://") {
        trimmed.to_string()
    } else if trimmed.contains("://") {
        return Err("caldav_insecure_url:https_required".to_string());
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&candidate).map_err(|e| format!("caldav_url_invalid:{e}"))?;
    if url.scheme() != "https" {
        return Err("caldav_insecure_url:https_required".to_string());
    }
    Ok(url)
}

/// Deterministic keychain key suffix for a (server, username) pair — 96 bits
/// of the SHA-256, base64url. Reconnect recomputes the same key, so a password
/// rotation is a single overwrite shared by every calendar row of the server.
pub(crate) fn caldav_credential_key(server_url: &str, username: &str) -> String {
    let digest = Sha256::digest(format!("{server_url}|{username}").as_bytes());
    URL_SAFE_NO_PAD.encode(&digest[..12])
}

/// Deterministic feed id for an ICS URL (same construction, `ics` scoped).
pub(crate) fn ics_feed_key(url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    URL_SAFE_NO_PAD.encode(&digest[..12])
}

/// Same host, or same last-two-labels (registrable-domain approximation without
/// a public-suffix crate: enough to allow `pXX-caldav.icloud.com` ↔
/// `caldav.icloud.com` while refusing an unrelated host).
pub(crate) fn same_registrable_domain(a: &str, b: &str) -> bool {
    if a.eq_ignore_ascii_case(b) {
        return true;
    }
    let tail = |h: &str| -> Option<String> {
        let labels: Vec<&str> = h.split('.').filter(|s| !s.is_empty()).collect();
        let n = labels.len();
        if n < 2 {
            return None;
        }
        Some(labels[n - 2..].join(".").to_ascii_lowercase())
    };
    match (tail(a), tail(b)) {
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

fn keychain_account(provider: &str, user_id: &str, key: &str) -> String {
    // Mirrors calendar.rs's OAuth format: calendar_{provider}_{user}_{id}.
    format!("calendar_{provider}_{user_id}_{key}")
}

fn current_user_id(state: &AppState) -> String {
    state
        .session
        .lock()
        .ok()
        .and_then(|v| v.as_ref().map(|s| s.user.id.clone()))
        .unwrap_or_else(|| "local".to_string())
}

/// ISO **UTC** instant → iCalendar UTC basic format (20260703T100000Z) for the
/// calendar-query time-range. The input MUST be UTC (trailing `Z`) — the sync
/// window is always `Date.toISOString()`. A non-UTC/offset-bearing string is
/// rejected rather than silently asserted as UTC (which would shift the filter
/// bounds), matching the mapper's drop-never-shift posture.
pub(crate) fn caldav_time(iso: &str) -> Result<String, String> {
    let trimmed = iso.trim();
    if !trimmed.ends_with('Z') {
        return Err(format!("caldav_time_not_utc:{iso}"));
    }
    // Drop any fractional seconds ("...00.000Z"), then keep digits + 'T'.
    let without_frac = trimmed.split('.').next().unwrap_or(trimmed);
    let compact: String = without_frac
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == 'T')
        .collect();
    if compact.len() != 15 || !compact.contains('T') {
        return Err(format!("caldav_time_invalid:{iso}"));
    }
    Ok(format!("{compact}Z"))
}

// ── credentials ───────────────────────────────────────────────────────────────

fn save_caldav_credentials(
    state: &AppState,
    server_url: &str,
    username: &str,
    password: &str,
) -> Result<String, String> {
    let key = caldav_credential_key(server_url, username);
    let secret = serde_json::to_string(&CaldavCredentials {
        server_url: server_url.to_string(),
        username: username.to_string(),
        password: password.to_string(),
    })
    .map_err(|e| format!("caldav_credentials_serialize_failed:{e}"))?;
    crate::keychain::set_secret(
        &state.config.keychain_service,
        &keychain_account("caldav", &current_user_id(state), &key),
        &secret,
    )
    .map_err(|e| format!("caldav_credentials_save_failed:{e}"))?;
    Ok(key)
}

fn load_caldav_credentials(
    state: &AppState,
    server_url: &str,
    username: &str,
) -> Result<CaldavCredentials, String> {
    let key = caldav_credential_key(server_url, username);
    let raw = crate::keychain::get_secret(
        &state.config.keychain_service,
        &keychain_account("caldav", &current_user_id(state), &key),
    )
    .ok()
    .flatten()
    .ok_or_else(|| "caldav_missing_credentials:reconnect_account".to_string())?;
    serde_json::from_str::<CaldavCredentials>(&raw)
        .map_err(|_| "caldav_missing_credentials:reconnect_account".to_string())
}

// ── DAV plumbing ──────────────────────────────────────────────────────────────

struct DavResponse {
    status: u16,
    body: String,
    final_url: Url,
}

/// One DAV request with manual redirect handling (≤5 hops). reqwest strips
/// Authorization on cross-host redirects by design, but iCloud's discovery
/// legitimately hops to partitioned `pXX-caldav.icloud.com` hosts — so we
/// follow Location ourselves and re-send basic auth to each https hop.
async fn dav_request(
    client: &reqwest::Client,
    method: &str,
    url: Url,
    username: &str,
    password: &str,
    depth: Option<&str>,
    body: Option<String>,
) -> Result<DavResponse, String> {
    let origin_host = url.host_str().map(|h| h.to_string());
    let mut current = url;
    for _ in 0..=MAX_REDIRECTS {
        if current.scheme() != "https" {
            return Err("caldav_insecure_url:https_required".to_string());
        }
        let m = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|e| format!("caldav_bad_method:{e}"))?;
        let mut req = client
            .request(m, current.clone())
            .header("Content-Type", "application/xml; charset=utf-8");
        // Only forward Basic auth to the original host or another host in the
        // same registrable domain (iCloud legitimately hops caldav.icloud.com →
        // pXX-caldav.icloud.com). A redirect to an UNRELATED host (open-redirect,
        // MITM, compromised endpoint) must NOT receive the password — this is
        // exactly why reqwest strips Authorization cross-host by default.
        let same_domain = current
            .host_str()
            .zip(origin_host.as_deref())
            .is_some_and(|(h, o)| same_registrable_domain(h, o));
        // ICS feeds authenticate via their secret URL — don't send an empty
        // Authorization header some feed hosts would reject.
        if same_domain && (!username.is_empty() || !password.is_empty()) {
            req = req.basic_auth(username, Some(password));
        }
        if let Some(d) = depth {
            req = req.header("Depth", d);
        }
        if let Some(ref b) = body {
            req = req.body(b.clone());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("caldav_request_failed:{e}"))?;
        let status = resp.status().as_u16();
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "caldav_redirect_without_location".to_string())?;
            current = current
                .join(location)
                .map_err(|e| format!("caldav_redirect_invalid:{e}"))?;
            continue;
        }
        let final_url = resp.url().clone();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("caldav_body_read_failed:{e}"))?;
        return Ok(DavResponse {
            status,
            body: text,
            final_url,
        });
    }
    Err("caldav_too_many_redirects".to_string())
}

fn is_auth_failure(status: u16) -> bool {
    status == 401 || status == 403
}

// ── multistatus parsing (roxmltree) ───────────────────────────────────────────

fn is_tag(node: roxmltree::Node, ns: &str, name: &str) -> bool {
    node.is_element() && node.tag_name().name() == name && node.tag_name().namespace() == Some(ns)
}

fn descendant_text(scope: roxmltree::Node, ns: &str, name: &str) -> Option<String> {
    scope
        .descendants()
        .find(|n| is_tag(*n, ns, name))
        .and_then(|n| n.text())
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

/// The FULL text of an element, concatenating every text/CDATA child —
/// `Node::text()` returns only the first, which would truncate an ICS body a
/// server split across adjacent CDATA sections (e.g. an ICS containing `]]>`).
fn descendant_full_text(scope: roxmltree::Node, ns: &str, name: &str) -> Option<String> {
    let node = scope.descendants().find(|n| is_tag(*n, ns, name))?;
    let mut buf = String::new();
    for child in node.descendants() {
        if let Some(t) = child.text() {
            buf.push_str(t);
        }
    }
    let trimmed = buf.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// `<current-user-principal><href>…` (or `<principal-URL>`) from a PROPFIND.
pub(crate) fn parse_principal_href(xml: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(xml).ok()?;
    for holder in ["current-user-principal", "principal-URL"] {
        if let Some(node) = doc.descendants().find(|n| is_tag(*n, DAV_NS, holder)) {
            if let Some(href) = descendant_text(node, DAV_NS, "href") {
                return Some(href);
            }
        }
    }
    None
}

/// `<calendar-home-set><href>…` from a principal PROPFIND.
pub(crate) fn parse_calendar_home_href(xml: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(xml).ok()?;
    let node = doc
        .descendants()
        .find(|n| is_tag(*n, CALDAV_NS, "calendar-home-set"))?;
    descendant_text(node, DAV_NS, "href")
}

/// Event calendars from a Depth-1 PROPFIND of the calendar home: resourcetype
/// must include `<calendar>`; when a supported-calendar-component-set is
/// present it must include VEVENT (a tasks-only collection is skipped).
pub(crate) fn parse_calendar_list(xml: &str, base: &Url) -> Vec<CaldavCalendar> {
    let Ok(doc) = roxmltree::Document::parse(xml) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for response in doc.descendants().filter(|n| is_tag(*n, DAV_NS, "response")) {
        let Some(href) = descendant_text(response, DAV_NS, "href") else {
            continue;
        };
        let is_calendar = response
            .descendants()
            .filter(|n| is_tag(*n, DAV_NS, "resourcetype"))
            .any(|rt| rt.children().any(|c| is_tag(c, CALDAV_NS, "calendar")));
        if !is_calendar {
            continue;
        }
        let comp_set: Vec<String> = response
            .descendants()
            .filter(|n| is_tag(*n, CALDAV_NS, "supported-calendar-component-set"))
            .flat_map(|s| s.children())
            .filter(|c| is_tag(*c, CALDAV_NS, "comp"))
            .filter_map(|c| c.attribute("name").map(|v| v.to_uppercase()))
            .collect();
        if !comp_set.is_empty() && !comp_set.iter().any(|c| c == "VEVENT") {
            continue;
        }
        let Ok(url) = base.join(&href) else { continue };
        let name = descendant_text(response, DAV_NS, "displayname")
            .unwrap_or_else(|| "Calendar".to_string());
        let color = descendant_text(response, APPLE_ICAL_NS, "calendar-color")
            .map(|c| if c.len() == 9 && c.starts_with('#') { c[..7].to_string() } else { c });
        out.push(CaldavCalendar {
            url: url.to_string(),
            name,
            color,
        });
    }
    out
}

/// `(href, etag, ics)` triples from a calendar-query REPORT multistatus.
pub(crate) fn parse_calendar_data(xml: &str, base: &Url) -> Vec<(String, String, String)> {
    let Ok(doc) = roxmltree::Document::parse(xml) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for response in doc.descendants().filter(|n| is_tag(*n, DAV_NS, "response")) {
        let href = descendant_text(response, DAV_NS, "href").unwrap_or_default();
        let Some(ics) = descendant_full_text(response, CALDAV_NS, "calendar-data") else {
            continue;
        };
        let etag = descendant_text(response, DAV_NS, "getetag").unwrap_or_default();
        let url = base
            .join(&href)
            .map(|u| u.to_string())
            .unwrap_or(href);
        out.push((url, etag, ics));
    }
    out
}

// ── discovery ─────────────────────────────────────────────────────────────────

const PROPFIND_PRINCIPAL: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>"#;

const PROPFIND_HOME: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>"#;

const PROPFIND_CALENDARS: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <c:supported-calendar-component-set/>
    <a:calendar-color/>
  </d:prop>
</d:propfind>"#;

fn dav_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("caldav_client_failed:{e}"))
}

async fn discover(
    client: &reqwest::Client,
    server: &Url,
    username: &str,
    password: &str,
) -> Result<Vec<CaldavCalendar>, String> {
    // 1. Principal — try /.well-known/caldav first, then the pasted URL itself.
    let mut principal: Option<(Url, String)> = None;
    let mut auth_failed = false;
    let well_known = server
        .join("/.well-known/caldav")
        .map_err(|e| format!("caldav_url_invalid:{e}"))?;
    for candidate in [well_known, server.clone()] {
        match dav_request(
            client,
            "PROPFIND",
            candidate,
            username,
            password,
            Some("0"),
            Some(PROPFIND_PRINCIPAL.to_string()),
        )
        .await
        {
            Ok(resp) => {
                if is_auth_failure(resp.status) {
                    auth_failed = true;
                    continue;
                }
                if let Some(href) = parse_principal_href(&resp.body) {
                    principal = Some((resp.final_url, href));
                    break;
                }
            }
            Err(_) => continue,
        }
    }
    let Some((principal_base, principal_href)) = principal else {
        // The pasted URL may already BE the calendar home (Nextcloud full path)
        // — fall through to listing it directly before giving up.
        let listed = list_calendars_at(client, server.clone(), username, password).await?;
        if !listed.is_empty() {
            return Ok(listed);
        }
        return Err(if auth_failed {
            "caldav_auth_failed:check_username_password".to_string()
        } else {
            "caldav_discovery_failed:no_principal".to_string()
        });
    };
    let principal_url = principal_base
        .join(&principal_href)
        .map_err(|e| format!("caldav_url_invalid:{e}"))?;

    // 2. Calendar home.
    let home_resp = dav_request(
        client,
        "PROPFIND",
        principal_url.clone(),
        username,
        password,
        Some("0"),
        Some(PROPFIND_HOME.to_string()),
    )
    .await?;
    if is_auth_failure(home_resp.status) {
        return Err("caldav_auth_failed:check_username_password".to_string());
    }
    let home_href = parse_calendar_home_href(&home_resp.body)
        .ok_or_else(|| "caldav_discovery_failed:no_calendar_home".to_string())?;
    let home_url = home_resp
        .final_url
        .join(&home_href)
        .map_err(|e| format!("caldav_url_invalid:{e}"))?;

    // 3. The calendars.
    list_calendars_at(client, home_url, username, password).await
}

async fn list_calendars_at(
    client: &reqwest::Client,
    home: Url,
    username: &str,
    password: &str,
) -> Result<Vec<CaldavCalendar>, String> {
    let resp = dav_request(
        client,
        "PROPFIND",
        home,
        username,
        password,
        Some("1"),
        Some(PROPFIND_CALENDARS.to_string()),
    )
    .await?;
    if is_auth_failure(resp.status) {
        return Err("caldav_auth_failed:check_username_password".to_string());
    }
    if !(200..300).contains(&resp.status) && resp.status != 207 {
        return Err(format!("caldav_calendars_failed:{}", resp.status));
    }
    Ok(parse_calendar_list(&resp.body, &resp.final_url))
}

// ── commands ──────────────────────────────────────────────────────────────────

/// Probe a server with the given credentials and list its event calendars.
/// Saves NOTHING — the connect dialog calls save_credentials on Connect.
#[tauri::command]
pub async fn calendar_caldav_discover(
    server_url: String,
    username: String,
    password: String,
) -> Result<Vec<CaldavCalendar>, String> {
    let server = normalize_secure_url(&server_url)?;
    let client = dav_client()?;
    discover(&client, &server, &username, &password).await
}

/// Persist basic-auth credentials for a (server, username) in the OS keychain.
/// Returns the derived credential key (informational; sync re-derives it).
#[tauri::command]
pub async fn calendar_caldav_save_credentials(
    state: State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
) -> Result<String, String> {
    let server = normalize_secure_url(&server_url)?;
    save_caldav_credentials(&state, server.as_str(), &username, &password)
}

#[tauri::command]
pub async fn calendar_caldav_delete_credentials(
    state: State<'_, AppState>,
    server_url: String,
    username: String,
) -> Result<(), String> {
    let server = normalize_secure_url(&server_url)?;
    let key = caldav_credential_key(server.as_str(), &username);
    crate::keychain::delete_secret(
        &state.config.keychain_service,
        &keychain_account("caldav", &current_user_id(&state), &key),
    )
    .map_err(|e| format!("caldav_credentials_delete_failed:{e}"))
}

/// Fetch one calendar's raw VEVENT resources within a window (calendar-query
/// REPORT). Returns `[{ ics, url, etag, calendarId }]` for `ics-mirror.ts`.
#[tauri::command]
pub async fn calendar_caldav_events_sync(
    state: State<'_, AppState>,
    server_url: String,
    username: String,
    calendar_url: String,
    time_min: String,
    time_max: String,
) -> Result<Vec<serde_json::Value>, String> {
    let server = normalize_secure_url(&server_url)?;
    let calendar = normalize_secure_url(&calendar_url)?;
    let creds = load_caldav_credentials(&state, server.as_str(), &username)?;
    let body = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="{}" end="{}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>"#,
        caldav_time(&time_min)?,
        caldav_time(&time_max)?
    );
    let client = dav_client()?;
    let resp = dav_request(
        &client,
        "REPORT",
        calendar.clone(),
        &creds.username,
        &creds.password,
        Some("1"),
        Some(body),
    )
    .await?;
    if is_auth_failure(resp.status) {
        return Err("caldav_auth_failed:reconnect_account".to_string());
    }
    if !(200..300).contains(&resp.status) && resp.status != 207 {
        return Err(format!("caldav_report_failed:{}", resp.status));
    }
    Ok(parse_calendar_data(&resp.body, &resp.final_url)
        .into_iter()
        .map(|(url, etag, ics)| {
            serde_json::json!({
                "ics": ics,
                "url": url,
                "etag": etag,
                "calendarId": calendar.as_str(),
            })
        })
        .collect())
}

/// Persist an ICS feed URL (a credential — secret-address feeds) and return
/// the feed id that becomes the cloud account row's `external_id`.
#[tauri::command]
pub async fn calendar_ics_save_feed(
    state: State<'_, AppState>,
    url: String,
) -> Result<String, String> {
    let feed = normalize_secure_url(&url)?;
    let key = ics_feed_key(feed.as_str());
    let secret = serde_json::to_string(&IcsFeedSecret {
        url: feed.to_string(),
    })
    .map_err(|e| format!("ics_feed_serialize_failed:{e}"))?;
    crate::keychain::set_secret(
        &state.config.keychain_service,
        &keychain_account("ics", &current_user_id(&state), &key),
        &secret,
    )
    .map_err(|e| format!("ics_feed_save_failed:{e}"))?;
    Ok(key)
}

#[tauri::command]
pub async fn calendar_ics_delete_feed(
    state: State<'_, AppState>,
    feed_id: String,
) -> Result<(), String> {
    crate::keychain::delete_secret(
        &state.config.keychain_service,
        &keychain_account("ics", &current_user_id(&state), &feed_id),
    )
    .map_err(|e| format!("ics_feed_delete_failed:{e}"))
}

/// Fetch a stored ICS feed whole. Returns `[{ ics }]` for `ics-mirror.ts`
/// (the mapper window-filters; feeds have no server-side time-range).
#[tauri::command]
pub async fn calendar_ics_fetch(
    state: State<'_, AppState>,
    feed_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let raw = crate::keychain::get_secret(
        &state.config.keychain_service,
        &keychain_account("ics", &current_user_id(&state), &feed_id),
    )
    .ok()
    .flatten()
    .ok_or_else(|| "ics_feed_missing:reconnect_feed".to_string())?;
    let secret = serde_json::from_str::<IcsFeedSecret>(&raw)
        .map_err(|_| "ics_feed_missing:reconnect_feed".to_string())?;
    let feed = normalize_secure_url(&secret.url)?;
    let client = dav_client()?;
    let resp = dav_request(&client, "GET", feed, "", "", None, None).await?;
    if !(200..300).contains(&resp.status) {
        return Err(format!("ics_fetch_failed:{}", resp.status));
    }
    Ok(vec![serde_json::json!({ "ics": resp.body })])
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_guard_refuses_http_and_normalizes_webcal() {
        assert!(normalize_secure_url("http://nas.local/dav").is_err());
        assert!(normalize_secure_url("ftp://x.example").is_err());
        assert_eq!(
            normalize_secure_url("webcal://example.com/team.ics").unwrap().as_str(),
            "https://example.com/team.ics"
        );
        assert_eq!(
            normalize_secure_url("caldav.fastmail.com").unwrap().as_str(),
            "https://caldav.fastmail.com/"
        );
        assert_eq!(
            normalize_secure_url(" https://cloud.example/remote.php/dav ").unwrap().as_str(),
            "https://cloud.example/remote.php/dav"
        );
    }

    #[test]
    fn credential_keys_are_stable_and_scoped() {
        let a = caldav_credential_key("https://caldav.fastmail.com/", "me@fastmail.com");
        let b = caldav_credential_key("https://caldav.fastmail.com/", "me@fastmail.com");
        let c = caldav_credential_key("https://caldav.fastmail.com/", "other@fastmail.com");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(!a.contains('/') && !a.contains('+'));
    }

    #[test]
    fn caldav_time_converts_iso_to_basic_utc() {
        assert_eq!(caldav_time("2026-07-03T10:00:00.000Z").unwrap(), "20260703T100000Z");
        assert_eq!(caldav_time("2026-12-31T23:59:59Z").unwrap(), "20261231T235959Z");
        assert!(caldav_time("not-a-time").is_err());
        // Non-UTC / offset-bearing input is REJECTED, never asserted as UTC.
        assert!(caldav_time("2026-07-03T10:00:00.000+02:00").is_err());
        assert!(caldav_time("2026-07-03T10:00:00").is_err());
    }

    #[test]
    fn registrable_domain_allows_icloud_partitions_refuses_strangers() {
        assert!(same_registrable_domain("caldav.icloud.com", "caldav.icloud.com"));
        assert!(same_registrable_domain("p42-caldav.icloud.com", "caldav.icloud.com"));
        assert!(same_registrable_domain("CALDAV.ICLOUD.COM", "caldav.icloud.com"));
        assert!(!same_registrable_domain("attacker.example", "caldav.icloud.com"));
        assert!(!same_registrable_domain("icloud.com.evil.example", "caldav.icloud.com"));
    }

    #[test]
    fn concatenates_multi_node_calendar_data() {
        // calendar-data split across a text node, a CDATA section, and another
        // text node (how a server encodes a body that contains "]]>"): the
        // first-text-node-only reader would truncate to "BEGIN:VCALENDAR".
        let xml = "<?xml version=\"1.0\"?>\
<d:multistatus xmlns:d=\"DAV:\" xmlns:cal=\"urn:ietf:params:xml:ns:caldav\">\
<d:response><d:href>/c/e.ics</d:href><d:propstat><d:prop>\
<cal:calendar-data>BEGIN:VCALENDAR\n<![CDATA[DESCRIPTION:awkward chunk]]>\nEND:VCALENDAR</cal:calendar-data>\
</d:prop></d:propstat></d:response></d:multistatus>";
        let base = Url::parse("https://x.example/").unwrap();
        let rows = parse_calendar_data(xml, &base);
        assert_eq!(rows.len(), 1);
        // Every chunk is present (not truncated at the first text node).
        assert!(rows[0].2.contains("BEGIN:VCALENDAR"));
        assert!(rows[0].2.contains("DESCRIPTION:awkward"));
        assert!(rows[0].2.contains("END:VCALENDAR"));
    }

    #[test]
    fn parses_principal_and_home_hrefs() {
        let principal = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop>
<d:current-user-principal><d:href>/principals/users/maciej/</d:href></d:current-user-principal>
</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>"#;
        assert_eq!(
            parse_principal_href(principal).as_deref(),
            Some("/principals/users/maciej/")
        );

        let home = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
<d:response><d:href>/principals/users/maciej/</d:href><d:propstat><d:prop>
<cal:calendar-home-set><d:href>/calendars/maciej/</d:href></cal:calendar-home-set>
</d:prop></d:propstat></d:response></d:multistatus>"#;
        assert_eq!(parse_calendar_home_href(home).as_deref(), Some("/calendars/maciej/"));
    }

    #[test]
    fn parses_calendar_list_filtering_non_event_collections() {
        // Nextcloud/iCloud-shaped: one VEVENT calendar with an Apple color, one
        // VTODO-only collection, one plain (non-calendar) collection.
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
  <d:response>
    <d:href>/calendars/maciej/work/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <d:displayname>Work</d:displayname>
      <cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set>
      <ical:calendar-color>#FF2968FF</ical:calendar-color>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/calendars/maciej/tasks/</d:href>
    <d:propstat><d:prop>
      <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
      <d:displayname>Tasks</d:displayname>
      <cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/calendars/maciej/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>"#;
        let base = Url::parse("https://caldav.example.com/").unwrap();
        let calendars = parse_calendar_list(xml, &base);
        assert_eq!(calendars.len(), 1);
        assert_eq!(calendars[0].name, "Work");
        assert_eq!(calendars[0].url, "https://caldav.example.com/calendars/maciej/work/");
        assert_eq!(calendars[0].color.as_deref(), Some("#FF2968"));
    }

    #[test]
    fn accepts_calendars_without_component_set_advertisement() {
        // Some hosting-provider servers omit supported-calendar-component-set.
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/cal/personal/</d:href><d:propstat><d:prop>
    <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
    <d:displayname>Personal</d:displayname>
  </d:prop></d:propstat></d:response>
</d:multistatus>"#;
        let base = Url::parse("https://webmail.example.com/").unwrap();
        let calendars = parse_calendar_list(xml, &base);
        assert_eq!(calendars.len(), 1);
        assert_eq!(calendars[0].name, "Personal");
    }

    #[test]
    fn parses_calendar_data_report() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/calendars/maciej/work/evt-1.ics</d:href>
    <d:propstat><d:prop>
      <d:getetag>"abc123"</d:getetag>
      <cal:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-1
DTSTART:20260706T090000Z
DTEND:20260706T093000Z
SUMMARY:Standup
END:VEVENT
END:VCALENDAR</cal:calendar-data>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
</d:multistatus>"#;
        let base = Url::parse("https://caldav.example.com/calendars/maciej/work/").unwrap();
        let rows = parse_calendar_data(xml, &base);
        assert_eq!(rows.len(), 1);
        let (url, etag, ics) = &rows[0];
        assert_eq!(url, "https://caldav.example.com/calendars/maciej/work/evt-1.ics");
        assert_eq!(etag, "\"abc123\"");
        assert!(ics.contains("UID:evt-1"));
    }
}
