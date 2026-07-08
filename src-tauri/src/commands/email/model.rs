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
    /// When set, the account authenticates via XOAUTH2 (Gmail OAuth) using this
    /// access token instead of `password` (which is empty for OAuth accounts). The
    /// caller refreshes it before building the config (EM-2).
    #[serde(default)]
    pub oauth_access_token: Option<String>,
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
    /// The `Cc` recipients (comma-joined emails), captured so reply-all keeps
    /// everyone who was CC'd. Defaulted for pre-Cc rows.
    #[serde(default)]
    pub(super) cc: String,
    pub(super) subject: String,
    pub(super) preview: String,
    pub(super) date: String,
    pub(super) timestamp_ms: i64,
    pub(super) read: bool,
    pub(super) starred: bool,
    pub(super) size: Option<u32>,
    pub(super) message_id: Option<String>,
    pub(super) in_reply_to: Option<String>,
    /// The `References` header chain (root-first), stored so threading survives a
    /// missing intermediate message (EM-4). Defaulted for pre-EM-4 rows.
    #[serde(default)]
    pub(super) references: Vec<String>,
    /// Smart-inbox classification signals (EM-10), parsed from HEADER.FIELDS.
    /// `List-Unsubscribe` present → newsletter; `Precedence` bulk/list/auto and
    /// `Auto-Submitted` (≠ no) → notification. Defaulted for pre-EM-10 rows.
    #[serde(default)]
    pub(super) list_unsubscribe: Option<String>,
    #[serde(default)]
    pub(super) precedence: Option<String>,
    #[serde(default)]
    pub(super) auto_submitted: Option<String>,
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

/// Local-search body-text sidecar row (EM-9): an 8KB-truncated lowercase copy of a
/// cached body, keyed like the body cache so it co-prunes with the body LRU.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredBodyText {
    pub(super) key: String,
    pub(super) account_id: String,
    pub(super) folder: String,
    pub(super) uid: u32,
    pub(super) text: String,
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

/// A queued triage op (archive/move/delete) — the generalized sibling of
/// [`StoredFlagOutboxEntry`]. Optimistic-local + queued-remote (EM-5).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredMailOpEntry {
    pub(super) id: String,
    pub(super) account_id: String,
    pub(super) folder: String,
    pub(super) uid: u32,
    /// `"archive"` | `"move"` | `"delete"`.
    pub(super) op: String,
    /// Destination folder for a `move` (the UI-level folder or a raw mailbox name).
    pub(super) dest_folder: Option<String>,
    /// Set once the COPY step has committed, so a retry after an EXPUNGE failure
    /// skips it (else the message would be copied to the destination twice).
    #[serde(default)]
    pub(super) copied: bool,
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
    #[serde(default)]
    pub cc: String,
    pub subject: String,
    pub preview: String,
    pub date: String,
    pub read: bool,
    pub starred: bool,
    pub size: Option<u32>,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    #[serde(default)]
    pub references: Vec<String>,
    /// Smart-inbox signals (EM-10). Presence of `list_unsubscribe` and the
    /// `precedence` / `auto_submitted` values drive the client classifier.
    #[serde(default)]
    pub list_unsubscribe: Option<String>,
    #[serde(default)]
    pub precedence: Option<String>,
    #[serde(default)]
    pub auto_submitted: Option<String>,
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
pub struct EmailGetThreadInput {
    pub account_id: String,
    pub thread_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailGetThreadResult {
    pub thread_id: String,
    /// The thread's messages across all folders, oldest → newest.
    pub messages: Vec<EmailEnvelopeDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailListFoldersInput {
    pub account_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailFolderDto {
    /// The raw IMAP mailbox name (what a move targets).
    pub name: String,
    /// A friendlier leaf label for display.
    pub display_name: String,
    /// The hierarchy delimiter reported by LIST (e.g. `/` or `.`), if any.
    pub delimiter: Option<String>,
    /// True for a `\Noselect` container that can't hold messages.
    pub selectable: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailApplyMessageOpInput {
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
    /// `"archive"` | `"move"` | `"delete"`.
    pub op: String,
    /// Destination for a `move` (required for `move`, ignored otherwise).
    #[serde(default)]
    pub dest_folder: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailApplyMessageOpResult {
    pub accepted: bool,
    /// True if the IMAP step ran immediately (else it's queued for retry).
    pub synced: bool,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSendAttachmentInput {
    pub filename: String,
    pub mime_type: String,
    /// Absolute path on disk; bytes are read at send time (never held in redb).
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSendMessageInput {
    pub account_id: String,
    pub to: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub bcc: Vec<String>,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub text_body: String,
    #[serde(default)]
    pub html_body: Option<String>,
    /// Parent Message-ID for a reply.
    #[serde(default)]
    pub in_reply_to: Option<String>,
    /// The thread's Message-ID chain.
    #[serde(default)]
    pub references: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<EmailSendAttachmentInput>,
    /// Optional client-supplied Message-ID; generated if absent.
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub from_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSendMessageResult {
    /// The bracketed Message-ID the mail was sent with (for Sent-matching / follow-ups).
    pub message_id: String,
    /// Whether a copy was APPENDed to Sent (false for Gmail, which auto-saves).
    pub saved_to_sent: bool,
}

// ── Attachments (EM-7) ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailListAttachmentsInput {
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
}

/// Metadata for one attachment on a received message. Bytes are NEVER carried
/// here — they're fetched on demand by [`EmailSaveAttachmentInput`].
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EmailAttachmentMeta {
    /// Stable id = the part's dotted index path through the MIME tree (e.g. `"1.2"`),
    /// so a save can re-locate the exact part deterministically.
    pub id: String,
    pub filename: String,
    pub mime: String,
    /// Decoded byte length (Content-Transfer-Encoding unapplied).
    pub size: u32,
    pub is_inline: bool,
    pub content_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSaveAttachmentInput {
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
    /// The [`EmailAttachmentMeta::id`] (index path) to save.
    pub attachment_id: String,
    /// Prefilled name for the Save dialog.
    pub default_filename: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSaveAttachmentResult {
    /// False when the user cancels the Save dialog.
    pub saved: bool,
    /// The chosen path (absolute), present only when `saved`.
    pub path: Option<String>,
}

/// A file the user picked in the compose OPEN dialog. The send path reads the bytes
/// from `path` at send time — nothing is held in redb.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailPickedAttachment {
    pub path: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailGetInlineImagesInput {
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
}

/// A small inline `cid:` image, base64-encoded, for substituting
/// `<img src="cid:...">` in the reader HTML.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailInlineImage {
    /// The Content-ID WITHOUT the surrounding angle brackets.
    pub content_id: String,
    pub mime: String,
    pub data_base64: String,
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
