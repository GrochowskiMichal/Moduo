//! Loads the reference mailbox written by the TS generator
//! (`bun scripts/mail/write-fixture.ts --format jsonl`), so the Rust perf tests
//! measure the same 100k messages the fixture engine and Dovecot use (decision 18).

use serde::Deserialize;
use std::io::BufRead;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureMessage {
    pub id: String,
    pub account_id: String,
    pub mailbox_role: String,
    pub thread_id: String,
    pub message_id: String,
    pub in_reply_to: Option<String>,
    pub from_name: String,
    pub from_email: String,
    pub to: Vec<String>,
    pub subject: String,
    pub snippet: String,
    pub body_text: String,
    pub date_ms: i64,
    pub flags: u32,
    pub list_unsubscribe: Option<String>,
    pub precedence: Option<String>,
    pub auto_submitted: Option<String>,
    pub attachment_names: Vec<String>,
    pub has_invite: bool,
}

/// Where the JSONL fixture lives: `MODUO_MAIL_FIXTURE_PATH`, else the default
/// path the generator writes (`target/mail-fixture/messages.jsonl`).
pub fn fixture_path() -> PathBuf {
    std::env::var_os("MODUO_MAIL_FIXTURE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/mail-fixture/messages.jsonl")
        })
}

pub fn load_fixture() -> std::io::Result<Vec<FixtureMessage>> {
    let file = std::fs::File::open(fixture_path())?;
    let mut out = Vec::new();
    for line in std::io::BufReader::new(file).lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        out.push(serde_json::from_str(&line).map_err(std::io::Error::other)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_one_generated_line() {
        let line = r#"{"id":"m1","accountId":"a1","mailboxRole":"inbox","threadId":"t1","messageId":"<x@y>","inReplyTo":null,"fromName":"A","fromEmail":"a@b.c","to":["me@x.y"],"subject":"S","snippet":"s","bodyText":"b","dateMs":1,"flags":1,"listUnsubscribe":null,"precedence":null,"autoSubmitted":null,"attachmentNames":[],"hasInvite":false}"#;
        let m: super::FixtureMessage = serde_json::from_str(line).unwrap();
        assert_eq!(m.account_id, "a1");
    }
}
