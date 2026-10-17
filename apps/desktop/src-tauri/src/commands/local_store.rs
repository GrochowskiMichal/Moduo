use tauri::State;

use crate::AppState;

#[tauri::command]
pub async fn local_store_get(
    state: State<'_, AppState>,
    namespace: String,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    state
        .store
        .kv_get(&namespace, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn local_store_set(
    state: State<'_, AppState>,
    namespace: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    state
        .store
        .kv_set(&namespace, &key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn local_store_remove(
    state: State<'_, AppState>,
    namespace: String,
    key: String,
) -> Result<(), String> {
    state
        .store
        .kv_remove(&namespace, &key)
        .map_err(|e| e.to_string())
}
