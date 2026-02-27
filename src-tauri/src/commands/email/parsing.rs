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

pub(super) fn thread_id_from(
    subject: &str,
    in_reply_to: Option<&str>,
    message_id: Option<&str>,
) -> String {
    if let Some(reply) = in_reply_to.filter(|v| !v.trim().is_empty()) {
        return format!(
            "thread:{}",
            uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, reply.as_bytes())
        );
    }
    if let Some(msg_id) = message_id.filter(|v| !v.trim().is_empty()) {
        return format!(
            "thread:{}",
            uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, msg_id.as_bytes())
        );
    }
    let normalized = normalize_subject_for_thread(subject);
    format!(
        "thread:{}",
        uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, normalized.as_bytes())
    )
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

pub(super) fn recipients_for_graph(raw_to: &str) -> Vec<String> {
    raw_to
        .split(',')
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|candidate| {
            let trimmed = candidate.trim();
            if let Some(start) = trimmed.find('<') {
                if let Some(end) = trimmed[start + 1..].find('>') {
                    return trimmed[start + 1..start + 1 + end].trim().to_lowercase();
                }
            }
            trimmed.to_lowercase()
        })
        .filter(|email| email.contains('@'))
        .collect()
}

pub(super) fn extract_domain(email: &str) -> Option<String> {
    let (_, domain) = email.split_once('@')?;
    let normalized = domain.trim().to_lowercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}
