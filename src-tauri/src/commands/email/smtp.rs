//! SMTP send path.
//!
//! Transport is **always TLS** — port 465 is implicit TLS (SMTPS), everything else
//! (587, custom) is STARTTLS-required. The prior `builder_dangerous` path sent
//! credentials in cleartext and is gone (EM-1, AC10).
//!
//! `build_message` is pure (attachment bytes already resolved) so the reply-header /
//! multipart / attachment shape is unit-testable without a network.

use lettre::message::header::{self, ContentType};
use lettre::message::{Attachment, Mailbox, Mailboxes, Message, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Address, SmtpTransport, Transport};

use super::model::EmailConfig;

/// SMTP transport security, chosen by port. There is deliberately **no plaintext
/// variant** — every connection is encrypted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SmtpSecurity {
    /// Implicit TLS from the first byte (SMTPS, port 465).
    ImplicitTls,
    /// Upgrade with STARTTLS and require TLS (587 and any other port).
    StartTls,
}

/// Never returns a plaintext option: 465 → implicit TLS, everything else → STARTTLS.
pub(super) fn smtp_tls_mode(port: u16) -> SmtpSecurity {
    match port {
        465 => SmtpSecurity::ImplicitTls,
        _ => SmtpSecurity::StartTls,
    }
}

/// An outgoing message, fully resolved (attachment bytes already read from disk).
pub(super) struct MailSendSpec {
    pub from_name: Option<String>,
    pub from_addr: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub text_body: String,
    pub html_body: Option<String>,
    /// Bracketed Message-ID (`<id@domain>`), client-generated for Sent-matching.
    pub message_id: String,
    /// The parent's Message-ID for a reply (`In-Reply-To`).
    pub in_reply_to: Option<String>,
    /// The thread's Message-ID chain (`References`).
    pub references: Vec<String>,
    pub attachments: Vec<MailAttachment>,
}

pub(super) struct MailAttachment {
    pub filename: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

/// A client-generated, RFC-shaped Message-ID (`<uuid@from-domain>`). Generating it
/// ourselves lets us match the sent copy in Sent and drive follow-up tracking.
pub(super) fn generate_message_id(from_addr: &str) -> String {
    let domain = from_addr
        .split('@')
        .nth(1)
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .unwrap_or("moduo.local");
    format!("<{}@{}>", uuid::Uuid::new_v4(), domain)
}

fn ensure_bracketed(id: &str) -> String {
    let t = id.trim();
    if t.starts_with('<') && t.ends_with('>') {
        t.to_string()
    } else {
        format!("<{t}>")
    }
}

fn parse_mailbox(raw: &str) -> Result<Mailbox, String> {
    raw.trim()
        .parse::<Mailbox>()
        .map_err(|e| format!("invalid_mailbox:{raw}:{e}"))
}

fn collect_mailboxes(addrs: &[String]) -> Result<Mailboxes, String> {
    let mut boxes = Mailboxes::new();
    for a in addrs {
        boxes.push(parse_mailbox(a)?);
    }
    Ok(boxes)
}

fn from_mailbox(spec: &MailSendSpec) -> Result<Mailbox, String> {
    match &spec.from_name {
        Some(name) if !name.trim().is_empty() => {
            let address = spec
                .from_addr
                .trim()
                .parse::<Address>()
                .map_err(|e| format!("invalid_from:{}:{e}", spec.from_addr))?;
            Ok(Mailbox::new(Some(name.clone()), address))
        }
        _ => parse_mailbox(&spec.from_addr),
    }
}

/// Turn a resolved [`MailSendSpec`] into a lettre [`Message`]. Pure (no I/O).
pub(super) fn build_message(spec: &MailSendSpec) -> Result<Message, String> {
    if spec.to.is_empty() {
        return Err("missing_recipients".to_string());
    }

    let mut builder = Message::builder()
        .from(from_mailbox(spec)?)
        .subject(spec.subject.clone())
        // lettre's `MessageId` header emits the value verbatim (its own default is
        // `<uuid@host>`) — pass the bracketed form or the header is RFC-invalid.
        .message_id(Some(ensure_bracketed(&spec.message_id)));

    // One header per recipient class, carrying every address. (The header tuple
    // field is `pub(crate)`, so construct via the `From<Mailboxes>` impl.)
    builder = builder.header(header::To::from(collect_mailboxes(&spec.to)?));
    if !spec.cc.is_empty() {
        builder = builder.header(header::Cc::from(collect_mailboxes(&spec.cc)?));
    }
    if !spec.bcc.is_empty() {
        builder = builder.header(header::Bcc::from(collect_mailboxes(&spec.bcc)?));
    }

    // Threading headers keep replies in the recipient's client (AC10). Skip blank
    // ids — an empty string would emit a malformed `<>` msg-id token.
    if let Some(irt) = spec
        .in_reply_to
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        builder = builder.in_reply_to(ensure_bracketed(irt));
    }
    let refs: Vec<String> = spec
        .references
        .iter()
        .map(|r| r.trim())
        .filter(|r| !r.is_empty())
        .map(ensure_bracketed)
        .collect();
    if !refs.is_empty() {
        builder = builder.references(refs.join(" "));
    }

    let text = spec.text_body.clone();
    let message = if spec.attachments.is_empty() {
        match &spec.html_body {
            Some(html) => builder
                .multipart(MultiPart::alternative_plain_html(text, html.clone()))
                .map_err(|e| e.to_string())?,
            None => builder
                .singlepart(SinglePart::plain(text))
                .map_err(|e| e.to_string())?,
        }
    } else {
        // Attachments → multipart/mixed wrapping the body (alternative or plain).
        // `MultiPart::mixed()` is a builder; its first `.singlepart`/`.multipart`
        // finalizes it to a `MultiPart` that further parts chain onto.
        let mut mixed = match &spec.html_body {
            Some(html) => {
                MultiPart::mixed().multipart(MultiPart::alternative_plain_html(text, html.clone()))
            }
            None => MultiPart::mixed().singlepart(SinglePart::plain(text)),
        };
        for att in &spec.attachments {
            let ct = ContentType::parse(&att.mime)
                .map_err(|e| format!("invalid_attachment_mime:{}:{e}", att.mime))?;
            mixed = mixed.singlepart(
                Attachment::new(att.filename.clone()).body(att.bytes.clone(), ct),
            );
        }
        builder.multipart(mixed).map_err(|e| e.to_string())?
    };

    Ok(message)
}

/// Build a TLS-enforced SMTP transport for the given host/port.
fn build_transport(host: &str, port: u16, creds: Credentials) -> Result<SmtpTransport, String> {
    let builder = match smtp_tls_mode(port) {
        SmtpSecurity::ImplicitTls => {
            SmtpTransport::relay(host).map_err(|e| format!("smtp_tls_setup_failed:{e}"))?
        }
        SmtpSecurity::StartTls => {
            SmtpTransport::starttls_relay(host).map_err(|e| format!("smtp_starttls_setup_failed:{e}"))?
        }
    };
    Ok(builder.port(port).credentials(creds).build())
}

/// Send an already-built message over the account's TLS transport.
pub(super) fn send_prepared(config: &EmailConfig, message: &Message) -> Result<(), String> {
    let creds = Credentials::new(config.email.clone(), config.password.clone());
    let transport = build_transport(config.smtp_host(), config.smtp_port(), creds)?;
    transport
        .send(message)
        .map(|_| ())
        .map_err(|e| format!("smtp_send_failed:{e}"))
}

/// Legacy one-shot plaintext-body send (the old UI's path) — routed through the
/// same TLS transport + builder so nothing sends in the clear anymore.
pub(super) fn send_message(
    config: &EmailConfig,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<bool, String> {
    let spec = MailSendSpec {
        from_name: None,
        from_addr: config.email.clone(),
        to: vec![to.to_string()],
        cc: Vec::new(),
        bcc: Vec::new(),
        subject: subject.to_string(),
        text_body: body.to_string(),
        html_body: None,
        message_id: generate_message_id(&config.email),
        in_reply_to: None,
        references: Vec::new(),
        attachments: Vec::new(),
    };
    let message = build_message(&spec)?;
    send_prepared(config, &message)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tls_mode_is_never_plaintext() {
        assert_eq!(smtp_tls_mode(465), SmtpSecurity::ImplicitTls);
        assert_eq!(smtp_tls_mode(587), SmtpSecurity::StartTls);
        assert_eq!(smtp_tls_mode(25), SmtpSecurity::StartTls);
        assert_eq!(smtp_tls_mode(2525), SmtpSecurity::StartTls);
    }

    fn sample_spec() -> MailSendSpec {
        MailSendSpec {
            from_name: Some("Me".into()),
            from_addr: "me@example.com".into(),
            to: vec!["a@example.com".into(), "b@example.com".into()],
            cc: vec!["c@example.com".into()],
            bcc: vec!["secret@example.com".into()],
            subject: "Hi there".into(),
            text_body: "plain body".into(),
            html_body: Some("<p>html body</p>".into()),
            message_id: "<generated@example.com>".into(),
            in_reply_to: Some("<parent@example.com>".into()),
            references: vec!["<root@example.com>".into(), "parent@example.com".into()],
            attachments: vec![MailAttachment {
                filename: "doc.txt".into(),
                mime: "text/plain".into(),
                bytes: b"file contents".to_vec(),
            }],
        }
    }

    fn formatted(spec: &MailSendSpec) -> String {
        let msg = build_message(spec).expect("build_message");
        String::from_utf8_lossy(&msg.formatted()).into_owned()
    }

    #[test]
    fn reply_headers_are_present_and_bracketed() {
        let out = formatted(&sample_spec());
        assert!(out.contains("In-Reply-To: <parent@example.com>"), "{out}");
        // The References chain keeps every id, and the un-bracketed one is wrapped.
        assert!(out.contains("<root@example.com>"), "{out}");
        assert!(out.contains("References:"), "{out}");
        assert!(out.contains("Message-ID: <generated@example.com>"), "{out}");
    }

    #[test]
    fn every_recipient_class_is_kept() {
        let out = formatted(&sample_spec());
        assert!(out.contains("a@example.com"), "{out}");
        assert!(out.contains("b@example.com"), "{out}");
        assert!(out.contains("Cc:"), "{out}");
        assert!(out.contains("c@example.com"), "{out}");
    }

    #[test]
    fn html_plus_attachment_is_mixed_multipart() {
        let out = formatted(&sample_spec());
        let lower = out.to_lowercase();
        assert!(lower.contains("multipart/mixed"), "{out}");
        assert!(lower.contains("multipart/alternative"), "{out}");
        assert!(lower.contains("content-disposition: attachment"), "{out}");
        assert!(out.contains("doc.txt"), "{out}");
    }

    #[test]
    fn text_only_no_attachment_is_singlepart() {
        let mut spec = sample_spec();
        spec.html_body = None;
        spec.attachments = Vec::new();
        let out = formatted(&spec).to_lowercase();
        assert!(!out.contains("multipart/"), "{out}");
        assert!(out.contains("plain body"), "{out}");
    }

    #[test]
    fn missing_recipients_is_rejected() {
        let mut spec = sample_spec();
        spec.to = Vec::new();
        assert!(build_message(&spec).is_err());
    }

    #[test]
    fn blank_reply_ids_are_skipped_not_bracketed() {
        let mut spec = sample_spec();
        spec.in_reply_to = Some("   ".into());
        spec.references = vec!["".into(), "  ".into()];
        let out = formatted(&spec);
        assert!(!out.contains("<>"), "blank ids must not emit a `<>` token: {out}");
        assert!(!out.contains("In-Reply-To:"), "blank in_reply_to omitted: {out}");
        assert!(!out.contains("References:"), "blank references omitted: {out}");
    }

    #[test]
    fn generated_message_id_uses_from_domain_and_is_bracketed() {
        let id = generate_message_id("someone@moduo.app");
        assert!(id.starts_with('<') && id.ends_with('>'), "{id}");
        assert!(id.contains("@moduo.app"), "{id}");
        // A from address without a domain still yields a valid id.
        let fallback = generate_message_id("broken");
        assert!(fallback.contains("@moduo.local"), "{fallback}");
    }
}
