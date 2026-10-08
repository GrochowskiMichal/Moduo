# Manual test checklist — TV-D2 personal queue (data)

> Generated 2026-10-08 · branch `t/maciej/tv-d2-personal-queue` · **Live-verified:** partial. On production, a rolled-back probe as a workspace owner passed: add, add to top, reorder, move to end and remove; two add rows in the trail; the old commit and skip ops acting on the queue, with skip leaving the reschedule count alone; completing a task taking it out of every queue; reading your own rows; a direct insert refused. Grants, RLS and triggers were checked on production too. Locally, `supabase/probes/tasks-queue.probe.sql` passes all 13 checks. **No screen uses the new queue yet** (TV-D4), so most checks below go through the app's existing Queue (Execute) view, the MCP connector, or SQL.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The app today (still shows the old shared day list)
- [ ] **Do:** In Tasks, commit a task to the Queue (the toggle or `q`), then reload → **Expect:** it's in the Queue as before; in Supabase, `select * from task_queue where task_id = '<id>'` has one row with your user id _(web + desktop)_
- [ ] **Do:** In the Queue (Execute) view, press **Skip** on a task → **Expect:** it leaves the Queue; the task's reschedule count does **not** go up (before TV-D2 it did); its `task_queue` row is gone _(web + desktop)_
- [ ] **Do:** Uncommit a queued task → **Expect:** it leaves the Queue and its `task_queue` row is gone _(both)_
- [ ] **Do:** Drag to reorder the Queue in Execute → **Expect:** the order holds after a reload; `select t.title from task_queue q join tasks t on t.id = q.task_id where q.user_id = auth.uid() order by q.position` (or the MCP `tasks_queue`) shows the same order _(both)_
- [ ] **Do:** Capture a task straight into the Queue (Focus's empty-queue capture) → **Expect:** it appears in the Queue and has a `task_queue` row for you _(both)_
- [ ] **Do:** Complete a queued task → **Expect:** it stays shown as done in today's Queue as before, but its `task_queue` rows are gone (it left every queue) _(both)_
- [ ] **Do:** With two accounts (Maciej + Mike): Maciej commits task X; Mike then commits task X too → **Expect:** both have their own `task_queue` row for X; Maciej uncommitting removes only Maciej's row _(web)_

## MCP connector (needs moduo-mcp deployed from maciej after this merge)
- [ ] **Do:** Ask Claude (Moduo connector) "what's in my queue?" → **Expect:** it calls `tasks_queue` and lists only your queue, in order, each task with `queued_by_me: true` _(Claude)_
- [ ] **Do:** "Add <task> to the top of my queue", then "move <task> after <other>", then "send <task> to the end", then "take <task> out of my queue" → **Expect:** each answer is your queue in the new order; the task's trail in the app shows "queued this first" for the add and "removed this from the queue" for the removal, attributed to the key _(Claude + web)_
- [ ] **Do:** Use an old tool name: "tasks_today", "tasks_commit <task>", "tasks_skip_today <task>" → **Expect:** they still work: `tasks_today` returns the same queue as `tasks_queue`; commit adds to the end of your queue; skip takes it out _(Claude)_
- [ ] **Do:** With a Tasks: View key, try `tasks_queue_add` → **Expect:** the tool isn't offered (or is refused) _(Claude)_

## Edge cases
- [ ] **Do:** Queue a task in a bucket shared with you, then have its owner stop sharing it with you → **Expect:** it drops out of your queue's reads (MCP `tasks_queue`, `listQueue`) without an error; adding it again is refused ("You don't have access to this task.") _(web + Claude)_
- [ ] **Do:** Remove a member who has tasks queued (Settings → Members) → **Expect:** their `task_queue` rows in that workspace are gone; yours are untouched _(web)_
- [ ] **Do:** Archive or delete a queued task, then restore it → **Expect:** its `task_queue` rows go on archive/delete and do **not** come back on restore _(both)_
- [ ] **Do:** Complete a queued repeating task, then let catch-up reopen it (or reopen it by hand) → **Expect:** not queued again _(both)_
- [ ] **Do:** Skip an occurrence of a repeating task that's in your queue → **Expect:** it stays in your `task_queue` (the old day list may drop it, as before) _(both)_
- [ ] **Do:** As a viewer, try to queue a task through the API (`rpc('tasks_op_queue_add', …)`) → **Expect:** "You don't have edit access to Tasks in this workspace." _(web devtools)_

## Old desktop builds (keep one pre-TV-D2 build installed)
- [ ] **Do:** In an old desktop build, commit, reorder and skip in the Queue → **Expect:** it works as before (skip no longer raises the reschedule count); the new queue gets the same additions/order for that person, and uncommit/skip take the task out of it _(desktop)_
- [ ] **Do:** In an old desktop build, edit the title of a task that someone else uncommitted meanwhile → **Expect:** nobody's `task_queue` loses a row (a stale save may put the task back in **your** queue, matching what your build shows) _(desktop)_

## Migrations / data
- [ ] **Do:** `select version, name from supabase_migrations.schema_migrations where version = '20261008171500'` → **Expect:** `tasks_personal_queue` (applied 2026-10-08) _(SQL)_
- [ ] **Do:** `select count(*) from task_queue` right after the apply → **Expect:** 0 (no commits for today existed, so nothing carried over) _(SQL)_
- [ ] **Do:** `select has_table_privilege('anon','public.task_queue','SELECT'), has_table_privilege('authenticated','public.task_queue','INSERT')` → **Expect:** false, false _(SQL)_

## Known gaps / not-yet-testable
- No UI reads the personal queue yet: the app still shows the old shared day list until TV-D4. Until then, commits also collect dateless in personal queues; TV-D4's switch shows all of them (see the TV-D4 note in `specs/BUILD_ORDER.md`).
- The MCP queue tools work only after `moduo-mcp` is deployed from `maciej` with this merge in.
- Claims ("In Mike's queue") are readable in the data but have no UI until TV-D4.
- Not live-verified in the app's browser preview: no UI changed in this block, apart from Skip no longer raising the reschedule count, and that was checked on production through the op itself.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
