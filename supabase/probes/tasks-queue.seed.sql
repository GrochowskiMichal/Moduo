-- Data that exists before 20261008171500_tasks_personal_queue.sql runs, for
-- supabase/probes/tasks-queue.probe.sql (TV-D2). Written the way production
-- wrote it until now: the day's queue is tasks.committed_for/commit_order,
-- shared by the workspace, and tasks_op_commit logs who committed.

-- Production runs in UTC; "today" in the backfill is current_date.
SET timezone = 'UTC';

CREATE SCHEMA probe;

-- People: O owns workspace W; A and B are members who can work on tasks; V is
-- a viewer; X is a member who leaves; N has an account but isn't in W. K is an
-- API key A created. Everything else is named.
CREATE FUNCTION probe.id(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'O' THEN '00000000-0000-4000-8000-000000000001'
    WHEN 'A' THEN '00000000-0000-4000-8000-000000000002'
    WHEN 'B' THEN '00000000-0000-4000-8000-000000000003'
    WHEN 'V' THEN '00000000-0000-4000-8000-000000000004'
    WHEN 'N' THEN '00000000-0000-4000-8000-000000000005'
    WHEN 'X' THEN '00000000-0000-4000-8000-000000000007'
    WHEN 'K' THEN '00000000-0000-4000-8000-000000000100'
    ELSE md5('probe:' || p_name)::text
  END::uuid
$$;

CREATE FUNCTION probe.perms(p_actions text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_agg(m || '.' || a)
  FROM unnest(ARRAY['notes', 'tasks', 'contacts', 'calendar', 'chat']) AS m, unnest(p_actions) AS a
$$;

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

INSERT INTO auth.users (id, email)
SELECT probe.id(n), lower(n) || '@example.com' FROM unnest(ARRAY['O', 'A', 'B', 'V', 'N', 'X']) AS n;
INSERT INTO public.profiles (id, display_name) VALUES
  (probe.id('O'), 'Olga'), (probe.id('A'), 'Ada'), (probe.id('B'), 'Bea'), (probe.id('V'), 'Vera'),
  (probe.id('N'), 'Nell'), (probe.id('X'), 'Xavier');

INSERT INTO public.workspaces (id, name, owner_id) VALUES
  (probe.id('W'), 'Team', probe.id('O')),
  (probe.id('WN'), 'Nell''s', probe.id('N'));
INSERT INTO public.workspace_members (workspace_id, user_id, role, perms, joined_at) VALUES
  (probe.id('W'), probe.id('O'), 'owner', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-01'),
  (probe.id('W'), probe.id('A'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-02'),
  (probe.id('W'), probe.id('B'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-03'),
  (probe.id('W'), probe.id('X'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-05'),
  (probe.id('W'), probe.id('V'), 'viewer', probe.perms(ARRAY['view']), '2026-01-06'),
  (probe.id('WN'), probe.id('N'), 'owner', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-01');

INSERT INTO public.workspace_api_keys (id, workspace_id, name, created_by, scopes) VALUES
  (probe.id('K'), probe.id('W'), 'Ada''s agent', probe.id('A'), '{"tasks": "edit"}');

-- SB and SB2 are shared with the workspace (share_bucket_after grants edit);
-- PB is Bea's private bucket; NB is Nell's in her own workspace.
INSERT INTO public.buckets (id, workspace_id, owner_id, name) VALUES
  (probe.id('SB'), probe.id('W'), probe.id('O'), 'Shared'),
  (probe.id('SB2'), probe.id('W'), probe.id('O'), 'Shared 2'),
  (probe.id('PB'), probe.id('W'), probe.id('B'), 'Bea private'),
  (probe.id('NB'), probe.id('WN'), probe.id('N'), 'Nell''s');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = probe.id('PB');

-- A task the current-client way (assignee sent explicitly), written by p_by.
CREATE FUNCTION probe.task(p_name text) RETURNS public.tasks LANGUAGE sql STABLE AS $$
  SELECT t.* FROM public.tasks t WHERE t.id = probe.id(p_name)
$$;
CREATE FUNCTION probe.new_task(p_name text, p_by text, p_assignee text, p_bucket text DEFAULT 'SB',
                               p_ws text DEFAULT 'W') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM probe.as_user(p_by);
  INSERT INTO public.tasks (id, workspace_id, bucket_id, assignee_id, title, position)
  VALUES (probe.id(p_name), probe.id(p_ws), probe.id(p_bucket),
          CASE WHEN p_assignee IS NULL THEN NULL ELSE probe.id(p_assignee) END, p_name, p_name);
  PERFORM probe.as_system();
END;
$$;

-- ── The day's commits, the old way ───────────────────────────────────────────
DO $$
BEGIN
  PERFORM probe.new_task('C1 Ada commits', 'A', 'A');
  PERFORM probe.new_task('C2 Bea commits', 'B', 'B');
  PERFORM probe.new_task('C3 key commits', 'A', 'A');
  PERFORM probe.new_task('C4 nobody logged', 'A', 'B');
  PERFORM probe.new_task('C5 done', 'A', 'A');
  PERFORM probe.new_task('C6 last week', 'A', 'A');
  PERFORM probe.new_task('C7 deleted', 'A', 'A');
  PERFORM probe.new_task('C8 Ada then Bea', 'A', 'A');
  PERFORM probe.new_task('C9 by Nell', 'A', NULL);
  PERFORM probe.new_task('C10 tomorrow', 'B', 'B');
  PERFORM probe.new_task('C11 yesterday', 'A', 'A');
  PERFORM probe.new_task('C12 Nell for Olga', 'A', 'O');

  -- Ada commits C1, then the key (Ada's) commits C3, through the old op.
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('C1 Ada commits'), current_date);
  PERFORM probe.as_user('B');
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('C2 Bea commits'), current_date);
  PERFORM probe.as_key('K');
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('C3 key commits'), current_date);
  -- C8: Ada committed it, then Bea recommitted it (Bea's commit is the latest).
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('C8 Ada then Bea'), current_date);
  PERFORM probe.as_user('B');
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('C8 Ada then Bea'), current_date);
  -- C10: committed by Bea for the latest date that is today anywhere (UTC+14),
  -- last in that day's order.
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('C10 tomorrow'),
                                 ((now() AT TIME ZONE 'UTC') + interval '14 hours')::date);
  -- C11: committed by Ada for the day before the earliest "today" (UTC-12).
  PERFORM probe.as_user('A');
  PERFORM public.tasks_op_commit(probe.id('W'), probe.id('C11 yesterday'),
                                 ((now() AT TIME ZONE 'UTC') - interval '12 hours')::date - 1);
  PERFORM probe.as_system();
  UPDATE public.tasks SET commit_order = 99 WHERE id = probe.id('C10 tomorrow');
  -- One transaction stamps every row with the same created_at; in production
  -- each commit is its own request. Ada's commit of C8 came first.
  UPDATE public.module_activity SET created_at = created_at - interval '1 minute'
  WHERE op = 'tasks.commit' AND entity_id = probe.id('C8 Ada then Bea') AND actor_id = probe.id('A');

  -- C4: written straight to the columns (an old capture-into-today), no log:
  -- it falls back to its assignee, Bea.
  UPDATE public.tasks SET committed_for = current_date, commit_order = 5
  WHERE id = probe.id('C4 nobody logged');
  -- C5 done, C6 committed last week, C7 in the trash: none carry over.
  UPDATE public.tasks SET committed_for = current_date, commit_order = 6, status = 'done'
  WHERE id = probe.id('C5 done');
  UPDATE public.tasks SET committed_for = current_date - 7, commit_order = 1
  WHERE id = probe.id('C6 last week');
  UPDATE public.tasks SET committed_for = current_date, commit_order = 7, deleted_at = now()
  WHERE id = probe.id('C7 deleted');
  -- C9: the latest commit is by Nell, who isn't in the workspace, and it has
  -- no assignee: skipped. C12: the same, assigned to Olga: hers.
  UPDATE public.tasks SET committed_for = current_date, commit_order = 8
  WHERE id IN (probe.id('C9 by Nell'), probe.id('C12 Nell for Olga'));
  INSERT INTO public.module_activity (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, payload)
  VALUES (probe.id('W'), 'tasks', 'task', probe.id('C9 by Nell'), 'tasks.commit', 'user', probe.id('N'), '{}'),
         (probe.id('W'), 'tasks', 'task', probe.id('C12 Nell for Olga'), 'tasks.commit', 'user', probe.id('N'), '{}');
END;
$$;

DO $$
BEGIN
  ASSERT (probe.task('C1 Ada commits')).commit_order = 1, 'seed: C1 is first';
  ASSERT (probe.task('C3 key commits')).commit_order = 3, 'seed: C3 is third';
  ASSERT (probe.task('C8 Ada then Bea')).commit_order = 4, 'seed: C8 was recommitted to the end';
  ASSERT (SELECT count(*) FROM public.module_activity
          WHERE op = 'tasks.commit' AND entity_id = probe.id('C3 key commits') AND actor_type = 'api_key') = 1,
    'seed: the key committed C3';
END;
$$;

-- What the migration must leave alone.
CREATE TABLE probe.before AS
SELECT (SELECT count(*) FROM public.module_activity) AS activity,
       (SELECT jsonb_object_agg(id, jsonb_build_array(committed_for, commit_order)) FROM public.tasks) AS commits;
