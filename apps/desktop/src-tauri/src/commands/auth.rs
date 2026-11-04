use tauri::{AppHandle, Manager, State};

use crate::mail::host::{HostConfig, MailHost};
use crate::{auth, AppState};

/// Starts the mail engine for the signed-in user (cutover first), or stops it.
fn sync_mail_host(app: &AppHandle, state: &AppState, user_id: Option<&str>) {
    let Some(host) = app.try_state::<MailHost>() else {
        return;
    };
    let Some(user_id) = user_id else {
        host.stop();
        return;
    };
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let c = &state.config;
    let cfg = HostConfig {
        keychain_service: c.keychain_service.clone(),
        google_client_id: c.email_google_client_id.clone(),
        google_client_secret: c.email_google_client_secret.clone(),
        microsoft_client_id: crate::mail::auth::microsoft::client_id(
            c.calendar_microsoft_client_id.as_deref(),
        ),
    };
    if let Err(e) = host.start(&data_dir.join("moduo"), user_id, &state.store, &cfg) {
        eprintln!("[mail] engine start failed: {e}");
    }
}

/// Mirrors the webview's Supabase session into AppState so invoke-backed
/// modules (notes, email, calendar, time-tracking, graph) attribute work to
/// the cloud user. The webview owns the session lifecycle (supabase-js);
/// Rust only holds it in memory — `None` clears it on sign-out.
#[tauri::command]
pub async fn auth_set_cloud_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session: Option<auth::AuthSession>,
) -> Result<(), String> {
    let user_id = session.as_ref().map(|s| s.user.id.clone());
    *state.session.lock().map_err(|e| e.to_string())? = session;
    sync_mail_host(&app, &state, user_id.as_deref());
    Ok(())
}
