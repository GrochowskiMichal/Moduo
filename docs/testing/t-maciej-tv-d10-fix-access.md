# Manual test checklist — TV-D10-fix (sessions, reminders and Waiting on behind the task's gate)

> Generated 2026-10-11 · branch `t/maciej/tv-d10-fix-access` · **Live-verified:** partial — the migration applied to the local stack, every SQL test green (`bun run db:test`), the booking busy read called through local PostgREST with the service key (times only; a session on a task the host can't see is left out). No new UI in this block, so the in-app steps below wait for the sessions and reminders UI (TV-U13 / TV-F6) where noted.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Work sessions
- [ ] **Do:** in a shared project, assign a task to a teammate and give it a time (the schedule picker) → **Expect:** the block is the teammate's: their booking link shows that time as busy; yours doesn't. _(web)_
- [ ] **Do:** schedule a task nobody is assigned to → **Expect:** the block is yours (your booking link is busy then). _(web)_
- [ ] **Do:** as the workspace owner, make a project private and schedule a task in it; sign in as a teammate → **Expect:** the teammate sees neither the task nor its time, and their booking link is unaffected. _(web)_
- [ ] **Do:** with someone who can only view a project, try to move a task's time there → **Expect:** "You don't have access to this task." and the time stays. _(web)_
- [ ] **Do (once TV-U13's sessions UI exists):** add a work session for a teammate who isn't the assignee → **Expect:** refused ("A work session goes in your own calendar or the assignee's."); for the assignee it works. _(web)_

## Reminders
- [ ] **Do (once TV-U13's reminder picker exists):** as a viewer, set "Remind me" on a task you can see → **Expect:** it's saved, and only you see it. _(web)_
- [ ] **Do:** set a reminder, then have the owner take you off the project before it's due → **Expect:** no notice ever arrives for it (TV-D12 delivers notices; today the stub only records the time). _(desktop + web, after TV-D12)_

## Waiting on
- [ ] **Do (once TV-U13 shows it):** a task in a private project waits on something → **Expect:** a teammate without access sees nothing of it, live updates included. _(web)_

## Booking links
- [ ] **Do:** open your public booking page on a day you have a work session → **Expect:** that slot is busy, and nothing on the page says what the work is. _(web)_
- [ ] **Do:** finish the task (Done or Won't do) and reload the booking page → **Expect:** the slot is free again. _(web)_

## Migrations / data
- [ ] **Do:** apply `supabase/migrations/20261011110000_task_sessions_access.sql` after TV-D10's three files, then `bun run db:test sessions_access` → **Expect:** "PASS: all (105 checks)"; `bun run db:test` → every file passes. _(local stack)_
- [ ] **Do:** `select qual from pg_policies where tablename in ('task_sessions','task_reminders','task_waiting')` → **Expect:** each reads through `tasks__visible(task_id)` (reminders also `user_id = auth.uid()`). _(local stack)_

## Known gaps / not-yet-testable
- The sessions and reminder pickers don't exist yet (TV-U13 / TV-F6), so the refusals above are proven by `supabase/tests/sessions_access.test.sql`, not by hand.
- Realtime is proven by calling `realtime.apply_rls` (what the Realtime server runs per change) inside the SQL test, not by two signed-in browsers.

## Verify before release
- Deploy `booking-public` together with this migration: a function that calls `tasks__busy_sessions` on a database without it shows work sessions as free (it blocks nothing rather than failing).
- Two real accounts on the release stack: a teammate without access to a private project receives no live session, reminder or Waiting on change from it.
