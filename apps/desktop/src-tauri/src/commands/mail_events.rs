//! `mail_subscribe`: the one engine → UI event channel (decision 10). The app
//! holds one [`EventBus`]; the sync engine (MR-3) and the ops outbox emit on it,
//! and each webview subscription gets its own forwarder.

use tauri::ipc::Channel;
use tauri::State;

use crate::mail::sync::events::{forward_to_channel, EventBus, MailEvent};

/// The app-wide mail event bus, managed state.
#[derive(Clone, Default)]
pub struct MailEvents(pub EventBus);

#[tauri::command]
pub fn mail_subscribe(on_event: Channel<MailEvent>, events: State<'_, MailEvents>) {
    let rx = events.0.subscribe();
    tauri::async_runtime::spawn(forward_to_channel(rx, on_event));
}
