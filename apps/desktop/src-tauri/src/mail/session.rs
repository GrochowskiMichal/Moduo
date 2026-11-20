//! Async-native IMAP sessions (MR-2, decision 4). No `block_on` facade: every
//! call is awaited on tokio by the account actor. TLS is native-tls over a
//! tokio stream with per-I/O timeouts, as in the legacy engine.

use std::collections::HashSet;
use std::pin::Pin;
use std::time::Duration;

use tokio::net::TcpStream;
use tokio_io_timeout::TimeoutStream;

use super::auth::LoginMethod;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub const IO_TIMEOUT: Duration = Duration::from_secs(30);

pub type TlsStream = tokio_native_tls::TlsStream<Pin<Box<TimeoutStream<TcpStream>>>>;
pub type Session = async_imap::Session<TlsStream>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
}

/// What the server supports, detected once per session (decision 5).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Capabilities {
    pub idle: bool,
    pub condstore: bool,
    pub qresync: bool,
    pub uidplus: bool,
    pub special_use: bool,
    pub r#move: bool,
    pub gmail_ext: bool,
    pub utf8_accept: bool,
}

impl Capabilities {
    /// From the raw atoms of a CAPABILITY response (case-insensitive).
    pub fn from_atoms<'a, I: IntoIterator<Item = &'a str>>(atoms: I) -> Self {
        let set: HashSet<String> = atoms.into_iter().map(|a| a.to_ascii_uppercase()).collect();
        let has = |s: &str| set.contains(s);
        Self {
            idle: has("IDLE"),
            condstore: has("CONDSTORE") || has("QRESYNC"),
            qresync: has("QRESYNC"),
            uidplus: has("UIDPLUS"),
            special_use: has("SPECIAL-USE") || has("XLIST"),
            r#move: has("MOVE"),
            gmail_ext: has("X-GM-EXT-1"),
            utf8_accept: has("UTF8=ACCEPT"),
        }
    }
}

/// SASL XOAUTH2: async-imap base64-encodes the raw string itself.
struct Xoauth2(String);
impl async_imap::Authenticator for Xoauth2 {
    type Response = String;
    fn process(&mut self, _challenge: &[u8]) -> String {
        self.0.clone()
    }
}

pub fn xoauth2_sasl(user: &str, token: &str) -> String {
    format!("user={user}\x01auth=Bearer {token}\x01\x01")
}

/// Classify a login failure: an auth rejection is terminal for this credential
/// (the actor marks Reconnect for password accounts after a refresh can't help).
pub fn is_auth_rejection(err: &str) -> bool {
    let e = err.to_ascii_uppercase();
    e.contains("AUTHENTICATIONFAILED") || e.contains("INVALID CREDENTIALS") || e.contains("[AUTH]")
}

/// Connect, TLS, greet, authenticate and detect capabilities.
pub async fn open(endpoint: &Endpoint, login: &LoginMethod) -> Result<(Session, Capabilities), String> {
    let tcp = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((endpoint.host.as_str(), endpoint.port)))
        .await
        .map_err(|_| "imap_connect_timeout".to_string())?
        .map_err(|e| format!("imap_connect_failed:{e}"))?;
    let _ = tcp.set_nodelay(true);
    let mut timed = TimeoutStream::new(tcp);
    timed.set_read_timeout(Some(IO_TIMEOUT));
    timed.set_write_timeout(Some(IO_TIMEOUT));
    let tls = tokio_native_tls::TlsConnector::from(
        native_tls::TlsConnector::builder().build().map_err(|e| e.to_string())?,
    );
    let stream = tls
        .connect(&endpoint.host, Box::pin(timed))
        .await
        .map_err(|e| format!("imap_tls_failed:{e}"))?;
    let mut client = async_imap::Client::new(stream);
    client
        .read_response()
        .await
        .map_err(|e| format!("imap_greeting_failed:{e}"))?
        .ok_or_else(|| "imap_greeting_failed:connection_lost".to_string())?;
    let mut session = match login {
        LoginMethod::Password { user, password } => client.login(user, password).await,
        LoginMethod::Xoauth2 { user, access_token } => {
            client.authenticate("XOAUTH2", Xoauth2(xoauth2_sasl(user, access_token))).await
        }
    }
    .map_err(|(e, _)| format!("imap_auth_failed:{e}"))?;
    let caps = session.capabilities().await.map_err(|e| format!("imap_capability_failed:{e}"))?;
    let atoms: Vec<String> = caps
        .iter()
        .map(|c| match c {
            async_imap::types::Capability::Imap4rev1 => "IMAP4REV1".to_string(),
            async_imap::types::Capability::Auth(a) => format!("AUTH={a}"),
            async_imap::types::Capability::Atom(a) => a.to_string(),
        })
        .collect();
    Ok((session, Capabilities::from_atoms(atoms.iter().map(String::as_str))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_detection() {
        let c = Capabilities::from_atoms(["IMAP4rev1", "IDLE", "condstore", "UIDPLUS", "X-GM-EXT-1", "XLIST", "MOVE"]);
        assert!(c.idle && c.condstore && c.uidplus && c.gmail_ext && c.special_use && c.r#move);
        assert!(!c.qresync && !c.utf8_accept);
        let bare = Capabilities::from_atoms(["IMAP4rev1"]);
        assert_eq!(bare, Capabilities::default());
        assert!(Capabilities::from_atoms(["QRESYNC"]).condstore);
    }

    #[test]
    fn xoauth2_shape_and_auth_rejection() {
        assert_eq!(xoauth2_sasl("a@b", "t"), "user=a@b\x01auth=Bearer t\x01\x01");
        assert!(is_auth_rejection("NO [AUTHENTICATIONFAILED] Invalid credentials"));
        assert!(!is_auth_rejection("connection reset"));
    }
}
