-- Purging a task that a teammate's focus time holds (CALR-6 validator finding).
-- calendar_events.focus_task_id has no foreign key: ON DELETE SET NULL would run
-- perm_enforce_write as the purger, who can't edit O's event, and fail the purge.
-- (supabase/migrations/20261027230000_calendar_event_data_v2.sql)
--
-- Cast: O owns W, M is a member; T is M's task in M's project P, shared with O at Edit.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W'), test.id('M'), 'member') ON CONFLICT DO NOTHING;
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES (test.id('P'), test.id('W'), test.id('M'), 'Shared', false);
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('P'), 'member', test.id('O'), 'edit', test.id('M'));
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status) VALUES (test.id('T'), test.id('W'), test.id('P'), test.id('M'), 'Deck', 'todo');
DO $$
DECLARE r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L, p_title => 'Focus', p_starts_at => '2026-11-03 10:00+00', p_ends_at => '2026-11-03 11:00+00', p_kind => 'focus', p_focus_task_id => %L)$q$, test.id('W'), test.id('T')));
  PERFORM test.ok(r = 'ok 1', 'O made focus time on M''s task', r);
  UPDATE public.tasks SET deleted_at = now() WHERE id = test.id('T');
  r := test.as_user('M', format($q$SELECT public.tasks_op_trash_purge(%L, 'task', %L)$q$, test.id('W'), test.id('T')));
  PERFORM test.ok(r LIKE 'ok%', 'M can purge their own task even though O''s focus time holds it', r);
END $$;
