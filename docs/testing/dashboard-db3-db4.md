# Manual test checklist — Dashboard DB-3 + DB-4 (edit mode, drag, persistence, pages)

> Generated 2026-07-09 · branch `claude/intelligent-gould-b46b60` · **Live-verified:** partial — everything below was verified on the hosted web account **except the pointer-drag gesture** (steps under "Drag & arrange"), which is unsimulable in a worktree (the recorded FX-9/TL-2 gotcha). Run top-to-bottom; each item is a step → what you should see → where.

## Home layout & vertical fill
- [ ] **Do:** open Home (`/`, ⌘1) on a fresh account (no saved layout). → **Expect:** the curated default page — Tasks (L, left half) · Calendar (M, top-right) · Quick capture (S) · Clock (S); no page dots (single page); a quiet **pencil** Edit control at the bottom-right of the bottom bar. _(both)_ ✅ verified
- [ ] **Do:** look at the top and bottom edges of the grid. → **Expect:** the widgets fill the whole content area top-to-bottom with only a small uniform gutter — **no large empty gap** above the bottom bar (the DB-4 vertical-fill fix). _(both)_ ✅ verified
- [ ] **Do:** resize the window from small to ultrawide (and reshape the aspect). → **Expect:** the composition holds — only the cells rescale, widgets never reflow or disappear (AC1, the signature moment). _(both)_

## Edit mode & controls (chrome, bottom bar)
- [ ] **Do:** click the **pencil** (bottom-right). → **Expect:** edit mode — faint grid lines fade in over empty cells, each widget grows a ✕ + resize (⤢) cluster (top-right), the pencil becomes a text **"Done"** button, and the bottom-**left** shows the page dots + a **+** (add page) and 🗑 (remove page, disabled at 1 page). _(both)_ ✅ verified
- [ ] **Do:** right-click anywhere on the grid. → **Expect:** a menu with "Edit dashboard" / "Done editing". _(both)_ ✅ verified
- [ ] **Do:** in normal mode, press-and-hold a widget (~0.5s) without moving. → **Expect:** enters edit mode and picks the widget up in one gesture. _(both, pointer — manual)_
- [ ] **Do:** press **Done**, then re-enter and press **Escape**. → **Expect:** both exit edit mode — controls + grid lines vanish, control reverts to the pencil. _(both)_ ✅ verified

## Drag & arrange (pointer — the main manual surface)
- [ ] **Do:** in edit mode, drag a widget over another. → **Expect:** neighbours glide out of the way (live preview); on drop they settle with no gaps (auto-compact up-then-left). _(both)_
- [ ] **Do:** drag a widget somewhere nothing can fit (e.g. shove past the edge). → **Expect:** it snaps back, layout unchanged. _(both)_
- [ ] **Do:** resize a widget (⤢ → S/M/L/XL). → **Expect:** it grows/shrinks, neighbours reflow; a size that can't fit keeps the old size. _(both)_ ✅ verified
- [ ] **Do:** remove a widget (✕). → **Expect:** the gap closes as others compact up-then-left. _(both)_ ✅ verified

## Pages & navigation
- [ ] **Do:** in edit mode, click **+** (add page). → **Expect:** a new empty page; the bottom-left now shows 2 dots (2nd active); 🗑 becomes enabled. _(both)_ ✅ verified
- [ ] **Do:** click the first dot / press ←/→ / two-finger horizontal swipe over empty grid area. → **Expect:** pages slide; the active dot follows. _(both — swipe is trackpad)_ ✅ verified (dots + arrows; swipe manual)
- [ ] **Do:** in edit mode on page 2, click 🗑 (remove page). → **Expect:** page removed, back to 1 page; on the last remaining page 🗑 is **disabled** (can't delete the last page). _(both)_ ✅ verified
- [ ] **Do:** navigate to a page, then reload. → **Expect:** it remembers your page (device-local). _(both)_ ✅ verified

## Persistence (AC6)
- [ ] **Do:** rearrange / add / remove a widget or page, wait ~1s, reload. → **Expect:** the change persists (saved to Supabase + local cache). _(both)_ ✅ verified (prod round-trip)
- [ ] **Do:** make a change on one device, open Home on a second device (same user+workspace). → **Expect:** the second device shows your saved layout, but keeps its own active page. _(both)_ — *not verified (single browser); the load-path re-push covers a cut-off save.*
- [ ] **Do:** go offline (devtools), rearrange, then come back online. → **Expect:** editing keeps working from the local cache; it syncs up on the next opportunity, no error nag. _(both)_ — *not verified live.*

## Chrome placement (shared bottom bar — regression check)
- [ ] **Do:** navigate to `/notes`, `/tasks`, `/calendar`, etc. → **Expect:** the bottom bar shows the **left + right panel toggles** as before (NOT the dashboard controls); Home is the only route with dots + Edit/Done. _(both)_ ✅ verified (/notes)
- [ ] **Do:** enter edit mode on Home, navigate away, come back. → **Expect:** returns in normal mode (control shows "Edit"), no stale "Done". _(both)_

## Edge cases
- [ ] **Do:** (dev) corrupt the stored layout — set a bogus `dashboard_layouts.layout_data` or the local `moduo:ls:dashboard:<ws>` cache to garbage, reload. → **Expect:** Home degrades to a sanitized, compacted grid (or the default) — never a crash or overlapping widgets (AC11). _(both)_ — *engine-tested; live-corruption not exercised.*
- [ ] **Do:** be a workspace member with a widget's module set to "view"/"none". → **Expect:** read-only / "No access" placeholder — *DB-5 concern, not in this branch.*

## Migrations / data
- [ ] **No migration this branch.** DB-4 **reuses the existing prod `dashboard_layouts` table** (keyed `layout_key='home'`). The read/write/upsert/RLS pattern was round-trip-verified against prod (authed, rolled back — insert/read/idempotent-upsert/RLS-isolation all green). Nothing to deploy. Confirm a real edit writes one row per (user, workspace): `select * from dashboard_layouts where layout_key='home'`. ✅ verified

## Known gaps / not-yet-testable
- **Pointer drag physics** (push preview + snap-back finger-follow) — unsimulable in a worktree; the engine half is proven live via resize/remove and the geometry via unit tests, but the *feel* is your pass.
- **Second-device sync + offline** — needs two sessions / network toggling; the LWW + cache-wins-re-push logic is unit-tested.
- **Desktop (Tauri)** — the runtime delegates the dashboard wholesale to the web path (Supabase-direct), so behavior should match web; not launched on desktop this session.
- **Reduced-motion** — the slide/FLIP ride the motion tokens (0s under `prefers-reduced-motion`); not toggled live.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
