use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use uuid::Uuid;

use self::connection::{open_idle_imap_session, open_imap_session, ImapSession};
use self::flags::{
    flush_flag_outbox_for_account, queue_flag_outbox, update_envelope_flag_optimistic,
};
use self::parsing::{
    decode_maybe_mime_header, extract_best_body, extract_domain, normalize_body_text,
    recipients_for_graph,
};
use self::storage::{
    body_key, envelope_key, get_body_cache, get_body_cache_from_store, list_envelopes_filtered,
    load_folder_cursor, parse_json_value, patch_account_sync_state, persist_body_cache,
    read_accounts, remove_account_v2, resolve_accounts_for_target, save_folder_cursor,
    touch_body_cache, update_idle_runtime_state, upsert_account_v2, upsert_envelope,
    write_accounts,
};
use self::sync::{
    collect_uid_range, fetch_envelopes_for_uids, resolve_uid_next, sync_account_folder_envelopes,
    uid_window_start,
};
use crate::domain::{GraphEdge, GraphNode};
use crate::email_sync::{
    now_iso, EmailActivityMode, EmailActivityStateRecord, EMAIL_BODY_MAX_BYTES_PER_ACCOUNT,
    EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT, EMAIL_DEFAULT_LIST_LIMIT, EMAIL_PREFETCH_DEFAULT_LIMIT,
};
use crate::{keychain, AppState};

mod connection;
mod flags;
mod parsing;
mod storage;
mod sync;

const EMAIL_NAMESPACE: &str = "email";
const EMAIL_ACCOUNTS_KEY: &str = "accounts_v1";
const EMAIL_KEYCHAIN_PREFIX: &str = "email_account::";
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
const IDLE_SUPERVISOR_MAX_WORKERS: usize = 24;
const IDLE_SUPERVISOR_DEBOUNCE_MS: u64 = 250;

static GRAPH_FLUSH_RUNNING: AtomicBool = AtomicBool::new(false);
static WORKER_SUPERVISOR_TICKET: AtomicU64 = AtomicU64::new(0);
static SYNC_INFLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

struct IdleWorkerControl {
    stop: Arc<AtomicBool>,
    handle: tauri::async_runtime::JoinHandle<()>,
    generation_id: u64,
}

static IDLE_WORKERS: OnceLock<Mutex<HashMap<String, IdleWorkerControl>>> = OnceLock::new();

struct SyncPermit {
    key: String,
}

impl Drop for SyncPermit {
    fn drop(&mut self) {
        let mut inflight = sync_inflight().lock().unwrap_or_else(|e| e.into_inner());
        inflight.remove(&self.key);
    }
}

fn sync_inflight() -> &'static Mutex<HashSet<String>> {
    SYNC_INFLIGHT.get_or_init(|| Mutex::new(HashSet::new()))
}

fn try_acquire_sync_permit(key: String) -> Option<SyncPermit> {
    let mut inflight = sync_inflight().lock().unwrap_or_else(|e| e.into_inner());
    if inflight.contains(&key) {
        return None;
    }
    inflight.insert(key.clone());
    Some(SyncPermit { key })
}

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

fn get_password_for_account(state: &AppState, account_id: &str) -> Result<Option<String>, String> {
    keychain::get_secret_strict(
        &state.config.keychain_service,
        &keychain_account_key(account_id),
    )
    .map_err(|e| e.to_string())
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

fn worker_generation_is_current(key: &str, generation_id: u64) -> bool {
    let workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
    workers
        .get(key)
        .map(|control| control.generation_id == generation_id)
        .unwrap_or(false)
}

#[derive(Clone)]
struct DesiredWorkerSpec {
    account_id: String,
    folder: String,
    stagger: Duration,
}

impl DesiredWorkerSpec {
    fn key(&self) -> String {
        idle_worker_key(&self.account_id, &self.folder)
    }
}

struct EmailWorkerSupervisor;

impl EmailWorkerSupervisor {
    fn account_realtime_eligible(account: &StoredEmailAccount) -> bool {
        account.status != "reauth_required"
    }

    fn read_activity_state(state: &AppState) -> Option<EmailActivityStateRecord> {
        state
            .store
            .get_email_ui_state(EMAIL_ACTIVITY_UI_STATE_KEY)
            .ok()
            .flatten()
            .and_then(parse_json_value::<EmailActivityStateRecord>)
    }

    fn desired_topology(
        state: &AppState,
        accounts: &[StoredEmailAccount],
    ) -> Vec<DesiredWorkerSpec> {
        let eligible_accounts = accounts
            .iter()
            .filter(|account| Self::account_realtime_eligible(account))
            .cloned()
            .collect::<Vec<_>>();
        if eligible_accounts.is_empty() {
            return Vec::new();
        }

        let activity = Self::read_activity_state(state);
        let mut desired = Vec::<DesiredWorkerSpec>::new();

        if let Some(activity) = activity {
            if matches!(activity.mode, EmailActivityMode::MailForeground) {
                let active_account = activity
                    .active_account_id
                    .as_deref()
                    .filter(|account_id| *account_id != ALL_ACCOUNTS_ID)
                    .filter(|account_id| {
                        eligible_accounts
                            .iter()
                            .any(|account| account.id == *account_id)
                    });

                if let Some(active_account_id) = active_account {
                    let active_folder = activity
                        .active_folder
                        .as_deref()
                        .map(|value| value.trim().to_lowercase())
                        .filter(|value| !value.is_empty())
                        .unwrap_or_else(|| "inbox".to_string());
                    desired.push(DesiredWorkerSpec {
                        account_id: active_account_id.to_string(),
                        folder: active_folder,
                        stagger: Duration::ZERO,
                    });
                    let mut warm_index = 1u64;
                    for account in &eligible_accounts {
                        if account.id == active_account_id {
                            continue;
                        }
                        desired.push(DesiredWorkerSpec {
                            account_id: account.id.clone(),
                            folder: "inbox".to_string(),
                            stagger: Duration::from_secs(warm_index * IDLE_STAGGER_SECS),
                        });
                        warm_index = warm_index.saturating_add(1);
                    }
                    desired.truncate(IDLE_SUPERVISOR_MAX_WORKERS);
                    return desired;
                }
            }
        }

        for (index, account) in eligible_accounts.iter().enumerate() {
            desired.push(DesiredWorkerSpec {
                account_id: account.id.clone(),
                folder: "inbox".to_string(),
                stagger: Duration::from_secs((index as u64) * IDLE_STAGGER_SECS),
            });
        }
        desired.truncate(IDLE_SUPERVISOR_MAX_WORKERS);
        desired
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

fn schedule_idle_worker_reconcile(app: &tauri::AppHandle, debounce: bool) {
    let ticket = WORKER_SUPERVISOR_TICKET
        .fetch_add(1, Ordering::SeqCst)
        .saturating_add(1);
    let app_handle = app.clone();
    if !debounce {
        reconcile_idle_workers_now(&app_handle);
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(IDLE_SUPERVISOR_DEBOUNCE_MS)).await;
        if WORKER_SUPERVISOR_TICKET.load(Ordering::SeqCst) != ticket {
            return;
        }
        reconcile_idle_workers_now(&app_handle);
    });
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
    IdleStartError,
    IdleWaitError,
    CmdProbeError,
}

enum IdleCycleError {
    AccountNotFound,
    AuthFailed,
    ConnectionFailed(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MailboxRealtimeState {
    Connecting,
    Idling,
    Renewing,
    Recovering,
    PollingFallback,
    AuthRequired,
    Stopped,
}

enum MailboxRealtimeEvent {
    Connected,
    MailboxChanged,
    RenewalElapsed,
    RecoverableError,
    IdleUnsupported,
    AuthFailed,
    StopRequested,
}

struct MailboxRealtimeEngine {
    state: MailboxRealtimeState,
    fallback_no_idle: bool,
}

impl MailboxRealtimeEngine {
    fn new(initial_strategy: &str) -> Self {
        Self {
            state: if initial_strategy == "polling_fallback_no_idle" {
                MailboxRealtimeState::PollingFallback
            } else {
                MailboxRealtimeState::Connecting
            },
            fallback_no_idle: initial_strategy == "polling_fallback_no_idle",
        }
    }

    fn transition(&mut self, event: MailboxRealtimeEvent) {
        self.state = match (self.state, event) {
            (_, MailboxRealtimeEvent::StopRequested) => MailboxRealtimeState::Stopped,
            (_, MailboxRealtimeEvent::AuthFailed) => MailboxRealtimeState::AuthRequired,
            (_, MailboxRealtimeEvent::IdleUnsupported) => {
                self.fallback_no_idle = true;
                MailboxRealtimeState::PollingFallback
            }
            (
                MailboxRealtimeState::Connecting
                | MailboxRealtimeState::Recovering
                | MailboxRealtimeState::Renewing,
                MailboxRealtimeEvent::Connected,
            ) => MailboxRealtimeState::Idling,
            (
                MailboxRealtimeState::Connecting
                | MailboxRealtimeState::Idling
                | MailboxRealtimeState::Recovering
                | MailboxRealtimeState::Renewing,
                MailboxRealtimeEvent::MailboxChanged,
            ) => MailboxRealtimeState::Idling,
            (MailboxRealtimeState::Idling, MailboxRealtimeEvent::RenewalElapsed) => {
                MailboxRealtimeState::Renewing
            }
            (_, MailboxRealtimeEvent::RecoverableError) => MailboxRealtimeState::Recovering,
            (MailboxRealtimeState::PollingFallback, _) => MailboxRealtimeState::PollingFallback,
            (current, _) => current,
        };
    }

    fn idle_strategy_label(&self) -> &'static str {
        if self.fallback_no_idle {
            "polling_fallback_no_idle"
        } else {
            "polling_fallback"
        }
    }
}

fn run_idle_cycle_blocking(
    app: &tauri::AppHandle,
    account_id: &str,
    folder: &str,
) -> Result<IdleCycleOutcome, IdleCycleError> {
    let state = app.state::<AppState>();
    let accounts = read_accounts(&state).map_err(IdleCycleError::ConnectionFailed)?;
    let Some(account) = accounts.into_iter().find(|item| item.id == account_id) else {
        return Err(IdleCycleError::AccountNotFound);
    };
    let config = ensure_account_config(&state, &account).map_err(|error| {
        if error.contains("reauth") || error.contains("auth") {
            IdleCycleError::AuthFailed
        } else {
            IdleCycleError::ConnectionFailed(error)
        }
    })?;

    // idle_conn: exclusively for IDLE mode. Never issue commands here.
    let mut idle_session =
        open_idle_imap_session(&config).map_err(IdleCycleError::ConnectionFailed)?;

    let idle_supported = idle_session
        .capabilities()
        .map(|caps| caps.has_str("IDLE"))
        .unwrap_or(false);
    if !idle_supported {
        let _ = idle_session.logout();
        return Ok(IdleCycleOutcome::NoIdleSupport);
    }

    let _ = select_mailbox_for_folder(&mut idle_session, account.provider.as_str(), folder)
        .map_err(IdleCycleError::ConnectionFailed)?;

    // cmd_conn: persistent command connection — used for NOOP probes and post-EXISTS fetches.
    // Opened once per 29-min cycle, not per-tick.
    let mut cmd_session = open_imap_session(&config).map_err(IdleCycleError::ConnectionFailed)?;
    let _ = select_mailbox_for_folder(&mut cmd_session, account.provider.as_str(), folder);

    let dead_silence = Duration::from_secs(IDLE_DEAD_CONNECTION_SILENCE_SECS);
    let mut renewal_left = Duration::from_secs(IDLE_RENEWAL_SECS);

    let outcome = loop {
        let wait_slice = renewal_left.min(dead_silence);
        let wait_result = if let Ok(handle) = idle_session.idle() {
            handle.wait_with_timeout(wait_slice)
        } else {
            break Ok(IdleCycleOutcome::IdleStartError);
        };

        match wait_result {
            Ok(imap::extensions::idle::WaitOutcome::MailboxChanged) => {
                // Micro-fetch: only the new UIDs via cmd_conn, not a full sync.
                // Read last_exists from cursor to calculate how many are new.
                let last_exists = load_folder_cursor(&state, &account.id, folder)
                    .map(|c| c.exists)
                    .unwrap_or(0);

                // Re-select mailbox on cmd_conn to get fresh EXISTS count.
                if let Ok((_, mailbox_info)) =
                    select_mailbox_for_folder(&mut cmd_session, account.provider.as_str(), folder)
                {
                    let server_exists = mailbox_info.exists;
                    let uid_validity = mailbox_info.uid_validity;

                    if server_exists > last_exists {
                        // Calculate new UIDs: from uid_next to uid_next + delta.
                        if let Ok(uid_next) =
                            resolve_uid_next(&mut cmd_session, mailbox_info.uid_next)
                        {
                            let latest_uid = uid_next.saturating_sub(1);
                            // Only fetch the delta window — at most (new_count) UIDs.
                            let new_count = (server_exists - last_exists).min(50);
                            let delta_start = uid_window_start(latest_uid, new_count);
                            let new_uids = collect_uid_range(delta_start, latest_uid);

                            if !new_uids.is_empty() {
                                for chunk in new_uids.chunks(50) {
                                    if let Ok(rows) = fetch_envelopes_for_uids(
                                        &mut cmd_session,
                                        &account,
                                        folder,
                                        uid_validity,
                                        chunk,
                                    ) {
                                        for row in rows {
                                            let _ = upsert_envelope(&state, &row);
                                            let _ = queue_graph_upsert_for_envelope(&state, &row);
                                        }
                                    }
                                }

                                // Update exists count in cursor.
                                if let Some(mut cursor) =
                                    load_folder_cursor(&state, &account.id, folder)
                                {
                                    cursor.exists = server_exists;
                                    cursor.last_seen_uid = Some(latest_uid);
                                    cursor.last_idle_event_at = Some(now_iso());
                                    cursor.updated_at = now_iso();
                                    let _ = save_folder_cursor(&state, &cursor);
                                }
                            }
                        }
                    } else {
                        // Counts match or decreased — could be expunge; do lightweight delta sync.
                        let _ = sync_account_folder_envelopes(&state, &account, folder, false);
                    }
                } else {
                    // cmd_conn select failed — fall back to full sync.
                    let _ = sync_account_folder_envelopes(&state, &account, folder, false);
                }

                let _ = flush_flag_outbox_for_account(&state, &account);
                let _ = patch_account_sync_state(&state, &account.id, "active", None);
                schedule_graph_outbox_flush(&state, Some(account.id.clone()));
                break Ok(IdleCycleOutcome::MailboxChanged);
            }
            Ok(imap::extensions::idle::WaitOutcome::TimedOut) => {
                renewal_left = renewal_left.saturating_sub(wait_slice);
                if renewal_left.is_zero() {
                    // 29-min renewal: DONE + close both connections.
                    break Ok(IdleCycleOutcome::RenewTimeout);
                }

                // Liveness probe on cmd_conn (persistent — no open/close per tick).
                if let Err(error) = cmd_session.noop() {
                    let _ = error;
                    break Ok(IdleCycleOutcome::CmdProbeError);
                }
            }
            Err(error) => {
                let _ = error;
                break Ok(IdleCycleOutcome::IdleWaitError);
            }
        }
    };

    // Always close both connections before returning.
    let _ = idle_session.logout();
    let _ = cmd_session.logout();
    outcome
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

fn start_idle_worker(app: &tauri::AppHandle, spec: DesiredWorkerSpec, generation_id: u64) {
    let key = spec.key();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let app_handle = app.clone();
    let key_for_task = key.clone();
    let account_for_task = spec.account_id.clone();
    let folder_for_task = spec.folder.clone();
    let stagger = spec.stagger;
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
        let mut engine = MailboxRealtimeEngine::new(&initial_strategy);

        loop {
            if !worker_generation_is_current(&key_for_task, generation_id) {
                engine.transition(MailboxRealtimeEvent::StopRequested);
                break;
            }
            if stop_flag.load(Ordering::SeqCst) {
                engine.transition(MailboxRealtimeEvent::StopRequested);
                break;
            }

            match engine.state {
                MailboxRealtimeState::PollingFallback => {
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
                            engine.idle_strategy_label(),
                            attempts as u32,
                            false,
                        );
                    }

                    let interval = {
                        let state = app_handle.state::<AppState>();
                        idle_poll_interval_for_account(&state, &account_for_task)
                    };
                    tokio::time::sleep(interval).await;
                }
                MailboxRealtimeState::Connecting
                | MailboxRealtimeState::Idling
                | MailboxRealtimeState::Renewing
                | MailboxRealtimeState::Recovering => {
                    if matches!(engine.state, MailboxRealtimeState::Recovering) {
                        let delay = IDLE_RECONNECT_DELAYS_SECS
                            .get(attempts.saturating_sub(1))
                            .copied()
                            .unwrap_or(*IDLE_RECONNECT_DELAYS_SECS.last().unwrap_or(&300));
                        tokio::time::sleep(Duration::from_secs(delay)).await;
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
                        Ok(Ok(IdleCycleOutcome::MailboxChanged)) => {
                            attempts = if cycle_elapsed
                                >= Duration::from_secs(IDLE_STABLE_SESSION_RESET_SECS)
                            {
                                0
                            } else {
                                attempts.saturating_sub(1)
                            };
                            engine.transition(MailboxRealtimeEvent::MailboxChanged);
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
                        Ok(Ok(IdleCycleOutcome::RenewTimeout)) => {
                            attempts = if cycle_elapsed
                                >= Duration::from_secs(IDLE_STABLE_SESSION_RESET_SECS)
                            {
                                0
                            } else {
                                attempts.saturating_sub(1)
                            };
                            engine.transition(MailboxRealtimeEvent::RenewalElapsed);
                            {
                                let state = app_handle.state::<AppState>();
                                update_idle_runtime_state(
                                    &state,
                                    &account_for_task,
                                    &folder_for_task,
                                    "idle_renewing",
                                    attempts as u32,
                                    true,
                                );
                            }
                            // Explicit renewal transition: Idling -> Renewing -> Idling.
                            engine.transition(MailboxRealtimeEvent::Connected);
                        }
                        Ok(Ok(IdleCycleOutcome::NoIdleSupport)) => {
                            engine.transition(MailboxRealtimeEvent::IdleUnsupported);
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
                        Ok(Ok(
                            IdleCycleOutcome::IdleStartError
                            | IdleCycleOutcome::IdleWaitError
                            | IdleCycleOutcome::CmdProbeError,
                        ))
                        | Err(_) => {
                            attempts = attempts.saturating_add(1);
                            if attempts >= IDLE_MAX_ATTEMPTS_BEFORE_FALLBACK {
                                engine.transition(MailboxRealtimeEvent::IdleUnsupported);
                                let state = app_handle.state::<AppState>();
                                update_idle_runtime_state(
                                    &state,
                                    &account_for_task,
                                    &folder_for_task,
                                    engine.idle_strategy_label(),
                                    attempts as u32,
                                    false,
                                );
                                continue;
                            }
                            engine.transition(MailboxRealtimeEvent::RecoverableError);
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
                        Ok(Err(IdleCycleError::AuthFailed)) => {
                            engine.transition(MailboxRealtimeEvent::AuthFailed);
                            let state = app_handle.state::<AppState>();
                            update_idle_runtime_state(
                                &state,
                                &account_for_task,
                                &folder_for_task,
                                "stopped_auth_failed",
                                attempts as u32,
                                false,
                            );
                        }
                        Ok(Err(IdleCycleError::AccountNotFound)) => {
                            engine.transition(MailboxRealtimeEvent::StopRequested);
                        }
                        Ok(Err(IdleCycleError::ConnectionFailed(error))) => {
                            let _ = error;
                            attempts = attempts.saturating_add(1);
                            if attempts >= IDLE_MAX_ATTEMPTS_BEFORE_FALLBACK {
                                engine.transition(MailboxRealtimeEvent::IdleUnsupported);
                                let state = app_handle.state::<AppState>();
                                update_idle_runtime_state(
                                    &state,
                                    &account_for_task,
                                    &folder_for_task,
                                    engine.idle_strategy_label(),
                                    attempts as u32,
                                    false,
                                );
                                continue;
                            }
                            engine.transition(MailboxRealtimeEvent::RecoverableError);
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
                    }
                }
                MailboxRealtimeState::AuthRequired | MailboxRealtimeState::Stopped => break,
            }
        }

        let mut workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
        let should_remove = workers
            .get(&key_for_task)
            .map(|control| control.generation_id == generation_id)
            .unwrap_or(false);
        if should_remove {
            let _ = workers.remove(&key_for_task);
        }
    });

    let mut workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(existing) = workers.insert(
        key,
        IdleWorkerControl {
            stop: stop.clone(),
            handle,
            generation_id,
        },
    ) {
        existing.stop.store(true, Ordering::SeqCst);
        existing.handle.abort();
    }
}

fn reconcile_idle_workers_now(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let Ok(accounts) = read_accounts(&state) else {
        return;
    };
    let desired = EmailWorkerSupervisor::desired_topology(&state, &accounts);
    let desired_keys = desired
        .iter()
        .map(DesiredWorkerSpec::key)
        .collect::<HashSet<_>>();
    let generation_id = WORKER_SUPERVISOR_TICKET.load(Ordering::SeqCst);

    let (keys_to_stop, running_keys) = {
        let workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
        let keys_to_stop = workers
            .keys()
            .filter(|key| !desired_keys.contains(*key))
            .cloned()
            .collect::<Vec<_>>();
        let running_keys = workers.keys().cloned().collect::<HashSet<_>>();
        (keys_to_stop, running_keys)
    };
    if !keys_to_stop.is_empty() {
        let mut workers = idle_workers().lock().unwrap_or_else(|e| e.into_inner());
        for key in keys_to_stop {
            if let Some(control) = workers.remove(&key) {
                control.stop.store(true, Ordering::SeqCst);
                control.handle.abort();
            }
        }
    }

    for spec in desired {
        if running_keys.contains(&spec.key()) {
            continue;
        }
        start_idle_worker(app, spec, generation_id);
    }
}

pub fn bootstrap_idle_workers(app: &tauri::AppHandle) {
    schedule_idle_worker_reconcile(app, false);
}

fn validate_connection(config: &EmailConfig) -> Result<bool, String> {
    let mut session = open_imap_session(config)?;
    let _ = session.logout();
    Ok(true)
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

// send_message builds and sends an SMTP message. One-shot, not cached.
// This is the only retained send path — email_send_saved uses it.

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
    // validate_connection opens a blocking TCP socket — must not run on the async executor.
    tauri::async_runtime::spawn_blocking(move || validate_connection(&config))
        .await
        .map_err(|e| format!("connect_task_failed:{e}"))??;

    let id = account_id(&provider, &email, imap_host.as_deref());
    keychain::set_secret(
        &state.config.keychain_service,
        &keychain_account_key(&id),
        &input.password,
    )
    .map_err(|e| format!("keychain_store_failed:{e}"))?;

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
    schedule_idle_worker_reconcile(&app, false);
    Ok(saved.to_public())
}

#[tauri::command]
pub async fn email_account_disconnect(
    app: tauri::AppHandle,
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
    remove_account_v2(&state, &account_id);
    schedule_idle_worker_reconcile(&app, false);
    Ok(())
}

#[tauri::command]
pub async fn email_sync_now(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailSyncNowInput,
) -> Result<EmailSyncNowResult, String> {
    let folder = input
        .folder
        .clone()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "inbox".to_string());
    let target_key = input
        .account_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(ALL_ACCOUNTS_ID);
    let sync_key = format!("{}::{}", target_key, folder);
    let Some(_permit) = try_acquire_sync_permit(sync_key) else {
        return Ok(EmailSyncNowResult {
            synced_accounts: 0,
            synced_at: now_iso(),
        });
    };
    let accounts = resolve_accounts_for_target(&state, input.account_id.as_deref())?;

    // IMAP I/O is blocking — must run on a blocking thread to avoid freezing the async executor.
    let app_inner = app.clone();
    let account_id_filter = input.account_id.clone();
    let (synced_accounts, synced_at) = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        let mut synced = 0usize;
        for account in accounts {
            match sync_account_folder_envelopes(&state_inner, &account, &folder, false) {
                Ok(()) => {
                    synced = synced.saturating_add(1);
                    let _ = patch_account_sync_state(&state_inner, &account.id, "active", None);
                    let _ = flush_flag_outbox_for_account(&state_inner, &account);
                }
                Err(error) => {
                    let status = if error.contains("reauth_required") {
                        "reauth_required"
                    } else {
                        "error"
                    };
                    let _ =
                        patch_account_sync_state(&state_inner, &account.id, status, Some(error));
                }
            }
        }
        schedule_graph_outbox_flush(&state_inner, account_id_filter);
        (synced, now_iso())
    })
    .await
    .map_err(|e| format!("sync_task_failed:{e}"))?;

    Ok(EmailSyncNowResult {
        synced_accounts,
        synced_at,
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
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailGetMessageBodyInput,
) -> Result<EmailGetMessageBodyResult, String> {
    let accounts = resolve_accounts_for_target(&state, Some(input.account_id.as_str()))?;
    let Some(account) = accounts.into_iter().next() else {
        return Err("account_not_found".to_string());
    };

    // Serve from cache without touching the network.
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

    // Cache miss — fetch from IMAP. Must run on a blocking thread.
    let app_inner = app.clone();
    let account_id = input.account_id.clone();
    let folder = input.folder.clone();
    let uid = input.uid;
    let fresh = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        match fetch_body_from_imap(&state_inner, &account, &folder, uid) {
            Ok(body_cache) => {
                if let Some(envelope) = state_inner
                    .store
                    .get_email_envelope(&envelope_key(&account_id, &folder, uid))
                    .ok()
                    .flatten()
                    .and_then(parse_json_value::<StoredEnvelope>)
                {
                    let _ = queue_graph_upsert_for_envelope(&state_inner, &envelope);
                }
                schedule_graph_outbox_flush(&state_inner, Some(account_id));
                Ok(body_cache)
            }
            Err(e) => Err(e),
        }
    })
    .await
    .map_err(|e| format!("body_fetch_task_failed:{e}"))??;

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
    app: tauri::AppHandle,
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

    // Prefetch runs on a blocking thread — IMAP I/O must not block the async executor.
    let app_inner = app.clone();
    let account_id = input.account_id.clone();
    let folder = input.folder.clone();
    let uids = input.uids;

    let prefetched = tauri::async_runtime::spawn_blocking(move || {
        let state_inner = app_inner.state::<AppState>();
        let mut count = 0usize;
        for uid in uids.into_iter().take(limit) {
            if get_body_cache(&state_inner, &account_id, &folder, uid).is_some() {
                continue;
            }
            if fetch_body_from_imap(&state_inner, &account, &folder, uid).is_ok() {
                if let Some(envelope) = state_inner
                    .store
                    .get_email_envelope(&envelope_key(&account_id, &folder, uid))
                    .ok()
                    .flatten()
                    .and_then(parse_json_value::<StoredEnvelope>)
                {
                    let _ = queue_graph_upsert_for_envelope(&state_inner, &envelope);
                }
                count = count.saturating_add(1);
            }
        }
        schedule_graph_outbox_flush(&state_inner, Some(account_id));
        count
    })
    .await
    .unwrap_or(0);

    Ok(EmailPrefetchBodiesResult { prefetched })
}

#[tauri::command]
pub async fn email_set_activity_state(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailSetActivityStateInput,
) -> Result<(), String> {
    // Persist activity state so IDLE workers can read poll intervals.
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

    // Worker topology changes are supervised + debounced to prevent rapid folder-switch thrash.
    schedule_idle_worker_reconcile(&app, true);

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

// ── Legacy commands removed ────────────────────────────────────────────────────
// email_fetch_saved, email_connect, email_fetch, email_send have been removed.
// They used the old seq-number based fetch path which:
//   - used IMAP sequence numbers instead of UIDs
//   - fetched bodies inline for all 20 messages
//   - bypassed the StoredEnvelope / Redb persistence system
//   - opened a new IMAP connection per command call
//
// Migration:
//   Old                 → New
//   email_connect       → email_account_connect_and_save
//   email_fetch_saved   → email_list_envelopes (envelopes) + email_get_message_body (body)
//   email_fetch         → email_list_envelopes
//   email_send          → email_send_saved
// ────────────────────────────────────────────────────────────────────────────────

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

    // SMTP send is blocking I/O — run on a dedicated thread.
    let send_result =
        tauri::async_runtime::spawn_blocking(move || send_message(&config, &to, &subject, &body))
            .await
            .map_err(|e| format!("send_task_failed:{e}"))?;

    match send_result {
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
