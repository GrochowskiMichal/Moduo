# Manual test checklist — CAL-1: Calendar page shell + task-lens grid

> Generated 2026-07-02 · branch `t/maciej/cal-1-shell-lens` · **Live-verified:** yes — web preview + the hosted test account (views, keyboard nav, persistence, block render, complete/reopen). Desktop untested.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Page & navigation

- [ ] **Do:** Look at the top bar → **Expect:** a **Calendar** tab sits between Tasks and Mindmap; clicking it opens `/calendar` _(both)_
- [ ] **Do:** Press ⌘4 (Ctrl 4) → **Expect:** Calendar opens; ⌘7 now reaches Contacts _(both)_
- [ ] **Do:** ⌘K → type "calendar" → **Expect:** "Open Calendar" appears and navigates _(both)_
- [ ] **Do:** First-ever open → **Expect:** **Week view**, current week, scrolled so now is roughly centered; today's header is emphasized by weight (not color) _(both)_

## The grid

- [ ] **Do:** Look at today's column → **Expect:** a thin accent **now-line with a dot** in today's column only; it moves over time (≤30s tick) _(both)_
- [ ] **Do:** Compare 7–8 AM and 6+ PM against midday → **Expect:** off-hours (before 08:00, after 18:00) carry a subtly dimmed wash _(both)_
- [ ] **Do:** Schedule a task in Tasks (e.g. today 15:00, 45m) → open Calendar → **Expect:** one muted, outlined block at 15:00–15:45 with a checkbox; **no duplicate anywhere** _(both)_
- [ ] **Do:** Schedule a task with no duration → **Expect:** the block is 30 minutes _(both)_
- [ ] **Do:** Tick a block's checkbox → **Expect:** it completes **in place** — filled check, strikethrough, dimmed; the same task shows done in Tasks; unticking reopens it _(both)_
- [ ] **Do:** Complete a **recurring** task's block → **Expect:** quiet toast (e.g. "Done — next …"), pointer advances exactly like completing in Tasks _(both)_
- [ ] **Do:** Schedule 4 tasks overlapping the same half-hour → **Expect:** three side-by-side narrow chips + a small **"+1"** chip (hover shows the hidden title; its popover arrives with CAL-2) _(both)_

## Toolbar, views, keyboard

- [ ] **Do:** Click **Day | Week** segments; press **D** / **W** → **Expect:** views switch; Day = one wide column with the same chips _(both)_
- [ ] **Do:** Press **← / →**, then **T** → **Expect:** period steps (day/week per view), range label updates ("Jun 29 – Jul 5" / "Thursday, July 2"), T returns to today _(both)_
- [ ] **Do:** Open any dropdown/dialog and type "w" or "d" → **Expect:** the calendar does NOT switch views behind the overlay _(both)_
- [ ] **Do:** Switch to Day view on some other date, reload the app → **Expect:** Day view + that date restored (per user & workspace) _(both)_

## Left rail

- [ ] **Do:** Click a day in the mini-month → **Expect:** the grid jumps there (Day view: that day; Week view: its week); days carrying scheduled tasks show a small dot — including days outside the visible week _(both)_
- [ ] **Do:** Look under CALENDARS → **Expect:** a single "Moduo" row (color swatch + name, no toggle yet) and **+ Connect calendar…** which opens Settings _(both)_
- [ ] **Do:** Drag the rail/center divider; collapse the left panel from the top bar → **Expect:** widths persist; the panel toggle affects the **calendar's** layout (and not the Notes page's) _(web)_

## States & permissions

- [ ] **Do:** Open Calendar with no scheduled tasks → **Expect:** the calm grid + one quiet line in today's column ("Nothing scheduled — tasks with a time land here.") — no illustration wall _(both)_
- [ ] **Do:** As a **view-only** member (tasks permission = view) → **Expect:** grid fully visible; block checkboxes disabled with a "View-only in this workspace" tooltip _(both)_
- [ ] **Do:** With tasks permission = none → **Expect:** no Calendar tab; deep-linking `/calendar` shows the quiet "Calendar unavailable" state _(both)_
- [ ] **Do:** Kill the network, reload `/calendar` → **Expect:** the grid chrome still renders with an inline "Couldn't load your tasks" + Retry; no blank page _(web)_

## Edge cases

- [ ] **Do:** Nothing — note for later: on the two DST-change days (e.g. Mar 29 / Oct 25 Europe), the changed day renders 23/25 real hours; in **Week** view that column's chips sit ±1h against the *shared* gutter labels (chip time text stays correct; Day view is fully correct). Known cosmetic gap, recorded. _(both)_

## Migrations / data

- Nothing — CAL-1 deliberately ships **zero migrations**; the page rides only shipped Tasks reads/ops (the AC13 deploy-gap posture holds by construction).

## Known gaps / not-yet-testable

- Right panel is hidden until CAL-3 (the Tasks|Detail switcher block). Draw-to-create, event chips, popovers = CAL-2. Drag-to-schedule = CAL-3.
- Desktop (Tauri) untested from this worktree — web-only preview; the page is runtime-agnostic (Tasks bundle) so desktop should match.
- Visual-snapshot baselines for the new chip states (story `Calendar/TaskBlockChip`) remain a deliberate human capture.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
