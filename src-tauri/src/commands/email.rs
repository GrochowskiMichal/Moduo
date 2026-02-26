use std::collections::{HashMap, HashSet};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use mailparse::{MailAddr, MailHeaderMap};
use native_tls::TlsConnector;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use uuid::Uuid;

use crate::domain::{GraphEdge, GraphNode};
use crate::email_sync::{
    now_iso as email_now_iso, EmailActivityMode, EmailActivityStateRecord, EmailSyncCursorRecord,
    EMAIL_BODY_MAX_BYTES_PER_ACCOUNT, EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT, EMAIL_DEFAULT_LIST_LIMIT,
    EMAIL_PREFETCH_DEFAULT_LIMIT,
};
use crate::{keychain, AppState};

const EMAIL_NAMESPACE: &str = "email";
const EMAIL_ACCOUNTS_KEY: &str = "accounts_v1";
const EMAIL_KEYCHAIN_PREFIX: &str = "email_account::";
const EMAIL_SECRET_FALLBACK_PREFIX: &str = "email_secret_fallback::";
const EMAIL_ACTIVITY_UI_STATE_KEY: &str = "activity_state_v2";
const EMAIL_FOLDER_UI_STATE_PREFIX: &str = "folder_state::";
const DEFAULT_WORKSPACE_ID: &str = "__global__";
const DEFAULT_MAILBOX_LIMIT: usize = 50;
const ALL_ACCOUNTS_ID: &str = "__all_accounts__";
const FLAG_RECONCILE_WINDOW: u32 = 200;
const FLAG_RECONCILE_WINDOW_LIGHT: u32 = 75;
const IDLE_RENEWAL_SECS: u64 = 29 * 60;
const IDLE_STAGGER_SECS: u64 = 3;
const IDLE_BACKGROUND_POLL_SECS: u64 = 5 * 60;
const IDLE_ACTIVE_POLL_SECS: u64 = 90;
const IDLE_MAX_ATTEMPTS_BEFORE_FALLBACK: usize = 5;
const IDLE_RECONNECT_DELAYS_SECS: [u64; 5] = [15, 30, 60, 120, 300];
const IDLE_STABLE_SESSION_RESET_SECS: u64 = 5 * 60;
const IDLE_GREETING_TIMEOUT_SECS: u64 = 5;
const IDLE_DEAD_CONNECTION_SILENCE_SECS: u64 = 4 * 60;
const IMAP_TCP_KEEPALIVE_SECS: u64 = 60;
const IMAP_CONNECT_TIMEOUT_SECS: u64 = 15;
const IMAP_SYNC_IO_TIMEOUT_SECS: u64 = 30;

static GRAPH_FLUSH_RUNNING: AtomicBool = AtomicBool::new(false);

struct IdleWorkerControl {
    stop: Arc<AtomicBool>,
    handle: tauri::async_runtime::JoinHandle<()>,
}

static IDLE_WORKERS: OnceLock<Mutex<HashMap<String, IdleWorkerControl>>> = OnceLock::new();

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    pub id: String,
    pub sender: String,
    pub sender_email: String,
    pub to: String,
    pub subject: String,
    pub preview: String,
    pub body: String,
    pub body_html: Option<String>,
    pub date: String,
    pub read: bool,
    pub starred: bool,
    pub folder: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct EmailConfig {
    pub provider: String,
    pub email: String,
    pub password: String,
    pub imap_host: Option<String>,
    pub smtp_host: Option<String>,
    pub imap_port: Option<u16>,
    pub smtp_port: Option<u16>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailAccountConnectInput {
    pub provider: String,
    pub email: String,
    pub password: String,
    pub workspace_id: Option<String>,
    pub imap_host: Option<String>,
    pub smtp_host: Option<String>,
    pub imap_port: Option<u16>,
    pub smtp_port: Option<u16>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailAccountPublic {
    pub id: String,
    pub workspace_id: Option<String>,
    pub provider: String,
    pub email: String,
    pub imap_host: Option<String>,
    pub smtp_host: Option<String>,
    pub imap_port: Option<u16>,
    pub smtp_port: Option<u16>,
    pub last_sync_at: Option<String>,
    pub status: String,
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredEmailAccount {
    id: String,
    #[serde(default)]
    workspace_id: Option<String>,
    provider: String,
    email: String,
    #[serde(default)]
    imap_host: Option<String>,
    #[serde(default)]
    smtp_host: Option<String>,
    #[serde(default)]
    imap_port: Option<u16>,
    #[serde(default)]
    smtp_port: Option<u16>,
    last_sync_at: Option<String>,
    status: String,
    last_error: Option<String>,
}

impl StoredEmailAccount {
    fn to_public(&self) -> EmailAccountPublic {
        EmailAccountPublic {
            id: self.id.clone(),
            workspace_id: self.workspace_id.clone(),
            provider: self.provider.clone(),
            email: self.email.clone(),
            imap_host: self.imap_host.clone(),
            smtp_host: self.smtp_host.clone(),
            imap_port: self.imap_port,
            smtp_port: self.smtp_port,
            last_sync_at: self.last_sync_at.clone(),
            status: self.status.clone(),
            last_error: self.last_error.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredEmailAccountV2 {
    id: String,
    workspace_id: String,
    provider: String,
    email: String,
    imap_host: Option<String>,
    smtp_host: Option<String>,
    imap_port: Option<u16>,
    smtp_port: Option<u16>,
    capabilities: Vec<String>,
    idle_supported: bool,
    resolved_mailboxes: HashMap<String, String>,
    last_sync_at: Option<String>,
    status: String,
    last_error: Option<String>,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredEnvelope {
    id: String,
    message_key: String,
    account_id: String,
    workspace_id: String,
    folder: String,
    uid: u32,
    uid_validity: Option<u32>,
    sender: String,
    sender_email: String,
    to: String,
    subject: String,
    preview: String,
    date: String,
    timestamp_ms: i64,
    read: bool,
    starred: bool,
    size: Option<u32>,
    message_id: Option<String>,
    in_reply_to: Option<String>,
    thread_id: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredBodyCache {
    key: String,
    account_id: String,
    folder: String,
    uid: u32,
    body: String,
    body_html: Option<String>,
    byte_size: usize,
    attachment_count: usize,
    fetched_at: String,
    last_accessed_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredBodyLru {
    key: String,
    account_id: String,
    folder: String,
    uid: u32,
    last_accessed_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredFlagOutboxEntry {
    id: String,
    account_id: String,
    folder: String,
    uid: u32,
    flag: String,
    value: bool,
    retry_count: u32,
    next_retry_at: String,
    last_error: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredGraphOutboxEntry {
    id: String,
    account_id: String,
    workspace_id: String,
    payload: serde_json::Value,
    retry_count: u32,
    next_retry_at: String,
    last_error: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailListEnvelopesInput {
    pub account_id: Option<String>,
    pub folder: String,
    pub limit: Option<usize>,
    pub force_sync: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailEnvelopeDto {
    pub id: String,
    pub message_key: String,
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
    pub sender: String,
    pub sender_email: String,
    pub to: String,
    pub subject: String,
    pub preview: String,
    pub date: String,
    pub read: bool,
    pub starred: bool,
    pub size: Option<u32>,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub thread_id: String,
    pub has_cached_body: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailListEnvelopesResult {
    pub envelopes: Vec<EmailEnvelopeDto>,
    pub total: usize,
    pub synced_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailGetMessageBodyInput {
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailGetMessageBodyResult {
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
    pub body: String,
    pub body_html: Option<String>,
    pub cached: bool,
    pub fetched_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailPrefetchBodiesInput {
    pub account_id: String,
    pub folder: String,
    pub uids: Vec<u32>,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailPrefetchBodiesResult {
    pub prefetched: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSyncNowInput {
    pub account_id: Option<String>,
    pub folder: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSyncNowResult {
    pub synced_accounts: usize,
    pub synced_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSetActivityStateInput {
    pub mode: EmailActivityMode,
    pub active_account_id: Option<String>,
    pub active_folder: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailApplyFlagInput {
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
    pub flag: String,
    pub value: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailApplyFlagResult {
    pub accepted: bool,
    pub synced: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailMailboxStatusInput {
    pub account_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailMailboxStatusRow {
    pub account_id: String,
    pub folder: String,
    pub total: usize,
    pub unread: usize,
    pub starred: usize,
}

impl EmailConfig {
    fn imap_host(&self) -> &str {
        if let Some(custom) = self.imap_host.as_deref() {
            return custom;
        }
        match self.provider.as_str() {
            "gmail" => "imap.gmail.com",
            "outlook" => "outlook.office365.com",
            "icloud" => "imap.mail.me.com",
            _ => "imap.gmail.com",
        }
    }

    fn smtp_host(&self) -> &str {
        if let Some(custom) = self.smtp_host.as_deref() {
            return custom;
        }
        match self.provider.as_str() {
            "gmail" => "smtp.gmail.com",
            "outlook" => "smtp.office365.com",
            "icloud" => "smtp.mail.me.com",
            _ => "smtp.gmail.com",
        }
    }

    fn imap_port(&self) -> u16 {
        self.imap_port.unwrap_or(993)
    }

    fn smtp_port(&self) -> u16 {
        self.smtp_port.unwrap_or(587)
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn normalize_provider(provider: &str) -> Result<String, String> {
    let normalized = provider.trim().to_lowercase();
    match normalized.as_str() {
        "gmail" | "outlook" | "icloud" | "custom" => Ok(normalized),
        _ => Err(format!("unsupported_provider:{}", provider)),
    }
}

fn normalize_email(email: &str) -> Result<String, String> {
    let normalized = email.trim().to_lowercase();
    if normalized.is_empty() || !normalized.contains('@') {
        return Err("invalid_email".to_string());
    }
    Ok(normalized)
}

fn normalize_optional_host(raw: &Option<String>) -> Option<String> {
    raw.as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
}

fn normalize_optional_port(raw: Option<u16>) -> Option<u16> {
    raw.filter(|port| *port > 0)
}

fn account_id(provider: &str, email: &str, imap_host: Option<&str>) -> String {
    if provider == "custom" {
        return format!("{}:{}:{}", provider, email, imap_host.unwrap_or("imap"));
    }
    format!("{}:{}", provider, email)
}

fn keychain_account_key(account_id: &str) -> String {
    format!("{}{}", EMAIL_KEYCHAIN_PREFIX, account_id)
}

fn secret_fallback_key(account_id: &str) -> String {
    format!("{}{}", EMAIL_SECRET_FALLBACK_PREFIX, account_id)
}

fn read_accounts(state: &AppState) -> Result<Vec<StoredEmailAccount>, String> {
    let raw = state
        .store
        .kv_get(EMAIL_NAMESPACE, EMAIL_ACCOUNTS_KEY)
        .map_err(|e| e.to_string())?;

    match raw {
        None => Ok(vec![]),
        Some(value) => {
            Ok(serde_json::from_value::<Vec<StoredEmailAccount>>(value).unwrap_or_else(|_| vec![]))
        }
    }
}

fn write_accounts(state: &AppState, accounts: &[StoredEmailAccount]) -> Result<(), String> {
    state
        .store
        .kv_set(
            EMAIL_NAMESPACE,
            EMAIL_ACCOUNTS_KEY,
            &serde_json::to_value(accounts).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

fn resolve_accounts_for_target(
    state: &AppState,
    account_id: Option<&str>,
) -> Result<Vec<StoredEmailAccount>, String> {
    let accounts = read_accounts(state)?;
    if accounts.is_empty() {
        return Ok(vec![]);
    }

    if let Some(id) = account_id {
        if id == ALL_ACCOUNTS_ID {
            return Ok(accounts);
        }
        let matched = accounts
            .into_iter()
            .find(|account| account.id == id)
            .map(|account| vec![account])
            .ok_or_else(|| "account_not_found".to_string())?;
        return Ok(matched);
    }

    Ok(accounts)
}

fn patch_account_sync_state(
    state: &AppState,
    account_id: &str,
    status: &str,
    last_error: Option<String>,
) -> Result<(), String> {
    let mut accounts = read_accounts(state)?;
    if let Some(account) = accounts.iter_mut().find(|item| item.id == account_id) {
        account.status = status.to_string();
        account.last_error = last_error;
        account.last_sync_at = Some(now_iso());
    }
    write_accounts(state, &accounts)
}

fn read_password_fallback(state: &AppState, account_id: &str) -> Result<Option<String>, String> {
    let key = secret_fallback_key(account_id);
    let raw = state
        .store
        .kv_get(EMAIL_NAMESPACE, &key)
        .map_err(|e| e.to_string())?;
    match raw {
        None => Ok(None),
        Some(value) => serde_json::from_value::<String>(value)
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

fn write_password_fallback(
    state: &AppState,
    account_id: &str,
    password: &str,
) -> Result<(), String> {
    let key = secret_fallback_key(account_id);
    state
        .store
        .kv_set(
            EMAIL_NAMESPACE,
            &key,
            &serde_json::to_value(password).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

fn clear_password_fallback(state: &AppState, account_id: &str) {
    let _ = state
        .store
        .kv_remove(EMAIL_NAMESPACE, &secret_fallback_key(account_id));
}

fn get_password_for_account(state: &AppState, account_id: &str) -> Result<Option<String>, String> {
    match keychain::get_secret_strict(
        &state.config.keychain_service,
        &keychain_account_key(account_id),
    ) {
        Ok(Some(secret)) => Ok(Some(secret)),
        Ok(None) => read_password_fallback(state, account_id),
        Err(_) => read_password_fallback(state, account_id),
    }
}

fn folder_state_key(account_id: &str, folder: &str) -> String {
    format!("{}::{}", account_id, folder)
}

fn envelope_key(account_id: &str, folder: &str, uid: u32) -> String {
    format!("{}::{}::{}", account_id, folder, uid)
}

fn body_key(account_id: &str, folder: &str, uid: u32) -> String {
    format!("{}::{}::{}", account_id, folder, uid)
}

fn message_key(account_id: &str, uid_validity: Option<u32>, uid: u32) -> String {
    format!(
        "{}::{}::{}",
        account_id,
        uid_validity.unwrap_or_default(),
        uid
    )
}

fn envelope_order_key(account_id: &str, folder: &str, timestamp_ms: i64, uid: u32) -> String {
    let reverse_ts = i64::MAX - timestamp_ms.max(0);
    format!("{}::{}::{:020}::{}", account_id, folder, reverse_ts, uid)
}

fn parse_json_value<T: for<'de> Deserialize<'de>>(value: serde_json::Value) -> Option<T> {
    serde_json::from_value(value).ok()
}

fn workspace_id_or_default(raw: Option<&str>) -> String {
    raw.map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or(DEFAULT_WORKSPACE_ID)
        .to_string()
}

fn to_millis_from_date(raw: &str) -> i64 {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(raw) {
        return dt.timestamp_millis();
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return dt.timestamp_millis();
    }
    chrono::Utc::now().timestamp_millis()
}

fn normalize_subject_for_thread(subject: &str) -> String {
    let lowered = subject.trim().to_lowercase();
    let mut stripped = lowered.as_str();
    for prefix in ["re:", "fwd:", "fw:"] {
        if stripped.starts_with(prefix) {
            stripped = stripped.trim_start_matches(prefix).trim_start();
        }
    }
    if stripped.is_empty() {
        "(no subject)".to_string()
    } else {
        stripped.to_string()
    }
}

fn decode_header_value_bytes(raw: &[u8]) -> String {
    let mut header = Vec::with_capacity(raw.len() + 8);
    header.extend_from_slice(b"X: ");
    header.extend_from_slice(raw);
    header.extend_from_slice(b"\r\n");
    if let Ok((parsed, _)) = mailparse::parse_header(&header) {
        let decoded = parsed.get_value().trim().to_string();
        if !decoded.is_empty() {
            return decoded;
        }
    }
    String::from_utf8_lossy(raw).trim().to_string()
}

fn decode_maybe_mime_header(raw: &str) -> String {
    if raw.contains("=?") && raw.contains("?=") {
        let decoded = decode_header_value_bytes(raw.as_bytes());
        if !decoded.is_empty() {
            return decoded;
        }
    }
    raw.to_string()
}

fn thread_id_from(subject: &str, in_reply_to: Option<&str>, message_id: Option<&str>) -> String {
    if let Some(reply) = in_reply_to.filter(|v| !v.trim().is_empty()) {
        return format!(
            "thread:{}",
            Uuid::new_v5(&Uuid::NAMESPACE_OID, reply.as_bytes())
        );
    }
    if let Some(msg_id) = message_id.filter(|v| !v.trim().is_empty()) {
        return format!(
            "thread:{}",
            Uuid::new_v5(&Uuid::NAMESPACE_OID, msg_id.as_bytes())
        );
    }
    let normalized = normalize_subject_for_thread(subject);
    format!(
        "thread:{}",
        Uuid::new_v5(&Uuid::NAMESPACE_OID, normalized.as_bytes())
    )
}

fn upsert_account_v2(
    state: &AppState,
    account: &StoredEmailAccount,
    capabilities: Option<Vec<String>>,
    idle_supported: Option<bool>,
    resolved_mailbox: Option<(&str, &str)>,
) -> Result<(), String> {
    let existing = state
        .store
        .get_email_account_v2(&account.id)
        .map_err(|e| e.to_string())?
        .and_then(parse_json_value::<StoredEmailAccountV2>);

    let mut resolved_mailboxes = existing
        .as_ref()
        .map(|item| item.resolved_mailboxes.clone())
        .unwrap_or_default();
    if let Some((folder, mailbox)) = resolved_mailbox {
        resolved_mailboxes.insert(folder.to_string(), mailbox.to_string());
    }

    let next = StoredEmailAccountV2 {
        id: account.id.clone(),
        workspace_id: workspace_id_or_default(account.workspace_id.as_deref()),
        provider: account.provider.clone(),
        email: account.email.clone(),
        imap_host: account.imap_host.clone(),
        smtp_host: account.smtp_host.clone(),
        imap_port: account.imap_port,
        smtp_port: account.smtp_port,
        capabilities: capabilities
            .or_else(|| existing.as_ref().map(|item| item.capabilities.clone()))
            .unwrap_or_default(),
        idle_supported: idle_supported
            .or_else(|| existing.as_ref().map(|item| item.idle_supported))
            .unwrap_or(false),
        resolved_mailboxes,
        last_sync_at: Some(now_iso()),
        status: account.status.clone(),
        last_error: account.last_error.clone(),
        updated_at: now_iso(),
    };

    state
        .store
        .put_email_account_v2(
            &account.id,
            &serde_json::to_value(next).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

fn remove_account_v2(state: &AppState, account_id: &str) {
    let _ = state.store.remove_email_account_v2(account_id);
}

fn load_folder_cursor(
    state: &AppState,
    account_id: &str,
    folder: &str,
) -> Option<EmailSyncCursorRecord> {
    state
        .store
        .get_email_folder_state(&folder_state_key(account_id, folder))
        .ok()
        .flatten()
        .and_then(parse_json_value::<EmailSyncCursorRecord>)
}

fn save_folder_cursor(state: &AppState, cursor: &EmailSyncCursorRecord) -> Result<(), String> {
    state
        .store
        .put_email_folder_state(
            &folder_state_key(&cursor.account_id, &cursor.folder),
            &serde_json::to_value(cursor).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

fn update_idle_runtime_state(
    state: &AppState,
    account_id: &str,
    folder: &str,
    strategy: &str,
    failed_attempts: u32,
    touch_event_at: bool,
) {
    let key = folder_state_key(account_id, folder);
    let mut cursor = state
        .store
        .get_email_folder_state(&key)
        .ok()
        .flatten()
        .and_then(parse_json_value::<EmailSyncCursorRecord>)
        .unwrap_or(EmailSyncCursorRecord {
            account_id: account_id.to_string(),
            folder: folder.to_string(),
            uid_validity: None,
            uid_next: None,
            last_seen_uid: None,
            exists: 0,
            idle_supported: strategy == "idle",
            idle_strategy: Some(strategy.to_string()),
            idle_failed_attempts: failed_attempts,
            last_idle_event_at: None,
            updated_at: email_now_iso(),
        });
    cursor.idle_strategy = Some(strategy.to_string());
    cursor.idle_failed_attempts = failed_attempts;
    cursor.idle_supported = strategy == "idle";
    if touch_event_at {
        cursor.last_idle_event_at = Some(email_now_iso());
    }
    cursor.updated_at = email_now_iso();
    let _ = save_folder_cursor(state, &cursor);
}

fn upsert_envelope(state: &AppState, envelope: &StoredEnvelope) -> Result<(), String> {
    let key = envelope_key(&envelope.account_id, &envelope.folder, envelope.uid);
    state
        .store
        .put_email_envelope(
            &key,
            &serde_json::to_value(envelope).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

    let order = serde_json::json!({
        "accountId": envelope.account_id,
        "folder": envelope.folder,
        "uid": envelope.uid,
        "timestampMs": envelope.timestamp_ms,
    });
    state
        .store
        .put_email_envelope_order(
            &envelope_order_key(
                &envelope.account_id,
                &envelope.folder,
                envelope.timestamp_ms,
                envelope.uid,
            ),
            &order,
        )
        .map_err(|e| e.to_string())
}

fn remove_envelope(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Result<(), String> {
    state
        .store
        .remove_email_envelope(&envelope_key(account_id, folder, uid))
        .map_err(|e| e.to_string())?;

    let rows = state
        .store
        .list_email_envelope_order()
        .map_err(|e| e.to_string())?;
    for row in rows {
        let Some(v) = parse_json_value::<serde_json::Value>(row) else {
            continue;
        };
        if v.get("accountId").and_then(|x| x.as_str()) == Some(account_id)
            && v.get("folder").and_then(|x| x.as_str()) == Some(folder)
            && v.get("uid").and_then(|x| x.as_u64()) == Some(uid as u64)
        {
            let timestamp_ms = v
                .get("timestampMs")
                .and_then(|x| x.as_i64())
                .unwrap_or_default();
            let _ = state.store.remove_email_envelope_order(&envelope_order_key(
                account_id,
                folder,
                timestamp_ms,
                uid,
            ));
        }
    }
    Ok(())
}

fn list_envelopes_filtered(
    state: &AppState,
    account_id: Option<&str>,
    folder: &str,
) -> Result<Vec<StoredEnvelope>, String> {
    let mut rows = state
        .store
        .list_email_envelopes()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredEnvelope>)
        .filter(|item| item.folder == folder)
        .filter(|item| {
            if let Some(acc) = account_id {
                return item.account_id == acc;
            }
            true
        })
        .collect::<Vec<_>>();

    rows.sort_by(|a, b| {
        b.timestamp_ms
            .cmp(&a.timestamp_ms)
            .then_with(|| b.uid.cmp(&a.uid))
    });
    Ok(rows)
}

fn get_body_cache_from_store(
    store: &crate::store_redb::RedbStore,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Option<StoredBodyCache> {
    store
        .get_email_body(&body_key(account_id, folder, uid))
        .ok()
        .flatten()
        .and_then(parse_json_value::<StoredBodyCache>)
}

fn get_body_cache(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Option<StoredBodyCache> {
    get_body_cache_from_store(&state.store, account_id, folder, uid)
}

fn remove_body_cache(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
) -> Result<(), String> {
    state
        .store
        .remove_email_body(&body_key(account_id, folder, uid))
        .map_err(|e| e.to_string())?;
    let lru_rows = state
        .store
        .list_email_body_lru()
        .map_err(|e| e.to_string())?;
    for row in lru_rows {
        let Some(item) = parse_json_value::<StoredBodyLru>(row) else {
            continue;
        };
        if item.account_id == account_id && item.folder == folder && item.uid == uid {
            let _ = state.store.remove_email_body_lru(&item.key);
        }
    }
    Ok(())
}

fn prune_body_cache_lru(state: &AppState, account_id: &str) -> Result<(), String> {
    let mut entries = state
        .store
        .list_email_bodies()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredBodyCache>)
        .filter(|item| item.account_id == account_id)
        .collect::<Vec<_>>();

    let mut total_bytes = entries.iter().map(|item| item.byte_size).sum::<usize>();
    if entries.len() <= EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT
        && total_bytes <= EMAIL_BODY_MAX_BYTES_PER_ACCOUNT
    {
        return Ok(());
    }

    entries.sort_by(|a, b| a.last_accessed_at.cmp(&b.last_accessed_at));
    for entry in entries {
        if total_bytes <= EMAIL_BODY_MAX_BYTES_PER_ACCOUNT
            && state
                .store
                .list_email_bodies()
                .map_err(|e| e.to_string())?
                .into_iter()
                .filter_map(parse_json_value::<StoredBodyCache>)
                .filter(|item| item.account_id == account_id)
                .count()
                <= EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT
        {
            break;
        }
        total_bytes = total_bytes.saturating_sub(entry.byte_size);
        let _ = remove_body_cache(state, &entry.account_id, &entry.folder, entry.uid);
    }
    Ok(())
}

fn touch_body_cache(state: &AppState, body: &StoredBodyCache) -> Result<(), String> {
    let mut next = body.clone();
    next.last_accessed_at = now_iso();
    state
        .store
        .put_email_body(
            &next.key,
            &serde_json::to_value(&next).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

    let lru = StoredBodyLru {
        key: format!(
            "{}::{}::{}::{}",
            next.account_id, next.last_accessed_at, next.folder, next.uid
        ),
        account_id: next.account_id.clone(),
        folder: next.folder.clone(),
        uid: next.uid,
        last_accessed_at: next.last_accessed_at.clone(),
    };
    state
        .store
        .put_email_body_lru(
            &lru.key,
            &serde_json::to_value(&lru).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

fn persist_body_cache(state: &AppState, body: &StoredBodyCache) -> Result<(), String> {
    state
        .store
        .put_email_body(
            &body.key,
            &serde_json::to_value(body).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    let lru = StoredBodyLru {
        key: format!(
            "{}::{}::{}::{}",
            body.account_id, body.last_accessed_at, body.folder, body.uid
        ),
        account_id: body.account_id.clone(),
        folder: body.folder.clone(),
        uid: body.uid,
        last_accessed_at: body.last_accessed_at.clone(),
    };
    state
        .store
        .put_email_body_lru(
            &lru.key,
            &serde_json::to_value(&lru).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    prune_body_cache_lru(state, &body.account_id)
}

fn mailbox_candidates(provider: &str, folder: &str) -> Vec<String> {
    match folder {
        "inbox" => vec!["INBOX".to_string()],
        "sent" => match provider {
            "gmail" => vec![
                "[Gmail]/Sent Mail".to_string(),
                "Sent Mail".to_string(),
                "Sent".to_string(),
            ],
            "outlook" => vec!["Sent Items".to_string(), "Sent".to_string()],
            "icloud" => vec!["Sent Messages".to_string(), "Sent".to_string()],
            "custom" => vec![
                "Sent".to_string(),
                "Sent Items".to_string(),
                "Sent Messages".to_string(),
                "INBOX.Sent".to_string(),
                "INBOX/Sent".to_string(),
                "INBOX.Sent Items".to_string(),
                "INBOX/Sent Items".to_string(),
                "INBOX.Sent Messages".to_string(),
                "INBOX/Sent Messages".to_string(),
                "sent".to_string(),
            ],
            _ => vec!["Sent".to_string()],
        },
        "drafts" => match provider {
            "gmail" => vec!["[Gmail]/Drafts".to_string(), "Drafts".to_string()],
            "outlook" => vec!["Drafts".to_string()],
            "icloud" => vec!["Drafts".to_string()],
            "custom" => vec![
                "Drafts".to_string(),
                "INBOX.Drafts".to_string(),
                "INBOX/Drafts".to_string(),
                "drafts".to_string(),
            ],
            _ => vec!["Drafts".to_string()],
        },
        "trash" => match provider {
            "gmail" => vec!["[Gmail]/Trash".to_string(), "Trash".to_string()],
            "outlook" => vec!["Deleted Items".to_string(), "Trash".to_string()],
            "icloud" => vec!["Deleted Messages".to_string(), "Trash".to_string()],
            "custom" => vec![
                "Trash".to_string(),
                "Deleted".to_string(),
                "Deleted Items".to_string(),
                "Deleted Messages".to_string(),
                "INBOX.Trash".to_string(),
                "INBOX/Trash".to_string(),
                "INBOX.Deleted".to_string(),
                "INBOX/Deleted".to_string(),
                "INBOX.Deleted Items".to_string(),
                "INBOX/Deleted Items".to_string(),
                "trash".to_string(),
            ],
            _ => vec!["Trash".to_string()],
        },
        "spam" => match provider {
            "gmail" => vec!["[Gmail]/Spam".to_string(), "Spam".to_string()],
            "outlook" => vec![
                "Junk Email".to_string(),
                "Junk".to_string(),
                "Spam".to_string(),
            ],
            "icloud" => vec!["Junk".to_string(), "Spam".to_string()],
            "custom" => vec![
                "Spam".to_string(),
                "Junk".to_string(),
                "Junk Email".to_string(),
                "INBOX.Spam".to_string(),
                "INBOX/Spam".to_string(),
                "INBOX.Junk".to_string(),
                "INBOX/Junk".to_string(),
                "INBOX.Junk Email".to_string(),
                "INBOX/Junk Email".to_string(),
                "spam".to_string(),
            ],
            _ => vec!["Spam".to_string(), "Junk".to_string()],
        },
        _ => vec![folder.to_string()],
    }
}

fn normalize_body_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}

fn normalize_body_html(html: &str) -> String {
    html.replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}

fn html_to_text(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut tag = String::new();
    let mut in_tag = false;

    for ch in html.chars() {
        if in_tag {
            if ch == '>' {
                let tag_name = tag
                    .trim_start_matches('/')
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if matches!(tag_name.as_str(), "br" | "p" | "div" | "li" | "tr" | "hr") {
                    output.push('\n');
                }
                tag.clear();
                in_tag = false;
            } else {
                tag.push(ch);
            }
            continue;
        }

        if ch == '<' {
            in_tag = true;
            continue;
        }

        output.push(ch);
    }

    let decoded = output
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    normalize_body_text(&decoded)
}

fn truncate_with_ellipsis(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    input.chars().take(max_chars).collect::<String>() + "..."
}

fn build_preview(body: &str) -> String {
    let flattened = body.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_with_ellipsis(&flattened, 120)
}

struct ExtractedBody {
    text: String,
    html: Option<String>,
}

fn extract_best_body(parsed: &mailparse::ParsedMail<'_>) -> ExtractedBody {
    let mut text_body: Option<String> = None;
    let mut html_body: Option<String> = None;

    for part in parsed.parts() {
        if matches!(
            part.get_content_disposition().disposition,
            mailparse::DispositionType::Attachment
        ) {
            continue;
        }

        let mime = part.ctype.mimetype.as_str();
        if mime.eq_ignore_ascii_case("text/plain") && text_body.is_none() {
            if let Ok(body) = part.get_body() {
                let clean = normalize_body_text(&body);
                if !clean.is_empty() {
                    text_body = Some(clean);
                }
            }
        } else if mime.eq_ignore_ascii_case("text/html") && html_body.is_none() {
            if let Ok(body) = part.get_body() {
                let clean = normalize_body_html(&body);
                if !clean.is_empty() {
                    html_body = Some(clean);
                }
            }
        }
    }

    if text_body.is_none() {
        text_body = html_body.as_deref().map(html_to_text);
    }
    if text_body.is_none() {
        text_body = parsed
            .get_body()
            .map(|body| normalize_body_text(&body))
            .ok()
            .filter(|body| !body.is_empty());
    }

    ExtractedBody {
        text: text_body.unwrap_or_default(),
        html: html_body,
    }
}

fn parse_address(
    mailbox: Option<&[u8]>,
    host: Option<&[u8]>,
    name: Option<&[u8]>,
) -> (String, String) {
    let user = mailbox
        .map(|v| String::from_utf8_lossy(v).trim().to_string())
        .unwrap_or_default();
    let domain = host
        .map(|v| String::from_utf8_lossy(v).trim().to_string())
        .unwrap_or_default();
    let email = if user.is_empty() && domain.is_empty() {
        String::new()
    } else {
        format!("{}@{}", user, domain).trim_matches('@').to_string()
    };
    let display_name = name
        .map(decode_header_value_bytes)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| email.clone());
    (display_name, email)
}

fn recipients_for_graph(raw_to: &str) -> Vec<String> {
    raw_to
        .split(',')
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|candidate| {
            let trimmed = candidate.trim();
            if let Some(start) = trimmed.find('<') {
                if let Some(end) = trimmed[start + 1..].find('>') {
                    return trimmed[start + 1..start + 1 + end].trim().to_lowercase();
                }
            }
            trimmed.to_lowercase()
        })
        .filter(|email| email.contains('@'))
        .collect()
}

fn extract_domain(email: &str) -> Option<String> {
    let (_, domain) = email.split_once('@')?;
    let normalized = domain.trim().to_lowercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn queue_graph_upsert_for_envelope(
    state: &AppState,
    envelope: &StoredEnvelope,
) -> Result<(), String> {
    let key = format!(
        "{}::{}::{}",
        envelope.account_id, envelope.folder, envelope.uid
    );
    let payload = serde_json::to_value(envelope).map_err(|e| e.to_string())?;
    let entry = StoredGraphOutboxEntry {
        id: key.clone(),
        account_id: envelope.account_id.clone(),
        workspace_id: envelope.workspace_id.clone(),
        payload,
        retry_count: 0,
        next_retry_at: now_iso(),
        last_error: None,
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    state
        .store
        .put_email_graph_outbox(
            &key,
            &serde_json::to_value(entry).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

async fn flush_graph_outbox(
    store: std::sync::Arc<crate::store_redb::RedbStore>,
    graph: std::sync::Arc<crate::graph_helix::GraphManager>,
    account_filter: Option<String>,
) -> Result<(), String> {
    let now = chrono::Utc::now();
    let entries = store
        .list_email_graph_outbox()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredGraphOutboxEntry>)
        .filter(|entry| {
            account_filter
                .as_deref()
                .map(|account_id| entry.account_id == account_id)
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();

    for mut entry in entries {
        let next_retry = chrono::DateTime::parse_from_rfc3339(&entry.next_retry_at)
            .map(|v| v.with_timezone(&chrono::Utc))
            .unwrap_or(now);
        if next_retry > now {
            continue;
        }

        let Some(envelope) = parse_json_value::<StoredEnvelope>(entry.payload.clone()) else {
            let _ = store.remove_email_graph_outbox(&entry.id);
            continue;
        };

        let email_node_id = format!("email:{}", envelope.message_key);
        let sender_email = envelope.sender_email.trim().to_lowercase();
        let sender_node_id = if sender_email.is_empty() {
            None
        } else {
            Some(format!(
                "person:{}",
                Uuid::new_v5(&Uuid::NAMESPACE_OID, sender_email.as_bytes())
            ))
        };
        let sender_domain = extract_domain(&sender_email).map(|domain| {
            (
                domain.clone(),
                format!(
                    "domain:{}",
                    Uuid::new_v5(&Uuid::NAMESPACE_OID, domain.as_bytes())
                ),
            )
        });
        let recipient_emails = recipients_for_graph(&envelope.to);

        let mut nodes = Vec::<GraphNode>::new();
        let mut edges = Vec::<GraphEdge>::new();

        nodes.push(GraphNode {
            id: email_node_id.clone(),
            node_type: "Email".to_string(),
            workspace_id: envelope.workspace_id.clone(),
            payload: serde_json::json!({
                "accountId": envelope.account_id,
                "folder": envelope.folder,
                "uid": envelope.uid,
                "subject": envelope.subject,
                "sender": envelope.sender,
                "senderEmail": envelope.sender_email,
                "date": envelope.date,
                "messageId": envelope.message_id,
                "threadId": envelope.thread_id,
            }),
        });

        let thread_node_id = format!(
            "thread:{}",
            Uuid::new_v5(&Uuid::NAMESPACE_OID, envelope.thread_id.as_bytes())
        );
        nodes.push(GraphNode {
            id: thread_node_id.clone(),
            node_type: "Thread".to_string(),
            workspace_id: envelope.workspace_id.clone(),
            payload: serde_json::json!({
                "threadId": envelope.thread_id,
                "subject": envelope.subject,
            }),
        });
        edges.push(GraphEdge {
            id: format!("edge:part_of:{}", envelope.message_key),
            edge_type: "PART_OF".to_string(),
            workspace_id: envelope.workspace_id.clone(),
            from_id: email_node_id.clone(),
            to_id: thread_node_id,
            payload: serde_json::json!({}),
        });

        if let Some(sender_node_id) = sender_node_id.clone() {
            nodes.push(GraphNode {
                id: sender_node_id.clone(),
                node_type: "Person".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                payload: serde_json::json!({
                    "email": sender_email,
                    "name": envelope.sender,
                }),
            });
            edges.push(GraphEdge {
                id: format!("edge:sent_by:{}", envelope.message_key),
                edge_type: "SENT_BY".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                from_id: email_node_id.clone(),
                to_id: sender_node_id.clone(),
                payload: serde_json::json!({}),
            });
            if let Some((domain, domain_node_id)) = sender_domain.clone() {
                nodes.push(GraphNode {
                    id: domain_node_id.clone(),
                    node_type: "Domain".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    payload: serde_json::json!({ "domain": domain }),
                });
                edges.push(GraphEdge {
                    id: format!("edge:works_at:{}", sender_node_id),
                    edge_type: "WORKS_AT".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    from_id: sender_node_id,
                    to_id: domain_node_id,
                    payload: serde_json::json!({}),
                });
            }
        }

        for recipient in recipient_emails {
            let recipient_node_id = format!(
                "person:{}",
                Uuid::new_v5(&Uuid::NAMESPACE_OID, recipient.as_bytes())
            );
            nodes.push(GraphNode {
                id: recipient_node_id.clone(),
                node_type: "Person".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                payload: serde_json::json!({ "email": recipient }),
            });
            edges.push(GraphEdge {
                id: format!(
                    "edge:sent_to:{}:{}",
                    envelope.message_key, recipient_node_id
                ),
                edge_type: "SENT_TO".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                from_id: email_node_id.clone(),
                to_id: recipient_node_id.clone(),
                payload: serde_json::json!({}),
            });
            if let Some(domain) = extract_domain(&recipient) {
                let domain_node_id = format!(
                    "domain:{}",
                    Uuid::new_v5(&Uuid::NAMESPACE_OID, domain.as_bytes())
                );
                nodes.push(GraphNode {
                    id: domain_node_id.clone(),
                    node_type: "Domain".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    payload: serde_json::json!({ "domain": domain }),
                });
                edges.push(GraphEdge {
                    id: format!("edge:works_at:{}:{}", recipient_node_id, domain_node_id),
                    edge_type: "WORKS_AT".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    from_id: recipient_node_id,
                    to_id: domain_node_id,
                    payload: serde_json::json!({}),
                });
            }
        }

        if let Some(body_cache) =
            get_body_cache_from_store(&store, &envelope.account_id, &envelope.folder, envelope.uid)
        {
            for index in 0..body_cache.attachment_count {
                let attachment_node_id = format!("attachment:{}:{}", envelope.message_key, index);
                nodes.push(GraphNode {
                    id: attachment_node_id.clone(),
                    node_type: "AttachmentMetadata".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    payload: serde_json::json!({
                        "messageKey": envelope.message_key,
                        "index": index,
                    }),
                });
                edges.push(GraphEdge {
                    id: format!("edge:has_attachment:{}:{}", envelope.message_key, index),
                    edge_type: "HAS_ATTACHMENT".to_string(),
                    workspace_id: envelope.workspace_id.clone(),
                    from_id: email_node_id.clone(),
                    to_id: attachment_node_id,
                    payload: serde_json::json!({}),
                });
            }
        }

        if let Some(in_reply_to) = envelope.in_reply_to.as_deref().filter(|v| !v.is_empty()) {
            let parent_id = format!(
                "email:reply:{}",
                Uuid::new_v5(&Uuid::NAMESPACE_OID, in_reply_to.as_bytes())
            );
            edges.push(GraphEdge {
                id: format!("edge:in_reply_to:{}", envelope.message_key),
                edge_type: "IN_REPLY_TO".to_string(),
                workspace_id: envelope.workspace_id.clone(),
                from_id: email_node_id,
                to_id: parent_id,
                payload: serde_json::json!({ "inReplyTo": in_reply_to }),
            });
        }

        let request = crate::graph_helix::GraphUpsertRequest {
            workspace_id: envelope.workspace_id.clone(),
            nodes,
            edges,
        };

        match graph.upsert_nodes_edges(&store, request).await {
            Ok(()) => {
                let _ = store.remove_email_graph_outbox(&entry.id);
            }
            Err(error) => {
                entry.retry_count = entry.retry_count.saturating_add(1);
                let jitter = fastrand::u32(..3000) as i64;
                let delay_secs = (2_i64.pow(entry.retry_count.min(6))) + jitter / 1000;
                entry.next_retry_at =
                    (chrono::Utc::now() + chrono::Duration::seconds(delay_secs)).to_rfc3339();
                entry.last_error = Some(error.to_string());
                entry.updated_at = now_iso();
                let _ = store.put_email_graph_outbox(
                    &entry.id,
                    &serde_json::to_value(&entry).map_err(|e| e.to_string())?,
                );
            }
        }
    }

    Ok(())
}

fn schedule_graph_outbox_flush(state: &AppState, account_filter: Option<String>) {
    if !state.graph.is_enabled() {
        return;
    }
    if GRAPH_FLUSH_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let store = state.store.clone();
    let graph = state.graph.clone();
    tauri::async_runtime::spawn(async move {
        let _ = flush_graph_outbox(store, graph, account_filter).await;
        GRAPH_FLUSH_RUNNING.store(false, Ordering::SeqCst);
    });
}

fn idle_workers() -> &'static Mutex<HashMap<String, IdleWorkerControl>> {
    IDLE_WORKERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn idle_worker_key(account_id: &str, folder: &str) -> String {
    format!("{}::{}", account_id, folder)
}

fn stop_idle_workers_for_account(account_id: &str) {
    let mut workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
    let keys = workers
        .keys()
        .filter(|key| key.starts_with(&format!("{}::", account_id)))
        .cloned()
        .collect::<Vec<_>>();
    for key in keys {
        if let Some(control) = workers.remove(&key) {
            control.stop.store(true, Ordering::SeqCst);
            control.handle.abort();
        }
    }
}

pub fn stop_all_idle_workers() {
    let mut workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
    let keys = workers.keys().cloned().collect::<Vec<_>>();
    for key in keys {
        if let Some(control) = workers.remove(&key) {
            control.stop.store(true, Ordering::SeqCst);
            control.handle.abort();
        }
    }
}

fn idle_poll_interval_for_account(state: &AppState, account_id: &str) -> Duration {
    let activity = state
        .store
        .get_email_ui_state(EMAIL_ACTIVITY_UI_STATE_KEY)
        .ok()
        .flatten()
        .and_then(parse_json_value::<EmailActivityStateRecord>);
    if let Some(activity) = activity {
        if matches!(activity.mode, EmailActivityMode::MailForeground)
            && activity.active_account_id.as_deref() == Some(account_id)
        {
            return Duration::from_secs(IDLE_ACTIVE_POLL_SECS);
        }
    }
    Duration::from_secs(IDLE_BACKGROUND_POLL_SECS)
}

enum IdleCycleOutcome {
    MailboxChanged,
    RenewTimeout,
    NoIdleSupport,
    AuthFailed,
    NetworkError,
    ServerError,
    OtherError,
}

fn classify_idle_error(error: &str) -> IdleCycleOutcome {
    let normalized = error.to_lowercase();
    if normalized.contains("auth")
        || normalized.contains("invalid credentials")
        || normalized.contains("reauth")
        || normalized.contains("login failed")
    {
        return IdleCycleOutcome::AuthFailed;
    }
    if normalized.contains("network")
        || normalized.contains("timed out")
        || normalized.contains("broken pipe")
        || normalized.contains("connection reset")
        || normalized.contains("no route")
        || normalized.contains("dns")
    {
        return IdleCycleOutcome::NetworkError;
    }
    if normalized.contains("bye")
        || normalized.contains("server")
        || normalized.contains("overloaded")
        || normalized.contains("unavailable")
    {
        return IdleCycleOutcome::ServerError;
    }
    IdleCycleOutcome::OtherError
}

fn run_idle_cycle_blocking(
    app: &tauri::AppHandle,
    account_id: &str,
    folder: &str,
) -> Result<IdleCycleOutcome, String> {
    let state = app.state::<AppState>();
    let accounts = read_accounts(&state)?;
    let Some(account) = accounts.into_iter().find(|item| item.id == account_id) else {
        return Err("account_not_found".to_string());
    };
    let config = ensure_account_config(&state, &account)?;
    let mut session = open_idle_imap_session(&config)?;

    let idle_supported = session
        .capabilities()
        .map(|caps| caps.has_str("IDLE"))
        .unwrap_or(false);
    if !idle_supported {
        let _ = session.logout();
        return Ok(IdleCycleOutcome::NoIdleSupport);
    }

    let _ = select_mailbox_for_folder(&mut session, account.provider.as_str(), folder)?;

    let dead_silence = Duration::from_secs(IDLE_DEAD_CONNECTION_SILENCE_SECS);
    let mut renewal_left = Duration::from_secs(IDLE_RENEWAL_SECS);
    loop {
        let wait_slice = renewal_left.min(dead_silence);
        let wait_result = if let Ok(handle) = session.idle() {
            handle.wait_with_timeout(wait_slice)
        } else {
            return Err("idle_start_failed".to_string());
        };

        match wait_result {
            Ok(imap::extensions::idle::WaitOutcome::MailboxChanged) => {
                let _ = session.logout();
                sync_account_folder_envelopes(&state, &account, folder, false)?;
                let _ = flush_flag_outbox_for_account(&state, &account);
                let _ = patch_account_sync_state(&state, &account.id, "active", None);
                schedule_graph_outbox_flush(&state, Some(account.id.clone()));
                return Ok(IdleCycleOutcome::MailboxChanged);
            }
            Ok(imap::extensions::idle::WaitOutcome::TimedOut) => {
                renewal_left = renewal_left.saturating_sub(wait_slice);
                if renewal_left.is_zero() {
                    let _ = session.logout();
                    return Ok(IdleCycleOutcome::RenewTimeout);
                }

                // Dedicated command connection liveness probe while idle loop is active.
                // If this fails, treat the idle channel as dead and reconnect.
                let mut cmd_session = open_imap_session(&config)?;
                let _ =
                    select_mailbox_for_folder(&mut cmd_session, account.provider.as_str(), folder)?;
                if let Err(error) = cmd_session.noop() {
                    let _ = cmd_session.logout();
                    let _ = session.logout();
                    return Ok(classify_idle_error(&error.to_string()));
                }
                let _ = cmd_session.logout();
            }
            Err(error) => {
                let _ = session.logout();
                return Ok(classify_idle_error(&error.to_string()));
            }
        }
    }
}

fn run_poll_sync_blocking(
    app: &tauri::AppHandle,
    account_id: &str,
    folder: &str,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let accounts = read_accounts(&state)?;
    let Some(account) = accounts.into_iter().find(|item| item.id == account_id) else {
        return Err("account_not_found".to_string());
    };
    sync_account_folder_envelopes(&state, &account, folder, false)?;
    let _ = flush_flag_outbox_for_account(&state, &account);
    let _ = patch_account_sync_state(&state, &account.id, "active", None);
    schedule_graph_outbox_flush(&state, Some(account.id.clone()));
    Ok(())
}

fn ensure_idle_worker(
    app: &tauri::AppHandle,
    account_id: String,
    folder: String,
    stagger: Duration,
) {
    let key = idle_worker_key(&account_id, &folder);
    {
        let workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
        if workers.contains_key(&key) {
            return;
        }
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let app_handle = app.clone();
    let key_for_remove = key.clone();
    let account_for_task = account_id.clone();
    let folder_for_task = folder.clone();
    let initial_strategy = {
        let state = app_handle.state::<AppState>();
        load_folder_cursor(&state, &account_for_task, &folder_for_task)
            .and_then(|cursor| cursor.idle_strategy)
            .unwrap_or_else(|| "idle".to_string())
    };

    let handle = tauri::async_runtime::spawn(async move {
        if !stagger.is_zero() {
            tokio::time::sleep(stagger).await;
        }

        let mut attempts = 0usize;
        let mut polling_fallback = initial_strategy == "polling_fallback_no_idle";

        loop {
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }

            if polling_fallback {
                let app_for_sync = app_handle.clone();
                let account_for_sync = account_for_task.clone();
                let folder_for_sync = folder_for_task.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    run_poll_sync_blocking(&app_for_sync, &account_for_sync, &folder_for_sync)
                })
                .await;
                {
                    let state = app_handle.state::<AppState>();
                    update_idle_runtime_state(
                        &state,
                        &account_for_task,
                        &folder_for_task,
                        if initial_strategy == "polling_fallback_no_idle" {
                            "polling_fallback_no_idle"
                        } else {
                            "polling_fallback"
                        },
                        attempts as u32,
                        false,
                    );
                }

                let interval = {
                    let state = app_handle.state::<AppState>();
                    idle_poll_interval_for_account(&state, &account_for_task)
                };
                tokio::time::sleep(interval).await;
                continue;
            }

            let app_for_idle = app_handle.clone();
            let account_for_idle = account_for_task.clone();
            let folder_for_idle = folder_for_task.clone();
            let cycle_started_at = std::time::Instant::now();
            let outcome = tauri::async_runtime::spawn_blocking(move || {
                run_idle_cycle_blocking(&app_for_idle, &account_for_idle, &folder_for_idle)
            })
            .await;
            let cycle_elapsed = cycle_started_at.elapsed();

            match outcome {
                Ok(Ok(IdleCycleOutcome::MailboxChanged | IdleCycleOutcome::RenewTimeout)) => {
                    if cycle_elapsed >= Duration::from_secs(IDLE_STABLE_SESSION_RESET_SECS) {
                        attempts = 0;
                    } else {
                        attempts = attempts.saturating_sub(1);
                    }
                    let state = app_handle.state::<AppState>();
                    update_idle_runtime_state(
                        &state,
                        &account_for_task,
                        &folder_for_task,
                        "idle",
                        0,
                        true,
                    );
                }
                Ok(Ok(IdleCycleOutcome::NoIdleSupport)) => {
                    polling_fallback = true;
                    let state = app_handle.state::<AppState>();
                    update_idle_runtime_state(
                        &state,
                        &account_for_task,
                        &folder_for_task,
                        "polling_fallback_no_idle",
                        attempts as u32,
                        false,
                    );
                }
                Ok(Ok(IdleCycleOutcome::AuthFailed)) => {
                    let state = app_handle.state::<AppState>();
                    update_idle_runtime_state(
                        &state,
                        &account_for_task,
                        &folder_for_task,
                        "stopped_auth_failed",
                        attempts as u32,
                        false,
                    );
                    break;
                }
                Ok(Ok(
                    IdleCycleOutcome::NetworkError
                    | IdleCycleOutcome::ServerError
                    | IdleCycleOutcome::OtherError,
                ))
                | Ok(Err(_))
                | Err(_) => {
                    attempts = attempts.saturating_add(1);
                    if attempts >= IDLE_MAX_ATTEMPTS_BEFORE_FALLBACK {
                        polling_fallback = true;
                        let state = app_handle.state::<AppState>();
                        update_idle_runtime_state(
                            &state,
                            &account_for_task,
                            &folder_for_task,
                            "polling_fallback",
                            attempts as u32,
                            false,
                        );
                        continue;
                    }
                    {
                        let state = app_handle.state::<AppState>();
                        update_idle_runtime_state(
                            &state,
                            &account_for_task,
                            &folder_for_task,
                            "idle_reconnecting",
                            attempts as u32,
                            false,
                        );
                    }
                    let delay = IDLE_RECONNECT_DELAYS_SECS
                        .get(attempts.saturating_sub(1))
                        .copied()
                        .unwrap_or(*IDLE_RECONNECT_DELAYS_SECS.last().unwrap_or(&300));
                    tokio::time::sleep(Duration::from_secs(delay)).await;
                }
            }
        }

        let mut workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
        let _ = workers.remove(&key_for_remove);
    });

    let mut workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
    workers.insert(key, IdleWorkerControl { stop, handle });
}

fn bootstrap_idle_workers_for_state(app: &tauri::AppHandle, state: &AppState) {
    let activity = state
        .store
        .get_email_ui_state(EMAIL_ACTIVITY_UI_STATE_KEY)
        .ok()
        .flatten()
        .and_then(parse_json_value::<EmailActivityStateRecord>);
    let Ok(accounts) = read_accounts(state) else {
        return;
    };
    if accounts.is_empty() {
        return;
    }

    if let Some(activity) = activity {
        if matches!(activity.mode, EmailActivityMode::MailForeground) {
            if let Some(active_account_id) = activity.active_account_id.as_deref() {
                if active_account_id != ALL_ACCOUNTS_ID {
                    let folder = activity
                        .active_folder
                        .clone()
                        .unwrap_or_else(|| "inbox".to_string());
                    ensure_idle_worker(app, active_account_id.to_string(), folder, Duration::ZERO);
                }
            }
            let mut index = 1u64;
            for account in accounts {
                if activity.active_account_id.as_deref() == Some(account.id.as_str()) {
                    continue;
                }
                ensure_idle_worker(
                    app,
                    account.id,
                    "inbox".to_string(),
                    Duration::from_secs(index * IDLE_STAGGER_SECS),
                );
                index = index.saturating_add(1);
            }
            return;
        }
    }

    // App foreground non-mail and app background are both inbox-only refresh modes.
    for (index, account) in accounts.into_iter().enumerate() {
        ensure_idle_worker(
            app,
            account.id,
            "inbox".to_string(),
            Duration::from_secs((index as u64) * IDLE_STAGGER_SECS),
        );
    }
}

pub fn bootstrap_idle_workers(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    bootstrap_idle_workers_for_state(app, &state);
}

fn validate_connection(config: &EmailConfig) -> Result<bool, String> {
    let mut session = open_imap_session(config)?;
    let _ = session.logout();
    Ok(true)
}

type ImapSession = imap::Session<native_tls::TlsStream<TcpStream>>;

fn open_tuned_tcp_stream(
    host: &str,
    port: u16,
    read_timeout: Option<Duration>,
    write_timeout: Option<Duration>,
) -> Result<TcpStream, String> {
    let mut addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("imap_resolve_failed:{e}"))?;
    let addr = addrs
        .next()
        .ok_or_else(|| format!("imap_resolve_empty:{host}:{port}"))?;
    let domain = if addr.is_ipv4() {
        socket2::Domain::IPV4
    } else {
        socket2::Domain::IPV6
    };
    let socket = socket2::Socket::new(domain, socket2::Type::STREAM, Some(socket2::Protocol::TCP))
        .map_err(|e| format!("imap_socket_open_failed:{e}"))?;
    let keepalive = socket2::TcpKeepalive::new()
        .with_time(Duration::from_secs(IMAP_TCP_KEEPALIVE_SECS))
        .with_interval(Duration::from_secs(IMAP_TCP_KEEPALIVE_SECS));
    let _ = socket.set_tcp_keepalive(&keepalive);
    socket
        .connect_timeout(
            &socket2::SockAddr::from(addr),
            Duration::from_secs(IMAP_CONNECT_TIMEOUT_SECS),
        )
        .map_err(|e| format!("imap_connect_failed:{e}"))?;
    let stream: TcpStream = socket.into();
    stream
        .set_read_timeout(read_timeout)
        .map_err(|e| format!("imap_set_read_timeout_failed:{e}"))?;
    stream
        .set_write_timeout(write_timeout)
        .map_err(|e| format!("imap_set_write_timeout_failed:{e}"))?;
    Ok(stream)
}

fn open_imap_session_with_timeouts(
    config: &EmailConfig,
    read_timeout: Option<Duration>,
    write_timeout: Option<Duration>,
) -> Result<ImapSession, String> {
    let tls = TlsConnector::builder().build().map_err(|e| e.to_string())?;
    let stream = open_tuned_tcp_stream(
        config.imap_host(),
        config.imap_port(),
        read_timeout,
        write_timeout,
    )?;
    let tls_stream = tls
        .connect(config.imap_host(), stream)
        .map_err(|e| format!("imap_tls_failed:{e}"))?;
    let mut client = imap::Client::new(tls_stream);
    client
        .read_greeting()
        .map_err(|e| format!("imap_greeting_failed:{e}"))?;
    client
        .login(&config.email, &config.password)
        .map_err(|e| e.0.to_string())
}

fn open_imap_session(config: &EmailConfig) -> Result<ImapSession, String> {
    open_imap_session_with_timeouts(
        config,
        Some(Duration::from_secs(IMAP_SYNC_IO_TIMEOUT_SECS)),
        Some(Duration::from_secs(IMAP_SYNC_IO_TIMEOUT_SECS)),
    )
}

fn open_idle_imap_session(config: &EmailConfig) -> Result<ImapSession, String> {
    open_imap_session_with_timeouts(
        config,
        Some(Duration::from_secs(IDLE_GREETING_TIMEOUT_SECS)),
        Some(Duration::from_secs(IDLE_GREETING_TIMEOUT_SECS)),
    )
}

fn select_mailbox_for_folder(
    session: &mut ImapSession,
    provider: &str,
    folder: &str,
) -> Result<(String, imap::types::Mailbox), String> {
    for mailbox in mailbox_candidates(provider, folder) {
        if let Ok(info) = session.select(mailbox.as_str()) {
            return Ok((mailbox, info));
        }
    }
    Err(format!("folder_select_failed:{}:{}", provider, folder))
}

fn ensure_account_config(
    state: &AppState,
    account: &StoredEmailAccount,
) -> Result<EmailConfig, String> {
    let Some(password) = get_password_for_account(state, &account.id)? else {
        return Err("account_reauth_required".to_string());
    };
    Ok(EmailConfig {
        provider: account.provider.clone(),
        email: account.email.clone(),
        password,
        imap_host: account.imap_host.clone(),
        smtp_host: account.smtp_host.clone(),
        imap_port: account.imap_port,
        smtp_port: account.smtp_port,
    })
}

fn fetch_envelopes_for_uids(
    session: &mut ImapSession,
    account: &StoredEmailAccount,
    folder: &str,
    uid_validity: Option<u32>,
    uids: &[u32],
) -> Result<Vec<StoredEnvelope>, String> {
    if uids.is_empty() {
        return Ok(Vec::new());
    }

    let query = uids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");

    let fetches = session
        .uid_fetch(
            query,
            "(UID ENVELOPE FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID IN-REPLY-TO)])",
        )
        .map_err(|e| format!("uid_fetch_failed:{}", e))?;

    let workspace_id = workspace_id_or_default(account.workspace_id.as_deref());
    let mut rows = Vec::new();

    for item in fetches.iter() {
        let uid = item.uid.unwrap_or_default();
        if uid == 0 {
            continue;
        }

        let Some(env) = item.envelope() else {
            continue;
        };

        let subject = env
            .subject
            .as_ref()
            .map(|v| decode_header_value_bytes(v))
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "(No subject)".to_string());
        let date = env
            .date
            .as_ref()
            .map(|v| decode_header_value_bytes(v))
            .unwrap_or_else(now_iso);
        let (sender, sender_email) =
            if let Some(addr) = env.from.as_ref().and_then(|list| list.first()) {
                parse_address(
                    addr.mailbox.as_deref(),
                    addr.host.as_deref(),
                    addr.name.as_deref(),
                )
            } else {
                ("Unknown sender".to_string(), String::new())
            };
        let to = if let Some(to_list) = &env.to {
            to_list
                .iter()
                .filter_map(|addr| {
                    let (_, email) = parse_address(
                        addr.mailbox.as_deref(),
                        addr.host.as_deref(),
                        addr.name.as_deref(),
                    );
                    if email.is_empty() {
                        None
                    } else {
                        Some(email)
                    }
                })
                .collect::<Vec<_>>()
                .join(", ")
        } else {
            String::new()
        };
        let message_id = env
            .message_id
            .as_ref()
            .map(|v| decode_header_value_bytes(v))
            .filter(|v| !v.is_empty());
        let in_reply_to = env
            .in_reply_to
            .as_ref()
            .map(|v| decode_header_value_bytes(v))
            .filter(|v| !v.is_empty());
        let preview = truncate_with_ellipsis(&subject, 120);
        let timestamp_ms = to_millis_from_date(&date);
        let mut read = false;
        let mut starred = false;
        for flag in item.flags() {
            if matches!(flag, imap::types::Flag::Seen) {
                read = true;
            }
            if matches!(flag, imap::types::Flag::Flagged) {
                starred = true;
            }
        }

        let thread_id = thread_id_from(&subject, in_reply_to.as_deref(), message_id.as_deref());
        let message_key = message_key(&account.id, uid_validity, uid);
        rows.push(StoredEnvelope {
            id: format!("{}::{}::{}", account.id, folder, uid),
            message_key: message_key.clone(),
            account_id: account.id.clone(),
            workspace_id: workspace_id.clone(),
            folder: folder.to_string(),
            uid,
            uid_validity,
            sender,
            sender_email,
            to,
            subject,
            preview,
            date,
            timestamp_ms,
            read,
            starred,
            size: item.size,
            message_id,
            in_reply_to,
            thread_id,
            updated_at: now_iso(),
        });
    }

    Ok(rows)
}

fn uid_window_start(end_uid: u32, window: u32) -> u32 {
    if end_uid == 0 {
        return 0;
    }
    end_uid.saturating_sub(window.saturating_sub(1)).max(1)
}

fn collect_uid_range(start_uid: u32, end_uid: u32) -> Vec<u32> {
    if start_uid == 0 || end_uid == 0 || start_uid > end_uid {
        return Vec::new();
    }
    (start_uid..=end_uid).collect::<Vec<_>>()
}

fn resolve_uid_next(
    session: &mut ImapSession,
    mailbox_uid_next: Option<u32>,
) -> Result<u32, String> {
    if let Some(uid_next) = mailbox_uid_next {
        return Ok(uid_next);
    }
    let all_uid_set = session
        .uid_search("ALL")
        .map_err(|e| format!("uid_search_failed:{}", e))?;
    let max_uid = all_uid_set.iter().copied().max().unwrap_or(0);
    Ok(max_uid.saturating_add(1))
}

fn search_uid_window(
    session: &mut ImapSession,
    start_uid: u32,
    end_uid: u32,
) -> Result<HashSet<u32>, String> {
    if start_uid == 0 || end_uid == 0 || start_uid > end_uid {
        return Ok(HashSet::new());
    }
    let query = format!("{}:{}", start_uid, end_uid);
    let result = session
        .uid_search(query)
        .map_err(|e| format!("uid_search_failed:{}", e))?;
    Ok(result.iter().copied().collect::<HashSet<_>>())
}

fn sync_account_folder_envelopes(
    state: &AppState,
    account: &StoredEmailAccount,
    folder: &str,
    force_sync: bool,
) -> Result<(), String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let (capabilities, idle_supported, condstore_supported) = session
        .capabilities()
        .map(|caps| {
            let values = caps
                .iter()
                .map(|cap| format!("{:?}", cap))
                .collect::<Vec<_>>();
            let idle = caps.has_str("IDLE");
            let condstore = caps.has_str("CONDSTORE");
            (values, idle, condstore)
        })
        .unwrap_or((vec![], false, false));

    let (resolved_mailbox, mailbox_info) =
        select_mailbox_for_folder(&mut session, account.provider.as_str(), folder)?;
    let uid_validity = mailbox_info.uid_validity;
    let uid_next = resolve_uid_next(&mut session, mailbox_info.uid_next)?;
    let exists = mailbox_info.exists;
    let latest_uid = uid_next.saturating_sub(1);

    let current_cursor = load_folder_cursor(state, &account.id, folder);
    let current_local = list_envelopes_filtered(state, Some(&account.id), folder)?;
    let should_full_reset = current_cursor.is_none()
        || current_cursor
            .as_ref()
            .map(|cursor| cursor.uid_validity != uid_validity)
            .unwrap_or(true);

    let uids_to_fetch = if should_full_reset {
        let start_uid = uid_window_start(latest_uid, DEFAULT_MAILBOX_LIMIT as u32);
        collect_uid_range(start_uid, latest_uid)
    } else {
        let last_seen = current_cursor
            .as_ref()
            .and_then(|cursor| cursor.last_seen_uid)
            .unwrap_or_default();
        let mut delta = collect_uid_range(last_seen.saturating_add(1), latest_uid);
        if delta.is_empty() && (current_local.is_empty() || force_sync) {
            let start_uid = uid_window_start(latest_uid, DEFAULT_MAILBOX_LIMIT as u32);
            delta = collect_uid_range(start_uid, latest_uid);
        }
        delta
    };

    for chunk in uids_to_fetch.chunks(50) {
        let rows = fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
        for row in rows {
            upsert_envelope(state, &row)?;
            let _ = queue_graph_upsert_for_envelope(state, &row);
        }
    }

    if should_full_reset {
        let fetched_set = uids_to_fetch.iter().copied().collect::<HashSet<u32>>();
        for row in current_local {
            if !fetched_set.contains(&row.uid) {
                let _ = remove_envelope(state, &row.account_id, &row.folder, row.uid);
                let _ = remove_body_cache(state, &row.account_id, &row.folder, row.uid);
            }
        }
    }

    let reconcile_window = if force_sync {
        FLAG_RECONCILE_WINDOW
    } else {
        FLAG_RECONCILE_WINDOW_LIGHT
    };
    let reconcile_start = uid_window_start(latest_uid, reconcile_window);
    let reconcile_uids = collect_uid_range(reconcile_start, latest_uid);
    let mut reconciled_with_condstore = false;
    if condstore_supported && !reconcile_uids.is_empty() {
        let uid_set = format!("{}:{}", reconcile_start, latest_uid);
        // We currently do not persist MODSEQ from fetch responses with this IMAP crate,
        // so we use CHANGEDSINCE 1 to let compliant servers optimize flags-only deltas.
        let condstore_query = "(UID FLAGS) (CHANGEDSINCE 1)";
        if let Ok(fetches) = session.uid_fetch(uid_set, condstore_query) {
            let mut missing_uids = Vec::<u32>::new();
            for item in fetches.iter() {
                let uid = item.uid.unwrap_or_default();
                if uid == 0 {
                    continue;
                }
                let existing = state
                    .store
                    .get_email_envelope(&envelope_key(&account.id, folder, uid))
                    .map_err(|e| e.to_string())?
                    .and_then(parse_json_value::<StoredEnvelope>);
                if let Some(mut envelope) = existing {
                    let mut read = false;
                    let mut starred = false;
                    for flag in item.flags() {
                        if matches!(flag, imap::types::Flag::Seen) {
                            read = true;
                        }
                        if matches!(flag, imap::types::Flag::Flagged) {
                            starred = true;
                        }
                    }
                    envelope.read = read;
                    envelope.starred = starred;
                    envelope.updated_at = now_iso();
                    upsert_envelope(state, &envelope)?;
                } else {
                    missing_uids.push(uid);
                }
            }
            for chunk in missing_uids.chunks(50) {
                let rows =
                    fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
                for row in rows {
                    upsert_envelope(state, &row)?;
                }
            }
            reconciled_with_condstore = true;
        }
    }
    if !reconciled_with_condstore {
        for chunk in reconcile_uids.chunks(50) {
            let rows =
                fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
            for row in rows {
                upsert_envelope(state, &row)?;
            }
        }
    }

    let recent_server_uids = search_uid_window(&mut session, reconcile_start, latest_uid)?;
    let local_rows = list_envelopes_filtered(state, Some(&account.id), folder)?;
    for row in local_rows {
        if row.uid >= reconcile_start
            && row.uid <= latest_uid
            && !recent_server_uids.contains(&row.uid)
        {
            let _ = remove_envelope(state, &row.account_id, &row.folder, row.uid);
            let _ = remove_body_cache(state, &row.account_id, &row.folder, row.uid);
        }
    }

    // Safety net: if server reports messages but local index is empty, rebuild latest window.
    let post_reconcile_count = list_envelopes_filtered(state, Some(&account.id), folder)?.len();
    if post_reconcile_count == 0 && exists > 0 && latest_uid > 0 {
        let recovery_start = uid_window_start(latest_uid, DEFAULT_MAILBOX_LIMIT as u32);
        let recovery_uids = collect_uid_range(recovery_start, latest_uid);
        for chunk in recovery_uids.chunks(50) {
            let rows =
                fetch_envelopes_for_uids(&mut session, account, folder, uid_validity, chunk)?;
            for row in rows {
                upsert_envelope(state, &row)?;
                let _ = queue_graph_upsert_for_envelope(state, &row);
            }
        }
    }

    let previous_seen = current_cursor
        .as_ref()
        .and_then(|cursor| cursor.last_seen_uid)
        .unwrap_or_default();
    let next_last_seen = previous_seen.max(latest_uid);

    let cursor = EmailSyncCursorRecord {
        account_id: account.id.clone(),
        folder: folder.to_string(),
        uid_validity,
        uid_next: Some(uid_next),
        last_seen_uid: if next_last_seen == 0 {
            None
        } else {
            Some(next_last_seen)
        },
        exists,
        idle_supported,
        idle_strategy: Some(if idle_supported {
            "idle".to_string()
        } else {
            "polling".to_string()
        }),
        idle_failed_attempts: 0,
        last_idle_event_at: Some(email_now_iso()),
        updated_at: email_now_iso(),
    };
    save_folder_cursor(state, &cursor)?;
    upsert_account_v2(
        state,
        account,
        Some(capabilities),
        Some(idle_supported),
        Some((folder, &resolved_mailbox)),
    )?;

    let _ = session.logout();
    Ok(())
}

fn body_cache_from_fetch(
    account: &StoredEmailAccount,
    folder: &str,
    uid: u32,
    raw: &[u8],
) -> StoredBodyCache {
    let mut body = String::new();
    let mut body_html = None;
    let mut attachment_count = 0usize;

    if let Ok(parsed) = mailparse::parse_mail(raw) {
        let extracted = extract_best_body(&parsed);
        body = extracted.text;
        body_html = extracted.html;
        for part in parsed.parts() {
            if matches!(
                part.get_content_disposition().disposition,
                mailparse::DispositionType::Attachment
            ) {
                attachment_count = attachment_count.saturating_add(1);
            }
        }
    }
    if body.is_empty() {
        body = normalize_body_text(&String::from_utf8_lossy(raw));
    }

    let ts = now_iso();
    StoredBodyCache {
        key: body_key(&account.id, folder, uid),
        account_id: account.id.clone(),
        folder: folder.to_string(),
        uid,
        body,
        body_html,
        byte_size: raw.len(),
        attachment_count,
        fetched_at: ts.clone(),
        last_accessed_at: ts,
    }
}

fn fetch_body_from_imap(
    state: &AppState,
    account: &StoredEmailAccount,
    folder: &str,
    uid: u32,
) -> Result<StoredBodyCache, String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let _ = select_mailbox_for_folder(&mut session, account.provider.as_str(), folder)?;

    let fetches = session
        .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
        .map_err(|e| format!("uid_fetch_body_failed:{}", e))?;
    let Some(first) = fetches.iter().next() else {
        let _ = session.logout();
        return Err("email_not_found".to_string());
    };
    let Some(raw) = first.body() else {
        let _ = session.logout();
        return Err("email_body_missing".to_string());
    };

    let cache = body_cache_from_fetch(account, folder, uid, raw);
    persist_body_cache(state, &cache)?;
    let _ = session.logout();
    Ok(cache)
}

fn queue_flag_outbox(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
    flag: &str,
    value: bool,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let entry = StoredFlagOutboxEntry {
        id: id.clone(),
        account_id: account_id.to_string(),
        folder: folder.to_string(),
        uid,
        flag: flag.to_string(),
        value,
        retry_count: 0,
        next_retry_at: now_iso(),
        last_error: None,
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    state
        .store
        .put_email_flag_outbox(
            &id,
            &serde_json::to_value(entry).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    Ok(id)
}

fn update_envelope_flag_optimistic(
    state: &AppState,
    account_id: &str,
    folder: &str,
    uid: u32,
    flag: &str,
    value: bool,
) -> Result<(), String> {
    let key = envelope_key(account_id, folder, uid);
    let Some(mut envelope) = state
        .store
        .get_email_envelope(&key)
        .map_err(|e| e.to_string())?
        .and_then(parse_json_value::<StoredEnvelope>)
    else {
        return Ok(());
    };
    match flag {
        "seen" => envelope.read = value,
        "starred" => envelope.starred = value,
        _ => {}
    }
    envelope.updated_at = now_iso();
    upsert_envelope(state, &envelope)
}

fn flush_flag_outbox_for_account(
    state: &AppState,
    account: &StoredEmailAccount,
) -> Result<bool, String> {
    let config = ensure_account_config(state, account)?;
    let mut session = open_imap_session(&config)?;
    let now = chrono::Utc::now();
    let mut any_success = false;

    let entries = state
        .store
        .list_email_flag_outbox()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredFlagOutboxEntry>)
        .filter(|entry| entry.account_id == account.id)
        .collect::<Vec<_>>();

    for mut entry in entries {
        let next_retry_at = chrono::DateTime::parse_from_rfc3339(&entry.next_retry_at)
            .map(|v| v.with_timezone(&chrono::Utc))
            .unwrap_or(now);
        if next_retry_at > now {
            continue;
        }

        let _ = select_mailbox_for_folder(&mut session, account.provider.as_str(), &entry.folder)?;
        let imap_flag = match entry.flag.as_str() {
            "seen" => "\\Seen",
            "starred" => "\\Flagged",
            _ => {
                let _ = state.store.remove_email_flag_outbox(&entry.id);
                continue;
            }
        };
        let query = if entry.value {
            format!("+FLAGS.SILENT ({})", imap_flag)
        } else {
            format!("-FLAGS.SILENT ({})", imap_flag)
        };
        match session.uid_store(entry.uid.to_string(), query) {
            Ok(_) => {
                any_success = true;
                let _ = state.store.remove_email_flag_outbox(&entry.id);
                let _ = update_envelope_flag_optimistic(
                    state,
                    &entry.account_id,
                    &entry.folder,
                    entry.uid,
                    &entry.flag,
                    entry.value,
                );
            }
            Err(error) => {
                entry.retry_count = entry.retry_count.saturating_add(1);
                if entry.retry_count > 8 {
                    let _ = state.store.remove_email_flag_outbox(&entry.id);
                    continue;
                }
                let jitter_ms = fastrand::u32(..1500) as i64;
                let delay = (2_i64.pow(entry.retry_count.min(6))) + jitter_ms / 1000;
                entry.next_retry_at =
                    (chrono::Utc::now() + chrono::Duration::seconds(delay)).to_rfc3339();
                entry.last_error = Some(error.to_string());
                entry.updated_at = now_iso();
                let _ = state.store.put_email_flag_outbox(
                    &entry.id,
                    &serde_json::to_value(&entry).map_err(|e| e.to_string())?,
                );
            }
        }
    }

    let _ = session.logout();
    Ok(any_success)
}

fn fetch_messages(config: &EmailConfig, folder: &str) -> Result<Vec<EmailMessage>, String> {
    let tls = TlsConnector::builder().build().map_err(|e| e.to_string())?;
    let client = imap::connect(
        (config.imap_host(), config.imap_port()),
        config.imap_host(),
        &tls,
    )
    .map_err(|e| e.to_string())?;
    let mut session = client
        .login(&config.email, &config.password)
        .map_err(|e| e.0.to_string())?;

    let mut selected = false;
    for mailbox in mailbox_candidates(config.provider.as_str(), folder) {
        if session.select(mailbox.as_str()).is_ok() {
            selected = true;
            break;
        }
    }

    if !selected {
        let _ = session.logout();
        return Err(format!(
            "folder_select_failed:{}:{}",
            config.provider.as_str(),
            folder
        ));
    }

    let search_res = session
        .search("ALL")
        .map_err(|e| format!("search_failed:{}", e))?;
    let mut seq_ids: Vec<u32> = search_res.into_iter().collect();
    seq_ids.sort();

    let last_ids: Vec<u32> = seq_ids.into_iter().rev().take(20).collect();
    if last_ids.is_empty() {
        let _ = session.logout();
        return Ok(vec![]);
    }

    let seq_str = last_ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let fetches = session
        .fetch(&seq_str, "(ENVELOPE FLAGS BODY.PEEK[])")
        .map_err(|e| format!("fetch_failed:{}", e))?;

    let mut results = vec![];
    for msg in fetches.iter() {
        let envelope = msg.envelope();

        let mut body = String::new();
        let mut body_html: Option<String> = None;
        let mut subject = String::new();
        let mut sender_email = String::new();
        let mut sender_name = String::new();
        let mut to = String::new();
        let mut date = String::new();

        if let Some(raw) = msg.body() {
            if let Ok(parsed) = mailparse::parse_mail(raw) {
                subject = parsed
                    .headers
                    .get_first_value("Subject")
                    .unwrap_or_default();
                date = parsed.headers.get_first_value("Date").unwrap_or_default();
                to = parsed.headers.get_first_value("To").unwrap_or_default();

                if let Some(from_header) = parsed.headers.get_first_header("From") {
                    if let Ok(parsed_from) = mailparse::addrparse_header(from_header) {
                        for entry in parsed_from.into_inner() {
                            if let MailAddr::Single(single) = entry {
                                sender_email = single.addr;
                                sender_name =
                                    single.display_name.unwrap_or_else(|| sender_email.clone());
                                break;
                            }
                        }
                    }
                }

                let extracted = extract_best_body(&parsed);
                body = extracted.text;
                body_html = extracted.html;
            }
        }

        if body.is_empty() {
            if let Some(text) = msg.text() {
                body = normalize_body_text(&String::from_utf8_lossy(text));
            }
        }

        if let Some(env) = envelope {
            if subject.is_empty() {
                subject = env
                    .subject
                    .as_ref()
                    .map(|s| decode_header_value_bytes(s))
                    .unwrap_or_default();
            }
            if date.is_empty() {
                date = env
                    .date
                    .as_ref()
                    .map(|s| decode_header_value_bytes(s))
                    .unwrap_or_default();
            }
            if sender_email.is_empty() || sender_name.is_empty() {
                if let Some(from_addr) = env.from.as_ref().and_then(|h| h.first()) {
                    if sender_email.is_empty() {
                        let user =
                            String::from_utf8_lossy(from_addr.mailbox.as_deref().unwrap_or(b""));
                        let host =
                            String::from_utf8_lossy(from_addr.host.as_deref().unwrap_or(b""));
                        sender_email = format!("{}@{}", user, host);
                    }
                    if sender_name.is_empty() {
                        sender_name =
                            decode_header_value_bytes(from_addr.name.as_deref().unwrap_or(b""));
                    }
                }
            }
            if to.is_empty() {
                if let Some(to_addr) = env.to.as_ref().and_then(|h| h.first()) {
                    let user = String::from_utf8_lossy(to_addr.mailbox.as_deref().unwrap_or(b""));
                    let host = String::from_utf8_lossy(to_addr.host.as_deref().unwrap_or(b""));
                    let addr = format!("{}@{}", user, host);
                    to = addr.trim_matches('@').to_string();
                }
            }
        }

        if sender_name.is_empty() {
            sender_name = if sender_email.is_empty() {
                "Unknown sender".to_string()
            } else {
                sender_email.clone()
            };
        }
        if subject.is_empty() {
            subject = "(No subject)".to_string();
        }

        let preview = build_preview(&body);

        let mut is_read = false;
        let mut is_starred = false;
        for flag in msg.flags() {
            if matches!(flag, imap::types::Flag::Seen) {
                is_read = true;
            }
            if matches!(flag, imap::types::Flag::Flagged) {
                is_starred = true;
            }
        }

        results.push(EmailMessage {
            id: msg.message.to_string(),
            sender: sender_name,
            sender_email,
            to,
            subject,
            preview,
            body,
            body_html,
            date,
            read: is_read,
            starred: is_starred,
            folder: folder.to_string(),
        });
    }

    results.reverse();

    let _ = session.logout();
    Ok(results)
}

fn send_message(config: &EmailConfig, to: &str, subject: &str, body: &str) -> Result<bool, String> {
    let from_addr = format!("{} <{}>", config.email, config.email)
        .parse()
        .map_err(|e| format!("Invalid from: {}", e))?;
    let to_addr = to.parse().map_err(|e| format!("Invalid to: {}", e))?;

    let email = Message::builder()
        .from(from_addr)
        .to(to_addr)
        .subject(subject)
        .body(body.to_string())
        .map_err(|e| e.to_string())?;

    let creds = Credentials::new(config.email.clone(), config.password.clone());
    let mailer = SmtpTransport::builder_dangerous(config.smtp_host())
        .port(config.smtp_port())
        .credentials(creds)
        .build();

    mailer.send(&email).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn email_accounts_list(
    state: State<'_, AppState>,
) -> Result<Vec<EmailAccountPublic>, String> {
    let mut accounts = read_accounts(&state)?;
    let mut changed = false;

    for account in accounts.iter_mut() {
        let has_secret = get_password_for_account(&state, &account.id)?.is_some();
        if has_secret {
            if account.status == "reauth_required" {
                account.status = "active".to_string();
                account.last_error = None;
                changed = true;
            }
        } else if account.status != "reauth_required"
            || account.last_error.as_deref() != Some("missing_account_secret")
        {
            account.status = "reauth_required".to_string();
            account.last_error = Some("missing_account_secret".to_string());
            changed = true;
        }
    }

    if changed {
        write_accounts(&state, &accounts)?;
    }

    let mut public_accounts = accounts
        .into_iter()
        .map(|entry| entry.to_public())
        .collect::<Vec<_>>();
    public_accounts.sort_by(|a, b| a.email.cmp(&b.email));
    Ok(public_accounts)
}

#[tauri::command]
pub async fn email_account_connect_and_save(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailAccountConnectInput,
) -> Result<EmailAccountPublic, String> {
    let provider = normalize_provider(&input.provider)?;
    let email = normalize_email(&input.email)?;
    if input.password.is_empty() {
        return Err("missing_password".to_string());
    }
    let imap_host = normalize_optional_host(&input.imap_host);
    let smtp_host = normalize_optional_host(&input.smtp_host);
    let imap_port = normalize_optional_port(input.imap_port);
    let smtp_port = normalize_optional_port(input.smtp_port);
    if provider == "custom"
        && (imap_host.is_none()
            || smtp_host.is_none()
            || imap_port.is_none()
            || smtp_port.is_none())
    {
        return Err("missing_custom_mail_hosts".to_string());
    }

    let config = EmailConfig {
        provider: provider.clone(),
        email: email.clone(),
        password: input.password.clone(),
        imap_host: imap_host.clone(),
        smtp_host: smtp_host.clone(),
        imap_port,
        smtp_port,
    };
    validate_connection(&config)?;

    let id = account_id(&provider, &email, imap_host.as_deref());
    let keychain_write = keychain::set_secret(
        &state.config.keychain_service,
        &keychain_account_key(&id),
        &input.password,
    );
    let keychain_has_secret = match keychain_write {
        Ok(()) => {
            keychain::get_secret_strict(&state.config.keychain_service, &keychain_account_key(&id))
                .map_err(|e| e.to_string())?
                .is_some()
        }
        Err(_) => false,
    };
    if !keychain_has_secret {
        write_password_fallback(&state, &id, &input.password)?;
    } else {
        clear_password_fallback(&state, &id);
    }

    let mut accounts = read_accounts(&state)?;
    if let Some(existing) = accounts.iter_mut().find(|account| account.id == id) {
        existing.workspace_id = input.workspace_id.clone();
        existing.provider = provider;
        existing.email = email;
        existing.imap_host = imap_host;
        existing.smtp_host = smtp_host;
        existing.imap_port = imap_port;
        existing.smtp_port = smtp_port;
        existing.status = "active".to_string();
        existing.last_error = None;
    } else {
        accounts.push(StoredEmailAccount {
            id: id.clone(),
            workspace_id: input.workspace_id.clone(),
            provider,
            email,
            imap_host,
            smtp_host,
            imap_port,
            smtp_port,
            last_sync_at: None,
            status: "active".to_string(),
            last_error: None,
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
    ensure_idle_worker(
        &app,
        saved.id.clone(),
        "inbox".to_string(),
        Duration::from_secs(0),
    );
    Ok(saved.to_public())
}

#[tauri::command]
pub async fn email_account_disconnect(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<(), String> {
    let mut accounts = read_accounts(&state)?;
    accounts.retain(|account| account.id != account_id);
    write_accounts(&state, &accounts)?;

    let _ = keychain::delete_secret(
        &state.config.keychain_service,
        &keychain_account_key(&account_id),
    );
    clear_password_fallback(&state, &account_id);
    remove_account_v2(&state, &account_id);
    stop_idle_workers_for_account(&account_id);
    Ok(())
}

#[tauri::command]
pub async fn email_sync_now(
    state: State<'_, AppState>,
    input: EmailSyncNowInput,
) -> Result<EmailSyncNowResult, String> {
    let folder = input.folder.unwrap_or_else(|| "inbox".to_string());
    let accounts = resolve_accounts_for_target(&state, input.account_id.as_deref())?;
    let mut synced_accounts = 0usize;

    for account in accounts {
        match sync_account_folder_envelopes(&state, &account, &folder, false) {
            Ok(()) => {
                synced_accounts = synced_accounts.saturating_add(1);
                let _ = patch_account_sync_state(&state, &account.id, "active", None);
                let _ = flush_flag_outbox_for_account(&state, &account);
            }
            Err(error) => {
                let status = if error.contains("reauth_required") {
                    "reauth_required"
                } else {
                    "error"
                };
                let _ = patch_account_sync_state(&state, &account.id, status, Some(error));
            }
        }
    }

    schedule_graph_outbox_flush(&state, input.account_id.clone());

    Ok(EmailSyncNowResult {
        synced_accounts,
        synced_at: now_iso(),
    })
}

#[tauri::command]
pub async fn email_list_envelopes(
    state: State<'_, AppState>,
    input: EmailListEnvelopesInput,
) -> Result<EmailListEnvelopesResult, String> {
    let folder = input.folder.trim().to_lowercase();
    let limit = input
        .limit
        .unwrap_or(EMAIL_DEFAULT_LIST_LIMIT)
        .max(1)
        .min(500);
    let force_sync = input.force_sync.unwrap_or(false);
    let target_account = input.account_id.as_deref();

    let account_filter = if matches!(target_account, Some(ALL_ACCOUNTS_ID) | None) {
        None
    } else {
        target_account
    };

    let mut local_rows = list_envelopes_filtered(&state, account_filter, &folder)?;
    if force_sync {
        let accounts = resolve_accounts_for_target(&state, target_account)?;
        for account in accounts {
            match sync_account_folder_envelopes(&state, &account, &folder, force_sync) {
                Ok(()) => {
                    let _ = patch_account_sync_state(&state, &account.id, "active", None);
                    let _ = flush_flag_outbox_for_account(&state, &account);
                }
                Err(error) => {
                    let status = if error.contains("reauth_required") {
                        "reauth_required"
                    } else {
                        "error"
                    };
                    let _ = patch_account_sync_state(&state, &account.id, status, Some(error));
                }
            }
        }
        schedule_graph_outbox_flush(&state, target_account.map(|value| value.to_string()));
        local_rows = list_envelopes_filtered(&state, account_filter, &folder)?;
    }

    local_rows.truncate(limit);
    let envelopes = local_rows
        .into_iter()
        .map(|item| EmailEnvelopeDto {
            id: item.id,
            message_key: item.message_key,
            account_id: item.account_id.clone(),
            folder: item.folder.clone(),
            uid: item.uid,
            sender: decode_maybe_mime_header(&item.sender),
            sender_email: item.sender_email,
            to: item.to,
            subject: decode_maybe_mime_header(&item.subject),
            preview: decode_maybe_mime_header(&item.preview),
            date: item.date,
            read: item.read,
            starred: item.starred,
            size: item.size,
            message_id: item.message_id,
            in_reply_to: item.in_reply_to,
            thread_id: item.thread_id,
            has_cached_body: get_body_cache(&state, &item.account_id, &item.folder, item.uid)
                .is_some(),
        })
        .collect::<Vec<_>>();

    if let Some(account_id) = account_filter {
        let ui_key = format!("{}{}", EMAIL_FOLDER_UI_STATE_PREFIX, account_id);
        let _ = state.store.put_email_ui_state(
            &ui_key,
            &serde_json::json!({
                "accountId": account_id,
                "folder": folder,
                "updatedAt": now_iso(),
            }),
        );
    }

    Ok(EmailListEnvelopesResult {
        total: envelopes.len(),
        envelopes,
        synced_at: now_iso(),
    })
}

#[tauri::command]
pub async fn email_get_message_body(
    state: State<'_, AppState>,
    input: EmailGetMessageBodyInput,
) -> Result<EmailGetMessageBodyResult, String> {
    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let Some(account) = accounts.into_iter().next() else {
        return Err("account_not_found".to_string());
    };

    if let Some(cached) = get_body_cache(&state, &input.account_id, &input.folder, input.uid) {
        let _ = touch_body_cache(&state, &cached);
        return Ok(EmailGetMessageBodyResult {
            account_id: input.account_id,
            folder: input.folder,
            uid: input.uid,
            body: cached.body,
            body_html: cached.body_html,
            cached: true,
            fetched_at: cached.fetched_at,
        });
    }

    let fresh = fetch_body_from_imap(&state, &account, &input.folder, input.uid)?;
    if let Some(envelope) = state
        .store
        .get_email_envelope(&envelope_key(&input.account_id, &input.folder, input.uid))
        .map_err(|e| e.to_string())?
        .and_then(parse_json_value::<StoredEnvelope>)
    {
        let _ = queue_graph_upsert_for_envelope(&state, &envelope);
    }
    schedule_graph_outbox_flush(&state, Some(input.account_id.clone()));

    Ok(EmailGetMessageBodyResult {
        account_id: input.account_id,
        folder: input.folder,
        uid: input.uid,
        body: fresh.body,
        body_html: fresh.body_html,
        cached: false,
        fetched_at: fresh.fetched_at,
    })
}

#[tauri::command]
pub async fn email_prefetch_bodies(
    state: State<'_, AppState>,
    input: EmailPrefetchBodiesInput,
) -> Result<EmailPrefetchBodiesResult, String> {
    let limit = input
        .limit
        .unwrap_or(EMAIL_PREFETCH_DEFAULT_LIMIT)
        .max(1)
        .min(50);
    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let Some(account) = accounts.into_iter().next() else {
        return Err("account_not_found".to_string());
    };

    let mut prefetched = 0usize;
    for uid in input.uids.into_iter().take(limit) {
        if get_body_cache(&state, &input.account_id, &input.folder, uid).is_some() {
            continue;
        }
        if fetch_body_from_imap(&state, &account, &input.folder, uid).is_ok() {
            if let Some(envelope) = state
                .store
                .get_email_envelope(&envelope_key(&input.account_id, &input.folder, uid))
                .map_err(|e| e.to_string())?
                .and_then(parse_json_value::<StoredEnvelope>)
            {
                let _ = queue_graph_upsert_for_envelope(&state, &envelope);
            }
            prefetched = prefetched.saturating_add(1);
        }
    }
    schedule_graph_outbox_flush(&state, Some(input.account_id.clone()));
    Ok(EmailPrefetchBodiesResult { prefetched })
}

#[tauri::command]
pub async fn email_set_activity_state(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailSetActivityStateInput,
) -> Result<(), String> {
    let record = EmailActivityStateRecord {
        mode: input.mode.clone(),
        active_account_id: input.active_account_id.clone(),
        active_folder: input.active_folder.clone(),
        updated_at: now_iso(),
    };
    state
        .store
        .put_email_ui_state(
            EMAIL_ACTIVITY_UI_STATE_KEY,
            &serde_json::to_value(record).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;

    if matches!(input.mode, EmailActivityMode::MailForeground) {
        if let Some(active_account_id) = input.active_account_id.as_deref() {
            if active_account_id != ALL_ACCOUNTS_ID {
                let folder = input
                    .active_folder
                    .clone()
                    .unwrap_or_else(|| "inbox".to_string());
                let app_for_sync = app.clone();
                let active_account_for_sync = active_account_id.to_string();
                let folder_for_sync = folder.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    let sync_state = app_for_sync.state::<AppState>();
                    if let Ok(accounts) = resolve_accounts_for_target(
                        &sync_state,
                        Some(active_account_for_sync.as_str()),
                    ) {
                        if let Some(account) = accounts.first() {
                            let _ = sync_account_folder_envelopes(
                                &sync_state,
                                account,
                                &folder_for_sync,
                                true,
                            );
                            let _ = flush_flag_outbox_for_account(&sync_state, account);
                            let _ =
                                patch_account_sync_state(&sync_state, &account.id, "active", None);
                            schedule_graph_outbox_flush(&sync_state, Some(account.id.clone()));
                        }
                    }
                })
                .await;
                ensure_idle_worker(
                    &app,
                    active_account_id.to_string(),
                    folder,
                    Duration::from_secs(0),
                );
            }
        }

        // Keep other accounts warm with staggered starts.
        let accounts = read_accounts(&state)?;
        let mut index = 1u64;
        for account in accounts {
            if input.active_account_id.as_deref() == Some(account.id.as_str()) {
                continue;
            }
            ensure_idle_worker(
                &app,
                account.id,
                "inbox".to_string(),
                Duration::from_secs(index * IDLE_STAGGER_SECS),
            );
            index = index.saturating_add(1);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn email_apply_flag(
    state: State<'_, AppState>,
    input: EmailApplyFlagInput,
) -> Result<EmailApplyFlagResult, String> {
    let flag = input.flag.trim().to_lowercase();
    if flag != "seen" && flag != "starred" {
        return Err("unsupported_flag".to_string());
    }

    update_envelope_flag_optimistic(
        &state,
        &input.account_id,
        &input.folder,
        input.uid,
        &flag,
        input.value,
    )?;
    let _ = queue_flag_outbox(
        &state,
        &input.account_id,
        &input.folder,
        input.uid,
        &flag,
        input.value,
    )?;

    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let synced = if let Some(account) = accounts.first() {
        flush_flag_outbox_for_account(&state, account).unwrap_or(false)
    } else {
        false
    };

    Ok(EmailApplyFlagResult {
        accepted: true,
        synced,
    })
}

#[tauri::command]
pub async fn email_get_mailbox_status(
    state: State<'_, AppState>,
    input: EmailMailboxStatusInput,
) -> Result<Vec<EmailMailboxStatusRow>, String> {
    let account_filter = input.account_id.as_deref();
    let rows = state
        .store
        .list_email_envelopes()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(parse_json_value::<StoredEnvelope>)
        .filter(|row| {
            account_filter
                .map(|account_id| row.account_id == account_id)
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();

    let mut grouped: HashMap<(String, String), EmailMailboxStatusRow> = HashMap::new();
    for row in rows {
        let key = (row.account_id.clone(), row.folder.clone());
        let entry = grouped.entry(key).or_insert(EmailMailboxStatusRow {
            account_id: row.account_id.clone(),
            folder: row.folder.clone(),
            total: 0,
            unread: 0,
            starred: 0,
        });
        entry.total = entry.total.saturating_add(1);
        if !row.read {
            entry.unread = entry.unread.saturating_add(1);
        }
        if row.starred {
            entry.starred = entry.starred.saturating_add(1);
        }
    }

    let mut result = grouped.into_values().collect::<Vec<_>>();
    result.sort_by(|a, b| {
        a.account_id
            .cmp(&b.account_id)
            .then_with(|| a.folder.cmp(&b.folder))
    });
    Ok(result)
}

#[tauri::command]
pub async fn email_fetch_saved(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
) -> Result<Vec<EmailMessage>, String> {
    let mut accounts = read_accounts(&state)?;
    let Some(index) = accounts.iter().position(|account| account.id == account_id) else {
        return Err("account_not_found".to_string());
    };

    let account = accounts[index].clone();
    let Some(password) = get_password_for_account(&state, &account.id)? else {
        accounts[index].status = "reauth_required".to_string();
        accounts[index].last_error = Some("missing_account_secret".to_string());
        write_accounts(&state, &accounts)?;
        return Err("account_reauth_required".to_string());
    };

    let config = EmailConfig {
        provider: account.provider,
        email: account.email,
        password,
        imap_host: account.imap_host,
        smtp_host: account.smtp_host,
        imap_port: account.imap_port,
        smtp_port: account.smtp_port,
    };

    match fetch_messages(&config, &folder) {
        Ok(messages) => {
            accounts[index].status = "active".to_string();
            accounts[index].last_error = None;
            accounts[index].last_sync_at = Some(now_iso());
            write_accounts(&state, &accounts)?;
            Ok(messages)
        }
        Err(error) => {
            accounts[index].status = "error".to_string();
            accounts[index].last_error = Some(error.clone());
            write_accounts(&state, &accounts)?;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn email_send_saved(
    state: State<'_, AppState>,
    account_id: String,
    to: String,
    subject: String,
    body: String,
) -> Result<bool, String> {
    let mut accounts = read_accounts(&state)?;
    let Some(index) = accounts.iter().position(|account| account.id == account_id) else {
        return Err("account_not_found".to_string());
    };

    let account = accounts[index].clone();
    let Some(password) = get_password_for_account(&state, &account.id)? else {
        accounts[index].status = "reauth_required".to_string();
        accounts[index].last_error = Some("missing_account_secret".to_string());
        write_accounts(&state, &accounts)?;
        return Err("account_reauth_required".to_string());
    };

    let config = EmailConfig {
        provider: account.provider,
        email: account.email,
        password,
        imap_host: account.imap_host,
        smtp_host: account.smtp_host,
        imap_port: account.imap_port,
        smtp_port: account.smtp_port,
    };

    match send_message(&config, &to, &subject, &body) {
        Ok(result) => {
            accounts[index].status = "active".to_string();
            accounts[index].last_error = None;
            accounts[index].last_sync_at = Some(now_iso());
            write_accounts(&state, &accounts)?;
            Ok(result)
        }
        Err(error) => {
            accounts[index].status = "error".to_string();
            accounts[index].last_error = Some(error.clone());
            write_accounts(&state, &accounts)?;
            Err(error)
        }
    }
}

#[tauri::command]
pub fn email_connect(config: EmailConfig) -> Result<bool, String> {
    validate_connection(&config)
}

#[tauri::command]
pub fn email_fetch(config: EmailConfig, folder: String) -> Result<Vec<EmailMessage>, String> {
    fetch_messages(&config, &folder)
}

#[tauri::command]
pub fn email_send(
    config: EmailConfig,
    to: String,
    subject: String,
    body: String,
) -> Result<bool, String> {
    send_message(&config, &to, &subject, &body)
}
