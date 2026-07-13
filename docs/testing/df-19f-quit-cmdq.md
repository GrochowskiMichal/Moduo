# Manual test checklist — DF-19f-quit ⌘Q coverage (macOS)

> Generated 2026-07-13 · branch `claude/angry-goldstine-3e18b5` (off merged `maciej`, PR #107).
> **Desktop smoke-test RUN 2026-07-13** (worktree `cranky-wiles-0bbf66`, with-designer computer-use session, hosted test account).
>
> ## ⛔ RESULT: FAILED — confirm-before-quit is **non-functional on desktop**
>
> Neither ⌘Q **nor** the window-close guard shows a confirmation, even with the toggle **ON** and `confirmBeforeQuit=true` verified in the synced `user_preferences` row. **Two independent root causes** (one Rust, one JS) — see below. The crux assumption the block was built on (macOS ⌘Q raises `RunEvent::ExitRequested`) is **false** on this Tauri v2 build. → follow-up needed before this ships.

## How it was tested (for reproducibility)

- `bun run build:desktop` from a clean worktree first produced an **"asset not found: index.html"** app — a separate build-config bug (see "Build blocker" below). Worked around by building the desktop frontend into `dist/` (`MODUO_TARGET=desktop rsbuild build`) and bundling with `beforeBuildCommand` neutralised.
- Ran the freshly-built **debug** `Moduo.app` (which contains the merged `lib.rs` ⌘Q handler — verified by string-matching the binary), launched via **direct-exec of the bundle binary** to avoid a bundle-id collision with a stale `/Applications/Moduo.app` (both are `com.moduo.desktop`; LaunchServices `open` conflated the two instances).
- Signed into the hosted test account by session-injection; toggle **ON** verified in Settings → Preferences → Startup.
- **Instrumented the Rust event loop** with `eprintln!` in the `ExitRequested` and `Exit` arms and rebuilt, to see which fires on ⌘Q.
- **Devtools console** used to probe the JS window-close path.

## Setup
- [x] **Row present + copy** — Settings → Preferences → Startup shows **"Confirm before quitting"**, copy = *"Ask for confirmation before quitting the app, whether you press ⌘Q or close the window."* — de-caveated (no "⌘Q still quits right away"). **PASS.** _(desktop)_

## ⌘Q — toggle ON (the new behaviour) — ❌ FAIL
- [ ] ~~⌘Q shows a native "Are you sure you want to quit Moduo?" dialog~~ → **FAIL: no dialog; the app quits instantly.**
- [ ] ~~Cancel keeps the app open~~ → **N/A** (no dialog appears).
- [ ] ~~Quit exits cleanly~~ → **N/A via the confirm path.** (⌘Q does exit cleanly — but unconditionally, not through the confirm.)
- [ ] ~~Repeated ⌘Q → exactly one dialog (AtomicBool guard)~~ → **N/A** (no dialog ever appears; the `AtomicBool` guard is never reached).

**ROOT CAUSE #1 (Rust — the crux assumption FAILED).** Instrumented `eprintln!` proof: on ⌘Q the app enters **`RunEvent::Exit`** directly — **`RunEvent::ExitRequested` is NEVER entered**. This held even in a build with `confirm` hardcoded `true` (`true || confirm`) — the whole `ExitRequested` arm (the entire PR #108 handler) is dead code on ⌘Q. On Tauri v2/macOS the default menu's **predefined Quit** calls `NSApplication terminate:` → straight to `Exit`, bypassing the preventable `ExitRequested`. This is exactly the v1-era failure mode the block flagged as a risk. **The Rust ⌘Q handler can never run as written.**

## ⌘Q — toggle OFF (unchanged behaviour)
- [x] **Toggle OFF → ⌘Q quits immediately, no dialog.** **PASS — but trivially:** ⌘Q *always* quits immediately regardless of the toggle, because `ExitRequested` never fires. This "pass" is indistinguishable from the ON case, which is the bug. _(desktop)_
- [ ] ~~Toggle ON, relaunch, ⌘Q on fresh launch still confirms (boot-persistence)~~ → **N/A** (feature doesn't work at all).

## Window-close guard (base DF-19f-quit, JS `onCloseRequested`) — ❌ FAIL
- [ ] ~~Toggle ON, red close button / ⌘W → JS "Quit Moduo?" confirm; Cancel keeps the window~~ → **FAIL: both the red button and ⌘W close the window with NO confirm.** Tested with the toggle ON and `confirmBeforeQuit=true` confirmed in the DB.
- [ ] ~~⌘Q vs red button never shows two prompts~~ → **N/A** (neither shows any prompt).
- [x] **Toggle OFF, red button → closes immediately, no confirm.** PASS — but again trivially (it always closes without a confirm). _(desktop)_

**ROOT CAUSE #2 (JS — window.confirm is async + unpermitted).** Devtools console proof: `typeof window.confirm === "function"` and `window.__TAURI_INTERNALS__` is present (so `isTauriRuntime()` is `true` and the listener registers), **but `window.confirm('…')` returns `Promise {status:"pending"}` which then rejects: `"dialog.confirm not allowed. Command not found"`** (thrown from the app's own bundled `index.*.js`). In the Tauri v2 webview `window.confirm` is **async** (routed to the dialog plugin) and blocked by a **missing `dialog:allow-confirm` capability**. The guard's code —
```js
if (!window.confirm("Quit Moduo?")) event.preventDefault();
```
— treats the returned **Promise as truthy**, so `!Promise` is `false` and **`event.preventDefault()` is never called** → the window closes every time. The code comment's premise ("window.confirm … is SYNCHRONOUS in the webview") is **wrong on desktop**. (This desktop path was never actually exercised before — the block was only "web live-verified", where the row is correctly hidden.)

## Cross-device / sync
- [x] **Pref persists + syncs.** `confirmBeforeQuit=true` is present in the account's synced `user_preferences` jsonb (verified via REST). The Settings toggle reflects it correctly. **PASS** — but moot, since neither quit path consumes it functionally on desktop. _(both)_

## Web (must be unaffected)
- [x] **Web unaffected** (reasoned, not re-run this session): the row is `isTauriRuntime()`-gated and `window.__TAURI_INTERNALS__` is absent on web → row hidden, no guard registered, no Rust-mirror effect. Verified `isTauriRuntime()` returns correctly on desktop; on web it is `false`. **PASS by design.** _(web)_

---

## ⚠ Separate build blocker found (independent of the quit feature)
A clean `bun run build:desktop` produces a `.app` that shows **"asset not found: index.html"**. `rsbuild.config.ts` outputs the **desktop** frontend to `dist/` and the **web** target to `dist/web/`, and `tauri.conf.json` `frontendDist` is `../dist` — but its `beforeBuildCommand` is **`bun run build:web`** (the *web* target → `dist/web/`, with `@tauri-apps/api` **stubbed**). So a fresh tree gets no `dist/index.html`, and even if it loaded, the Tauri APIs the quit feature needs would be stubbed out. A stale `dist/` in the main checkout masks this. **`beforeBuildCommand` should build the desktop target** (e.g. `MODUO_TARGET=desktop rsbuild build`).

## Required follow-up (before DF-19f-quit can ship on desktop)
1. **⌘Q:** Replace the `RunEvent::ExitRequested` approach with a **custom Quit menu item** (not `PredefinedMenuItem::quit`) whose handler runs the confirm, **or** an `NSApplicationDelegate applicationShouldTerminate:` hook. `ExitRequested` is not delivered for the macOS predefined Quit.
2. **Window close:** The JS `window.confirm` path cannot work — Tauri v2's `window.confirm` is async and needs the `dialog:allow-confirm` capability. Either grant it **and** rewrite the guard to `preventDefault()` *first*, `await` the async confirm, then `destroy()` on yes; **or** move the window-close confirm into Rust too (`CloseRequested` + native dialog), unifying both gestures on one native dialog.
3. **Build config:** fix `beforeBuildCommand` (above) so desktop builds are reproducible.

*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up".*
