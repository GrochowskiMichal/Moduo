-- Data that exists before 20261008150000_tasks_assignee_creator.sql runs, for
-- supabase/probes/tasks-assignee.probe.sql (TV-D1). Run between the stub and
-- the migration (the probe's header has the command). Everything here is
-- written the old way: owner_id is the assignee, and the DF-9 activity rows
-- are the only record of who created a task for someone else.

CREATE SCHEMA probe;

-- People: O owns workspace W; A, B, R and X are members who can work on
-- tasks; V is a viewer; N has an account but isn't in W. K is an API key A
-- created. Everything else is named.
CREATE FUNCTION probe.id(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'O' THEN '00000000-0000-4000-8000-000000000001'
    WHEN 'A' THEN '00000000-0000-4000-8000-000000000002'
    WHEN 'B' THEN '00000000-0000-4000-8000-000000000003'
    WHEN 'V' THEN '00000000-0000-4000-8000-000000000004'
    WHEN 'N' THEN '00000000-0000-4000-8000-000000000005'
    WHEN 'R' THEN '00000000-0000-4000-8000-000000000006'
    WHEN 'X' THEN '00000000-0000-4000-8000-000000000007'
    WHEN 'K' THEN '00000000-0000-4000-8000-000000000100'
    ELSE md5('probe:' || p_name)::text
  END::uuid
$$;

CREATE FUNCTION probe.perms(p_actions text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_agg(m || '.' || a)
  FROM unnest(ARRAY['notes', 'tasks', 'contacts', 'calendar', 'chat']) AS m, unnest(p_actions) AS a
$$;

INSERT INTO auth.users (id, email)
SELECT probe.id(n), lower(n) || '@example.com' FROM unnest(ARRAY['O', 'A', 'B', 'V', 'N', 'R', 'X']) AS n;
INSERT INTO public.profiles (id, display_name) VALUES
  (probe.id('O'), 'Olga'), (probe.id('A'), 'Ada'), (probe.id('B'), 'Bea'), (probe.id('V'), 'Vera'),
  (probe.id('N'), 'Nell'), (probe.id('R'), 'Rex'), (probe.id('X'), 'Xavier');

INSERT INTO public.workspaces (id, name, owner_id) VALUES
  (probe.id('W'), 'Team', probe.id('O')),
  (probe.id('WN'), 'Nell''s', probe.id('N'));
INSERT INTO public.workspace_members (workspace_id, user_id, role, perms, joined_at) VALUES
  (probe.id('W'), probe.id('O'), 'owner', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-01'),
  (probe.id('W'), probe.id('A'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-02'),
  (probe.id('W'), probe.id('B'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-03'),
  (probe.id('W'), probe.id('R'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-04'),
  (probe.id('W'), probe.id('X'), 'member', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-05'),
  (probe.id('W'), probe.id('V'), 'viewer', probe.perms(ARRAY['view']), '2026-01-06'),
  (probe.id('WN'), probe.id('N'), 'owner', probe.perms(ARRAY['view', 'create', 'edit', 'delete']), '2026-01-01');

INSERT INTO public.workspace_api_keys (id, workspace_id, name, created_by, scopes) VALUES
  (probe.id('K'), probe.id('W'), 'Ada''s agent', probe.id('A'), '{"tasks": "edit"}');

-- SB is shared with the workspace (edit, the default share_bucket_after
-- grants); PA is Ada's private bucket.
INSERT INTO public.buckets (id, workspace_id, owner_id, name) VALUES
  (probe.id('SB'), probe.id('W'), probe.id('O'), 'Shared'),
  (probe.id('PA'), probe.id('W'), probe.id('A'), 'Ada private');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = probe.id('PA');

-- Tasks the old way (owner_id = assignee), with the DF-9 rows production has.
CREATE FUNCTION probe.old_task(p_name text, p_bucket text, p_owner text, p_created timestamptz)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, created_at, updated_at)
  VALUES (probe.id(p_name), probe.id('W'), probe.id(p_bucket),
          CASE WHEN p_owner IS NULL THEN NULL ELSE probe.id(p_owner) END,
          p_name, p_created, p_created);
$$;
CREATE FUNCTION probe.old_assigned(p_task text, p_actor text, p_to text, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.module_activity
    (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload, created_at)
  VALUES (probe.id('W'), 'tasks', 'task', probe.id(p_task), 'tasks.assigned', 'user', probe.id(p_actor),
          p_actor, jsonb_build_object('mentioned_user_ids', jsonb_build_array(probe.id(p_to)::text),
                                      'title', p_task), p_at);
$$;

DO $$
BEGIN
  -- Made by Ada for herself; never reassigned.
  PERFORM probe.old_task('T1 self', 'SB', 'A', '2026-10-01 10:00:00+00');
  -- Made by Ada for Bea (the insert's row, 0.8 s after created_at).
  PERFORM probe.old_task('T2 made for B', 'SB', 'B', '2026-10-01 11:00:00+00');
  PERFORM probe.old_assigned('T2 made for B', 'A', 'B', '2026-10-01 11:00:00.8+00');
  -- Made by someone for themselves, reassigned to Bea by Olga 10 minutes later:
  -- the creator can't be told.
  PERFORM probe.old_task('T3 reassigned', 'SB', 'B', '2026-10-01 12:00:00+00');
  PERFORM probe.old_assigned('T3 reassigned', 'O', 'B', '2026-10-01 12:10:00+00');
  -- Made by Ada for Bea, then given to Olga by Bea.
  PERFORM probe.old_task('T4 made then moved', 'SB', 'O', '2026-10-01 13:00:00+00');
  PERFORM probe.old_assigned('T4 made then moved', 'A', 'B', '2026-10-01 13:00:01+00');
  PERFORM probe.old_assigned('T4 made then moved', 'B', 'O', '2026-10-01 15:00:00+00');
  -- Unassigned by PRIV-2a (owner NULL).
  PERFORM probe.old_task('T5 unassigned', 'SB', NULL, '2026-10-01 14:00:00+00');
  -- Owned by an account that's gone (no profile; owner_id has no foreign key).
  PERFORM probe.old_task('T5b ghost owner', 'SB', 'ghost', '2026-10-01 14:10:00+00');
  -- In the trash.
  PERFORM probe.old_task('T6 deleted', 'SB', 'A', '2026-10-01 14:30:00+00');
  UPDATE public.tasks SET deleted_at = '2026-10-02 00:00:00+00' WHERE id = probe.id('T6 deleted');
  -- T7 blocks T8, which Ada made for Bea.
  PERFORM probe.old_task('T7 blocker', 'SB', 'A', '2026-10-01 16:00:00+00');
  PERFORM probe.old_task('T8 blocked', 'SB', 'B', '2026-10-01 16:01:00+00');
  PERFORM probe.old_assigned('T8 blocked', 'A', 'B', '2026-10-01 16:01:00.5+00');
  INSERT INTO public.task_relations (workspace_id, blocker_task_id, blocked_task_id)
  VALUES (probe.id('W'), probe.id('T7 blocker'), probe.id('T8 blocked'));
  -- In Ada's private bucket, made by Ada for Bea: Bea got an edit grant from the
  -- old share_task_assign (the seed ran it, keyed on owner_id).
  PERFORM probe.old_task('T9 private for B', 'PA', 'B', '2026-10-01 17:00:00+00');
  PERFORM probe.old_assigned('T9 private for B', 'A', 'B', '2026-10-01 17:00:00.3+00');
  -- Made by Rex for Ada; made by Ada for Rex.
  PERFORM probe.old_task('T10 by R for A', 'SB', 'A', '2026-10-01 18:00:00+00');
  PERFORM probe.old_assigned('T10 by R for A', 'R', 'A', '2026-10-01 18:00:00.4+00');
  PERFORM probe.old_task('T11 by A for R', 'SB', 'R', '2026-10-01 18:30:00+00');
  PERFORM probe.old_assigned('T11 by A for R', 'A', 'R', '2026-10-01 18:30:00.4+00');
  -- Made by Ada for Xavier; made by Xavier for Ada.
  PERFORM probe.old_task('T12 by A for X', 'SB', 'X', '2026-10-01 19:00:00+00');
  PERFORM probe.old_assigned('T12 by A for X', 'A', 'X', '2026-10-01 19:00:00.4+00');
  PERFORM probe.old_task('T13 by X for A', 'SB', 'A', '2026-10-01 19:30:00+00');
  PERFORM probe.old_assigned('T13 by X for A', 'X', 'A', '2026-10-01 19:30:00.4+00');
END;
$$;

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.tasks) = 14, 'seed: 14 tasks';
  ASSERT EXISTS (SELECT 1 FROM public.resource_grants
                 WHERE resource_type = 'bucket' AND resource_id = probe.id('SB')
                   AND subject_type = 'workspace' AND level = 'edit'), 'seed: SB is shared';
  ASSERT NOT EXISTS (SELECT 1 FROM public.resource_grants
                     WHERE resource_type = 'bucket' AND resource_id = probe.id('PA')), 'seed: PA is private';
  ASSERT EXISTS (SELECT 1 FROM public.resource_grants
                 WHERE resource_type = 'task' AND resource_id = probe.id('T9 private for B')
                   AND subject_id = probe.id('B') AND level = 'edit'),
    'seed: the old share_task_assign gave Bea a grant on T9';
END;
$$;

-- What the backfill must leave alone.
CREATE TABLE probe.before AS
SELECT (SELECT count(*) FROM public.module_activity) AS activity,
       (SELECT count(*) FROM public.resource_grants WHERE resource_type = 'task') AS task_grants;
