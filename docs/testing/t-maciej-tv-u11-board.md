# Manual test checklist — TV-U11 Board v3

> Generated 2026-10-13 · branch `t/maciej/tv-u11-board` (landed on `t/maciej/tasks-v3-build`) · **Live-verified:** partial — on the local stack at 1400 × 860: a new project's board with the folded Backlog button, To do · In progress · Done and "+ Add status"; a column's "+" opening the capture with an "In progress" chip and the task landing at the top; "In review" added from "+ Add status" and showing next to In progress; ⌥⇧→ moving a card To do → In progress → In review ("Moved to In review"), and Undo putting it back to In progress; unfolding and re-folding Backlog from its ⋯; Display → Rows Detailed (the handle) and Description; Group by Section with "+ Add section" and ⌥⇧→ into "Week 1"; lanes by priority; the card's right-click menu and "Set due date…" (the card then says "Tomorrow"); All's board by category with project names on cards and "Pick a project first"; ↓ and → walking the cards. The 10k perf gate (5/5) and the dnd, toolbar and capture e2e (13/13) passed on the local stack.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Set up: `bun run local:up`, `bun run env:local`, `bun run dev:web`, sign in as the local seed account. Make a project with a few tasks (one In progress, one done, one in Backlog, one with a due date), then switch it to Board (the layout switch in the toolbar).

## Columns by status (53a, 53b, 86)
- [ ] **Do:** open the project's Board → **Expect:** a small Backlog button first (dotted circle · count · chevron, no text), then To do · In progress · Done, each header with its icon, name, count and a "+"; "+ Add status" at the end _(web / desktop)_
- [ ] **Do:** hover the Backlog button → **Expect:** "Backlog · n"; click → it opens into a column; its ⋯ → Fold → back to the button; reload → it stays as you left it (this device) _(both)_
- [ ] **Do:** "+ Add status" → add "In review" under In progress → **Expect:** an "In review" column with the half-filled icon, right after In progress _(both)_
- [ ] **Do:** a status's ⋯ → **Expect:** Fold and "Edit statuses…" (the project's Statuses) _(both)_
- [ ] **Do:** click "+" on In review → **Expect:** the capture shows an "In review" chip; the new task lands at the top of In review. Change the destination to another project before saving → it lands in that project's In progress _(both)_
- [ ] **Do:** Done's header → **Expect:** no "+" (a new task is never finished) _(both)_
- [ ] **Do:** Filter → Status is Won't do → **Expect:** only the Won't do column (folded button until you open it) _(both)_
- [ ] **Do:** make a project with sections; open its Board → **Expect:** still by status, never by section (86) _(both)_

## Cards
- [ ] **Do:** look at a card → **Expect:** the status icon, the title (wraps), one quiet meta line (priority, one date, counts, the avatar); every card the same width, narrower at Compact and Dense density _(both)_
- [ ] **Do:** click a card's icon → **Expect:** it finishes (check, faded title); click again → back to To do _(both)_
- [ ] **Do:** hover a card → **Expect:** the Focus mark appears; nothing else _(web)_
- [ ] **Do:** right-click a card → **Expect:** the same menu as a List row (Rename, Mark done, Status…, Focus on this, Add to Focus, Schedule…, Set due date…, Move to project…, Assign, Priority, Energy, Copy link, Delete); "Set due date…" opens the picker at the card _(both)_
- [ ] **Do:** Display → Rows → Detailed → **Expect:** `MOD-12` above each title; a second line with tag names, time and "Waiting on …" where set; grouped by anything but status, each card names its status _(both)_
- [ ] **Do:** Display → Description → Preview → **Expect:** two lines of each description under the title (no tags, no reference titles) _(both)_
- [ ] **Do:** route a task to a team with nobody assigned → **Expect:** the team's mark where the avatar would be ("For Design · not taken yet") _(both)_

## Group by (call 22)
- [ ] **Do:** Display → Group by → Section → **Expect:** "No section" first, then the sections; "+ Add section" at the end; a section's ⋯ has Fold, Rename…, Delete section _(both)_
- [ ] **Do:** drag a card into another section → **Expect:** "Moved to <section>" with Undo; its status doesn't change _(web)_
- [ ] **Do:** Group by Assignee → **Expect:** a column per person with tasks, Unassigned last, "n hidden · Show" for people with none; dropping on a person assigns ("Assigned to Sam") _(both)_
- [ ] **Do:** Group by Priority → **Expect:** High · Medium · Low · Unset, all four even when empty _(both)_
- [ ] **Do:** in All, Group by Project, then Area → **Expect:** a column per project (empty ones hidden), then per area; cards can't be dropped into an area _(both)_

## Lanes (call 85)
- [ ] **Do:** Display → Lanes → Assignee → **Expect:** the column headers on top, a lane per person (empty ones hidden), each lane with a header that folds; the board scrolls as one _(both)_
- [ ] **Do:** drag a card to another lane in the same column → **Expect:** "Assigned to …" with Undo; to another lane and column → both change, one Undo _(web)_
- [ ] **Do:** a lane cell with more than 20 cards → **Expect:** "+ n more", then "Show fewer" _(both)_

## Boards across projects
- [ ] **Do:** All → Board → **Expect:** To do · In progress · Done (Backlog and Won't do only when they have tasks, folded); each card names its project; a card in "In review" says so under In progress _(both)_
- [ ] **Do:** a column's "+" in All → **Expect:** dimmed, "Pick a project first" _(both)_
- [ ] **Do:** two projects that both use Todo · In progress · In review · Done → **Expect:** All's board shows those four names as columns; dropping in In review sets each task's own project's In review _(both)_

## Keys
- [ ] **Do:** click a card, then ↓ ↑ ← → → **Expect:** the selection walks the column and jumps to the nearest card of the next column with cards; a column off screen scrolls into view _(both)_
- [ ] **Do:** ⌥⇧→ on a selected card → **Expect:** it moves to the next column that takes it, with Undo; ⌥⇧↑/↓ reorder it in a project under Manual order; sorted, the toast offers "Back to manual order" _(both)_
- [ ] **Do:** ⏎ → **Expect:** the full page; Esc back. `e` → edits the title on the card; Space finishes; ⇧S opens the status menu at the icon _(both)_
- [ ] **Do:** `c` with a card selected in In review → **Expect:** the capture with "In review" _(both)_

## States
- [ ] **Do:** filter the board to nothing → **Expect:** "No tasks match · Clear filters" _(both)_
- [ ] **Do:** open an archived project's board → **Expect:** no "+", no drag; right-click offers Open · Copy link · Copy as text _(both)_
- [ ] **Do:** the 10k fixture (`bun run perf:seed`, `perf@moduo.local`), All → Board → **Expect:** quick; a To do column of 1,200 cards scrolls smoothly and draws only a screenful _(web)_

## Migrations / data
- [ ] No migration in this block.

## Verify before release
- Visual baselines for the new stories (`project-statuses`, `by-section`, `lanes-by-assignee`, `detailed-with-description`) in `tests/visual/tasks-board.spec.ts` are a human capture: `bun run storybook`, then `bunx playwright test --project=visual tests/visual/tasks-board.spec.ts --update-snapshots`.
- Drag-and-drop between lanes and into a section on a real trackpad (the e2e covers a status drop only).
- The fixed card widths at the three densities in the signed desktop build.
