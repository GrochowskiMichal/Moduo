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
        "module": "tasks",
        "action": action,
        "userId": user_id,
    });
    let _ = state.store.append_audit_log("acl_forbidden", &payload);
    Err("Forbidden".to_string())
}

fn require_tasks_permission(
    state: &AppState,
    workspace_id: &str,
    min_level: &str,
    action: &str,
) -> Result<String, String> {
    let user_id = require_user_id(state)?;
    let allowed = state
        .acl
        .workspace_can_module(&state.store, workspace_id, &user_id, "tasks", min_level)
        .map_err(|e| e.to_string())?;
    if !allowed {
        deny_with_audit(state, Some(&user_id), workspace_id, action)?;
    }
    Ok(user_id)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMoveInput {
    pub workspace_id: String,
    pub task_id: String,
    pub new_parent_task_id: Option<String>,
    pub new_state_id: String,
    pub new_position: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDeleteInput {
    pub workspace_id: String,
    pub task_id: String,
    pub deleted_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksUpsertInput {
    pub project: Option<TaskProject>,
    pub workflow_state: Option<TaskWorkflowState>,
    pub task: Option<TaskItem>,
}

#[tauri::command]
pub async fn tasks_list(state: State<'_, AppState>, workspace_id: String) -> Result<TasksBundle, String> {
    let _ = require_tasks_permission(&state, &workspace_id, "view", "list")?;
    state
        .store
        .list_tasks_bundle(&workspace_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tasks_upsert(
    state: State<'_, AppState>,
    input: TasksUpsertInput,
) -> Result<serde_json::Value, String> {
    if let Some(project) = input.project {
        let _ = require_tasks_permission(&state, &project.workspace_id, "edit", "upsert_project")?;
        let mut next = project;
        next.updated_at = now_iso();
        state
            .store
            .put_task_project(&next)
            .map_err(|e| e.to_string())?;
        let saved = next;
        return Ok(serde_json::json!({ "project": saved }));
    }
    if let Some(workflow_state) = input.workflow_state {
        let _ = require_tasks_permission(&state, &workflow_state.workspace_id, "edit", "upsert_state")?;
        let mut next = workflow_state;
        next.updated_at = now_iso();
        state
            .store
            .put_task_state(&next)
            .map_err(|e| e.to_string())?;
        let saved = next;
        return Ok(serde_json::json!({ "workflowState": saved }));
    }
    if let Some(task) = input.task {
        let _ = require_tasks_permission(&state, &task.workspace_id, "edit", "upsert_item")?;
        let mut next = task;
        next.updated_at = now_iso();
        state
            .store
            .put_task_item(&next)
            .map_err(|e| e.to_string())?;
        let saved = next;
        return Ok(serde_json::json!({ "task": saved }));
    }
    Err("No task entity provided".to_string())
}

#[tauri::command]
pub async fn tasks_upsert_project(
    state: State<'_, AppState>,
    project: TaskProject,
) -> Result<TaskProject, String> {
    let _ = require_tasks_permission(&state, &project.workspace_id, "edit", "upsert_project")?;
    let mut next = project;
    next.updated_at = now_iso();
    state
        .store
        .put_task_project(&next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn tasks_upsert_state(
    state: State<'_, AppState>,
    workflow_state: TaskWorkflowState,
) -> Result<TaskWorkflowState, String> {
    let _ = require_tasks_permission(&state, &workflow_state.workspace_id, "edit", "upsert_state")?;
    let mut next = workflow_state;
    next.updated_at = now_iso();
    state
        .store
        .put_task_state(&next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn tasks_upsert_item(state: State<'_, AppState>, task: TaskItem) -> Result<TaskItem, String> {
    let _ = require_tasks_permission(&state, &task.workspace_id, "edit", "upsert_item")?;
    let mut next = task;
    next.updated_at = now_iso();
    state
        .store
        .put_task_item(&next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn tasks_move(state: State<'_, AppState>, input: TaskMoveInput) -> Result<TaskItem, String> {
    let _ = require_tasks_permission(&state, &input.workspace_id, "edit", "move")?;
    let mut task = state
        .store
        .get_task_item(&input.task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task not found".to_string())?;
    if task.workspace_id != input.workspace_id {
        return Err("Workspace mismatch".to_string());
    }

    task.parent_task_id = input.new_parent_task_id;
    task.state_id = input.new_state_id;
    task.position = input.new_position;
    task.updated_at = now_iso();

    state.store.put_task_item(&task).map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command]
pub async fn tasks_delete_item(state: State<'_, AppState>, input: TaskDeleteInput) -> Result<TaskItem, String> {
    let _ = require_tasks_permission(&state, &input.workspace_id, "edit", "delete_item")?;
    let mut task = state
        .store
        .get_task_item(&input.task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task not found".to_string())?;
    if task.workspace_id != input.workspace_id {
        return Err("Workspace mismatch".to_string());
    }

    let deleted_at = input.deleted_at.unwrap_or_else(now_iso);
    task.deleted_at = Some(deleted_at.clone());
    task.updated_at = deleted_at;

    state.store.put_task_item(&task).map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command]
pub async fn tasks_upsert_comment(
    state: State<'_, AppState>,
    comment: TaskComment,
) -> Result<TaskComment, String> {
    let _ = require_tasks_permission(&state, &comment.workspace_id, "edit", "upsert_comment")?;
    let mut next = comment;
    next.updated_at = now_iso();
    state
        .store
        .put_task_comment(&next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub async fn tasks_add_comment(
    state: State<'_, AppState>,
    comment: TaskComment,
) -> Result<TaskComment, String> {
    tasks_upsert_comment(state, comment).await
}

#[tauri::command]
pub async fn tasks_delete_comment(
    state: State<'_, AppState>,
    comment_id: String,
) -> Result<(), String> {
    let Some(mut existing) = state
        .store
        .get_task_comment(&comment_id)
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    let _ = require_tasks_permission(&state, &existing.workspace_id, "edit", "delete_comment")?;

    let deleted_at = now_iso();
    existing.deleted_at = Some(deleted_at.clone());
    existing.updated_at = deleted_at;
    state
        .store
        .put_task_comment(&existing)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tasks_subscribe_local(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<String, String> {
    let _ = require_tasks_permission(&state, &workspace_id, "view", "subscribe_local")?;
    Ok(format!("tasks-sub:{}", workspace_id))
}
