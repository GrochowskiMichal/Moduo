-- Focus is busy to teammates, free to links (CALR-14, specs/calendar-rethink.md
-- AC23). Focus time is a calendar item (kind 'focus') that can hold a task. A
-- teammate sees it as "Focus time": busy, never its title or the task inside,
-- through any read (the masked read, the table and so the live channel, the
-- registry, an API key). Booking links are the TS side
-- (supabase/functions/_shared/booking-busy.test.ts).
--
-- Cast: O owns workspace W and a project P with the task "Investor deck" (T).
-- K is a member with All details (view) on O's Moduo calendar; B gets Busy
-- only (freebusy) there. O holds T in focus time "Investor deck", has a plain
-- focus block "Deep work", a private focus block "Therapy prep", and an
-- ordinary event "Board review". KK is K's API key.

SELECT test.person(n) FROM unnest(ARRAY['O', 'K', 'B']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('K'), 'member'),
  (test.id('W'), test.id('B'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
VALUES (test.id('P'), test.id('W'), test.id('O'), 'Fundraise', false);
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
VALUES (test.id('T'), test.id('W'), test.id('P'), test.id('O'), 'Investor deck', 'todo');
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KK'), test.id('W'), 'K agent', 'mdo_kk', md5('db-test-kk'), '{"calendar": "view"}'::jsonb, test.id('K'));

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Investor deck', p_starts_at => '2026-11-03 13:00+00', p_ends_at => '2026-11-03 15:00+00',
    p_description => 'Slides 4 to 9', p_kind => 'focus', p_focus_task_id => %L)$q$, test.id('W'), test.id('T')));
  PERFORM test.ok(r = 'ok 1', 'O holds the task in focus time on their Moduo calendar', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Deep work', p_starts_at => '2026-11-04 09:00+00', p_ends_at => '2026-11-04 11:00+00',
    p_kind => 'focus')$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 1', 'and a focus block that holds no task', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Therapy prep', p_starts_at => '2026-11-05 09:00+00', p_ends_at => '2026-11-05 10:00+00',
    p_kind => 'focus', p_is_private => true)$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 1', 'and a private focus block', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Board review', p_starts_at => '2026-11-04 14:00+00', p_ends_at => '2026-11-04 15:00+00',
    p_location => 'Room 4')$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 1', 'and an ordinary event', r);
END;
$$;

CREATE FUNCTION pg_temp.ev(p_title text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.calendar_events WHERE workspace_id = md5('db-test:W')::uuid AND title = p_title
$$;
CREATE FUNCTION pg_temp.cal() RETURNS uuid LANGUAGE sql AS $$
  SELECT calendar_ref FROM public.calendar_events WHERE workspace_id = md5('db-test:W')::uuid AND title = 'Investor deck'
$$;
-- The masked read over the test week, as SQL text (run under another role).
CREATE FUNCTION pg_temp.visible(p_select text, p_where text DEFAULT 'true') RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT %s FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') e WHERE %s$q$,
    p_select, md5('db-test:W')::uuid, p_where)
$$;

DO $$
BEGIN
  PERFORM test.ok(pg_temp.cal() IS NOT NULL
              AND (SELECT count(DISTINCT calendar_ref) FROM public.calendar_events WHERE workspace_id = test.id('W')) = 1,
    'all four sit on O''s one Moduo calendar');
  DELETE FROM public.resource_grants WHERE resource_type = 'calendar' AND resource_id = pg_temp.cal();
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'calendar', pg_temp.cal(), 'member', test.id('K'), 'view', test.id('O')),
         (test.id('W'), 'calendar', pg_temp.cal(), 'member', test.id('B'), 'freebusy', test.id('O'));
END;
$$;

-- The owner keeps everything: the title, the task inside, the description.
DO $$
DECLARE
  v_focus uuid := pg_temp.ev('Investor deck');
  r text;
BEGIN
  r := test.value_as('O', pg_temp.visible($w$title || '|' || kind || '|' || focus_task_id || '|' || description$w$, format('id = %L', v_focus)));
  PERFORM test.ok(r = format('Investor deck|focus|%s|Slides 4 to 9', test.id('T')),
    'O reads their focus time whole, task and all', r);
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.calendar_events WHERE id = %L AND focus_task_id = %L$q$, v_focus, test.id('T'))) = '1',
    'and from the table');
END;
$$;

-- A teammate at All details sees "Focus time": busy, never the task.
DO $$
DECLARE
  v_focus uuid := pg_temp.ev('Investor deck');
  v_deep uuid := pg_temp.ev('Deep work');
  v_private uuid := pg_temp.ev('Therapy prep');
  v_board uuid := pg_temp.ev('Board review');
  r text;
BEGIN
  r := test.value_as('K', pg_temp.visible(format('string_agg(title, %L ORDER BY start_time)', ',')));
  PERFORM test.ok(r = 'Focus time,Focus time,Board review,Busy',
    'K gets both focus blocks as "Focus time", the event whole and the private focus block as "Busy"', r);
  r := test.value_as('K', pg_temp.visible($w$count(*) FILTER (WHERE title = 'Focus time' AND kind = 'focus'
        AND focus_task_id IS NULL AND description IS NULL AND location IS NULL AND conference_url IS NULL
        AND attendees = '[]'::jsonb AND tags = '[]'::jsonb AND NOT is_private)$w$,
      format('id IN (%L, %L)', v_focus, v_deep)));
  PERFORM test.ok(r = '2', 'each focus block keeps its kind but carries no task, description, place, link, people or tags', r);
  r := test.value_as('K', pg_temp.visible($w$start_time || '|' || end_time || '|' || calendar_ref || '|' || owner_id$w$, format('id = %L', v_focus)));
  PERFORM test.ok(r = format('%s|%s|%s|%s', '2026-11-03 13:00:00+00'::timestamptz, '2026-11-03 15:00:00+00'::timestamptz, pg_temp.cal(), test.id('O')),
    'and keeps its times, calendar and owner, so it lands on the grid as busy', r);
  r := test.value_as('K', pg_temp.visible('count(*)', $w$title IN ('Investor deck', 'Deep work', 'Therapy prep') OR description = 'Slides 4 to 9'$w$));
  PERFORM test.ok(r = '0', 'no focus title or description reaches K through the masked read', r);
  r := test.value_as('K', pg_temp.visible('title', format('id = %L', v_private)));
  PERFORM test.ok(r = 'Busy', 'private wins over focus: a private focus block is "Busy"', r);
  r := test.value_as('K', pg_temp.visible('location', format('id = %L', v_board)));
  PERFORM test.ok(r = 'Room 4', 'an ordinary event stays whole for K', coalesce(r, 'null'));
END;
$$;

-- The table (the live channel's rows) never hands a teammate a focus row.
DO $$
DECLARE
  v_focus uuid := pg_temp.ev('Investor deck');
  v_deep uuid := pg_temp.ev('Deep work');
  v_board uuid := pg_temp.ev('Board review');
BEGIN
  PERFORM test.ok(test.value_as('K', format($q$SELECT string_agg(title, ',' ORDER BY title) FROM public.calendar_events WHERE id IN (%L, %L, %L)$q$,
      v_focus, v_deep, v_board)) = 'Board review',
    'K reads only the ordinary event from the table: focus rows never stream to K');
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events WHERE focus_task_id IS NOT NULL OR title IN ('Investor deck', 'Deep work')$q$)) = '0',
    'no focus title or held task is readable by K from the table at all');
END;
$$;

-- Busy only: the focus blocks are busy blocks like any other time.
DO $$
DECLARE
  r text;
BEGIN
  r := test.value_as('B', format($q$SELECT string_agg(to_char(start_time AT TIME ZONE 'UTC', 'DD HH24:MI'), ',' ORDER BY start_time)
    FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00')$q$, test.id('W')));
  PERFORM test.ok(r = '03 13:00,04 09:00,04 14:00,05 09:00', 'B gets every block busy, the focus ones included', r);
  PERFORM test.ok(test.value_as('B', pg_temp.visible('count(*)')) = '0', 'and no rows from the masked read');
END;
$$;

-- Around the item: access, the registry, the held task.
DO $$
DECLARE
  v_focus uuid := pg_temp.ev('Investor deck');
  v_board uuid := pg_temp.ev('Board review');
BEGIN
  PERFORM test.ok(test.value_as('K', format($q$SELECT public.can_access('event', %L, 'view')::text$q$, v_focus)) = 'false'
              AND test.value_as('K', format($q$SELECT public.can_access('event', %L, 'freebusy')::text$q$, v_focus)) = 'true'
              AND test.value_as('K', format($q$SELECT public.can_access('event', %L, 'view')::text$q$, v_board)) = 'true',
    'can_access: K knows the focus time is taken (freebusy) but can''t view it; the ordinary event stays viewable');
  PERFORM test.ok(test.value_as('O', format($q$SELECT public.can_access('event', %L, 'full')::text$q$, v_focus)) = 'true',
    'O still owns their focus time');
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.entities WHERE entity_type = 'event' AND entity_id = %L$q$, v_focus)) = '0'
              AND test.value_as('O', format($q$SELECT count(*) FROM public.entities WHERE entity_type = 'event' AND entity_id = %L$q$, v_focus)) = '1',
    'the registry row (the task''s title) is O''s alone');
END;
$$;

-- Turning an event into focus time (and back) takes effect at once.
DO $$
DECLARE
  v_board uuid := pg_temp.ev('Board review');
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"kind": "focus"}'::jsonb)$q$, test.id('W'), v_board));
  PERFORM test.ok(r = 'ok 1', 'O turns the board review into focus time', r);
  PERFORM test.ok(test.value_as('K', pg_temp.visible('title', format('id = %L', v_board))) = 'Focus time'
              AND test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events WHERE id = %L$q$, v_board)) = '0',
    'K''s next read shows "Focus time" and the live channel stops sending it');
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"kind": "event"}'::jsonb)$q$, test.id('W'), v_board));
  PERFORM test.ok(test.value_as('K', format($q$SELECT title FROM public.calendar_events WHERE id = %L$q$, v_board)) = 'Board review',
    'an event again, K reads it whole');
END;
$$;

-- An assistant reads through its person's eyes.
DO $$
DECLARE
  v_focus uuid := pg_temp.ev('Investor deck');
  r text;
BEGIN
  r := test.as_key('KK', format($q$SELECT 1 FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') e
    WHERE e.id = %L AND e.title = 'Focus time' AND e.focus_task_id IS NULL$q$, test.id('W'), v_focus));
  PERFORM test.ok(r = 'ok 1', 'K''s key reads the focus time as "Focus time"', r);
END;
$$;
