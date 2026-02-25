use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use mailparse::{MailAddr, MailHeaderMap};
use native_tls::TlsConnector;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{keychain, AppState};

const EMAIL_NAMESPACE: &str = "email";
const EMAIL_ACCOUNTS_KEY: &str = "accounts_v1";
const EMAIL_KEYCHAIN_PREFIX: &str = "email_account::";
const EMAIL_SECRET_FALLBACK_PREFIX: &str = "email_secret_fallback::";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    pub id: String,
    pub sender: String,
    pub sender_email: String,
    pub subject: String,
    pub preview: String,
    pub body: String,
    pub date: String,
    pub read: bool,
    pub folder: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct EmailConfig {
    pub provider: String,
    pub email: String,
    pub password: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailAccountConnectInput {
    pub provider: String,
    pub email: String,
    pub password: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailAccountPublic {
    pub id: String,
    pub provider: String,
    pub email: String,
    pub last_sync_at: Option<String>,
    pub status: String,
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredEmailAccount {
    id: String,
    provider: String,
    email: String,
    last_sync_at: Option<String>,
    status: String,
    last_error: Option<String>,
}

impl StoredEmailAccount {
    fn to_public(&self) -> EmailAccountPublic {
        EmailAccountPublic {
            id: self.id.clone(),
            provider: self.provider.clone(),
            email: self.email.clone(),
            last_sync_at: self.last_sync_at.clone(),
            status: self.status.clone(),
            last_error: self.last_error.clone(),
        }
    }
}

impl EmailConfig {
    fn imap_host(&self) -> &str {
        match self.provider.as_str() {
            "gmail" => "imap.gmail.com",
            "outlook" => "outlook.office365.com",
            "icloud" => "imap.mail.me.com",
            _ => "imap.gmail.com",
        }
    }

    fn smtp_host(&self) -> &str {
        match self.provider.as_str() {
            "gmail" => "smtp.gmail.com",
            "outlook" => "smtp.office365.com",
            "icloud" => "smtp.mail.me.com",
            _ => "smtp.gmail.com",
        }
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn normalize_provider(provider: &str) -> Result<String, String> {
    let normalized = provider.trim().to_lowercase();
    match normalized.as_str() {
        "gmail" | "outlook" | "icloud" => Ok(normalized),
        _ => Err(format!("unsupported_provider:{}", provider)),
    }
}

fn normalize_email(email: &str) -> Result<String, String> {
    let normalized = email.trim().to_lowercase();
    if normalized.is_empty() || !normalized.contains('@') {
        return Err("invalid_email".to_string());
    }
    Ok(normalized)
}

fn account_id(provider: &str, email: &str) -> String {
    format!("{}:{}", provider, email)
}

fn keychain_account_key(account_id: &str) -> String {
    format!("{}{}", EMAIL_KEYCHAIN_PREFIX, account_id)
}

fn secret_fallback_key(account_id: &str) -> String {
    format!("{}{}", EMAIL_SECRET_FALLBACK_PREFIX, account_id)
}

fn read_accounts(state: &AppState) -> Result<Vec<StoredEmailAccount>, String> {
    let raw = state
        .store
        .kv_get(EMAIL_NAMESPACE, EMAIL_ACCOUNTS_KEY)
        .map_err(|e| e.to_string())?;

    match raw {
        None => Ok(vec![]),
        Some(value) => Ok(serde_json::from_value::<Vec<StoredEmailAccount>>(value).unwrap_or_else(|_| vec![])),
    }
}

fn write_accounts(state: &AppState, accounts: &[StoredEmailAccount]) -> Result<(), String> {
    state
        .store
        .kv_set(
            EMAIL_NAMESPACE,
            EMAIL_ACCOUNTS_KEY,
            &serde_json::to_value(accounts).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

fn read_password_fallback(state: &AppState, account_id: &str) -> Result<Option<String>, String> {
    let key = secret_fallback_key(account_id);
    let raw = state
        .store
        .kv_get(EMAIL_NAMESPACE, &key)
        .map_err(|e| e.to_string())?;
    match raw {
        None => Ok(None),
        Some(value) => serde_json::from_value::<String>(value)
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

fn write_password_fallback(state: &AppState, account_id: &str, password: &str) -> Result<(), String> {
    let key = secret_fallback_key(account_id);
    state
        .store
        .kv_set(
            EMAIL_NAMESPACE,
            &key,
            &serde_json::to_value(password).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
}

fn clear_password_fallback(state: &AppState, account_id: &str) {
    let _ = state
        .store
        .kv_remove(EMAIL_NAMESPACE, &secret_fallback_key(account_id));
}

fn get_password_for_account(state: &AppState, account_id: &str) -> Result<Option<String>, String> {
    match keychain::get_secret_strict(&state.config.keychain_service, &keychain_account_key(account_id)) {
        Ok(Some(secret)) => Ok(Some(secret)),
        Ok(None) => read_password_fallback(state, account_id),
        Err(_) => read_password_fallback(state, account_id),
    }
}

fn mailbox_candidates(provider: &str, folder: &str) -> Vec<String> {
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
            _ => vec!["Sent".to_string()],
        },
        "drafts" => match provider {
            "gmail" => vec![
                "[Gmail]/Drafts".to_string(),
                "Drafts".to_string(),
            ],
            "outlook" => vec!["Drafts".to_string()],
            "icloud" => vec!["Drafts".to_string()],
            _ => vec!["Drafts".to_string()],
        },
        "trash" => match provider {
            "gmail" => vec![
                "[Gmail]/Trash".to_string(),
                "Trash".to_string(),
            ],
            "outlook" => vec!["Deleted Items".to_string(), "Trash".to_string()],
            "icloud" => vec!["Deleted Messages".to_string(), "Trash".to_string()],
            _ => vec!["Trash".to_string()],
        },
        _ => vec![folder.to_string()],
    }
}

fn normalize_body_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n").trim().to_string()
}

fn html_to_text(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut tag = String::new();
    let mut in_tag = false;

    for ch in html.chars() {
        if in_tag {
            if ch == '>' {
                let tag_name = tag.trim_start_matches('/').split_whitespace().next().unwrap_or("").to_ascii_lowercase();
                if matches!(tag_name.as_str(), "br" | "p" | "div" | "li" | "tr" | "hr") {
                    output.push('\n');
                }
                tag.clear();
                in_tag = false;
            } else {
                tag.push(ch);
            }
            continue;
        }

        if ch == '<' {
            in_tag = true;
            continue;
        }

        output.push(ch);
    }

    let decoded = output
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    normalize_body_text(&decoded)
}

fn truncate_with_ellipsis(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    input.chars().take(max_chars).collect::<String>() + "..."
}

fn build_preview(body: &str) -> String {
    let flattened = body.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate_with_ellipsis(&flattened, 120)
}

fn extract_best_body(parsed: &mailparse::ParsedMail<'_>) -> String {
    let mut html_fallback: Option<String> = None;

    for part in parsed.parts() {
        if matches!(
            part.get_content_disposition().disposition,
            mailparse::DispositionType::Attachment
        ) {
            continue;
        }

        let mime = part.ctype.mimetype.as_str();
        if mime.eq_ignore_ascii_case("text/plain") {
            if let Ok(body) = part.get_body() {
                let clean = normalize_body_text(&body);
                if !clean.is_empty() {
                    return clean;
                }
            }
        } else if mime.eq_ignore_ascii_case("text/html") && html_fallback.is_none() {
            if let Ok(body) = part.get_body() {
                let clean = html_to_text(&body);
                if !clean.is_empty() {
                    html_fallback = Some(clean);
                }
            }
        }
    }

    if let Some(html) = html_fallback {
        return html;
    }

    parsed
        .get_body()
        .map(|body| normalize_body_text(&body))
        .unwrap_or_default()
}

fn validate_connection(config: &EmailConfig) -> Result<bool, String> {
    let tls = TlsConnector::builder().build().map_err(|e| e.to_string())?;
    let client = imap::connect((config.imap_host(), 993), config.imap_host(), &tls)
        .map_err(|e| e.to_string())?;
    let mut session = client
        .login(&config.email, &config.password)
        .map_err(|e| e.0.to_string())?;
    let _ = session.logout();
    Ok(true)
}

fn fetch_messages(config: &EmailConfig, folder: &str) -> Result<Vec<EmailMessage>, String> {
    let tls = TlsConnector::builder().build().map_err(|e| e.to_string())?;
    let client = imap::connect((config.imap_host(), 993), config.imap_host(), &tls)
        .map_err(|e| e.to_string())?;
    let mut session = client
        .login(&config.email, &config.password)
        .map_err(|e| e.0.to_string())?;

    let mut selected = false;
    for mailbox in mailbox_candidates(config.provider.as_str(), folder) {
        if session.select(mailbox.as_str()).is_ok() {
            selected = true;
            break;
        }
    }

    if !selected {
        let _ = session.logout();
        return Err(format!(
            "folder_select_failed:{}:{}",
            config.provider.as_str(),
            folder
        ));
    }

    let search_res = session
        .search("ALL")
        .map_err(|e| format!("search_failed:{}", e))?;
    let mut seq_ids: Vec<u32> = search_res.into_iter().collect();
    seq_ids.sort();

    let last_ids: Vec<u32> = seq_ids.into_iter().rev().take(20).collect();
    if last_ids.is_empty() {
        let _ = session.logout();
        return Ok(vec![]);
    }

    let seq_str = last_ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let fetches = session
        .fetch(&seq_str, "(ENVELOPE FLAGS BODY.PEEK[])")
        .map_err(|e| format!("fetch_failed:{}", e))?;

    let mut results = vec![];
    for msg in fetches.iter() {
        let envelope = msg.envelope();

        let mut body = String::new();
        let mut subject = String::new();
        let mut sender_email = String::new();
        let mut sender_name = String::new();
        let mut date = String::new();

        if let Some(raw) = msg.body() {
            if let Ok(parsed) = mailparse::parse_mail(raw) {
                subject = parsed.headers.get_first_value("Subject").unwrap_or_default();
                date = parsed.headers.get_first_value("Date").unwrap_or_default();

                if let Some(from_header) = parsed.headers.get_first_header("From") {
                    if let Ok(parsed_from) = mailparse::addrparse_header(from_header) {
                        for entry in parsed_from.into_inner() {
                            if let MailAddr::Single(single) = entry {
                                sender_email = single.addr;
                                sender_name = single.display_name.unwrap_or_else(|| sender_email.clone());
                                break;
                            }
                        }
                    }
                }

                body = extract_best_body(&parsed);
            }
        }

        if body.is_empty() {
            if let Some(text) = msg.text() {
                body = normalize_body_text(&String::from_utf8_lossy(text));
            }
        }

        if let Some(env) = envelope {
            if subject.is_empty() {
                subject = env
                    .subject
                    .as_ref()
                    .map(|s| String::from_utf8_lossy(s).into_owned())
                    .unwrap_or_default();
            }
            if date.is_empty() {
                date = env
                    .date
                    .as_ref()
                    .map(|s| String::from_utf8_lossy(s).into_owned())
                    .unwrap_or_default();
            }
            if sender_email.is_empty() || sender_name.is_empty() {
                if let Some(from_addr) = env.from.as_ref().and_then(|h| h.first()) {
                    if sender_email.is_empty() {
                        let user = String::from_utf8_lossy(from_addr.mailbox.as_deref().unwrap_or(b""));
                        let host = String::from_utf8_lossy(from_addr.host.as_deref().unwrap_or(b""));
                        sender_email = format!("{}@{}", user, host);
                    }
                    if sender_name.is_empty() {
                        sender_name = String::from_utf8_lossy(from_addr.name.as_deref().unwrap_or(b"")).into_owned();
                    }
                }
            }
        }

        if sender_name.is_empty() {
            sender_name = if sender_email.is_empty() {
                "Unknown sender".to_string()
            } else {
                sender_email.clone()
            };
        }
        if subject.is_empty() {
            subject = "(No subject)".to_string();
        }

        let preview = build_preview(&body);

        let mut is_read = false;
        for flag in msg.flags() {
            if matches!(flag, imap::types::Flag::Seen) {
                is_read = true;
                break;
            }
        }

        results.push(EmailMessage {
            id: msg.message.to_string(),
            sender: sender_name,
            sender_email,
            subject,
            preview,
            body,
            date,
            read: is_read,
            folder: folder.to_string(),
        });
    }

    results.reverse();

    let _ = session.logout();
    Ok(results)
}

fn send_message(config: &EmailConfig, to: &str, subject: &str, body: &str) -> Result<bool, String> {
    let from_addr = format!("{} <{}>", config.email, config.email)
        .parse()
        .map_err(|e| format!("Invalid from: {}", e))?;
    let to_addr = to.parse().map_err(|e| format!("Invalid to: {}", e))?;

    let email = Message::builder()
        .from(from_addr)
        .to(to_addr)
        .subject(subject)
        .body(body.to_string())
        .map_err(|e| e.to_string())?;

    let creds = Credentials::new(config.email.clone(), config.password.clone());
    let mailer = SmtpTransport::relay(config.smtp_host())
        .map_err(|e| e.to_string())?
        .credentials(creds)
        .build();

    mailer.send(&email).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn email_accounts_list(state: State<'_, AppState>) -> Result<Vec<EmailAccountPublic>, String> {
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
        } else if account.status != "reauth_required" || account.last_error.as_deref() != Some("missing_account_secret") {
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
    state: State<'_, AppState>,
    input: EmailAccountConnectInput,
) -> Result<EmailAccountPublic, String> {
    let provider = normalize_provider(&input.provider)?;
    let email = normalize_email(&input.email)?;
    if input.password.is_empty() {
        return Err("missing_password".to_string());
    }

    let config = EmailConfig {
        provider: provider.clone(),
        email: email.clone(),
        password: input.password.clone(),
    };
    validate_connection(&config)?;

    let id = account_id(&provider, &email);
    let keychain_write = keychain::set_secret(
        &state.config.keychain_service,
        &keychain_account_key(&id),
        &input.password,
    );
    let keychain_has_secret = match keychain_write {
        Ok(()) => keychain::get_secret_strict(&state.config.keychain_service, &keychain_account_key(&id))
            .map_err(|e| e.to_string())?
            .is_some(),
        Err(_) => false,
    };
    if !keychain_has_secret {
        write_password_fallback(&state, &id, &input.password)?;
    } else {
        clear_password_fallback(&state, &id);
    }

    let mut accounts = read_accounts(&state)?;
    if let Some(existing) = accounts.iter_mut().find(|account| account.id == id) {
        existing.provider = provider;
        existing.email = email;
        existing.status = "active".to_string();
        existing.last_error = None;
    } else {
        accounts.push(StoredEmailAccount {
            id: id.clone(),
            provider,
            email,
            last_sync_at: None,
            status: "active".to_string(),
            last_error: None,
        });
    }

    write_accounts(&state, &accounts)?;

    let saved = accounts
        .into_iter()
        .find(|account| account.id == id)
        .ok_or_else(|| "account_save_failed".to_string())?;
    Ok(saved.to_public())
}

#[tauri::command]
pub async fn email_account_disconnect(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<(), String> {
    let mut accounts = read_accounts(&state)?;
    accounts.retain(|account| account.id != account_id);
    write_accounts(&state, &accounts)?;

    let _ = keychain::delete_secret(
        &state.config.keychain_service,
        &keychain_account_key(&account_id),
    );
    clear_password_fallback(&state, &account_id);
    Ok(())
}

#[tauri::command]
pub async fn email_fetch_saved(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
) -> Result<Vec<EmailMessage>, String> {
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
    };

    match fetch_messages(&config, &folder) {
        Ok(messages) => {
            accounts[index].status = "active".to_string();
            accounts[index].last_error = None;
            accounts[index].last_sync_at = Some(now_iso());
            write_accounts(&state, &accounts)?;
            Ok(messages)
        }
        Err(error) => {
            accounts[index].status = "error".to_string();
            accounts[index].last_error = Some(error.clone());
            write_accounts(&state, &accounts)?;
            Err(error)
        }
    }
}

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
    };

    match send_message(&config, &to, &subject, &body) {
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

#[tauri::command]
pub fn email_connect(config: EmailConfig) -> Result<bool, String> {
    validate_connection(&config)
}

#[tauri::command]
pub fn email_fetch(config: EmailConfig, folder: String) -> Result<Vec<EmailMessage>, String> {
    fetch_messages(&config, &folder)
}

#[tauri::command]
pub fn email_send(config: EmailConfig, to: String, subject: String, body: String) -> Result<bool, String> {
    send_message(&config, &to, &subject, &body)
}
