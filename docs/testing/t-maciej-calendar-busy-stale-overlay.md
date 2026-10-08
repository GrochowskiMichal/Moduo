# Manual test checklist — calendar busy overlay follows the workspace

> Generated 2026-10-08 · branch `t/maciej/calendar-busy-stale-overlay` · **Live-verified:** no. Busy blocks only appear when another member shares a calendar with you at the free/busy level, and the agent can't create that second account. The fix lives entirely in what `useCalendarModule` returns as `events`, which the page renders as is, and `use-calendar-module.window.test.tsx` checks that output directly.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Setup (once)
- [ ] **Do:** in workspace **A**, have a second member share a calendar with you at **free/busy** (not view), with an event this week → **Expect:** a "Busy" block in your week view at that time _(web)_
- [ ] **Do:** pick a second workspace **B** where nobody shares a free/busy calendar with you → **Expect:** B's week shows only B's own events _(web)_

## Switching workspaces
- [ ] **Do:** open Calendar in A, then switch to B from the workspace switcher → **Expect:** A's "Busy" block is gone as soon as B shows, and doesn't come back while B loads _(web)_
- [ ] **Do:** switch back to A → **Expect:** A's "Busy" block comes back a moment after A's events load _(web)_

## Same workspace, no flash
- [ ] **Do:** in A, click **Refresh calendars** (the ↻ in the toolbar; it shows once you have a connected calendar) → **Expect:** the "Busy" blocks stay on screen the whole time the refresh runs. They never blink off and on _(web)_

## Known gaps / not-yet-testable
- Not live-verified (see the header). The hook test covers each path, and the first two fail when the fix is reverted: a switch hides the old workspace's blocks while the new reply is still out, and losing read access clears them. Two more pin what must keep working: a reply that was still out when access went away doesn't bring the blocks back, and a same-workspace reload keeps them up until the new reply replaces them.
- Losing access can't be checked from the UI on an open page. A role change only reaches the page after a workspace action or a reload, and a reload remounts the calendar, so the cleared state is the starting state. The hook test covers it.
