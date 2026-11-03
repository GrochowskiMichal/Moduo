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

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
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
    if !is_https(url) {
        return Err("one-click unsubscribe needs an https URL".into());
    }
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

    #[tokio::test]
    async fn one_click_refuses_http() {
        let c = reqwest::Client::new();
        assert!(post_one_click(&c, "http://x.test/u").await.is_err());
    }
}
