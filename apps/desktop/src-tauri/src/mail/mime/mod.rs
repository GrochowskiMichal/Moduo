//! MIME parsing for the new engine (MR-4, decision 8): mail-parser (Stalwart)
//! replaces mailparse. [`parse`] never panics: malformed MIME, unknown
//! charsets and broken HTML come back as best-effort text (AC16).

pub mod quote;

#[cfg(test)]
mod tests;

use mail_parser::{MessageParser, MimeHeaders, PartType};

/// Cap on the raw-source view so a 25 MB message can't freeze the reader.
pub const ORIGINAL_MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedAttachment {
    pub filename: String,
    pub mime: String,
    pub content_id: Option<String>,
    pub is_inline: bool,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedMail {
    /// The real HTML part, if the message has one (never synthesized from text).
    pub html: Option<String>,
    /// Plain text: the text part, or the HTML converted to text. Feeds FTS.
    pub text: Option<String>,
    /// Byte offset into `html` (when present, else `text`) where quoted
    /// history or a signature starts; the reader collapses from there.
    pub quote_offset: Option<i64>,
    /// 1×1 images and known tracker hosts in the HTML (a hint; the webview
    /// sanitizer is the authority, decision 9).
    pub tracker_count: i64,
    pub attachments: Vec<ParsedAttachment>,
    /// Raw `text/calendar` parts (see `mail::invite`).
    pub invites: Vec<String>,
    /// True when the parser gave up and the text is the raw body, lossily decoded.
    pub fallback: bool,
}

/// Parses a raw RFC 5322 message (whole or truncated). Never panics.
pub fn parse(raw: &[u8]) -> ParsedMail {
    let parsed = std::panic::catch_unwind(|| parse_inner(raw)).ok().flatten();
    parsed.unwrap_or_else(|| fallback(raw))
}

fn parse_inner(raw: &[u8]) -> Option<ParsedMail> {
    let msg = MessageParser::default().parse(raw)?;
    let html = msg
        .html_bodies()
        .find(|p| matches!(p.body, PartType::Html(_)))
        .and_then(|p| p.text_contents())
        .map(str::to_string);
    let text = msg
        .text_bodies()
        .find(|p| matches!(p.body, PartType::Text(_)))
        .and_then(|p| p.text_contents())
        .map(str::to_string)
        .or_else(|| msg.body_text(0).map(|c| c.into_owned()))
        .filter(|t| !t.trim().is_empty());

    let mut invites = Vec::new();
    for part in msg.parts.iter() {
        let is_cal = part.content_type().is_some_and(|ct| {
            ct.ctype().eq_ignore_ascii_case("text")
                && ct
                    .subtype()
                    .is_some_and(|s| s.eq_ignore_ascii_case("calendar"))
        }) || part
            .attachment_name()
            .is_some_and(|n| n.to_ascii_lowercase().ends_with(".ics"));
        if is_cal {
            let body = match &part.body {
                PartType::Text(t) | PartType::Html(t) => t.to_string(),
                PartType::Binary(b) | PartType::InlineBinary(b) => {
                    String::from_utf8_lossy(b).into_owned()
                }
                _ => continue,
            };
            if body.contains("BEGIN:VCALENDAR") {
                invites.push(body);
            }
        }
    }

    let attachments = msg
        .attachments()
        .filter_map(|p| {
            let bytes = match &p.body {
                PartType::Binary(b) | PartType::InlineBinary(b) => b.to_vec(),
                PartType::Text(t) | PartType::Html(t) => t.as_bytes().to_vec(),
                PartType::Message(m) => m.raw_message().to_vec(),
                PartType::Multipart(_) => return None,
            };
            let mime = p
                .content_type()
                .map(|ct| match ct.subtype() {
                    Some(s) => format!("{}/{}", ct.ctype(), s),
                    None => ct.ctype().to_string(),
                })
                .unwrap_or_else(|| "application/octet-stream".into())
                .to_ascii_lowercase();
            let content_id = p
                .content_id()
                .map(|c| c.trim_matches(|ch| ch == '<' || ch == '>').to_string());
            let is_inline = matches!(p.body, PartType::InlineBinary(_))
                || p.content_disposition().is_some_and(|d| d.is_inline());
            let filename = p
                .attachment_name()
                .map(str::to_string)
                .unwrap_or_else(|| default_name(&mime));
            Some(ParsedAttachment {
                filename,
                mime,
                content_id,
                is_inline,
                bytes,
            })
        })
        .collect();

    let quote_offset = match (&html, &text) {
        (Some(h), _) => quote::html_quote_offset(h),
        (None, Some(t)) => quote::text_quote_offset(t),
        _ => None,
    }
    .map(|o| o as i64);
    let tracker_count = html.as_deref().map_or(0, count_trackers);
    Some(ParsedMail {
        html,
        text,
        quote_offset,
        tracker_count,
        attachments,
        invites,
        fallback: false,
    })
}

fn default_name(mime: &str) -> String {
    let ext = mime.rsplit('/').next().unwrap_or("bin");
    format!("attachment.{ext}")
}

/// Best effort: everything after the first blank line, decoded lossily.
fn fallback(raw: &[u8]) -> ParsedMail {
    let s = String::from_utf8_lossy(raw);
    let body = s
        .find("\r\n\r\n")
        .map(|i| &s[i + 4..])
        .or_else(|| s.find("\n\n").map(|i| &s[i + 2..]))
        .unwrap_or(&s);
    let text = body.trim();
    ParsedMail {
        text: (!text.is_empty()).then(|| text.to_string()),
        quote_offset: quote::text_quote_offset(text).map(|o| o as i64),
        fallback: true,
        ..Default::default()
    }
}

/// The raw source for "Show original": lossy UTF-8, capped.
pub fn original_text(raw: &[u8]) -> String {
    let cut = raw.len().min(ORIGINAL_MAX_BYTES);
    let mut s = String::from_utf8_lossy(&raw[..cut]).into_owned();
    if raw.len() > cut {
        s.push_str("\n\n[… truncated]");
    }
    s
}

const TRACKER_HOSTS: &[&str] = &[
    "mailtrack.io",
    "t.sidekickopen",
    "mandrillapp.com/track",
    "list-manage.com/track",
    "sendgrid.net/wf/open",
    "hubspotemail.net",
    "mailchimp.com/track",
    "pixel.",
    "/open.aspx",
    "/track/open",
];

/// Counts `<img>` tags that are 1×1 or point at a known tracker host.
pub fn count_trackers(html: &str) -> i64 {
    let lower = html.to_ascii_lowercase();
    let mut n = 0;
    let mut rest = lower.as_str();
    while let Some(i) = rest.find("<img") {
        let tag_end = rest[i..].find('>').map_or(rest.len(), |e| i + e);
        let tag = &rest[i..tag_end];
        let one = |attr: &str| {
            tag.contains(&format!("{attr}=\"1\""))
                || tag.contains(&format!("{attr}='1'"))
                || tag.contains(&format!("{attr}=1 "))
                || tag.contains(&format!("{attr}:1px"))
                || tag.contains(&format!("{attr}: 1px"))
        };
        if (one("width") && one("height")) || TRACKER_HOSTS.iter().any(|h| tag.contains(h)) {
            n += 1;
        }
        rest = &rest[tag_end.min(rest.len())..];
        if rest.is_empty() {
            break;
        }
    }
    n
}
