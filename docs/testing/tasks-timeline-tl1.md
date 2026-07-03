# Manual test checklist — Tasks Timeline TL-1 (static timeline)

> Generated 2026-07-03 · branch `claude/eloquent-engelbart-878286` · **Live-verified:** yes — all checks below were run on the hosted test workspace from this worktree (preview server + session injection) except the two under "Known gaps".
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## View switcher + persistence (AC1)

- [ ] **Do:** open /tasks → the Plan header's view switcher now has a third segment (gantt icon, tooltip "Timeline view") → **Expect:** clicking it swaps the center to the timeline; List/Board unchanged _(both)_
- [ ] **Do:** switch to Timeline, reload the page → **Expect:** Timeline is still the active view _(both)_
- [ ] **Do:** pick a single bucket in the rail vs All vs Queue → **Expect:** the timeline shows just that bucket's lane / all buckets with dated tasks / the committed set — same scoping as List/Board _(both)_
- [ ] **Do:** apply a tag filter → **Expect:** bars and tray chips narrow to matching tasks, same as List/Board _(both)_

## Axis, zoom, today (AC3)

- [ ] **Do:** cycle Week | Month | Quarter → **Expect:** day ticks ("Fri 4") / Monday ticks (day numbers) / month ticks ("Jul"); month bands along the top; bars resize accordingly _(both)_
- [ ] **Do:** reload after picking Quarter → **Expect:** Quarter is remembered (Month is the default for a fresh workspace) _(both)_
- [ ] **Do:** scroll far into the past, press **Today** → **Expect:** smooth recenter on the today line (quiet accent line + small "Today" pill in the header) _(both)_

## Bar grammar (AC2)

- [ ] **Do:** give a task both a scheduled time and a due date → **Expect:** a solid bar spanning both days inclusive _(both)_
- [ ] **Do:** a task with only a scheduled time → **Expect:** solid left edge, right side fades out; the checkbox + title sit *beside* the bar, past the fade _(both)_
- [ ] **Do:** a task with only a due date → **Expect:** fades in from the left, solid right edge on the due day; checkbox + title beside the bar _(both)_
- [ ] **Do:** a wide both-dates bar vs a narrow one (zoom out to Quarter) → **Expect:** wide bars carry the checkbox + title inside; narrow ones move them beside the bar _(both)_
- [ ] **Do:** a task with neither → **Expect:** not on the axis; it sits in the bottom "Unscheduled" tray _(both)_
- [ ] **Do:** set a due date, then click the bar → set a date on the other side → **Expect:** the faded edge solidifies _(both)_

## Lanes (AC4)

- [ ] **Do:** in All, look at the lane list → **Expect:** bucket swimlanes in rail order (Inbox first); buckets with no dated tasks don't render a lane _(both)_
- [ ] **Do:** click a lane header → **Expect:** the lane collapses to just its header (count stays); clicking again restores; arrows into a collapsed lane disappear _(both)_

## Dependencies — render only in TL-1 (AC7)

- [ ] **Do:** view two dated tasks where one blocks the other (detail panel → Blocked by) → **Expect:** a subtle curved arrow from the blocker bar's end to the blocked bar's start; the blocked bar's title is dimmed with the dashed-circle lock marker _(both)_
- [ ] **Do:** hover or select either endpoint task → **Expect:** the arrow highlights (accent); others stay subtle _(both)_

## Quiet drift + done (AC9)

- [ ] **Do:** find an open task whose date is past → **Expect:** a small muted dot on the bar (tooltip "Past its date — still open"); nothing red, nowhere says "overdue" _(both)_
- [ ] **Do:** check a bar's checkbox → **Expect:** the bar mutes + title strikes through; unchecking restores. Recurring tasks show the usual recurrence toast _(both)_

## Click → detail (AC1/AC5 seam)

- [ ] **Do:** click any bar or tray chip → **Expect:** the right-rail detail panel opens on that task (same panel as List/Board) _(both)_

## Edge cases (AC10)

- [ ] **Do:** filter to a scope with no dated tasks → **Expect:** the axis still renders with the today line, a one-line hint, and the tray expanded _(both)_
- [ ] **Do:** as a view-only member → **Expect:** bars/tray render, checkboxes disabled, nothing editable _(web)_
- [ ] **Do:** give a task a due date *before* its scheduled date (via the detail panel) → **Expect:** it renders as a 1-day bar at the scheduled day, not an inverted bar _(both)_

## Known gaps / not-yet-testable

- **View-only member** — the test account owns its workspace, so `canEdit=false` was verified via the story/props only, not live.
- **Empty-scope hint** — the test workspace has dated tasks in every scope; verified via the Storybook `Empty` story, not live.
- **Visual baselines** — `tests/visual/tasks-timeline.spec.ts` is authored, but PNG capture is a deliberate human run (`bun run storybook` + `bunx playwright test --project=visual --update-snapshots`); Storybook doesn't render in worktrees.
- **Drags** (bar move/resize, tray drop, connector-dot) are TL-2/TL-3 — not in this block.
- **Keyboard task-selection on bars** is deferred (Board parity — bars are mouse surfaces; the checkbox is the native tab stop, and List remains the keyboard-first view).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
