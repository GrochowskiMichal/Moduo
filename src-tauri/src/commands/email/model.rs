use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::email_sync::EmailActivityMode;

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
pub(super) struct StoredEmailAccount {
    pub(super) id: String,
    #[serde(default)]
    pub(super) workspace_id: Option<String>,
    pub(super) provider: String,
    pub(super) email: String,
    #[serde(default)]
    pub(super) imap_host: Option<String>,
    #[serde(default)]
    pub(super) smtp_host: Option<String>,
    #[serde(default)]
    pub(super) imap_port: Option<u16>,
    #[serde(default)]
    pub(super) smtp_port: Option<u16>,
    pub(super) last_sync_at: Option<String>,
    pub(super) status: String,
    pub(super) last_error: Option<String>,
}

impl StoredEmailAccount {
    pub(super) fn to_public(&self) -> EmailAccountPublic {
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
pub(super) struct StoredEmailAccountV2 {
    pub(super) id: String,
    pub(super) workspace_id: String,
    pub(super) provider: String,
    pub(super) email: String,
    pub(super) imap_host: Option<String>,
    pub(super) smtp_host: Option<String>,
    pub(super) imap_port: Option<u16>,
    pub(super) smtp_port: Option<u16>,
    pub(super) capabilities: Vec<String>,
    pub(super) idle_supported: bool,
    pub(super) resolved_mailboxes: HashMap<String, String>,
    pub(super) last_sync_at: Option<String>,
    pub(super) status: String,
    pub(super) last_error: Option<String>,
    pub(super) updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredEnvelope {
    pub(super) id: String,
    pub(super) message_key: String,
    pub(super) account_id: String,
    pub(super) workspace_id: String,
    pub(super) folder: String,
    pub(super) uid: u32,
    pub(super) uid_validity: Option<u32>,
    pub(super) sender: String,
    pub(super) sender_email: String,
    pub(super) to: String,
    pub(super) subject: String,
    pub(super) preview: String,
    pub(super) date: String,
    pub(super) timestamp_ms: i64,
    pub(super) read: bool,
    pub(super) starred: bool,
    pub(super) size: Option<u32>,
    pub(super) message_id: Option<String>,
    pub(super) in_reply_to: Option<String>,
    pub(super) thread_id: String,
    pub(super) updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredBodyCache {
    pub(super) key: String,
    pub(super) account_id: String,
    pub(super) folder: String,
    pub(super) uid: u32,
    pub(super) body: String,
    pub(super) body_html: Option<String>,
    pub(super) byte_size: usize,
    pub(super) attachment_count: usize,
    pub(super) fetched_at: String,
    pub(super) last_accessed_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredBodyLru {
    pub(super) key: String,
    pub(super) account_id: String,
    pub(super) folder: String,
    pub(super) uid: u32,
    pub(super) last_accessed_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredFlagOutboxEntry {
    pub(super) id: String,
    pub(super) account_id: String,
    pub(super) folder: String,
    pub(super) uid: u32,
    pub(super) flag: String,
    pub(super) value: bool,
    pub(super) retry_count: u32,
    pub(super) next_retry_at: String,
    pub(super) last_error: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredGraphOutboxEntry {
    pub(super) id: String,
    pub(super) account_id: String,
    pub(super) workspace_id: String,
    pub(super) payload: serde_json::Value,
    pub(super) retry_count: u32,
    pub(super) next_retry_at: String,
    pub(super) last_error: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
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
    pub(super) fn imap_host(&self) -> &str {
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

    pub(super) fn smtp_host(&self) -> &str {
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

    pub(super) fn imap_port(&self) -> u16 {
        self.imap_port.unwrap_or(993)
    }

    pub(super) fn smtp_port(&self) -> u16 {
        self.smtp_port.unwrap_or(587)
    }
}
