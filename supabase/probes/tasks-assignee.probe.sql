-- Probe for supabase/migrations/20261008150000_tasks_assignee_creator.sql
-- (TV-D1, specs/tasks-v2.md block 3). Run it on a throwaway Postgres 17
-- database that holds nothing else, after the stub, the seed and the
-- migration:
--
--   createdb -h /tmp -p 54341 -U postgres d1_probe
--   psql -h /tmp -p 54341 -U postgres -d d1_probe -v ON_ERROR_STOP=1 -q \
--     -f supabase/probes/tasks-assignee.stub.sql \
--     -f supabase/probes/tasks-assignee.seed.sql \
--     -f supabase/migrations/20261008150000_tasks_assignee_creator.sql \
--     -f supabase/probes/tasks-assignee.probe.sql
--
-- Every check stops the run with the failing check's message. A clean run
-- prints one PASS line per check and ends with "PASS: all".
--
-- Most checks run as the database owner with a signed-in user's JWT claims
-- set (auth.uid() reads them), which is how the triggers and ops see a real
-- request. The ones about roles, RLS and grants switch to authenticated,
-- anon or service_role for real.

GRANT USAGE ON SCHEMA probe TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA probe TO anon, authenticated, service_role;

-- Request context: a signed-in user, an API key, or nobody (system work).
CREATE FUNCTION probe.as_user(p_name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', probe.id(p_name), 'role', 'authenticated')::text, true);
  PERFORM set_config('request.headers', '{}', true);
END;
$$;
CREATE FUNCTION probe.as_key(p_key text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-moduo-key-id', probe.id(p_key))::text, true);
END;
$$;
CREATE FUNCTION probe.as_system() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.headers', '{}', true);
END;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA probe TO anon, authenticated, service_role;

CREATE FUNCTION probe.activity(p_op text, p_task text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.module_activity WHERE op = p_op AND entity_id = probe.id(p_task)
$$;
CREATE FUNCTION probe.last_activity(p_op text, p_task text) RETURNS public.module_activity
LANGUAGE sql STABLE AS $$
  SELECT a.* FROM public.module_activity a
  WHERE a.op = p_op AND a.entity_id = probe.id(p_task)
  ORDER BY a.created_at DESC, a.id DESC LIMIT 1
$$;
-- One transaction stamps every row with the same created_at, so find a
-- comment's activity row by its text, not by "latest".
CREATE FUNCTION probe.comment_notify(p_task text, p_body text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT a.payload -> 'notify_user_ids' FROM public.module_activity a
  WHERE a.op = 'comments.add' AND a.entity_id = probe.id(p_task) AND a.payload ->> 'excerpt' = p_body
$$;
-- Rows that reach a bell (they name someone in mentioned_user_ids).
CREATE FUNCTION probe.notified(p_op text, p_task text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM public.module_activity
  WHERE op = p_op AND entity_id = probe.id(p_task) AND payload ? 'mentioned_user_ids'
$$;
CREATE FUNCTION probe.last_notified(p_op text, p_task text) RETURNS public.module_activity
LANGUAGE sql STABLE AS $$
  SELECT a.* FROM public.module_activity a
  WHERE a.op = p_op AND a.entity_id = probe.id(p_task) AND a.payload ? 'mentioned_user_ids'
  ORDER BY a.created_at DESC, a.id DESC LIMIT 1
$$;
-- A jsonb array of ids as a sorted text array, to compare as a set.
CREATE FUNCTION probe.ids(p jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM jsonb_array_elements_text(p) x
$$;
CREATE FUNCTION probe.names_to_ids(p_names text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(probe.id(n)::text ORDER BY probe.id(n)::text), '{}') FROM unnest(p_names) n
$$;
CREATE FUNCTION probe.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT t.* FROM public.tasks t WHERE t.id = probe.id(p_name)
$$;
-- A task the current-client way: assignee_id sent explicitly (NULL = Unassigned).
CREATE FUNCTION probe.new_task(p_name text, p_assignee text, p_bucket text DEFAULT 'SB') RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.tasks (id, workspace_id, bucket_id, assignee_id, title)
  VALUES (probe.id(p_name), probe.id('W'), probe.id(p_bucket),
          CASE WHEN p_assignee IS NULL THEN NULL ELSE probe.id(p_assignee) END, p_name);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA probe TO anon, authenticated, service_role;

-- ── 1. Backfill ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      -- task,                 assignee, creator, creator unknown
      ('T1 self',              'A',  'A',  false),
      ('T2 made for B',        'B',  'A',  false),
      ('T3 reassigned',        'B',  'B',  true),
      ('T4 made then moved',   'O',  'A',  false),
      ('T5 unassigned',        NULL, NULL, true),
      -- An assignee whose account is gone can't be kept (foreign key): Unassigned.
      ('T5b ghost owner',      NULL, 'ghost', false),
      ('T6 deleted',           'A',  'A',  false),
      ('T7 blocker',           'A',  'A',  false),
      ('T8 blocked',           'B',  'A',  false),
      ('T9 private for B',     'B',  'A',  false),
      ('T10 by R for A',       'A',  'R',  false),
      ('T11 by A for R',       'R',  'A',  false),
      ('T12 by A for X',       'X',  'A',  false),
      ('T13 by X for A',       'A',  'X',  false)
    ) AS v(task, assignee, creator, unknown)
  LOOP
    ASSERT (probe.task(r.task)).assignee_id IS NOT DISTINCT FROM
             (CASE WHEN r.assignee IS NULL THEN NULL ELSE probe.id(r.assignee) END),
      format('backfill: %s should be assigned to %s', r.task, coalesce(r.assignee, 'nobody'));
    ASSERT (probe.task(r.task)).owner_id IS NOT DISTINCT FROM
             (CASE WHEN r.creator IS NULL THEN NULL ELSE probe.id(r.creator) END),
      format('backfill: %s should have creator %s', r.task, coalesce(r.creator, 'NULL'));
    ASSERT (probe.task(r.task)).creator_unknown = r.unknown,
      format('backfill: %s creator_unknown should be %s', r.task, r.unknown);
  END LOOP;
  ASSERT (SELECT count(*) FROM public.module_activity) = (SELECT activity FROM probe.before),
    'backfill: it logged activity';
  ASSERT (SELECT count(*) FROM public.resource_grants WHERE resource_type = 'task')
         = (SELECT task_grants FROM probe.before), 'backfill: it created or removed task grants';
  ASSERT NOT EXISTS (SELECT 1 FROM public.tasks
                     WHERE assignee_id = '00000000-0000-0000-0000-000000000000'::uuid),
    'backfill: the placeholder was stored';
  ASSERT (SELECT column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'assignee_id')
         LIKE '''00000000-0000-0000-0000-000000000000''::uuid%', 'the assignee_id default is the placeholder';
  RAISE NOTICE 'PASS backfill: assignees from owner_id; creators recovered from insert rows; T3/T5 unknown; no side effects';
END;
$$;

-- ── 2. Old builds (owner_id = assignee) and the fixed creator (D1-3, D1-7) ───

-- 2a. An old build reassigns T1 to Bea: its whole-row upsert (PostgREST's
-- INSERT … ON CONFLICT DO UPDATE), as the authenticated role through RLS.
BEGIN;
SELECT probe.as_user('A') \gset
SET LOCAL ROLE authenticated;
INSERT INTO public.tasks AS t (id, workspace_id, owner_id, bucket_id, parent_id, title, description, status,
                               position, created_at, updated_at, deleted_at, time_spent_seconds,
                               reschedule_count, committed_for, commit_order)
VALUES (probe.id('T1 self'), probe.id('W'), probe.id('B'), probe.id('SB'), NULL, 'T1 self', '', 'todo',
        '', '2026-10-01 10:00:00+00', now(), NULL, 0, 0, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  workspace_id = EXCLUDED.workspace_id, owner_id = EXCLUDED.owner_id, bucket_id = EXCLUDED.bucket_id,
  parent_id = EXCLUDED.parent_id, title = EXCLUDED.title, description = EXCLUDED.description,
  status = EXCLUDED.status, position = EXCLUDED.position, created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at, deleted_at = EXCLUDED.deleted_at,
  time_spent_seconds = EXCLUDED.time_spent_seconds, reschedule_count = EXCLUDED.reschedule_count,
  committed_for = EXCLUDED.committed_for, commit_order = EXCLUDED.commit_order;
RESET ROLE;
DO $$
BEGIN
  ASSERT (probe.task('T1 self')).assignee_id = probe.id('B'), '2a: the old build''s owner_id write didn''t assign Bea';
  ASSERT (probe.task('T1 self')).owner_id = probe.id('A'), '2a: the creator changed';
  ASSERT probe.notified('tasks.assigned', 'T1 self') = 1, '2a: expected one assigned notification';
  ASSERT (probe.last_notified('tasks.assigned', 'T1 self')).payload -> 'mentioned_user_ids'
         = jsonb_build_array(probe.id('B')::text), '2a: the notification doesn''t target Bea';
  ASSERT (probe.last_notified('tasks.assigned', 'T1 self')).actor_id = probe.id('A'), '2a: wrong actor';
  ASSERT (probe.last_notified('tasks.assigned', 'T1 self')).payload ->> 'from' = probe.id('A')::text,
    '2a: the trail row doesn''t say who had it before';
  RAISE NOTICE 'PASS D1-7 old build reassigns: lands on assignee_id, creator kept, one notification';
END;
$$;
COMMIT;

-- 2b. An old build edits T2's title. It read owner_id (now the creator, Ada)
-- and sends it back: nothing about the assignment changes.
BEGIN;
SELECT probe.as_user('B') \gset
SET LOCAL ROLE authenticated;
INSERT INTO public.tasks (id, workspace_id, owner_id, bucket_id, title, status, created_at, updated_at)
VALUES (probe.id('T2 made for B'), probe.id('W'), probe.id('A'), probe.id('SB'), 'T2 renamed', 'todo',
        '2026-10-01 11:00:00+00', now())
ON CONFLICT (id) DO UPDATE SET
  workspace_id = EXCLUDED.workspace_id, owner_id = EXCLUDED.owner_id, bucket_id = EXCLUDED.bucket_id,
  title = EXCLUDED.title, status = EXCLUDED.status, created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at;
RESET ROLE;
DO $$
BEGIN
  ASSERT (probe.task('T2 made for B')).title = 'T2 renamed', '2b: the edit didn''t land';
  ASSERT (probe.task('T2 made for B')).assignee_id = probe.id('B'), '2b: the assignee changed';
  ASSERT (probe.task('T2 made for B')).owner_id = probe.id('A'), '2b: the creator changed';
  ASSERT probe.activity('tasks.assigned', 'T2 made for B') = 1, '2b: an edit logged an assignment';
  RAISE NOTICE 'PASS D1-7 old build edits: other fields untouched, no notification';
END;
$$;
COMMIT;

-- 2c. Old builds create tasks: for someone else (owner_id = Bea) and for
-- themselves. Neither sends assignee_id.
BEGIN;
SELECT probe.as_user('A') \gset
SET LOCAL ROLE authenticated;
INSERT INTO public.tasks (id, workspace_id, owner_id, bucket_id, title)
VALUES (probe.id('T14 old create for B'), probe.id('W'), probe.id('B'), probe.id('SB'), 'T14'),
       (probe.id('T15 old create self'), probe.id('W'), probe.id('A'), probe.id('SB'), 'T15');
RESET ROLE;
DO $$
BEGIN
  ASSERT (probe.task('T14 old create for B')).assignee_id = probe.id('B'), '2c: not assigned to Bea';
  ASSERT (probe.task('T14 old create for B')).owner_id = probe.id('A'), '2c: the creator isn''t Ada';
  ASSERT probe.notified('tasks.assigned', 'T14 old create for B') = 1, '2c: expected one notification';
  ASSERT (probe.task('T15 old create self')).assignee_id = probe.id('A'), '2c: self-create not assigned to Ada';
  ASSERT (probe.task('T15 old create self')).owner_id = probe.id('A'), '2c: self-create creator';
  ASSERT probe.activity('tasks.assigned', 'T15 old create self') = 0, '2c: self-create notified';
  ASSERT NOT (probe.task('T14 old create for B')).creator_unknown, '2c: creator marked unknown';
  RAISE NOTICE 'PASS D1-7 old build creates: creator = who created it, assignee = old owner_id';
END;
$$;
COMMIT;

-- 2d. Nobody can change the creator: a direct owner_id write is read as an
-- old build's reassignment, and creator_unknown is the server's.
DO $$
BEGIN
  PERFORM probe.as_user('A');
  UPDATE public.tasks SET owner_id = probe.id('O') WHERE id = probe.id('T13 by X for A');
  UPDATE public.tasks SET creator_unknown = true WHERE id = probe.id('T13 by X for A');
  ASSERT (probe.task('T13 by X for A')).owner_id = probe.id('X'), '2d: the creator changed';
  ASSERT (probe.task('T13 by X for A')).assignee_id = probe.id('O'), '2d: the owner_id write wasn''t an assignment';
  ASSERT NOT (probe.task('T13 by X for A')).creator_unknown, '2d: a client set creator_unknown';
  -- A current client that sends both: its assignee_id wins, owner_id is ignored.
  UPDATE public.tasks SET owner_id = probe.id('B'), assignee_id = probe.id('A')
  WHERE id = probe.id('T13 by X for A');
  ASSERT (probe.task('T13 by X for A')).owner_id = probe.id('X'), '2d: the creator changed (both)';
  ASSERT (probe.task('T13 by X for A')).assignee_id = probe.id('A'), '2d: explicit assignee_id lost';
  -- An insert can't name someone else as the creator.
  INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, assignee_id, title)
  VALUES (probe.id('T16 forged creator'), probe.id('W'), probe.id('SB'), probe.id('O'), NULL, 'T16');
  ASSERT (probe.task('T16 forged creator')).owner_id = probe.id('A'), '2d: an insert set another creator';
  RAISE NOTICE 'PASS D1-3 the creator can''t be changed by edits, inserts or old builds';
END;
$$;

-- 2e. A creator who became a viewer doesn't freeze their tasks: the assignee
-- check runs only when the assignee is set.
DO $$
BEGIN
  PERFORM probe.as_system();
  UPDATE public.workspace_members SET role = 'viewer', perms = probe.perms(ARRAY['view'])
  WHERE workspace_id = probe.id('W') AND user_id = probe.id('R');
  PERFORM probe.as_user('A');
  -- An old build's whole-row save sends the creator (Rex) back in owner_id.
  INSERT INTO public.tasks (id, workspace_id, owner_id, bucket_id, title, created_at, updated_at)
  VALUES (probe.id('T10 by R for A'), probe.id('W'), probe.id('R'), probe.id('SB'), 'T10 renamed',
          '2026-10-01 18:00:00+00', now())
  ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, title = EXCLUDED.title,
                                 updated_at = EXCLUDED.updated_at;
  UPDATE public.tasks SET priority = 'high' WHERE id = probe.id('T10 by R for A');
  ASSERT (probe.task('T10 by R for A')).title = 'T10 renamed', '2e: the old build''s edit failed';
  ASSERT (probe.task('T10 by R for A')).priority = 'high', '2e: a field edit failed';
  ASSERT (probe.task('T10 by R for A')).assignee_id = probe.id('A'), '2e: the assignee changed';
  PERFORM probe.as_system();
  UPDATE public.workspace_members SET role = 'member', perms = probe.perms(ARRAY['view', 'create', 'edit', 'delete'])
  WHERE workspace_id = probe.id('W') AND user_id = probe.id('R');
  RAISE NOTICE 'PASS a creator who became a viewer doesn''t freeze the task';
END;
$$;

-- 2h. An old build reassigning to a viewer is refused: the shim maps owner_id
-- to assignee_id before perm_enforce_write checks it (trigger name order).
DO $$
DECLARE v_msg text;
BEGIN
  PERFORM probe.as_user('A');
  BEGIN
    INSERT INTO public.tasks (id, workspace_id, owner_id, bucket_id, title)
    VALUES (probe.id('T2 made for B'), probe.id('W'), probe.id('V'), probe.id('SB'), 'T2 renamed')
    ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, title = EXCLUDED.title;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  ASSERT v_msg = 'Viewers can''t be assigned tasks.', '2h: an old build assigned a viewer: ' || coalesce(v_msg, 'no error');
  ASSERT (probe.task('T2 made for B')).assignee_id = probe.id('B'), '2h: the refused write changed the task';
  RAISE NOTICE 'PASS D1-7 an old build can''t assign a viewer either (the shim runs first)';
END;
$$;

-- 2f. Current clients create with assignee_id: Unassigned, or someone.
DO $$
BEGIN
  PERFORM probe.as_user('A');
  PERFORM probe.new_task('T17 unassigned', NULL);
  PERFORM probe.new_task('T18 for B', 'B');
  ASSERT (probe.task('T17 unassigned')).assignee_id IS NULL, '2f: Unassigned didn''t stick';
  ASSERT (probe.task('T17 unassigned')).owner_id = probe.id('A'), '2f: creator';
  ASSERT probe.activity('tasks.assigned', 'T17 unassigned') = 0, '2f: Unassigned notified';
  ASSERT (probe.task('T18 for B')).assignee_id = probe.id('B'), '2f: explicit assignee';
  ASSERT probe.notified('tasks.assigned', 'T18 for B') = 1, '2f: expected one notification';
  RAISE NOTICE 'PASS D1-2 a task can be created Unassigned, or for someone';
END;
$$;

-- 2g. Maintenance can opt out of the creator lock for one transaction.
DO $$
BEGIN
  PERFORM probe.as_system();
  PERFORM set_config('tasks.creator_write', '1', true);
  UPDATE public.tasks SET owner_id = probe.id('O') WHERE id = probe.id('T16 forged creator');
  ASSERT (probe.task('T16 forged creator')).owner_id = probe.id('O'), '2g: the opt-out didn''t work';
  RAISE NOTICE 'PASS maintenance opt-out (tasks.creator_write)';
END;
$$;

-- ── 3. tasks_op_assign (D1-2, D1-4) ──────────────────────────────────────────

DO $$
DECLARE
  t public.tasks;
  v_msg text;
BEGIN
  PERFORM probe.as_user('A');
  t := public.tasks_op_assign(probe.id('W'), probe.id('T7 blocker'), probe.id('B'));
  ASSERT t.assignee_id = probe.id('B'), '3: not assigned';
  ASSERT t.owner_id = probe.id('A'), '3: the creator changed';
  ASSERT probe.notified('tasks.assigned', 'T7 blocker') = 1, '3: expected exactly one notification';
  ASSERT (probe.last_notified('tasks.assigned', 'T7 blocker')).payload -> 'mentioned_user_ids'
         = jsonb_build_array(probe.id('B')::text), '3: the notification doesn''t target Bea';
  -- Assigning the same person again changes nothing and logs nothing.
  t := public.tasks_op_assign(probe.id('W'), probe.id('T7 blocker'), probe.id('B'));
  ASSERT probe.activity('tasks.assigned', 'T7 blocker') = 1, '3: a no-op assignment logged';
  -- …also when that person can no longer be assigned (a no-op isn't checked).
  PERFORM probe.as_system();
  UPDATE public.workspace_members SET perms = probe.perms(ARRAY['view'])
  WHERE workspace_id = probe.id('W') AND user_id = probe.id('B');
  PERFORM probe.as_user('A');
  t := public.tasks_op_assign(probe.id('W'), probe.id('T7 blocker'), probe.id('B'));
  ASSERT t.assignee_id = probe.id('B'), '3: a no-op to a now-viewer changed the task';
  PERFORM probe.as_system();
  UPDATE public.workspace_members SET perms = probe.perms(ARRAY['view', 'create', 'edit', 'delete'])
  WHERE workspace_id = probe.id('W') AND user_id = probe.id('B');
  PERFORM probe.as_user('A');

  v_msg := NULL;
  BEGIN
    PERFORM public.tasks_op_assign(probe.id('W'), probe.id('T7 blocker'), probe.id('V'));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  ASSERT v_msg = 'Viewers can''t be assigned tasks.', '3: a viewer was assignable: ' || coalesce(v_msg, 'no error');

  v_msg := NULL;
  BEGIN
    PERFORM public.tasks_op_assign(probe.id('W'), probe.id('T7 blocker'), probe.id('N'));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  ASSERT v_msg = 'That person isn''t a member of this workspace.',
    '3: a non-member was assignable: ' || coalesce(v_msg, 'no error');

  -- Unassign: in the trail, nobody notified.
  t := public.tasks_op_assign(probe.id('W'), probe.id('T7 blocker'), NULL);
  ASSERT t.assignee_id IS NULL, '3: not unassigned';
  ASSERT probe.notified('tasks.assigned', 'T7 blocker') = 1, '3: unassigning notified';
  ASSERT probe.activity('tasks.assigned', 'T7 blocker') = 2, '3: unassigning left no trail row';
  ASSERT EXISTS (SELECT 1 FROM public.module_activity a
                 WHERE a.op = 'tasks.assigned' AND a.entity_id = probe.id('T7 blocker')
                   AND a.payload -> 'to' = 'null'::jsonb AND a.payload ->> 'from' = probe.id('B')::text
                   AND a.actor_id = probe.id('A')), '3: the unassign row isn''t attributed';
  -- Self-assignment: in the trail ("took this"), nobody notified (D1-4).
  t := public.tasks_op_assign(probe.id('W'), probe.id('T7 blocker'), probe.id('A'));
  ASSERT t.assignee_id = probe.id('A'), '3: self-assignment';
  ASSERT probe.notified('tasks.assigned', 'T7 blocker') = 1, '3: self-assignment notified';
  ASSERT EXISTS (SELECT 1 FROM public.module_activity a
                 WHERE a.op = 'tasks.assigned' AND a.entity_id = probe.id('T7 blocker')
                   AND (a.payload ->> 'self')::boolean), '3: the self-assignment left no trail row';

  -- A viewer can't assign.
  PERFORM probe.as_user('V');
  v_msg := NULL;
  BEGIN
    PERFORM public.tasks_op_assign(probe.id('W'), probe.id('T7 blocker'), probe.id('V'));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  ASSERT v_msg = 'You don''t have edit access to Tasks in this workspace.',
    '3: a viewer could assign: ' || coalesce(v_msg, 'no error');
  -- Someone outside the workspace can't.
  PERFORM probe.as_user('N');
  v_msg := NULL;
  BEGIN
    PERFORM public.tasks_op_assign(probe.id('W'), probe.id('T7 blocker'), probe.id('N'));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  ASSERT v_msg IS NOT NULL, '3: an outsider could assign';
  ASSERT (probe.task('T7 blocker')).assignee_id = probe.id('A'), '3: a refused call changed the task';
  RAISE NOTICE 'PASS D1-2/D1-4 tasks_op_assign: members who can work on tasks; one notification; self and unassign silent';
END;
$$;

-- 3b. Assigning someone who can't see the bucket gives them access to the
-- task, through the op and through an old build's owner_id write.
DO $$
BEGIN
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_assign(probe.id('W'), probe.id('T9 private for B'), probe.id('R'));
  ASSERT EXISTS (SELECT 1 FROM public.resource_grants
                 WHERE resource_type = 'task' AND resource_id = probe.id('T9 private for B')
                   AND subject_id = probe.id('R') AND level = 'edit'), '3b: no grant for Rex via the op';
  ASSERT public.can_access('task', probe.id('T9 private for B'), 'edit', probe.id('R')), '3b: Rex can''t edit it';
  -- The old build's way: whole-row save naming owner_id only.
  INSERT INTO public.tasks (id, workspace_id, owner_id, bucket_id, title)
  VALUES (probe.id('T9 private for B'), probe.id('W'), probe.id('X'), probe.id('PA'), 'T9 private for B')
  ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, title = EXCLUDED.title;
  ASSERT (probe.task('T9 private for B')).assignee_id = probe.id('X'), '3b: old build didn''t assign Xavier';
  ASSERT EXISTS (SELECT 1 FROM public.resource_grants
                 WHERE resource_type = 'task' AND resource_id = probe.id('T9 private for B')
                   AND subject_id = probe.id('X') AND level = 'edit'), '3b: no grant for Xavier via the old build';
  RAISE NOTICE 'PASS the assignee gets access to a task in a bucket they can''t see (op and old builds)';
END;
$$;

-- 3c. Roles: signed-in users and the service role can call the op; anon can't,
-- and nobody can call the trigger function.
DO $$
BEGIN
  ASSERT has_function_privilege('authenticated', 'public.tasks_op_assign(uuid, uuid, uuid)', 'EXECUTE'), '3c: authenticated';
  ASSERT has_function_privilege('service_role', 'public.tasks_op_assign(uuid, uuid, uuid)', 'EXECUTE'), '3c: service_role';
  ASSERT NOT has_function_privilege('anon', 'public.tasks_op_assign(uuid, uuid, uuid)', 'EXECUTE'), '3c: anon can assign';
  ASSERT NOT has_function_privilege('anon', 'public.tasks_assignee_and_creator()', 'EXECUTE'), '3c: anon trigger fn';
  ASSERT NOT has_function_privilege('authenticated', 'public.tasks_assignee_and_creator()', 'EXECUTE'), '3c: authenticated trigger fn';
  RAISE NOTICE 'PASS grants: tasks_op_assign for authenticated + service_role only';
END;
$$;
BEGIN;
SELECT probe.as_user('A') \gset
SET LOCAL ROLE authenticated;
SELECT (public.tasks_op_assign(probe.id('W'), probe.id('T15 old create self'), probe.id('B'))).assignee_id
  = probe.id('B') AS assigned_as_authenticated \gset
RESET ROLE;
COMMIT;
DO $$ BEGIN
  ASSERT (probe.task('T15 old create self')).assignee_id = probe.id('B'), '3c: the authenticated role couldn''t assign';
  RAISE NOTICE 'PASS the authenticated role runs tasks_op_assign end to end (RLS, revoked helpers)';
END $$;

-- 3d. A no-op assignment still needs access to the task (the row goes back to
-- the caller), and a create for someone else says it came from nobody.
DO $$
DECLARE
  v_msg text;
  a public.module_activity;
BEGIN
  PERFORM probe.as_user('A');
  PERFORM probe.new_task('T20 Ada private', 'A', 'PA');
  PERFORM probe.as_user('B');
  BEGIN
    PERFORM public.tasks_op_assign(probe.id('W'), probe.id('T20 Ada private'), probe.id('A'));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  ASSERT v_msg = 'You don''t have access to this task.',
    '3d: a no-op returned a task Bea can''t see: ' || coalesce(v_msg, 'no error');

  PERFORM probe.as_user('A');
  PERFORM probe.new_task('T21 Ada for Bea', 'B');
  a := probe.last_notified('tasks.assigned', 'T21 Ada for Bea');
  ASSERT a.payload ? 'from' AND a.payload -> 'from' = 'null'::jsonb, '3d: a create''s row has no from: null';
  ASSERT a.payload ->> 'to' = probe.id('B')::text AND NOT (a.payload ->> 'self')::boolean, '3d: create row to/self';
  RAISE NOTICE 'PASS a no-op assignment checks access; assignment rows always carry from/to';
END;
$$;

-- ── 4. MCP: an API key acts as its creator (D1-9 server side) ────────────────

BEGIN;
SELECT probe.as_key('K') \gset
SET LOCAL ROLE service_role;
SELECT (public.tasks_op_assign(probe.id('W'), probe.id('T17 unassigned'), probe.id('A'))).assignee_id IS NOT NULL AS k1 \gset
SELECT (public.tasks_op_assign(probe.id('W'), probe.id('T17 unassigned'), probe.id('B'))).assignee_id IS NOT NULL AS k2 \gset
RESET ROLE;
DO $$
BEGIN
  ASSERT (probe.task('T17 unassigned')).assignee_id = probe.id('B'), '4: the key couldn''t assign';
  ASSERT probe.notified('tasks.assigned', 'T17 unassigned') = 1,
    '4: expected one notification (the key assigning its own creator is silent)';
  ASSERT (probe.last_notified('tasks.assigned', 'T17 unassigned')).actor_type = 'api_key', '4: not attributed to the key';
  ASSERT (probe.last_notified('tasks.assigned', 'T17 unassigned')).payload -> 'mentioned_user_ids'
         = jsonb_build_array(probe.id('B')::text), '4: wrong target';
  ASSERT NOT EXISTS (SELECT 1 FROM public.module_activity a
                     WHERE a.op = 'tasks.assigned' AND a.entity_id = probe.id('T17 unassigned')
                       AND a.actor_type <> 'api_key'), '4: a key write was attributed to someone else';
  -- The key handing the task to its creator is an assignment in the trail,
  -- not "took this".
  ASSERT EXISTS (SELECT 1 FROM public.module_activity a
                 WHERE a.op = 'tasks.assigned' AND a.entity_id = probe.id('T17 unassigned')
                   AND a.payload ->> 'to' = probe.id('A')::text
                   AND NOT (a.payload ->> 'self')::boolean), '4: the key''s assignment of its creator reads as self';
  RAISE NOTICE 'PASS API key: assigns with the same check; assigning its creator is silent; attributed to the key';
END;
$$;
COMMIT;
DO $$
DECLARE v_msg text;
BEGIN
  PERFORM probe.as_key('K');
  BEGIN
    PERFORM public.tasks_op_assign(probe.id('W'), probe.id('T17 unassigned'), probe.id('V'));
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  ASSERT v_msg = 'Viewers can''t be assigned tasks.', '4: the key assigned a viewer: ' || coalesce(v_msg, 'no error');
  RAISE NOTICE 'PASS API key: the membership check applies';
END;
$$;

-- ── 5. Completed by someone else → the creator (D1-5) ────────────────────────

DO $$
BEGIN
  -- T8: made by Ada for Bea; Bea completes it.
  PERFORM probe.as_user('B');
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T8 blocked'), 'done', NULL, NULL);
  ASSERT probe.activity('tasks.completed', 'T8 blocked') = 1, '5: expected one completed notification';
  ASSERT (probe.last_activity('tasks.completed', 'T8 blocked')).payload -> 'mentioned_user_ids'
         = jsonb_build_array(probe.id('A')::text), '5: it doesn''t target the creator';
  ASSERT (probe.last_activity('tasks.completed', 'T8 blocked')).actor_id = probe.id('B'), '5: wrong actor';
  -- Saving it as done again doesn't repeat it.
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T8 blocked'), 'done', NULL, NULL);
  ASSERT probe.activity('tasks.completed', 'T8 blocked') = 1, '5: a re-save notified again';
  -- A repeating task: nobody (Maciej, 2026-10-08).
  PERFORM probe.as_user('A');
  PERFORM probe.new_task('T22 daily for Bea', 'B');
  UPDATE public.tasks SET recurrence = '{"freq": "daily"}'::jsonb WHERE id = probe.id('T22 daily for Bea');
  PERFORM probe.as_user('B');
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T22 daily for Bea'), 'done', NULL, NULL);
  ASSERT (probe.task('T22 daily for Bea')).status = 'done', '5: the repeating task wasn''t completed';
  ASSERT probe.activity('tasks.completed', 'T22 daily for Bea') = 0, '5: a repeating task notified its creator';
  -- The creator completing their own task: nothing.
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T13 by X for A'), 'done', NULL, NULL);
  ASSERT probe.activity('tasks.completed', 'T13 by X for A') = 1, '5: Xavier wasn''t told about T13';
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T15 old create self'), 'done', NULL, NULL);
  ASSERT probe.activity('tasks.completed', 'T15 old create self') = 0, '5: the creator was told about their own completion';
  -- Unknown creator: nobody.
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T3 reassigned'), 'done', NULL, NULL);
  ASSERT probe.activity('tasks.completed', 'T3 reassigned') = 0, '5: an unknown creator was notified';
  -- Archiving isn't completing.
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T18 for B'), 'archived', NULL, NULL);
  ASSERT probe.activity('tasks.completed', 'T18 for B') = 0, '5: archiving notified';
  RAISE NOTICE 'PASS D1-5 completing a one-off task someone else created tells the creator once; repeating tasks don''t';
END;
$$;

-- 5b. An old build completes T2 (made by Ada for Bea) with a whole-row save.
BEGIN;
SELECT probe.as_user('B') \gset
SET LOCAL ROLE authenticated;
INSERT INTO public.tasks (id, workspace_id, owner_id, bucket_id, title, status)
VALUES (probe.id('T2 made for B'), probe.id('W'), probe.id('A'), probe.id('SB'), 'T2 renamed', 'done')
ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, title = EXCLUDED.title, status = EXCLUDED.status;
RESET ROLE;
DO $$
BEGIN
  ASSERT probe.activity('tasks.completed', 'T2 made for B') = 1, '5b: the old build''s completion didn''t notify';
  ASSERT (probe.task('T2 made for B')).assignee_id = probe.id('B'), '5b: the assignee changed';
  RAISE NOTICE 'PASS D1-5 an old build''s completion notifies the creator too';
END;
$$;
COMMIT;

-- 5c. It reaches Ada's bell, not Bea's.
DO $$
BEGIN
  PERFORM probe.as_user('A');
  ASSERT EXISTS (SELECT 1 FROM public.notifications_list(probe.id('W'), 200) n
                 WHERE n.op = 'tasks.completed' AND n.entity_id = probe.id('T8 blocked')), '5c: not in Ada''s bell';
  PERFORM probe.as_user('B');
  ASSERT NOT EXISTS (SELECT 1 FROM public.notifications_list(probe.id('W'), 200) n
                     WHERE n.op = 'tasks.completed'), '5c: Bea sees her own completion';
  ASSERT EXISTS (SELECT 1 FROM public.notifications_list(probe.id('W'), 200) n
                 WHERE n.op = 'tasks.assigned' AND n.entity_id = probe.id('T1 self')), '5c: Bea''s assignment missing';
  RAISE NOTICE 'PASS the bell: completed → creator, assigned → assignee';
END;
$$;

-- 5d. A creator who can no longer see the task hears nothing about it: T9
-- lives in Ada's private bucket; make its creator Bea (maintenance opt-out)
-- with no grant, and let Xavier (its assignee) complete it.
DO $$
BEGIN
  PERFORM probe.as_system();
  PERFORM set_config('tasks.creator_write', '1', true);
  UPDATE public.tasks SET owner_id = probe.id('B') WHERE id = probe.id('T9 private for B');
  DELETE FROM public.resource_grants
  WHERE resource_type = 'task' AND resource_id = probe.id('T9 private for B') AND subject_id = probe.id('B');
  ASSERT NOT public.can_access('task', probe.id('T9 private for B'), 'view', probe.id('B')), '5d: setup — Bea can still see T9';
  PERFORM probe.as_user('X');
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T9 private for B'), 'done', NULL, NULL);
  ASSERT probe.activity('tasks.completed', 'T9 private for B') = 0, '5d: a creator who can''t see the task was told';
  PERFORM probe.as_user('A');
  PERFORM public.comments_op_add(probe.id('W'), 'task', probe.id('T9 private for B'), 'Private', '{}');
  ASSERT NOT probe.ids(probe.comment_notify('T9 private for B', 'Private')) @> ARRAY[probe.id('B')::text],
    '5d: a creator who can''t see the task got a comment notification';
  -- Put T9 back as it was for the later checks.
  PERFORM probe.as_system();
  PERFORM set_config('tasks.creator_write', '1', true);
  UPDATE public.tasks SET owner_id = probe.id('A'), status = 'todo' WHERE id = probe.id('T9 private for B');
  RAISE NOTICE 'PASS a creator who can no longer see a task gets no completed/comment notifications about it';
END;
$$;

-- ── 6. Unblocked: the assignee, else the creator; comments: both (D1-6) ──────

DO $$
DECLARE
  v_notify jsonb;
BEGIN
  PERFORM probe.as_user('A');
  PERFORM probe.new_task('T19 blocker', 'A');
  PERFORM probe.new_task('T20 blocked, B', 'B');
  PERFORM probe.new_task('T21 blocker', 'A');
  PERFORM probe.new_task('T22 blocked, nobody', NULL);
  PERFORM probe.new_task('T23 blocker', 'A');
  INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id) VALUES
    (probe.id('W'), probe.id('T19 blocker'), probe.id('T20 blocked, B')),
    (probe.id('W'), probe.id('T21 blocker'), probe.id('T22 blocked, nobody')),
    (probe.id('W'), probe.id('T23 blocker'), probe.id('T5 unassigned'));
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T19 blocker'), 'done', NULL, NULL);
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T21 blocker'), 'done', NULL, NULL);
  PERFORM public.tasks_op_set_status(probe.id('W'), probe.id('T23 blocker'), 'done', NULL, NULL);
  ASSERT (probe.last_activity('tasks.unblocked', 'T20 blocked, B')).payload -> 'notify_user_ids'
         = jsonb_build_array(probe.id('B')::text), '6: unblocked didn''t go to the assignee';
  ASSERT (probe.last_activity('tasks.unblocked', 'T22 blocked, nobody')).payload -> 'notify_user_ids'
         = jsonb_build_array(probe.id('A')::text), '6: unblocked didn''t fall back to the creator';
  ASSERT probe.activity('tasks.unblocked', 'T5 unassigned') = 0, '6: unassigned + unknown creator notified someone';

  -- Comments: the assignee (Bea) plus earlier commenters, minus the author.
  PERFORM probe.as_user('O');
  PERFORM public.comments_op_add(probe.id('W'), 'task', probe.id('T20 blocked, B'), 'First', '{}');
  v_notify := probe.comment_notify('T20 blocked, B', 'First');
  ASSERT probe.ids(v_notify) = probe.names_to_ids(ARRAY['A', 'B']),
    '6: a comment should reach the assignee and the creator: ' || v_notify::text;
  PERFORM public.comments_op_add(probe.id('W'), 'task', probe.id('T22 blocked, nobody'), 'Hm', '{}');
  v_notify := probe.comment_notify('T22 blocked, nobody', 'Hm');
  ASSERT probe.ids(v_notify) = probe.names_to_ids(ARRAY['A']), '6: an unassigned task''s comment didn''t go to the creator';
  PERFORM probe.as_user('B');
  PERFORM public.comments_op_add(probe.id('W'), 'task', probe.id('T20 blocked, B'), 'Reply', '{}');
  v_notify := probe.comment_notify('T20 blocked, B', 'Reply');
  ASSERT probe.ids(v_notify) = probe.names_to_ids(ARRAY['A', 'O']),
    '6: the reply should reach the creator and the earlier commenter, not its author: ' || v_notify::text;
  RAISE NOTICE 'PASS D1-6 unblocked → assignee, else creator; comments → assignee + creator + earlier commenters, never the author';
END;
$$;

-- ── 7. PRIV-2a on the new model ──────────────────────────────────────────────

-- 7a. Removing Rex unassigns what's assigned to him; what he created stays
-- assigned and keeps him as the creator.
DO $$
BEGIN
  PERFORM probe.as_user('O');
  DELETE FROM public.workspace_members WHERE workspace_id = probe.id('W') AND user_id = probe.id('R');
  ASSERT (probe.task('T11 by A for R')).assignee_id IS NULL, '7a: Rex''s task is still assigned to him';
  ASSERT (probe.task('T11 by A for R')).owner_id = probe.id('A'), '7a: the creator changed';
  ASSERT (probe.task('T10 by R for A')).assignee_id = probe.id('A'), '7a: Ada lost a task Rex created';
  ASSERT (probe.task('T10 by R for A')).owner_id = probe.id('R'), '7a: Rex is no longer the creator';
  ASSERT (probe.task('T9 private for B')).assignee_id = probe.id('X'), '7a: someone else was unassigned';
  ASSERT probe.activity('tasks.assigned', 'T11 by A for R') = 1, '7a: removal wrote trail rows';
  RAISE NOTICE 'PASS PRIV-2 AC9 on assignee_id: removal unassigns, created-by stays';
END;
$$;

-- 7b. Deleting Xavier's account: the preview and the run unassign by
-- assignee_id. T9 (in Ada's private bucket) and T12 are assigned to him; T13
-- he created.
DO $$
DECLARE
  v jsonb;
BEGIN
  PERFORM probe.as_system();
  v := public.account_erase_workspace_data(probe.id('X'), true);
  ASSERT (v ->> 'tasks_unassigned')::int = 2, '7b: preview counted ' || coalesce(v ->> 'tasks_unassigned', 'NULL');
  v := public.account_erase_workspace_data(probe.id('X'), false);
  ASSERT (probe.task('T12 by A for X')).assignee_id IS NULL, '7b: T12 still assigned to Xavier';
  ASSERT (probe.task('T9 private for B')).assignee_id IS NULL, '7b: T9 still assigned to Xavier';
  ASSERT (probe.task('T13 by X for A')).assignee_id = probe.id('A'), '7b: Ada lost the task Xavier created';
  ASSERT (probe.task('T13 by X for A')).owner_id = probe.id('X'), '7b: the creator changed';
  RAISE NOTICE 'PASS PRIV-2a erasure on assignee_id: assigned → unassigned, created-by stays';
END;
$$;

-- 7c. The account delete itself: the profile goes, and every task still
-- assigned to it is unassigned by the foreign key.
DO $$
BEGIN
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_assign(probe.id('W'), probe.id('T20 blocked, B'), probe.id('X'));
  PERFORM probe.as_system();
  DELETE FROM auth.users WHERE id = probe.id('X');
  ASSERT (probe.task('T20 blocked, B')).assignee_id IS NULL, '7c: the FK didn''t unassign';
  ASSERT (probe.task('T13 by X for A')).owner_id = probe.id('X'), '7c: the creator id was dropped';
  RAISE NOTICE 'PASS deleting an account unassigns its tasks everywhere';
END;
$$;

-- ── 8. The placeholder default can't be stored ───────────────────────────────

DO $$
DECLARE v_msg text;
BEGIN
  PERFORM probe.as_system();
  ALTER TABLE public.tasks DISABLE TRIGGER assignee_and_creator_insert;
  BEGIN
    INSERT INTO public.tasks (workspace_id, bucket_id, title) VALUES (probe.id('W'), probe.id('SB'), 'no trigger');
  EXCEPTION WHEN check_violation THEN v_msg := SQLERRM;
  END;
  ALTER TABLE public.tasks ENABLE TRIGGER assignee_and_creator_insert;
  ASSERT v_msg LIKE '%tasks_assignee_not_placeholder%', '8: the placeholder could be stored: ' || coalesce(v_msg, 'inserted');
  RAISE NOTICE 'PASS the placeholder default never lands in a row';
END;
$$;

DO $$ BEGIN RAISE NOTICE 'PASS: all'; END $$;
