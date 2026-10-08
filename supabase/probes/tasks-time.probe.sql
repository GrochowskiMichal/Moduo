-- Probe for supabase/migrations/20261008224500_tasks_time_entries.sql (TV-D3,
-- specs/tasks-v2.md block 5). Run it on a throwaway Postgres 17 database that
-- holds nothing else. The migration runs in one transaction (it locks tasks
-- between the backfill and its triggers), like Supabase applies it:
--
--   createdb -h /tmp -p 54363 -U postgres d3_probe
--   P="-h /tmp -p 54363 -U postgres -d d3_probe -v ON_ERROR_STOP=1 -q"
--   psql $P -f supabase/probes/tasks-assignee.stub.sql \
--     -f supabase/migrations/20261008150000_tasks_assignee_creator.sql \
--     -f supabase/probes/tasks-queue.stub.sql \
--     -f supabase/probes/tasks-queue.seed.sql \
--     -f supabase/migrations/20261008171500_tasks_personal_queue.sql \
--     -f supabase/probes/tasks-time.seed.sql
--   psql $P -1 -f supabase/migrations/20261008224500_tasks_time_entries.sql
--   psql $P -f supabase/probes/tasks-time.probe.sql
--
-- Every check stops the run with the failing check's message. A clean run
-- prints one PASS line per check and ends with "PASS: all". Two sessions
-- writing at once is a separate shell check (docs/testing/t-maciej-tv-d3-time-entries.md).

-- The seed captured timestamps as text in UTC; compare them the same way.
SET timezone = 'UTC';

GRANT USAGE ON SCHEMA probe TO anon, authenticated, service_role;

-- One call of the op, as a person or key; the answer.
CREATE FUNCTION probe.track(p_who text, p_task text, p_action text, p_seconds integer DEFAULT NULL,
                            p_key text DEFAULT NULL, p_entry uuid DEFAULT NULL, p_ws text DEFAULT 'W',
                            p_ended timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  r jsonb;
BEGIN
  IF p_who = 'K' THEN PERFORM probe.as_key('K'); ELSE PERFORM probe.as_user(p_who); END IF;
  r := public.tasks_op_track_time(probe.id(p_ws), probe.id(p_task), p_action, p_seconds, p_ended, p_key, p_entry);
  PERFORM probe.as_system();
  RETURN r;
END;
$$;
CREATE FUNCTION probe.cached(p_task text) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT time_spent_seconds FROM public.tasks WHERE id = probe.id(p_task)
$$;
CREATE FUNCTION probe.entries(p_task text, p_kind text DEFAULT NULL) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.task_time_entries
  WHERE task_id = probe.id(p_task) AND (p_kind IS NULL OR kind = p_kind)
$$;
-- The total as the entries add up, and what tasks.time_spent_seconds says.
CREATE FUNCTION probe.consistent(p_task text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.tasks_time__total(probe.id(p_task)) = probe.cached(p_task)
$$;
CREATE FUNCTION probe.totals(p_who text, p_since timestamptz DEFAULT NULL)
RETURNS SETOF record LANGUAGE plpgsql AS $$
BEGIN
  PERFORM probe.as_user(p_who);
  RETURN QUERY SELECT x.task_id, x.total_seconds, x.my_seconds, x.my_waiting_seconds, x.my_seconds_since
               FROM public.tasks_time_totals(probe.id('W'), p_since) x;
  PERFORM probe.as_system();
END;
$$;
-- The error a statement raises, or NULL (as whoever is set, or as a person).
CREATE FUNCTION probe.error_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$;
CREATE FUNCTION probe.error_of_as(p_who text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM probe.as_user(p_who);
  EXECUTE p_sql;
  PERFORM probe.as_system();
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM probe.as_system();
  RETURN SQLERRM;
END;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA probe TO anon, authenticated, service_role;

-- ── 1. The legacy backfill (D3-4) ────────────────────────────────────────────

DO $$
DECLARE
  b record;
BEGIN
  SELECT * INTO b FROM probe.time_before;
  ASSERT (SELECT count(*) FROM public.task_time_entries) = 6,
    format('backfill: %s entries, expected one per task with time', (SELECT count(*) FROM public.task_time_entries));
  ASSERT probe.entries('T1 ninety minutes', 'legacy') = 1 AND probe.entries('T2 no time yet') = 0
     AND probe.entries('T3 trashed', 'legacy') = 1, 'backfill: wrong tasks';
  ASSERT (SELECT seconds FROM public.task_time_entries WHERE task_id = probe.id('T1 ninety minutes')) = 5400,
    'backfill: T1''s legacy entry isn''t its old total';
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_time_entries WHERE user_id IS NOT NULL OR started_at IS NOT NULL),
    'backfill: a legacy entry names a person or a time';
  ASSERT (SELECT jsonb_object_agg(id, jsonb_build_array(time_spent_seconds, updated_at, title)) FROM public.tasks)
         = b.tasks, 'backfill: a task changed';
  ASSERT (SELECT count(*) FROM public.module_activity) = b.activity, 'backfill: wrote activity';
  ASSERT probe.consistent('T1 ninety minutes') AND probe.consistent('T6 old builds'), 'backfill: totals disagree';
  RAISE NOTICE 'PASS backfill: every old total is one legacy entry; no task or trail touched';
END;
$$;

-- ── 2. Stretches add up, two people and two devices (D3-1) ───────────────────

DO $$
DECLARE
  r jsonb;
  before_row public.tasks;
BEGIN
  -- Bea renamed T2 a moment ago; Ada's time must not put the old title back.
  PERFORM probe.as_user('B');
  UPDATE public.tasks SET title = 'T2 renamed by Bea' WHERE id = probe.id('T2 no time yet');
  PERFORM probe.as_system();
  SELECT * INTO before_row FROM public.tasks WHERE id = probe.id('T2 no time yet');

  r := probe.track('A', 'T2 no time yet', 'focus', 60, 'ada-laptop-0001', p_ended => now() - interval '1 hour');
  ASSERT r->>'status' = 'saved' AND (r->>'total_seconds')::int = 60 AND (r->>'my_seconds')::int = 60,
    format('focus: Ada''s first minute: %s', r);
  r := probe.track('A', 'T2 no time yet', 'focus', 90, 'ada-desktop-001');
  r := probe.track('B', 'T2 no time yet', 'focus', 120, 'bea-laptop-0001');
  ASSERT (r->>'total_seconds')::int = 270 AND (r->>'my_seconds')::int = 120,
    format('focus: Bea''s answer: %s', r);
  ASSERT probe.cached('T2 no time yet') = 270 AND probe.consistent('T2 no time yet'), 'focus: the task''s total';
  ASSERT (SELECT ended_at - started_at FROM public.task_time_entries WHERE client_key = 'ada-laptop-0001')
         = interval '60 seconds', 'focus: the stretch''s length';
  ASSERT (SELECT abs(extract(epoch FROM ended_at - (now() - interval '1 hour'))) < 1
          FROM public.task_time_entries WHERE client_key = 'ada-laptop-0001'), 'focus: the stretch''s end';
  ASSERT (SELECT user_id FROM public.task_time_entries WHERE client_key = 'bea-laptop-0001') = probe.id('B'),
    'focus: whose stretch';
  -- Only the time changed (and updated_at, for live updates): not the title
  -- Bea wrote, nor anything else.
  ASSERT (SELECT (to_jsonb(t) - 'time_spent_seconds' - 'updated_at')
                 = (to_jsonb(before_row) - 'time_spent_seconds' - 'updated_at')
                 AND t.title = 'T2 renamed by Bea' AND t.updated_at >= before_row.updated_at
          FROM public.tasks t WHERE t.id = probe.id('T2 no time yet')), 'focus: the op touched more than the time';
  ASSERT (SELECT count(*) FROM public.module_activity WHERE entity_id = probe.id('T2 no time yet')
            AND op NOT LIKE 'tasks.queue%') = 0, 'focus: time wrote to the trail';
  -- A stretch claimed for the future ends now.
  r := probe.track('A', 'T1 ninety minutes', 'focus', 30, 'ada-future-0001', p_ended => now() + interval '1 day');
  ASSERT (SELECT ended_at <= now() FROM public.task_time_entries WHERE client_key = 'ada-future-0001'),
    'focus: a future end was kept';
  RAISE NOTICE 'PASS focus: each stretch is recorded with who, when and how long; totals add up; nothing else on the task changes';
END;
$$;

-- ── 3. A save sent twice is recorded once (the TV-F1 duplicate guard) ────────

DO $$
DECLARE
  first_id uuid;
  r jsonb;
BEGIN
  SELECT id INTO first_id FROM public.task_time_entries WHERE client_key = 'ada-laptop-0001';
  r := probe.track('A', 'T2 no time yet', 'focus', 60, 'ada-laptop-0001');
  ASSERT r->>'status' = 'duplicate' AND (r->>'entry_id')::uuid = first_id AND (r->>'total_seconds')::int = 270,
    format('duplicate: the resend answered %s', r);
  ASSERT probe.entries('T2 no time yet') = 3, 'duplicate: the resend added an entry';
  -- The same key on another task is another save.
  r := probe.track('A', 'T1 ninety minutes', 'focus', 60, 'ada-laptop-0001');
  ASSERT r->>'status' = 'saved', format('duplicate: a key is per task: %s', r);
  -- Keys are checked.
  ASSERT probe.error_of_as('A', format('SELECT public.tasks_op_track_time(%L, %L, ''focus'', 5, NULL, ''bad key!'')',
           probe.id('W'), probe.id('T2 no time yet'))) = 'That save key isn''t valid.', 'duplicate: a bad key was taken';
  RAISE NOTICE 'PASS duplicate: resending a save with its key changes nothing and answers with the first entry';
END;
$$;

-- ── 4. Each person sees only their own share (D3-2) ──────────────────────────

BEGIN;
SELECT FROM probe.as_user('A');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.task_time_entries) = 4
         AND NOT EXISTS (SELECT 1 FROM public.task_time_entries WHERE user_id IS DISTINCT FROM probe.id('A')),
    format('share: Ada reads %s entries, not just her own', (SELECT count(*) FROM public.task_time_entries));
  ASSERT probe.error_of(format('INSERT INTO public.task_time_entries (workspace_id, task_id, user_id, kind, seconds) VALUES (%L, %L, %L, ''adjustment'', 60)',
           probe.id('W'), probe.id('T2 no time yet'), probe.id('A'))) LIKE 'permission denied%',
    'share: Ada inserted an entry directly';
  ASSERT probe.error_of('DELETE FROM public.task_time_entries') LIKE 'permission denied%', 'share: Ada deleted entries';
END;
$$;
RESET ROLE;
COMMIT;
DO $$
DECLARE
  a record;
  b record;
  v record;
BEGIN
  SELECT * INTO a FROM probe.totals('A') AS x(task_id uuid, total integer, mine integer, waiting integer, since integer)
  WHERE x.task_id = probe.id('T2 no time yet');
  SELECT * INTO b FROM probe.totals('B') AS x(task_id uuid, total integer, mine integer, waiting integer, since integer)
  WHERE x.task_id = probe.id('T2 no time yet');
  SELECT * INTO v FROM probe.totals('V') AS x(task_id uuid, total integer, mine integer, waiting integer, since integer)
  WHERE x.task_id = probe.id('T2 no time yet');
  ASSERT a.total = 270 AND b.total = 270 AND v.total = 270, 'share: the total differs between people';
  ASSERT a.mine = 150 AND b.mine = 120 AND v.mine = 0, format('share: shares %s / %s / %s', a.mine, b.mine, v.mine);
  ASSERT a.since IS NULL, 'share: a since-sum without a since';
  -- Ada can't see Bea's private task or Nell's workspace; trashed tasks aren't listed.
  ASSERT NOT EXISTS (SELECT 1 FROM probe.totals('A') AS x(task_id uuid, total integer, mine integer, waiting integer, since integer)
                     WHERE x.task_id IN (probe.id('T4 Bea private'), probe.id('T3 trashed'), probe.id('T5 Nell''s'))),
    'share: Ada''s totals list a task she can''t see, or a trashed one';
  ASSERT EXISTS (SELECT 1 FROM probe.totals('B') AS x(task_id uuid, total integer, mine integer, waiting integer, since integer)
                 WHERE x.task_id = probe.id('T4 Bea private') AND x.total = 300), 'share: Bea misses her own task';
  -- Nobody outside the workspace gets anything.
  ASSERT NOT EXISTS (SELECT 1 FROM probe.totals('N') AS x(task_id uuid, total integer, mine integer, waiting integer, since integer)),
    'share: Nell reads W''s totals';
  RAISE NOTICE 'PASS share: everyone who can see a task sees the same total; each person sees only their own share and entries';
END;
$$;

-- ── 5. Adjustments: the typed total, "took longer" and its Undo (D3-3) ──────

DO $$
DECLARE
  r jsonb;
  longer uuid;
BEGIN
  -- Typing 10m makes the total exactly 10m, whatever was there.
  r := probe.track('A', 'T2 no time yet', 'set_total', 600);
  ASSERT r->>'status' = 'saved' AND (r->>'total_seconds')::int = 600, format('set_total: %s', r);
  ASSERT (SELECT seconds FROM public.task_time_entries WHERE id = (r->>'entry_id')::uuid) = 330,
    'set_total: the adjustment isn''t the difference';
  r := probe.track('A', 'T2 no time yet', 'set_total', 600);
  ASSERT r->>'status' = 'noop' AND r->>'entry_id' IS NULL, format('set_total: typing the same value: %s', r);
  r := probe.track('B', 'T2 no time yet', 'set_total', 0);
  ASSERT (r->>'total_seconds')::int = 0 AND probe.cached('T2 no time yet') = 0, format('set_total: to zero: %s', r);
  r := probe.track('B', 'T2 no time yet', 'set_total', 1800);
  ASSERT (r->>'total_seconds')::int = 1800, format('set_total: back up: %s', r);

  -- "Took longer": one adjustment; its Undo removes exactly that one.
  r := probe.track('A', 'T2 no time yet', 'adjust', 900, 'ada-longer-0001');
  longer := (r->>'entry_id')::uuid;
  ASSERT (r->>'total_seconds')::int = 2700, format('adjust: took longer: %s', r);
  r := probe.track('B', 'T2 no time yet', 'focus', 60, 'bea-between-001');  -- someone's time in between
  r := probe.track('B', 'T2 no time yet', 'undo', p_entry => longer);
  ASSERT r->>'status' = 'noop', 'undo: Bea removed Ada''s adjustment';
  r := probe.track('A', 'T2 no time yet', 'undo', p_entry => longer);
  ASSERT r->>'status' = 'saved' AND (r->>'total_seconds')::int = 1860 AND probe.cached('T2 no time yet') = 1860,
    format('undo: %s', r);
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_time_entries WHERE id = longer), 'undo: the adjustment is still there';
  r := probe.track('A', 'T2 no time yet', 'undo', p_entry => longer);
  ASSERT r->>'status' = 'noop', 'undo: twice';
  -- Undo only ever takes adjustments.
  r := probe.track('B', 'T2 no time yet', 'undo',
                   p_entry => (SELECT id FROM public.task_time_entries WHERE client_key = 'bea-between-001'));
  ASSERT r->>'status' = 'noop', 'undo: removed a focus stretch';
  -- Taking away more than there is stops at zero, and its Undo restores it.
  r := probe.track('A', 'T1 ninety minutes', 'adjust', -999999);
  ASSERT (r->>'total_seconds')::int = 0, format('adjust: below zero: %s', r);
  ASSERT (SELECT seconds FROM public.task_time_entries WHERE id = (r->>'entry_id')::uuid) = -5490,
    'adjust: the clamped adjustment';
  r := probe.track('A', 'T1 ninety minutes', 'undo', p_entry => (r->>'entry_id')::uuid);
  ASSERT (r->>'total_seconds')::int = 5490, format('adjust: undo of the clamp: %s', r);
  -- Undo after someone typed 0: the task stays at 0 and doesn't owe time, so
  -- the next focus counts in full and a typed value is reached exactly.
  PERFORM probe.new_task('T11 undo after zero', 'A', 'A');
  r := probe.track('A', 'T11 undo after zero', 'adjust', 900, 'ada-t11-long-01');
  longer := (r->>'entry_id')::uuid;
  PERFORM probe.track('B', 'T11 undo after zero', 'set_total', 0);
  r := probe.track('A', 'T11 undo after zero', 'undo', p_entry => longer);
  ASSERT r->>'status' = 'saved' AND (r->>'total_seconds')::int = 0, format('undo after a zero: %s', r);
  ASSERT public.tasks_time__sum(probe.id('T11 undo after zero')) = 0, 'undo after a zero: the task owes time';
  ASSERT NOT EXISTS (SELECT 1 FROM public.task_time_entries
                     WHERE task_id = probe.id('T11 undo after zero') AND kind = 'adjustment' AND seconds > 0
                       AND user_id IS NOT NULL),
    'undo after a zero: the evening-out entry is someone''s to undo';
  r := probe.track('A', 'T11 undo after zero', 'focus', 600, 'ada-t11-focus-1');
  ASSERT (r->>'total_seconds')::int = 600, format('undo after a zero: later focus was swallowed: %s', r);
  r := probe.track('B', 'T11 undo after zero', 'set_total', 1200);
  ASSERT (r->>'total_seconds')::int = 1200, format('undo after a zero: a typed value: %s', r);
  ASSERT probe.consistent('T1 ninety minutes') AND probe.consistent('T2 no time yet')
     AND probe.consistent('T11 undo after zero'), 'adjust: totals disagree';
  RAISE NOTICE 'PASS adjust: a typed value is reached exactly; took-longer adds one adjustment and Undo removes exactly that one';
END;
$$;

-- ── 6. Old app versions writing time_spent_seconds (D3-5) ────────────────────
-- Written as Postgres sees them from PostgREST: as the person, through RLS.

BEGIN;
SELECT FROM probe.as_user('A');
SET LOCAL ROLE authenticated;
-- A build from TV-D1…TV-F1 saves its new total with a narrow update.
UPDATE public.tasks SET time_spent_seconds = 1230, updated_at = now() WHERE id = probe.id('T6 old builds');
RESET ROLE;
COMMIT;
BEGIN;
SELECT FROM probe.as_user('B');
SET LOCAL ROLE authenticated;
-- …and corrects it down in its time field.
UPDATE public.tasks SET time_spent_seconds = 1000 WHERE id = probe.id('T6 old builds');
RESET ROLE;
COMMIT;
DO $$
BEGIN
  ASSERT probe.cached('T6 old builds') = 1000 AND probe.consistent('T6 old builds'), 'shim: T6''s total';
  ASSERT (SELECT array_agg(seconds ORDER BY seconds DESC) FROM public.task_time_entries
          WHERE task_id = probe.id('T6 old builds') AND kind = 'adjustment') = ARRAY[30, -230],
    'shim: the adjustments';
  ASSERT (SELECT user_id FROM public.task_time_entries WHERE task_id = probe.id('T6 old builds') AND seconds = 30)
         = probe.id('A'), 'shim: whose adjustment';
  RAISE NOTICE 'PASS shim: an old version''s write of the total becomes the writer''s adjustment, and the total is what it wrote';
END;
$$;

-- A build from before TV-D1 saves every edit as a whole-row upsert carrying
-- its copy of the total. Ada tracks 5 minutes on T7 first.
DO $$ BEGIN PERFORM probe.track('A', 'T7 whole-row saves', 'focus', 300, 'ada-t7-focus-01'); END $$;
BEGIN;
SELECT FROM probe.as_user('B');
SET LOCAL ROLE authenticated;
-- Bea renames it from a copy loaded before Ada's time (1000 s).
INSERT INTO public.tasks (id, workspace_id, bucket_id, title, position, time_spent_seconds, owner_id)
VALUES (probe.id('T7 whole-row saves'), probe.id('W'), probe.id('SB'), 'T7 renamed', 'T7', 1000, probe.id('B'))
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, position = EXCLUDED.position,
  time_spent_seconds = EXCLUDED.time_spent_seconds, owner_id = EXCLUDED.owner_id;
RESET ROLE;
COMMIT;
DO $$
BEGIN
  ASSERT (SELECT title FROM public.tasks WHERE id = probe.id('T7 whole-row saves')) = 'T7 renamed', 'upsert: the rename';
  ASSERT probe.cached('T7 whole-row saves') = 1300 AND probe.consistent('T7 whole-row saves'),
    format('upsert: a stale copy took Ada''s time away (%s)', probe.cached('T7 whole-row saves'));
  ASSERT probe.entries('T7 whole-row saves', 'adjustment') = 0, 'upsert: a stale save left an adjustment';
END;
$$;
BEGIN;
SELECT FROM probe.as_user('B');
SET LOCAL ROLE authenticated;
-- Her old build tracked 2 minutes on top of what it shows (1300 by now).
INSERT INTO public.tasks (id, workspace_id, bucket_id, title, position, time_spent_seconds, owner_id)
VALUES (probe.id('T7 whole-row saves'), probe.id('W'), probe.id('SB'), 'T7 renamed', 'T7', 1420, probe.id('B'))
ON CONFLICT (id) DO UPDATE SET time_spent_seconds = EXCLUDED.time_spent_seconds, owner_id = EXCLUDED.owner_id;
-- Creating a task that already carries time (an old build restoring one).
INSERT INTO public.tasks (id, workspace_id, bucket_id, title, position, time_spent_seconds)
VALUES (probe.id('T10 restored'), probe.id('W'), probe.id('SB'), 'T10 restored', 'T10', 75);
-- A plain update in the same request after an upsert of another task is still plain.
UPDATE public.tasks SET time_spent_seconds = 0 WHERE id = probe.id('T6 old builds');
RESET ROLE;
COMMIT;
DO $$
BEGIN
  ASSERT probe.cached('T7 whole-row saves') = 1420 AND probe.consistent('T7 whole-row saves'), 'upsert: an increase was lost';
  ASSERT (SELECT seconds FROM public.task_time_entries WHERE task_id = probe.id('T7 whole-row saves') AND kind = 'adjustment')
         = 120, 'upsert: the increase isn''t Bea''s adjustment';
  ASSERT probe.cached('T10 restored') = 75 AND probe.consistent('T10 restored')
         AND (SELECT user_id FROM public.task_time_entries WHERE task_id = probe.id('T10 restored')) = probe.id('B'),
    'create: time on a new task isn''t its creator''s adjustment';
  ASSERT probe.cached('T6 old builds') = 0 AND probe.consistent('T6 old builds'), 'plain: lowering to zero';
  RAISE NOTICE 'PASS upsert: a stale whole-row save never takes time away; an increase from one is kept; new tasks keep their time';
END;
$$;

-- ── 7. Tasks that are gone, trashed, or someone else's ───────────────────────

DO $$
DECLARE
  r jsonb;
BEGIN
  -- In the trash: still takes its time (Undo brings the task back with it).
  r := probe.track('A', 'T3 trashed', 'focus', 60, 'ada-trashed-001');
  ASSERT r->>'status' = 'saved' AND (r->>'total_seconds')::int = 660, format('trash: %s', r);
  -- Nowhere: gone, with nothing written.
  r := probe.track('A', 'no such task', 'focus', 60, 'ada-nowhere-001');
  ASSERT r->>'status' = 'gone', format('gone: a missing task: %s', r);
  -- Bea's private task: Ada can't tell it from a missing one.
  r := probe.track('A', 'T4 Bea private', 'focus', 60, 'ada-private-001');
  ASSERT r->>'status' = 'gone' AND r - 'task_id' = '{"status": "gone"}'::jsonb, format('gone: a private task: %s', r);
  ASSERT probe.entries('T4 Bea private') = 1, 'gone: wrote to a task Ada can''t see';
  -- Another workspace's task, named under this one.
  r := probe.track('A', 'T5 Nell''s', 'focus', 60, 'ada-elsewhere-1');
  ASSERT r->>'status' = 'gone', format('gone: another workspace: %s', r);
  -- Deleted for good: its entries go with it.
  PERFORM probe.track('A', 'T8 deleted for good', 'focus', 60, 'ada-t8-focus-01');
  DELETE FROM public.tasks WHERE id = probe.id('T8 deleted for good');
  ASSERT probe.entries('T8 deleted for good') = 0, 'gone: entries outlived their task';
  r := probe.track('A', 'T8 deleted for good', 'focus', 60, 'ada-t8-focus-02');
  ASSERT r->>'status' = 'gone', format('gone: a deleted task: %s', r);
  RAISE NOTICE 'PASS gone: trashed tasks keep taking time; missing, unshared or foreign tasks answer gone and write nothing';
END;
$$;

-- ── 8. Who may write ────────────────────────────────────────────────────────

DO $$
DECLARE
  r jsonb;
BEGIN
  ASSERT probe.error_of_as('V', format('SELECT public.tasks_op_track_time(%L, %L, ''focus'', 60)',
           probe.id('W'), probe.id('T2 no time yet'))) = 'You don''t have edit access to Tasks in this workspace.',
    'who: a viewer tracked time';
  ASSERT probe.error_of_as('N', format('SELECT public.tasks_op_track_time(%L, %L, ''focus'', 60)',
           probe.id('W'), probe.id('T2 no time yet'))) = 'You don''t have edit access to Tasks in this workspace.',
    'who: an outsider tracked time';
  PERFORM probe.as_system();
  ASSERT probe.error_of(format('SELECT public.tasks_op_track_time(%L, %L, ''focus'', 60)',
           probe.id('W'), probe.id('T2 no time yet'))) = 'Tracked time belongs to a person: sign in, or use an API key.',
    'who: system work tracked time';
  -- Bea shares her private task with Ada as view-only: Ada sees it, can't log on it.
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (probe.id('W'), 'task', probe.id('T4 Bea private'), 'member', probe.id('A'), 'view', probe.id('B'));
  ASSERT probe.error_of_as('A', format('SELECT public.tasks_op_track_time(%L, %L, ''focus'', 60)',
           probe.id('W'), probe.id('T4 Bea private'))) = 'You don''t have access to this task.',
    'who: view-only access tracked time';
  DELETE FROM public.resource_grants WHERE resource_type = 'task' AND resource_id = probe.id('T4 Bea private');
  -- An API key's time is its creator's.
  r := probe.track('K', 'T2 no time yet', 'focus', 45, 'key-agent-00001');
  ASSERT r->>'status' = 'saved'
     AND (SELECT user_id FROM public.task_time_entries WHERE client_key = 'key-agent-00001') = probe.id('A'),
    format('who: the key''s time isn''t Ada''s: %s', r);
  -- Bad input.
  ASSERT probe.error_of_as('A', format('SELECT public.tasks_op_track_time(%L, %L, ''sleep'', 60)',
           probe.id('W'), probe.id('T2 no time yet'))) LIKE 'Unknown time action%', 'who: an unknown action';
  ASSERT probe.error_of_as('A', format('SELECT public.tasks_op_track_time(%L, %L, ''focus'', 0)',
           probe.id('W'), probe.id('T2 no time yet'))) LIKE 'A tracked stretch%', 'who: a zero stretch';
  ASSERT probe.error_of_as('A', format('SELECT public.tasks_op_track_time(%L, %L, ''set_total'', -5)',
           probe.id('W'), probe.id('T2 no time yet'))) LIKE 'The total can''t be negative%', 'who: a negative total';
  RAISE NOTICE 'PASS who: only people who can edit the task log time on it; a key logs as its creator; bad input is refused';
END;
$$;

-- ── 9. Waiting time and "this week" ──────────────────────────────────────────

DO $$
DECLARE
  r jsonb;
  t record;
BEGIN
  r := probe.track('A', 'T2 no time yet', 'waiting', 3600, 'ada-waiting-001');
  ASSERT (r->>'total_seconds')::int = 1905 AND (r->>'my_waiting_seconds')::int = 3600,
    format('waiting: counted as focus: %s', r);
  ASSERT probe.consistent('T2 no time yet'), 'waiting: totals disagree';
  -- A stretch that ended last month isn't this week's; legacy time never is.
  PERFORM probe.track('A', 'T1 ninety minutes', 'focus', 600, 'ada-lastmonth01', p_ended => now() - interval '30 days');
  SELECT * INTO t FROM probe.totals('A', now() - interval '7 days')
    AS x(task_id uuid, total integer, mine integer, waiting integer, since integer)
  WHERE x.task_id = probe.id('T1 ninety minutes');
  ASSERT t.total = 6090 AND t.mine = 690 AND t.since = 90,
    format('week: T1 total %s, mine %s, this week %s', t.total, t.mine, t.since);
  RAISE NOTICE 'PASS week: waiting time is kept apart from focus; legacy and old stretches stay out of "since" sums';
END;
$$;

-- ── 10. Leaving: a deleted account's time stays in the total, unnamed ────────

DO $$
DECLARE
  r jsonb;
BEGIN
  r := probe.track('X', 'T9 Xavier works', 'focus', 240, 'xavier-0000001');
  ASSERT (r->>'total_seconds')::int = 240, format('leave: %s', r);
  DELETE FROM public.workspace_members WHERE workspace_id = probe.id('W') AND user_id = probe.id('X');
  ASSERT probe.cached('T9 Xavier works') = 240, 'leave: leaving the workspace took the time';
  DELETE FROM auth.users WHERE id = probe.id('X');
  DELETE FROM public.profiles WHERE id = probe.id('X');
  ASSERT (SELECT user_id FROM public.task_time_entries WHERE client_key = 'xavier-0000001') IS NULL,
    'leave: a deleted account is still named on its time';
  ASSERT probe.cached('T9 Xavier works') = 240 AND probe.consistent('T9 Xavier works'), 'leave: the total changed';
  RAISE NOTICE 'PASS leave: leaving keeps the time; deleting the account keeps the seconds and forgets whose they were';
END;
$$;

-- ── 11. Grants ───────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  ASSERT probe.error_of('SELECT count(*) FROM public.task_time_entries') LIKE 'permission denied%', 'anon: read entries';
END;
$$;
RESET ROLE;
COMMIT;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'tasks_op_track_time(uuid, uuid, text, integer, timestamptz, text, uuid)',
    'tasks_time_totals(uuid, timestamptz)'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE'), 'grants: anon can call ' || fn;
    ASSERT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE'), 'grants: authenticated can''t call ' || fn;
    ASSERT has_function_privilege('service_role', 'public.' || fn, 'EXECUTE'), 'grants: service_role can''t call ' || fn;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'tasks_time__sum(uuid)', 'tasks_time__total(uuid)', 'tasks_time__mine(uuid, uuid)', 'tasks_time__store_total(uuid)',
    'tasks_time__answer(uuid, uuid, text, uuid)', 'tasks_time_legacy()', 'tasks_time_legacy_created()'
  ] LOOP
    ASSERT NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE'), 'grants: anon can call ' || fn;
    ASSERT NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE'), 'grants: authenticated can call ' || fn;
  END LOOP;
  ASSERT NOT has_table_privilege('anon', 'public.task_time_entries', 'SELECT'), 'grants: anon reads entries';
  ASSERT NOT has_table_privilege('anon', 'public.task_time_entries', 'TRUNCATE'), 'grants: anon truncates entries';
  ASSERT NOT has_table_privilege('authenticated', 'public.task_time_entries', 'INSERT'), 'grants: authenticated inserts';
  ASSERT NOT has_table_privilege('authenticated', 'public.task_time_entries', 'UPDATE'), 'grants: authenticated updates';
  ASSERT NOT has_table_privilege('authenticated', 'public.task_time_entries', 'TRUNCATE'), 'grants: authenticated truncates';
  RAISE NOTICE 'PASS grants: the op and totals for signed-in users and the connector only; helpers closed; no direct writes';
END;
$$;

DO $$ BEGIN RAISE NOTICE 'PASS: all'; END $$;
