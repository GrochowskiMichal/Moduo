---
paths: ["apps/desktop/src-tauri/**"]
incident: "Rust breakage reached develop because bun run verify covers no Rust (2026-10-23, HV-4 added the rust-check oracle)"
expires: 2027-01-31
---

# Desktop Rust (Tauri)

The traps are commented at their code; the email engine also follows `.claude/rules/email.md`. Locked calls: [docs/decisions/desktop-release.md](../../docs/decisions/desktop-release.md).

- **`bun run verify` covers no Rust.** A block that touches Rust must also pass, from `apps/desktop/src-tauri/`: `cargo check`, `cargo check --features lite` (the redb↔Supabase sync worker only compiles under `lite`) and `cargo test --lib`.
- **redb is paused.** It persists only the not-yet-migrated desktop modules. Never make it load-bearing for a new feature; new data goes to Supabase.
- **Commands are the boundary.** Keep `src/commands` as the Tauri command surface and split large modules by behavior. Validate every command's input; the webview is not trusted.
- **Quit and dialogs:** macOS ⌘Q skips `RunEvent::ExitRequested`; don't call `app.exit()`/`app.restart()` inside the `.run()` handler; don't `blocking_show()` a dialog on the main thread; `window.confirm()` is async in the webview. The ast-grep pack flags the last two (`rust-dialog-blocking-show`, `webview-native-dialog`).
- **The installer bundles the UI.** A web deploy never reaches desktop users; a release tag rebuilds the desktop app when something its bundle is built from changed.
- **The crate isn't `cargo fmt`-clean** and CI runs no fmt check: hand-apply rustfmt's output to your own hunks instead of formatting whole files.
- **Live-verify a native gesture** (⌘Q, the close button, native dialogs) with the recipe in [docs/desktop-live-verify.md](../../docs/desktop-live-verify.md).
- **The desktop frontend** must be built with `MODUO_TARGET=desktop` into `apps/app/dist/` (`frontendDist`; `beforeBuildCommand` runs the app's `build:desktop`); a stale `apps/app/dist/` masks bugs.
- **Updater and signing** code is Tier 2 risk (see `/s3`), and release CI rules live in `.claude/rules/ci-release.md`.
