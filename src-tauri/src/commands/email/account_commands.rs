use tauri::State;

use super::account_config::{
    account_id, account_secret_key, get_password_for_account, normalize_email,
    normalize_optional_host, normalize_optional_port, normalize_provider, validate_connection,
};
use super::constants::EMAIL_NAMESPACE;
use super::model::{
    EmailAccountConnectInput, EmailAccountPublic, EmailConfig, StoredEmailAccount,
};
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
        let has_secret = get_password_for_account(&state, &account.id)?.is_some();
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
    state
        .store
        .kv_set(
            EMAIL_NAMESPACE,
            &account_secret_key(&id),
            &serde_json::to_value(&input.password).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("email_secret_store_failed:{e}"))?;

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

    let _ = state
        .store
        .kv_remove(EMAIL_NAMESPACE, &account_secret_key(&account_id));
    remove_account_v2(&state, &account_id);
    schedule_idle_worker_reconcile(&app, false);
    Ok(())
}

