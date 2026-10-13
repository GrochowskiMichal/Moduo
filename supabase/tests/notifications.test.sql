-- TV-D12 · The notification table, row by row (supabase/migrations/
-- 20261013110000_notifications_v3.sql). specs/tasks-v3.md §13, §2
-- "Reminders"; AC5.7, AC1.7, AC2.4; decisions "TV-D12".
--
-- Cast: O owns workspace W. E and A work on tasks, V is a viewer, M a member
-- without access to O's private project PB. SB is shared, PM is O's project
-- shared with M alone, AR an archived project. Each person has an Inbox.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'A', 'V', 'M', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Moduo Labs'),
  (test.id('W2'), test.id('X'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('E'), 'member'),
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W'), test.id('M'), 'member');
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002'),
  (test.id('PM'), test.id('W'), test.id('O'), 'O and M', false, '0003'),
  (test.id('AR'), test.id('W'), test.id('O'), 'Old', false, '0004'),
  (test.id('IO'), test.id('W'), test.id('O'), 'Inbox', true, 'a0'),
  (test.id('IE'), test.id('W'), test.id('E'), 'Inbox', true, 'a0'),
  (test.id('IA'), test.id('W'), test.id('A'), 'Inbox', true, 'a0'),
  (test.id('IM'), test.id('W'), test.id('M'), 'Inbox', true, 'a0');
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (test.id('PB'), test.id('PM'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('M'), 'edit', test.id('O'));

CREATE FUNCTION test.new_task(p_who text, p_name text, p_project text, p_fields jsonb DEFAULT '{}') RETURNS text
LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id(p_name), 'title', p_name, 'bucket_id', test.id(p_project)) || p_fields))
$$;
-- The notices a person's bell lists of one kind (notifications_list, as them).
CREATE FUNCTION test.bell(p_who text, p_op text) RETURNS integer LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.notifications_list(%L, 200) WHERE op = %L$q$,
    test.id('W'), p_op))::integer
$$;
CREATE FUNCTION test.remind(p_who text, p_task text, p_at timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'at', %L)$q$,
    test.id('W'), test.id(p_task), p_at))
$$;

-- ── Grants, policies, the Realtime publication ──────────────────────────────
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.tasks__fire_reminders(timestamptz, integer)', 'public.notice_deliveries__claim(integer)',
    'public.notice_deliveries__settle(jsonb)', 'public.notice_deliveries__kick()',
    'public.notice_deliveries__authorize(text)', 'public.tasks__notice(uuid, text, uuid, text, jsonb)',
    'public.spine__visible_to(uuid, text, uuid, uuid)'] LOOP
    PERFORM test.ok(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
                AND NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('grants: %s is server-only', v_fn));
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.tasks_op_reminders_restore(uuid, uuid)', 'public.tasks_op_mention(uuid, uuid, uuid[])',
    'public.push_op_subscribe(text, text, text, text)', 'public.push_op_unsubscribe(text)'] LOOP
    PERFORM test.ok(has_function_privilege('authenticated', v_fn, 'EXECUTE')
                AND NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
      format('grants: %s is for signed-in people', v_fn));
  END LOOP;
  PERFORM test.ok(NOT has_table_privilege('authenticated', 'public.notice_deliveries', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.push_subscriptions', 'UPDATE'),
    'grants: people only read deliveries and subscriptions; ops write');
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_publication_tables
                          WHERE pubname = 'supabase_realtime' AND tablename = 'notice_deliveries'),
    'notice_deliveries is published (the desktop app hears its own)');
  PERFORM test.ok((SELECT schedule FROM cron.job WHERE jobname = 'tasks-reminders') = '* * * * *',
    'the reminder sender runs every minute');
END;
$$;

-- ── A reminder you set: delivered, privately, once ──────────────────────────
DO $$
DECLARE
  r text;
  v_n integer;
BEGIN
  PERFORM test.new_task('E', 'Call Anna', 'SB');
  r := test.remind('E', 'Call Anna', now() - interval '1 minute');
  PERFORM test.ok(r = 'ok 1', 'E sets a reminder', r);
  v_n := public.tasks__fire_reminders(now(), 500);
  PERFORM test.ok(v_n = 1, 'the sender delivers it', v_n::text);
  PERFORM test.ok(test.bell('E', 'tasks.reminder') = 1, 'it is in E''s bell');
  PERFORM test.ok(test.bell('A', 'tasks.reminder') = 0 AND test.bell('O', 'tasks.reminder') = 0,
    'and in nobody else''s');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity
                              WHERE entity_type = 'task' AND entity_id = test.id('Call Anna') AND op = 'tasks.reminder'),
    'the task''s trail never shows someone''s reminder (the notice hangs on their own Inbox)');
  PERFORM test.ok(test.value_as('E', format($q$SELECT title FROM public.notice_deliveries WHERE task_id = %L$q$,
                    test.id('Call Anna'))) = 'Call Anna'
              AND test.value_as('A', 'SELECT count(*)::text FROM public.notice_deliveries') = '0',
    'a delivery row names the task for E''s devices; nobody else reads it');
  PERFORM test.ok(public.tasks__fire_reminders(now(), 500) = 0, 'a reminder fires once');
END;
$$;

-- ── Reminders that must not arrive ──────────────────────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  -- An archived project never reminds.
  PERFORM test.new_task('O', 'Old chore', 'AR');
  PERFORM test.remind('O', 'Old chore', now() - interval '1 minute');
  UPDATE public.buckets SET archived_at = now() WHERE id = test.id('AR');
  -- Someone who lost sight of the task.
  PERFORM test.new_task('O', 'Shared with M', 'PM');
  PERFORM test.remind('M', 'Shared with M', now() - interval '1 minute');
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PM');
  -- A finished task.
  PERFORM test.new_task('E', 'Done thing', 'SB');
  PERFORM test.remind('E', 'Done thing', now() - interval '1 minute');
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'done')).status$q$, test.id('W'), test.id('Done thing')));
  -- A passed due date alone.
  PERFORM test.new_task('E', 'Late thing', 'SB', '{"due_on": "2020-01-01"}');
  v_n := public.tasks__fire_reminders(now(), 500);
  PERFORM test.ok(v_n = 0, 'nothing is delivered: archived project, lost access, finished task', v_n::text);
  PERFORM test.ok((SELECT count(*) FROM public.task_reminders
                   WHERE task_id IN (test.id('Old chore'), test.id('Shared with M'), test.id('Done thing'))
                     AND fired_at IS NOT NULL) = 3,
    'and those reminders are retired, not left to fire later');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries WHERE user_id IN (test.id('O'), test.id('M')))
              AND test.bell('M', 'tasks.reminder') = 0,
    'no delivery and no bell for them');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.module_activity
                              WHERE entity_id = test.id('Late thing') AND op NOT IN ('tasks.create')),
    'a passed due date notifies nobody (AC5.7)');
  UPDATE public.buckets SET archived_at = NULL WHERE id = test.id('AR');
END;
$$;

-- ── Backlog and Won't do suspend; the app asks to restore ───────────────────
DO $$
DECLARE
  r text;
  v_n integer;
BEGIN
  PERFORM test.new_task('E', 'Parked', 'SB', jsonb_build_object('due_on', (now() + interval '3 days')::date));
  PERFORM test.remind('E', 'Parked', now() + interval '1 hour');
  PERFORM test.remind('A', 'Parked', now() + interval '2 hours');
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminder_add(%L, %L, 'day_before')$q$, test.id('W'), test.id('Parked')));
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'backlog')).status$q$, test.id('W'), test.id('Parked')));
  PERFORM test.ok((SELECT count(*) FROM public.task_reminders WHERE task_id = test.id('Parked')
                   AND suspended_at IS NOT NULL AND deleted_at IS NULL) = 3,
    'moving a task to Backlog suspends everyone''s reminders on it (AC1.7)');
  v_n := public.tasks__fire_reminders(now() + interval '3 hours', 500);
  PERFORM test.ok(v_n = 0 AND NOT EXISTS (SELECT 1 FROM public.task_reminders
                                          WHERE task_id = test.id('Parked') AND fired_at IS NOT NULL),
    'a suspended reminder never fires', v_n::text);
  r := test.try('E', format($q$SELECT * FROM public.tasks_op_reminders_restore(%L, %L)$q$, test.id('W'), test.id('Parked')));
  PERFORM test.ok(r LIKE '%once the task is To do or In progress%', 'restoring waits for the task to be open again', r);
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'todo')).status$q$, test.id('W'), test.id('Parked')));
  PERFORM test.ok((SELECT count(*) FROM public.task_reminders WHERE task_id = test.id('Parked') AND suspended_at IS NOT NULL) = 3,
    'moving it back to To do doesn''t bring them back by itself');
  r := test.as_user('V', format($q$SELECT * FROM public.tasks_op_reminders_restore(%L, %L)$q$, test.id('W'), test.id('Parked')));
  PERFORM test.ok((SELECT count(*) FROM public.task_reminders WHERE task_id = test.id('Parked') AND suspended_at IS NULL) = 0,
    'a viewer restores only their own (V has none)', r);
  r := test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminders_restore(%L, %L)$q$, test.id('W'), test.id('Parked')));
  PERFORM test.ok((SELECT count(*) FROM public.task_reminders WHERE task_id = test.id('Parked') AND suspended_at IS NULL) = 3,
    'someone who can edit it restores every reminder still ahead', r);
  -- Won't do too; one whose time passed meanwhile stays suspended.
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'wont_do')).status$q$, test.id('W'), test.id('Parked')));
  UPDATE public.task_reminders SET at = now() - interval '1 minute'
  WHERE task_id = test.id('Parked') AND user_id = test.id('A');
  PERFORM test.as_user('E', format($q$SELECT (public.tasks_op_set_status(%L, %L, 'todo')).status$q$, test.id('W'), test.id('Parked')));
  PERFORM test.as_user('E', format($q$SELECT * FROM public.tasks_op_reminders_restore(%L, %L)$q$, test.id('W'), test.id('Parked')));
  PERFORM test.ok((SELECT suspended_at FROM public.task_reminders WHERE task_id = test.id('Parked') AND user_id = test.id('A')) IS NOT NULL
              AND (SELECT count(*) FROM public.task_reminders WHERE task_id = test.id('Parked') AND suspended_at IS NULL) = 2,
    'Won''t do suspends too, and a reminder whose time passed stays suspended');
  -- A reminder set on a parked task starts suspended.
  PERFORM test.new_task('E', 'Someday', 'SB', '{"status": "backlog"}');
  PERFORM test.remind('E', 'Someday', now() + interval '1 hour');
  PERFORM test.ok((SELECT suspended_at FROM public.task_reminders WHERE task_id = test.id('Someday')) IS NOT NULL,
    'a reminder added to a Backlog task starts suspended');
END;
$$;

-- ── Twelve assignments make one notice; every one stays in the trail ────────
DO $$
DECLARE
  v_notice uuid;
  i integer;
BEGIN
  FOR i IN 1 .. 12 LOOP
    PERFORM test.new_task('E', 'Batch ' || i, 'SB');
  END LOOP;
  -- One statement, like a bulk change or an import.
  PERFORM test.as_user('E', format($q$UPDATE public.tasks SET assignee_id = %L WHERE id IN (%s)$q$,
    test.id('A'), (SELECT string_agg(quote_literal(test.id('Batch ' || n)), ',') FROM generate_series(1, 12) n)));
  PERFORM test.ok(test.bell('A', 'tasks.assigned') = 1, 'twelve assignments make one notice (AC5.7)',
    test.bell('A', 'tasks.assigned')::text);
  SELECT ma.id INTO v_notice FROM public.module_activity ma
  WHERE ma.workspace_id = test.id('W') AND ma.op = 'tasks.assigned'
    AND (ma.payload -> 'mentioned_user_ids') @> jsonb_build_array(test.id('A')::text);
  PERFORM test.ok((SELECT (payload ->> 'count')::integer FROM public.module_activity WHERE id = v_notice) = 12
              AND (SELECT jsonb_array_length(payload -> 'task_ids') FROM public.module_activity WHERE id = v_notice) = 12
              AND (SELECT payload ->> 'project_id' FROM public.module_activity WHERE id = v_notice) = test.id('SB')::text,
    'the notice says how many, which tasks and the one project');
  PERFORM test.ok((SELECT count(*) FROM public.module_activity
                   WHERE op = 'tasks.assigned' AND entity_id IN (SELECT test.id('Batch ' || n) FROM generate_series(1, 12) n)) = 12,
    'each task keeps its own trail line');
  -- Once A has read it, the next assignment is a new notice.
  PERFORM test.as_user('A', format($q$SELECT public.notifications_op_mark_read(%L, %L)$q$, test.id('W'), v_notice));
  PERFORM test.new_task('E', 'Batch 13', 'SB');
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('Batch 13'), test.id('A')));
  PERFORM test.ok(test.bell('A', 'tasks.assigned') = 2, 'after A read it, the next assignment notifies again');
  -- Another person's assignments are their own notice.
  PERFORM test.new_task('O', 'From O', 'SB');
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_assign(%L, %L, %L)$q$, test.id('W'), test.id('From O'), test.id('A')));
  PERFORM test.ok(test.bell('A', 'tasks.assigned') = 3, 'someone else''s assignment is its own notice');
END;
$$;

-- ── @person in a task's description ─────────────────────────────────────────
DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.new_task('E', 'Spec review', 'SB');
  r := test.as_user('E', format($q$SELECT public.tasks_op_mention(%L, %L, ARRAY[%L, %L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('Spec review'), test.id('A'), test.id('M'), test.id('E'), test.id('X')));
  PERFORM test.ok(test.bell('A', 'tasks.mentioned') = 1 AND test.bell('M', 'tasks.mentioned') = 1
              AND test.bell('E', 'tasks.mentioned') = 0,
    'an @person in a description notifies the people named who can see the task, never the writer', r);
  PERFORM test.ok((SELECT jsonb_array_length(payload -> 'mentioned_user_ids') FROM public.module_activity
                   WHERE op = 'tasks.mentioned' AND entity_id = test.id('Spec review')) = 2,
    'someone outside the workspace is never named in it');
  PERFORM test.as_user('E', format($q$SELECT public.tasks_op_mention(%L, %L, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('Spec review'), test.id('A')));
  PERFORM test.ok(test.bell('A', 'tasks.mentioned') = 1, 'mentioning the same person again within minutes is one notice');
  PERFORM test.new_task('O', 'Private plan', 'PB');
  r := test.as_user('O', format($q$SELECT public.tasks_op_mention(%L, %L, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('Private plan'), test.id('M')));
  PERFORM test.ok(test.bell('M', 'tasks.mentioned') = 1 AND r = 'ok 1'
              AND NOT EXISTS (SELECT 1 FROM public.module_activity WHERE op = 'tasks.mentioned' AND entity_id = test.id('Private plan')),
    'naming someone who can''t see the task notifies nobody', r);
  r := test.try('V', format($q$SELECT public.tasks_op_mention(%L, %L, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('Spec review'), test.id('A')));
  PERFORM test.ok(r LIKE '%edit access%', 'a viewer can''t mention (they can''t edit the description)', r);
END;
$$;

-- ── Comment and mention notices reach only people who can see the item ─────
DO $$
DECLARE
  r text;
BEGIN
  -- O's private task; O names M in a comment (M can't see it).
  r := test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Ask M', ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('Private plan'), test.id('M')));
  PERFORM test.ok(test.bell('M', 'comments.add') = 0, 'a comment mention never reaches someone who can''t see the task', r);
  -- A task in O and M's project, where M commented; then M loses access.
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'bucket', test.id('PM'), 'member', test.id('M'), 'edit', test.id('O'));
  PERFORM test.new_task('O', 'Joint', 'PM');
  PERFORM test.as_user('M', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'On it')$q$, test.id('W'), test.id('Joint')));
  DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PM');
  r := test.as_user('O', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Thanks')$q$, test.id('W'), test.id('Joint')));
  PERFORM test.ok(test.bell('M', 'comments.add') = 0, 'a participant who lost access gets no comment notice', r);
  -- The gate holds whoever writes the row (any path).
  INSERT INTO public.module_activity (workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, actor_label, payload)
  VALUES (test.id('W'), 'notes', 'note', test.id('no-such-note'), 'notes.mention', 'user', test.id('O'), 'O',
          jsonb_build_object('mentioned_user_ids', jsonb_build_array(test.id('A')::text), 'title', 'Secret'));
  PERFORM test.ok((SELECT payload -> 'mentioned_user_ids' FROM public.module_activity
                   WHERE op = 'notes.mention' AND entity_id = test.id('no-such-note')) = '[]'::jsonb,
    'a mention notice for an item its person can''t see is written with nobody in it');
  -- Comments still reach people who can see the task.
  PERFORM test.new_task('E', 'Open thread', 'SB', jsonb_build_object('assignee_id', test.id('A')));
  PERFORM test.as_user('E', format($q$SELECT public.comments_op_add(%L, 'task', %L, 'Looks good')$q$, test.id('W'), test.id('Open thread')));
  PERFORM test.ok(test.bell('A', 'comments.add') >= 1, 'a comment on your task still reaches you');
END;
$$;

-- ── Browsers: subscriptions and the push sender's side ──────────────────────
DO $$
DECLARE
  r text;
  v_key text := 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
  v_auth text := 'tBHItJI5svbpez7KI4CCXg';
  v_rows jsonb;
BEGIN
  r := test.try('E', format($q$SELECT public.push_op_subscribe('http://kong:8000/functions/v1/x', %L, %L)$q$, v_key, v_auth));
  PERFORM test.ok(r LIKE '%isn''t supported%', 'an endpoint that isn''t a known push service is refused', r);
  r := test.try('E', format($q$SELECT public.push_op_subscribe('https://fcm.googleapis.com.evil.example/x', %L, %L)$q$, v_key, v_auth));
  PERFORM test.ok(r LIKE '%isn''t supported%', 'a look-alike host is refused', r);
  r := test.try('E', $q$SELECT public.push_op_subscribe('https://fcm.googleapis.com/fcm/send/abc', 'short', 'x')$q$);
  PERFORM test.ok(r LIKE '%don''t read%', 'keys that don''t read are refused', r);
  r := test.as_user('E', format($q$SELECT public.push_op_subscribe('https://fcm.googleapis.com/fcm/send/abc', %L, %L, 'Chrome')$q$, v_key, v_auth));
  PERFORM test.ok(r = 'ok 1' AND test.value_as('E', 'SELECT count(*)::text FROM public.push_subscriptions') = '1'
              AND test.value_as('A', 'SELECT count(*)::text FROM public.push_subscriptions') = '0',
    'a browser subscribes; only its person reads it', r);
  PERFORM test.as_user('E', format($q$SELECT public.push_op_subscribe('https://web.push.apple.com/QH0', %L, %L, 'Safari')$q$, v_key, v_auth));
  PERFORM test.ok(public.notice_deliveries__kick() IS NULL, 'with no URL and secret in Vault, nothing is called');
  -- A delivery for E now has two browsers to go to.
  PERFORM test.new_task('E', 'Pay rent', 'SB');
  PERFORM test.remind('E', 'Pay rent', now() - interval '1 minute');
  PERFORM public.tasks__fire_reminders(now(), 500);
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.title) INTO v_rows FROM public.notice_deliveries__claim(10) c;
  -- E's earlier reminder ("Call Anna") wasn't pushed yet either.
  PERFORM test.ok(jsonb_array_length(v_rows) = 2
              AND v_rows -> 1 ->> 'title' = 'Pay rent'
              AND v_rows -> 1 ->> 'user_id' = test.id('E')::text
              AND jsonb_array_length(v_rows -> 1 -> 'subscriptions') = 2,
    'the sender claims each waiting delivery with its person''s browsers', v_rows::text);
  PERFORM public.notice_deliveries__settle(jsonb_build_array(
    jsonb_build_object('id', v_rows -> 0 ->> 'id', 'ok', true),
    jsonb_build_object('id', v_rows -> 1 ->> 'id', 'ok', true, 'gone', jsonb_build_array('https://web.push.apple.com/QH0'))));
  PERFORM test.ok((SELECT pushed_at FROM public.notice_deliveries WHERE id = (v_rows -> 1 ->> 'id')::uuid) IS NOT NULL
              AND (SELECT count(*) FROM public.push_subscriptions WHERE user_id = test.id('E')) = 1,
    'settling marks it sent and forgets a browser the push service says is gone');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries__claim(10)), 'a sent delivery isn''t claimed again');
  -- Someone else can't take E's browser over, or remove it.
  r := test.try('A', format($q$SELECT public.push_op_subscribe('https://fcm.googleapis.com/fcm/send/abc', %L, %L)$q$, v_key, v_auth));
  PERFORM test.ok(r LIKE '%set up for someone else%'
              AND (SELECT user_id FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/abc') = test.id('E'),
    'another person registering E''s browser is refused, and it stays E''s', r);
  PERFORM test.as_user('A', $q$SELECT public.push_op_unsubscribe('https://fcm.googleapis.com/fcm/send/abc')$q$);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/abc'),
    'nobody unsubscribes someone else''s browser');
  -- E re-registering their own browser just refreshes it.
  r := test.as_user('E', format($q$SELECT public.push_op_subscribe('https://fcm.googleapis.com/fcm/send/abc', %L, %L, 'Chrome 2')$q$, v_key, v_auth));
  PERFORM test.ok(r = 'ok 1' AND (SELECT user_agent FROM public.push_subscriptions
                                  WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/abc') = 'Chrome 2',
    'the same person re-registering refreshes their own row', r);
  -- An API key (the MCP connector's path) can't touch subscriptions.
  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('key'), test.id('W'), 'Agent', 'mdo_test', md5('db-test-push-key'),
          '{"tasks": "edit"}'::jsonb, test.id('E'));
  r := test.as_key('key', format($q$SELECT public.push_op_subscribe('https://fcm.googleapis.com/fcm/send/key', %L, %L)$q$, v_key, v_auth));
  PERFORM test.ok(r LIKE '42501%' AND NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE endpoint LIKE '%/key'),
    'an API key can''t register a browser', r);
  r := test.as_key('key', $q$SELECT public.push_op_unsubscribe('https://fcm.googleapis.com/fcm/send/abc')$q$);
  PERFORM test.ok(r LIKE '42501%' AND EXISTS (SELECT 1 FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/abc'),
    'or remove one', r);
  r := test.try('E', format($q$SELECT public.push_op_subscribe('https://fcm.googleapis.com@evil.example/x', %L, %L)$q$, v_key, v_auth));
  PERFORM test.ok(r LIKE '%isn''t supported%', 'a URL that only looks like a push service is refused', r);
  -- Settling forgets a gone endpoint only for the delivery's own person.
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (test.id('A'), 'https://fcm.googleapis.com/fcm/send/of-a', v_key, v_auth);
  PERFORM public.notice_deliveries__settle(jsonb_build_array(jsonb_build_object(
    'id', v_rows -> 1 ->> 'id', 'ok', true, 'gone', jsonb_build_array('https://fcm.googleapis.com/fcm/send/of-a'))));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/of-a'),
    'a delivery for E never removes A''s browser');
  PERFORM test.ok(NOT public.notice_deliveries__authorize('x') AND NOT public.notice_deliveries__authorize(NULL),
    'the push sender''s secret check refuses without Vault''s secret');
END;
$$;

-- ── Archiving asks for Full access, also when another trigger writes it ─────
CREATE TABLE test.archive_probe (bucket uuid);
CREATE FUNCTION test.archive_probe_fire() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.buckets SET archived_at = now() WHERE id = NEW.bucket;
  RETURN NULL;
END;
$$;
CREATE TRIGGER archive_probe AFTER INSERT ON test.archive_probe
  FOR EACH ROW EXECUTE FUNCTION test.archive_probe_fire();
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_op('E', format($q$INSERT INTO test.archive_probe VALUES (%L)$q$, test.id('SB')));
  PERFORM test.ok(r LIKE '42501%' AND (SELECT archived_at FROM public.buckets WHERE id = test.id('SB')) IS NULL,
    'a nested write of archived_at by someone without Full access is refused', r);
  r := test.as_op('O', format($q$INSERT INTO test.archive_probe VALUES (%L)$q$, test.id('SB')));
  PERFORM test.ok(r = 'ok 1' AND (SELECT archived_at FROM public.buckets WHERE id = test.id('SB')) IS NOT NULL,
    'and allowed for someone with Full access', r);
  UPDATE public.buckets SET archived_at = NULL WHERE id = test.id('SB');
END;
$$;

-- ── Account erasure covers the new tables ───────────────────────────────────
DO $$
DECLARE
  v jsonb;
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (test.id('W2'), test.id('E'), 'member');
  v := public.account_erase_workspace_data(test.id('E'), true);
  PERFORM test.ok((v ->> 'push_subscriptions_deleted')::integer = 1
              AND (v ->> 'notice_deliveries_deleted')::integer >= 2,
    'the erasure preview counts E''s browsers and deliveries', v::text);
  v := public.account_erase_workspace_data(test.id('A'), false);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = test.id('A'))
              AND NOT EXISTS (SELECT 1 FROM public.notice_deliveries WHERE user_id = test.id('A')),
    'erasing an account removes its browsers and deliveries', v::text);
END;
$$;
