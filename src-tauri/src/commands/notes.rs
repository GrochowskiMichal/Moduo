use std::collections::HashSet;

use serde::Deserialize;
use tauri::State;

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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesMoveInput {
    pub workspace_id: String,
    pub note_id: String,
    pub new_parent_id: Option<String>,
    pub new_position: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesDeleteInput {
    pub workspace_id: String,
    pub note_id: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrdtUpdateInput {
    pub idempotency_key: Option<String>,
    pub client_seq: i64,
    pub update_b64: String,
}

#[tauri::command]
pub async fn notes_list(state: State<'_, AppState>, workspace_id: String) -> Result<Vec<NoteMeta>, String> {
    let _ = require_notes_permission(&state, &workspace_id, "view", "list")?;
    state.store.list_notes(&workspace_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn notes_upsert(state: State<'_, AppState>, note: NoteMeta) -> Result<NoteMeta, String> {
    let _ = require_notes_permission(&state, &note.workspace_id, "edit", "upsert")?;

    let mut normalized = note;
    normalized.updated_at = now_iso();

    state
        .store
        .apply_note_update_atomic(
            &normalized,
            None,
            None,
            None,
        )
        .map_err(|e| e.to_string())?;

    Ok(normalized)
}

#[tauri::command]
pub async fn notes_move(state: State<'_, AppState>, input: NotesMoveInput) -> Result<NoteMeta, String> {
    let _ = require_notes_permission(&state, &input.workspace_id, "edit", "move")?;
    let mut note = state
        .store
        .get_note(&input.note_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Note not found".to_string())?;
    if note.workspace_id != input.workspace_id {
        return Err("Workspace mismatch".to_string());
    }

    if input
        .new_parent_id
        .as_ref()
        .is_some_and(|parent_id| parent_id == &note.id)
    {
        return Err("Cannot move note into itself".to_string());
    }

    if note.kind == "category" && input.new_parent_id.is_some() {
        return Err("Sections can only exist at root".to_string());
    }

    if let Some(parent_id) = input.new_parent_id.as_ref() {
        let parent = state
            .store
            .get_note(parent_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Parent note not found".to_string())?;
        if parent.workspace_id != input.workspace_id {
            return Err("Workspace mismatch".to_string());
        }
        if parent.deleted_at.is_some() {
            return Err("Cannot move under deleted note".to_string());
        }

        let mut cursor = Some(parent.id.clone());
        let mut visited: HashSet<String> = HashSet::from([note.id.clone()]);
        while let Some(current_id) = cursor {
            if !visited.insert(current_id.clone()) {
                return Err("Cannot move note into its descendant".to_string());
            }
            let Some(current) = state.store.get_note(&current_id).map_err(|e| e.to_string())? else {
                break;
            };
            if current.workspace_id != input.workspace_id {
                return Err("Workspace mismatch".to_string());
            }
            cursor = current.parent_id;
        }
    }

    note.parent_id = input.new_parent_id;
    note.position = input.new_position;
    note.updated_at = now_iso();

    state
        .store
        .apply_note_update_atomic(
            &note,
            None,
            None,
            None,
        )
        .map_err(|e| e.to_string())?;

    Ok(note)
}

#[tauri::command]
pub async fn notes_delete(state: State<'_, AppState>, input: NotesDeleteInput) -> Result<NoteMeta, String> {
    let _ = require_notes_permission(&state, &input.workspace_id, "edit", "delete")?;
    let mut note = state
        .store
        .get_note(&input.note_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Note not found".to_string())?;
    if note.workspace_id != input.workspace_id {
        return Err("Workspace mismatch".to_string());
    }

    let deleted_at = input.deleted_at.unwrap_or_else(now_iso);
    note.deleted_at = Some(deleted_at.clone());
    note.updated_at = deleted_at;

    state
        .store
        .apply_note_update_atomic(
            &note,
            None,
            None,
            None,
        )
        .map_err(|e| e.to_string())?;

    Ok(note)
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

#[tauri::command]
pub async fn notes_apply_crdt_updates(
    state: State<'_, AppState>,
    workspace_id: String,
    note_id: String,
    client_id: String,
    updates: Vec<CrdtUpdateInput>,
) -> Result<serde_json::Value, String> {
    let _ = require_notes_permission(&state, &workspace_id, "edit", "apply_crdt_updates")?;
    let identity = state
        .acl
        .get_or_create_identity(&state.store)
        .map_err(|e| e.to_string())?;
    let mut note = state
        .store
        .get_note(&note_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "Note not found".to_string()
        })?;

    let mut inserted = 0_i64;
    let mut max_seq = 0_i64;
    let mut seen = HashSet::new();
    for item in updates {
        if item.update_b64.trim().is_empty() {
            continue;
        }
        let default_key = format!(
            "{}:{}:{}:{}",
            workspace_id,
            note_id,
            client_id,
            item.client_seq
        );
        let key = item.idempotency_key.unwrap_or(default_key);
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key.clone());
        let update = NoteCrdtUpdate {
            idempotency_key: key.clone(),
            workspace_id: workspace_id.clone(),
            note_id: note_id.clone(),
            client_id: client_id.clone(),
            client_seq: item.client_seq,
            update_b64: item.update_b64,
            created_at: now_iso(),
        };

        let applied = state
            .store
            .apply_note_update_atomic(&note, Some(&update), Some(&key), Some(&identity.device_id))
            .map_err(|e| e.to_string())?;
        if applied.is_some() {
            inserted += 1;
            max_seq = max_seq.max(item.client_seq);
        }
    }

    note.updated_at = now_iso();
    state
        .store
        .put_note(&note)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "inserted": inserted,
        "lastClientSeq": max_seq,
    }))
}

#[tauri::command]
pub async fn notes_subscribe_local(
    state: State<'_, AppState>,
    workspace_id: String,
    note_id: Option<String>,
) -> Result<String, String> {
    let _ = require_notes_permission(&state, &workspace_id, "view", "subscribe_local")?;
    Ok(format!(
        "notes-sub:{}:{}",
        workspace_id,
        note_id.unwrap_or_else(|| "all".to_string())
    ))
}
