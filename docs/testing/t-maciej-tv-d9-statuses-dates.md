# Manual test checklist — TV-D9 statuses, completion, dates

> Generated 2026-10-10 · branch `t/maciej/tv-d9-statuses-dates` → `t/maciej/tasks-v3-build` (local build mode) · **Live-verified:** yes, on the local stack (web, `dev:web` on :8093, signed in as `dev@moduo.local`): project ⋯ → Statuses… (rename To do → Todo, add "In review" in In progress, delete it with its task moved and the toast), the panel's picker by project name (In review, half-filled icon), Backlog (the sidebar, All and My tasks counts drop, the Board's Backlog column appears, the task leaves the queue), queuing a backlog task (back to To do and queued), assigning a backlog task (the "still in Backlog" offer), Inbox ⋯ → Default statuses…, "+ Add status" at the end of a project's board (opens with an In progress field), trail lines naming the status. Not live-verified: the rows marked below.
> Migrations: `20261010170000_project_statuses.sql`, then `20261010171000_tasks_completion_due_on.sql` (local only; both define `tasks__status_sync`, so always apply both, in order). SQL tests: `bun run db:test` (`statuses.test.sql` 57, `dates.test.sql` 36).

## Statuses in a project (AC3.2, AC7.1)
- [ ] **Do:** a project's ⋯ → Statuses… → **Expect:** five groups (Backlog, To do, In progress, Done, Won't do), each with one line on what it means; rows show the category icon, the name, Hide, Up, Down, Delete; nothing is focused for typing when it opens _(both)_
- [ ] **Do:** rename To do to "Todo" (Enter or click away) → **Expect:** saved; the panel's Status reads "Todo"; Esc before saving discards the change _(both; Esc not live-verified)_
- [ ] **Do:** In progress → Add status → "In review" → **Expect:** listed under In progress with the half-filled icon; picking it in a task's Status picker shows "In review" _(both)_
- [ ] **Do:** add a status named "Done" under In progress → **Expect:** refused: "“Done” is the name of a category…" _(both)_
- [ ] **Do:** hide To do and Won't do in a project → **Expect:** "Hidden" beside them; still listed; a task set to "todo" (checkbox reopen) lands on a visible To do if any, else the hidden one _(both; not live-verified)_
- [ ] **Do:** move a status up/down inside its category → **Expect:** the order changes in the picker; the arrows stop at the ends _(both; not live-verified)_
- [ ] **Do:** delete a status that has tasks → **Expect:** toast "Deleted “In review” · 1 task moved to In progress"; the task now reads In progress _(both)_
- [ ] **Do:** try to delete the only status of a category → **Expect:** its Delete button is disabled ("A category always keeps one status") _(both)_
- [ ] **Do:** as a viewer, open a project's ⋯ → **Expect:** no Statuses… item _(both; not live-verified)_

## Workspace default statuses (#28)
- [ ] **Do:** as the owner, Inbox ⋯ → Default statuses… → **Expect:** "Default statuses" with "New projects start with these, and the Inbox uses them." _(both)_
- [ ] **Do:** add a default status, then create a new project → **Expect:** the new project has it; existing projects don't _(both; not live-verified in the UI, SQL-tested)_
- [ ] **Do:** as a member who isn't an admin, open the Inbox ⋯ → **Expect:** no "Default statuses…" _(both; not live-verified)_

## Board
- [ ] **Do:** a project's Board grouped by status, scroll to the end → **Expect:** "+ Add status"; clicking it opens that project's Statuses with an In progress field ready _(both)_
- [ ] **Do:** All or My tasks on the Board → **Expect:** no "+ Add status" _(both; not live-verified)_
- [ ] **Do:** move a task to Backlog → **Expect:** a Backlog column first, holding it; with no backlog tasks there's no Backlog column _(both)_
- [ ] **Do:** drag a card from "In review" to Done, then Undo → **Expect:** it goes back to "In review" (not the first In progress status) _(both; not live-verified)_

## Backlog (AC4.2, REPLAN 53)
- [ ] **Do:** set a task to Backlog → **Expect:** the dotted icon; the project's rail count, All and My tasks counts drop by one; it leaves My tasks and your queue _(both)_
- [ ] **Do:** queue a backlog task (panel "Queue") → **Expect:** it moves to the first To do status and is queued; the trail says so _(both)_
- [ ] **Do:** give a backlog task a scheduled time → **Expect:** it moves to To do; the trail: "scheduled this, so it moved to To do" _(both; not live-verified)_
- [ ] **Do:** assign a backlog task to someone, or give it a due date → **Expect:** toast "<title> is still in Backlog" with "Move to To do"; it stays in Backlog unless you click it _(both)_
- [ ] **Do:** Filter → Status → Backlog in My tasks → **Expect:** your backlog tasks show (they're hidden from My tasks otherwise) _(both; not live-verified)_
- [ ] **Do:** List grouped by Status in a project with a backlog task → **Expect:** a "Backlog" group last _(both; not live-verified)_
- [ ] **Do:** Display → Rows → Detailed → **Expect:** the status cell shows the category icon and the project's own name ("In review") _(both; not live-verified)_
- [ ] **Do:** Calendar → the right panel's Tasks view → **Expect:** a backlog task with a due date this week is under Backlog, never Due soon _(both; not live-verified)_

## Completion and dates (AC12.5, AC12.7)
- [ ] **Do:** check a task off, reopen it → **Expect:** completed when/by appear and clear (the "Completed · 7 days" display counts from when it was finished) _(both; not live-verified in the UI, SQL-tested)_
- [ ] **Do:** set a due date as a user in one zone, read it as a user in another (two browsers with different system zones) → **Expect:** the same calendar date for both _(both; SQL-tested)_
- [ ] **Do:** through MCP, `tasks_update` with `due_date: "2026-11-08"` → **Expect:** due on Nov 8 for everyone; results show `due_on` and `status_category` _(MCP)_

## Old builds (AC12.6)
- [ ] **Do:** with a build from before TV-D9, open a project that has a backlog task and a Won't do task → **Expect:** the backlog task shows as To do, the Won't do one as archived/Won't do; nothing disappears; saving the backlog task (rename) keeps it in Backlog for new builds _(desktop; verify before release)_
- [ ] **Do:** with that old build, mark a task done, then reopen it → **Expect:** new builds show Done (the project's first Done status), then the first To do _(desktop; verify before release)_

## Migrations / data
- [ ] **Do:** on the release train, apply `20261010170000` then `20261010171000` → **Expect:** every task has a `status_id` and `status_category`; every workspace has five default statuses and every project its own copy; dated tasks have `due_on` and their `due_date` is noon UTC of it; done tasks have `completed_at` (from their completion, the trail, or their last edit); no task's `updated_at` changed _(prod)_
- [ ] **Do:** check `select tablename from pg_publication_tables where pubname = 'supabase_realtime'` → **Expect:** `project_statuses` is listed _(prod)_
- [ ] **Do:** `GET /rest/v1/tasks?select=id,late:tasks_late&limit=1` with a user's token → **Expect:** a `late` value (the computed field) _(prod)_

## Known gaps / not-yet-testable
- Verify before release: old desktop builds at UTC+12 to +14 read the noon-UTC mirror of a due date as the next day (until TV-D7 removes `due_date`).
- Verify before release: an old desktop build against both migrations (the rows above under Old builds).
- MCP `tasks_set_status` still takes only the four old values (the op itself takes names and category words): TV-D16.
- The folded Backlog button, per-project status columns and lanes: TV-U11. The due-time picker: TV-U13. A Settings → Tasks section for the default statuses: the Settings rebuild.
- Statuses don't update live in another open app until it reloads (nothing listens to `project_statuses` yet): TV-D11a.
