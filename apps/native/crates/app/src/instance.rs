//! One app at a time: a second launch tells the first to come forward and exits (the edge case
//! "two launches at once" in specs/native-foundation.md). The first launch owns a Unix socket in
//! the data folder; a socket left behind by a crash is taken over.

use std::io::{self, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::Arc;

use moduo_ui::gpui::App;

const SOCKET: &str = "instance.sock";
const ACTIVATE: &str = "activate";

pub enum Claim {
    /// This launch owns the app; listen on it.
    First(UnixListener),
    /// Another launch owns it and has been told to come forward.
    Second,
}

pub fn claim(dir: &Path) -> io::Result<Claim> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(SOCKET);
    match UnixListener::bind(&path) {
        Ok(listener) => return Ok(Claim::First(listener)),
        Err(err) if err.kind() == io::ErrorKind::AddrInUse => {}
        Err(err) => return Err(err),
    }
    match UnixStream::connect(&path) {
        Ok(mut stream) => {
            stream.write_all(format!("{ACTIVATE}\n").as_bytes())?;
            Ok(Claim::Second)
        }
        // Nobody answers: the last owner crashed.
        Err(_) => {
            std::fs::remove_file(&path)?;
            Ok(Claim::First(UnixListener::bind(&path)?))
        }
    }
}

/// Brings the app forward whenever a later launch asks.
pub fn listen(listener: UnixListener, cx: &mut App) {
    let listener = Arc::new(listener);
    cx.spawn(async move |cx| loop {
        let l = listener.clone();
        let message = cx
            .background_executor()
            .spawn(async move {
                let (mut stream, _) = l.accept()?;
                let mut text = String::new();
                stream.read_to_string(&mut text)?;
                io::Result::Ok(text)
            })
            .await;
        match message {
            Ok(text) if text.trim() == ACTIVATE => cx.update(|cx| {
                cx.activate(true);
                for window in cx.windows() {
                    let _ = window.update(cx, |_, window, _| window.activate_window());
                }
            }),
            Ok(_) => {}
            Err(err) => {
                tracing::warn!("single-instance socket closed: {err}");
                break;
            }
        }
    })
    .detach();
}
