use tauri::State;

use crate::AppState;

#[tauri::command]
pub async fn p2p_start(state: State<'_, AppState>) -> Result<(), String> {
    state.p2p.start().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn p2p_peer_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let (started, peers) = state.p2p.status().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "started": started,
        "peers": peers,
    }))
}

#[tauri::command]
pub async fn p2p_sync_now(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<serde_json::Value, String> {
    state.p2p.sync_now(&workspace_id).map_err(|e| e.to_string())
}
