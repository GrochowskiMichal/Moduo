# Gotchas: Tauri desktop shell and desktop stores

Read before working in `apps/desktop/src-tauri/` and the app's desktop-only code. Index of all areas: [docs/gotchas.md](../gotchas.md).

Compiled on 2026-10-27 (HV-14c, specs/harness-v3.md AC30): every entry became an ast-grep rule, a test, a comment at the trap, a path rule or a doc, or was deleted as stale. A path rule loads by itself when you open a file it covers.

## Where the traps live now

- **ast-grep:** `webview-native-dialog` and `webview-native-dialog-tsx` (`window.confirm/alert/prompt` are async in the webview), `tauri-api-static-import` (only `@tauri-apps/api/core` has a web stub), `rust-dialog-blocking-show`.
- **Path rule:** [desktop-rust](../../.claude/rules/desktop-rust.md) (the cargo gates, quit and dialogs, the bundled UI, `cargo fmt`).
- **Doc:** [docs/desktop-live-verify.md](../desktop-live-verify.md) (scripting native gestures on a debug build).
- **Comments at the trap:** `apps/app/src/lib/print.ts`, `apps/app/src/features/focus/phase-alert.ts`, and in `apps/desktop/src-tauri/src/commands/email/` `storage.rs` (`stored_order_key`, `list_envelopes_in_store`) and `realtime.rs` (cursor after batched writes).

## Open entries

None. A new trap goes here (the trap, why, what to do instead) only until it has a better home; one that bites twice becomes a hook, a lint rule or a test.
