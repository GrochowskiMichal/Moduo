# Manual test checklist — DF-19f (Settings → Preferences)

> Generated 2026-07-12 · branch `t/maciej/df-19f-preferences` · **Live-verified:** yes (web, hosted test account). The migration was applied to prod + round-trip-verified after the first live-verify pass (initial verify ran against the migration-absent DB = the graceful-degrade path; cross-device sync is now live). Desktop-specific rows not run (no desktop this session).

## Preferences section renders
- [ ] **Do:** Open Settings (⌘, or user menu) → **Preferences** (Personal group) → **Expect:** three eyebrow-labelled cards — **Default landing view** (Open on launch → select, default "Home"), **Startup** (Reopen last workspace → toggle, on), **Sounds & motion** (Sound effects → toggle on; Motion → select "Match device"). No Notifications or confirm-before-quit rows (held). _(both)_
- [ ] **Do:** Deep-link `…/settings?section=preferences` on a cold load → **Expect:** modal opens straight to Preferences. _(both)_

## Default landing view
- [ ] **Do:** Set Open-on-launch to **Tasks**, then fully reload the app at `/` (or relaunch) → **Expect:** lands on **/tasks**, Tasks tab active. _(both)_
- [ ] **Do:** Set it to **Last used**, visit Calendar, relaunch → **Expect:** lands on **/calendar**. _(both)_
- [ ] **Do:** Set it back to **Home** → relaunch → **Expect:** lands on Home. _(both)_
- [ ] **Do:** With landing = Tasks, open the app via a deep link that carries a query string (e.g. `/?section=billing`, or click a notification to `/tasks?id=…`) → **Expect:** the deep-link wins (Settings→Billing opens / the linked task shows); you are NOT bounced to the landing view. _(both)_
- [ ] **Do:** In-app, click the **Home** nav tab after landing elsewhere → **Expect:** Home shows and stays (the landing redirect is boot-only, never fires on an in-app nav). _(both)_

## Sounds & motion
- [ ] **Do:** Set Motion = **Reduced** → **Expect:** UI animations/transitions stop moving (overlays/among others snap); a soft fade may remain. Reload → still reduced (no flash of full motion at boot). _(both)_
- [ ] **Do:** Set Motion = **Full** while your OS "Reduce motion" is ON (macOS System Settings → Accessibility → Display) → **Expect:** Moduo animates fully despite the OS setting. _(both)_
- [ ] **Do:** Set Motion = **Match device** → **Expect:** follows the OS setting. _(both)_
- [ ] **Do:** Turn **Sound effects** OFF, run a Focus interval to completion (Tasks → Focus) → **Expect:** no end-of-interval chime. Turn it back ON → chime plays (also needs the Focus section's own Sound toggle on). _(both)_

## Startup
- [ ] **Do:** (needs ≥2 workspaces) Switch to workspace B, turn **Reopen last workspace** OFF, relaunch → **Expect:** opens your **first** workspace, not B. Turn it ON, relaunch from B → opens B. _(both)_

## Cross-device sync (migration now applied — testable)
- [ ] **Do:** Change landing view / motion / sound on device A, then launch device B (same account), then relaunch B → **Expect:** B reflects A's choices (the app-wide reconcile pulls the cloud value at boot; the redirect/motion apply on the launch after the pull). _(both)_

## Migrations / data
- [ ] **Do:** Apply `supabase/migrations/20260712115000_user_preferences_preferences_domain.sql` to prod (adds `preferences jsonb` + `preferences_updated_at`) and regenerate `src/types/supabase.ts` if desired → **Expect:** `select preferences from user_preferences` works; a preference change now writes to the row (`preferences_updated_at` bumps) and the sync meta (`moduo.preferences.sync`) shows `dirty:false`. Before applying, the app still works fully single-device (localStorage mirror) and pushes degrade to a benign no-op with no console error.

## Known gaps / not-yet-testable
- **Migration unapplied to prod** (no Supabase MCP/CLI in the build session) — cross-device sync is deferred until it lands; everything else works single-device off the localStorage mirror.
- **Notifications toggles** — intentionally NOT shipped; gated on DF-9 (its generators must read the pref to actually suppress). Joins this domain post-DF-9 with no migration.
- **Confirm-before-quit** (desktop) — intentionally NOT shipped; needs Tauri close-request wiring + desktop verification.
- **Motion "Full" overriding OS reduce** and **desktop-only** rows could not be exercised in the headless web session (no `prefers-reduced-motion:reduce` emulation, no desktop) — verify manually per the rows above.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
