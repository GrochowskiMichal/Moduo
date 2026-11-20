//! Header-time parsing: the raw header block from `BODY.PEEK[HEADER.FIELDS …]`
//! becomes the fields the store, threading and classification need. Malformed
//! headers never fail a sync: missing fields fall back to empty values.

use crate::mail::store::Address;
use mail_parser::{HeaderValue, MessageParser};

/// The header fields fetched for every message (decision 5).
pub const HEADER_FIELDS: &str = "MESSAGE-ID IN-REPLY-TO REFERENCES FROM TO CC SUBJECT DATE \
LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST LIST-ID PRECEDENCE AUTO-SUBMITTED CONTENT-TYPE";

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedHeader {
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub subject: String,
    pub date_ms: Option<i64>,
    pub list_unsubscribe: Option<String>,
    pub list_unsubscribe_post: Option<String>,
    pub list_id: Option<String>,
    pub precedence: Option<String>,
    pub auto_submitted: Option<String>,
    pub is_calendar: bool,
}

fn addrs(a: Option<&mail_parser::Address>) -> Vec<Address> {
    a.map(|a| {
        a.iter()
            .filter_map(|x| {
                let email = x.address()?.trim().to_ascii_lowercase();
                Some(Address {
                    name: x.name().unwrap_or("").trim().to_string(),
                    email,
                })
            })
            .collect()
    })
    .unwrap_or_default()
}

fn ids(v: &HeaderValue) -> Vec<String> {
    match v {
        HeaderValue::Text(t) => vec![t.to_string()],
        HeaderValue::TextList(l) => l.iter().map(|t| t.to_string()).collect(),
        _ => vec![],
    }
}

fn raw(m: &mail_parser::Message, name: &str) -> Option<String> {
    m.header_raw(name.to_string())
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|s| !s.is_empty())
}

/// Message-IDs are compared bare: no angle brackets, trimmed.
pub fn bare_id(s: &str) -> String {
    s.trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .trim()
        .to_string()
}

pub fn parse(raw_headers: &[u8]) -> ParsedHeader {
    let Some(m) = MessageParser::default().parse_headers(raw_headers) else {
        return ParsedHeader::default();
    };
    let is_calendar = match m.header("Content-Type") {
        Some(HeaderValue::ContentType(c)) => {
            c.ctype().eq_ignore_ascii_case("text")
                && c.subtype()
                    .is_some_and(|s| s.eq_ignore_ascii_case("calendar"))
        }
        _ => false,
    };
    ParsedHeader {
        message_id: m.message_id().map(bare_id).filter(|s| !s.is_empty()),
        in_reply_to: ids(m.in_reply_to()).first().map(|s| bare_id(s)),
        references: ids(m.references()).iter().map(|s| bare_id(s)).collect(),
        from: addrs(m.from()).into_iter().next().unwrap_or(Address {
            name: String::new(),
            email: String::new(),
        }),
        to: addrs(m.to()),
        cc: addrs(m.cc()),
        subject: m.subject().unwrap_or("").trim().to_string(),
        date_ms: m.date().map(|d| d.to_timestamp() * 1000),
        list_unsubscribe: raw(&m, "List-Unsubscribe"),
        list_unsubscribe_post: raw(&m, "List-Unsubscribe-Post"),
        list_id: raw(&m, "List-Id"),
        precedence: raw(&m, "Precedence").map(|s| s.to_ascii_lowercase()),
        auto_submitted: raw(&m, "Auto-Submitted").map(|s| s.to_ascii_lowercase()),
        is_calendar,
    }
}

/// Subject without reply/forward prefixes, for the threading fallback.
pub fn normalize_subject(s: &str) -> String {
    let mut t = s.trim();
    loop {
        let lower = t.to_ascii_lowercase();
        let mut cut = None;
        for p in ["re:", "fw:", "fwd:", "aw:", "wg:", "sv:", "vs:", "tr:"] {
            if lower.starts_with(p) {
                cut = Some(p.len());
                break;
            }
        }
        // "Re[2]:" style.
        if cut.is_none() && lower.starts_with("re[") {
            if let Some(i) = lower.find("]:") {
                cut = Some(i + 2);
            }
        }
        match cut {
            Some(n) => t = t[n..].trim_start(),
            None => break,
        }
    }
    t.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fields_and_encoded_words() {
        let h = b"Message-ID: <a1@x.test>\r\nIn-Reply-To: <p@x.test>\r\nReferences: <r@x.test> <p@x.test>\r\n\
From: =?UTF-8?Q?Ann=C3=A9?= <Anne@X.test>\r\nTo: me@y.test, Bob <bob@y.test>\r\nSubject: =?UTF-8?B?SGVsbG8=?=\r\n\
Date: Tue, 3 Nov 2026 10:00:00 +0000\r\nList-Unsubscribe: <https://u.test/x>\r\nPrecedence: Bulk\r\n\r\n";
        let p = parse(h);
        assert_eq!(p.message_id.as_deref(), Some("a1@x.test"));
        assert_eq!(p.in_reply_to.as_deref(), Some("p@x.test"));
        assert_eq!(p.references, vec!["r@x.test", "p@x.test"]);
        assert_eq!(p.from.email, "anne@x.test");
        assert_eq!(p.from.name, "Anné");
        assert_eq!(p.to.len(), 2);
        assert_eq!(p.subject, "Hello");
        assert_eq!(p.date_ms, Some(1_793_700_000_000));
        assert_eq!(p.precedence.as_deref(), Some("bulk"));
        assert!(p.list_unsubscribe.is_some());
    }

    #[test]
    fn garbage_never_panics() {
        for g in [
            &b""[..],
            b"\xff\xfe\x00",
            b"From\r\n\r\n",
            b":::\r\nSubject",
        ] {
            let _ = parse(g);
        }
    }

    #[test]
    fn subject_normalization() {
        assert_eq!(
            normalize_subject("Re: FWD: re[2]:  Lunch   plans"),
            "lunch plans"
        );
        assert_eq!(normalize_subject("Report"), "report");
    }
}
