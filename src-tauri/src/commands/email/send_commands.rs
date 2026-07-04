use tauri::State;

use super::account_config::{ensure_account_config, get_password_for_account, mailbox_candidates};
use super::connection::open_imap_session;
use super::model::{EmailConfig, EmailSendMessageInput, EmailSendMessageResult};
use super::smtp::{build_message, generate_message_id, send_message, send_prepared, MailAttachment, MailSendSpec};
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

/// Full send path (reply headers, cc/bcc, HTML+plain multipart, attachments), TLS
/// transport, and a Gmail-skip copy-to-Sent. Returns the Message-ID so the client
/// can match the sent copy and drive follow-up tracking. (EM-1, AC10.)
#[tauri::command]
pub async fn email_send_message(
    state: State<'_, AppState>,
    input: EmailSendMessageInput,
) -> Result<EmailSendMessageResult, String> {
    let mut accounts = read_accounts(&state)?;
    let Some(index) = accounts.iter().position(|a| a.id == input.account_id) else {
        return Err("account_not_found".to_string());
    };
    let account = accounts[index].clone();

    let config = match ensure_account_config(&state, &account) {
        Ok(cfg) => cfg,
        Err(err) => {
            // No secret → the account needs reconnecting; surface it on the row.
            if err == "account_reauth_required" {
                accounts[index].status = "reauth_required".to_string();
                accounts[index].last_error = Some("missing_account_secret".to_string());
                write_accounts(&state, &accounts)?;
            }
            return Err(err);
        }
    };

    if input.to.is_empty() {
        return Err("missing_recipients".to_string());
    }

    let message_id = input
        .message_id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| generate_message_id(&config.email));

    let provider = account.provider.clone();
    let message_id_for_send = message_id.clone();

    // File reads + SMTP + the IMAP APPEND are all blocking — one dedicated thread.
    let send_result = tauri::async_runtime::spawn_blocking(move || {
        let mut attachments = Vec::with_capacity(input.attachments.len());
        for att in &input.attachments {
            let bytes = std::fs::read(&att.path)
                .map_err(|e| format!("attachment_read_failed:{}:{e}", att.path))?;
            attachments.push(MailAttachment {
                filename: att.filename.clone(),
                mime: att.mime_type.clone(),
                bytes,
            });
        }

        let spec = MailSendSpec {
            from_name: input.from_name.clone(),
            from_addr: config.email.clone(),
            to: input.to.clone(),
            cc: input.cc.clone(),
            bcc: input.bcc.clone(),
            subject: input.subject.clone(),
            text_body: input.text_body.clone(),
            html_body: input.html_body.clone(),
            message_id: message_id_for_send.clone(),
            in_reply_to: input.in_reply_to.clone(),
            references: input.references.clone(),
            attachments,
        };

        let message = build_message(&spec)?;
        send_prepared(&config, &message)?;

        // Copy to Sent — except Gmail, which auto-saves SMTP-sent mail (a manual
        // APPEND would duplicate). A failed APPEND is non-fatal: the mail already
        // went out.
        let saved_to_sent = if provider == "gmail" {
            false
        } else {
            append_to_sent(&config, &provider, &message.formatted()).unwrap_or(false)
        };
        Ok::<bool, String>(saved_to_sent)
    })
    .await
    .map_err(|e| format!("send_task_failed:{e}"))?;

    match send_result {
        Ok(saved_to_sent) => {
            accounts[index].status = "active".to_string();
            accounts[index].last_error = None;
            accounts[index].last_sync_at = Some(now_iso());
            write_accounts(&state, &accounts)?;
            Ok(EmailSendMessageResult {
                message_id,
                saved_to_sent,
            })
        }
        Err(error) => {
            accounts[index].status = "error".to_string();
            accounts[index].last_error = Some(error.clone());
            write_accounts(&state, &accounts)?;
            Err(error)
        }
    }
}

/// APPEND the raw message to the account's Sent mailbox, trying provider-specific
/// candidate names. Returns Ok(true) on the first name the server accepts.
fn append_to_sent(config: &EmailConfig, provider: &str, raw: &[u8]) -> Result<bool, String> {
    let mut session = open_imap_session(config)?;
    let mut appended = false;
    for mailbox in mailbox_candidates(provider, "sent") {
        if session.append(&mailbox, raw).is_ok() {
            appended = true;
            break;
        }
    }
    let _ = session.logout();
    Ok(appended)
}
