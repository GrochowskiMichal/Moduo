# Manual test checklist — DF-19f-quit ⌘Q coverage (macOS)

> Generated 2026-07-13 · branch `claude/angry-goldstine-3e18b5` (off merged `maciej`, PR #107) · **Live-verified:** partial — `bun run verify` (1213 green) + `cargo check` (clean) pass; **desktop quit-behaviour was NOT verifiable headlessly and needs a real desktop pass** (this is the crux of the change).
>
> This block adds the **Rust `RunEvent::ExitRequested` handler** so macOS **⌘Q** honours the confirm-before-quit toggle (the base DF-19f-quit only guarded the window-close gesture in JS). Run on a real desktop build: `bun run build:desktop --bundles app` (then launch the app) or `bun run dev:desktop`.

## Setup
- [ ] **Do:** Launch the desktop app, sign in, open **Settings → Preferences → Startup**. → **Expect:** a "Confirm before quitting" row is present (desktop-only), copy reads "Ask for confirmation before quitting the app, whether you press ⌘Q or close the window." — no "⌘Q still quits right away" caveat. _(desktop)_

## ⌘Q — toggle ON (the new behaviour)
- [ ] **Do:** Turn "Confirm before quitting" **ON**, then press **⌘Q**. → **Expect:** a native macOS confirm dialog "Are you sure you want to quit Moduo?" with **Quit** / **Cancel** buttons. _(desktop)_
- [ ] **Do:** In that dialog, click **Cancel**. → **Expect:** the dialog closes, the app **stays open** and usable (not quit, not frozen). _(desktop)_
- [ ] **Do:** Press **⌘Q** again → click **Quit**. → **Expect:** the app **quits** cleanly (fully exits — not left in the dock as a windowless process). _(desktop)_
- [ ] **Do:** Press **⌘Q**, Cancel, then repeat several times. → **Expect:** the confirm appears **every** time; no double dialogs, no stuck/greyed dialog, no loop. _(desktop)_

## ⌘Q — toggle OFF (unchanged behaviour)
- [ ] **Do:** Turn "Confirm before quitting" **OFF**, then press **⌘Q**. → **Expect:** the app **quits immediately**, no dialog. _(desktop)_
- [ ] **Do:** Turn it back **ON**, quit + relaunch, then press **⌘Q** on the fresh launch (without opening Settings). → **Expect:** the confirm still appears — proving the pref is pushed to Rust on **boot**, not only on toggle. _(desktop)_

## Window-close guard (regression — must still work)
- [ ] **Do:** With the toggle **ON**, click the window's **red close button** (or ⌘W on the last window). → **Expect:** the existing JS confirm ("Quit Moduo?") appears; Cancel keeps the window, OK closes it. _(desktop)_
- [ ] **Do:** With the toggle **ON**, note pressing ⌘Q vs. the red button never shows **two** prompts for one gesture. → **Expect:** exactly one confirm per gesture (⌘Q → Rust dialog; red button → JS confirm; they're disjoint). _(desktop)_
- [ ] **Do:** With the toggle **OFF**, click the red close button. → **Expect:** the window closes immediately, no confirm. _(desktop)_

## Cross-device / sync (unchanged)
- [ ] **Do:** Toggle the setting; confirm it persists across relaunch and (if signed in on another device) syncs. → **Expect:** value round-trips via the `preferences` jsonb domain as before — this block added no migration. _(desktop / both)_

## Web (must be unaffected)
- [ ] **Do:** Open the app on **web** (`bun run dev:web`). → **Expect:** the "Confirm before quitting" row is **hidden** (desktop-gated), the console shows **no** error from the new Rust-mirror effect (it's `isTauriRuntime()`-gated → no-op), and normal tab close is unaffected. _(web)_

## Known gaps / not-yet-testable
- **Desktop quit-behaviour is unverifiable headlessly** — every ⌘Q item above was reasoned + compiled (`cargo check` clean) but not exercised in this session. The single most important thing to confirm is that **⌘Q actually raises `RunEvent::ExitRequested`** on the installed Tauri v2 (2.x); some older (v1-era) reports claimed ⌘Q wasn't delivered. If the confirm does NOT appear on ⌘Q while ON, that assumption failed — capture it and we fall back to a native menu-item override for the Quit item.
- The confirmed-quit path uses `std::process::exit(0)` after `stop_all_idle_workers()` (v2 forbids `app.exit()` inside the handler). Verify no email/idle-worker warning is logged on quit and that a subsequent relaunch is clean.
- **Repeated ⌘Q while the confirm is open** is guarded by an `AtomicBool` (only the first opens a dialog). Worth a spot-check: mash ⌘Q with the dialog up → still exactly one dialog.
- **Windows/Linux (not a shipping target):** the Rust handler isn't `#[cfg]`-gated to macOS, so on those platforms a last-window close with the toggle ON would show BOTH the JS `window.confirm` and the native dialog (double prompt). Deferred — gate to `#[cfg(target_os = "macos")]` if/when Win/Linux ship. macOS is unaffected (last-window close doesn't raise `ExitRequested`).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
