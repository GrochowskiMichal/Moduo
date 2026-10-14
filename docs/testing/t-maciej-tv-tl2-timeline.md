# Manual test checklist — TV-TL2 Timeline interactions

> Generated 2026-10-13 · branch `t/maciej/tv-tl2-timeline` (landed on `t/maciej/tasks-v3-build`) · **Live-verified:** on the local stack at 1440 × 900 (dark), signed in as `dev@moduo.local`, through `tests/tasks-timeline.spec.ts` "drag, create, keyboard, dependencies" driving the real app (screenshots checked along the way): a point dragged two days with its date beside it, Undo; ⌥→, ⌥⇧→ and back; the selected task's line running backwards to a blocker due after it, the late-tone mark and "Move to …"; a blocker dragged a day and "Also move the one that waits on this"; a diamond, a band and the project bar's end dragged (⇧T fitting each first, the bar zooming out to Quarter); the ghost "Ends Thu, Oct 15" on an undated section's row and a click dating it; "No date · 1" opening the panel's No date view and its task dragged onto today. Both Timeline specs pass on the local stack.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Set up: `bun run local:up`, `bun run env:local`, `bun run dev:web`, sign in as the local seed account. Make a project with a start and a target, two sections (one with a range, one with only an end date), a section with no dates, a few dated tasks, one task with no date, one task with only a work session (schedule it), and a repeating task. In one task's panel, add "Blocked by" another task that's due after it. Switch the project to the Timeline.

## Drag a point (70, AC9.6)
- [ ] **Do:** drag a task's point two days right → **Expect:** it follows the pointer day by day with "Sat, Oct 18" beside it; let go → it stays there, "Moved to Sat · Undo" _(web / desktop)_
- [ ] **Do:** Undo → **Expect:** back on its old day _(both)_
- [ ] **Do:** drag a point up or down while moving → **Expect:** it stays on its own row: nothing moves to another section, project or person _(both)_
- [ ] **Do:** press a point and let go without moving → **Expect:** a plain click: the task opens in the panel, its date unchanged _(both)_
- [ ] **Do:** drag a hollow point (a task with only a work session) a day → **Expect:** the session moves to the next day at the same time (the Calendar shows it there); Undo puts it back _(both)_
- [ ] **Do:** drag a repeating task's point → **Expect:** "It repeats. Move just this one… or change the pattern"; "Just this one" moves this occurrence only; "Change the pattern" moves the pattern's weekday; Cancel leaves it _(both)_
- [ ] **Do:** drag a point to the right edge and hold → **Expect:** the canvas scrolls by itself, faster near the edge; the date beside the point keeps counting _(both)_
- [ ] **Do:** mid-drag, press Esc → **Expect:** the point goes back, nothing saved _(both)_

## Several at once (TV-U12's selection, 70)
- [ ] **Do:** click a task row, ⇧-click another (or ⇧↓), or ⌘-click a few → **Expect:** they're all tinted; the bottom bar shows the selection's actions _(both)_
- [ ] **Do:** drag one selected point three days → **Expect:** every selected point moves with it; one toast "Moved 3 tasks 3 days later · Undo"; Undo puts all of them back _(both)_
- [ ] **Do:** ⌥→ with the selection → **Expect:** they all move a day; ⌘A selects every task row; Esc clears the selection, then the cursor _(both)_

## Sections and projects (68a, 70)
- [ ] **Do:** drag a section's diamond a day left → **Expect:** "Build ends Nov 6" while dragging; it stays; toast with Undo _(both)_
- [ ] **Do:** drag a section's band (on the section's own row) → **Expect:** the band moves, and the bands behind its tasks move with it; the section's dates in the List header follow _(both)_
- [ ] **Do:** grab a band's left or right end → **Expect:** a resize cursor; drag → only that end moves; it never passes the other end _(both)_
- [ ] **Do:** drag a project's bar, then one of its ends → **Expect:** the bar moves / resizes ("Rebrand · Oct 4 – Nov 13 · Undo"); its phases stay on their own dates _(both)_
- [ ] **Do:** drag an outlined bar (a project with no dates of its own) → **Expect:** it becomes solid: the project now has a start and a target _(both)_
- [ ] **Do:** at All, drag a project's bar → **Expect:** the same, without opening the project _(both)_

## Click a day on a row (70, 71, AC9.6)
- [ ] **Do:** hover the empty track of a section with no dates → **Expect:** a dashed diamond under the pointer, "Ends Thu, Oct 15"; click → it's that section's end date _(both)_
- [ ] **Do:** drag along that row instead → **Expect:** a dashed band follows; let go → the section runs from–to _(both)_
- [ ] **Do:** at All, hover a project with nothing dated → **Expect:** a dashed bar as long as the zoom suggests (Week 7 days, Month 14, Quarter 30, Year 90); click → the project gets those dates _(both)_
- [ ] **Do:** Display → Show → No date, hover an undated task's row → **Expect:** "Set due · Fri, Oct 17" with a dashed point; click → due that day _(both)_
- [ ] **Do:** a project with nothing dated → **Expect:** "Nothing has a date yet. Click a day on a row, or open No date." _(both)_

## Keys (keymap "Timeline", AC9.6)
- [ ] **Do:** select a task, ⌥→ / ⌥← → **Expect:** a day later / earlier, each with Undo; ⌥⇧→ / ⌥⇧← a week _(both)_
- [ ] **Do:** put the cursor on a section or the project row, ⌥→ → **Expect:** its dates move a day _(both)_
- [ ] **Do:** `d` on a task → **Expect:** the due date picker at the row; ⇧D → its due date is cleared (Undo) _(both)_
- [ ] **Do:** ⇧T on a task far off screen → **Expect:** the canvas glides to it (same zoom); on a long bar → it zooms out until the bar fits _(both)_
- [ ] **Do:** ⌘A (desktop app too) → **Expect:** every task row selected, not the page's text _(desktop: see Verify before release)_

## Dependencies (70, 68b, AC9.7)
- [ ] **Do:** select a task that waits on another → **Expect:** a thin line from the blocker's point into it; hover another task → its lines too; nothing else draws lines _(both)_
- [ ] **Do:** Display → Dependencies → All → **Expect:** every line on screen; Off → none, and no marks _(both)_
- [ ] **Do:** a task due before what it waits on → **Expect:** its line runs backwards, dashed, in the muted late tone (never red); a small mark left of its point; hover → "Waits on “Export logo files”, due Nov 7, after this" _(both)_
- [ ] **Do:** click that mark → **Expect:** "Move to Nov 8"; click → the task is due Nov 8, the mark and the backwards line go _(both)_
- [ ] **Do:** select a task whose blocker has no date, or is in another project, or is filtered out → **Expect:** a quiet stub beside its point: "Fix nav · no date" / "↗ Website · Fix nav" / "↗ Fix nav" _(both)_
- [ ] **Do:** drag a blocker later → **Expect:** the toast offers "Also move the one that waits on this"; click → the waiting task moves by the same days; that toast's Undo puts both back; without the click nothing else moves _(both)_
- [ ] **Do:** as someone who can't see a blocker (a private task in a project they're not in) → **Expect:** no line, no stub, no mark for it _(both)_

## No date (70, 72, AC9.8)
- [ ] **Do:** "No date · n" on the Timeline's bar → **Expect:** the right panel opens (if closed) on **No date**: the place's tasks with no date, by project, a search field, "Drag a task onto a day." _(both)_
- [ ] **Do:** drag a task from there onto a day on the canvas → **Expect:** the preview says "Due Fri, Oct 17" while over the canvas; let go → it's due that day, its point appears, it leaves the list; Undo _(both)_
- [ ] **Do:** click a task in the list, or Tab to it and press Enter → **Expect:** its details open (the panel switches to Details); Enter or Space never lifts it _(both)_
- [ ] **Do:** the panel's view menu ("No date ▾") elsewhere (List, Board) → **Expect:** No date isn't offered there _(both)_
- [ ] **Do:** a place where everything has a date → **Expect:** the button is gone; the view says "Everything here has a date" _(both)_

## Who can drag
- [ ] **Do:** as a workspace member without Tasks edit → **Expect:** no grab cursors, no resize ends, no ghosts, ⌥←/→ does nothing; the No date list can't be dragged _(both)_
- [ ] **Do:** inside a project shared with you view-only → **Expect:** the same: nothing offers a drag _(both)_
- [ ] **Do:** an archived project's Timeline → **Expect:** read-only, no handles _(both)_

## Verify before release
- [ ] ⌘A and ⌘Z under the Tauri Edit menu (TV-U12's open question): the webview must still get ⌘A for the Timeline's select-all.
- [ ] ⌥←/→ on a desktop build: macOS turns ⌥-arrows into word jumps only in fields; the canvas should still get them.
- [ ] Edge auto-scroll uses animation frames: check it on a desktop build with the window in the background (WebKit throttles hidden windows).

## Polish later
- The late-tone contradiction mark and the backwards line are very quiet in dark mode; consider one step stronger (design call, still never red).
- At All, drags use the workspace's Edit only: a project shared with you view-only still shows handles there and the save is refused with "Couldn't save the project." (inside the project it's checked). Asking per project needs a batched access read.
- A dependency stub doesn't follow its point while that point is dragged (it jumps on drop).
- Letting a No date task go over the name column does nothing (its preview shows no day there); the droppable could be the track alone.
- The contradiction mark and its "Move to …" aren't reachable from the keyboard (the mark has `tabIndex={-1}`).
- Cancelling the repeat question that "Also move" raised leaves the first move without an Undo (its toast closed when the link was used).
- Not covered by an automated test yet (the checklist above walks them): a selection's drag, click-to-date on a task or project row, the edge scroll's animation loop, Esc cancelling a drag, Undo of section and project dates, d / ⇧D / ⌘A in the app, and a read-only person's canvas.
- The dependency lines draw only between rows on screen; a blocker scrolled out of the drawn rows shows no line until it's drawn (by design for 2,000 tasks, research §"Performance").
- The No date view has no keyboard way to place a task (drag only; ⏎ opens it, then `d` in the canvas or the panel's Due).
- Visual baselines for the new marks (ghost, drag label, lines) aren't captured.
