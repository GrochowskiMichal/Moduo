//! The sync engine (MR-3, specs/mail-rebuild.md decisions 5–7 and 10):
//! folder roles, Gmail All Mail plus labels, CONDSTORE deltas with a UID set
//! diff for expunges and new mail, live folders (IDLE plus STATUS), threading
//! and classification at ingest, backfill with progress and cancel, and the
//! event channel to the UI.

pub mod classify;
pub mod effects;
pub mod engine;
pub mod events;
pub mod gmail;
pub mod headers;
pub mod imap;
pub mod live;
pub mod roles;
pub mod server;
pub mod threading;

#[cfg(test)]
pub(crate) mod testing;
#[cfg(test)]
mod tests;
