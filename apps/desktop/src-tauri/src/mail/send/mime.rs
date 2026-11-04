//! Builds the outgoing RFC 5322 message from a [`DraftDoc`] with lettre. Pure
//! apart from reading attachment files. Bcc is in the envelope only: lettre
//! leaves the header out of the formatted message.

use super::DraftDoc;
use lettre::message::header::{self, ContentType};
use lettre::message::{Attachment, Mailbox, Mailboxes, Message, MultiPart, SinglePart};
use lettre::Address;

pub fn ensure_bracketed(id: &str) -> String {
    let t = id.trim();
    if t.starts_with('<') && t.ends_with('>') {
        t.to_string()
    } else {
        format!("<{t}>")
    }
}

/// `<uuid@from-domain>`, generated once per draft so every server copy and the
/// sent message share it (Sent matching, follow-ups, draft dedup).
pub fn generate_message_id(from_addr: &str) -> String {
    let domain = from_addr
        .rsplit_once('@')
        .map(|(_, d)| d.trim())
        .filter(|d| !d.is_empty())
        .unwrap_or("moduo.local");
    format!("<{}@{}>", uuid::Uuid::new_v4(), domain)
}

fn mailbox(raw: &str) -> Result<Mailbox, String> {
    raw.trim()
        .parse::<Mailbox>()
        .map_err(|e| format!("invalid_address:{raw}:{e}"))
}

fn mailboxes(list: &[String]) -> Result<Mailboxes, String> {
    let mut b = Mailboxes::new();
    for a in list.iter().filter(|a| !a.trim().is_empty()) {
        b.push(mailbox(a)?);
    }
    Ok(b)
}

/// The bare addresses the SMTP envelope goes to (to + cc + bcc).
pub fn envelope_recipients(d: &DraftDoc) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for a in d.to.iter().chain(&d.cc).chain(&d.bcc).filter(|a| !a.trim().is_empty()) {
        let e = mailbox(a)?.email.to_string();
        if !out.iter().any(|x: &String| x.eq_ignore_ascii_case(&e)) {
            out.push(e);
        }
    }
    Ok(out)
}

/// `for_send = false` builds the draft copy: recipients optional.
/// Attachments are read from the user store's staging dir (`store_root`).
pub fn build(d: &DraftDoc, for_send: bool, store_root: &std::path::Path) -> Result<Vec<u8>, String> {
    let has_rcpt = d.to.iter().chain(&d.cc).chain(&d.bcc).any(|a| !a.trim().is_empty());
    if for_send && !has_rcpt {
        return Err("missing_recipients".into());
    }
    let from = match d.from_name.as_deref().filter(|n| !n.trim().is_empty()) {
        Some(n) => Mailbox::new(
            Some(n.to_string()),
            d.from_addr
                .trim()
                .parse::<Address>()
                .map_err(|e| format!("invalid_from:{}:{e}", d.from_addr))?,
        ),
        None => mailbox(&d.from_addr)?,
    };
    let mut b = Message::builder()
        .from(from)
        .subject(d.subject.clone())
        .message_id(Some(ensure_bracketed(&d.message_id)));
    let to = mailboxes(&d.to)?;
    if to.iter().next().is_some() {
        b = b.header(header::To::from(to));
    }
    let cc = mailboxes(&d.cc)?;
    if cc.iter().next().is_some() {
        b = b.header(header::Cc::from(cc));
    }
    let bcc = mailboxes(&d.bcc)?;
    if bcc.iter().next().is_some() {
        b = b.header(header::Bcc::from(bcc));
    }
    if let Some(irt) = d.in_reply_to.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        b = b.in_reply_to(ensure_bracketed(irt));
    }
    let refs: Vec<String> = d
        .references
        .iter()
        .map(|r| r.trim())
        .filter(|r| !r.is_empty())
        .map(ensure_bracketed)
        .collect();
    if !refs.is_empty() {
        b = b.references(refs.join(" "));
    }

    let text = d.text.clone();
    let body: MultiPart = match (&d.html, &d.calendar_reply) {
        (_, Some(ics)) => MultiPart::alternative().singlepart(SinglePart::plain(text)).singlepart(
            SinglePart::builder()
                .header(
                    ContentType::parse("text/calendar; method=REPLY; charset=UTF-8")
                        .map_err(|e| e.to_string())?,
                )
                .body(ics.clone()),
        ),
        (Some(html), None) => MultiPart::alternative_plain_html(text, html.clone()),
        (None, None) if d.attachments.is_empty() => {
            return b
                .singlepart(SinglePart::plain(text))
                .map(|m| m.formatted())
                .map_err(|e| e.to_string());
        }
        (None, None) => MultiPart::mixed().singlepart(SinglePart::plain(text)),
    };
    let msg = if d.attachments.is_empty() {
        b.multipart(body)
    } else {
        let mut mixed = if body.headers().get_raw("Content-Type").is_some_and(|c| c.starts_with("multipart/mixed")) {
            body
        } else {
            MultiPart::mixed().multipart(body)
        };
        for a in &d.attachments {
            let bytes = super::staging::read(store_root, &a.id).map_err(|e| format!("attachment_unreadable:{}:{e}", a.filename))?;
            let ct = ContentType::parse(&a.content_type)
                .or_else(|_| ContentType::parse("application/octet-stream"))
                .map_err(|e| e.to_string())?;
            mixed = mixed.singlepart(Attachment::new(a.filename.clone()).body(bytes, ct));
        }
        b.multipart(mixed)
    };
    msg.map(|m| m.formatted()).map_err(|e| e.to_string())
}
