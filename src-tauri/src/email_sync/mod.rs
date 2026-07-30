use serde::{Deserialize, Serialize};

pub const EMAIL_DEFAULT_LIST_LIMIT: usize = 50;
pub const EMAIL_PREFETCH_DEFAULT_LIMIT: usize = 5;
pub const EMAIL_BODY_MAX_ITEMS_PER_ACCOUNT: usize = 2_500;
pub const EMAIL_BODY_MAX_BYTES_PER_ACCOUNT: usize = 200 * 1024 * 1024;
pub const EMAIL_FOREGROUND_REFRESH_SECS: i64 = 30;
pub const EMAIL_BACKGROUND_REFRESH_SECS: i64 = 5 * 60;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EmailActivityMode {
    MailForeground,
    AppForegroundNonMail,
    AppBackground,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailActivityStateRecord {
    pub mode: EmailActivityMode,
    pub active_account_id: Option<String>,
    pub active_folder: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSyncCursorRecord {
    pub account_id: String,
    pub folder: String,
    pub uid_validity: Option<u32>,
    pub uid_next: Option<u32>,
    pub last_seen_uid: Option<u32>,
    pub exists: u32,
    pub idle_supported: bool,
    #[serde(default)]
    pub idle_strategy: Option<String>,
    #[serde(default)]
    pub idle_failed_attempts: u32,
    #[serde(default)]
    pub last_idle_event_at: Option<String>,
    /// **Depth floor (IM-2b).** The oldest UID this device has fetched for the
    /// folder — the backwards walk's resume point, so a quit mid-backfill resumes
    /// instead of restarting (AC9). Before IM-2b the cursor recorded only
    /// `last_seen_uid`, which is why nothing could walk backwards or know how far
    /// back the store reached.
    #[serde(default)]
    pub oldest_synced_uid: Option<u32>,
    /// The oldest timestamp this store has actually reached, in ms. Pruning is
    /// gated on this rather than the *currently configured* depth, so lowering the
    /// depth can never evict history already promised (AC8).
    #[serde(default)]
    pub history_floor_ms: Option<i64>,
    /// Set once the backwards walk has reached the configured depth, so later sync
    /// rounds skip the backfill search entirely.
    #[serde(default)]
    pub backfill_complete: bool,
    /// The last backfill failure, if the most recent attempt failed. A failing walk
    /// is otherwise completely silent — the round deliberately continues so one bad
    /// UID can't pin the account at `error`, which means nothing else records that
    /// history has stopped filling in. IM-2c's progress surface reads this.
    #[serde(default)]
    pub backfill_last_error: Option<String>,
    pub updated_at: String,
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
