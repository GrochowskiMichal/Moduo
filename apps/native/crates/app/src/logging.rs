//! Logs: to stderr in debug builds, and always to a daily file in the data folder (seven kept).
//! Info and up from everything, debug from the app in debug builds: libraries' debug lines carry
//! request URLs, and nothing here may log a token or an email address.

use std::path::Path;

use tracing_subscriber::filter::{LevelFilter, Targets};
use tracing_subscriber::prelude::*;

pub fn init(data_dir: &Path) {
    let file = match tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("moduo")
        .filename_suffix("log")
        .max_log_files(7)
        .build(data_dir.join("logs"))
    {
        Ok(file) => Some(file),
        Err(err) => {
            eprintln!("moduo: no log file in {}: {err}", data_dir.display());
            None
        }
    };
    let app_level = if cfg!(debug_assertions) {
        LevelFilter::DEBUG
    } else {
        LevelFilter::INFO
    };
    let filter = Targets::new()
        .with_default(LevelFilter::INFO)
        .with_target("moduo", app_level);
    let stderr = cfg!(debug_assertions)
        .then(|| tracing_subscriber::fmt::layer().with_writer(std::io::stderr));
    let file = file.map(|f| {
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .with_writer(f)
    });
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(stderr)
        .with(file)
        .try_init();
}
