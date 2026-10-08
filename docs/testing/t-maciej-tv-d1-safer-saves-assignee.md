# Manual test checklist — TV-D1 Safer saves + assignee data

> Generated 2026-10-08 · branch `t/maciej/tv-d1-safer-saves-assignee` · **Live-verified:** partial. The UI was driven in a temporary harness (real detail panel, list rows and capture modal on an in-memory runtime): every picker offers Unassigned and disables view-only people, an edit sent only `{priority}`, assigning went through `tasks_op_assign`, "Created by …" showed and hid as expected. The SQL was round-tripped on a local copy of production's schema (`supabase/probes/tasks-assignee.*`, 25 checks). Signed-in runs against the real backend are below.
> Needs two accounts in one workspace (you and a teammate, both able to edit tasks) and, for the old-build checks, a desktop build from before this branch.

## Saves that don't clobber (D1-1)
- [ ] **Do:** open the same task on two devices. On A change the priority; on B (without reloading) change the title. Reload both. → **Expect:** both changes are there; neither put the other back. _(web + desktop)_
- [ ] **Do:** delete a task that has a subtask, change the subtask's title on another device, then press Undo on the first. → **Expect:** the task comes back with its subtask attached, and the new subtask title survives. _(web)_

## Assignee and creator (D1-2, D1-3, D1-8)
- [ ] **Do:** open a task's detail panel → Assignee. → **Expect:** "Unassigned" first, then you ("Me") and teammates; a view-only member is listed as "(view only)" and can't be picked. _(web)_
- [ ] **Do:** pick Unassigned. → **Expect:** the row's avatar turns to "?" with the tooltip "Unassigned"; after a reload it stays Unassigned. _(web)_
- [ ] **Do:** right-click a row → Assign to; and on the Board, right-click a card → Assign to. → **Expect:** the same choices as the panel, the current one ticked. _(web)_
- [ ] **Do:** New task (capture) → the assignee pill → Unassigned → create. → **Expect:** the new task is Unassigned; the next capture starts on "Me" again. _(web)_
- [ ] **Do:** look at the bottom of the detail panel on a task a teammate made. → **Expect:** "Created by <their name> · <date>"; on your own task "Created by you". _(web)_
- [ ] **Do:** reassign a task several times. → **Expect:** "Created by" never changes. _(web)_

## Notifications (D1-4, D1-5, D1-6)
- [ ] **Do:** assign a task to your teammate. → **Expect:** their bell shows "<you> assigned this to you" once; yours shows nothing. Assigning it to yourself or unassigning notifies nobody, but the task's activity says "took this" / "unassigned this". _(web)_
- [ ] **Do:** teammate completes a task you created and assigned to them. → **Expect:** your bell shows "<teammate> completed this" once; Settings → Preferences → Notifications has a "Completed by someone else" switch that hides it. _(web)_
- [ ] **Do:** teammate completes a *repeating* task you created. → **Expect:** no notification for you. _(web)_
- [ ] **Do:** comment on a task you created that's assigned to your teammate. → **Expect:** your teammate is notified; when they reply, you are. _(web)_
- [ ] **Do:** with "Show overdue tasks" on, schedule a task assigned to your teammate in the past. → **Expect:** it's in their overdue list, not yours; an unassigned overdue task you created is in yours. _(web)_

## Old desktop builds (D1-7)
- [ ] **Do:** on a pre-TV-D1 desktop build, change a task's assignee. → **Expect:** on the web build the task shows the new assignee, "Created by" is unchanged, and the new assignee gets one notification. _(old desktop + web)_
- [ ] **Do:** on the old build, create a task for your teammate. → **Expect:** on web: assigned to the teammate, created by you. _(old desktop + web)_
- [ ] **Do:** on the old build, edit only a title. → **Expect:** the assignee doesn't change. Known: the old build shows the *creator* where it used to show the assignee, until it updates. _(old desktop)_

## MCP (D1-9) — after `moduo-mcp` is redeployed (see Known gaps)
- [ ] **Do:** with an edit-scoped key, call `tasks_list` / `tasks_get`. → **Expect:** each task has `assignee` (`{id, name}` or null) and `creator` (unless unknown). _(MCP)_
- [ ] **Do:** `tasks_list_assignees`, then `tasks_assign` with a teammate's id, `"me"`, and `null`. → **Expect:** the teammate is notified once (attributed to the key); "me" and null notify nobody; a view-only member is refused with "Viewers can't be assigned tasks." _(MCP)_

## Migrations / data
- [ ] **Do:** on a build with TV-D1 (applied to production 2026-10-08), open Tasks. → **Expect:** every task shows the same assignee as before; the 7 tasks whose creator couldn't be recovered don't show "Created by". _(web)_
- [ ] **Do:** on a build from before TV-D1, open the 5 tasks someone made for a teammate. → **Expect (known, until it updates):** it shows the creator as the assignee. _(old web/desktop)_

## Known gaps / not-yet-testable
- `moduo-mcp` must not be redeployed from this branch until PR #247 is merged into `maciej`: production runs #247's connector (v21), and this branch doesn't have it. Deploy from `maciej` once both are in.
- An old desktop build can't assign a task back to the person who created it (it already shows them as the assignee). Use the web build or update the desktop build.
- An old-model "Assign to → Me" pickup left no record, so such a task may say it was created by whoever picked it up.
- Removing a member unassigns their tasks there (PRIV-2 AC9, kept by Maciej on 2026-10-08); "Created by a former member" still shows.
