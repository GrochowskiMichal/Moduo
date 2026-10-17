use base64::Engine as _;
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
        "module": "workspace",
        "action": action,
        "userId": user_id,
    });
    let _ = state.store.append_audit_log("acl_forbidden", &payload);
    Err("Forbidden".to_string())
}

fn require_workspace_member(
    state: &AppState,
    workspace_id: &str,
    action: &str,
) -> Result<String, String> {
    let user_id = require_user_id(state)?;
    let members = state
        .store
        .list_workspace_members(workspace_id)
        .map_err(|e| e.to_string())?;
    let is_member = members.iter().any(|m| m.user_id == user_id && m.is_active);
    if !is_member {
        deny_with_audit(state, Some(&user_id), workspace_id, action)?;
    }
    Ok(user_id)
}

fn require_workspace_manager(
    state: &AppState,
    workspace_id: &str,
    action: &str,
) -> Result<String, String> {
    let user_id = require_workspace_member(state, workspace_id, action)?;
    let members = state
        .store
        .list_workspace_members(workspace_id)
        .map_err(|e| e.to_string())?;
    let role = members
        .iter()
        .find(|m| m.user_id == user_id && m.is_active)
        .map(|m| m.role.as_str())
        .unwrap_or("viewer");
    if role != "owner" && role != "admin" {
        deny_with_audit(state, Some(&user_id), workspace_id, action)?;
    }
    Ok(user_id)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitePermissionInput {
    pub notes: Option<String>,
    pub tasks: Option<String>,
}

pub(crate) fn join_invite_for_user(
    state: &AppState,
    user_id: &str,
    token: &str,
) -> Result<WorkspaceSummary, String> {
    let raw = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(token.trim())
        .map_err(|e| e.to_string())?;

    let payload: serde_json::Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    let workspace_id = payload
        .get("workspaceId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Invalid token".to_string())?
        .to_string();

    let role = payload
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("viewer")
        .to_string();

    let permissions = payload
        .get("permissions")
        .cloned()
        .and_then(|v| serde_json::from_value::<ModulePermissions>(v).ok())
        .unwrap_or(ModulePermissions {
            notes: "view".to_string(),
            tasks: "view".to_string(),
        });

    let invite_id = payload
        .get("inviteId")
        .and_then(|v| v.as_str())
        .map(|v| v.to_string());

    let now = now_iso();
    let member = WorkspaceMember {
        id: format!("{}:{}", workspace_id, user_id),
        workspace_id: workspace_id.clone(),
        user_id: user_id.to_string(),
        role: role.clone(),
        is_active: true,
        removed_at: None,
    };

    state
        .store
        .put_workspace_member(&member)
        .and_then(|_| {
            state
                .store
                .upsert_workspace_acl(&workspace_id, user_id, &permissions)
        })
        .map_err(|e| e.to_string())?;

    let workspaces = state.store.list_workspaces().map_err(|e| e.to_string())?;
    let mut workspace = workspaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .unwrap_or(WorkspaceSummary {
            id: workspace_id.clone(),
            name: "Shared Workspace".to_string(),
            role: role.clone(),
            permissions: permissions.clone(),
            is_deleted: false,
            created_at: now.clone(),
            updated_at: now.clone(),
        });

    workspace.role = role;
    workspace.permissions = permissions;
    workspace.updated_at = now.clone();
    state
        .store
        .put_workspace(&workspace)
        .map_err(|e| e.to_string())?;

    if let Some(invite_id) = invite_id {
        let invites = state
            .store
            .list_all_workspace_invites()
            .map_err(|e| e.to_string())?;
        if let Some(mut invite) = invites.into_iter().find(|item| item.id == invite_id) {
            invite.status = "accepted".to_string();
            invite.updated_at = now;
            state
                .store
                .put_workspace_invite(&invite)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(workspace)
}

#[tauri::command]
pub async fn workspace_list_local(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceSummary>, String> {
    let user_id = require_user_id(&state)?;
    let mut workspaces = state.store.list_workspaces().map_err(|e| e.to_string())?;
    let all_members = state
        .store
        .list_all_workspace_members()
        .map_err(|e| e.to_string())?;
    workspaces.retain(|workspace| {
        all_members.iter().any(|member| {
            member.workspace_id == workspace.id && member.user_id == user_id && member.is_active
        })
    });

    for workspace in &mut workspaces {
        let role = all_members
            .iter()
            .find(|member| {
                member.workspace_id == workspace.id && member.user_id == user_id && member.is_active
            })
            .map(|member| member.role.clone())
            .unwrap_or_else(|| "viewer".to_string());

        workspace.role = role.clone();
        if role == "owner" || role == "admin" {
            workspace.permissions = ModulePermissions {
                notes: "admin".to_string(),
                tasks: "admin".to_string(),
            };
            let _ =
                state
                    .store
                    .upsert_workspace_acl(&workspace.id, &user_id, &workspace.permissions);
        } else {
            if let Some(acl) = state
                .store
                .get_workspace_acl(&workspace.id, &user_id)
                .map_err(|e| e.to_string())?
            {
                workspace.permissions = acl;
            } else {
                workspace.permissions = ModulePermissions {
                    notes: "view".to_string(),
                    tasks: "view".to_string(),
                };
                let _ = state.store.upsert_workspace_acl(
                    &workspace.id,
                    &user_id,
                    &workspace.permissions,
                );
            }
        }
    }
    workspaces.sort_by(|a, b| a.updated_at.cmp(&b.updated_at));
    Ok(workspaces)
}

#[tauri::command]
pub async fn workspace_create_local(
    state: State<'_, AppState>,
    name: String,
) -> Result<WorkspaceSummary, String> {
    let user_id = require_user_id(&state)?;
    let now = now_iso();
    let workspace = WorkspaceSummary {
        id: uuid::Uuid::new_v4().to_string(),
        name: if name.trim().is_empty() {
            "New Workspace".to_string()
        } else {
            name.trim().to_string()
        },
        role: "owner".to_string(),
        permissions: ModulePermissions::default(),
        is_deleted: false,
        created_at: now.clone(),
        updated_at: now,
    };

    let member = WorkspaceMember {
        id: format!("{}:{}", workspace.id, user_id),
        workspace_id: workspace.id.clone(),
        user_id: user_id.clone(),
        role: "owner".to_string(),
        is_active: true,
        removed_at: None,
    };

    state
        .store
        .put_workspace(&workspace)
        .and_then(|_| state.store.put_workspace_member(&member))
        .and_then(|_| {
            state
                .store
                .upsert_workspace_acl(&workspace.id, &user_id, &workspace.permissions)
        })
        .map_err(|e| e.to_string())?;

    Ok(workspace)
}

#[tauri::command]
pub async fn workspace_rename_local(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
) -> Result<WorkspaceSummary, String> {
    let _ = require_workspace_manager(&state, &workspace_id, "rename_local")?;
    let mut workspaces = state.store.list_workspaces().map_err(|e| e.to_string())?;
    let Some(current) = workspaces.iter_mut().find(|w| w.id == workspace_id) else {
        return Err("Workspace not found".to_string());
    };

    current.name = name.trim().to_string();
    current.updated_at = now_iso();

    state
        .store
        .put_workspace(current)
        .map_err(|e| e.to_string())?;
    Ok(current.clone())
}

#[tauri::command]
pub async fn workspace_leave_local(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    let user_id = require_user_id(&state)?;
    let _ = require_workspace_member(&state, &workspace_id, "leave_local")?;
    let mut members = state
        .store
        .list_workspace_members(&workspace_id)
        .map_err(|e| e.to_string())?;

    for member in &mut members {
        if member.user_id == user_id {
            member.is_active = false;
            member.removed_at = Some(now_iso());
            state
                .store
                .put_workspace_member(member)
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn workspace_soft_delete_local(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    let _ = require_workspace_manager(&state, &workspace_id, "soft_delete_local")?;
    let mut workspaces = state.store.list_workspaces().map_err(|e| e.to_string())?;
    let Some(current) = workspaces.iter_mut().find(|w| w.id == workspace_id) else {
        return Err("Workspace not found".to_string());
    };

    current.is_deleted = true;
    current.updated_at = now_iso();
    state
        .store
        .put_workspace(current)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn workspace_issue_invite(
    state: State<'_, AppState>,
    workspace_id: String,
    email: String,
    role: String,
    module_permissions: Option<InvitePermissionInput>,
) -> Result<WorkspaceInvite, String> {
    let _ = require_workspace_manager(&state, &workspace_id, "issue_invite")?;
    let now = now_iso();
    let permissions = ModulePermissions {
        notes: module_permissions
            .as_ref()
            .and_then(|p| p.notes.clone())
            .unwrap_or_else(|| "view".to_string()),
        tasks: module_permissions
            .as_ref()
            .and_then(|p| p.tasks.clone())
            .unwrap_or_else(|| "view".to_string()),
    };

    let invite_id = uuid::Uuid::new_v4().to_string();
    let token_payload = serde_json::json!({
        "inviteId": invite_id,
        "workspaceId": workspace_id,
        "email": email.to_lowercase(),
        "role": role,
        "permissions": permissions,
        "issuedAt": now,
    });

    let token = base64::engine::general_purpose::STANDARD_NO_PAD.encode(token_payload.to_string());
    let invite = WorkspaceInvite {
        id: token_payload
            .get("inviteId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        workspace_id: token_payload
            .get("workspaceId")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        email: token_payload
            .get("email")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        role: token_payload
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("viewer")
            .to_string(),
        status: "pending".to_string(),
        token,
        created_at: token_payload
            .get("issuedAt")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        updated_at: token_payload
            .get("issuedAt")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
    };

    state
        .store
        .put_workspace_invite(&invite)
        .map_err(|e| e.to_string())?;

    Ok(invite)
}

#[tauri::command]
pub async fn workspace_join_invite(
    state: State<'_, AppState>,
    token: String,
) -> Result<WorkspaceSummary, String> {
    let user_id = require_user_id(&state)?;
    join_invite_for_user(&state, &user_id, &token)
}

#[tauri::command]
pub async fn workspace_list_members(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<WorkspaceMember>, String> {
    let _ = require_workspace_member(&state, &workspace_id, "list_members")?;
    state
        .store
        .list_workspace_members(&workspace_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_list_invites(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<WorkspaceInvite>, String> {
    let _ = require_workspace_member(&state, &workspace_id, "list_invites")?;
    state
        .store
        .list_workspace_invites(&workspace_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_list_notifications(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceNotification>, String> {
    state.store.list_notifications().map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUpdateInviteInput {
    pub invite_id: String,
    pub role: String,
    pub module_permissions: Option<InvitePermissionInput>,
}

#[tauri::command]
pub async fn workspace_update_invite(
    state: State<'_, AppState>,
    input: WorkspaceUpdateInviteInput,
) -> Result<(), String> {
    let invites = state
        .store
        .list_all_workspace_invites()
        .map_err(|e| e.to_string())?;
    let Some(existing) = invites.iter().find(|invite| invite.id == input.invite_id) else {
        return Ok(());
    };
    let _ = require_workspace_manager(&state, &existing.workspace_id, "update_invite")?;

    let invites = state
        .store
        .list_all_workspace_invites()
        .map_err(|e| e.to_string())?;
    let Some(mut target) = invites
        .into_iter()
        .find(|invite| invite.id == input.invite_id)
    else {
        return Ok(());
    };

    target.role = input.role;
    target.updated_at = now_iso();
    state
        .store
        .put_workspace_invite(&target)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_revoke_invite(
    state: State<'_, AppState>,
    invite_id: String,
) -> Result<(), String> {
    let invites = state
        .store
        .list_all_workspace_invites()
        .map_err(|e| e.to_string())?;
    let Some(existing) = invites.iter().find(|invite| invite.id == invite_id) else {
        return Ok(());
    };
    let _ = require_workspace_manager(&state, &existing.workspace_id, "revoke_invite")?;

    let invites = state
        .store
        .list_all_workspace_invites()
        .map_err(|e| e.to_string())?;
    let Some(mut target) = invites.into_iter().find(|invite| invite.id == invite_id) else {
        return Ok(());
    };
    target.status = "revoked".to_string();
    target.updated_at = now_iso();
    state
        .store
        .put_workspace_invite(&target)
        .map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUpdateMemberInput {
    pub member_id: String,
    pub role: String,
    pub module_permissions: Option<InvitePermissionInput>,
}

#[tauri::command]
pub async fn workspace_update_member_permissions(
    state: State<'_, AppState>,
    input: WorkspaceUpdateMemberInput,
) -> Result<(), String> {
    let members = state
        .store
        .list_all_workspace_members()
        .map_err(|e| e.to_string())?;
    let Some(existing) = members.iter().find(|member| member.id == input.member_id) else {
        return Ok(());
    };
    let _ = require_workspace_manager(&state, &existing.workspace_id, "update_member_permissions")?;

    let members = state
        .store
        .list_all_workspace_members()
        .map_err(|e| e.to_string())?;
    let Some(mut target) = members
        .into_iter()
        .find(|member| member.id == input.member_id)
    else {
        return Ok(());
    };

    target.role = input.role;
    state
        .store
        .put_workspace_member(&target)
        .map_err(|e| e.to_string())?;

    let permissions = ModulePermissions {
        notes: input
            .module_permissions
            .as_ref()
            .and_then(|p| p.notes.clone())
            .unwrap_or_else(|| "view".to_string()),
        tasks: input
            .module_permissions
            .as_ref()
            .and_then(|p| p.tasks.clone())
            .unwrap_or_else(|| "view".to_string()),
    };
    state
        .store
        .upsert_workspace_acl(&target.workspace_id, &target.user_id, &permissions)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_mark_notification_read(
    state: State<'_, AppState>,
    notification_id: String,
) -> Result<(), String> {
    let mut notifications = state
        .store
        .list_notifications()
        .map_err(|e| e.to_string())?;
    let Some(target) = notifications.iter_mut().find(|n| n.id == notification_id) else {
        return Ok(());
    };
    target.read_at = Some(now_iso());
    state
        .store
        .put_notification(target)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_mark_all_notifications_read(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut notifications = state
        .store
        .list_notifications()
        .map_err(|e| e.to_string())?;
    let now = now_iso();
    for item in &mut notifications {
        item.read_at = Some(now.clone());
        state
            .store
            .put_notification(item)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
