# Manual test checklist — TV-U15 Upcoming, Inbox, My tasks, All

> Generated 2026-10-13 · branch `t/maciej/tv-u15-views` (landed on `t/maciej/tasks-v3-build`) · **Live-verified:** partial — on the local stack at 1360 × 860: Upcoming's day headers ("Today · Tue, Oct 13 · 3", "Tomorrow · Wed, Oct 14 · 4 · ~1h", an empty "Sun · Oct 18", "Later 11"), "missed 9:00 AM" / "Oct 8 · late" / "11:00 AM · 1h" / "due Thu" rows, ⌥→ moving a task to Fri with "Moved to Fri · Undo" and Undo putting it back, a repeat asking "Just this one · Change the pattern" and moving just that occurrence; the Inbox's note line and the bottom bar's "Accept 1 · Decline 2 · Duplicate 3 · Snooze H"; H → Tomorrow (row gone, "Snoozed until Tomorrow · Undo", the cursor on the next row, "Snoozed 1" folded at the end with "until Tomorrow"), H on it again bringing it back; 1 → File in… → "Filed in Launch plan · Undo" and Undo; My tasks with "For Design U15 · 2 unclaimed" on top and Take it; the Won't do list from the sidebar ⋯. The four triage keys end to end: `tests/inbox.spec.ts` 5/5 on the local stack.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Set up: `bun run local:up`, `bun run env:local`, `bun run dev:web`, sign in as the local seed account. Have a few tasks: one due today, one due in three days, one with a work session tomorrow at 9:00, one due last week, one repeating daily, one in Backlog with a due date.

## Upcoming
- [ ] **Do:** open Upcoming → **Expect:** Earlier (only if something's late or missed) · Today · Tomorrow · the next five days by short name · Later (only if something's further out); each day reads like "Thu · Oct 15 · 3 · ~2h 30m" (the estimate only when there are estimates); empty days keep their header _(both)_
- [ ] **Do:** look at the rows → **Expect:** inside a day only a time shows ("9:00 AM · 45m", "due 5:00 PM", "due Thu"); the task due last week reads "Oct 8 · late" in Earlier (muted, never red); a session that ended with the task open reads "missed 2:00 PM"; the Backlog task isn't there _(both)_
- [ ] **Do:** a task with both a session tomorrow and a due date Friday → **Expect:** one row, under Tomorrow, at the session's time _(both)_
- [ ] **Do:** drag a due-date row onto another day's header or rows → **Expect:** it moves there, "Moved to Fri · Undo"; Undo puts it back. Drag a session row → it keeps its time and length on the new day _(web)_
- [ ] **Do:** drag a row onto Earlier → **Expect:** nothing (Earlier takes no drops); onto Later → a day picker opens _(web)_
- [ ] **Do:** select a row, press ⌥→, ⌥⇧→, `t` → **Expect:** a day later, a week later, back to today; ⌥← never goes before today _(both)_
- [ ] **Do:** move the repeating task (drag or ⌥→) → **Expect:** "Move “…” to Tomorrow" asks Just this one · Change the pattern · Cancel; Just this one moves only this occurrence (the next one is back on the pattern) _(both)_
- [ ] **Do:** with late tasks, Earlier's header → Move all… → Today → **Expect:** all of them move to today, one "Moved 4 tasks to Today · Undo"; Move all… → Pick… a past day → "Pick today or a day after." _(both)_
- [ ] **Do:** a day's "+" → **Expect:** the capture opens with that day as Due; the new task shows under that day. Earlier and Later have no "+"; New in the toolbar dates the task today _(both)_
- [ ] **Do:** an unassigned task routed to a team you're not in, with a due date → **Expect:** not in Upcoming; one routed to your team is _(both)_
- [ ] **Do:** Display in Upcoming → **Expect:** Layout, Completed, Rows and Show on rows only (no Group by, Order by or Subtasks); dated subtasks show flat with "↳ Parent" _(both)_

## Inbox
- [ ] **Do:** open the Inbox → **Expect:** "Only you see your Inbox. File a task into a project or assign it, and it moves." under the toolbar; newest captures on top; you can drag to reorder _(both)_
- [ ] **Do:** select a task → **Expect:** the bottom bar's centre reads "Accept 1 · Decline 2 · Duplicate 3 · Snooze H" instead of Search · capture · New; clicking one acts on the selected task _(both)_
- [ ] **Do:** press 1 → **Expect:** "File “…” in…" with your projects; pick one → "Filed in X · Undo", the task leaves the Inbox, assigned to you, the cursor on the next row _(both)_
- [ ] **Do:** press 2 on your own task → **Expect:** it's Won't do (with Undo) _(both)_
- [ ] **Do:** press 2 on a task someone else handed you → **Expect:** "Hand “…” back" with a note field; Hand back → it leaves your Inbox for theirs, with a comment "Declined by <you>: <note>" _(both)_
- [ ] **Do:** press 3 → pick the task it duplicates → **Expect:** "Duplicate of “…” · Won't do · Undo"; the original has a comment "Merged “…” into this task." with the duplicate's comments; the duplicate's links moved over and the two are linked _(both)_
- [ ] **Do:** press H → Tomorrow → **Expect:** the row leaves, "Snoozed until Tomorrow · Undo"; "Snoozed 1" sits folded at the end, its row reading "until Tomorrow"; H on it brings it back at once _(both)_
- [ ] **Do:** snooze a task, then comment on it from the panel (or have someone else) → **Expect:** it comes back on top of the Inbox _(both)_
- [ ] **Do:** a task someone else put in your Inbox → **Expect:** "from <their first name>" after its title _(both)_
- [ ] **Do:** clear the Inbox (file or finish everything) → **Expect:** "Inbox is clear · New captures from anywhere, email and your agents land here, newest on top." with Capture a task and "⌘⇧K captures from anywhere in Moduo"; with snoozed tasks, "2 snoozed · show" _(both)_
- [ ] **Do:** type in the search field or the capture while in the Inbox, press 1/2/3/h → **Expect:** the letters type; no triage happens _(both)_

## My tasks
- [ ] **Do:** open My tasks (it's in the sidebar even in a workspace of one) → **Expect:** In progress · To do, each by date then priority, tasks waiting on someone at the end of their group; your Backlog folded at the end _(both)_
- [ ] **Do:** be in a team (Settings → Members → Teams once TV-D13 is in; the local seed script otherwise) with unclaimed tasks → **Expect:** "For Design · 2 unclaimed" on top with the team's square mark; up to five rows then "Show 3 more"; each row has Take it _(both)_
- [ ] **Do:** Take it → **Expect:** "Taken · it's yours · Undo"; the row moves into To do and the block's count drops; Undo gives it back to the team _(both)_
- [ ] **Do:** the team block's "+" → **Expect:** the capture routes the new task to that team _(both)_
- [ ] **Do:** Display → Group by → Date → **Expect:** date groups instead of status; the team block stays on top _(both)_

## All and Won't do
- [ ] **Do:** open All → **Expect:** your projects in the sidebar's order, area by area; never your Inbox (All's sidebar count matches); a project's header names its area ("· Client work") and "On hold" / "Done"; On hold and Done projects start folded _(both)_
- [ ] **Do:** sidebar ⋯ (on the hairline) → Won't do → **Expect:** every Won't do task by project, each group counting all of its tasks, no "+"; click a task's crossed icon → it reopens to To do; the panel offers Reopen too _(both)_

## Empty states (a new person's first look)
- [ ] **Do:** in a fresh workspace, open Upcoming, My tasks, All, Won't do → **Expect:** "Nothing dated yet" with Add a task for today; "Nothing assigned to you" with Add a task and the `c` / `@` hint; "No projects yet" naming New project; "Nothing marked Won't do" _(both)_

## Edge cases
- [ ] **Do:** snooze a task, then file it into a project from the panel → **Expect:** it's in the project; the snooze is forgotten (no stray "Snoozed" later) _(both)_
- [ ] **Do:** switch workspaces with a snoozed task in each → **Expect:** each Inbox keeps its own snoozes _(both)_
- [ ] **Do:** snooze a task, quit, turn the network off, open the app (it opens from the device copy) → **Expect:** the snooze is still there after you go back online _(desktop)_
- [ ] **Do:** a viewer (read-only) member opens the Inbox / Upcoming → **Expect:** no triage row, no drag, no "+" or Take it _(both)_

## Migrations / data
- [ ] **Do:** none — snoozes live in `user_preferences.preferences.tasksInbox` (synced per person) → **Expect:** a snooze set on web shows on desktop after the preferences sync _(both)_

## Known gaps / not-yet-testable
- Email "From:" and agent "via Claude Desktop" chips on Inbox rows (only "from Mike" is built); the triage buttons in the panel's Details header (the bottom bar carries them); Duplicate's comments are copied into one comment (no server op moves comments). See decisions U15-5/6.
- Take it goes through TV-D13's claim op (live-checked: "Taken · it's yours", Undo gives it back to the team).
- **Verify before release:** the triage row and Upcoming's ⌥←/→ in the signed desktop build (webview key handling), preferences sync of snoozes between two devices on prod, and Upcoming at 10,000 tasks (the perf fixture: the view filters every task once per change).
