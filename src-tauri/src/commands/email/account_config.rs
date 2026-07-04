use super::connection::{open_imap_session, ImapSession};
use super::constants::EMAIL_SECRET_KEY_PREFIX;
use super::model::{EmailConfig, StoredEmailAccount};
use crate::AppState;

pub(super) fn normalize_provider(provider: &str) -> Result<String, String> {
    let normalized = provider.trim().to_lowercase();
    match normalized.as_str() {
        "gmail" | "outlook" | "icloud" | "custom" => Ok(normalized),
        _ => Err(format!("unsupported_provider:{}", provider)),
    }
}

pub(super) fn normalize_email(email: &str) -> Result<String, String> {
    let normalized = email.trim().to_lowercase();
    if normalized.is_empty() || !normalized.contains('@') {
        return Err("invalid_email".to_string());
    }
    Ok(normalized)
}

pub(super) fn normalize_optional_host(raw: &Option<String>) -> Option<String> {
    raw.as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
}

pub(super) fn normalize_optional_port(raw: Option<u16>) -> Option<u16> {
    raw.filter(|port| *port > 0)
}

pub(super) fn account_id(provider: &str, email: &str, imap_host: Option<&str>) -> String {
    if provider == "custom" {
        return format!("{}:{}:{}", provider, email, imap_host.unwrap_or("imap"));
    }
    format!("{}:{}", provider, email)
}

pub(super) fn account_secret_key(account_id: &str) -> String {
    format!("{}{}", EMAIL_SECRET_KEY_PREFIX, account_id)
}

pub(super) fn get_password_for_account(
    state: &AppState,
    account_id: &str,
) -> Result<Option<String>, String> {
    // Keychain-first, with a one-time lazy migration off the legacy redb-cleartext
    // store (see `secrets.rs`).
    super::secrets::get_password(state, account_id)
}

pub(super) fn mailbox_candidates(provider: &str, folder: &str) -> Vec<String> {
    match folder {
        "inbox" => vec!["INBOX".to_string()],
        "sent" => match provider {
            "gmail" => vec![
                "[Gmail]/Sent Mail".to_string(),
                "Sent Mail".to_string(),
                "Sent".to_string(),
            ],
            "outlook" => vec!["Sent Items".to_string(), "Sent".to_string()],
            "icloud" => vec!["Sent Messages".to_string(), "Sent".to_string()],
            "custom" => vec![
                "Sent".to_string(),
                "Sent Items".to_string(),
                "Sent Messages".to_string(),
                "INBOX.Sent".to_string(),
                "INBOX/Sent".to_string(),
                "INBOX.Sent Items".to_string(),
                "INBOX/Sent Items".to_string(),
                "INBOX.Sent Messages".to_string(),
                "INBOX/Sent Messages".to_string(),
                "sent".to_string(),
            ],
            _ => vec!["Sent".to_string()],
        },
        "drafts" => match provider {
            "gmail" => vec!["[Gmail]/Drafts".to_string(), "Drafts".to_string()],
            "outlook" => vec!["Drafts".to_string()],
            "icloud" => vec!["Drafts".to_string()],
            "custom" => vec![
                "Drafts".to_string(),
                "INBOX.Drafts".to_string(),
                "INBOX/Drafts".to_string(),
                "drafts".to_string(),
            ],
            _ => vec!["Drafts".to_string()],
        },
        "trash" => match provider {
            "gmail" => vec!["[Gmail]/Trash".to_string(), "Trash".to_string()],
            "outlook" => vec!["Deleted Items".to_string(), "Trash".to_string()],
            "icloud" => vec!["Deleted Messages".to_string(), "Trash".to_string()],
            "custom" => vec![
                "Trash".to_string(),
                "Deleted".to_string(),
                "Deleted Items".to_string(),
                "Deleted Messages".to_string(),
                "INBOX.Trash".to_string(),
                "INBOX/Trash".to_string(),
                "INBOX.Deleted".to_string(),
                "INBOX/Deleted".to_string(),
                "INBOX.Deleted Items".to_string(),
                "INBOX/Deleted Items".to_string(),
                "trash".to_string(),
            ],
            _ => vec!["Trash".to_string()],
        },
        "spam" => match provider {
            "gmail" => vec!["[Gmail]/Spam".to_string(), "Spam".to_string()],
            "outlook" => vec![
                "Junk Email".to_string(),
                "Junk".to_string(),
                "Spam".to_string(),
            ],
            "icloud" => vec!["Junk".to_string(), "Spam".to_string()],
            "custom" => vec![
                "Spam".to_string(),
                "Junk".to_string(),
                "Junk Email".to_string(),
                "INBOX.Spam".to_string(),
                "INBOX/Spam".to_string(),
                "INBOX.Junk".to_string(),
                "INBOX/Junk".to_string(),
                "INBOX.Junk Email".to_string(),
                "INBOX/Junk Email".to_string(),
                "spam".to_string(),
            ],
            _ => vec!["Spam".to_string(), "Junk".to_string()],
        },
        _ => vec![folder.to_string()],
    }
}

pub(super) fn validate_connection(config: &EmailConfig) -> Result<bool, String> {
    let mut session = open_imap_session(config)?;
    let _ = session.logout();
    Ok(true)
}

pub(super) fn select_mailbox_for_folder(
    session: &mut ImapSession,
    provider: &str,
    folder: &str,
) -> Result<(String, imap::types::Mailbox), String> {
    for mailbox in mailbox_candidates(provider, folder) {
        if let Ok(info) = session.select(mailbox.as_str()) {
            return Ok((mailbox, info));
        }
    }
    Err(format!("folder_select_failed:{}:{}", provider, folder))
}

pub(super) fn ensure_account_config(
    state: &AppState,
    account: &StoredEmailAccount,
) -> Result<EmailConfig, String> {
    let Some(password) = get_password_for_account(state, &account.id)? else {
        return Err("account_reauth_required".to_string());
    };
    Ok(EmailConfig {
        provider: account.provider.clone(),
        email: account.email.clone(),
        password,
        imap_host: account.imap_host.clone(),
        smtp_host: account.smtp_host.clone(),
        imap_port: account.imap_port,
        smtp_port: account.smtp_port,
    })
}
