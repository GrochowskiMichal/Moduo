use std::collections::BTreeSet;

use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::{domain::*, AppState};

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn project_code_prefix(name: &str) -> String {
    let mut prefix = name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(3)
        .collect::<String>()
        .to_uppercase();
    while prefix.len() < 3 {
        prefix.push('X');
    }
    prefix
}

fn task_code_suffix(value: &str) -> Option<u64> {
    let (_, tail) = value.rsplit_once('-')?;
    tail.parse::<u64>().ok()
}

fn ensure_task_code(state: &AppState, task: &mut TaskItem) -> Result<(), String> {
    if let Some(code) = task.task_code.as_ref() {
        if !code.trim().is_empty() {
            return Ok(());
        }
    }

    let existing = state
        .store
        .get_task_item(&task.id)
        .map_err(|e| e.to_string())?;
    if let Some(existing_task) = existing {
        if let Some(existing_code) = existing_task.task_code {
            if !existing_code.trim().is_empty() {
                task.task_code = Some(existing_code);
                return Ok(());
            }
        }
    }

    let bundle = state
        .store
        .list_tasks_bundle(&task.workspace_id)
        .map_err(|e| e.to_string())?;
    let project_name = bundle
        .projects
        .iter()
        .find(|project| project.id == task.project_id)
        .map(|project| project.name.clone())
        .unwrap_or_else(|| "Task".to_string());
    let max_index = bundle
        .tasks
        .iter()
        .filter(|entry| entry.project_id == task.project_id)
        .filter_map(|entry| entry.task_code.as_deref())
        .filter_map(task_code_suffix)
        .max()
        .unwrap_or(0);
    let next_index = max_index.saturating_add(1);
    task.task_code = Some(format!(
        "{}-{}",
        project_code_prefix(&project_name),
        next_index
    ));
    Ok(())
}

fn push_task_activity(
    state: &AppState,
    workspace_id: &str,
    task_id: &str,
    actor_user_id: &str,
    action: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let activity = TaskActivity {
        id: Uuid::new_v4().to_string(),
        workspace_id: workspace_id.to_string(),
        task_id: task_id.to_string(),
        actor_user_id: actor_user_id.to_string(),
        action: action.to_string(),
        payload,
        created_at: now_iso(),
    };
    state
        .store
        .put_task_activity(&activity)
        .map_err(|e| e.to_string())
}

fn write_task_with_activity(
    state: &AppState,
    mut task: TaskItem,
    actor_user_id: &str,
) -> Result<TaskItem, String> {
    let previous = state
        .store
        .get_task_item(&task.id)
        .map_err(|e| e.to_string())?;
    ensure_task_code(state, &mut task)?;
    task.updated_at = now_iso();
    state
        .store
        .put_task_item(&task)
        .map_err(|e| e.to_string())?;

    if let Some(prev) = previous {
        if prev.title != task.title {
            let _ = push_task_activity(
                state,
                &task.workspace_id,
                &task.id,
                actor_user_id,
                "renamed",
                serde_json::json!({ "from": prev.title, "to": task.title }),
            );
        }
        if prev.state_id != task.state_id {
            let _ = push_task_activity(
                state,
                &task.workspace_id,
                &task.id,
                actor_user_id,
                "stage_changed",
                serde_json::json!({ "from": prev.state_id, "to": task.state_id }),
            );
        }
        if prev.priority != task.priority {
            let _ = push_task_activity(
                state,
                &task.workspace_id,
                &task.id,
                actor_user_id,
                "priority_changed",
                serde_json::json!({ "from": prev.priority, "to": task.priority }),
            );
        }
        if prev.assignee_id != task.assignee_id {
            let _ = push_task_activity(
                state,
                &task.workspace_id,
                &task.id,
                actor_user_id,
                "assignee_changed",
                serde_json::json!({ "from": prev.assignee_id, "to": task.assignee_id }),
            );
        }
        if prev.parent_task_id != task.parent_task_id {
            let _ = push_task_activity(
                state,
                &task.workspace_id,
                &task.id,
                actor_user_id,
                "parent_changed",
                serde_json::json!({ "from": prev.parent_task_id, "to": task.parent_task_id }),
            );
        }
        if prev.child_of_task_id != task.child_of_task_id {
            let _ = push_task_activity(
                state,
                &task.workspace_id,
                &task.id,
                actor_user_id,
                "relation_child_of_changed",
                serde_json::json!({ "from": prev.child_of_task_id, "to": task.child_of_task_id }),
            );
        }
        if prev.duplicate_of_task_id != task.duplicate_of_task_id {
            let _ = push_task_activity(
                state,
                &task.workspace_id,
                &task.id,
                actor_user_id,
                "duplicate_changed",
                serde_json::json!({ "from": prev.duplicate_of_task_id, "to": task.duplicate_of_task_id }),
            );
        }
        let prev_blocked_by: BTreeSet<String> = prev.blocked_by_task_ids.iter().cloned().collect();
        let next_blocked_by: BTreeSet<String> = task.blocked_by_task_ids.iter().cloned().collect();
        if prev_blocked_by != next_blocked_by {
            let added: Vec<String> = next_blocked_by
                .difference(&prev_blocked_by)
                .cloned()
                .collect();
            let removed: Vec<String> = prev_blocked_by
                .difference(&next_blocked_by)
                .cloned()
                .collect();
            let _ = push_task_activity(
                state,
                &task.workspace_id,
                &task.id,
                actor_user_id,
                "blocked_by_changed",
                serde_json::json!({ "added": added, "removed": removed }),
            );
        }
        let prev_tags: BTreeSet<String> = prev.tags.iter().cloned().collect();
        let next_tags: BTreeSet<String> = task.tags.iter().cloned().collect();
        if prev_tags != next_tags {
            let added: Vec<String> = next_tags.difference(&prev_tags).cloned().collect();
            let removed: Vec<String> = prev_tags.difference(&next_tags).cloned().collect();
            let _ = push_task_activity(
                state,
                &task.workspace_id,
                &task.id,
                actor_user_id,
                "tags_changed",
                serde_json::json!({ "added": added, "removed": removed }),
            );
        }
    } else {
        let _ = push_task_activity(
            state,
            &task.workspace_id,
            &task.id,
            actor_user_id,
            "created",
            serde_json::json!({
                "title": task.title,
                "stateId": task.state_id,
                "priority": task.priority,
                "assigneeId": task.assignee_id,
                "tags": task.tags,
            }),
        );
    }
    Ok(task)
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
pub async fn tasks_list(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<TasksBundle, String> {
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
        let _ =
            require_tasks_permission(&state, &workflow_state.workspace_id, "edit", "upsert_state")?;
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
        let user_id = require_tasks_permission(&state, &task.workspace_id, "edit", "upsert_item")?;
        let saved = write_task_with_activity(&state, task, &user_id)?;
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
pub async fn tasks_upsert_item(
    state: State<'_, AppState>,
    task: TaskItem,
) -> Result<TaskItem, String> {
    let user_id = require_tasks_permission(&state, &task.workspace_id, "edit", "upsert_item")?;
    write_task_with_activity(&state, task, &user_id)
}

#[tauri::command]
pub async fn tasks_move(
    state: State<'_, AppState>,
    input: TaskMoveInput,
) -> Result<TaskItem, String> {
    let user_id = require_tasks_permission(&state, &input.workspace_id, "edit", "move")?;
    let mut task = state
        .store
        .get_task_item(&input.task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Task not found".to_string())?;
    if task.workspace_id != input.workspace_id {
        return Err("Workspace mismatch".to_string());
    }

    let previous_state_id = task.state_id.clone();
    task.parent_task_id = input.new_parent_task_id;
    task.state_id = input.new_state_id;
    task.position = input.new_position;
    task.updated_at = now_iso();

    state
        .store
        .put_task_item(&task)
        .map_err(|e| e.to_string())?;
    if previous_state_id != task.state_id {
        let _ = push_task_activity(
            &state,
            &task.workspace_id,
            &task.id,
            &user_id,
            "stage_changed",
            serde_json::json!({ "from": previous_state_id, "to": task.state_id }),
        );
    }
    Ok(task)
}

#[tauri::command]
pub async fn tasks_delete_item(
    state: State<'_, AppState>,
    input: TaskDeleteInput,
) -> Result<TaskItem, String> {
    let user_id = require_tasks_permission(&state, &input.workspace_id, "edit", "delete_item")?;
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

    state
        .store
        .put_task_item(&task)
        .map_err(|e| e.to_string())?;
    let _ = push_task_activity(
        &state,
        &task.workspace_id,
        &task.id,
        &user_id,
        "deleted",
        serde_json::json!({}),
    );
    Ok(task)
}

#[tauri::command]
pub async fn tasks_upsert_comment(
    state: State<'_, AppState>,
    comment: TaskComment,
) -> Result<TaskComment, String> {
    let user_id =
        require_tasks_permission(&state, &comment.workspace_id, "edit", "upsert_comment")?;
    let existed = state
        .store
        .get_task_comment(&comment.id)
        .map_err(|e| e.to_string())?
        .is_some();
    let mut next = comment;
    next.updated_at = now_iso();
    state
        .store
        .put_task_comment(&next)
        .map_err(|e| e.to_string())?;
    if !existed {
        let _ = push_task_activity(
            &state,
            &next.workspace_id,
            &next.task_id,
            &user_id,
            "comment_added",
            serde_json::json!({ "commentId": next.id }),
        );
    }
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
