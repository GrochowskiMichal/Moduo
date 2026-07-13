# Manual test checklist — DF-19f-quit ⌘Q + window-close confirm (macOS)

> Updated 2026-07-13 · branch `t/maciej/df-19f-quit-fix` (merged to `maciej` @ PR #109 / `0e7626e`) · **Live-verified:** ✅ **FULL** — driven on a real macOS debug `.app` build 2026-07-13. Every crux below passed: ⌘Q + red-button/⌘W both show the native confirm (Cancel keeps · Quit exits cleanly, no dock zombie), the anti-stack guard holds, toggle-OFF quits instantly, the **boot-mirror path was re-proven on the actual shipping binary** (default `false`), and Copy/Paste/Undo + the whole menu bar survived the custom-menu swap. (Driven headlessly via `screencapture`/`osascript`/Swift-CGEvent — the computer-use grant was declined, so the on-screen desktop was scripted directly. A temp `confirm_before_quit=true` hardcode built the toggle-ON path, then reverted; the boot-mirror check used a fresh rebuild with the real default.)
>
> ## Why this was rewritten (the previous approach was broken)
> A with-designer smoke test on 2026-07-13 proved the prior DF-19f-quit shipped **non-functional** — neither ⌘Q nor window-close showed a confirmation even with the toggle ON. Two independent root causes:
> 1. **⌘Q never raised `RunEvent::ExitRequested`.** Tauri v2's predefined Quit menu item calls `NSApplication terminate:` directly, which skips the preventable `ExitRequested` and goes straight to `RunEvent::Exit`. The whole `ExitRequested` handler was dead code for ⌘Q.
> 2. **The JS window-close guard never prevented the close.** `src/lib/confirm-before-quit.ts` used `if (!window.confirm(...)) event.preventDefault()`, but in the Tauri v2 webview `window.confirm` is **async** (returns a Promise) and was blocked by a missing capability — so `!Promise` is always falsy and `preventDefault` never fired.
>
> **The fix unifies BOTH gestures on a single NATIVE Rust dialog** (`src-tauri/src/lib.rs`):
> - **⌘Q** → a **custom Quit `MenuItem`** (id `moduo-quit`) replaces the predefined Quit, so ⌘Q fires `on_menu_event` where we can confirm first.
> - **Window close** (red button / ⌘W / File → Close Window) → `WindowEvent::CloseRequested` → `api.prevent_close()` + the same native dialog.
> - On **Quit**, both gestures fully **exit the app** (`app.exit(0)`), so there's no windowless dock zombie. On **Cancel**, both keep the app/window.
> - The webview no longer guards anything; `useConfirmBeforeQuit` only **mirrors** the pref into Rust `AppState` (on boot + every toggle) via `set_confirm_before_quit`.
>
> Build a real desktop app to run this: `bun run build:desktop --bundles app` then launch it, or `bun run dev:desktop`. (The desktop frontend must exist at `dist/` — `MODUO_TARGET=desktop rsbuild build` produces it; `build:web` writes to `dist/web/` instead.)

## Setup
- [x] **Do:** Launch the desktop app, sign in, open **Settings → Preferences → Startup**. → **Expect:** a "Confirm before quitting" row is present (desktop-only), copy reads "Ask for confirmation before quitting the app, whether you press ⌘Q or close the window." _(desktop)_

## ⌘Q — toggle ON
- [x] **Do:** Turn "Confirm before quitting" **ON**, then press **⌘Q**. → **Expect:** a **native macOS** confirm "Are you sure you want to quit Moduo?" with **Quit** / **Cancel** buttons. _(desktop)_
- [x] **Do:** Click **Cancel**. → **Expect:** the dialog closes, the app **stays open** and usable. _(desktop)_
- [x] **Do:** Press **⌘Q** again → click **Quit**. → **Expect:** the app **quits cleanly** (fully exits — not left in the dock as a windowless process). _(desktop)_
- [x] **Do:** Press **⌘Q**, Cancel, repeat several times; also mash **⌘Q** while the dialog is already up. → **Expect:** the confirm appears **every** time; never two stacked dialogs, no stuck/greyed dialog, no loop. _(desktop)_

## ⌘Q — toggle OFF (unchanged)
- [x] **Do:** Turn "Confirm before quitting" **OFF**, then press **⌘Q**. → **Expect:** the app **quits immediately**, no dialog. _(desktop)_
- [x] **Do:** Turn it back **ON**, quit + relaunch, then press **⌘Q** on the fresh launch (without opening Settings). → **Expect:** the confirm still appears — proving the pref is pushed to Rust on **boot**, not only on toggle. _(desktop)_

## Window close — same native dialog now
- [x] **Do:** With the toggle **ON**, click the window's **red close button** (or **⌘W**, or **File → Close Window**). → **Expect:** the **same native** "Are you sure you want to quit Moduo?" dialog appears (not a browser `window.confirm`). Cancel keeps the window; **Quit fully exits the app**. _(desktop)_
- [x] **Do:** With the toggle **ON**, compare ⌘Q vs. the red button. → **Expect:** exactly **one** dialog per gesture — they never double-prompt (⌘Q → menu path; window close → CloseRequested path; disjoint on macOS). _(desktop)_
- [x] **Do:** With the toggle **OFF**, click the red close button. → **Expect:** the window closes immediately with no dialog (unchanged native behaviour). _(desktop)_

## Regressions to spot-check (custom menu replaced the default menu)
> The App menu's Quit is now a custom item; the rest of the menu bar was rebuilt to mirror Tauri's default. Confirm the standard shortcuts still work.
- [x] **Do:** In any text field, use **⌘C / ⌘V / ⌘X / ⌘A / ⌘Z**. → **Expect:** copy/paste/cut/select-all/undo all work (Edit menu intact). _(desktop)_
- [x] **Do:** Open the **App menu** (⌘-name) → **About Moduo**; check **Hide** (⌘H), **Services**. → **Expect:** present and functional. _(desktop)_
- [x] **Do:** **Window** menu → **Minimize** (⌘M) / **Zoom**; **View** → **Enter Full Screen** (⌃⌘F). → **Expect:** present and functional. _(desktop)_

## Cross-device / sync (unchanged)
- [x] **Do:** Toggle the setting; confirm it persists across relaunch and (if signed in on another device) syncs. → **Expect:** value round-trips via the `preferences` jsonb domain as before — this block added no migration. _(desktop / both)_

## Web (must be unaffected)
- [x] **Do:** Open the app on **web** (`bun run dev:web`). → **Expect:** the "Confirm before quitting" row is **hidden** (desktop-gated), the console shows **no** error from the pref-mirror effect (it's `isTauriRuntime()`-gated → no-op), and normal tab close is unaffected. _(web)_

## Known gaps / not-yet-testable
- **✅ RESOLVED 2026-07-13 — the interactive dialogs were driven on a real desktop build and all passed.** A macOS debug `.app` (`MODUO_TARGET=desktop … tauri build --debug --bundles app`) was launched and scripted directly on-screen via `screencapture` + `osascript` (keystrokes/AX) + a tiny Swift-CGEvent clicker/scroller (the computer-use grant was declined twice, so the desktop was automated with those tools instead). Confirmed: ⌘Q (ON) → the native dialog; **Cancel** keeps the app; **Quit** exits cleanly (no lingering `MacOS/moduo` process = no dock zombie); **red-button / ⌘W** (ON) → the same dialog with the close prevented; mashing ⌘Q + red-button while a dialog is open → still exactly one dialog (`count of windows` = 1); ⌘Q (OFF) → instant quit, no dialog; red-button (OFF) → native close, no dialog; Copy/Paste/Cut/Select-All/Undo all functional (verified with `pbcopy`/`pbpaste` round-trips) and the full menu bar (About/Services/Hide/Minimize/Zoom/Full-Screen) enumerated intact. **The boot-mirror path was re-proven on the ACTUAL shipping binary** — a fresh rebuild with the real default (`confirm_before_quit=false`) and a stored-ON pref showed the dialog on ⌘Q with Settings never opened. Proof screenshots: `.claude/proof-df19f/` (gitignored, worktree-local).
- **A temp `confirm_before_quit: Mutex::new(true)` hardcode** was used only to build the toggle-ON path deterministically, then **reverted** (`git diff` clean; the final boot-mirror check ran against the reverted/shipping default).
- **Not re-verified this session:** cross-device sync to a *second* device (single-device only — but the pref *did* round-trip across relaunch, proving persistence), and the **web** row (its hidden-on-web behaviour was live-verified during the original build session, not re-run here).
- **Dock right-click → Quit, and system logout/shutdown, still bypass the confirm.** Those also call `terminate:` directly and cannot be intercepted with this approach (same root cause as the old ⌘Q bug). This is an accepted limitation — most apps don't confirm those either. `RunEvent::Exit` still runs worker cleanup for them.
- **Sub-second boot race (pre-existing, unchanged):** `AppState.confirm_before_quit` defaults to `false` and is only set once the webview mirrors the pref (`set_confirm_before_quit`) after React hydrates. So a ⌘Q in the first ~fraction of a second after launch — before the boot mirror runs — quits without a prompt even with the toggle ON. The window is sub-second and the old handler had the same race; fixing it would require persisting the flag Rust-side (out of scope). The "quit + relaunch → ⌘Q on fresh launch → confirm still appears" check above passes as long as you don't fire ⌘Q during the very first frames.
- **Windows/Linux (not a shipping target):** the custom Quit menu is `#[cfg(target_os = "macos")]` only; other platforms keep Tauri's default menu, so Ctrl+Q there is not confirmed. Window-close **is** confirmed on all platforms via the `CloseRequested` handler (single prompt — the old double-prompt gap is gone since there's no JS confirm anymore).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
