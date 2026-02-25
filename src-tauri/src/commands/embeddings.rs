use tauri::State;
use crate::AppState;

fn require_embeddings_access(state: &AppState, workspace_id: &str, action: &str) -> Result<(), String> {
    let session = state.session.lock().map_err(|e| e.to_string())?.clone().ok_or_else(|| "Not authenticated".to_string())?;
    // Default allowed for authenticated users
    Ok(())
}

#[tauri::command]
pub async fn embed_and_index_note(
    state: State<'_, AppState>,
    workspace_id: String,
    note_id: String,
) -> Result<(), String> {
    require_embeddings_access(&state, &workspace_id, "embed_and_index_note")?;
    state.indexer.queue(crate::embeddings::IndexJob::Note {
        workspace_id,
        note_id,
    });
    Ok(())
}

#[tauri::command]
pub async fn embed_and_index_task(
    state: State<'_, AppState>,
    workspace_id: String,
    task_id: String,
) -> Result<(), String> {
    require_embeddings_access(&state, &workspace_id, "embed_and_index_task")?;
    state.indexer.queue(crate::embeddings::IndexJob::Task {
        workspace_id,
        task_id,
    });
    Ok(())
}

#[tauri::command]
pub async fn embed_and_index_email(
    state: State<'_, AppState>,
    workspace_id: String,
    email_account_id: String,
    email_id: String,
) -> Result<(), String> {
    require_embeddings_access(&state, &workspace_id, "embed_and_index_email")?;
    state.indexer.queue(crate::embeddings::IndexJob::Email {
        workspace_id,
        email_account_id,
        email_id,
    });
    Ok(())
}
