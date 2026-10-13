# Manual test checklist — TV-U12 Multi-select and the bottom-bar mode

> Generated 2026-10-13 · branch `t/maciej/tv-u12-multiselect` (landed on `t/maciej/tasks-v3-build`) · **Live-verified:** the main flow on the local stack (web): in Upcoming, click a row, ⌘-click another, ⇧-click a third (the range from the ⌘-clicked one), the bottom bar turns into Complete Space · Focus Q · Assign @ · Tag # · Date D · Delete ⌫ · More ▾ · "3 selected · Esc"; ⇧↓ grew it to four; Space → "Completed 4 tasks" with Undo, the four left Upcoming; Undo brought them back; ⌘A selected all 72; `@` and `#` opened "Assign 72 tasks to…" and "Tag 2 tasks"; Esc closed the picker and a second Esc cleared the selection (the bar's own tools came back); the right panel read "3 tasks", then "4 tasks" with Due · Project · Section "Mixed" after a ⌘-click across projects. The block's e2e `tests/tasks-bulk.spec.ts` passed on the local stack (four selected, the bar's row, the panel's Mixed priority, one change and one Undo for all four).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Set up: `bun run local:up`, `bun run env:local`, `bun run dev:web`, sign in as the local seed account. Make a project with five or six tasks (one with a due date, one repeating weekly with a due date, two with a priority), and a second project.

## Selecting (List)
- [ ] **Do:** click a row, then ⌘-click two more → **Expect:** three rows tinted; the bar shows the selection's row and "3 selected · Esc" _(web / desktop)_
- [ ] **Do:** ⌘-click one of them again → **Expect:** it leaves the selection; with one left, the bar's own tools (Search · Quick capture · New) come back _(both)_
- [ ] **Do:** click a row, ⇧-click a row four below → **Expect:** the five in between selected, in the order you see them (a folded group is skipped) _(both)_
- [ ] **Do:** ⇧↓ / ⇧↑ (and ⇧J / ⇧K) → **Expect:** the range grows and shrinks from where it started _(both)_
- [ ] **Do:** ⌘A in the list → **Expect:** every task the view shows is selected (not the page's text) _(both)_
- [ ] **Do:** Esc → **Expect:** back to the one row the cursor is on; a plain click or ↓ does the same _(both)_
- [ ] **Do:** select 30 rows with ⌘A in a long list, scroll far down and back → **Expect:** the rows scrolled away are still tinted _(both)_
- [ ] **Do:** change place in the sidebar or the layout (List → Board) → **Expect:** the selection is gone _(both)_

## The bottom bar's row (82b)
- [ ] **Do:** with four selected, read the bar → **Expect:** Complete Space · Focus Q · Assign @ · Tag # · Date D · Delete ⌫ · More ▾ · "4 selected · Esc"; More lists Move B · Status ⇧S · Section · Priority P · Waiting · Team _(both)_
- [ ] **Do:** Space → **Expect:** "Completed 4 tasks" with Undo; a parent's open subtasks finish too ("· also 2 subtasks"); Undo puts every one back (and back into Focus where they were) _(both)_
- [ ] **Do:** select four finished tasks (Display → Completed shown), Space → **Expect:** "Reopened 4 tasks" _(both)_
- [ ] **Do:** Q → **Expect:** "Added 4 tasks to Focus"; Q again → "Removed 4 tasks from Focus"; each with Undo _(both)_
- [ ] **Do:** `@` (or `a`) → pick a person → **Expect:** "Assigned 4 tasks to Sam"; `i` assigns them to you _(both)_
- [ ] **Do:** `#` (or `l`) → pick a tag → **Expect:** "Tagged 4 tasks “design”"; the tag shows ✓ in the picker when all have it; picking it again takes it off all four; typing a new word offers "Create tag “…”" _(both)_
- [ ] **Do:** D → A day later → **Expect:** each task's own date moves one day (a dateless one becomes tomorrow): "Moved 4 tasks a day later" _(both)_
- [ ] **Do:** D → Tomorrow with the repeating task among them → **Expect:** "Move 4 tasks to Tomorrow — Just these · Change the pattern"; Just these moves the repeat's one occurrence; Change the pattern moves its weekday _(both)_
- [ ] **Do:** ⌫ (or Delete, or ⌘⌫) → **Expect:** "Deleted 4 tasks" with Undo; Undo brings them back, subtasks under their parents again; with one row selected, bare ⌫ does nothing (⌘⌫ deletes it) _(both)_
- [ ] **Do:** More → Status with tasks of one project → **Expect:** the project's own statuses (In review…); across projects → the five categories _(both)_
- [ ] **Do:** More → Section across two projects → **Expect:** dimmed; in one project → its sections and No section _(both)_
- [ ] **Do:** More → Waiting → a person, or type "Legal sign-off" → **Expect:** "4 tasks waiting on …" with Undo; rows show Waiting on _(both)_
- [ ] **Do:** More → Team (with teams) / Priority / Move → **Expect:** each changes all four with one Undo _(both)_
- [ ] **Do:** after any picker closes, press Esc → **Expect:** the selection clears (the keys are back on the list) _(both)_

## The panel's "n tasks · Mixed" (82)
- [ ] **Do:** with four selected and the right panel open → **Expect:** "4 tasks", their titles with status icons, then Status · Assignee · Priority · Due · Project · Section · Tags · Team with a shared value, "Mixed" or "None"; "A change here applies to all 4. One Undo covers it." _(both)_
- [ ] **Do:** click Priority's "Mixed" → High → **Expect:** all four High, the panel reads High; Undo → back to what each had _(both)_

## A refused task (spec edge case)
- [ ] **Do:** as a teammate who can only view one project, select three of your tasks and one of that project's, D → Tomorrow → **Expect:** "3 of 4 changed" · "“…” is read-only to you."; Undo puts the three back _(both)_

## Right-click and drag
- [ ] **Do:** right-click one of the selected rows → **Expect:** "Complete 4 tasks · Focus · Assign… · Tag… · Date… · Move… · Status… · Section… · Priority… · Waiting on… · Team… · Delete 4 tasks"; right-click a row outside the selection → that task's own menu _(both)_
- [ ] **Do:** drag one of four selected rows into another group (Group by Priority) → **Expect:** all four change ("Set 4 tasks…"), one Undo; in a project's manual order, the other three land right after the one you held _(web)_
- [ ] **Do:** drag a selected row onto a project in the sidebar → **Expect:** "Moved 4 tasks to …"; onto Focus → added to Focus; onto My tasks → assigned to you _(web)_
- [ ] **Do:** drag a selected card on the Board to another column → **Expect:** "Moved to In progress · 4 tasks" with one Undo; the drag preview shows "+3" in the List _(web)_

## Board
- [ ] **Do:** click a card, ⇧-click / ⌘-click others; ⇧↓ / ⌘A / Esc → **Expect:** as in the List, in the board's order (column by column) _(both)_
- [ ] **Do:** Display → Group by → Waiting on → **Expect:** a column per person or thing waited on (people with their avatar), then "Not waiting"; a task waiting on two sits under the newest _(both)_
- [ ] **Do:** drag a card into a Waiting column → **Expect:** "1 task waiting on Anna" with Undo; the card moves there; "Not waiting" takes no drop _(web)_

## Inbox
- [ ] **Do:** in the Inbox, select one task → **Expect:** the triage row (Accept 1 · Decline 2 · Duplicate 3 · Snooze H); ⌘-click a second → the selection's row instead; Esc → triage again _(both)_
- [ ] **Do:** Group the Inbox by Priority, triage a task with 1 → **Expect:** the cursor moves to the next row as shown in its group _(both)_

## Read-only
- [ ] **Do:** as a viewer, select several → **Expect:** the bar shows only "n selected · Esc"; the panel's values are inert; no keys change anything _(both)_

## Migrations / data
- [ ] No migration in this block.

## Verify before release
- **⌘A and ⌘Z in the desktop app (spec item 22):** the Tauri Edit menu has Select All and Undo (`src-tauri/src/lib.rs`). On a signed desktop build, with the List focused, ⌘A must select every task (not the page's text) and ⌘Z must undo the last bulk change while its toast shows. If the menu takes ⌘A first, the List never sees it.
- A refused task in a real shared workspace (two accounts; the local check above needs a view-only teammate).
- Trackpad drags of a selection between lanes and into the sidebar.

## Polish later
- The bar's row is wider than an 800 px window: "4 selected · Esc" is cut off at the right edge (the app's minimum is 1024 px; fine there).
- The panel's header still says "Details ▾" over "4 tasks"; the prototype names the view "4 tasks" in the title row (needs a title override in the panel registry).
- The drag preview counts the others ("+3") in the List only; the Board's card preview doesn't.
- Triage keys on a selection (Accept and Snooze for several) aren't offered; the Inbox steps aside for the selection's row.
- Upcoming's day drop moves only the row you hold, not the selection (its Move all… covers many).
- Visual baselines for the bar's selection row and the panel's Mixed view (no stories yet).
