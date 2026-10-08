pub(super) const EMAIL_NAMESPACE: &str = "email";
pub(super) const EMAIL_ACCOUNTS_KEY: &str = "accounts_v1";
pub(super) const EMAIL_SECRET_KEY_PREFIX: &str = "secret::";
pub(super) const EMAIL_ACTIVITY_UI_STATE_KEY: &str = "activity_state_v2";
pub(super) const EMAIL_FOLDER_UI_STATE_PREFIX: &str = "folder_state::";
pub(super) const DEFAULT_WORKSPACE_ID: &str = "__global__";
/// Recent-window UID cap for the forward sync: the most-recent N UIDs. History
/// beyond this comes from the depth-driven backwards walk (IM-2b), not from a
/// bigger N — the day cap that used to pair with this is gone, replaced by the
/// per-account [`super::EmailHistoryDepth`] floor.
pub(super) const SYNC_ENVELOPE_WINDOW_UIDS: u32 = 1000;
/// How many older UIDs the backwards backfill walks per sync round (IM-2b).
///
/// Bounded on purpose: the engine emits no progress events until IM-2c, so a
/// 12-month first sync has to fill in across successive rounds instead of blocking
/// one long sync and reading as an indefinite hang. 500 UIDs = 10 fetch chunks.
pub(super) const BACKFILL_BATCH_UIDS: usize = 500;
pub(super) const ALL_ACCOUNTS_ID: &str = "__all_accounts__";
pub(super) const FLAG_RECONCILE_WINDOW: u32 = 200;
pub(super) const FLAG_RECONCILE_WINDOW_LIGHT: u32 = 75;
pub(super) const IDLE_RENEWAL_SECS: u64 = 29 * 60;
pub(super) const IDLE_STAGGER_SECS: u64 = 3;
pub(super) const IDLE_BACKGROUND_POLL_SECS: u64 = 5 * 60;
pub(super) const IDLE_ACTIVE_POLL_SECS: u64 = 90;
pub(super) const IDLE_MAX_ATTEMPTS_BEFORE_FALLBACK: usize = 5;
pub(super) const IDLE_RECONNECT_DELAYS_SECS: [u64; 5] = [15, 30, 60, 120, 300];
pub(super) const IDLE_STABLE_SESSION_RESET_SECS: u64 = 5 * 60;
pub(super) const IDLE_GREETING_TIMEOUT_SECS: u64 = 5;
pub(super) const IDLE_DEAD_CONNECTION_SILENCE_SECS: u64 = 4 * 60;
pub(super) const IMAP_TCP_KEEPALIVE_SECS: u64 = 60;
pub(super) const IMAP_CONNECT_TIMEOUT_SECS: u64 = 15;
pub(super) const IMAP_SYNC_IO_TIMEOUT_SECS: u64 = 30;
pub(super) const IDLE_SUPERVISOR_MAX_WORKERS: usize = 24;
pub(super) const IDLE_SUPERVISOR_DEBOUNCE_MS: u64 = 250;
