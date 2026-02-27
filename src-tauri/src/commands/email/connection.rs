use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use native_tls::TlsConnector;

use super::{
    EmailConfig, IDLE_GREETING_TIMEOUT_SECS, IMAP_CONNECT_TIMEOUT_SECS, IMAP_SYNC_IO_TIMEOUT_SECS,
    IMAP_TCP_KEEPALIVE_SECS,
};

pub(super) type ImapSession = imap::Session<native_tls::TlsStream<TcpStream>>;
type ImapTlsStream = native_tls::TlsStream<TcpStream>;

enum ImapSessionProfile {
    CommandProfile,
    IdleProfile,
}

struct ImapSessionOpenResult {
    session: ImapSession,
    socket_control: TcpStream,
}

struct ImapSessionFactory;

impl ImapSessionFactory {
    fn open(config: &EmailConfig, profile: ImapSessionProfile) -> Result<ImapSession, String> {
        let opened = Self::open_with_control(config, &profile)?;
        if matches!(profile, ImapSessionProfile::IdleProfile) {
            // Enter runtime IDLE mode with blocking socket semantics after auth succeeds.
            opened
                .socket_control
                .set_read_timeout(None)
                .map_err(|e| format!("imap_set_idle_read_timeout_failed:{e}"))?;
            opened
                .socket_control
                .set_write_timeout(None)
                .map_err(|e| format!("imap_set_idle_write_timeout_failed:{e}"))?;
        }
        Ok(opened.session)
    }

    fn open_with_control(
        config: &EmailConfig,
        profile: &ImapSessionProfile,
    ) -> Result<ImapSessionOpenResult, String> {
        let tls = TlsConnector::builder().build().map_err(|e| e.to_string())?;
        let (read_timeout, write_timeout) = Self::timeouts_for(profile);
        let stream = open_tuned_tcp_stream(
            config.imap_host(),
            config.imap_port(),
            read_timeout,
            write_timeout,
        )?;
        let socket_control = stream
            .try_clone()
            .map_err(|e| format!("imap_stream_clone_failed:{e}"))?;
        let tls_stream: ImapTlsStream = tls
            .connect(config.imap_host(), stream)
            .map_err(|e| format!("imap_tls_failed:{e}"))?;
        let mut client = imap::Client::new(tls_stream);
        client
            .read_greeting()
            .map_err(|e| format!("imap_greeting_failed:{e}"))?;
        let session = client
            .login(&config.email, &config.password)
            .map_err(|e| e.0.to_string())?;
        Ok(ImapSessionOpenResult {
            session,
            socket_control,
        })
    }

    fn timeouts_for(profile: &ImapSessionProfile) -> (Option<Duration>, Option<Duration>) {
        match profile {
            ImapSessionProfile::CommandProfile => (
                Some(Duration::from_secs(IMAP_SYNC_IO_TIMEOUT_SECS)),
                Some(Duration::from_secs(IMAP_SYNC_IO_TIMEOUT_SECS)),
            ),
            // IDLE profile keeps short timeouts for connect/auth only.
            ImapSessionProfile::IdleProfile => (
                Some(Duration::from_secs(IDLE_GREETING_TIMEOUT_SECS)),
                Some(Duration::from_secs(IDLE_GREETING_TIMEOUT_SECS)),
            ),
        }
    }
}

fn open_tuned_tcp_stream(
    host: &str,
    port: u16,
    read_timeout: Option<Duration>,
    write_timeout: Option<Duration>,
) -> Result<TcpStream, String> {
    let mut addrs = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("imap_resolve_failed:{e}"))?;
    let addr = addrs
        .next()
        .ok_or_else(|| format!("imap_resolve_empty:{host}:{port}"))?;
    let domain = if addr.is_ipv4() {
        socket2::Domain::IPV4
    } else {
        socket2::Domain::IPV6
    };
    let socket = socket2::Socket::new(domain, socket2::Type::STREAM, Some(socket2::Protocol::TCP))
        .map_err(|e| format!("imap_socket_open_failed:{e}"))?;
    let keepalive = socket2::TcpKeepalive::new()
        .with_time(Duration::from_secs(IMAP_TCP_KEEPALIVE_SECS))
        .with_interval(Duration::from_secs(IMAP_TCP_KEEPALIVE_SECS));
    let _ = socket.set_tcp_keepalive(&keepalive);
    socket
        .connect_timeout(
            &socket2::SockAddr::from(addr),
            Duration::from_secs(IMAP_CONNECT_TIMEOUT_SECS),
        )
        .map_err(|e| format!("imap_connect_failed:{e}"))?;
    let stream: TcpStream = socket.into();
    stream
        .set_read_timeout(read_timeout)
        .map_err(|e| format!("imap_set_read_timeout_failed:{e}"))?;
    stream
        .set_write_timeout(write_timeout)
        .map_err(|e| format!("imap_set_write_timeout_failed:{e}"))?;
    Ok(stream)
}

pub(super) fn open_imap_session(config: &EmailConfig) -> Result<ImapSession, String> {
    ImapSessionFactory::open(config, ImapSessionProfile::CommandProfile)
}

pub(super) fn open_idle_imap_session(config: &EmailConfig) -> Result<ImapSession, String> {
    ImapSessionFactory::open(config, ImapSessionProfile::IdleProfile)
}
