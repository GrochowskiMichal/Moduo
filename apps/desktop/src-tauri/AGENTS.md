# src-tauri/ (loads when an agent works in this folder)

Read [docs/gotchas/desktop.md](../docs/gotchas/desktop.md) first, and [docs/gotchas/email.md](../docs/gotchas/email.md) for the email engine. Locked calls: [docs/decisions/desktop-release.md](../docs/decisions/desktop-release.md).

- **`bun run verify` covers no Rust.** A block that touches Rust must also pass, from `src-tauri/`: `cargo check`, `cargo check --features lite` (the redb↔Supabase sync worker only compiles under `lite`) and `cargo test --lib`.
- **redb is paused.** It persists only the not-yet-migrated desktop modules. Never make it load-bearing for a new feature; new data goes to Supabase.
- **Commands are the boundary.** Keep `src/commands` as the Tauri command surface and split large modules by behavior. Validate every command's input; the webview is not trusted.
- **Quit and dialogs:** macOS ⌘Q skips `RunEvent::ExitRequested`; don't call `app.exit()`/`app.restart()` inside the `.run()` handler; don't `blocking_show()` a dialog on the main thread; `window.confirm()` is async in the webview.
- **The desktop frontend** must be built with `MODUO_TARGET=desktop` into `dist/`; a stale `dist/` masks bugs.
- **Updater and signing** code is Tier 2 risk (see `/s3`), and release CI rules live in `.github/AGENTS.md`.
