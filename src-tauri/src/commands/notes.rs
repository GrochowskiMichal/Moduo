use tauri::State;

use crate::{domain::*, AppState};

fn require_user_id(state: &AppState) -> Result<String, String> {
    let session = state
        .session
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Not authenticated".to_string())?;
    Ok(session.user.id)
}

fn deny_with_audit(
    state: &AppState,
    user_id: Option<&str>,
    workspace_id: &str,
    action: &str,
) -> Result<(), String> {
    let payload = serde_json::json!({
        "workspaceId": workspace_id,
        "module": "notes",
        "action": action,
        "userId": user_id,
    });
    let _ = state.store.append_audit_log("acl_forbidden", &payload);
    Err("Forbidden".to_string())
}

fn require_notes_permission(
    state: &AppState,
    workspace_id: &str,
    min_level: &str,
    action: &str,
) -> Result<String, String> {
    let user_id = require_user_id(state)?;
    let allowed = state
        .acl
        .workspace_can_module(&state.store, workspace_id, &user_id, "notes", min_level)
        .map_err(|e| e.to_string())?;
    if !allowed {
        deny_with_audit(state, Some(&user_id), workspace_id, action)?;
    }
    Ok(user_id)
}

#[tauri::command]
pub async fn notes_list(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<NoteMeta>, String> {
    let _ = require_notes_permission(&state, &workspace_id, "view", "list")?;
    state
        .store
        .list_notes(&workspace_id)
        .map_err(|e| e.to_string())
}





#[tauri::command]
pub async fn notes_get_doc_state(
    state: State<'_, AppState>,
    workspace_id: String,
    note_id: String,
) -> Result<NoteDocState, String> {
    let _ = require_notes_permission(&state, &workspace_id, "view", "get_doc_state")?;
    state
        .store
        .get_note_doc_state(&note_id)
        .map_err(|e| e.to_string())
}

