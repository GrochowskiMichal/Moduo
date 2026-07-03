//! Cloud sync engine.
//!
//! Runs a background tokio task that:
//! 1. Drains the `sync_cloud_outbox` redb table to Supabase REST (push).
//! 2. Periodically polls Supabase for rows updated since the last pull cursor (pull).
//!
//! Only active when the session carries a real Supabase JWT (access_token starts with "ey").
//! Local-only (UUID) sessions never start the worker.
//!
//! Conflict resolution:
//! - Scalars: last-writer-wins via `updated_at` timestamps.
//! - Note CRDT: `doc_state` field is left to the existing `notes_apply_crdt_updates` path.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use tokio::time::sleep;

use crate::domain::NoteDocState;
use crate::store_redb::RedbStore;

// ── Constants ──────────────────────────────────────────────────────────────────

const PUSH_INTERVAL: Duration = Duration::from_secs(10);
const PULL_INTERVAL: Duration = Duration::from_secs(30);
const TIER_CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60); // re-check plan tier every 5 min
const MAX_ATTEMPTS: u8 = 5;

// Tables that are synced outbound from redb → Supabase.
// Keys are redb table names → Supabase REST endpoint path segments.
const SYNC_TABLES: &[(&str, &str)] = &[("notes_meta", "notes")];

// Tables pulled from Supabase → redb (read-only inbound merge).
const PULL_TABLES: &[&str] = &["notes"];

// ── Types ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxEntry {
    pub id: String,
    pub table_name: String,
    pub record_id: String,
    #[serde(default)]
    pub op: OutboxOp,
    pub payload: serde_json::Value,
    pub workspace_id: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub attempts: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OutboxOp {
    #[default]
    Upsert,
    Delete,
}

// ── Handle ─────────────────────────────────────────────────────────────────────

/// Owned handle to the background worker. Dropping it cancels the task.
pub struct SyncHandle {
    shutdown_tx: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

impl SyncHandle {
    pub fn shutdown(self) {
        let _ = self.shutdown_tx.send(true);
        self.task.abort();
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/// Enqueue a record for outbound cloud sync.
/// Call this from write commands whenever the session is cloud-linked.
pub fn enqueue(
    store: &RedbStore,
    table_name: &str,
    record_id: &str,
    payload: serde_json::Value,
    workspace_id: Option<&str>,
    op: OutboxOp,
) -> anyhow::Result<()> {
    let entry = OutboxEntry {
        id: record_id.to_string(),
        table_name: table_name.to_string(),
        record_id: record_id.to_string(),
        op,
        payload,
        workspace_id: workspace_id.map(|s| s.to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
        attempts: 0,
    };
    store.sync_outbox_push(&serde_json::to_value(&entry)?)
}

/// Returns true if the session access_token looks like a Supabase JWT.
/// Local-only sessions use UUIDs (no dots); Supabase JWTs are three dot-separated
/// base64url segments starting with "ey".
pub fn is_cloud_session(access_token: &str) -> bool {
    access_token.starts_with("ey") && access_token.contains('.')
}

/// Start the background sync worker if the session is a cloud session.
/// Returns None for local-only sessions.
pub fn start_if_cloud(
    store: Arc<RedbStore>,
    supabase_url: String,
    anon_key: String,
    access_token: String,
) -> Option<SyncHandle> {
    if !is_cloud_session(&access_token) {
        return None;
    }

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let task = tokio::spawn(async move {
        run_worker(store, supabase_url, anon_key, access_token, shutdown_rx).await;
    });

    Some(SyncHandle { shutdown_tx, task })
}

// ── Worker ─────────────────────────────────────────────────────────────────────

/// Fetch `plan_tier` from Supabase REST for the current JWT user.
/// Returns None on any error (network, missing row, etc.).
async fn read_plan_tier(
    client: &reqwest::Client,
    supabase_url: &str,
    anon_key: &str,
    access_token: &str,
) -> Option<String> {
    // Extract user_id from the JWT sub claim (middle base64url segment).
    let parts: Vec<&str> = access_token.splitn(3, '.').collect();
    if parts.len() < 2 {
        return None;
    }
    // Standard base64url decode (with padding).
    let segment = parts[1];
    let pad = (4 - segment.len() % 4) % 4;
    let padded = format!("{}{}", segment, "=".repeat(pad));
    let standard = padded.replace('-', "+").replace('_', "/");
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(standard)
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    let user_id = claims.get("sub")?.as_str()?;

    let url = format!(
        "{}/rest/v1/profiles?select=plan_tier&id=eq.{}",
        supabase_url.trim_end_matches('/'),
        user_id,
    );

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("apikey", anon_key)
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;

    let rows: Vec<serde_json::Value> = resp.json().await.ok()?;
    let tier = rows.first()?.get("plan_tier")?.as_str()?.to_string();
    Some(tier)
}

async fn run_worker(
    store: Arc<RedbStore>,
    supabase_url: String,
    anon_key: String,
    access_token: String,
    mut shutdown: watch::Receiver<bool>,
) {
    let client = reqwest::Client::new();

    // Gate by plan tier at startup — free-tier users don't get cloud sync.
    match read_plan_tier(&client, &supabase_url, &anon_key, &access_token).await {
        Some(ref tier) if tier == "free" => {
            eprintln!("[sync] plan_tier=free, worker shutdown");
            return;
        }
        Some(ref tier) => {
            eprintln!("[sync] plan_tier={}, starting worker", tier);
        }
        None => {
            eprintln!("[sync] could not read plan_tier, starting sync worker optimistically");
        }
    }

    let mut push_interval = tokio::time::interval(PUSH_INTERVAL);
    let mut pull_interval = tokio::time::interval(PULL_INTERVAL);
    let mut tier_check_interval = tokio::time::interval(TIER_CHECK_INTERVAL);

    loop {
        tokio::select! {
            _ = push_interval.tick() => {
                push_outbox(&client, &store, &supabase_url, &anon_key, &access_token).await;
            }
            _ = pull_interval.tick() => {
                pull_changes(&client, &store, &supabase_url, &anon_key, &access_token).await;
            }
            _ = tier_check_interval.tick() => {
                // Periodically re-check plan tier; shutdown if downgraded to free.
                if let Some(tier) = read_plan_tier(&client, &supabase_url, &anon_key, &access_token).await {
                    if tier == "free" {
                        eprintln!("[sync] plan_tier downgraded to free, worker shutdown");
                        break;
                    }
                }
            }
            Ok(()) = shutdown.changed() => {
                if *shutdown.borrow() {
                    eprintln!("[sync] worker shutdown requested");
                    break;
                }
            }
        }
    }
}

// ── Push ───────────────────────────────────────────────────────────────────────

async fn push_outbox(
    client: &reqwest::Client,
    store: &RedbStore,
    supabase_url: &str,
    anon_key: &str,
    access_token: &str,
) {
    let entries = match store.sync_outbox_list() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[sync] outbox list failed: {e}");
            return;
        }
    };

    for raw in entries {
        let entry: OutboxEntry = match serde_json::from_value(raw) {
            Ok(e) => e,
            Err(_) => continue,
        };

        // Map redb table name → Supabase table
        let rest_table = SYNC_TABLES
            .iter()
            .find(|(redb_name, _)| *redb_name == entry.table_name)
            .map(|(_, rest)| *rest)
            .unwrap_or(entry.table_name.as_str());

        // For notes, enrich the outbound payload with the current doc_state snapshot
        // so the body is pushed to Supabase alongside the metadata. This mirrors
        // what the web runtime writes directly via applyCrdtUpdates.
        let mut payload = entry.payload.clone();
        if entry.table_name == "notes_meta" {
            if let Some(note_id) = payload.get("id").and_then(|v| v.as_str()) {
                if let Ok(doc_state) = store.get_note_doc_state(note_id) {
                    if !doc_state.snapshot_b64.is_empty() {
                        if let Some(obj) = payload.as_object_mut() {
                            obj.insert(
                                "doc_state".to_string(),
                                serde_json::Value::String(doc_state.snapshot_b64),
                            );
                        }
                    }
                }
            }
        }

        let success = match entry.op {
            OutboxOp::Upsert => {
                push_upsert(client, supabase_url, anon_key, access_token, rest_table, &payload).await
            }
            OutboxOp::Delete => {
                push_delete(client, supabase_url, anon_key, access_token, rest_table, &entry.record_id).await
            }
        };

        if success {
            let _ = store.sync_outbox_delete(&entry.table_name, &entry.record_id);
        } else {
            let dead = store.sync_outbox_increment_attempts(
                &entry.table_name,
                &entry.record_id,
                MAX_ATTEMPTS,
            );
            match dead {
                Ok(true) => eprintln!(
                    "[sync] entry {}/{} exceeded max attempts, dropped",
                    entry.table_name, entry.record_id
                ),
                Err(e) => eprintln!("[sync] failed to increment attempts: {e}"),
                _ => {}
            }
        }

        // Small delay between pushes to avoid hammering the REST API.
        sleep(Duration::from_millis(50)).await;
    }
}

async fn push_upsert(
    client: &reqwest::Client,
    supabase_url: &str,
    anon_key: &str,
    access_token: &str,
    table: &str,
    payload: &serde_json::Value,
) -> bool {
    let url = format!("{supabase_url}/rest/v1/{table}");
    match client
        .post(&url)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates,return=minimal")
        .json(payload)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => true,
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            eprintln!("[sync] upsert {table} failed {status}: {body}");
            false
        }
        Err(e) => {
            eprintln!("[sync] upsert {table} network error: {e}");
            false
        }
    }
}

async fn push_delete(
    client: &reqwest::Client,
    supabase_url: &str,
    anon_key: &str,
    access_token: &str,
    table: &str,
    id: &str,
) -> bool {
    // Soft-delete: set deleted_at rather than hard-deleting.
    let url = format!("{supabase_url}/rest/v1/{table}?id=eq.{id}");
    let body = serde_json::json!({ "deleted_at": chrono::Utc::now().to_rfc3339() });
    match client
        .patch(&url)
        .header("apikey", anon_key)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => true,
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            eprintln!("[sync] soft-delete {table}/{id} failed {status}: {body}");
            false
        }
        Err(e) => {
            eprintln!("[sync] soft-delete {table}/{id} network error: {e}");
            false
        }
    }
}

// ── Pull ───────────────────────────────────────────────────────────────────────

async fn pull_changes(
    client: &reqwest::Client,
    store: &RedbStore,
    supabase_url: &str,
    anon_key: &str,
    access_token: &str,
) {
    for table_name in PULL_TABLES {
        let cursor = store
            .sync_get_pull_cursor(table_name)
            .ok()
            .flatten()
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());

        let url = format!(
            "{supabase_url}/rest/v1/{table_name}?updated_at=gt.{cursor}&order=updated_at.asc&limit=200",
        );

        let result = client
            .get(&url)
            .header("apikey", anon_key)
            .header("Authorization", format!("Bearer {access_token}"))
            .header("Accept", "application/json")
            .send()
            .await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<Vec<serde_json::Value>>().await {
                    Ok(rows) if !rows.is_empty() => {
                        let mut latest_cursor = cursor.clone();
                        for row in &rows {
                            apply_inbound_row(store, table_name, row);
                            if let Some(ts) = row.get("updated_at").and_then(|v| v.as_str()) {
                                if ts > latest_cursor.as_str() {
                                    latest_cursor = ts.to_string();
                                }
                            }
                        }
                        let _ = store.sync_set_pull_cursor(table_name, &latest_cursor);
                        eprintln!("[sync] pulled {} rows for {table_name}", rows.len());
                    }
                    Ok(_) => {} // No new rows.
                    Err(e) => eprintln!("[sync] parse pull response for {table_name}: {e}"),
                }
            }
            Ok(resp) => {
                eprintln!("[sync] pull {table_name} failed {}", resp.status());
            }
            Err(e) => {
                eprintln!("[sync] pull {table_name} network error: {e}");
            }
        }

        sleep(Duration::from_millis(100)).await;
    }
}

/// Apply an inbound row from Supabase into local redb.
/// Uses a simple last-writer-wins strategy based on `updated_at`.
fn apply_inbound_row(store: &RedbStore, table_name: &str, row: &serde_json::Value) {
    let Some(id) = row.get("id").and_then(|v| v.as_str()) else {
        return;
    };
    let remote_ts = row
        .get("updated_at")
        .and_then(|v| v.as_str())
        .unwrap_or("1970-01-01T00:00:00Z");

    if table_name == "notes" {
        // Only update local note meta if remote is newer (last-writer-wins).
        if let Ok(Some(local)) = store.get_note(id) {
            let local_ts = local.updated_at.as_str();
            if remote_ts <= local_ts {
                return; // Local is equal or newer — skip.
            }
        }
        if let Ok(note) = serde_json::from_value::<crate::domain::NoteMeta>(row.clone()) {
            let _ = store.put_note(&note);
        }
        // Also pull the doc_state body snapshot so the desktop has the same
        // canonical note body that the web runtime persists to Supabase.
        // Only apply when the remote row carries a non-empty doc_state field.
        if let Some(doc_state_b64) = row.get("doc_state").and_then(|v| v.as_str()) {
            if !doc_state_b64.is_empty() {
                let doc_state = NoteDocState {
                    snapshot_b64: doc_state_b64.to_string(),
                    last_compacted_update_id: 0,
                    updates: vec![],
                };
                let _ = store.put_note_doc_state(id, &doc_state);
            }
        }
    }
}
