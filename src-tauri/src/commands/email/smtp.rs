use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};

use super::model::EmailConfig;

// send_message builds and sends an SMTP message. One-shot, not cached.
// This is the only retained send path — email_send_saved uses it.

pub(super) fn send_message(
    config: &EmailConfig,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<bool, String> {
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
    let mailer = SmtpTransport::builder_dangerous(config.smtp_host())
        .port(config.smtp_port())
        .credentials(creds)
        .build();

    mailer.send(&email).map_err(|e| e.to_string())?;
    Ok(true)
}
