//! The rebuilt desktop mail engine (specs/mail-rebuild.md). MR-0 lays the
//! contracts and the perf/test skeletons; later blocks fill store, sync, ops.

pub mod accounts;
pub mod actor;
pub mod auth;
pub mod avatar;
pub mod bodies;
pub mod contracts;
pub mod fixture;
pub mod invite;
pub mod mailto;
pub mod mime;
pub mod ops;
pub mod perf;
pub mod send;
pub mod session;
pub mod store;
pub mod sync;
pub mod unsubscribe;
