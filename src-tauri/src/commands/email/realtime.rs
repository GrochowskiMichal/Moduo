use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::Manager;

use super::account_config::{ensure_account_config, select_mailbox_for_folder};
use super::connection::{open_idle_imap_session, open_imap_session};
use super::constants::*;
use super::flags::flush_flag_outbox_for_account;
use super::model::StoredEmailAccount;
use super::storage::{
    load_folder_cursor, parse_json_value, patch_account_sync_state, read_accounts,
    save_folder_cursor, update_idle_runtime_state, upsert_envelope,
};
use super::sync::{
    collect_uid_range, fetch_envelopes_for_uids, resolve_uid_next, sync_account_folder_envelopes,
    uid_window_start,
};
use crate::email_sync::{now_iso, EmailActivityMode, EmailActivityStateRecord};
use crate::AppState;

static WORKER_SUPERVISOR_TICKET: AtomicU64 = AtomicU64::new(0);
static SYNC_INFLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

struct IdleWorkerControl {
    stop: Arc<AtomicBool>,
    handle: tauri::async_runtime::JoinHandle<()>,
    generation_id: u64,
}

static IDLE_WORKERS: OnceLock<Mutex<HashMap<String, IdleWorkerControl>>> = OnceLock::new();

pub(super) struct SyncPermit {
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

pub(super) fn try_acquire_sync_permit(key: String) -> Option<SyncPermit> {
    let mut inflight = sync_inflight().lock().unwrap_or_else(|e| e.into_inner());
    if inflight.contains(&key) {
        return None;
    }
    inflight.insert(key.clone());
    Some(SyncPermit { key })
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

pub(super) fn schedule_idle_worker_reconcile(app: &tauri::AppHandle, debounce: bool) {
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
