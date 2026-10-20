use tauri::State;

use crate::{auth, AppState};

/// Mirrors the webview's Supabase session into AppState so invoke-backed
/// modules (notes, email, calendar, time-tracking, graph) attribute work to
/// the cloud user. The webview owns the session lifecycle (supabase-js);
/// Rust only holds it in memory — `None` clears it on sign-out.
#[tauri::command]
pub async fn auth_set_cloud_session(
    state: State<'_, AppState>,
    session: Option<auth::AuthSession>,
) -> Result<(), String> {
    if session.is_none() {
        crate::commands::email::stop_all_idle_workers();
    }
    *state.session.lock().map_err(|e| e.to_string())? = session;
    Ok(())
}
