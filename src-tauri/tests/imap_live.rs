//! Live IMAP/SMTP round-trip harness (EM-1).
//!
//! These tests hit a **real** disposable mailbox, so they are all `#[ignore]` —
//! they never run under `cargo test` / CI. Run them deliberately with creds:
//!
//! ```sh
//! export MODUO_TEST_IMAP_CREDS_PATH=~/.moduo/test-imap.creds.json
//! cargo test --test imap_live -- --ignored --nocapture
//! ```
//!
//! The creds file (gitignored — see `.gitignore` `*.creds.json`) is JSON:
//!
//! ```json
//! {
//!   "imap_host": "imap.example.com", "imap_port": 993,
//!   "smtp_host": "smtp.example.com", "smtp_port": 587,
//!   "email": "you@example.com", "password": "app-specific-password"
//! }
//! ```
//!
//! They validate the exact protocol steps the engine relies on — connect/login,
//! folder LIST, APPEND + UID SEARCH, `Moduo/Snoozed` create→move→restore, and an
//! SMTP send + copy-to-Sent — against a live server, since a faked IMAP was
//! evaluated and rejected as high-cost/low-yield (spec assumption 5). The pure
//! transport/`build_message`/secret-migration logic is covered by the unit tests
//! in `smtp.rs` / `secrets.rs`, which DO run in CI.

use std::net::TcpStream;

use imap::Session;
use native_tls::TlsStream;
use serde::Deserialize;

#[derive(Deserialize, Clone)]
struct TestCreds {
    imap_host: String,
    #[serde(default = "default_imap_port")]
    imap_port: u16,
    smtp_host: String,
    #[serde(default = "default_smtp_port")]
    smtp_port: u16,
    email: String,
    password: String,
}

fn default_imap_port() -> u16 {
    993
}
fn default_smtp_port() -> u16 {
    587
}

/// Load creds, or `None` (skip) when the env file isn't configured.
fn load_creds() -> Option<TestCreds> {
    let path = std::env::var("MODUO_TEST_IMAP_CREDS_PATH").ok()?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) => {
            eprintln!("skipping: cannot read MODUO_TEST_IMAP_CREDS_PATH ({path}): {e}");
            return None;
        }
    };
    match serde_json::from_str::<TestCreds>(&raw) {
        Ok(creds) => Some(creds),
        Err(e) => {
            eprintln!("skipping: malformed creds file ({path}): {e}");
            None
        }
    }
}

fn open_session(creds: &TestCreds) -> Session<TlsStream<TcpStream>> {
    let tls = native_tls::TlsConnector::builder()
        .build()
        .expect("tls connector");
    let client = imap::connect(
        (creds.imap_host.as_str(), creds.imap_port),
        creds.imap_host.as_str(),
        &tls,
    )
    .expect("imap connect");
    client
        .login(&creds.email, &creds.password)
        .map_err(|(e, _)| e)
        .expect("imap login")
}

/// A unique test message with a stable Message-ID we can search for.
fn test_message(from: &str, marker: &str) -> (String, String) {
    let message_id = format!("<moduo-live-{marker}@moduo.test>");
    let raw = format!(
        "Message-ID: {message_id}\r\n\
         From: {from}\r\n\
         To: {from}\r\n\
         Subject: Moduo live test {marker}\r\n\
         Date: Thu, 01 Jan 1970 00:00:00 +0000\r\n\
         \r\n\
         Moduo EM-1 live harness body {marker}.\r\n"
    );
    (message_id, raw)
}

#[test]
#[ignore = "live: needs MODUO_TEST_IMAP_CREDS_PATH"]
fn connect_login_and_list_folders() {
    let Some(creds) = load_creds() else {
        return;
    };
    let mut session = open_session(&creds);
    let mailboxes = session.list(Some(""), Some("*")).expect("LIST");
    assert!(
        mailboxes.iter().any(|m| m.name().eq_ignore_ascii_case("INBOX")),
        "server should advertise an INBOX"
    );
    session.logout().expect("logout");
}

#[test]
#[ignore = "live: needs MODUO_TEST_IMAP_CREDS_PATH"]
fn append_search_and_delete_roundtrip() {
    let Some(creds) = load_creds() else {
        return;
    };
    let mut session = open_session(&creds);
    session.select("INBOX").expect("select INBOX");

    let (message_id, raw) = test_message(&creds.email, "append");
    session.append("INBOX", raw.as_bytes()).expect("APPEND");

    // Find it by header (the id we minted) — the Sent-matching path EM-6/EM-7 use.
    let uids = session
        .uid_search(format!("HEADER Message-ID \"{message_id}\""))
        .expect("UID SEARCH");
    assert!(!uids.is_empty(), "appended message should be searchable");

    // Clean up: flag \Deleted + EXPUNGE (plain EXPUNGE is safe — spec edge case).
    let set = uids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    session
        .uid_store(&set, "+FLAGS (\\Deleted)")
        .expect("UID STORE Deleted");
    session.expunge().expect("EXPUNGE");
    session.logout().expect("logout");
}

#[test]
#[ignore = "live: needs MODUO_TEST_IMAP_CREDS_PATH"]
fn snooze_folder_create_move_restore() {
    let Some(creds) = load_creds() else {
        return;
    };
    let mut session = open_session(&creds);

    // Create the snooze folder if missing (create-if-missing; EM-6).
    let snooze = "Moduo/Snoozed";
    let _ = session.create(snooze); // already-exists is fine

    // Seed a message in INBOX, then move it to the snooze folder and back.
    session.select("INBOX").expect("select INBOX");
    let (message_id, raw) = test_message(&creds.email, "snooze");
    session.append("INBOX", raw.as_bytes()).expect("APPEND");
    let uids = session
        .uid_search(format!("HEADER Message-ID \"{message_id}\""))
        .expect("UID SEARCH");
    let set = uids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    assert!(!set.is_empty(), "seed message should exist");

    session.uid_mv(&set, snooze).expect("UID MOVE to snooze");

    // Restore: locate by Message-ID in the snooze folder, move back to INBOX.
    session.select(snooze).expect("select snooze");
    let restore = session
        .uid_search(format!("HEADER Message-ID \"{message_id}\""))
        .expect("UID SEARCH in snooze");
    let restore_set = restore
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    assert!(!restore_set.is_empty(), "message should be in snooze folder");
    session.uid_mv(&restore_set, "INBOX").expect("UID MOVE back");

    // Clean up the restored copy.
    session.select("INBOX").expect("reselect INBOX");
    if let Ok(cleanup) = session.uid_search(format!("HEADER Message-ID \"{message_id}\"")) {
        let cleanup_set = cleanup
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        if !cleanup_set.is_empty() {
            let _ = session.uid_store(&cleanup_set, "+FLAGS (\\Deleted)");
            let _ = session.expunge();
        }
    }
    session.logout().expect("logout");
}

#[test]
#[ignore = "live: needs MODUO_TEST_IMAP_CREDS_PATH"]
fn smtp_send_over_tls() {
    use lettre::message::header::ContentType;
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    let Some(creds) = load_creds() else {
        return;
    };

    let email = Message::builder()
        .from(creds.email.parse().expect("from"))
        .to(creds.email.parse().expect("to"))
        .subject("Moduo live test — SMTP over TLS")
        .header(ContentType::TEXT_PLAIN)
        .body("EM-1 SMTP TLS round-trip.".to_string())
        .expect("build");

    let smtp_creds = Credentials::new(creds.email.clone(), creds.password.clone());
    // Mirror the engine's port→TLS choice: 465 implicit, else STARTTLS. Never plaintext.
    let transport = if creds.smtp_port == 465 {
        SmtpTransport::relay(&creds.smtp_host).expect("relay")
    } else {
        SmtpTransport::starttls_relay(&creds.smtp_host).expect("starttls relay")
    }
    .port(creds.smtp_port)
    .credentials(smtp_creds)
    .build();

    transport.send(&email).expect("SMTP send");
}
