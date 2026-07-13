# Manual test checklist — desktop build frontend target fix

> Generated 2026-07-13 · branch `t/maciej/desktop-build-frontend-target` · **Live-verified:** partial — clean build + app launch verified headlessly; the loaded-UI screenshot could not be captured (app-control prompt declined), so the visual confirm is on you.

Fixes a clean `bun run build:desktop` shipping a runtime **"asset not found: index.html"**. The desktop frontend now builds with `MODUO_TARGET=desktop` into `dist/` (real `@tauri-apps/api`), instead of `build:web` → `dist/web/` (stubbed API).

## Desktop bundle — clean build loads
- [ ] **Do:** From a clean tree (`rm -rf dist` first, in the worktree), run `bun run build:desktop --bundles app`, then open `src-tauri/target/release/bundle/macos/Moduo.app`. → **Expect:** the app loads the Moduo login / app UI — **not** a blank page reading "asset not found: index.html". _(desktop)_
- [ ] **Do:** In that running app, sign in and exercise a feature that calls the Rust backend via `invoke()` (e.g. open Settings → confirm-before-quit toggle, or any desktop-only module). → **Expect:** it works; no `[tauri-stub] invoke(...) called in web build` error in the console/log (proves the real Tauri API is bundled, not the web stub). _(desktop)_
- [ ] **Do:** Drop-in replace `/Applications/Moduo.app` with the freshly built one and relaunch (the dogfood loop). → **Expect:** loads normally, existing data intact (identifier `com.moduo.desktop` unchanged). _(desktop)_

## Build outputs — sanity (optional, fast)
- [ ] **Do:** After `bun run build:desktop:web`, check `dist/index.html` exists and `dist/web/` does **not**. → **Expect:** `dist/index.html` present; no `dist/web/`. _(build)_
- [ ] **Do:** `grep -rl __TAURI_INTERNALS__ dist/static/js` and `grep -rl "called in web build" dist/static/js`. → **Expect:** first matches (real API bundled); second finds nothing (stub absent). _(build)_

## Regression — web + dev unaffected
- [ ] **Do:** `bun run build:web` still outputs to `dist/web/` (unchanged). → **Expect:** `dist/web/index.html` present; web build unaffected. _(web)_
- [ ] **Do:** `bun run dev:desktop` still launches (Tauri dev uses `devUrl`, not `frontendDist`). → **Expect:** dev app loads from the live rsbuild server as before. _(desktop)_

## Known gaps / not-yet-testable
- The loaded-UI **screenshot** of the built `.app` was not captured — the computer-use app-control prompt was declined. Headless evidence gathered instead: clean build exit 0, `beforeBuildCommand` regenerated `dist/index.html`, real `@tauri-apps/api` bundled (stub absent), and the launched binary stayed alive with no asset-not-found error on stderr. The first checkbox above is the human confirmation of the visual load.
- Signed builds (`build:desktop:signed:{debug,release}`) were **not** run (need an Apple signing identity in the keychain); they share the same `beforeBuildCommand` path, so the fix applies, but that path is unverified here.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
