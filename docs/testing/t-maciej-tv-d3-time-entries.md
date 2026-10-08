# Manual test checklist — TV-D3 time entries

> Generated 2026-10-08 · branch `t/maciej/tv-d3-time-entries` · **Live-verified:** no (the migration isn't on production yet). On a local Postgres 17 replica of production's schema, `supabase/probes/tasks-time.probe.sql` passes all 12 checks, and the two-sessions run below gave exact totals. Unit tests cover the app side (keys, resends, adjustments, the fallback).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

No screen looks different in this block: totals read the same, and "you 50m" / "waited 1h" arrive with TV-U3 and TV-F4. What changes is how time is saved.

## Focus (Tasks → Queue → Focus)
- [ ] **Do:** Start Focus on a task for 2 minutes, then pause → **Expect:** the task's time goes up by 2m; in Supabase, `select kind, seconds, started_at, ended_at, client_key from task_time_entries where task_id = '<id>' order by created_at` shows `focus` rows that add up to it, with your user id _(web + desktop)_
- [ ] **Do:** While Focus runs, rename the task in the detail panel, and from a second account change its priority → **Expect:** after the next save (each minute, or pause), the new title and priority stay; the task's `updated_at` doesn't move when only time is saved _(web)_
- [ ] **Do:** Start Focus, run 1 minute, turn the network off (devtools → Offline), pause → **Expect:** "not saved yet"; turn the network on → it saves; the task has exactly one new `focus` entry for that minute (not two) _(web)_
- [ ] **Do:** Start Focus, run 1 minute, pause and reload the page at once (before the save answers) → **Expect:** after reload (within ~2 minutes) the minute is saved once: one entry, the same `client_key` sent twice at most _(web)_
- [ ] **Do:** Track time on the same task from two devices (or two accounts) at once for a few minutes → **Expect:** the task's total is the sum of both; neither device's save overwrites the other's _(web + desktop)_

## Correcting time
- [ ] **Do:** In the detail panel, type a Time value (e.g. 45 min) → **Expect:** the total is exactly 45m; one `adjustment` entry with the difference; typing 45 again adds nothing _(both)_
- [ ] **Do:** In Focus → Timer options, press **+5m**, then **Set total** to 10 → **Expect:** +5m is one adjustment of 300; the total then reads 10m _(both)_
- [ ] **Do:** In Calendar, triage a past block → **Took longer**, then **Undo** in the toast → **Expect:** "+Nm logged", then the total goes back exactly; the adjustment row is gone (time tracked on the task in between stays) _(web)_
- [ ] **Do:** Calendar → focus on a task block for a minute, then stop → **Expect:** a `focus` entry, not an adjustment _(web)_

## Edge cases
- [ ] **Do:** Focus on a task, then delete it (trash) while the clock runs, and pause → **Expect:** the time still saves (Undo the delete: the time is there) _(web)_
- [ ] **Do:** Focus on a task, then a teammate deletes it **for good** (or stops sharing its bucket with you), and pause → **Expect:** a note "Nm of focus time couldn't be saved — the task it was tracked on was deleted or isn't shared with you any more"; nothing stays "not saved yet" _(web)_
- [ ] **Do:** As a viewer, call `rpc('tasks_op_track_time', { p_workspace_id, p_task_id, p_action: 'focus', p_seconds: 60 })` → **Expect:** "You don't have edit access to Tasks in this workspace." _(web devtools)_
- [ ] **Do:** As a member, `select * from task_time_entries` → **Expect:** only your own rows; the legacy rows (no person) and teammates' rows aren't visible _(web devtools)_
- [ ] **Do:** `rpc('tasks_time_totals', { p_workspace_id, p_since: <Monday> })` as two people → **Expect:** the same `total_seconds` per task for both; `my_seconds` is each one's own; legacy time never counts in `my_seconds_since` _(web devtools)_

## Old desktop builds (keep one pre-TV-D3 build installed)
- [ ] **Do:** In an old build, track focus time on a task → **Expect:** it saves; the server records the difference as your `adjustment`, and the total is what the old build wrote _(desktop)_
- [ ] **Do:** In an old build (from before TV-D1), rename a task someone has just tracked time on (from a list loaded before their time) → **Expect:** the rename saves and their time stays (the stale lower total is ignored) _(desktop)_

## Migrations / data
- [ ] **Do:** `select version, name from supabase_migrations.schema_migrations where version = '20261008224500'` → **Expect:** `tasks_time_entries` _(SQL)_
- [ ] **Do:** `select count(*), sum(seconds) from task_time_entries where kind = 'legacy'` right after the apply → **Expect:** one row per task that had time, adding up to the old totals (11 tasks, 15,358 s on 2026-10-08) _(SQL)_
- [ ] **Do:** `select count(*) from tasks t where t.time_spent_seconds <> (select greatest(coalesce(sum(e.seconds),0),0) from task_time_entries e where e.task_id = t.id and e.kind <> 'waiting')` → **Expect:** 0 (every cached total matches its entries) _(SQL)_
- [ ] **Do:** `select has_function_privilege('anon','public.tasks_op_track_time(uuid,uuid,text,integer,timestamptz,text,uuid)','EXECUTE'), has_table_privilege('authenticated','public.task_time_entries','INSERT')` → **Expect:** false, false _(SQL)_

## Re-running the round trip (agents)
- The probe recipe is at the top of `supabase/probes/tasks-time.probe.sql` (the migration runs with `psql -1`).
- Two sessions at once: on a database built by that recipe up to the migration, start 40 `psql` sessions in parallel, each `BEGIN; select set_config('request.jwt.claims', '{"sub":"<A or B>","role":"authenticated"}', true); select tasks_op_track_time('<W>','<task>','focus',10,null,'<unique key>'); select pg_sleep(0.05); COMMIT;`, plus 10 sessions resending one key. Expect the total to be the sum of the unique saves, one entry for the resent key, and no errors (2026-10-08: 41 entries, 440 s on top of the 1,200 s legacy total).

## Known gaps / not-yet-testable
- No UI shows "you 50m" or waiting time yet (TV-U3, TV-F4); Home's "this week" widget moves to `tasks_time_totals` in TV-F5.
- Realtime for entries (other people's totals updating live) is TV-D5.
