//! `mailto:` URI parsing (RFC 6068; AC24 engine, MR-6). The deep link and the
//! in-app link handler both turn a URI into these fields, and compose opens
//! prefilled with them. Only the safe hfields are honored (to, cc, bcc,
//! subject, body, in-reply-to); anything else (From, Sender, arbitrary headers)
//! is dropped, as RFC 6068 §7 recommends.

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailtoFields {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: Option<String>,
    pub body: Option<String>,
    pub in_reply_to: Option<String>,
}

/// Percent-decodes as UTF-8 (lossy). `+` stays a plus: RFC 6068 is not a form.
fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn addresses(raw: &str, into: &mut Vec<String>) {
    for a in decode(raw).split(',') {
        let a = a.trim();
        if !a.is_empty() && !into.iter().any(|x| x.eq_ignore_ascii_case(a)) {
            into.push(a.to_string());
        }
    }
}

/// Parses a `mailto:` URI. `None` when the scheme isn't `mailto`.
pub fn parse_mailto(uri: &str) -> Option<MailtoFields> {
    let uri = uri.trim();
    let (scheme, rest) = uri.split_once(':')?;
    if !scheme.eq_ignore_ascii_case("mailto") {
        return None;
    }
    // A fragment is not part of a mailto URI.
    let rest = rest.split('#').next().unwrap_or("");
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let mut f = MailtoFields::default();
    addresses(path, &mut f.to);
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let v_dec = || decode(v);
        match decode(k).to_ascii_lowercase().as_str() {
            "to" => addresses(v, &mut f.to),
            "cc" => addresses(v, &mut f.cc),
            "bcc" => addresses(v, &mut f.bcc),
            "subject" => f.subject = Some(v_dec()).filter(|s| !s.is_empty()),
            // RFC 6068 §2: line breaks in body are %0D%0A; normalize to \n.
            "body" => {
                f.body = Some(v_dec().replace("\r\n", "\n")).filter(|s| !s.is_empty())
            }
            "in-reply-to" => f.in_reply_to = Some(v_dec().trim().to_string()).filter(|s| !s.is_empty()),
            _ => {}
        }
    }
    Some(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mailto_rfc6068() {
        let f = parse_mailto(
            "mailto:anna@x.test,%22Bob%22%20%3Cbob@y.test%3E?subject=Hi%20there%20%E2%9C%93&cc=c@z.test&bcc=d@z.test&body=Line%201%0D%0ALine+2&to=e@z.test",
        )
        .unwrap();
        assert_eq!(f.to, vec!["anna@x.test", "\"Bob\" <bob@y.test>", "e@z.test"]);
        assert_eq!(f.cc, vec!["c@z.test"]);
        assert_eq!(f.bcc, vec!["d@z.test"]);
        assert_eq!(f.subject.as_deref(), Some("Hi there \u{2713}"));
        assert_eq!(f.body.as_deref(), Some("Line 1\nLine+2"));
    }

    #[test]
    fn mailto_edge_cases() {
        // Uppercase scheme and keys, no address, unsafe headers dropped.
        let f = parse_mailto("MAILTO:?To=a@x.test&From=evil@x.test&X-Mailer=x&In-Reply-To=%3C1@x%3E")
            .unwrap();
        assert_eq!(f.to, vec!["a@x.test"]);
        assert_eq!(f.in_reply_to.as_deref(), Some("<1@x>"));
        assert!(f.subject.is_none() && f.body.is_none());
        // Bare address, duplicate, a bad escape left alone, a fragment cut.
        let g = parse_mailto("mailto:a@x.test?to=A@x.test&subject=100%&body=x#frag").unwrap();
        assert_eq!(g.to, vec!["a@x.test"]);
        assert_eq!(g.subject.as_deref(), Some("100%"));
        assert_eq!(g.body.as_deref(), Some("x"));
        assert!(parse_mailto("https://x.test").is_none());
        assert!(parse_mailto("nonsense").is_none());
        assert_eq!(parse_mailto("mailto:").unwrap(), MailtoFields::default());
    }
}
