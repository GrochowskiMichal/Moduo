//! Store inputs and outputs. Output rows serialize camelCase to match
//! `apps/app/src/lib/runtime.types.mail-engine.ts`.

use crate::mail::contracts::{BodyState, ClassifyStage, MailboxRole, TabKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Address {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone)]
pub struct AccountInput {
    pub id: String,
    pub address: String,
    pub display_name: String,
    pub provider: String,
    pub hue: i64,
}

#[derive(Debug, Clone)]
pub struct MailboxInput {
    pub id: String,
    pub account_id: String,
    pub path: String,
    pub name: String,
    pub role: MailboxRole,
    pub delimiter: Option<String>,
    pub live: bool,
}

/// Per-mailbox IMAP sync cursor (decision 5).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MailboxCursor {
    pub uidvalidity: Option<i64>,
    pub uidnext: Option<i64>,
    pub highestmodseq: Option<i64>,
    pub floor_uid: Option<i64>,
    pub backfill_state: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AttachmentInput {
    pub part_id: String,
    pub filename: String,
    pub mime: String,
    pub size: i64,
    pub is_inline: bool,
    pub content_id: Option<String>,
}

/// A tab as stored: `personal`, `notifications`, `newsletters` or `custom:<id>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TabRef {
    pub kind: TabKind,
    pub custom_id: Option<String>,
}

impl TabRef {
    pub fn of(kind: TabKind) -> Self {
        TabRef {
            kind,
            custom_id: None,
        }
    }
    pub fn encode(&self) -> String {
        match (self.kind, &self.custom_id) {
            (TabKind::Custom, Some(id)) => format!("custom:{id}"),
            (k, _) => k.as_str().to_string(),
        }
    }
    pub fn decode(s: &str) -> TabRef {
        if let Some(id) = s.strip_prefix("custom:") {
            return TabRef {
                kind: TabKind::Custom,
                custom_id: Some(id.to_string()),
            };
        }
        TabRef::of(TabKind::parse(s).unwrap_or(TabKind::Personal))
    }
}

/// Which classifier stage sorted a message, and the rule when a rule did (store v2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassifyReason {
    pub stage: ClassifyStage,
    pub rule_id: Option<String>,
}

/// One message seen in one mailbox at header time (MR-3 builds these).
#[derive(Debug, Clone)]
pub struct MessageInput {
    pub account_id: String,
    /// Stable per-account identity: X-GM-MSGID on Gmail, else Message-ID or a hash.
    pub ext_id: String,
    pub mailbox_id: String,
    pub uid: i64,
    pub modseq: Option<i64>,
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub thread_id: String,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub subject: String,
    pub snippet: String,
    pub date_ms: i64,
    pub flags: u32,
    pub size: i64,
    pub list_unsubscribe: Option<String>,
    pub list_unsubscribe_post: Option<String>,
    pub precedence: Option<String>,
    pub auto_submitted: Option<String>,
    pub has_invite: bool,
    pub tab: Option<TabRef>,
    pub priority: bool,
    pub attachments: Vec<AttachmentInput>,
    /// The classifier's reason, stored for "Why is this in X?" (None keeps the stored one).
    pub classify: Option<ClassifyReason>,
}

#[derive(Debug, Clone)]
pub struct BodyInput {
    pub html: Option<String>,
    pub text: Option<String>,
    pub quote_offset: Option<i64>,
    pub tracker_count: i64,
    pub state: BodyState,
}

/// Which list a window reads (mirrors `MailView`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViewRef {
    Unified(MailboxRole),
    Mailbox(String),
    Snoozed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCursor {
    pub last_date_ms: i64,
    pub thread_id: String,
}

#[derive(Debug, Clone)]
pub struct ListInput {
    pub view: ViewRef,
    pub tab: Option<TabRef>,
    pub after: Option<ListCursor>,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRow {
    pub thread_id: String,
    pub account_id: String,
    pub subject: String,
    pub snippet: String,
    pub senders: Vec<Address>,
    pub last_date_ms: i64,
    pub message_count: i64,
    pub unread: bool,
    pub pinned: bool,
    pub has_attachments: bool,
    pub has_invite: bool,
    pub tab: TabKind,
    pub priority: bool,
    pub muted: bool,
    pub snoozed_until_ms: Option<i64>,
    /// "Remind me if no reply" due time (kv `followup:<thread>`), else None.
    pub follow_up_at_ms: Option<i64>,
    /// Why it came back to the Inbox: `snooze` or `reply` (kv `returned:<thread>`).
    pub return_reason: Option<String>,
    /// `pending` or `in_flight` while the thread's send waits in the Outbox.
    pub outbox_state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPage {
    pub rows: Vec<ThreadRow>,
    pub next: Option<ListCursor>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub by_view_key: std::collections::BTreeMap<String, i64>,
    pub badge: i64,
    /// Sends waiting in the Outbox (pending or in flight).
    pub outbox: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRow {
    pub id: String,
    pub filename: String,
    pub mime: String,
    pub size: i64,
    pub is_inline: bool,
    pub content_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub message_id: String,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub date_ms: i64,
    pub subject: String,
    pub snippet: String,
    pub unread: bool,
    pub body_state: BodyState,
    pub html: Option<String>,
    pub text: Option<String>,
    pub quote_offset: Option<i64>,
    pub tracker_count: i64,
    pub attachments: Vec<AttachmentRow>,
    pub list_unsubscribe: Option<String>,
    pub has_invite: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDetail {
    pub row: ThreadRow,
    pub messages: Vec<MessageRow>,
    /// "Always" load images from the newest sender, on this Mac (kv `images_allow:<address>`).
    pub images_allowed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxRow {
    pub id: String,
    pub account_id: String,
    pub name: String,
    pub path: String,
    pub role: MailboxRole,
    pub unread: i64,
    pub total: i64,
}

/// Structured ⌘K query (the TS operator parser builds it, decision 17).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchQuery {
    pub words: Vec<String>,
    pub from: Vec<String>,
    pub to: Vec<String>,
    pub subject: Vec<String>,
    pub has_attachment: bool,
    pub is_unread: bool,
    pub is_pinned: bool,
    pub in_role: Option<MailboxRole>,
    pub in_mailbox_id: Option<String>,
    pub before_ms: Option<i64>,
    pub after_ms: Option<i64>,
    pub account_id: Option<String>,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub account_id: String,
    pub mail_bytes: i64,
    pub attachment_bytes: i64,
    pub message_count: i64,
    pub disk_cap_bytes: i64,
}
