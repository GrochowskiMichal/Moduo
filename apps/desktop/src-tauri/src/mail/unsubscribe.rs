//! Newsletter unsubscribe (MR-10, AC19; B17). Reads `List-Unsubscribe` and
//! `List-Unsubscribe-Post` into a plan: RFC 8058 one-click POST when offered
//! (an https URL plus `List-Unsubscribe=One-Click`), otherwise a mailto (sent
//! for the user after a confirm), otherwise the web page. The reader names the
//! method it fell back to.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UnsubscribeMethod {
    /// RFC 8058: POST `List-Unsubscribe=One-Click` to this https URL.
    OneClick { url: String },
    Mailto { to: String, subject: Option<String>, body: Option<String> },
    Web { url: String },
}

/// The URIs of a `List-Unsubscribe` header: `<a>, <b>` (RFC 2369).
fn uris(header: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = header;
    while let Some(start) = rest.find('<') {
        let Some(end) = rest[start + 1..].find('>') else { break };
        let uri = rest[start + 1..start + 1 + end].trim();
        let uri: String = uri.chars().filter(|c| !c.is_whitespace()).collect();
        if !uri.is_empty() {
            out.push(uri);
        }
        rest = &rest[start + 1 + end + 1..];
    }
    out
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        // Byte-level hex: never slice the &str (a multibyte char after '%'
        // would panic), and `i + 2 < len` accepts a trailing %XX.
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex_val(b[i + 1]), hex_val(b[i + 2])) {
                out.push(h << 4 | l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_mailto(uri: &str) -> Option<UnsubscribeMethod> {
    let rest = uri.get(7..)?; // after "mailto:"
    let (to, query) = rest.split_once('?').unwrap_or((rest, ""));
    let to = pct_decode(to);
    if !to.contains('@') || to.contains(['\r', '\n', ',']) {
        return None;
    }
    let mut subject = None;
    let mut body = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k.to_ascii_lowercase().as_str() {
            "subject" => subject = Some(pct_decode(v)),
            "body" => body = Some(pct_decode(v)),
            _ => {}
        }
    }
    Some(UnsubscribeMethod::Mailto { to, subject, body })
}

fn is_https(uri: &str) -> bool {
    url::Url::parse(uri).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some())
}

fn is_web(uri: &str) -> bool {
    url::Url::parse(uri)
        .is_ok_and(|u| matches!(u.scheme(), "https" | "http") && u.host_str().is_some())
}

/// Every usable method in the order the reader tries them: one-click, mailto, web.
pub fn plan(list_unsubscribe: Option<&str>, list_unsubscribe_post: Option<&str>) -> Vec<UnsubscribeMethod> {
    let Some(header) = list_unsubscribe else { return Vec::new() };
    let all = uris(header);
    let one_click_offered = list_unsubscribe_post.is_some_and(|p| {
        p.split(';')
            .any(|kv| kv.trim().eq_ignore_ascii_case("List-Unsubscribe=One-Click"))
    });
    let mut out = Vec::new();
    if one_click_offered {
        if let Some(u) = all.iter().find(|u| is_https(u)) {
            out.push(UnsubscribeMethod::OneClick { url: u.clone() });
        }
    }
    for u in &all {
        if u.len() >= 7 && u[..7].eq_ignore_ascii_case("mailto:") {
            if let Some(m) = parse_mailto(u) {
                out.push(m);
                break;
            }
        }
    }
    if let Some(u) = all.iter().find(|u| is_web(u)) {
        out.push(UnsubscribeMethod::Web { url: u.clone() });
    }
    out
}

/// The RFC 8058 §3.1 request: a POST with exactly this form body, no cookies
/// and no redirects followed into a different action.
pub const ONE_CLICK_BODY: &str = "List-Unsubscribe=One-Click";

/// Sends the one-click POST. A non-2xx answer is an error so the caller falls
/// back to the next method.
pub async fn post_one_click(client: &reqwest::Client, url: &str) -> Result<(), String> {
    crate::mail::safe_http::check_url(url)?;
    post_form(client, url).await
}

/// The POST itself. A 3xx is a failure: the client follows no redirects
/// (`safe_http`), so a redirect never turns into a second request.
async fn post_form(client: &reqwest::Client, url: &str) -> Result<(), String> {
    let res = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(ONE_CLICK_BODY)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(format!("unsubscribe server answered {}", res.status()))
    }
}

/// The fixed text of every unsubscribe email; the header's own subject and
/// body are never used (a sender could put anything there).
pub const MAILTO_TEXT: &str = "unsubscribe";

fn domain_of(addr: &str) -> Option<String> {
    let d = addr.rsplit_once('@')?.1.trim().trim_end_matches('.');
    (!d.is_empty()).then(|| d.to_ascii_lowercase())
}

/// The domain inside a `List-Id: Name <list.example.com>` header.
fn list_id_domain(list_id: &str) -> Option<String> {
    let inner = match (list_id.rfind('<'), list_id.rfind('>')) {
        (Some(a), Some(b)) if b > a => &list_id[a + 1..b],
        _ => list_id,
    };
    let d = inner.trim().trim_end_matches('.').to_ascii_lowercase();
    (!d.is_empty() && d.contains('.')).then_some(d)
}

/// The last two labels: a coarse organizational domain (`news.shop.com` and
/// `bounce.shop.com` both give `shop.com`).
fn base_domain(d: &str) -> String {
    let labels: Vec<&str> = d.split('.').collect();
    let n = labels.len();
    // `shop.co.uk`: a short second-level label under a ccTLD takes three labels.
    let keep = if n >= 3 && labels[n - 1].len() == 2 && labels[n - 2].len() <= 3 {
        3
    } else {
        2
    };
    labels[n.saturating_sub(keep)..].join(".")
}

fn related(a: &str, b: &str) -> bool {
    a == b
        || a.ends_with(&format!(".{b}"))
        || b.ends_with(&format!(".{a}"))
        || base_domain(a) == base_domain(b)
}

/// A mailto unsubscribe goes only to the sender's own domain or the list's
/// (List-Id), so a message can't use it to send mail to a third party.
pub fn mailto_allowed(to: &str, sender: &str, list_id: Option<&str>) -> bool {
    if to.contains(',') || to.contains(';') {
        return false;
    }
    let Some(rd) = domain_of(to) else {
        return false;
    };
    domain_of(sender).is_some_and(|sd| related(&rd, &sd))
        || list_id
            .and_then(list_id_domain)
            .is_some_and(|ld| related(&rd, &ld))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc8058_post() {
        let p = plan(
            Some("<mailto:u@list.test?subject=unsub>, <https://list.test/u/abc>"),
            Some("List-Unsubscribe=One-Click"),
        );
        assert_eq!(p[0], UnsubscribeMethod::OneClick { url: "https://list.test/u/abc".into() });
        assert_eq!(ONE_CLICK_BODY, "List-Unsubscribe=One-Click");
        // No Post header: no one-click even with an https URL.
        let p = plan(Some("<https://list.test/u/abc>"), None);
        assert_eq!(p, vec![UnsubscribeMethod::Web { url: "https://list.test/u/abc".into() }]);
        // http is never one-click.
        let p = plan(Some("<http://list.test/u>"), Some("List-Unsubscribe=One-Click"));
        assert!(matches!(p[0], UnsubscribeMethod::Web { .. }));
    }

    #[test]
    fn fallback_order() {
        let p = plan(
            Some("<https://list.test/u/abc>,\r\n <mailto:u@list.test?subject=Un%20sub&body=bye>"),
            Some("List-Unsubscribe=One-Click"),
        );
        assert_eq!(p.len(), 3);
        assert!(matches!(p[0], UnsubscribeMethod::OneClick { .. }));
        assert_eq!(
            p[1],
            UnsubscribeMethod::Mailto {
                to: "u@list.test".into(),
                subject: Some("Un sub".into()),
                body: Some("bye".into())
            }
        );
        assert!(matches!(p[2], UnsubscribeMethod::Web { .. }));
        assert!(plan(None, None).is_empty());
        assert!(plan(Some("garbage"), None).is_empty());
        assert!(plan(Some("<javascript:alert(1)>"), None).is_empty());
    }

    #[test]
    fn pct_decode_multibyte_and_trailing() {
        assert_eq!(pct_decode("a%20b%21"), "a b!");
        assert_eq!(pct_decode("%41"), "A");
        assert_eq!(pct_decode("x%4"), "x%4");
        assert_eq!(pct_decode("x%"), "x%");
        assert_eq!(pct_decode("%\u{e9}a"), "%\u{e9}a");
        assert_eq!(pct_decode("%a\u{e9}"), "%a\u{e9}");
        assert_eq!(pct_decode("%C3%A9 \u{1f600}"), "\u{e9} \u{1f600}");
        assert_eq!(pct_decode("%zz"), "%zz");
        assert_eq!(pct_decode("%+1"), "%+1");
    }

    #[tokio::test]
    async fn one_click_refuses_http() {
        let c = reqwest::Client::new();
        assert!(post_one_click(&c, "http://x.test/u").await.is_err());
        assert!(post_one_click(&c, "https://127.0.0.1/u").await.is_err());
    }

    #[tokio::test]
    async fn one_click_does_not_follow_a_redirect() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let h = hits.clone();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = l.accept().await {
                h.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf).await;
                let _ = s
                    .write_all(
                        format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:{port}/b\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes(),
                    )
                    .await;
            }
        });
        let c = crate::mail::safe_http::base_builder().build().unwrap();
        let r = post_form(&c, &format!("http://127.0.0.1:{port}/a")).await;
        assert!(r.unwrap_err().contains("307"));
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn mailto_recipient_must_match_sender_or_list() {
        assert!(mailto_allowed(
            "unsub@news.shop.com",
            "hello@shop.com",
            None
        ));
        assert!(mailto_allowed("u@shop.com", "a@mail.shop.com", None));
        assert!(mailto_allowed(
            "leave@lists.org.test",
            "a@x.test",
            Some("Team <team.lists.org.test>")
        ));
        assert!(!mailto_allowed("victim@other.com", "hello@shop.com", None));
        assert!(!mailto_allowed(
            "victim@other.com",
            "hello@shop.com",
            Some("<list.shop.com>")
        ));
        assert!(!mailto_allowed(
            "a@shop.com,victim@other.com",
            "hello@shop.com",
            None
        ));
        assert!(!mailto_allowed("x@evil.co.uk", "a@shop.co.uk", None));
        assert!(!mailto_allowed("nodomain", "hello@shop.com", None));
    }
}
