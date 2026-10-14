-- TV-D12 · Waiting on… clears when it comes in, with one quiet notice
-- (supabase/migrations/20261013110000_notifications_v3.sql §8). specs/tasks-v3.md
-- §13 "Something you were waiting on came in"; AC5.3; decisions "TV-D12".
--
-- Cast: O owns workspace W. E waits on A; M is a member without access to O's
-- private project PB. SB is shared.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'A', 'M']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('M'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');

CREATE FUNCTION test.new_task(p_who text, p_name text, p_project text) RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id(p_project))))
$$;
CREATE FUNCTION test.wait_on(p_who text, p_task text, p_entry jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT * FROM public.tasks_op_waiting_add(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id(p_task), p_entry))
$$;
CREATE FUNCTION test.waiting(p_task text) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM public.task_waiting WHERE task_id = test.id(p_task) AND deleted_at IS NULL
$$;
CREATE FUNCTION test.bell(p_who text) RETURNS integer LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.notifications_list(%L, 200)
    WHERE op = 'tasks.waiting_resolved'$q$, test.id('W')))::integer
$$;

-- ── The person waited on comments ───────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.new_task('E', 'Contract', 'SB');
  r := test.wait_on('E', 'Contract', jsonb_build_object('kind', 'person', 'ref', test.id('A')));
  PERFORM test.ok(test.waiting('Contract') = 1, 'E waits on A', r);
  PERFORM test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Any news?')$q$, test.id('W'), test.id('Contract')));
  PERFORM test.ok(test.waiting('Contract') = 1 AND test.bell('E') = 0, 'someone else''s comment doesn''t clear it');
  PERFORM test.as_user('A', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Signed, attached')$q$, test.id('W'), test.id('Contract')));
  PERFORM test.ok(test.waiting('Contract') = 0, 'A''s comment clears it (AC5.3)');
  PERFORM test.ok(test.bell('E') = 1 AND test.bell('A') = 0 AND test.bell('O') = 0,
    'one quiet notice, to whoever was waiting');
  PERFORM test.ok((SELECT payload ->> 'reason' FROM public.module_activity
                   WHERE op = 'tasks.waiting_resolved' AND entity_id = test.id('Contract')) = 'comment',
    'it says what came in');
END;
$$;

-- ── The email thread waited on gets a newer message ─────────────────────────
DO $$
DECLARE
  v_ref uuid;
BEGIN
  INSERT INTO public.email_accounts (id, workspace_id, owner_id, provider, address)
  VALUES (test.id('acct'), test.id('W'), test.id('E'), 'custom', 'e@example.com');
  INSERT INTO public.email_refs (id, workspace_id, owner_id, account_id, thread_key, from_addr, subject, snippet, sent_at)
  VALUES (test.id('ref'), test.id('W'), test.id('E'), test.id('acct'), 'thread-1', 'anna@client.example', 'Quote', '', now() - interval '2 days');
  PERFORM test.new_task('E', 'Send quote', 'SB');
  PERFORM test.wait_on('E', 'Send quote', jsonb_build_object('kind', 'email', 'ref', test.id('ref')));
  -- E's own follow-up in the thread isn't an answer.
  PERFORM test.as_user('E', format($q$SELECT public.email_op_ref_upsert(%L, 'thread-1', %L, 'm2', 'E@example.com', 'E', '', '', %L)$q$,
    test.id('W'), test.id('acct'), now() + interval '30 seconds'));
  PERFORM test.ok(test.waiting('Send quote') = 1, 'a message E sent doesn''t clear it');
  PERFORM test.as_user('E', format($q$SELECT public.email_op_ref_upsert(%L, 'thread-1', %L, 'm3', 'anna@client.example', 'Anna', '', '', %L)$q$,
    test.id('W'), test.id('acct'), now() + interval '1 minute'));
  PERFORM test.ok(test.waiting('Send quote') = 0 AND test.bell('E') = 2,
    'Anna''s reply in the thread clears it, with a notice to E');
END;
$$;

-- ── Nobody hears about a task they can't see ────────────────────────────────
DO $$
BEGIN
  -- M waits on A on a shared task, then the task moves where M can't see it.
  PERFORM test.new_task('O', 'Moving', 'SB');
  PERFORM test.wait_on('M', 'Moving', jsonb_build_object('kind', 'person', 'ref', test.id('A')));
  UPDATE public.tasks SET bucket_id = test.id('PB') WHERE id = test.id('Moving');
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'task', test.id('Moving'), 'member', test.id('A'), 'edit', test.id('O'));
  PERFORM test.as_user('A', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Done')$q$, test.id('W'), test.id('Moving')));
  PERFORM test.ok(test.waiting('Moving') = 0 AND test.bell('M') = 0,
    'the entry clears, but someone who can no longer see the task hears nothing');
END;
$$;
