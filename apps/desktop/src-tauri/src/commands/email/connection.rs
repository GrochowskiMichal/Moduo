//! IMAP connection layer on `async-imap` (tokio), behind a blocking facade.
//!
//! The email engine is synchronous: every IMAP call runs inside `spawn_blocking`, the
//! IDLE worker's blocking cycle, or (for two force-sync paths) directly on an async
//! command thread. Rather than re-thread that engine, [`ImapSession`] keeps the old
//! `imap` 2.x method surface and drives each call to completion on the Tauri tokio
//! runtime via [`block_on`].
//!
//! FETCH / LIST / SEARCH / STORE / EXPUNGE / NOOP / CAPABILITY / SELECT are issued with
//! `run_command` and read here, not through async-imap's helpers: those helpers end at
//! the tagged response without checking it, so a tagged `NO`/`BAD` (or an EOF) came
//! back as an empty `Ok`. The old crate surfaced both as errors, and callers rely on
//! that (the CONDSTORE and UTF-8 SEARCH fallbacks; the IDLE micro-fetch only advances
//! its cursor when every chunk stored). IDLE is driven here too: async-imap's
//! `Handle::init` loops forever on a tagged `NO`, and its wait ignores the server
//! ending IDLE itself.

use std::borrow::Cow;
use std::collections::HashSet;
use std::future::Future;
use std::net::{TcpStream as StdTcpStream, ToSocketAddrs};
use std::pin::Pin;
use std::time::Duration;

use async_imap::error::{Error as ImapError, Result as ImapResult};
use async_imap::imap_proto::{
    Address, AttributeValue, Envelope, MailboxDatum, MessageSection, RequestId, Response,
    ResponseCode, SectionPath, Status,
};
use async_imap::types::{Capability, Flag, Mailbox, NameAttribute};
use tokio::net::TcpStream;
use tokio_io_timeout::TimeoutStream;

use super::{
    EmailConfig, IDLE_GREETING_TIMEOUT_SECS, IMAP_CONNECT_TIMEOUT_SECS, IMAP_SYNC_IO_TIMEOUT_SECS,
    IMAP_TCP_KEEPALIVE_SECS,
};

/// TCP → per-I/O timeouts → TLS. The timeout layer sits under TLS so the handshake is
/// bounded too, exactly like the old socket-level `set_read_timeout`.
type TimedTcp = Pin<Box<TimeoutStream<TcpStream>>>;
type ImapTlsStream = tokio_native_tls::TlsStream<TimedTcp>;

/// What a session can run over: the TLS stream in production, an in-memory duplex in
/// the scripted-server tests.
pub(super) trait ImapIo:
    tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send
{
}
impl<T> ImapIo for T where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + std::fmt::Debug + Send
{
}

fn timed_out(what: &str) -> ImapError {
    ImapError::Io(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        format!("{what} timed out"),
    ))
}

/// Run `fut` to completion from synchronous code on the Tauri tokio runtime.
///
/// - On a runtime worker thread (an async command calling the sync engine directly):
///   `block_in_place` hands the worker's other tasks off first, then blocks — the same
///   "this thread blocks on IMAP" behavior the std-socket crate had, minus the panic
///   a nested `block_on` would raise.
/// - On a `spawn_blocking` thread (the common case): `block_in_place` is a no-op
///   wrapper and `Handle::block_on` is the documented way in.
/// - Outside any runtime (a plain thread): Tauri's global runtime.
fn block_on<F>(fut: F) -> F::Output
where
    F: Future + Send,
    F::Output: Send,
{
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(|| handle.block_on(fut))
        }
        // A current-thread runtime can't block in place; park the call on a scoped
        // thread instead (only reachable from `#[tokio::test]`-style callers).
        Ok(_) => std::thread::scope(|scope| {
            scope
                .spawn(|| tauri::async_runtime::block_on(fut))
                .join()
                .expect("imap_block_on_thread_panicked")
        }),
        Err(_) => tauri::async_runtime::block_on(fut),
    }
}

/// SASL `XOAUTH2` authenticator. `process` returns the RAW SASL string — async-imap
/// base64-encodes it before sending (EM-2).
struct Xoauth2 {
    user: String,
    access_token: String,
}

impl async_imap::Authenticator for Xoauth2 {
    type Response = String;
    fn process(&mut self, _challenge: &[u8]) -> Self::Response {
        crate::commands::oauth_flow::xoauth2_sasl(&self.user, &self.access_token)
    }
}

// ── Owned response types (the subset of the old crate's API the engine reads) ──────

/// One `FETCH` response, owned. Mirrors the accessors of `async_imap::types::Fetch`.
#[derive(Debug, Default)]
pub(super) struct ImapFetch {
    pub uid: Option<u32>,
    pub size: Option<u32>,
    flags: Vec<Flag<'static>>,
    envelope: Option<Envelope<'static>>,
    header: Option<Vec<u8>>,
    body: Option<Vec<u8>>,
}

impl ImapFetch {
    fn from_attrs(attrs: &[AttributeValue<'_>]) -> Self {
        let mut fetch = ImapFetch::default();
        for attr in attrs {
            match attr {
                AttributeValue::Uid(uid) => fetch.uid = Some(*uid),
                AttributeValue::Rfc822Size(size) => fetch.size = Some(*size),
                AttributeValue::Flags(raw) => fetch
                    .flags
                    .extend(raw.iter().map(|s| Flag::from(s.to_string()))),
                // First match wins, like the async-imap / imap accessors.
                AttributeValue::Envelope(env) if fetch.envelope.is_none() => {
                    fetch.envelope = Some(owned_envelope(env));
                }
                AttributeValue::BodySection {
                    section: Some(SectionPath::Full(MessageSection::Header)),
                    data: Some(hdr),
                    ..
                }
                | AttributeValue::Rfc822Header(Some(hdr))
                    if fetch.header.is_none() =>
                {
                    fetch.header = Some(hdr.to_vec());
                }
                AttributeValue::BodySection {
                    section: None,
                    data: Some(body),
                    ..
                }
                | AttributeValue::Rfc822(Some(body))
                    if fetch.body.is_none() =>
                {
                    fetch.body = Some(body.to_vec());
                }
                _ => {}
            }
        }
        fetch
    }

    pub(super) fn flags(&self) -> impl Iterator<Item = &Flag<'static>> {
        self.flags.iter()
    }

    pub(super) fn envelope(&self) -> Option<&Envelope<'static>> {
        self.envelope.as_ref()
    }

    /// `BODY[HEADER]` / `BODY[HEADER.FIELDS (…)]` / `RFC822.HEADER` bytes.
    pub(super) fn header(&self) -> Option<&[u8]> {
        self.header.as_deref()
    }

    /// `BODY[]` / `RFC822` bytes.
    pub(super) fn body(&self) -> Option<&[u8]> {
        self.body.as_deref()
    }
}

fn owned_bytes(value: &Option<Cow<'_, [u8]>>) -> Option<Cow<'static, [u8]>> {
    value.as_ref().map(|v| Cow::Owned(v.to_vec()))
}

fn owned_addresses(list: &Option<Vec<Address<'_>>>) -> Option<Vec<Address<'static>>> {
    list.as_ref().map(|addrs| {
        addrs
            .iter()
            .map(|addr| Address {
                name: owned_bytes(&addr.name),
                adl: owned_bytes(&addr.adl),
                mailbox: owned_bytes(&addr.mailbox),
                host: owned_bytes(&addr.host),
            })
            .collect()
    })
}

fn owned_envelope(env: &Envelope<'_>) -> Envelope<'static> {
    Envelope {
        date: owned_bytes(&env.date),
        subject: owned_bytes(&env.subject),
        from: owned_addresses(&env.from),
        sender: owned_addresses(&env.sender),
        reply_to: owned_addresses(&env.reply_to),
        to: owned_addresses(&env.to),
        cc: owned_addresses(&env.cc),
        bcc: owned_addresses(&env.bcc),
        in_reply_to: owned_bytes(&env.in_reply_to),
        message_id: owned_bytes(&env.message_id),
    }
}

/// One `LIST` response, owned.
#[derive(Debug)]
pub(super) struct ImapName {
    name: String,
    delimiter: Option<String>,
    attributes: Vec<NameAttribute<'static>>,
}

impl ImapName {
    pub(super) fn name(&self) -> &str {
        &self.name
    }

    pub(super) fn delimiter(&self) -> Option<&str> {
        self.delimiter.as_deref()
    }

    pub(super) fn attributes(&self) -> &[NameAttribute<'static>] {
        &self.attributes
    }
}

/// `CAPABILITY` result. `has_str` matches the old crate (case-insensitive only for
/// `IMAP4rev1` and the `AUTH=` prefix).
#[derive(Debug, Default)]
pub(super) struct ImapCapabilities(HashSet<Capability>);

impl ImapCapabilities {
    pub(super) fn has_str<S: AsRef<str>>(&self, cap: S) -> bool {
        const AUTH_PREFIX: &str = "AUTH=";
        let s = cap.as_ref();
        if s.eq_ignore_ascii_case("IMAP4rev1") {
            return self.0.contains(&Capability::Imap4rev1);
        }
        if s.len() > AUTH_PREFIX.len() {
            let (pre, val) = s.split_at(AUTH_PREFIX.len());
            if pre.eq_ignore_ascii_case(AUTH_PREFIX) {
                return self.0.contains(&Capability::Auth(val.to_string()));
            }
        }
        self.0.contains(&Capability::Atom(s.to_string()))
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = &Capability> {
        self.0.iter()
    }
}

// ── Tagged-command plumbing ──────────────────────────────────────────────────────

/// The same quoting the old crate applied to mailbox names (and async-imap's own
/// private `validate_str`): wrap in quotes, escape `\` and `"`, refuse CR/LF.
fn quote_mailbox(value: &str) -> ImapResult<String> {
    if let Some(bad) = value.chars().find(|c| *c == '\r' || *c == '\n') {
        return Err(ImapError::Validate(async_imap::error::ValidateError(bad)));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

fn status_error(status: &Status, code: Option<&ResponseCode<'_>>, info: Option<&str>) -> ImapError {
    match status {
        Status::Bad => ImapError::Bad(format!("code: {code:?}, info: {info:?}")),
        Status::No => ImapError::No(format!("code: {code:?}, info: {info:?}")),
        _ => ImapError::Io(std::io::Error::other(format!(
            "status: {status:?}, code: {code:?}, information: {info:?}"
        ))),
    }
}

/// Send `command`, hand every untagged response to `on_untagged`, and finish on the
/// matching tagged response: `OK` → `Ok`, `NO`/`BAD` → `Err`, EOF → `ConnectionLost`.
/// Any other tagged `NO`/`BAD` seen on the way also fails the command (the old crate's
/// behavior). Responses are drained to the tag even when the caller ignores them, so
/// the connection stays in sync for the next command.
async fn run_tagged<T: ImapIo, F>(
    session: &mut async_imap::Session<T>,
    command: &str,
    mut on_untagged: F,
) -> ImapResult<()>
where
    F: FnMut(&Response<'_>) + Send,
{
    let id: RequestId = session.run_command(command).await?;
    loop {
        let Some(resp) = session.read_response().await? else {
            return Err(ImapError::ConnectionLost);
        };
        match resp.parsed() {
            Response::Done {
                tag,
                status,
                outcome,
            } => {
                if !matches!(status, Status::Ok) {
                    return Err(status_error(
                        status,
                        outcome.code.as_ref(),
                        outcome.information.as_deref(),
                    ));
                }
                if tag == &id {
                    return Ok(());
                }
            }
            other => on_untagged(other),
        }
    }
}

// ── The blocking session facade ──────────────────────────────────────────────────

/// An authenticated IMAP session. Same method names and result shapes the engine used
/// with the `imap` 2.x crate; each call blocks the current thread until it finishes.
pub(super) struct ImapSession<T: ImapIo = ImapTlsStream> {
    /// `None` once the connection is known dead (EOF, or IDLE we couldn't enter or
    /// leave) — every later command then reports `ConnectionLost`, as the old dead
    /// socket would have.
    inner: Option<async_imap::Session<T>>,
    /// Bound on entering IDLE (`IDLE` → `+`) and leaving it (`DONE` → tagged reply).
    /// The IDLE connection runs without socket timeouts, so without this a server
    /// that never answers would park the cycle forever.
    idle_handshake: Duration,
}

/// Outcome of one IDLE wait (the old `imap::extensions::idle::WaitOutcome`).
#[derive(Debug, PartialEq, Eq)]
pub(super) enum IdleWaitOutcome {
    MailboxChanged,
    TimedOut,
}

impl<T: ImapIo> ImapSession<T> {
    fn conn(&mut self) -> ImapResult<&mut async_imap::Session<T>> {
        self.inner.as_mut().ok_or(ImapError::ConnectionLost)
    }

    pub(super) fn capabilities(&mut self) -> ImapResult<ImapCapabilities> {
        let session = self.conn()?;
        block_on(async move {
            let mut caps = HashSet::new();
            run_tagged(session, "CAPABILITY", |resp| {
                if let Response::Capabilities(list) = resp {
                    caps.extend(list.iter().map(Capability::from));
                }
            })
            .await?;
            Ok(ImapCapabilities(caps))
        })
    }

    pub(super) fn select<S: AsRef<str>>(&mut self, mailbox_name: S) -> ImapResult<Mailbox> {
        let command = format!("SELECT {}", quote_mailbox(mailbox_name.as_ref())?);
        let session = self.conn()?;
        block_on(async move {
            let mut mailbox = Mailbox::default();
            run_tagged(session, &command, |resp| match resp {
                // Untagged non-OK status lines are warnings here, not failures (as before).
                Response::Data {
                    status: Status::Ok,
                    outcome,
                } => match &outcome.code {
                    Some(ResponseCode::UidValidity(uid)) => mailbox.uid_validity = Some(*uid),
                    Some(ResponseCode::UidNext(next)) => mailbox.uid_next = Some(*next),
                    Some(ResponseCode::HighestModSeq(modseq)) => {
                        mailbox.highest_modseq = Some(*modseq)
                    }
                    Some(ResponseCode::Unseen(n)) => mailbox.unseen = Some(*n),
                    Some(ResponseCode::PermanentFlags(flags)) => mailbox
                        .permanent_flags
                        .extend(flags.iter().map(|s| Flag::from(s.to_string()))),
                    _ => {}
                },
                Response::MailboxData(MailboxDatum::Exists(n)) => mailbox.exists = *n,
                Response::MailboxData(MailboxDatum::Recent(n)) => mailbox.recent = *n,
                Response::MailboxData(MailboxDatum::Flags(flags)) => mailbox
                    .flags
                    .extend(flags.iter().map(|s| Flag::from(s.to_string()))),
                _ => {}
            })
            .await?;
            Ok(mailbox)
        })
    }

    pub(super) fn list(
        &mut self,
        reference_name: Option<&str>,
        mailbox_pattern: Option<&str>,
    ) -> ImapResult<Vec<ImapName>> {
        // Pattern is sent verbatim (wildcards), reference quoted — same as both crates.
        let command = format!(
            "LIST {} {}",
            quote_mailbox(reference_name.unwrap_or(""))?,
            mailbox_pattern.unwrap_or("\"\"")
        );
        let session = self.conn()?;
        block_on(async move {
            let mut names = Vec::new();
            run_tagged(session, &command, |resp| {
                if let Response::MailboxData(MailboxDatum::List(data)) = resp {
                    names.push(ImapName {
                        name: data.name.to_string(),
                        delimiter: data.delimiter.as_ref().map(|d| d.to_string()),
                        attributes: data
                            .name_attributes
                            .iter()
                            .map(|attr| attr.clone().into_owned())
                            .collect(),
                    });
                }
            })
            .await?;
            Ok(names)
        })
    }

    fn fetch_command(&mut self, command: String) -> ImapResult<Vec<ImapFetch>> {
        let session = self.conn()?;
        block_on(async move {
            let mut fetches = Vec::new();
            run_tagged(session, &command, |resp| {
                if let Response::Fetch(_, attrs) = resp {
                    fetches.push(ImapFetch::from_attrs(attrs));
                }
            })
            .await?;
            Ok(fetches)
        })
    }

    pub(super) fn fetch<S1: AsRef<str>, S2: AsRef<str>>(
        &mut self,
        sequence_set: S1,
        query: S2,
    ) -> ImapResult<Vec<ImapFetch>> {
        self.fetch_command(format!(
            "FETCH {} {}",
            sequence_set.as_ref(),
            query.as_ref()
        ))
    }

    pub(super) fn uid_fetch<S1: AsRef<str>, S2: AsRef<str>>(
        &mut self,
        uid_set: S1,
        query: S2,
    ) -> ImapResult<Vec<ImapFetch>> {
        self.fetch_command(format!("UID FETCH {} {}", uid_set.as_ref(), query.as_ref()))
    }

    pub(super) fn uid_search<S: AsRef<str>>(&mut self, query: S) -> ImapResult<HashSet<u32>> {
        let command = format!("UID SEARCH {}", query.as_ref());
        let session = self.conn()?;
        block_on(async move {
            let mut uids = HashSet::new();
            run_tagged(session, &command, |resp| {
                if let Response::MailboxData(MailboxDatum::Search(found)) = resp {
                    uids.extend(found.iter().copied());
                }
            })
            .await?;
            Ok(uids)
        })
    }

    /// Runs a command whose untagged output nobody reads, checking its tagged status.
    fn simple(&mut self, command: String) -> ImapResult<()> {
        let session = self.conn()?;
        block_on(async move { run_tagged(session, &command, |_| {}).await })
    }

    /// `UID STORE`. The engine only ever sends `.SILENT` queries and never read the
    /// echoed FETCH lines, so they are drained rather than returned.
    pub(super) fn uid_store<S1: AsRef<str>, S2: AsRef<str>>(
        &mut self,
        uid_set: S1,
        query: S2,
    ) -> ImapResult<()> {
        self.simple(format!("UID STORE {} {}", uid_set.as_ref(), query.as_ref()))
    }

    pub(super) fn uid_copy<S1: AsRef<str>, S2: AsRef<str>>(
        &mut self,
        uid_set: S1,
        mailbox_name: S2,
    ) -> ImapResult<()> {
        let command = format!(
            "UID COPY {} {}",
            uid_set.as_ref(),
            quote_mailbox(mailbox_name.as_ref())?
        );
        self.simple(command)
    }

    pub(super) fn uid_expunge<S: AsRef<str>>(&mut self, uid_set: S) -> ImapResult<()> {
        self.simple(format!("UID EXPUNGE {}", uid_set.as_ref()))
    }

    pub(super) fn expunge(&mut self) -> ImapResult<()> {
        self.simple("EXPUNGE".to_string())
    }

    pub(super) fn create<S: AsRef<str>>(&mut self, mailbox_name: S) -> ImapResult<()> {
        let command = format!("CREATE {}", quote_mailbox(mailbox_name.as_ref())?);
        self.simple(command)
    }

    pub(super) fn noop(&mut self) -> ImapResult<()> {
        self.simple("NOOP".to_string())
    }

    /// `APPEND` with no flags and no date (the old `append(mailbox, content)`).
    pub(super) fn append<S: AsRef<str>, B: AsRef<[u8]>>(
        &mut self,
        mailbox: S,
        content: B,
    ) -> ImapResult<()> {
        let session = self.conn()?;
        block_on(session.append(mailbox.as_ref(), None, None, content.as_ref()))
    }

    pub(super) fn logout(&mut self) -> ImapResult<()> {
        let session = self.conn()?;
        block_on(session.logout())
    }

    /// Enter IDLE: send `IDLE` and wait (bounded) for the `+` continuation. A tagged
    /// `NO`/`BAD` instead is an error and leaves the session usable, like the old crate;
    /// a timeout or EOF marks the connection dead. The returned handle ends IDLE with
    /// `DONE` when it is dropped, unless the server already ended it.
    pub(super) fn idle(&mut self) -> ImapResult<ImapIdle<'_, T>> {
        let limit = self.idle_handshake;
        let session = self.conn()?;
        let started = block_on(async move {
            let tag = session.run_command("IDLE").await?;
            let handshake = async {
                loop {
                    let Some(resp) = session.read_response().await? else {
                        return Err(ImapError::ConnectionLost);
                    };
                    match resp.parsed() {
                        Response::Continue { .. } => return Ok(()),
                        Response::Done {
                            tag: done_tag,
                            status,
                            outcome,
                        } if done_tag == &tag => {
                            return Err(match status {
                                Status::Ok => ImapError::Io(std::io::Error::other(
                                    "idle_completed_before_continuation",
                                )),
                                _ => status_error(
                                    status,
                                    outcome.code.as_ref(),
                                    outcome.information.as_deref(),
                                ),
                            });
                        }
                        // Unilateral data before the continuation: not ours to act on.
                        _ => {}
                    }
                }
            };
            match tokio::time::timeout(limit, handshake).await {
                Ok(Ok(())) => Ok(tag),
                Ok(Err(error)) => Err(error),
                Err(_) => Err(timed_out("imap_idle_start")),
            }
        });
        match started {
            Ok(tag) => Ok(ImapIdle {
                owner: self,
                tag,
                idling: true,
            }),
            Err(error) => {
                if !matches!(error, ImapError::No(_) | ImapError::Bad(_)) {
                    self.inner = None;
                }
                Err(error)
            }
        }
    }
}

/// An active IDLE on an [`ImapSession`].
pub(super) struct ImapIdle<'a, T: ImapIo = ImapTlsStream> {
    owner: &'a mut ImapSession<T>,
    tag: RequestId,
    /// False once the server ended the IDLE itself (or the connection died): no `DONE`.
    idling: bool,
}

impl<T: ImapIo> ImapIdle<'_, T> {
    /// Block until the server reports anything (`MailboxChanged`) or `timeout` passes
    /// with no response at all (`TimedOut`). Keepalives (untagged `OK`, e.g. Dovecot's
    /// `* OK Still here`) reset the timer but aren't a change. The server ending the
    /// IDLE itself (tagged completion, `* BYE`) counts as a change, so the cycle
    /// resyncs at once instead of sitting out the dead-connection silence. EOF is an
    /// error.
    pub(super) fn wait_with_timeout(mut self, timeout: Duration) -> ImapResult<IdleWaitOutcome> {
        let tag = self.tag.clone();
        let session = self.owner.conn()?;
        let waited = block_on(async move {
            loop {
                let next = match tokio::time::timeout(timeout, session.read_response()).await {
                    Err(_) => return Ok((IdleWaitOutcome::TimedOut, true)),
                    Ok(next) => next?,
                };
                let Some(resp) = next else {
                    return Err(ImapError::ConnectionLost);
                };
                match resp.parsed() {
                    Response::Continue { .. } => {}
                    Response::Data {
                        status: Status::Ok, ..
                    } => {}
                    Response::Done { tag: done_tag, .. } if done_tag == &tag => {
                        return Ok((IdleWaitOutcome::MailboxChanged, false));
                    }
                    _ => return Ok((IdleWaitOutcome::MailboxChanged, true)),
                }
            }
        });
        match waited {
            Ok((outcome, still_idling)) => {
                self.idling = still_idling;
                Ok(outcome)
            }
            Err(error) => {
                self.idling = false;
                self.owner.inner = None;
                Err(error)
            }
        }
        // `self` drops here → DONE (when still idling).
    }
}

impl<T: ImapIo> Drop for ImapIdle<'_, T> {
    fn drop(&mut self) {
        if !self.idling {
            return;
        }
        // We don't want to panic here if we can't terminate the IDLE; a connection we
        // can't bring back out of IDLE is dead for every later command.
        let limit = self.owner.idle_handshake;
        let tag = self.tag.clone();
        let Some(session) = self.owner.inner.as_mut() else {
            return;
        };
        let done = block_on(async move {
            let finish = async {
                session.run_command_untagged("DONE").await?;
                loop {
                    let Some(resp) = session.read_response().await? else {
                        return Err(ImapError::ConnectionLost);
                    };
                    if let Response::Done {
                        tag: done_tag,
                        status,
                        outcome,
                    } = resp.parsed()
                    {
                        if done_tag == &tag {
                            return match status {
                                Status::Ok => Ok(()),
                                _ => Err(status_error(
                                    status,
                                    outcome.code.as_ref(),
                                    outcome.information.as_deref(),
                                )),
                            };
                        }
                    }
                }
            };
            tokio::time::timeout(limit, finish)
                .await
                .unwrap_or_else(|_| Err(timed_out("imap_idle_done")))
        });
        if done.is_err() {
            self.owner.inner = None;
        }
    }
}

// ── Connect ──────────────────────────────────────────────────────────────────────

enum ImapSessionProfile {
    CommandProfile,
    IdleProfile,
}

struct ImapSessionFactory;

impl ImapSessionFactory {
    fn open(config: &EmailConfig, profile: ImapSessionProfile) -> Result<ImapSession, String> {
        let mut session = block_on(Self::open_async(config, &profile))?;
        if matches!(profile, ImapSessionProfile::IdleProfile) {
            // Enter runtime IDLE mode with blocking socket semantics after auth succeeds.
            let timed = session.get_mut().get_mut().get_mut().get_mut();
            timed.as_mut().set_read_timeout_pinned(None);
            timed.as_mut().set_write_timeout_pinned(None);
        }
        Ok(ImapSession {
            inner: Some(session),
            idle_handshake: Duration::from_secs(IDLE_GREETING_TIMEOUT_SECS),
        })
    }

    async fn open_async(
        config: &EmailConfig,
        profile: &ImapSessionProfile,
    ) -> Result<async_imap::Session<ImapTlsStream>, String> {
        // Same system trust store / native-tls defaults as before.
        let tls = tokio_native_tls::TlsConnector::from(
            native_tls::TlsConnector::builder()
                .build()
                .map_err(|e| e.to_string())?,
        );
        let (read_timeout, write_timeout) = Self::timeouts_for(profile);
        let std_stream = open_tuned_tcp_stream(config.imap_host(), config.imap_port())?;
        std_stream
            .set_nonblocking(true)
            .map_err(|e| format!("imap_set_nonblocking_failed:{e}"))?;
        let stream = TcpStream::from_std(std_stream)
            .map_err(|e| format!("imap_stream_register_failed:{e}"))?;
        let mut timed = TimeoutStream::new(stream);
        timed.set_read_timeout(read_timeout);
        timed.set_write_timeout(write_timeout);
        let tls_stream: ImapTlsStream = tls
            .connect(config.imap_host(), Box::pin(timed))
            .await
            .map_err(|e| format!("imap_tls_failed:{e}"))?;
        authenticate(tls_stream, config).await
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

/// Greeting + LOGIN / XOAUTH2 over an already-connected stream.
async fn authenticate<T: ImapIo>(
    stream: T,
    config: &EmailConfig,
) -> Result<async_imap::Session<T>, String> {
    let mut client = async_imap::Client::new(stream);
    client
        .read_response()
        .await
        .map_err(|e| format!("imap_greeting_failed:{e}"))?
        .ok_or_else(|| format!("imap_greeting_failed:{}", ImapError::ConnectionLost))?;
    // OAuth accounts authenticate via XOAUTH2 with a (pre-refreshed) access
    // token; password accounts use LOGIN. No plaintext-fallback path exists.
    let session = if let Some(token) = config.oauth_access_token.as_deref() {
        let auth = Xoauth2 {
            user: config.email.clone(),
            access_token: token.to_string(),
        };
        client
            .authenticate("XOAUTH2", auth)
            .await
            .map_err(|e| e.0.to_string())?
    } else {
        client
            .login(&config.email, &config.password)
            .await
            .map_err(|e| e.0.to_string())?
    };
    Ok(session)
}

/// Resolve + connect with keepalive and a bounded connect, on the calling thread
/// (blocking, as before); the stream is handed to tokio afterwards.
fn open_tuned_tcp_stream(host: &str, port: u16) -> Result<StdTcpStream, String> {
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
    Ok(socket.into())
}

pub(super) fn open_imap_session(config: &EmailConfig) -> Result<ImapSession, String> {
    ImapSessionFactory::open(config, ImapSessionProfile::CommandProfile)
}

pub(super) fn open_idle_imap_session(config: &EmailConfig) -> Result<ImapSession, String> {
    ImapSessionFactory::open(config, ImapSessionProfile::IdleProfile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_mailbox_escapes_like_the_old_crate() {
        assert_eq!(quote_mailbox("INBOX").unwrap(), "\"INBOX\"");
        assert_eq!(quote_mailbox("a\"b\\c").unwrap(), "\"a\\\"b\\\\c\"");
        assert!(quote_mailbox("bad\r\nname").is_err());
    }

    #[test]
    fn capabilities_has_str_matches_the_old_rules() {
        let caps = ImapCapabilities(HashSet::from([
            Capability::Imap4rev1,
            Capability::Auth("XOAUTH2".to_string()),
            Capability::Atom("IDLE".to_string()),
        ]));
        assert!(caps.has_str("imap4rev1"));
        assert!(caps.has_str("auth=XOAUTH2"));
        assert!(caps.has_str("IDLE"));
        assert!(!caps.has_str("idle"));
        assert!(!caps.has_str("UIDPLUS"));
    }

    #[test]
    fn fetch_reads_uid_flags_envelope_header_and_body() {
        let raw = b"* 12 FETCH (UID 42 FLAGS (\\Seen \\Flagged $Label) RFC822.SIZE 9 \
ENVELOPE (\"Mon, 1 Jan 2024 00:00:00 +0000\" \"Hi\" ((\"Ann\" NIL \"ann\" \"x.com\")) NIL NIL \
((NIL NIL \"bob\" \"y.com\")) NIL NIL NIL \"<m1@x.com>\") \
BODY[HEADER.FIELDS (REFERENCES)] {23}\r\nReferences: <r@x.com>\r\n BODY[] {4}\r\nbody)\r\n";
        let (_, resp) = Response::parse(raw).expect("parses");
        let Response::Fetch(_, attrs) = resp else {
            panic!("not a fetch");
        };
        let fetch = ImapFetch::from_attrs(&attrs);
        assert_eq!(fetch.uid, Some(42));
        assert_eq!(fetch.size, Some(9));
        assert!(fetch.flags().any(|f| matches!(f, Flag::Seen)));
        assert!(fetch.flags().any(|f| matches!(f, Flag::Flagged)));
        let env = fetch.envelope().expect("envelope");
        assert_eq!(env.subject.as_deref(), Some(&b"Hi"[..]));
        assert_eq!(env.message_id.as_deref(), Some(&b"<m1@x.com>"[..]));
        let to = env.to.as_ref().expect("to");
        assert_eq!(to[0].mailbox.as_deref(), Some(&b"bob"[..]));
        assert_eq!(fetch.header(), Some(&b"References: <r@x.com>\r\n"[..]));
        assert_eq!(fetch.body(), Some(&b"body"[..]));
    }
}

/// The facade against a scripted fake server over an in-memory duplex (no TLS): the
/// tagged-status checks, EOF handling, the `block_on` bridge and the IDLE handshake.
#[cfg(test)]
mod scripted_server_tests {
    use std::time::Instant;

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};

    use super::*;

    enum After {
        Next,
        /// Close the connection after replying (EOF for the client).
        Close,
        /// Never read or write again, but keep the connection open.
        Hang,
    }

    /// One client line the server expects (substring) and the raw reply it sends;
    /// `{tag}` becomes the command's tag (for `DONE`, the IDLE's tag).
    struct Step {
        expect: &'static str,
        reply: &'static str,
        after: After,
    }

    fn step(expect: &'static str, reply: &'static str) -> Step {
        Step {
            expect,
            reply,
            after: After::Next,
        }
    }

    fn step_then(expect: &'static str, reply: &'static str, after: After) -> Step {
        Step {
            expect,
            reply,
            after,
        }
    }

    async fn serve(stream: DuplexStream, steps: Vec<Step>) {
        let (read, mut write) = tokio::io::split(stream);
        let mut read = BufReader::new(read);
        write.write_all(b"* OK fake imap ready\r\n").await.unwrap();
        let mut last_tag = String::new();
        for step in steps {
            let mut line = String::new();
            if read.read_line(&mut line).await.unwrap_or(0) == 0 {
                panic!("client hung up; expected {:?}", step.expect);
            }
            let line = line.trim_end().to_string();
            if line != "DONE" {
                last_tag = line.split(' ').next().unwrap_or_default().to_string();
            }
            assert!(
                line.contains(step.expect),
                "expected {:?}, got {line:?}",
                step.expect
            );
            write
                .write_all(step.reply.replace("{tag}", &last_tag).as_bytes())
                .await
                .unwrap();
            match step.after {
                After::Next => {}
                After::Close => return,
                After::Hang => std::future::pending::<()>().await,
            }
        }
        // Script done: anything more from the client is unexpected.
        let mut extra = String::new();
        if read.read_line(&mut extra).await.unwrap_or(0) > 0 {
            panic!("unexpected client line after script: {extra:?}");
        }
    }

    /// A logged-in session talking to `steps` (LOGIN is answered first).
    fn session_with(
        steps: Vec<Step>,
    ) -> (
        ImapSession<DuplexStream>,
        tauri::async_runtime::JoinHandle<()>,
    ) {
        let (client, server) = tokio::io::duplex(64 * 1024);
        let mut script = vec![step("LOGIN", "{tag} OK LOGIN completed\r\n")];
        script.extend(steps);
        let server = tauri::async_runtime::spawn(serve(server, script));
        let config = EmailConfig {
            provider: "custom".to_string(),
            email: "me@example.com".to_string(),
            password: "pw".to_string(),
            oauth_access_token: None,
            imap_host: Some("imap.example.com".to_string()),
            smtp_host: None,
            imap_port: Some(993),
            smtp_port: None,
        };
        let inner = block_on(authenticate(client, &config)).expect("login");
        let session = ImapSession {
            inner: Some(inner),
            idle_handshake: Duration::from_millis(300),
        };
        (session, server)
    }

    /// Drop the client, then surface any assertion the fake server tripped.
    fn finish(session: ImapSession<DuplexStream>, server: tauri::async_runtime::JoinHandle<()>) {
        drop(session);
        tauri::async_runtime::block_on(server).expect("fake server script held");
    }

    #[test]
    fn select_fetch_and_logout_follow_the_script() {
        let (mut session, server) = session_with(vec![
            step(
                "SELECT \"INBOX\"",
                "* 3 EXISTS\r\n* OK [UIDVALIDITY 7] v\r\n* OK [UIDNEXT 11] n\r\n{tag} OK [READ-WRITE] done\r\n",
            ),
            step(
                "UID FETCH 9:10 (UID FLAGS)",
                "* 1 FETCH (UID 9 FLAGS (\\Seen))\r\n* 2 FETCH (UID 10 FLAGS ())\r\n{tag} OK done\r\n",
            ),
            step("LOGOUT", "* BYE bye\r\n{tag} OK done\r\n"),
        ]);
        let mailbox = session.select("INBOX").expect("select");
        assert_eq!(mailbox.exists, 3);
        assert_eq!(mailbox.uid_validity, Some(7));
        assert_eq!(mailbox.uid_next, Some(11));
        let fetches = session.uid_fetch("9:10", "(UID FLAGS)").expect("fetch");
        assert_eq!(
            fetches.iter().map(|f| f.uid).collect::<Vec<_>>(),
            vec![Some(9), Some(10)]
        );
        assert!(fetches[0].flags().any(|f| matches!(f, Flag::Seen)));
        assert_eq!(fetches[1].flags().count(), 0);
        session.logout().expect("logout");
        finish(session, server);
    }

    #[test]
    fn tagged_no_is_an_error_and_the_session_stays_usable() {
        let (mut session, server) = session_with(vec![
            step(
                "UID FETCH",
                "* 1 FETCH (UID 9)\r\n{tag} NO [UNAVAILABLE] try later\r\n",
            ),
            step("SELECT", "{tag} NO no such mailbox\r\n"),
            step("NOOP", "{tag} OK done\r\n"),
        ]);
        assert!(matches!(
            session.uid_fetch("9", "(UID)"),
            Err(ImapError::No(_))
        ));
        assert!(matches!(session.select("Nope"), Err(ImapError::No(_))));
        session.noop().expect("still in sync after NO");
        finish(session, server);
    }

    #[test]
    fn tagged_bad_is_an_error() {
        let (mut session, server) = session_with(vec![
            step("UID SEARCH", "{tag} BAD [BADCHARSET] unsupported\r\n"),
            step("UID STORE", "{tag} BAD read-only\r\n"),
        ]);
        assert!(matches!(
            session.uid_search("CHARSET UTF-8 TEXT \"x\""),
            Err(ImapError::Bad(_))
        ));
        assert!(matches!(
            session.uid_store("9", "+FLAGS.SILENT (\\Seen)"),
            Err(ImapError::Bad(_))
        ));
        finish(session, server);
    }

    #[test]
    fn eof_mid_command_is_an_error() {
        let (mut session, _server) = session_with(vec![step_then(
            "UID FETCH",
            "* 1 FETCH (UID 9)\r\n",
            After::Close,
        )]);
        assert!(session.uid_fetch("9", "(UID)").is_err());
        assert!(session.noop().is_err());
    }

    #[test]
    fn eof_mid_select_is_an_error_not_an_empty_mailbox() {
        let (mut session, _server) =
            session_with(vec![step_then("SELECT", "* 3 EXISTS\r\n", After::Close)]);
        assert!(session.select("INBOX").is_err());
    }

    #[test]
    fn idle_reports_new_data_then_leaves_with_done() {
        let (mut session, server) = session_with(vec![
            step("IDLE", "+ idling\r\n* 4 EXISTS\r\n"),
            step("DONE", "{tag} OK IDLE terminated\r\n"),
            step("NOOP", "{tag} OK done\r\n"),
        ]);
        let outcome = session
            .idle()
            .expect("idle")
            .wait_with_timeout(Duration::from_secs(5));
        assert_eq!(outcome.expect("wait"), IdleWaitOutcome::MailboxChanged);
        session.noop().expect("session back after DONE");
        finish(session, server);
    }

    #[test]
    fn idle_silence_times_out_and_keepalives_do_not_count() {
        let (mut session, server) = session_with(vec![
            step("IDLE", "+ idling\r\n* OK Still here\r\n"),
            step("DONE", "{tag} OK IDLE terminated\r\n"),
            step("NOOP", "{tag} OK done\r\n"),
        ]);
        let outcome = session
            .idle()
            .expect("idle")
            .wait_with_timeout(Duration::from_millis(200));
        assert_eq!(outcome.expect("wait"), IdleWaitOutcome::TimedOut);
        session.noop().expect("session back after DONE");
        finish(session, server);
    }

    #[test]
    fn idle_refused_with_no_is_an_error_without_hanging() {
        let (mut session, server) = session_with(vec![
            step("IDLE", "{tag} NO IDLE not allowed\r\n"),
            step("NOOP", "{tag} OK done\r\n"),
        ]);
        let started = Instant::now();
        assert!(matches!(session.idle().err(), Some(ImapError::No(_))));
        assert!(started.elapsed() < Duration::from_secs(2));
        session
            .noop()
            .expect("a refused IDLE leaves the session usable");
        finish(session, server);
    }

    #[test]
    fn idle_without_a_continuation_times_out() {
        let (mut session, _server) = session_with(vec![step_then("IDLE", "", After::Hang)]);
        let started = Instant::now();
        assert!(session.idle().is_err());
        assert!(started.elapsed() < Duration::from_secs(2));
        // Unknown protocol state: the connection is treated as dead.
        assert!(matches!(session.noop(), Err(ImapError::ConnectionLost)));
    }

    #[test]
    fn server_ending_idle_is_a_prompt_change_without_done() {
        for reply in [
            "+ idling\r\n{tag} OK IDLE done by server\r\n",
            "+ idling\r\n{tag} NO IDLE cancelled\r\n",
        ] {
            // The script expects NOOP next, so a stray DONE would trip the server.
            let (mut session, server) =
                session_with(vec![step("IDLE", reply), step("NOOP", "{tag} OK done\r\n")]);
            let started = Instant::now();
            let outcome = session
                .idle()
                .expect("idle")
                .wait_with_timeout(Duration::from_secs(30));
            assert_eq!(outcome.expect("wait"), IdleWaitOutcome::MailboxChanged);
            assert!(started.elapsed() < Duration::from_secs(2));
            session.noop().expect("session usable");
            finish(session, server);
        }
    }

    #[test]
    fn bye_during_idle_is_a_prompt_change_and_the_connection_is_dropped() {
        let (mut session, _server) = session_with(vec![step_then(
            "IDLE",
            "+ idling\r\n* BYE server shutting down\r\n",
            After::Close,
        )]);
        let started = Instant::now();
        let outcome = session
            .idle()
            .expect("idle")
            .wait_with_timeout(Duration::from_secs(30));
        assert_eq!(outcome.expect("wait"), IdleWaitOutcome::MailboxChanged);
        assert!(started.elapsed() < Duration::from_secs(2));
        // DONE can't complete on a closed connection.
        assert!(matches!(session.noop(), Err(ImapError::ConnectionLost)));
    }

    #[test]
    fn eof_during_idle_is_an_error() {
        let (mut session, _server) =
            session_with(vec![step_then("IDLE", "+ idling\r\n", After::Close)]);
        let outcome = session
            .idle()
            .expect("idle")
            .wait_with_timeout(Duration::from_secs(30));
        assert!(outcome.is_err());
        assert!(matches!(session.noop(), Err(ImapError::ConnectionLost)));
    }

    /// An async command calling the sync engine directly runs on a runtime worker:
    /// the bridge must block in place there, not panic on a nested `block_on`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_bridge_works_from_a_runtime_worker_thread() {
        let (mut session, server) = session_with(vec![
            step("NOOP", "{tag} OK done\r\n"),
            step("UID SEARCH", "* SEARCH 4 2\r\n{tag} OK done\r\n"),
        ]);
        session.noop().expect("noop");
        assert_eq!(
            session.uid_search("ALL").expect("search"),
            HashSet::from([2, 4])
        );
        drop(session);
        server.await.expect("fake server script held");
    }
}
