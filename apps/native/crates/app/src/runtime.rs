//! The bridge between GPUI and tokio. GPUI's executor is not tokio: a `reqwest` call awaited on it
//! panics. Networked work runs on one tokio runtime the app owns, and its result comes back to
//! GPUI as an ordinary task.

use std::future::Future;

use moduo_ui::gpui::{App, Global, Task};

/// The app's tokio runtime.
pub struct Io(tokio::runtime::Runtime);

impl Global for Io {}

/// Starts the runtime. Call once, before anything uses [`spawn_io`].
pub fn init(cx: &mut App) {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("moduo-io")
        .enable_all()
        .build()
        .expect("the tokio runtime starts");
    cx.set_global(Io(runtime));
}

/// Runs `future` on tokio and hands its output back as a GPUI task (await it in `cx.spawn`).
pub fn spawn_io<T: Send + 'static>(
    cx: &App,
    future: impl Future<Output = T> + Send + 'static,
) -> Task<T> {
    let handle = cx.global::<Io>().0.spawn(future);
    cx.background_executor().spawn(async move {
        match handle.await {
            Ok(value) => value,
            // A panic on tokio surfaces where the result was awaited.
            Err(err) => std::panic::resume_unwind(err.into_panic()),
        }
    })
}
