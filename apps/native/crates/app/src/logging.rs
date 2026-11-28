//! Logs: to stderr in debug builds, and always to a daily file in the data folder (seven kept).
//! Never log a token or an email address.

use std::path::Path;

use tracing_subscriber::prelude::*;

pub fn init(data_dir: &Path) {
    let file = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("moduo")
        .filename_suffix("log")
        .max_log_files(7)
        .build(data_dir.join("logs"))
        .ok();
    let stderr = cfg!(debug_assertions)
        .then(|| tracing_subscriber::fmt::layer().with_writer(std::io::stderr));
    let file = file.map(|f| {
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .with_writer(f)
    });
    let _ = tracing_subscriber::registry()
        .with(stderr)
        .with(file)
        .try_init();
}
