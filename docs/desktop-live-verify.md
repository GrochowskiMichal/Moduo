# Live-verifying native desktop gestures

How to prove a native macOS gesture (⌘Q, the red close button, a native dialog, printing) on a real desktop build when computer use isn't available, by scripting the desktop from a shell. Proven on DF-19f-quit (2026-07-13).

1. **Build an app LaunchServices can tell apart.** The bare debug binary has no bundle id, so build a debug `.app`: `MODUO_TARGET=desktop rsbuild build` in `apps/app/`, then `bunx tauri build --debug --bundles app` in `apps/desktop/` (cached debug deps make it about 40 s). Launch it by explicit path (`open apps/desktop/src-tauri/target/debug/bundle/macos/Moduo.app`): an installed `/Applications/Moduo.app` shares the `com.moduo.desktop` bundle id and may be picked instead.
2. **Observe** with `screencapture -x out.png`.
3. **Native controls and shortcuts** go through AppleScript: `osascript -e 'tell application "System Events" to keystroke "q" using command down'` for ⌘Q, `click button 1 of window 1` for AX-exposed controls (the red close button is `AXCloseButton`).
4. **Webview content isn't exposed to AppleScript** (the web area's `entire contents` is empty), so click inside it with a small Swift CGEvent program (`swiftc` is installed; `cliclick` and Python's Quartz aren't). Logical points are Retina pixels ÷ 2.
5. **Clipboard** round-trips check with `pbcopy`/`pbpaste`.
6. **To force a pref-gated Rust path on** without a signed-in pref, hardcode the `AppState` default temporarily, then revert it and prove the real path again on a rebuild. Never commit the hardcoded default.

Notifications need a **signed CI build**: an unsigned local build shares `com.moduo.desktop` and its storage with the installed app, and `tauri dev` attributes notifications to Terminal (see the comment in `apps/app/src/features/focus/phase-alert.ts`).
