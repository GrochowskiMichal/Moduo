# Manual test checklist — TV-U10 List v3

> Generated 2026-10-13 · branch `t/maciej/tv-u10-list` (landed on `t/maciej/tasks-v3-build`) · **Live-verified:** partial — on the local stack at 1440 × 900: section grouping by default with "1 of 4 · ends Oct 24", the "+" opening the capture into "Project › Design" and the new task landing at the top of Design, "Backlog · 1" and "+ Add section", late fixes on hover, ⇧S's status menu at the icon, Detailed's columns and headers lined up (measured to the pixel) with "+3" when the right panel is open; the panel's subtasks reordered by drag and ⌥⇧↓ and ⏎ opening the full page (e2e on the local stack); the rest is covered by unit and e2e tests (detail, dnd 6/6, toolbar, trust-pass, offline, capture, sidebar, references, the 10k perf gate 5/5).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Set up: `bun run local:up`, `bun run env:local`, `bun run dev:web`, sign in as the local seed account. Make a project with a few tasks: one with a due date last week, one In progress, one done, one in Backlog.

## Rows (Standard)
- [ ] **Do:** open the project → **Expect:** each row starts with the status icon (empty circle, half-filled for In progress, dotted for Backlog); the title takes the free width; priority, date, avatar and the Focus mark sit at the right, lined up down the list _(web / desktop)_
- [ ] **Do:** click a To do task's icon → **Expect:** it's done (check icon, row fades, struck through); click it again → back to To do _(both)_
- [ ] **Do:** with Display → Completed: All, click a Won't do task's icon (crossed circle) → **Expect:** it reopens to To do (not Done) _(both)_
- [ ] **Do:** select a row, press ⇧S → **Expect:** the status menu opens at its icon, the project's statuses grouped by category; pick one and it changes _(both)_
- [ ] **Do:** right-click a row's icon → **Expect:** the status menu (not the row menu) _(both)_
- [ ] **Do:** select a row, press ⏎ → **Expect:** the task opens full in the centre; Esc brings the List back; `e` instead edits the title in place _(both)_
- [ ] **Do:** hover a row whose date cell is empty → **Expect:** a faint calendar glyph appears in the date column; clicking it opens the due date picker _(web)_
- [ ] **Do:** hover the late task (due last week) → **Expect:** "Move · Won't do · Break down" appear over the end of its title; the title isn't cut shorter when you're not hovering; Break down selects the task and opens the panel's "Add a subtask…" line _(web)_
- [ ] **Do:** hover any row → **Expect:** only the Focus mark, an empty date's glyph and a late row's fixes appear — no ⋯, grip or delete _(web)_

## Rows (Detailed)
- [ ] **Do:** Display → Rows → Detailed → **Expect:** `MOD-142` before each title (click copies it, a toast says so), then Project › Section, the status name, Due, Next session, time, the assignee's first name and Updated ("2d"), under headers _(both)_
- [ ] **Do:** look down a column → **Expect:** every value fits without "…" and lines up under its header label _(both)_
- [ ] **Do:** click the Due header, again, again → **Expect:** sorted by due (arrow up), then reversed (arrow down), then back to manual order; "Sorted by due date · Back to manual order" shows while sorted in a project _(both)_
- [ ] **Do:** open the right panel at a 1024–1440 px window → **Expect:** columns drop whole (Updated first, then time, Next session…), the header shows "+3" with a tooltip; the title keeps at least ~200 px _(desktop)_

## Groups
- [ ] **Do:** in a project with no sections → **Expect:** a plain list ending with "+ Add section"; add "Design" → **Expect:** "No section" and "Design" headers appear _(both)_
- [ ] **Do:** look at a section header → **Expect:** its name as typed, "1 of 4" (done of all) and "· ends <date>" when it has an end date; the "+" is always visible, ⋯ appears on hover with Rename… and Delete section _(both)_
- [ ] **Do:** click a section's "+" → **Expect:** the capture opens filed into "Project › Section"; the new task lands at the top of that section _(both)_
- [ ] **Do:** Group by Status, click "+" on In progress → **Expect:** the capture shows an "In progress" chip (× drops it) and the new task is created In progress; Done and Won't do have no "+" _(both)_
- [ ] **Do:** in All, Group by Status → **Expect:** each "+" is dimmed with "Pick a project first"; Group by Project → "+" files into that project _(both)_
- [ ] **Do:** drag a task from one section into another → **Expect:** it moves there, "Moved to <section>" with Undo _(web)_
- [ ] **Do:** fold a group, reload → **Expect:** it stays folded (this device) _(both)_
- [ ] **Do:** look at the end of a group with a Backlog task → **Expect:** "Backlog · 1 ›"; click → the Backlog task shows; Group by Status → Backlog is the last group, folded _(both)_
- [ ] **Do:** with three Backlog tasks, open the line and press j through it → **Expect:** each Backlog task in turn, none jumping above the line _(both)_
- [ ] **Do:** with a Backlog task selected, click "Backlog · n" to close it → **Expect:** it closes and stays closed; the selection moves to the row above the line _(both)_
- [ ] **Do:** delete a section from its ⋯ → **Expect:** its tasks move to No section; Undo brings the section back with its tasks in it _(both)_

## Subtasks
- [ ] **Do:** open a task with three subtasks, drag the last subtask in the panel above the first → **Expect:** it moves there, "Moved up" with Undo _(web)_
- [ ] **Do:** focus a subtask in the panel, press ⌥⇧↓ → **Expect:** it moves down one place and keeps the focus _(both)_
- [ ] **Do:** in a project sorted by due date (or My tasks), with subtasks shown nested, select a subtask and press ⌥⇧↑ → **Expect:** it moves up among its siblings (no "Sorted by …" refusal) _(both)_

## States
- [ ] **Do:** sign in fresh (or throttle the network) → **Expect:** nothing for a moment, then eight still placeholder rows (no shimmer), never "No tasks" _(web)_
- [ ] **Do:** filter a project to nothing → **Expect:** "No tasks match", "N hidden by the filter / 2 filters" and Clear filters _(both)_
- [ ] **Do:** open an archived project (sidebar ⋯ → Archived) → **Expect:** "View only" after the title, no New, icons don't respond (hovering one names the status), right-click offers Open · Copy link · Copy as text _(both)_
- [ ] **Do:** go offline (devtools → Offline), check off a task → **Expect:** a small clock on that row until you're back online; other edits say "Offline" _(web)_

## Menus
- [ ] **Do:** open a long menu (a row's `b` → Move to project in a workspace with many projects) → **Expect:** the last visible item fades out at the foot; scroll to the end → the fade goes _(both)_

## Edge cases
- [ ] **Do:** a 10,000-task workspace (`bun run perf:seed`, sign in as `perf@moduo.local`), switch to Detailed in All → **Expect:** it stays quick; edits redraw one row _(web)_
- [ ] **Do:** drag a parent task with subtasks onto another project in the sidebar → **Expect:** the subtasks you can edit follow it; the drop never fails because of one you can only view _(web)_

## Migrations / data
- [ ] No migration in this block.

## Known gaps / not-yet-testable
- Visual baselines for the new stories (`detailed-rows`, `by-section`, `late-row`, Detailed at three densities) in `tests/visual/tasks-list.spec.ts` are a human capture: `bun run storybook`, then `bunx playwright test --project=visual tests/visual/tasks-list.spec.ts --update-snapshots`.
- e2e `trust-pass.spec.ts` "a task in a project you can't see …" fails at the bell on the shared dev workspace (the teammate has 99+ notices, so this run's card isn't listed); not a List change. Run it on a fresh workspace before release.
- Verify before release: the header's scrollbar gutter on Windows (classic scrollbars) and in Safari/the desktop webview (no `scrollbar-gutter` support: overlay bars take no room on macOS, so it lines up); the menu fade (`mask-image`) in the signed desktop build's WebKit.
- Folds are per device; synced folds wait for TV-U8's preferences work.
