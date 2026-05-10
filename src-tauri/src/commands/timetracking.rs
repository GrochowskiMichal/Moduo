use std::sync::atomic::{AtomicBool, Ordering};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::{domain::*, AppState};

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn require_user_id(state: &AppState) -> Result<String, String> {
    let session = state
        .session
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Not authenticated".to_string())?;
    Ok(session.user.id)
}

// ─── Active Window Info ───────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindowInfo {
    pub app_name: String,
    pub window_title: String,
    pub process_id: u64,
}

// ─── Background Tracking State ────────────────────────────────────────────────

static TRACKING_ACTIVE: AtomicBool = AtomicBool::new(false);

fn auto_categorize(
    app_name: &str,
    window_title: &str,
    rules: &[CategoryRule],
) -> Option<String> {
    for rule in rules {
        if rule.deleted_at.is_some() {
            continue;
        }
        let val = rule.match_value.to_lowercase();
        let matched = match rule.match_type.as_str() {
            "app" => app_name.to_lowercase().contains(&val),
            "window_title" => window_title.to_lowercase().contains(&val),
            "keyword" => {
                app_name.to_lowercase().contains(&val)
                    || window_title.to_lowercase().contains(&val)
            }
            "url" => false, // URL matching would need browser integration
            _ => false,
        };
        if matched {
            return Some(rule.category_id.clone());
        }
    }
    None
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn tt_list(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<TimetrackingBundle, String> {
    let _ = require_user_id(&state)?;
    state
        .store
        .list_timetracking_bundle(&workspace_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tt_upsert_entry(
    state: State<'_, AppState>,
    entry: TimeEntry,
) -> Result<TimeEntry, String> {
    let _ = require_user_id(&state)?;
    let mut next = entry;
    next.updated_at = now_iso();
    state
        .store
        .put_tt_entry(&next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn tt_delete_entry(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<(), String> {
    let _ = require_user_id(&state)?;
    if let Some(mut entry) = state
        .store
        .get_tt_entry(&entry_id)
        .map_err(|e| e.to_string())?
    {
        let deleted_at = now_iso();
        entry.deleted_at = Some(deleted_at.clone());
        entry.updated_at = deleted_at;
        state
            .store
            .put_tt_entry(&entry)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn tt_upsert_category(
    state: State<'_, AppState>,
    category: TimeCategory,
) -> Result<TimeCategory, String> {
    let _ = require_user_id(&state)?;
    let mut next = category;
    next.updated_at = now_iso();
    state
        .store
        .put_tt_category(&next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn tt_delete_category(
    state: State<'_, AppState>,
    category_id: String,
) -> Result<(), String> {
    let _ = require_user_id(&state)?;
    state
        .store
        .remove_tt_category(&category_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tt_upsert_rule(
    state: State<'_, AppState>,
    rule: CategoryRule,
) -> Result<CategoryRule, String> {
    let _ = require_user_id(&state)?;
    let mut next = rule;
    next.updated_at = now_iso();
    state
        .store
        .put_tt_rule(&next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn tt_delete_rule(
    state: State<'_, AppState>,
    rule_id: String,
) -> Result<(), String> {
    let _ = require_user_id(&state)?;
    state
        .store
        .remove_tt_rule(&rule_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tt_upsert_project(
    state: State<'_, AppState>,
    project: TimeProject,
) -> Result<TimeProject, String> {
    let _ = require_user_id(&state)?;
    let mut next = project;
    next.updated_at = now_iso();
    state
        .store
        .put_tt_project(&next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn tt_delete_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<(), String> {
    let _ = require_user_id(&state)?;
    state
        .store
        .remove_tt_project(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tt_upsert_focus_session(
    state: State<'_, AppState>,
    session: FocusSession,
) -> Result<FocusSession, String> {
    let _ = require_user_id(&state)?;
    let mut next = session;
    next.updated_at = now_iso();
    state
        .store
        .put_tt_focus_session(&next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn tt_get_active_window() -> Result<Option<ActiveWindowInfo>, String> {
    match active_win_pos_rs::get_active_window() {
        Ok(win) => Ok(Some(ActiveWindowInfo {
            app_name: win.app_name,
            window_title: win.title,
            process_id: win.process_id,
        })),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn tt_start_tracking(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    if TRACKING_ACTIVE.load(Ordering::Relaxed) {
        return Ok(());
    }
    TRACKING_ACTIVE.store(true, Ordering::Relaxed);

    let user_id = require_user_id(&state)?;
    let store = state.store.clone();
    let ws_id = workspace_id.clone();
    let uid = user_id.clone();

    tokio::spawn(async move {
        let mut last_app: Option<String> = None;
        let mut last_title: Option<String> = None;
        let mut segment_start: Option<String> = None;
        let mut idle_count: u32 = 0;
        const POLL_INTERVAL_SECS: u64 = 5;
        const IDLE_THRESHOLD_POLLS: u32 = 60; // 5 min = 60 * 5s
        const MIN_SEGMENT_SECS: i64 = 10;

        while TRACKING_ACTIVE.load(Ordering::Relaxed) {
            tokio::time::sleep(tokio::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;

            let win = match active_win_pos_rs::get_active_window() {
                Ok(w) => w,
                Err(_) => {
                    idle_count += 1;
                    if idle_count >= IDLE_THRESHOLD_POLLS {
                        // Flush current segment on idle
                        if let (Some(app), Some(start)) = (&last_app, &segment_start) {
                            let end = now_iso();
                            let duration = compute_duration(start, &end);
                            if duration >= MIN_SEGMENT_SECS {
                                let rules = store.list_tt_rules(&ws_id).unwrap_or_default();
                                let cat_id = auto_categorize(
                                    app,
                                    last_title.as_deref().unwrap_or(""),
                                    &rules,
                                );
                                let entry = TimeEntry {
                                    id: Uuid::new_v4().to_string(),
                                    workspace_id: ws_id.clone(),
                                    owner_id: uid.clone(),
                                    start_time: start.clone(),
                                    end_time: end.clone(),
                                    duration_secs: duration,
                                    app_name: Some(app.clone()),
                                    window_title: last_title.clone(),
                                    url: None,
                                    category_id: cat_id,
                                    project_id: None,
                                    is_manual: false,
                                    is_meeting: false,
                                    description: String::new(),
                                    created_at: end.clone(),
                                    updated_at: end,
                                    deleted_at: None,
                                };
                                let _ = store.put_tt_entry(&entry);
                            }
                            last_app = None;
                            last_title = None;
                            segment_start = None;
                        }
                    }
                    continue;
                }
            };

            idle_count = 0;
            let current_app = win.app_name.clone();
            let current_title = win.title.clone();

            let app_changed = last_app.as_deref() != Some(&current_app);

            if app_changed {
                // Flush previous segment
                if let (Some(prev_app), Some(start)) = (&last_app, &segment_start) {
                    let end = now_iso();
                    let duration = compute_duration(start, &end);
                    if duration >= MIN_SEGMENT_SECS {
                        let rules = store.list_tt_rules(&ws_id).unwrap_or_default();
                        let cat_id = auto_categorize(
                            prev_app,
                            last_title.as_deref().unwrap_or(""),
                            &rules,
                        );
                        let entry = TimeEntry {
                            id: Uuid::new_v4().to_string(),
                            workspace_id: ws_id.clone(),
                            owner_id: uid.clone(),
                            start_time: start.clone(),
                            end_time: end.clone(),
                            duration_secs: duration,
                            app_name: Some(prev_app.clone()),
                            window_title: last_title.clone(),
                            url: None,
                            category_id: cat_id,
                            project_id: None,
                            is_manual: false,
                            is_meeting: false,
                            description: String::new(),
                            created_at: end.clone(),
                            updated_at: end,
                            deleted_at: None,
                        };
                        let _ = store.put_tt_entry(&entry);
                    }
                }
                // Start new segment
                segment_start = Some(now_iso());
                last_app = Some(current_app);
                last_title = Some(current_title);
            } else {
                // Same app — update title
                last_title = Some(current_title);
            }
        }

        // Flush remaining segment on stop
        if let (Some(app), Some(start)) = (&last_app, &segment_start) {
            let end = now_iso();
            let duration = compute_duration(start, &end);
            if duration >= MIN_SEGMENT_SECS {
                let rules = store.list_tt_rules(&ws_id).unwrap_or_default();
                let cat_id =
                    auto_categorize(app, last_title.as_deref().unwrap_or(""), &rules);
                let entry = TimeEntry {
                    id: Uuid::new_v4().to_string(),
                    workspace_id: ws_id.clone(),
                    owner_id: uid.clone(),
                    start_time: start.clone(),
                    end_time: end.clone(),
                    duration_secs: duration,
                    app_name: Some(app.clone()),
                    window_title: last_title.clone(),
                    url: None,
                    category_id: cat_id,
                    project_id: None,
                    is_manual: false,
                    is_meeting: false,
                    description: String::new(),
                    created_at: end.clone(),
                    updated_at: end,
                    deleted_at: None,
                };
                let _ = store.put_tt_entry(&entry);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn tt_stop_tracking() -> Result<(), String> {
    TRACKING_ACTIVE.store(false, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn tt_get_tracking_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "isTracking": TRACKING_ACTIVE.load(Ordering::Relaxed)
    }))
}

fn compute_duration(start: &str, end: &str) -> i64 {
    let s = chrono::DateTime::parse_from_rfc3339(start).ok();
    let e = chrono::DateTime::parse_from_rfc3339(end).ok();
    match (s, e) {
        (Some(s), Some(e)) => (e - s).num_seconds().max(0),
        _ => 0,
    }
}
