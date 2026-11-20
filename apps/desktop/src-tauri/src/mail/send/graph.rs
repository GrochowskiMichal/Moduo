//! Microsoft Graph send (decision 14): when the tenant has SMTP AUTH off
//! (`535 5.7.139`), the same MIME goes to `POST /me/sendMail` as base64 text,
//! with a `Mail.Send` Graph token requested incrementally
//! ([`crate::mail::auth::microsoft::GRAPH_SEND_SCOPES`]). Graph files the Sent
//! copy itself.

use super::{SendError, SendTransport};
use crate::mail::auth::microsoft::GRAPH_SEND_SCOPES;
use crate::mail::auth::RefreshError;
use base64::Engine;

pub const SEND_MAIL_URL: &str = "https://graph.microsoft.com/v1.0/me/sendMail";

/// The request body: the MIME, base64, sent as `text/plain`.
pub fn request_body(mime: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(mime)
}

/// 202 is success; 429 and 5xx retry; 401 means the token needs a refresh
/// (retry after it); the rest fail.
pub fn classify_status(status: u16, body: &str) -> Result<(), SendError> {
    match status {
        200..=299 => Ok(()),
        401 | 408 | 429 | 500..=599 => Err(SendError::Transient(format!("graph_{status}:{body}"))),
        _ => Err(SendError::Permanent(format!("graph_{status}:{body}"))),
    }
}

pub async fn send_mime(client: &reqwest::Client, token: &str, mime: &[u8]) -> Result<(), SendError> {
    let res = client
        .post(SEND_MAIL_URL)
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "text/plain")
        .body(request_body(mime))
        .send()
        .await
        .map_err(|e| SendError::Transient(format!("graph_unreachable:{e}")))?;
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    classify_status(status, &body)
}

/// The scope string for the incremental `Mail.Send` refresh grant.
pub fn send_scope() -> String {
    GRAPH_SEND_SCOPES.join(" ")
}

/// A failed Graph token grant: a refused grant (no consent for `Mail.Send`,
/// revoked) fails the send for good with a reason; the rest retry.
pub fn token_error(e: RefreshError) -> SendError {
    match e {
        RefreshError::InvalidGrant => SendError::Permanent("graph_consent_required".into()),
        RefreshError::Transient(m) => SendError::Transient(format!("graph_token:{m}")),
    }
}

/// The Graph leg: MIME in, sent or not. Production fetches a `Mail.Send`
/// token from the account's refresh token and calls [`send_mime`].
pub type GraphLeg<'a> = Box<dyn FnMut(&[u8]) -> Result<(), SendError> + 'a>;

/// Wraps a transport so `graph_send` goes through a real Graph leg; every
/// other call is the inner transport's. Accounts without a leg (not
/// Microsoft, no refresh token) fail the Graph send with a reason.
pub struct GraphFallback<'a, T: SendTransport> {
    pub inner: T,
    pub leg: Option<GraphLeg<'a>>,
}

impl<T: SendTransport> SendTransport for GraphFallback<'_, T> {
    fn smtp_send(&mut self, a: &str, from: &str, rcpts: &[String], mime: &[u8]) -> Result<(), SendError> {
        self.inner.smtp_send(a, from, rcpts, mime)
    }
    fn graph_send(&mut self, _a: &str, mime: &[u8]) -> Result<(), SendError> {
        match &mut self.leg {
            Some(leg) => tokio::task::block_in_place(|| leg(mime)),
            None => Err(SendError::Permanent("graph_send_unavailable".into())),
        }
    }
    fn append(&mut self, a: &str, path: &str, flags: &[&str], mime: &[u8]) -> Result<Option<i64>, SendError> {
        self.inner.append(a, path, flags, mime)
    }
    fn delete_uid(&mut self, a: &str, path: &str, uid: i64) -> Result<(), SendError> {
        self.inner.delete_uid(a, path, uid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Inner(Vec<&'static str>);
    impl SendTransport for Inner {
        fn smtp_send(&mut self, _: &str, _: &str, _: &[String], _: &[u8]) -> Result<(), SendError> {
            self.0.push("smtp");
            Err(SendError::Permanent("535 5.7.139 Authentication unsuccessful".into()))
        }
        fn graph_send(&mut self, _: &str, _: &[u8]) -> Result<(), SendError> {
            self.0.push("inner_graph");
            Err(SendError::Permanent("graph_send_unavailable".into()))
        }
        fn append(&mut self, _: &str, _: &str, _: &[&str], _: &[u8]) -> Result<Option<i64>, SendError> {
            self.0.push("append");
            Ok(None)
        }
        fn delete_uid(&mut self, _: &str, _: &str, _: i64) -> Result<(), SendError> {
            self.0.push("delete");
            Ok(())
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn graph_fallback_routes_graph_send_to_the_leg() {
        let mut got: Vec<Vec<u8>> = vec![];
        {
            let mut t = GraphFallback {
                inner: Inner(vec![]),
                leg: Some(Box::new(|m: &[u8]| {
                    got.push(m.to_vec());
                    Ok(())
                })),
            };
            assert!(t.smtp_send("a", "me@x", &[], b"m").is_err());
            assert!(t.graph_send("a", b"mime").is_ok());
            assert_eq!(t.append("a", "Sent", &[], b"m").unwrap(), None);
            assert_eq!(t.inner.0, vec!["smtp", "append"]);
        }
        assert_eq!(got, vec![b"mime".to_vec()]);
        let mut none = GraphFallback { inner: Inner(vec![]), leg: None };
        assert_eq!(
            none.graph_send("a", b"m"),
            Err(SendError::Permanent("graph_send_unavailable".into()))
        );
    }

    #[test]
    fn graph_token_scope_and_errors() {
        assert!(send_scope().contains("https://graph.microsoft.com/Mail.Send"));
        assert!(send_scope().contains("offline_access"));
        assert_eq!(
            token_error(RefreshError::InvalidGrant),
            SendError::Permanent("graph_consent_required".into())
        );
        assert!(matches!(token_error(RefreshError::Transient("x".into())), SendError::Transient(_)));
    }

    #[test]
    fn graph_send_fallback_body_and_status() {
        assert_eq!(request_body(b"Subject: x\r\n\r\nhi"), "U3ViamVjdDogeA0KDQpoaQ==");
        assert!(classify_status(202, "").is_ok());
        assert!(matches!(classify_status(429, ""), Err(SendError::Transient(_))));
        assert!(matches!(classify_status(403, "ErrorAccessDenied"), Err(SendError::Permanent(_))));
    }
}
