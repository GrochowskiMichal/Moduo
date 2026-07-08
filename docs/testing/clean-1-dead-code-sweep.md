# Manual test checklist — CLEAN-1 legacy calendar dead-code sweep

> Generated 2026-07-03 · branch `t/maciej/clean-1-dead-code-sweep` · **Live-verified:** partial — `bun run verify` green (57 files / 526 tests), `cargo check` clean, plus a 4-agent removed-behavior/cross-file audit traced every remaining `runtime.calendar` caller and Tauri `invoke` to a surviving implementation. No browser pass (pure deletion, no observable change expected).
> Run top-to-bottom; check off as you go. This block deletes ~1,530 lines of dead code with **zero intended behavior change** — every check is a regression smoke, not a new feature.

## Calendar page (the live Wave-2 surface — most likely regression area)
- [ ] **Do:** open `/calendar` → **Expect:** week/day grid renders, your events and task blocks appear exactly as before _(both)_
- [ ] **Do:** create / drag / delete an event → **Expect:** works and persists after reload (Supabase path, untouched) _(both)_
- [ ] **Do:** check the left rail account map → **Expect:** Moduo + any connected external accounts, eye-toggle hides/shows their events _(both)_
- [ ] **Do:** open the dashboard Today widget → **Expect:** timed agenda renders as before _(both)_

## Desktop OAuth engine (kept — the sweep removed only dead JS wrappers around it)
- [ ] **Do:** Settings → Integrations → Connect Google (or Outlook) Calendar → **Expect:** browser OAuth flow opens and completes; account appears in the calendar rail _(desktop)_
- [ ] **Do:** wait for / trigger a sync after connecting → **Expect:** external events mirror into the grid (fetch commands `calendar_google/outlook_events_sync` untouched) _(desktop)_

## App shell
- [ ] **Do:** sign in and load the app (`/` after auth) → **Expect:** app gate → workspace → chrome loads with no console errors (the deleted `useSlotBookingsSync` mount was here) _(web)_

## Edge cases
- [ ] **Do:** on a machine that used the pre-Wave-2 calendar, inspect devtools → Application → localStorage → **Expect:** old `moduo:calendar:events-v1` / `sources-v1` / `accounts-v1` blobs may still exist but nothing reads or writes them anymore (deliberately not auto-deleted); the live `moduo:calendar:view:*` / `prefs:*` keys still update _(both)_
- [ ] **Do:** desktop app cold start → **Expect:** no startup error from the redb store (the `calendar_events` table is simply no longer opened; existing on-disk data is ignored, not migrated) _(desktop)_

## Migrations / data
- Nothing applied. No Supabase migration, no schema change. `slot_bookings` / `exposed_slot_links` tables remain in the DB but now have **no in-app consumer** (see decisions entry 2026-07-03 — product call pending on reviving booking links).

## Known gaps / not-yet-testable
- **Desktop runtime smoke not run** — no Tauri build in this session; `cargo check` (full crate compile check) is the gate. The three removed commands + two removed Google-write commands were verified to have zero `invoke()` call sites.
- **OAuth connect flow not exercised live** — needs real Google/Outlook creds on desktop (same standing gap as CAL-6b; the engine code is byte-identical, only its dead wrappers were deleted).
- **Booking links:** if any public `exposed_slot_links` are still live in prod, new confirmed bookings accumulate `calendar_synced=false` and surface nowhere — that was already true before this sweep (the old bridge wrote to a localStorage key nothing read); flagged as a product decision, not a regression.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
