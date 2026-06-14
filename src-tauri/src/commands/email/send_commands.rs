use tauri::State;

use super::account_config::get_password_for_account;
use super::model::EmailConfig;
use super::smtp::send_message;
use super::storage::{read_accounts, write_accounts};
use crate::email_sync::now_iso;
use crate::AppState;

#[tauri::command]
pub async fn email_send_saved(
    state: State<'_, AppState>,
    account_id: String,
    to: String,
    subject: String,
    body: String,
) -> Result<bool, String> {
    let mut accounts = read_accounts(&state)?;
    let Some(index) = accounts.iter().position(|account| account.id == account_id) else {
        return Err("account_not_found".to_string());
    };

    let account = accounts[index].clone();
    let Some(password) = get_password_for_account(&state, &account.id)? else {
        accounts[index].status = "reauth_required".to_string();
        accounts[index].last_error = Some("missing_account_secret".to_string());
        write_accounts(&state, &accounts)?;
        return Err("account_reauth_required".to_string());
    };

    let config = EmailConfig {
        provider: account.provider,
        email: account.email,
        password,
        imap_host: account.imap_host,
        smtp_host: account.smtp_host,
        imap_port: account.imap_port,
        smtp_port: account.smtp_port,
    };

    // SMTP send is blocking I/O — run on a dedicated thread.
    let send_result =
        tauri::async_runtime::spawn_blocking(move || send_message(&config, &to, &subject, &body))
            .await
            .map_err(|e| format!("send_task_failed:{e}"))?;

    match send_result {
        Ok(result) => {
            accounts[index].status = "active".to_string();
            accounts[index].last_error = None;
            accounts[index].last_sync_at = Some(now_iso());
            write_accounts(&state, &accounts)?;
            Ok(result)
        }
        Err(error) => {
            accounts[index].status = "error".to_string();
            accounts[index].last_error = Some(error.clone());
            write_accounts(&state, &accounts)?;
            Err(error)
        }
    }
}

