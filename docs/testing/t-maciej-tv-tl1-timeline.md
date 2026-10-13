# Manual test checklist — TV-TL1 Timeline rebuild I

> Generated 2026-10-13 · branch `t/maciej/tv-tl1-timeline` (landed on `t/maciej/tasks-v3-build`) · **Live-verified:** on the local stack at 1440 × 900 (dark), signed in as `perf@moduo.local` in its "Timeline 2k" workspace (`bun scripts/perf/seed-timeline-2k.ts`): All at Quarter (area headers, project bars with their phases, an outlined project, ▸ expanding Acme into its sections and tasks); Roadmap at Month (sections as bands and an end-date diamond, points, hollow session points, late points muted, a done task's check, a repeat with ghost points); ↓/j moving the cursor and selecting into the panel, Esc clearing it; −/= and ⌘-scroll stepping the zoom; ⇧[ hiding the name column (titles beside their marks); dragging the column's edge to 480 px; the Display menu (Group by, Show done, Colour by, Show, Subtasks) and Due per week; a row's right-click menu and "Set due date…" → Tomorrow; the off-screen hints; the empty Inbox's sentence. `tests/tasks-timeline.spec.ts` and `tests/perf/tasks-timeline-2k.spec.ts` (120 frames scrolling a quarter both ways: median 16.7 ms, no frame over two) pass on the local stack.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Set up: `bun run local:up`, `bun run env:local`, `bun run dev:web`, sign in as the local seed account. For a full picture, also seed the Timeline's own workspace: `bun scripts/perf/seed-timeline-2k.ts` (sign in as `perf@moduo.local` / `localperf-10k`, pick "Timeline 2k" in the workspace menu). Switch a place to the Timeline with the layout switch in the toolbar (each place remembers its own).

## All: one row per project (67, AC9.1, AC9.4, AC4.3)
- [ ] **Do:** All → Timeline → **Expect:** it opens at Quarter with today about a quarter of the way across; projects with no area first (no header), then each area's name and its projects, in the sidebar's order; no Inbox; no task rows _(web / desktop)_
- [ ] **Do:** look at a project with a start and a target → **Expect:** one slim bar (a neutral fill, a 3 px cap in the project's colour on its left end), its dated phases as lighter segments named when the name fits, a thin progress line along the bottom; hover → "Oct 1 – Nov 7 · 5 of 12 done" _(both)_
- [ ] **Do:** a project with no dates but dated tasks → **Expect:** an outlined bar over its dated work; hover → "… · worked out from its work"; a project with nothing dated → no bar _(both)_
- [ ] **Do:** ▸ on a project → **Expect:** its sections ("Design · 2 of 5 · Oct 13–24", "Build · by Nov 7") and their tasks below it; ▾ folds it back; reload → still open (this device) _(both)_
- [ ] **Do:** a project On hold or Done → **Expect:** its row dimmed, never hidden _(both)_

## Inside a project (68, 68a, AC9.2, AC9.3, AC2.3)
- [ ] **Do:** open a project → Timeline → **Expect:** it opens at Month; the project row on top, then "No section" (if any), then each section followed by its tasks, in the List's order _(both)_
- [ ] **Do:** a section with a range → **Expect:** a faint band across its own row and behind its tasks _(both)_
- [ ] **Do:** a section with only an end date → **Expect:** a diamond on that day on the section's own row; hover → "Build ends Nov 7" _(both)_
- [ ] **Do:** a task with a due date → **Expect:** a 12 px point in the middle of that day; hover → "Due Wed, Oct 14" _(both)_
- [ ] **Do:** a task with only a work session → **Expect:** a hollow point on its next session; hover → "Next session …" _(both)_
- [ ] **Do:** an open task past its due date → **Expect:** its point where it was, in a darker muted tone (never red); hover → "… · late" _(both)_
- [ ] **Do:** finish a task → **Expect:** its row goes (Show done is Hidden); Display → Show done → All → it's back with the accent's check as its point and a muted title _(both)_
- [ ] **Do:** a repeating task → **Expect:** its current point with a small repeat mark; Display → Show → Repeats → ghost points on the coming occurrences _(both)_
- [ ] **Do:** a task whose point is off screen → **Expect:** "‹ Oct 2" or "Nov 30 ›" at that edge of its row; click it → the canvas scrolls there _(both)_

## The canvas (69, AC9.5)
- [ ] **Do:** look at the header → **Expect:** months on top (with the year when it isn't this one), days (Week, Month), week starts (Quarter) or months (Year) below; today's unit bold, the "Today" pill over today's 1 px line _(both)_
- [ ] **Do:** Settings → Time & region → week starts Monday, then Sunday → **Expect:** Quarter's weeks (and Due per week) start on that day _(both)_
- [ ] **Do:** Week and Month → **Expect:** a hairline per day, weekends faintly tinted, a stronger line where a month starts _(both)_
- [ ] **Do:** Week · Month · Quarter · Year on the Timeline's bar; then − and = ; then ⌘-scroll (or pinch) over the canvas → **Expect:** each steps the zoom; the day under the pointer (or the middle) stays in place _(both)_
- [ ] **Do:** "Today" (or `t`) → **Expect:** the canvas glides back to today a quarter across _(both)_
- [ ] **Do:** scroll far left or right (a year or two) → **Expect:** the canvas keeps going (it grows as you reach an edge) and never jumps _(both)_
- [ ] **Do:** drag the name column's right edge → **Expect:** it resizes between 200 and 480 px; reload → it stays (this device) _(both)_
- [ ] **Do:** ⇧[ → **Expect:** the name column folds away; titles sit to the right of their points and bars, headers' names at the left edge; ⇧[ again brings it back _(both)_
- [ ] **Do:** scroll down a long project → **Expect:** the section you're in sticks under the time header; nothing anywhere is rotated _(both)_

## Display (71)
- [ ] **Do:** Display in a project → **Expect:** Layout · Group by (Section · Assignee · None) · Show done (Hidden · 7 days · All) · Colour by (None · Status) · Show (No date · Sessions · Repeats · Due per week) · Subtasks (Hidden · Nested); at All, Group by is Area · None and Colour by adds Project _(both)_
- [ ] **Do:** Colour by → Project (All, a project expanded) / Status → **Expect:** points take the project's hue / In progress brightest, To do grey, Backlog quietest _(both)_
- [ ] **Do:** Show → Sessions → **Expect:** small hollow ticks on a task's other session days _(both)_
- [ ] **Do:** Subtasks → Nested → **Expect:** dated subtasks under their parent, indented _(both)_
- [ ] **Do:** Show → Due per week → **Expect:** a third header row, "Due per week" in the corner, a quiet count per week, the busiest one a step brighter _(both)_
- [ ] **Do:** answer the role question as a student (a fresh account, TV-U17) → **Expect:** Due per week on by default in every Timeline that remembers no Display of its own _(both)_

## No date (70, interim until TV-TL2)
- [ ] **Do:** a project with undated tasks → **Expect:** "No date · n" on the Timeline's bar; click it → those tasks appear as rows (no mark) in their sections; click again → gone _(both)_
- [ ] **Do:** a place with nothing dated → **Expect:** the rows stay listed, with today's line and "Nothing has a date yet. Set a due date on a task, or open No date."; an empty place says "No tasks here yet." _(both)_

## Keys and the menu (70, keymap "Timeline")
- [ ] **Do:** click the canvas, then ↓/↑ (or j/k) → **Expect:** the cursor walks projects, sections and tasks; on a task its details open in the panel; on a project or section nothing is selected _(both)_
- [ ] **Do:** ← / → on a project (All) or a section → **Expect:** it folds / unfolds _(both)_
- [ ] **Do:** ⏎ on a task → **Expect:** the full page; Esc back. ⏎ on a project at All → that project's own Timeline _(both)_
- [ ] **Do:** Space on a task → **Expect:** it's done (and leaves, Show done Hidden) _(both)_
- [ ] **Do:** Esc → **Expect:** nothing selected, the panel's empty state _(both)_
- [ ] **Do:** right-click a task's row → **Expect:** the same menu as a List row; Rename edits the title in place; Status… / Set due date… / Schedule… / Move to project… open at the end of the row's name _(both)_
- [ ] **Do:** an archived project's Timeline → **Expect:** right-click offers Open · Copy link · Copy as text only _(both)_

## Filter and search
- [ ] **Do:** search at All → **Expect:** only the projects with a match; expand one → only matching tasks, only the sections that hold them; the bar and progress line stay the project's whole _(both)_

## Migrations / data
- [ ] No migration in this block. The Timeline's zoom moved from one value per workspace into each place's Display: everyone's Timeline reopens at the place's default zoom once.

## Verify before release
- Visual baselines for the new stories (`all-projects`, `due-per-week`, `inside-a-project`, `empty`, `read-only`) in `tests/visual/tasks-timeline.spec.ts` are a human capture: `bun run storybook`, then `bunx playwright test --project=visual tests/visual/tasks-timeline.spec.ts --update-snapshots`.
- ⌘-scroll and pinch zoom on a real trackpad, and in the signed desktop build's webview (Tauri has no zoom menu; bare −/= are the keyboard's).
- Scrolling 2,000 dated tasks on a real machine and in Safari / the desktop webview (the perf spec runs headless Chrome).
- Light theme (not tuned: out of scope).

## Polish later
- (filled in after the validator's round)
