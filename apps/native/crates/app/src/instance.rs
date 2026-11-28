//! One app at a time: a second launch tells the first to come forward and exits (the edge case
//! "two launches at once" in specs/native-foundation.md). The owner holds an exclusive lock on
//! `instance.lock` for its whole life and only then touches the socket, so two launches racing,
//! or racing a crash's leftovers, can't both win. A lock dies with its process.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::unix::net::{SocketAddr, UnixListener, UnixStream};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use moduo_ui::gpui::App;

const LOCK: &str = "instance.lock";
const SOCKET: &str = "instance.sock";
const ACTIVATE: &str = "activate";

/// The running app's hold on being the one instance.
pub struct Owner {
    listener: UnixListener,
    _lock: File,
}

impl Owner {
    pub fn accept(&self) -> io::Result<(UnixStream, SocketAddr)> {
        self.listener.accept()
    }
}

pub enum Claim {
    /// This launch owns the app; listen on it.
    First(Owner),
    /// Another launch owns it and has been told to come forward.
    Second,
}

pub fn claim(dir: &Path) -> io::Result<Claim> {
    std::fs::create_dir_all(dir)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LOCK))?;
    let path = dir.join(SOCKET);
    match lock.try_lock() {
        Ok(()) => {
            // We own the app: whatever socket is there was left by a crash.
            match std::fs::remove_file(&path) {
                Err(err) if err.kind() != io::ErrorKind::NotFound => return Err(err),
                _ => {}
            }
            let listener = UnixListener::bind(&path)?;
            Ok(Claim::First(Owner {
                listener,
                _lock: lock,
            }))
        }
        Err(std::fs::TryLockError::WouldBlock) => {
            // The owner may still be binding its socket: give it a moment.
            for _ in 0..20 {
                if let Ok(mut stream) = UnixStream::connect(&path) {
                    stream.write_all(format!("{ACTIVATE}\n").as_bytes())?;
                    return Ok(Claim::Second);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(Claim::Second)
        }
        Err(std::fs::TryLockError::Error(err)) => Err(err),
    }
}

/// Brings the app forward whenever a later launch asks. Keeps listening through a bad message.
pub fn listen(owner: Owner, cx: &mut App) {
    let owner = Arc::new(owner);
    cx.spawn(async move |cx| loop {
        let o = owner.clone();
        let message = cx
            .background_executor()
            .spawn(async move {
                let (stream, _) = o.accept()?;
                // Only accept() failing ends the loop. macOS refuses setsockopt on a socket whose
                // peer has already closed (EINVAL), which is the normal case for a quick launch.
                // A peer that never closes must not hold the next launch back.
                let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                let mut bytes = Vec::new();
                let _ = stream.take(64).read_to_end(&mut bytes);
                io::Result::Ok(bytes)
            })
            .await;
        match message {
            Ok(bytes) if bytes.trim_ascii() == ACTIVATE.as_bytes() => cx.update(|cx| {
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
