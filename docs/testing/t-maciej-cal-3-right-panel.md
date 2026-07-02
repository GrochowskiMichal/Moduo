# Manual test checklist — CAL-3: Right-panel switcher + drag-to-schedule + complete-in-block

> Generated 2026-07-02 · branch `t/maciej/cal-3-right-panel` · **Live-verified:** yes — on the hosted test account against the deployed backend (switcher + persistence, panel groups, drop landing exactly on target, stray-drop no-op, block move/resize, popover → TaskDetailPanel). Desktop untested.
> Run top-to-bottom; check off as you go.

## The right-panel switcher (AC11)

- [ ] **Do:** Open `/calendar` → **Expect:** the right panel shows a **Tasks | Detail** switcher at the top; Tasks is the default _(both)_
- [ ] **Do:** Switch to Detail with nothing open → **Expect:** quiet "Select something on the calendar." _(both)_
- [ ] **Do:** Pick Detail, reload → **Expect:** the panel comes back on Detail (last variant persists per workspace) _(both)_
- [ ] **Do:** Click any chip → Open → **Expect:** the switcher flips to Detail automatically; switching back to Tasks closes nothing — reopening via the chip returns _(both)_

## The Tasks view (the drag source)

- [ ] **Do:** Look at the groups → **Expect:** **Today** (your committed queue, in commit order) · **Due soon** (overdue + next 7 days) · **Backlog** (open, unscheduled); each row = checkbox · title · duration chip · due hint _(both)_
- [ ] **Do:** Type in the search field → **Expect:** all groups filter; a dry query says so _(both)_
- [ ] **Do:** With zero rows → **Expect:** "Nothing to schedule — capture a task or enjoy the calm." + a **Capture** button that opens the capture modal _(both)_
- [ ] **Do:** Tick a row's checkbox → **Expect:** completes (same op as everywhere); it does NOT open the task _(both)_
- [ ] **Do:** Give a task in Tasks an overdue due-date → **Expect:** it shows under **Due soon** (never vanishes) _(both)_

## Drag-to-schedule (AC6)

- [ ] **Do:** Drag a Backlog row onto tomorrow ~10:00 → **Expect:** a drag ghost follows, the target column tints, the drop lands **at the slot you pointed at** (15-min snap), the block appears <200ms, and the row leaves Backlog (if committed, it stays in Today with a ✓-time) _(web)_
- [ ] **Do:** Pick up a row, wiggle it, and release it **over the panel** (not the grid) → **Expect:** nothing happens — no silent scheduling _(web)_
- [ ] **Do:** Check the same task in the Tasks page → **Expect:** its Scheduled field shows the dropped time (one row, one truth) _(both)_

## Task blocks on the grid (AC6 + AC7)

- [ ] **Do:** Drag a task block's body to another slot/day → **Expect:** live preview + readout; the drop updates the schedule; **duration unchanged** _(web)_
- [ ] **Do:** Drag its bottom edge → **Expect:** duration changes (writes `durationMinutes`); the panel row's duration chip updates _(web)_
- [ ] **Do:** Single-click a block → **Expect:** popover: checkbox · title · day/time · duration · Open _(web)_
- [ ] **Do:** Open → **Expect:** the full existing **Task detail panel** in the right panel (status/bucket/schedule/tags/subtasks/activity — everything) _(both)_
- [ ] **Do:** Tick the block's checkbox (grid or popover) → **Expect:** done in place; recurring tasks advance their pointer; uncheck reopens (AC7 — unchanged from CAL-1) _(both)_

## Edge cases

- [ ] **Do:** Select an event chip, close its popover, click a panel row, press Backspace → **Expect:** NOTHING is deleted (destructive keys need neutral focus) _(web)_
- [ ] **Do:** As view-only member → **Expect:** rows not draggable, checkboxes disabled, grid drops rejected _(both)_
- [ ] **Do:** Keyboard: Tab to a panel row, press Space or Enter → **Expect:** opens the task's Detail _(web)_

## Known gaps / not-yet-testable

- Keyboard users can't drag rows onto the grid (pointer-only) — an accessible "Schedule…" affordance is a follow-up (Tasks' own detail panel covers the a11y path today: set Scheduled there).
- The drop-hover column tint dims inside off-hours wash regions — cosmetic.
- e2e `e2e/calendar/schedule.spec.ts` is env-gated (`E2E_APP_URL`) — not in CI.
- Desktop (Tauri) untested; all paths are runtime-agnostic.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
