//! Incoming `mailto:` deep links (AC24, MR-11). macOS hands the app a URL once
//! the bundle declares the scheme (`CFBundleURLTypes` in `Info.plist`) and the
//! user picked Moduo as the default mail app. Tauri delivers it as
//! `RunEvent::Opened`; this inbox keeps every valid `mailto:` until the
//! webview drains it (a cold launch delivers the URL before any listener
//! exists), then nudges the webview with [`MAILTO_EVENT`].

use std::sync::Mutex;

use tauri::{Emitter, Manager, State};

use super::mailto::parse_mailto;

/// Payload-less signal: the webview answers by calling `mail_take_mailto`.
pub const MAILTO_EVENT: &str = "mail://mailto";

/// Most URLs held before the webview drains them; the oldest go first.
const MAX_PENDING: usize = 32;

#[derive(Default)]
pub struct MailtoInbox(Mutex<Vec<String>>);

impl MailtoInbox {
    /// Keeps the URLs that are well-formed `mailto:`; returns how many were kept.
    pub fn accept<I: IntoIterator<Item = String>>(&self, urls: I) -> usize {
        let mut q = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let mut kept = 0;
        for url in urls {
            if parse_mailto(&url).is_some() {
                q.push(url);
                kept += 1;
            }
        }
        let over = q.len().saturating_sub(MAX_PENDING);
        q.drain(..over);
        kept
    }

    /// Hands every pending URL over, oldest first, and empties the inbox.
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

/// `RunEvent::Opened`: queue the mailto URLs, bring the window up, nudge the webview.
pub fn route<R: tauri::Runtime>(app: &tauri::AppHandle<R>, urls: Vec<String>) {
    let Some(inbox) = app.try_state::<MailtoInbox>() else {
        return;
    };
    deliver(&inbox, urls, || {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let _ = app.emit(MAILTO_EVENT, ());
    });
}

/// Queues the URLs and calls `notify` once when at least one was a mailto.
pub fn deliver<I: IntoIterator<Item = String>>(
    inbox: &MailtoInbox,
    urls: I,
    notify: impl FnOnce(),
) {
    if inbox.accept(urls) > 0 {
        notify();
    }
}

/// The webview drains pending `mailto:` URLs (on mount and on each nudge).
#[tauri::command]
pub fn mail_take_mailto(inbox: State<'_, MailtoInbox>) -> Vec<String> {
    inbox.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_mailto_and_drains_once() {
        let inbox = MailtoInbox::default();
        let kept = inbox.accept([
            "mailto:a@x.test?subject=Hi".to_string(),
            "https://evil.test/".to_string(),
            "moduo://task/1".to_string(),
            "MAILTO:b@x.test".to_string(),
        ]);
        assert_eq!(kept, 2);
        assert_eq!(
            inbox.take(),
            vec!["mailto:a@x.test?subject=Hi", "MAILTO:b@x.test"]
        );
        assert!(inbox.take().is_empty());
    }

    #[test]
    fn caps_pending_dropping_oldest() {
        let inbox = MailtoInbox::default();
        inbox.accept((0..40).map(|i| format!("mailto:u{i}@x.test")));
        let got = inbox.take();
        assert_eq!(got.len(), MAX_PENDING);
        assert_eq!(got[0], "mailto:u8@x.test");
    }

    #[test]
    fn deliver_queues_and_notifies_only_for_mailto() {
        let inbox = MailtoInbox::default();
        let mut hits = 0;
        deliver(&inbox, ["https://x.test".to_string()], || hits += 1);
        deliver(
            &inbox,
            ["mailto:anna@x.test?subject=Hi%20there&body=L1%0D%0AL2".to_string()],
            || hits += 1,
        );
        assert_eq!(hits, 1);
        let pending = inbox.take();
        assert_eq!(
            pending,
            vec!["mailto:anna@x.test?subject=Hi%20there&body=L1%0D%0AL2"]
        );
        let f = parse_mailto(&pending[0]).unwrap();
        assert_eq!(f.to, vec!["anna@x.test"]);
        assert_eq!(f.subject.as_deref(), Some("Hi there"));
        assert_eq!(f.body.as_deref(), Some("L1\nL2"));
    }
}
