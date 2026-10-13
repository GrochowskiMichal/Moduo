# Manual test checklist — TV-U1 Rows, board, completed

> Generated 2026-10-09 · branch `t/maciej/tv-u1-rows-board-completed` · **Live-verified:** partial — the real List and Board ran in the web app's CSS with fixture data through a temporary harness (deleted before landing): columns lined up at all 3 densities, and alignment, row height and the selection tint held across all 144 radius × shade × accent combinations; check-off-stays, scope change, "N completed · show/hide", Display → 7 days / Energy and the board's columns and meta line were driven by hand. Not run against the hosted account (no session in the preview pane).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Rows (List)
- [ ] **Do:** open a bucket with tasks that have a priority, a due date and an assignee → **Expect:** after each title, quiet counts (`# 3` for tags, `1/3` for subtasks, a dashed circle when blocked, a loop when it repeats); on the right, the priority bars, the date, the avatar and the queue mark sit in columns that line up down the list _(both)_
- [ ] **Do:** open a bucket where no task has a priority → **Expect:** no empty priority gap on the right; the date column moves over _(both)_
- [ ] **Do:** look at tags on rows → **Expect:** a `# N` count, never coloured chips; hovering it lists the tag names _(both)_
- [ ] **Do:** compare Low / Medium / High priority → **Expect:** the same three-bar footprint each time, 1 / 2 / 3 bars filled, the rest faint (Medium shows now; it used to render nothing) _(both)_
- [ ] **Do:** give a task a scheduled time today and another a due date next week → **Expect:** the first shows the time with a clock, the second the weekday or date; hovering shows both dates when a task has both _(both)_
- [ ] **Do:** select a row, then press `s`, `d` and `b` → **Expect:** the scheduled, due and bucket editors open on that row; Esc hands focus back to the list _(both)_
- [ ] **Do:** hover a row that isn't queued → **Expect:** the queue toggle fades in at the far right; a queued row shows it all the time _(both)_
- [ ] **Do:** open All (flat, Group: Status) → **Expect:** each row names its bucket as a dot + name in muted text, not a pill; clicking it opens the bucket picker _(both)_

## Completed
- [ ] **Do:** open a bucket with done tasks → **Expect:** done tasks are hidden; the list ends with "N completed · show" _(both)_
- [ ] **Do:** click "show", then "hide" → **Expect:** the done rows appear dimmed and struck through (checkbox at full strength), then hide again _(both)_
- [ ] **Do:** check off an open task → **Expect:** it stays where it was, struck through and dimmed; clicking its checkbox again reopens it _(both)_
- [ ] **Do:** switch to another bucket and back → **Expect:** the task you checked off is now behind the "N completed" line (count up by one) _(both)_
- [ ] **Do:** Display → Completed: 7 days, then All → **Expect:** 7 days lists tasks completed this week; All lists every one and the line disappears; reload keeps the choice for this bucket only _(both)_
- [ ] **Do:** Display → Show on rows → Energy on → **Expect:** an energy column appears where tasks have an energy; off again hides it _(both)_
- [ ] **Do:** open the Queue → **Expect:** no Completed choice in Display; a task you check off there stays until reload (TV-D4) _(both)_

## Board
- [ ] **Do:** switch to Board on a wide window, then narrow it → **Expect:** columns grow to 400 px at most and shrink to 280 px before the board scrolls sideways _(both)_
- [ ] **Do:** look at a card → **Expect:** title, then one quiet line: priority, date, counts, bucket (in All), and the queue mark and avatar at the right; a selected card has the accent tint _(both)_
- [ ] **Do:** look at the Done column → **Expect:** "N completed · show"; showing reveals faded done cards; dragging a card into Done still completes it and it stays visible _(both)_

## Appearance
- [ ] **Do:** Settings → Appearance: try Dense, Compact and Comfortable, each radius, a few shades and accents → **Expect:** rows keep their height, the columns stay aligned, avatars stay icon-sized, selection stays a tint _(both)_

## Edge cases
- [ ] **Do:** with completed hidden, open a link to a completed task (the panel's copy-link, then paste it, or reload with `?id=`) → **Expect:** it lands on that task's row (dimmed, struck through) instead of jumping to another task; it stays listed after you move on, until you switch scope _(both)_
- [ ] **Do:** open a link to a completed subtask whose parent is also completed → **Expect:** the parent row stays and expands, with the subtask selected _(both)_
- [ ] **Do:** click "N completed · show", click through a few done rows, then "hide" → **Expect:** they all hide again (browsing doesn't pin them) _(both)_
- [ ] **Do:** on the Board, drag a card into the Done column while its done cards are hidden, then show them → **Expect:** the card sits after the earlier done cards; nothing reorders unexpectedly in the List _(both)_
- [ ] **Do:** complete a parent task whose subtasks are still open → **Expect:** the parent stays listed (dimmed) so its open subtasks stay reachable _(both)_
- [ ] **Do:** as a view-only member, open a bucket → **Expect:** no queue toggles; queued/claimed marks still show; dates can't be edited _(both)_
- [ ] **Do:** have a teammate complete a task you're looking at → **Expect:** it stays in place, struck through, until you change scope _(both, needs TV-D5 live updates)_

## Known gaps / not-yet-testable
- Visual baselines for `tests/visual/tasks-list.spec.ts` and `tests/visual/tasks-board.spec.ts` are not captured (a human runs `bunx playwright test --project=visual … --update-snapshots`).
- 📎 counts arrive with AT-3; a 💬 count needs a per-task comment count (not loaded yet).
- "7 days" uses the task's last update as its completion time.
