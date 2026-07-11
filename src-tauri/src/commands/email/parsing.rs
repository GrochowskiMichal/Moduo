pub(super) fn to_millis_from_date(raw: &str) -> i64 {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(raw) {
        return dt.timestamp_millis();
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(raw) {
        return dt.timestamp_millis();
    }
    chrono::Utc::now().timestamp_millis()
}

fn normalize_subject_for_thread(subject: &str) -> String {
    let lowered = subject.trim().to_lowercase();
    let mut stripped = lowered.as_str();
    for prefix in ["re:", "fwd:", "fw:"] {
        if stripped.starts_with(prefix) {
            stripped = stripped.trim_start_matches(prefix).trim_start();
        }
    }
    if stripped.is_empty() {
        "(no subject)".to_string()
    } else {
        stripped.to_string()
    }
}

pub(super) fn decode_header_value_bytes(raw: &[u8]) -> String {
    let mut header = Vec::with_capacity(raw.len() + 8);
    header.extend_from_slice(b"X: ");
    header.extend_from_slice(raw);
    header.extend_from_slice(b"\r\n");
    if let Ok((parsed, _)) = mailparse::parse_header(&header) {
        let decoded = parsed.get_value().trim().to_string();
        if !decoded.is_empty() {
            return decoded;
        }
    }
    String::from_utf8_lossy(raw).trim().to_string()
}

pub(super) fn decode_maybe_mime_header(raw: &str) -> String {
    if raw.contains("=?") && raw.contains("?=") {
        let decoded = decode_header_value_bytes(raw.as_bytes());
        if !decoded.is_empty() {
            return decoded;
        }
    }
    raw.to_string()
}

fn thread_key(bytes: &[u8]) -> String {
    format!(
        "thread:{}",
        uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, bytes)
    )
}

/// Derive a stable thread id for a message (EM-4). Keys on the **References root**
/// (the oldest ancestor's Message-ID) so an A←B←C chain collapses to ONE thread
/// even when an intermediate message isn't in the mailbox — the old code keyed on
/// `In-Reply-To` (the immediate parent), which split every 3+ message chain. Falls
/// back to In-Reply-To → own Message-ID → normalized subject.
pub(super) fn thread_id_from(
    subject: &str,
    references: &[String],
    in_reply_to: Option<&str>,
    message_id: Option<&str>,
) -> String {
    if let Some(root) = references
        .iter()
        .map(|value| value.trim())
        .find(|value| !value.is_empty())
    {
        return thread_key(root.as_bytes());
    }
    if let Some(reply) = in_reply_to.map(str::trim).filter(|v| !v.is_empty()) {
        return thread_key(reply.as_bytes());
    }
    if let Some(msg_id) = message_id.map(str::trim).filter(|v| !v.is_empty()) {
        return thread_key(msg_id.as_bytes());
    }
    thread_key(normalize_subject_for_thread(subject).as_bytes())
}

/// Extract every `<...>` Message-ID token (brackets kept, so they match the
/// ENVELOPE-derived `message_id`) from a header value, in order.
fn extract_angle_ids(value: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find('<') {
        let Some(end_rel) = rest[start..].find('>') else {
            break;
        };
        let token = rest[start..start + end_rel + 1].trim();
        if token.len() > 2 {
            ids.push(token.to_string());
        }
        rest = &rest[start + end_rel + 1..];
    }
    ids
}

/// Parse the `References` header (root-first) from a fetched HEADER.FIELDS block,
/// unfolding continuation lines. Case-insensitive; returns `<id>` tokens in order.
pub(super) fn parse_references(header_block: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(header_block).replace("\r\n", "\n");
    let mut value = String::new();
    let mut in_refs = false;
    for line in text.split('\n') {
        if in_refs {
            // Folded continuation lines start with whitespace.
            if line.starts_with(' ') || line.starts_with('\t') {
                value.push(' ');
                value.push_str(line.trim());
                continue;
            }
            break;
        }
        // Byte-compare the header name so a malformed non-ASCII line can't panic on
        // a mid-char `line[..11]` slice. "references:" is 11 ASCII bytes, so after a
        // match, byte 11 is a valid char boundary for the value slice.
        if line
            .as_bytes()
            .get(..11)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"references:"))
        {
            value.push_str(line[11..].trim());
            in_refs = true;
        }
    }
    extract_angle_ids(&value)
}

/// Extract a single non-repeating header's value from a fetched HEADER.FIELDS
/// block, unfolding continuation lines. `name_lower` is the lowercase header name
/// WITHOUT the colon (e.g. `"precedence"`). Case-insensitive; returns the trimmed
/// value, or `None` when the header is absent or empty. Drives the smart-inbox
/// signals (List-Unsubscribe / Precedence / Auto-Submitted, EM-10).
pub(super) fn parse_header_value(header_block: &[u8], name_lower: &str) -> Option<String> {
    let text = String::from_utf8_lossy(header_block).replace("\r\n", "\n");
    let prefix_len = name_lower.len() + 1; // name + ':'
    let mut value = String::new();
    let mut in_header = false;
    for line in text.split('\n') {
        if in_header {
            // Folded continuation lines start with whitespace.
            if line.starts_with(' ') || line.starts_with('\t') {
                value.push(' ');
                value.push_str(line.trim());
                continue;
            }
            break;
        }
        // Byte-compare "name:" so a malformed non-ASCII line can't panic on a
        // mid-char slice (mirrors parse_references). `:` is ASCII, so byte
        // `prefix_len` is a valid char boundary for the value slice.
        let matches_name = line.as_bytes().get(..prefix_len).is_some_and(|prefix| {
            prefix[prefix_len - 1] == b':'
                && prefix[..prefix_len - 1].eq_ignore_ascii_case(name_lower.as_bytes())
        });
        if matches_name {
            value.push_str(line[prefix_len..].trim());
            in_header = true;
        }
    }
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Whether a message is recent enough to store on the initial sync window (EM-4).
/// An unknown/zero timestamp is kept (never dropped for a missing date).
pub(super) fn within_sync_window(timestamp_ms: i64, now_ms: i64, days: i64) -> bool {
    if timestamp_ms <= 0 {
        return true;
    }
    let cutoff = now_ms.saturating_sub(days.saturating_mul(86_400_000));
    timestamp_ms >= cutoff
}

pub(super) fn normalize_body_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}

pub(super) fn normalize_body_html(html: &str) -> String {
    html.replace("\r\n", "\n")
        .replace('\r', "\n")
        .trim()
        .to_string()
}

fn html_to_text(html: &str) -> String {
    let mut output = String::with_capacity(html.len());
    let mut tag = String::new();
    let mut in_tag = false;

    for ch in html.chars() {
        if in_tag {
            if ch == '>' {
                let tag_name = tag
                    .trim_start_matches('/')
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase();
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

pub(super) fn truncate_with_ellipsis(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    input.chars().take(max_chars).collect::<String>() + "..."
}

pub(super) struct ExtractedBody {
    pub text: String,
    pub html: Option<String>,
}

pub(super) fn extract_best_body(parsed: &mailparse::ParsedMail<'_>) -> ExtractedBody {
    let mut text_body: Option<String> = None;
    let mut html_body: Option<String> = None;

    for part in parsed.parts() {
        if matches!(
            part.get_content_disposition().disposition,
            mailparse::DispositionType::Attachment
        ) {
            continue;
        }

        let mime = part.ctype.mimetype.as_str();
        if mime.eq_ignore_ascii_case("text/plain") && text_body.is_none() {
            if let Ok(body) = part.get_body() {
                let clean = normalize_body_text(&body);
                if !clean.is_empty() {
                    text_body = Some(clean);
                }
            }
        } else if mime.eq_ignore_ascii_case("text/html") && html_body.is_none() {
            if let Ok(body) = part.get_body() {
                let clean = normalize_body_html(&body);
                if !clean.is_empty() {
                    html_body = Some(clean);
                }
            }
        }
    }

    if text_body.is_none() {
        text_body = html_body.as_deref().map(html_to_text);
    }
    if text_body.is_none() {
        text_body = parsed
            .get_body()
            .map(|body| normalize_body_text(&body))
            .ok()
            .filter(|body| !body.is_empty());
    }

    ExtractedBody {
        text: text_body.unwrap_or_default(),
        html: html_body,
    }
}

pub(super) fn parse_address(
    mailbox: Option<&[u8]>,
    host: Option<&[u8]>,
    name: Option<&[u8]>,
) -> (String, String) {
    let user = mailbox
        .map(|v| String::from_utf8_lossy(v).trim().to_string())
        .unwrap_or_default();
    let domain = host
        .map(|v| String::from_utf8_lossy(v).trim().to_string())
        .unwrap_or_default();
    let email = if user.is_empty() && domain.is_empty() {
        String::new()
    } else {
        format!("{}@{}", user, domain).trim_matches('@').to_string()
    };
    let display_name = name
        .map(decode_header_value_bytes)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| email.clone());
    (display_name, email)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_header_value_is_case_insensitive_and_unfolds() {
        let block = b"Message-ID: <a@x.com>\r\nPrecedence: bulk\r\nList-Unsubscribe: <https://x/u>,\r\n <mailto:u@x>\r\n";
        assert_eq!(parse_header_value(block, "precedence").as_deref(), Some("bulk"));
        // Continuation lines fold into one value.
        assert_eq!(
            parse_header_value(block, "list-unsubscribe").as_deref(),
            Some("<https://x/u>, <mailto:u@x>")
        );
        // Absent header → None; a name that is a prefix of another doesn't match.
        assert_eq!(parse_header_value(block, "auto-submitted"), None);
        assert_eq!(parse_header_value(block, "list"), None);
    }

    #[test]
    fn a_b_c_chain_threads_together_via_references_root() {
        // A is the root (no references / in-reply-to). B replies to A. C replies to
        // B and carries the full References chain (root-first). All three must key
        // on A's Message-ID — the split-chain bug is fixed.
        let a = thread_id_from("Kickoff", &[], None, Some("<a@x.com>"));
        let b = thread_id_from(
            "Re: Kickoff",
            &["<a@x.com>".to_string()],
            Some("<a@x.com>"),
            Some("<b@x.com>"),
        );
        let c = thread_id_from(
            "Re: Kickoff",
            &["<a@x.com>".to_string(), "<b@x.com>".to_string()],
            Some("<b@x.com>"),
            Some("<c@x.com>"),
        );
        assert_eq!(a, b, "B must thread with A");
        assert_eq!(a, c, "C must thread with A even though B may be missing");
    }

    #[test]
    fn references_root_beats_in_reply_to_parent() {
        // A message whose In-Reply-To is the parent but References is the root must
        // key on the ROOT (this is exactly what split threads before).
        let keyed_on_root = thread_id_from(
            "Re: Deep thread",
            &["<root@x.com>".to_string(), "<mid@x.com>".to_string()],
            Some("<mid@x.com>"),
            Some("<leaf@x.com>"),
        );
        let root_self = thread_id_from("Deep thread", &[], None, Some("<root@x.com>"));
        assert_eq!(keyed_on_root, root_self);
    }

    #[test]
    fn no_headers_falls_back_to_normalized_subject() {
        let a = thread_id_from("Re: Lunch?", &[], None, None);
        let b = thread_id_from("Fwd: lunch?", &[], None, None);
        assert_eq!(a, b, "Re:/Fwd: + case are stripped for the subject fallback");
    }

    #[test]
    fn parse_references_reads_folded_multi_id_header() {
        let header = b"Message-ID: <leaf@x.com>\r\nReferences: <root@x.com>\r\n <mid@x.com>\r\nIn-Reply-To: <mid@x.com>\r\n";
        let refs = parse_references(header);
        assert_eq!(refs, vec!["<root@x.com>", "<mid@x.com>"]);
        // The trimmed-References merge: the root is first, so it drives threading.
        assert_eq!(
            thread_id_from("Re: x", &refs, Some("<mid@x.com>"), Some("<leaf@x.com>")),
            thread_id_from("x", &[], None, Some("<root@x.com>"))
        );
    }

    #[test]
    fn parse_references_absent_is_empty() {
        assert!(parse_references(b"Message-ID: <a@x.com>\r\n").is_empty());
        assert!(parse_references(b"").is_empty());
    }

    #[test]
    fn sync_window_keeps_recent_and_unknown_drops_old() {
        let now = 1_000 * 86_400_000; // day 1000 in ms
        let day = 86_400_000_i64;
        assert!(within_sync_window(now - 10 * day, now, 90));
        assert!(within_sync_window(now - 89 * day, now, 90));
        assert!(!within_sync_window(now - 120 * day, now, 90));
        // Unknown date (0) is kept, never dropped for a missing header.
        assert!(within_sync_window(0, now, 90));
    }
}
