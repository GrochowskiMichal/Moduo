# Manual test checklist — Tasks Timeline TL-2 (drag interactions)

> Generated 2026-07-03 · branch `claude/eloquent-engelbart-878286` · **Live-verified:** yes — every drag below was run on the hosted test workspace (bar move both directions, faded-edge set, solid-edge adjust, tray drop at 09:00, server round-trips confirmed by reload) except the items under "Known gaps".
> TL-1's render checks live in [tasks-timeline-tl1.md](./tasks-timeline-tl1.md). Run top-to-bottom.

## Bar body move (AC5)

- [ ] **Do:** in Timeline, grab a bar's middle and drag it a few days right → **Expect:** a live preview snaps day-by-day; on release the bar stays, and the detail panel shows the scheduled/due dates moved by whole days with the original clock time (e.g. 8:00 stays 8:00) _(both)_
- [ ] **Do:** drag it back left → **Expect:** same, in reverse; reload → the change persisted _(both)_
- [ ] **Do:** click a bar without moving → **Expect:** it only selects (opens the detail panel), no reschedule _(both)_

## Edge drags (AC5)

- [ ] **Do:** hover a bar's left/right edge → **Expect:** the cursor becomes a horizontal resize arrow (middle shows a grab hand) _(both)_
- [ ] **Do:** drag the **solid** right edge of a both-dates bar → **Expect:** only the due date changes, to the day under the pointer _(both)_
- [ ] **Do:** drag the **faded** end of a scheduled-only bar → **Expect:** it *sets* the due date — the fade disappears and the bar solidifies into a span _(both)_
- [ ] **Do:** drag the faded start of a due-only bar → **Expect:** it sets the scheduled time at 09:00 that day _(both)_
- [ ] **Do:** drag an end edge left past the start (or a start right past the end) → **Expect:** the span clamps at one day — it never inverts _(both)_

## Tray → axis (AC6)

- [ ] **Do:** create an undated task (New) → **Expect:** it appears in the Unscheduled tray with a small grip on its chip _(both)_
- [ ] **Do:** drag the chip up onto a day → **Expect:** a quiet day-wide wash tracks the pointer; on release the task is scheduled **that day at 9:00 AM**, no due date is set, and the chip leaves the tray _(both)_
- [ ] **Do:** drag a chip and release it outside the axis (over the rail, header, tray) → **Expect:** nothing happens — no stray schedule _(both)_

## Rollback + read-only

- [ ] **Do:** with the network cut (devtools offline), drag a bar → **Expect:** the optimistic move rolls back and the standard error toast appears _(web)_
- [ ] **Do:** as a view-only member → **Expect:** bars don't drag (plain pointer), no resize cursors, tray chips have no grips and don't drag _(web)_

## Known gaps / not-yet-testable

- **Offline rollback + view-only** — verified by code path (the shared `patchTask` optimistic infra + `canEdit` gates), not live (owner account, stable network).
- **e2e smoke** (`e2e/tasks/timeline.spec.ts`) is authored and env-gated on `E2E_APP_URL` — worktree preview can't run authed Playwright.
- **Connector-dot dependency creation** is TL-3, not this block.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
