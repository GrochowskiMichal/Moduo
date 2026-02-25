use tauri::State;

use crate::{domain::GraphHybridQuery, graph_helix::GraphUpsertRequest, AppState};

fn require_user_id(state: &AppState) -> Result<String, String> {
    let session = state
        .session
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Not authenticated".to_string())?;
    Ok(session.user.id)
}

fn require_graph_access(state: &AppState, workspace_id: &str, action: &str) -> Result<(), String> {
    let user_id = require_user_id(state)?;
    let notes_ok = state
        .acl
        .workspace_can_module(&state.store, workspace_id, &user_id, "notes", "view")
        .map_err(|e| e.to_string())?;
    let tasks_ok = state
        .acl
        .workspace_can_module(&state.store, workspace_id, &user_id, "tasks", "view")
        .map_err(|e| e.to_string())?;
    if notes_ok || tasks_ok {
        return Ok(());
    }

    let _ = state.store.append_audit_log(
        "acl_forbidden",
        &serde_json::json!({
            "workspaceId": workspace_id,
            "module": "graph",
            "action": action,
            "userId": user_id,
        }),
    );
    Err("Forbidden".to_string())
}

#[tauri::command]
pub async fn graph_upsert_nodes_edges(
    state: State<'_, AppState>,
    request: GraphUpsertRequest,
) -> Result<(), String> {
    require_graph_access(&state, &request.workspace_id, "upsert_nodes_edges")?;
    state
        .graph
        .upsert_nodes_edges(&state.store, request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn graph_query_related(
    state: State<'_, AppState>,
    workspace_id: String,
    node_id: String,
    limit: Option<usize>,
) -> Result<serde_json::Value, String> {
    require_graph_access(&state, &workspace_id, "query_related")?;
    state
        .graph
        .query_related(&state.store, &workspace_id, &node_id, limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn graph_query_hybrid(
    state: State<'_, AppState>,
    query: GraphHybridQuery,
) -> Result<Vec<crate::domain::GraphHybridResult>, String> {
    require_graph_access(&state, &query.workspace_id, "query_hybrid")?;
    state
        .graph
        .query_hybrid(&state.store, query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn graph_get_full(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<serde_json::Value, String> {
    require_graph_access(&state, &workspace_id, "get_full_graph")?;
    state
        .graph
        .get_full_graph(&workspace_id)
        .await
        .map_err(|e| e.to_string())
}
