use tauri::State;

use super::account_config::{
    account_id, normalize_email, normalize_optional_host, normalize_optional_port,
    normalize_provider, validate_connection,
};
use super::model::{
    EmailAccountConnectInput, EmailAccountPublic, EmailConfig, EmailHistoryDepth,
    StoredEmailAccount,
};
use super::secrets;
use super::realtime::schedule_idle_worker_reconcile;
use super::storage::{
    read_accounts, remove_account_v2, upsert_account_v2, write_accounts,
};
use crate::AppState;

#[tauri::command]
pub async fn email_accounts_list(
    state: State<'_, AppState>,
) -> Result<Vec<EmailAccountPublic>, String> {
    let mut accounts = read_accounts(&state)?;
    let mut changed = false;

    for account in accounts.iter_mut() {
        // "any secret" (password OR oauth) — an OAuth account carries no password,
        // so a password-only check would wrongly flag it reauth_required.
        let has_secret = secrets::account_has_secret(&state, &account.id)?;
        if has_secret {
            if account.status == "reauth_required" {
                account.status = "active".to_string();
                account.last_error = None;
                changed = true;
            }
        } else if account.status != "reauth_required"
            || account.last_error.as_deref() != Some("missing_account_secret")
        {
            account.status = "reauth_required".to_string();
            account.last_error = Some("missing_account_secret".to_string());
            changed = true;
        }
    }

    if changed {
        write_accounts(&state, &accounts)?;
    }

    let mut public_accounts = accounts
        .into_iter()
        .map(|entry| entry.to_public())
        .collect::<Vec<_>>();
    public_accounts.sort_by(|a, b| a.email.cmp(&b.email));
    Ok(public_accounts)
}

#[tauri::command]
pub async fn email_account_connect_and_save(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EmailAccountConnectInput,
) -> Result<EmailAccountPublic, String> {
    let provider = normalize_provider(&input.provider)?;
    let email = normalize_email(&input.email)?;
    if input.password.is_empty() {
        return Err("missing_password".to_string());
    }
    let imap_host = normalize_optional_host(&input.imap_host);
    let smtp_host = normalize_optional_host(&input.smtp_host);
    let imap_port = normalize_optional_port(input.imap_port);
    let smtp_port = normalize_optional_port(input.smtp_port);
    if provider == "custom"
        && (imap_host.is_none()
            || smtp_host.is_none()
            || imap_port.is_none()
            || smtp_port.is_none())
    {
        return Err("missing_custom_mail_hosts".to_string());
    }

    let config = EmailConfig {
        provider: provider.clone(),
        email: email.clone(),
        password: input.password.clone(),
        oauth_access_token: None,
        imap_host: imap_host.clone(),
        smtp_host: smtp_host.clone(),
        imap_port,
        smtp_port,
    };
    // validate_connection opens a blocking TCP socket — must not run on the async executor.
    tauri::async_runtime::spawn_blocking(move || validate_connection(&config))
        .await
        .map_err(|e| format!("connect_task_failed:{e}"))??;

    let id = account_id(&provider, &email, imap_host.as_deref());
    // Secret goes to the OS keychain — never redb-cleartext, never the cloud.
    secrets::save_password(&state, &id, &input.password)?;

    let mut accounts = read_accounts(&state)?;
    if let Some(existing) = accounts.iter_mut().find(|account| account.id == id) {
        existing.workspace_id = input.workspace_id.clone();
        existing.provider = provider;
        existing.email = email;
        existing.imap_host = imap_host;
        existing.smtp_host = smtp_host;
        existing.imap_port = imap_port;
        existing.smtp_port = smtp_port;
        existing.status = "active".to_string();
        existing.last_error = None;
        // Re-connecting an address that already has a row still shows the picker
        // (only a credential *repair* hides it), so an explicit pick has to land
        // here as well — otherwise Settings shows the old depth and the choice
        // is silently ignored.
        if let Some(depth) = input
            .history_depth
            .as_deref()
            .and_then(EmailHistoryDepth::from_wire)
        {
            existing.history_depth = depth;
        }
    } else {
        accounts.push(StoredEmailAccount {
            id: id.clone(),
            workspace_id: input.workspace_id.clone(),
            provider,
            email,
            imap_host,
            smtp_host,
            imap_port,
            smtp_port,
            last_sync_at: None,
            status: "active".to_string(),
            last_error: None,
            // The connect-time picker's choice (AC6); absent or unrecognised
            // falls back to the 12-month default.
            history_depth: input
                .history_depth
                .as_deref()
                .and_then(EmailHistoryDepth::from_wire)
                .unwrap_or_default(),
        });
    }

    write_accounts(&state, &accounts)?;

    if let Some(saved_account) = accounts.iter().find(|account| account.id == id) {
        let _ = upsert_account_v2(&state, saved_account, Some(vec![]), Some(false), None);
    }

    let saved = accounts
        .into_iter()
        .find(|account| account.id == id)
        .ok_or_else(|| "account_save_failed".to_string())?;
    schedule_idle_worker_reconcile(&app, false);
    Ok(saved.to_public())
}

#[tauri::command]
pub async fn email_account_disconnect(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    account_id: String,
) -> Result<(), String> {
    let mut accounts = read_accounts(&state)?;
    accounts.retain(|account| account.id != account_id);
    write_accounts(&state, &accounts)?;

    let _ = secrets::delete_account_secret(&state, &account_id);
    remove_account_v2(&state, &account_id);
    schedule_idle_worker_reconcile(&app, false);
    Ok(())
}


/// Change how far back an account syncs (AC8).
///
/// Per-device: the depth lives in the local redb store, so changing it here does
/// not touch the other machine's setting. **Raising** it re-opens a completed
/// backfill on the next sync round (the cursor's recorded floor is now shallower
/// than the configured one, which `depth_gap_reopens` detects) — no cursor
/// surgery needed here. **Lowering** it stops fetching and deletes nothing: the
/// prune is gated on the depth already *reached*, not the one configured.
#[tauri::command]
pub async fn email_account_set_history_depth(
    state: State<'_, AppState>,
    account_id: String,
    depth: String,
) -> Result<EmailAccountPublic, String> {
    let parsed = EmailHistoryDepth::from_wire(&depth).ok_or("unsupported_history_depth")?;
    let mut accounts = read_accounts(&state)?;
    let Some(account) = accounts.iter_mut().find(|item| item.id == account_id) else {
        return Err("account_not_found".to_string());
    };
    account.history_depth = parsed;
    let updated = account.to_public();
    write_accounts(&state, &accounts)?;
    Ok(updated)
}
