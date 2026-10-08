# Manual test checklist — TV-D4 Queue & assignee in the UI (claims, My tasks)

> Generated 2026-10-08 · branch `t/maciej/tv-d4-queue-assignee-ui` · **Live-verified:** partial. The real Tasks UI ran in the browser over a temporary in-memory two-person workspace (the worktree had no `.env.local`, so no real backend): queue toggles, claims, the "Also in Mike's queue" note, `q`, My tasks (List + Board), Focus Skip/Done, the Home Tasks widget and Calendar's tasks panel all behaved as below. Nothing here was run against Supabase.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where. Claims and My tasks need a workspace with **two members** (you and Mike), so run those in the shared workspace, ideally with Mike in a second browser.

## My queue (D4-1)
- [ ] **Do:** open Tasks → a bucket, click the queue icon at the right end of a row → **Expect:** it turns accent at once; the rail's **Queue** count goes up by one. _(both)_
- [ ] **Do:** click it again → **Expect:** it goes faint; the count goes back down. _(both)_
- [ ] **Do:** select a row and press `q` twice → **Expect:** in, then out of your queue; the count follows. _(both)_
- [ ] **Do:** right-click a row (and a Board card) → **Expect:** "Add to queue" / "Remove from queue" matches its state and works. _(both)_
- [ ] **Do:** open a task's detail panel → **Expect:** the button reads **Add to queue** (no more "Commit to Queue") or **Remove from queue**, and works. _(both)_
- [ ] **Do:** open **Queue** in the rail → **Expect:** only tasks *you* queued, in the order you queued them; drag one to a new place, reload → **Expect:** the new order stuck. _(both)_
- [ ] **Do:** queue three tasks quickly one after another (click, click, click) → **Expect:** all three end up queued, in that order, also after a reload. _(both)_
- [ ] **Do:** queue a task, reload, switch to another device/browser signed in as you → **Expect:** the same queue there. _(both)_
- [ ] **Do:** Home → the **Tasks** widget → **Expect:** heading "Queue" with your queued open tasks in order; with an empty queue it says "Open" and lists open tasks. Its gallery text reads "Your queue, with inline check-off." _(both)_
- [ ] **Do:** Calendar → right panel → Tasks → **Expect:** the first group is **Queue** (your queued open tasks); those tasks aren't repeated under Due soon or Backlog. _(both)_
- [ ] **Do:** queue a task that's blocked by an open task → **Expect:** the "Blocked by …" offer opens with **Queue** per unblocked task and **Queue anyway**. _(both)_

## Focus
- [ ] **Do:** queue two tasks, switch the rail to **Focus** → **Expect:** the first queued task is Now, the second under Up next. _(both)_
- [ ] **Do:** press **Skip** → **Expect:** Now becomes the second task; the skipped one moves to the end (Up next). It's still queued (rail count unchanged) and its reschedule count didn't change. _(both)_
- [ ] **Do:** with only one task queued, press **Skip** → **Expect:** it stays Now (it went to the end of a queue of one). _(both)_
- [ ] **Do:** press **Done** → **Expect:** the next task becomes Now; the footer reads "1 / 2 done"; the rail count drops by one. _(both)_
- [ ] **Do:** on the empty-queue screen type a title in "Add one more…" + Enter → **Expect:** a new Inbox task, assigned to you, appears as Now and stays queued after a reload. _(both)_

## Claims (D4-2) — two members
- [ ] **Do:** as Mike, queue a task; as you, reload Tasks and find it → **Expect:** in the queue column, Mike's small ringed avatar instead of the queue icon; hovering says "In Mike's queue · Add to your queue". _(both)_
- [ ] **Do:** click Mike's avatar → **Expect:** it's added to *your* queue, a quiet toast "Also in Mike's queue", and Mike's avatar now sits next to your accent icon. _(both)_
- [ ] **Do:** open that task's detail panel → **Expect:** a quiet line with Mike's avatar: "Also in Mike's queue" (or "In Mike's queue" before you queue it). _(both)_
- [ ] **Do:** as a view-only member, look at the same task → **Expect:** Mike's avatar shows (no button, no queue actions). _(both)_
- [ ] **Do:** as Mike, complete the task; as you, reload → **Expect:** it's gone from both queues and no claim shows. _(both)_

## My tasks (D4-3, D4-4)
- [ ] **Do:** in the two-member workspace, look at the rail → **Expect:** **My tasks** between Queue and Inbox, with the count of open tasks assigned to you. _(both)_
- [ ] **Do:** click **My tasks** → **Expect:** every task assigned to you across buckets, grouped by bucket; rows show **no** assignee avatar. _(both)_
- [ ] **Do:** switch to Board in My tasks → **Expect:** cards show no assignee avatar; "Columns: Bucket" is offered. In **All**, the avatars are back. _(both)_
- [ ] **Do:** open the solo test workspace → **Expect:** no My tasks row. _(both)_

## Edge cases
- [ ] **Do:** check off a queued task in the Queue view → **Expect:** it stays in place, struck through, until you change scope or reload, then it's gone. Unchecking it does **not** put it back in the queue (a task leaves every queue when done; worth knowing before you tick one by accident). _(both)_
- [ ] **Do:** look at a done task's row, card and detail panel → **Expect:** no queue icon, no "Add to queue" menu item, no queue button. Pressing `q` on it says "Done tasks can't be queued." _(both)_
- [ ] **Do:** delete a queued task, then Undo → **Expect:** it comes back but is no longer queued. _(both)_
- [ ] **Do:** capture into the queue from Focus and immediately press Skip → **Expect:** "Still saving that task — try again in a moment." (no error), and a second later it works. _(both)_
- [ ] **Do:** queue a task in the new app, then open an old desktop build → **Expect:** the old build's "today" list doesn't show it (old builds keep their own shared day list until they update; their own commits still show up in your queue). _(desktop)_

## Migrations / data
- [ ] No migration in this block. It reads `task_queue` (TV-D2, already on production). **Do:** with network devtools open, reload Tasks → **Expect:** one `task_queue` read next to the tasks read, and queue clicks call `tasks_op_queue_add` / `_remove` / `_reorder` / `_move_to_end` (no `tasks_op_commit`). _(web)_

## Known gaps / not-yet-testable
- Not run against Supabase in this session (no `.env.local` in the worktree); every check above on real data is still open.
- "<name> is on this" (a teammate's running Focus) and the stale line-up prompt are later blocks (TV-F2).
- Claims and queues from teammates appear on reload, not live, until TV-D5 (Realtime).

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
