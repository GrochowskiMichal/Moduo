//! The native Moduo desktop app: one window, no webview.

pub mod instance;
pub mod logging;
pub mod runtime;
pub mod window;

use moduo_config::backend::{self, Backend};
use moduo_config::identity;
use moduo_ui::gpui::Global;

/// The backend this run talks to (the window title and the cloud strip read it).
pub struct CurrentBackend(pub Backend);

impl Global for CurrentBackend {}

/// Starts the app and opens its window. Returns when the app quits, or at once when another
/// launch already owns the app (it is brought forward instead).
pub fn run() {
    let backend = match backend::from_process() {
        Ok(backend) => backend,
        Err(err) => {
            eprintln!("moduo: {err}");
            std::process::exit(2);
        }
    };
    let Some(data_dir) = identity::current_data_dir() else {
        eprintln!("moduo: HOME is not set, so there is no data folder");
        std::process::exit(2);
    };
    logging::init(&data_dir);
    let owner = match instance::claim(&data_dir) {
        Ok(instance::Claim::First(owner)) => Some(owner),
        Ok(instance::Claim::Second) => {
            tracing::info!("another launch owns the app; it was brought forward");
            return;
        }
        Err(err) => {
            tracing::warn!("no single-instance lock: {err}");
            None
        }
    };
    tracing::info!(backend = backend.label(), "starting");

    moduo_ui::application().run(move |cx| {
        moduo_ui::init(cx);
        runtime::init(cx);
        cx.set_global(CurrentBackend(backend));
        if let Some(owner) = owner {
            instance::listen(owner, cx);
        }
        window::open_main_window(cx).expect("the main window opens");
        // No menu bar yet (specs/native-foundation.md, NF-29): closing the window quits.
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        cx.activate(true);
    });
}
