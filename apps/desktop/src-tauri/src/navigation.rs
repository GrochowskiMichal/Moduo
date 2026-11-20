//! Navigation guard (MOD-574): no webview, and no frame inside one, may navigate
//! to a foreign http(s) origin.
//!
//! The email reader renders untrusted HTML in a sandboxed `srcdoc` iframe. A
//! `<meta http-equiv="refresh">` (or anything else that self-navigates the frame)
//! would load a live remote page inside the reader, past remote-content blocking,
//! and the desktop has no CSP (`tauri.conf.json` `csp: null`). The sanitizer drops
//! those tags; this is the second wall. WKWebView asks the navigation delegate for
//! subframe navigations too, so the reader's iframe is covered on macOS. (WebView2
//! only reports top-level navigations to this hook.)
//!
//! Links the app means to open externally already go through the opener
//! (`openExternalUrl`), never a webview navigation, so blocking costs nothing.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;
use url::{Host, Url};

/// True when the webview may go to `url`: any non-web scheme (the app's own
/// `tauri:`, `about:srcdoc`, `data:`, `blob:`), the app's own origin on Windows
/// and Linux (`http(s)://tauri.localhost`), and loopback in debug builds (the
/// dev server). Every other http(s) origin is refused.
pub fn allowed(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return true;
    }
    match url.host() {
        Some(Host::Domain(domain)) => {
            let domain = domain.to_ascii_lowercase();
            domain == "tauri.localhost" || (cfg!(debug_assertions) && domain == "localhost")
        }
        Some(Host::Ipv4(ip)) => cfg!(debug_assertions) && ip.is_loopback(),
        Some(Host::Ipv6(ip)) => cfg!(debug_assertions) && ip.is_loopback(),
        None => false,
    }
}

/// The guard as a plugin, so it covers every webview, including the ones made
/// from `tauri.conf.json`.
pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|_webview, url| {
            let ok = allowed(url);
            if !ok {
                eprintln!("[navigation-guard] blocked {}", url.origin().ascii_serialization());
            }
            ok
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::allowed;
    use url::Url;

    fn ok(raw: &str) -> bool {
        allowed(&Url::parse(raw).unwrap())
    }

    #[test]
    fn refuses_foreign_web_origins() {
        assert!(!ok("https://phish.example/login"));
        assert!(!ok("http://phish.example/"));
        assert!(!ok("https://tauri.localhost.phish.example/"));
        assert!(!ok("https://localhost.phish.example/"));
        assert!(!ok("https://user@phish.example/"));
        assert!(!ok("https://8.8.8.8/"));
    }

    #[test]
    fn allows_the_app_and_non_web_schemes() {
        assert!(ok("tauri://localhost/inbox"));
        assert!(ok("http://tauri.localhost/inbox"));
        assert!(ok("https://TAURI.localhost/"));
        assert!(ok("about:srcdoc"));
        assert!(ok("about:blank"));
        assert!(ok("data:text/html,hi"));
        assert!(ok("blob:tauri://localhost/1234"));
    }

    #[test]
    fn loopback_only_in_debug_builds() {
        assert_eq!(ok("http://localhost:8081/"), cfg!(debug_assertions));
        assert_eq!(ok("http://127.0.0.1:8081/"), cfg!(debug_assertions));
        assert_eq!(ok("http://[::1]:8081/"), cfg!(debug_assertions));
    }
}
