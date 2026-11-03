//! The real SMTP leg (lettre, blocking: the actor runs it on
//! `spawn_blocking`). Always TLS: 465 implicit, everything else STARTTLS
//! required. OAuth accounts pin XOAUTH2 so a bearer token never goes out as a
//! PLAIN password.

use super::SendError;
use lettre::address::Envelope;
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::{Address, SmtpTransport, Transport};

pub enum SmtpAuth<'a> {
    Password(&'a str),
    OAuth(&'a str),
}

/// Maps an SMTP error to retry-or-fail: 4xx and connection trouble retry, 5xx fail.
pub fn classify(e: &lettre::transport::smtp::Error) -> SendError {
    let m = e.to_string();
    if e.is_permanent() {
        SendError::Permanent(m)
    } else {
        SendError::Transient(m)
    }
}

pub fn send_raw(
    host: &str,
    port: u16,
    user: &str,
    auth: SmtpAuth<'_>,
    from: &str,
    rcpts: &[String],
    mime: &[u8],
) -> Result<(), SendError> {
    let parse = |a: &str| {
        a.parse::<Address>()
            .map_err(|e| SendError::Permanent(format!("invalid_address:{a}:{e}")))
    };
    let to = rcpts.iter().map(|r| parse(r)).collect::<Result<Vec<_>, _>>()?;
    let env = Envelope::new(Some(parse(from)?), to)
        .map_err(|e| SendError::Permanent(format!("invalid_envelope:{e}")))?;
    let b = if port == 465 {
        SmtpTransport::relay(host)
    } else {
        SmtpTransport::starttls_relay(host)
    }
    .map_err(|e| SendError::Transient(format!("smtp_tls_setup_failed:{e}")))?
    .port(port);
    let b = match auth {
        SmtpAuth::Password(p) => b.credentials(Credentials::new(user.into(), p.into())),
        SmtpAuth::OAuth(t) => b
            .credentials(Credentials::new(user.into(), t.into()))
            .authentication(vec![Mechanism::Xoauth2]),
    };
    b.build().send_raw(&env, mime).map(|_| ()).map_err(|e| classify(&e))
}
