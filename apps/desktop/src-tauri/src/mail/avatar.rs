//! Sender avatars (MR-10, AC31; X17, decision 19). Resolution order:
//! 1. a Moduo contact photo (the app passes it in);
//! 2. the sender's own domain logo: BIMI (`default._bimi.<domain>` TXT, SVG
//!    only), then `https://<domain>/apple-touch-icon.png`, then `/favicon.ico`,
//!    fetched only from that domain, never for a free-mail domain and never
//!    through Gravatar or any third-party logo service;
//! 3. initials.
//! The setting `sender_logos = false` stops step 2 entirely. Fetches are cached
//! 30 days in the store's `avatars` table by the caller.

use serde::Serialize;

pub const CACHE_DAYS: i64 = 30;
/// Logos above this are refused (a BIMI SVG is small by spec).
pub const MAX_LOGO_BYTES: usize = 64 * 1024;

/// Shared mailbox providers: their logo says nothing about the sender.
const FREEMAIL: &[&str] = &[
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com",
    "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com",
    "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.de", "gmx.net",
    "web.de", "mail.com", "zoho.com", "yandex.com", "yandex.ru", "fastmail.com", "hey.com",
    "tutanota.com", "wp.pl", "o2.pl", "onet.pl", "interia.pl", "op.pl", "qq.com", "163.com",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AvatarSource {
    Contact { url: String },
    /// Candidate URLs on the sender's own domain, tried in order.
    Domain { domain: String, bimi_txt: String, urls: Vec<String> },
    Initials { initials: String },
}

pub fn is_freemail(domain: &str) -> bool {
    let d = domain.trim().trim_end_matches('.').to_ascii_lowercase();
    FREEMAIL.iter().any(|f| d == *f)
}

/// The sender's domain, when it's a plain DNS name we may fetch from.
pub fn sender_domain(email: &str) -> Option<String> {
    let (_, d) = email.trim().rsplit_once('@')?;
    let d = d.trim_end_matches('>').trim_end_matches('.').to_ascii_lowercase();
    let ok = d.contains('.')
        && d.len() <= 253
        && d.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
        // never an IP literal or a bare numeric host
        && !d.split('.').all(|l| l.chars().all(|c| c.is_ascii_digit()));
    ok.then_some(d)
}

pub fn initials(name: Option<&str>, email: &str) -> String {
    let src = name.map(str::trim).filter(|n| !n.is_empty()).unwrap_or(email);
    let words: Vec<&str> = src
        .split(|c: char| c.is_whitespace() || c == '.' || c == '@' || c == '_')
        .filter(|w| w.chars().next().is_some_and(char::is_alphanumeric))
        .collect();
    let mut out: String = words.iter().take(2).filter_map(|w| w.chars().next()).collect();
    if out.is_empty() {
        out.push('?');
    }
    out.to_uppercase()
}

/// The resolution plan for one sender. Every URL in `Domain` is on the
/// sender's own domain, which `never_third_party` pins.
pub fn resolve(
    email: &str,
    name: Option<&str>,
    contact_photo: Option<&str>,
    fetch_enabled: bool,
) -> Vec<AvatarSource> {
    let mut out = Vec::new();
    if let Some(url) = contact_photo.filter(|u| !u.trim().is_empty()) {
        out.push(AvatarSource::Contact { url: url.to_string() });
    }
    if fetch_enabled {
        if let Some(domain) = sender_domain(email).filter(|d| !is_freemail(d)) {
            out.push(AvatarSource::Domain {
                bimi_txt: format!("default._bimi.{domain}"),
                urls: vec![
                    format!("https://{domain}/apple-touch-icon.png"),
                    format!("https://{domain}/favicon.ico"),
                ],
                domain,
            });
        }
    }
    out.push(AvatarSource::Initials { initials: initials(name, email) });
    out
}

/// The `l=` SVG location of a BIMI TXT record (`v=BIMI1; l=https://…svg`),
/// only when it is https and served from the sender's domain or a subdomain.
pub fn bimi_logo_url(txt: &str, domain: &str) -> Option<String> {
    let mut v1 = false;
    let mut loc = None;
    for part in txt.split(';').filter(|p| !p.trim().is_empty()) {
        let (k, v) = part.split_once('=')?;
        match k.trim().to_ascii_lowercase().as_str() {
            "v" => v1 = v.trim().eq_ignore_ascii_case("BIMI1"),
            "l" => loc = Some(v.trim().to_string()),
            _ => {}
        }
    }
    let loc = loc.filter(|l| !l.is_empty())?;
    let u = url::Url::parse(&loc).ok()?;
    let host = u.host_str()?.to_ascii_lowercase();
    let own = host == domain || host.ends_with(&format!(".{domain}"));
    (v1 && u.scheme() == "https" && own && u.path().to_ascii_lowercase().ends_with(".svg"))
        .then_some(loc)
}

/// A fetched logo is kept only when small and an image.
pub fn accept_logo(content_type: &str, bytes: usize) -> bool {
    let ct = content_type.to_ascii_lowercase();
    bytes > 0
        && bytes <= MAX_LOGO_BYTES
        && (ct.starts_with("image/png")
            || ct.starts_with("image/svg+xml")
            || ct.starts_with("image/x-icon")
            || ct.starts_with("image/vnd.microsoft.icon"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_and_freemail_skip() {
        let r = resolve("anna@acme.io", Some("Anna Kowal"), Some("https://cdn/c.png"), true);
        assert!(matches!(r[0], AvatarSource::Contact { .. }));
        assert!(matches!(r[1], AvatarSource::Domain { .. }));
        assert_eq!(r[2], AvatarSource::Initials { initials: "AK".into() });

        let r = resolve("anna@Gmail.com", None, None, true);
        assert_eq!(r, vec![AvatarSource::Initials { initials: "AG".into() }]);
        let r = resolve("x@wp.pl", Some("Xavier"), None, true);
        assert_eq!(r, vec![AvatarSource::Initials { initials: "X".into() }]);

        // setting off: no fetch at all, contact photo still wins
        let r = resolve("anna@acme.io", None, Some("p"), false);
        assert_eq!(r.len(), 2);
        assert!(!r.iter().any(|s| matches!(s, AvatarSource::Domain { .. })));
        // IP literals and junk never fetch
        assert_eq!(resolve("a@127.0.0.1", None, None, true).len(), 1);
        assert_eq!(resolve("a@[::1]", None, None, true).len(), 1);
        assert_eq!(resolve("nobody", None, None, true).len(), 1);
    }

    #[test]
    fn never_third_party() {
        for email in ["a@acme.io", "b@news.shop.co.uk", "c@x-y.dev"] {
            let d = sender_domain(email).unwrap();
            for s in resolve(email, None, None, true) {
                if let AvatarSource::Domain { urls, bimi_txt, .. } = s {
                    assert_eq!(bimi_txt, format!("default._bimi.{d}"));
                    for u in urls {
                        let host = url::Url::parse(&u).unwrap().host_str().unwrap().to_string();
                        assert_eq!(host, d);
                        assert!(!u.contains("gravatar") && !u.contains("clearbit"));
                    }
                }
            }
        }
        assert_eq!(
            bimi_logo_url("v=BIMI1; l=https://acme.io/logo.svg;", "acme.io").as_deref(),
            Some("https://acme.io/logo.svg")
        );
        assert_eq!(
            bimi_logo_url("v=BIMI1; l=https://brand.acme.io/l.svg", "acme.io").as_deref(),
            Some("https://brand.acme.io/l.svg")
        );
        assert!(bimi_logo_url("v=BIMI1; l=https://logos.example/l.svg", "acme.io").is_none());
        assert!(bimi_logo_url("v=BIMI1; l=https://evilacme.io/l.svg", "acme.io").is_none());
        assert!(bimi_logo_url("v=BIMI1; l=http://acme.io/l.svg", "acme.io").is_none());
        assert!(bimi_logo_url("v=BIMI1; l=https://acme.io/l.png", "acme.io").is_none());
        assert!(accept_logo("image/svg+xml", 1000));
        assert!(!accept_logo("text/html", 1000));
        assert!(!accept_logo("image/png", MAX_LOGO_BYTES + 1));
    }
}
