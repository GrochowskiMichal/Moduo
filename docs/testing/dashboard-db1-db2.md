# Manual test checklist — dashboard DB-1 + DB-2 (+ workflow-skill rename)

> Generated 2026-07-09 · branch `claude/unruffled-chaplygin-6584bf` · **Live-verified:** partial — DB-2 Home verified on the **web** rsbuild preview (hosted account); the packaged desktop `.app` was not exercised this session.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Home / dashboard grid (DB-2)
- [ ] **Do:** open the app (or press ⌘1 from any page) → **Expect:** you land on **Home** — the nav shows "Home" first with a house icon, active. _(both)_ · _web-verified_
- [ ] **Do:** look at Home → **Expect:** the curated default layout as titled placeholder cards — **Tasks** filling the left half, **Calendar** top-right, **Quick capture** + **Clock** bottom-right — filling the content area edge-to-edge, no scrollbar. _(both)_ · _web-verified_
- [ ] **Do:** resize the window from narrow to wide/ultrawide (and back) → **Expect:** the four widgets keep the **exact same relative composition**; only the cells rescale — nothing reflows, nothing scrolls. (This is the whole point of the rebuild.) _(both)_ · _web-verified at a wide aspect_
- [ ] **Do:** check the bottom bar on Home → **Expect:** full-bleed — **no left/right side panels** and **no chevron panel-toggle buttons**; only the global actions (settings / search / create) show. _(both)_ · _web-verified_
- [ ] **Do:** visit Notes / Tasks / Calendar / Contacts → **Expect:** those still show their left/right panels + toggle buttons (the full-bleed change is **Home-only** — the `isHomeRoute` guard is exact-match). _(both)_
- [ ] **Do:** ⌘K → type "Home" → **Expect:** "Open Home" (house icon, first entry) navigates to `/`. _(both)_ · _web-verified_
- [ ] **Do:** click a widget card → **Expect:** nothing happens yet — they're non-interactive placeholders (real data + interaction arrive in DB-5). _(both)_
- [ ] **Do:** at the minimum window size (≈1024×700) → **Expect:** the grid still fits 8×4 with the smallest (S) cells legible; no scroll. _(desktop)_ · _not explicitly verified; S ≈ 226×128px by design_

## Desktop parity (DB-2)
- [ ] **Do:** `bun run build:desktop --bundles app`, open the built `Moduo.app`, go to Home → **Expect:** identical to web — grid renders, resize holds composition, no panel toggles. _(desktop)_ · **not verified this session (web preview only)**

## Workflow-skill rename → /s1 /s2 /s3
- [ ] **Do:** in a **fresh** session type `/s1`, `/s2`, `/s3` → **Expect:** each runs the plan / execute / wrap skill (no "isn't available in this environment"). `/plan` still opens the built-in plan mode (that's the collision we renamed around). _(n/a — tooling)_ · _rename registered live this session_
- [ ] **Do:** open the `/`-menu and read the three → **Expect:** descriptions lead with "Stage 1 — Plan / Stage 2 — Execute / Stage 3 — Wrap". _(n/a — tooling)_

## Grid engine (DB-1)
- [ ] **Do:** `bun run test` → **Expect:** green, including `src/features/dashboard/engine/*.test.ts` — the invariant + 1,000-iteration fuzz suites (never out of bounds, never overlapping, reject-never-wrap, compaction idempotent, sanitize never throws). _(n/a — unit)_ · _verify green, 864 tests_

## Migrations / data
- [ ] **Do:** — → **Expect:** none this session. DB-1/DB-2 add no schema; the `dashboard_layouts` + `habits` tables arrive in DB-4 / DB-7. Data-safety reminder: nothing here is persisted yet (Home seeds the default layout locally each load until DB-4).

## Known gaps / not-yet-testable
- **Desktop build not exercised** — DB-2 was live-verified on the web rsbuild preview against the hosted account, not a packaged Tauri `.app`. The desktop-parity row above is the one thing to confirm on your machine.
- **Placeholders only** — widgets have no real data/interaction until **DB-5**; **edit mode + drag** (rearrange, resize, remove, add) until **DB-3**; **cloud-synced multi-page layouts** until **DB-4**. So there's nothing to drag or configure yet — this is the static shell.
- **Pre-existing a11y warning** — the command palette logs a Radix "`DialogContent` requires a `DialogTitle`" console warning; it predates this session (the palette's `CommandDialog`, not the dashboard) and is cosmetic.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
