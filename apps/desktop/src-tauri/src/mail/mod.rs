//! The rebuilt desktop mail engine (specs/mail-rebuild.md). MR-0 lays the
//! contracts and the perf/test skeletons; later blocks fill store, sync, ops.

pub mod contracts;
pub mod fixture;
pub mod perf;
pub mod store;
pub mod accounts;
pub mod actor;
pub mod auth;
pub mod session;
