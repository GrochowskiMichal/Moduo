# Manual test checklist — DF-19g (Settings → Advanced)

> Generated 2026-07-12 · branch `t/maciej/df-19g-advanced-settings` · **Live-verified:** yes — export, reset-cache (guard + full round-trip), and diagnostics all driven end-to-end on the hosted test account (web, port 8085, zero console errors). Desktop rows noted below are inferred (same code path) and marked.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Reaching the section
- [ ] **Do:** Open Settings (`⌘,`, palette, or user menu) → click **App → Advanced** in the grouped nav → **Expect:** the Advanced section with three cards: Export workspace data, Reset local cache, Diagnostics. _(both)_
- [ ] **Do:** Cold-load `/settings?section=advanced` (paste the URL) → **Expect:** the modal opens straight to Advanced (deep-link resolves). _(both)_

## Data export
- [ ] **Do:** Click **Export data** → **Expect:** a `.zip` downloads named `moduo-<workspace>-<YYYY-MM-DD>.zip`; a neutral toast "Workspace data exported." _(both)_
- [ ] **Do:** Unzip the download → **Expect:** `tasks.json`, `notes.json`, `contacts.json`, `calendar.json`, `habits.json`, `_manifest.json`. Each is valid JSON; `notes.json` entries carry a `bodyMd` field; `_manifest.json` lists all five modules as `ok` plus version/build/workspace/exportedAt. _(both)_
- [ ] **Do:** Export from a brand-new empty workspace → **Expect:** the zip still contains all five module files (empty arrays) + the manifest; no crash. _(both)_
- [ ] **Do (partial-failure path — hard to force manually):** if a module read fails, **Expect:** an `_errors.json` in the zip naming the failed module, and the toast reads "Exported — N module(s) skipped (see _errors.json)." The other modules still export. _(covered by `data-export.test.ts`; not manually forced)_

## Reset local cache
- [ ] **Do:** Click **Reset local cache…** with everything synced → **Expect:** a confirm dialog "Reset local cache?" explaining cloud data is safe, you stay signed in, **device-only display settings (density and tab style) reset**, and it can't be undone — with Cancel + a destructive **Reset & reload**. _(both)_
- [ ] **Do:** Confirm **Reset & reload** → **Expect:** the app reloads, you are **still signed in**, `moduo.*` localStorage and the notes IndexedDB (`moduo-notes-v2` + `moduo:notes-v2:doc:*`) are cleared, and cloud data (tasks/notes/appearance theme) re-appears after the reload re-sync. _(both — live-verified on web)_
- [ ] **Do:** Set density to Dense (Appearance), then Reset & reload → **Expect:** density returns to its default (device-local prefs don't survive the reset — this is disclosed in the confirm copy). _(both)_

## Reset local cache — unsynced-notes guard (data-safety)
- [ ] **Do:** Make a notes edit, immediately (before the sync indicator settles) open Advanced → Reset local cache… → **Expect:** instead of the confirm, a **blocked** dialog "You have unsynced note changes" with the count, guidance (online: open Notes & wait; offline: reconnect), a warning strip, and only Cancel + **Re-check** — **no Reset button**. _(both — live-verified by seeding an outbox entry)_
- [ ] **Do:** Wait for the note to sync (or reconnect), click **Re-check** → **Expect:** the dialog flips to the normal "Reset local cache?" confirm with the destructive button. _(both — live-verified)_
- [ ] **Do (offline path):** Go offline (DevTools), make a note edit, open Reset → **Expect:** blocked dialog worded "Reconnect to the internet so they can sync, then re-check." _(web; offline toggle)_

## Diagnostics
- [ ] **Do:** Read the Diagnostics card → **Expect:** Version shows `<app version> · <short git SHA>` (e.g. `1.0.0 · f7f0bc0`), Platform = Web (desktop = Desktop), Connection = Online/Offline, Sync = Synced / "Syncing N…" / "N unsynced (offline)", Last sync = a real local timestamp or "—", Workspace = the workspace UUID. _(both — live-verified on web)_
- [ ] **Do:** Toggle DevTools offline → **Expect:** Connection flips to Offline live (online/offline listener). _(web)_
- [ ] **Do:** Click **Copy debug info** → **Expect:** button briefly shows "Copied"; clipboard holds a multi-line blob (Moduo version+build / Platform / Online / Workspace / Sync / Last sync). _(both — live-verified)_
- [ ] **Do (desktop):** Open on the Tauri build → **Expect:** Platform reads **Desktop** (via `__TAURI_INTERNALS__`). _(desktop — inferred, not run this session)_

## Edge cases
- [ ] **Do:** Open Advanced with no workspace selected → **Expect:** Export data is disabled; Workspace row shows "—". _(both)_
- [ ] **Do:** After a reset, immediately open Notes → **Expect:** notes re-download from cloud and render (the deleted local doc DBs re-hydrate). _(both)_

## Migrations / data
- [ ] No DB migration — DF-19g is entirely client-side. `rsbuild.config.ts` gained a build-time version/build define; confirm the Diagnostics version isn't `0.0.0 · dev` in a real build (that fallback only shows if the define is missing). _(both)_

## Known gaps / not-yet-testable
- **Desktop (Tauri) platform + reset** not run this session — same code path, only the platform label + WKWebView `databases()` support differ. On Firefox/older Safari `indexedDB.databases()` is unavailable, so a reset there drops only the named `moduo-notes-v2` DB (harmless — outbox empty, cloud is truth). Desktop WKWebView + Chrome support it.
- **RAM-only outbox window:** an edit that fell back to the engine's in-memory `memOutbox` (a transient IndexedDB write failure) is invisible to the reset guard; losing it requires that write-failure to coincide with being offline and an immediate reset (three unlikely conditions). Inherent — Settings can't see engine RAM.
- **Partial-export `_errors.json`** proven by unit test, not manually forced (no easy way to fail one module's read on the healthy test account).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
