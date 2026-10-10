# Manual test checklist — TV-U4 (Tasks v3 block 7: drag and drop)

> Generated 2026-10-10 · branch `t/maciej/tv-u4-dnd` (landed locally on `t/maciej/tasks-v3-build`) · **Live-verified:** yes, on the web build against the local stack (Chrome, 1440 × 900, dark): the e2e `tests/tasks-dnd.spec.ts` (6) drags List rows, sidebar rows and a Board card with a real mouse and passes, with `tests/trust-pass.spec.ts` (12) and `tests/tasks-toolbar.spec.ts` (4); screenshots checked for the insertion line, the "Make subtask" preview, the sorted line under the toolbar, the sorted note during a drag and the "Sorted by due date · Back to manual order" toast. Not tried: the desktop app.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Manual order inside one project
- [ ] **Do:** open a project (Order by: Manual) and drag a task above another, keeping the pointer at the row's left → **Expect:** an accent line between the rows while dragging, the preview beside the pointer (never over the row you point at); on release the task moves and a toast says "Moved" with Undo. _(both)_
- [ ] **Do:** click Undo → **Expect:** the task goes back to where it was. _(both)_
- [ ] **Do:** drag a task onto the right part of another row → **Expect:** that row lights up and a dashed "Make subtask" preview shows under it; on release it's a subtask ("Moved under “…”", Undo). _(both)_
- [ ] **Do:** drag a task that has subtasks by its middle → **Expect:** it reorders (a parent can't become a subtask, so the right part never nests it). _(both)_
- [ ] **Do:** Display → Order by → Due date → **Expect:** under the toolbar: "Sorted by due date · Back to manual order". _(both)_
- [ ] **Do:** drag a task up while sorted → **Expect:** a quiet "Sorted by due date" note instead of the line; on release nothing moves and a toast asks "Sorted by due date · Back to manual order". Click it → **Expect:** the list is back in its manual order, exactly as before the sort. _(both)_
- [ ] **Do:** Board in a project, Order by Due date, drag a card within its column → **Expect:** cards don't part; on release the same toast asks to switch back. _(both)_

## Views across projects
- [ ] **Do:** All grouped by Status, drag a To do task onto another To do row → **Expect:** no line, nothing happens. _(both)_
- [ ] **Do:** drag it onto an In progress row or the In progress header → **Expect:** the In progress header lights up; on release "Moved to In progress" with Undo; the task keeps its place in its project's order. _(both)_
- [ ] **Do:** All grouped by Project, drag a task into another project's group → **Expect:** "Moved to <project>"; open that project → the task is at the end; its subtasks came along. _(both)_
- [ ] **Do:** All grouped by Assignee (two members) → drag a task into a teammate's group → **Expect:** "Assigned to <name>" with Undo; a former member's group doesn't light up. _(both)_
- [ ] **Do:** drag a task into the Won't do group (Filter → Status → Won't do and To do) → **Expect:** it's marked Won't do with Undo. _(both)_

## The sidebar
- [ ] **Do:** drag a project task onto the Inbox row → **Expect:** the row doesn't light up; nothing happens on release. _(both)_
- [ ] **Do:** drag a task with subtasks (one of them Won't do) onto another project's row → **Expect:** the row lights up; "Moved to <project>" with Undo; all its subtasks moved with it; Undo brings them all back. _(both)_
- [ ] **Do:** drag a subtask alone onto another project's row → **Expect:** it moves there as a top-level task. _(both)_
- [ ] **Do:** drag a task onto Queue → **Expect:** "Added to your queue" with Undo; Undo takes it out again. A blocked task opens the "blocked by" offer instead. _(both)_
- [ ] **Do:** drag a teammate's task onto My tasks → **Expect:** "Assigned to you" with Undo. _(both)_

## Keys
- [ ] **Do:** select a task and press `>` → **Expect:** it becomes a subtask of the row above ("Moved under “…”", Undo). `<` → **Expect:** it comes out, right below its old parent. _(both)_
- [ ] **Do:** ⌥⇧↓ / ⌥⇧↑ → **Expect:** the task moves one place down / up ("Moved down" / "Moved up", Undo); in the Queue it moves in your line-up. _(both)_
- [ ] **Do:** ⌥⇧↑ in a sorted project → **Expect:** the "Sorted by due date · Back to manual order" toast. In All → **Expect:** "Tasks keep their order inside each project." _(both)_
- [ ] **Do:** ⌘[ and ⌘] → **Expect:** still the browser's Back and Forward (web). _(web)_

## Undo and failures
- [ ] **Do:** drag a task to In progress, then change its status from the panel to Done, then click the first toast's Undo → **Expect:** its place goes back but it stays Done, and a toast says "Undo kept a newer change to “…”". _(both)_
- [ ] **Do:** as a member who can't edit a task, drag it to another status → **Expect:** an error toast, the list goes back, no "Moved" toast. _(both)_
- [ ] **Do:** with VoiceOver on, drag a card on the Board → **Expect:** it reads the task's title and the column's name, never an id. _(desktop)_

## Migrations / data
- [ ] None. Drops use the existing ops (`tasks_op_set_status`, `tasks_op_assign`, the field update, the queue ops).

## Known gaps / not-yet-testable
- The Board's ⌥⇧←/→ and its Group by Assignee/Priority come with TV-U11 (the Board rebuild brings its keyboard cursor).
- A drop into Done finishes only the task; "finishing a parent finishes its open subtasks" on a drop goes with the status rework (TV-D7/TV-D9).
- A queued task dropped into Done or Won't do leaves every queue (the server's rule); Undo doesn't put it back in the queue.
- Above the List's very first row the insertion line is half clipped by the scroll box (the sorted note flips below it); the List rebuild on the kit Row (TV-U10) redraws rows.
- Verify before release: the same drags in the desktop app (Tauri webview, `dragDropEnabled: false`), and VoiceOver's announcements there.
