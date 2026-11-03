//! Microsoft Graph send (decision 14): when the tenant has SMTP AUTH off
//! (`535 5.7.139`), the same MIME goes to `POST /me/sendMail` as base64 text,
//! with a `Mail.Send` Graph token requested incrementally
//! ([`crate::mail::auth::microsoft::GRAPH_SEND_SCOPES`]). Graph files the Sent
//! copy itself.

use super::SendError;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_send_fallback_body_and_status() {
        assert_eq!(request_body(b"Subject: x\r\n\r\nhi"), "U3ViamVjdDogeA0KDQpoaQ==");
        assert!(classify_status(202, "").is_ok());
        assert!(matches!(classify_status(429, ""), Err(SendError::Transient(_))));
        assert!(matches!(classify_status(403, "ErrorAccessDenied"), Err(SendError::Permanent(_))));
    }
}
