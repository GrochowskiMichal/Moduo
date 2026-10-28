-- Private is busy for everyone (CALR-15, specs/calendar-rethink.md AC28,
-- §Assumptions "Private masking"). A private event reaches a teammate only as
-- "Busy": its title, place, people, link and notes never do, whatever their
-- level on the calendar, through any read (the masked read, the table and so
-- the live channel, the entities registry, links, comments, an API key).
--
-- Cast: O owns workspace W. K is a member with All details (view) on O's
-- calendar Work (CW); B is a member who gets Busy only (the workspace's
-- freebusy); N is a member CW isn't shared with at all. On CW, O has a
-- private event "Therapy" (place, people, link, description), a private weekly
-- "1:1 with Priya", and a public "Board review". O also has a connected Google
-- account (A) whose calendar is shared with K at view, mirroring a private
-- "Dentist". KO is O's API key, KK is K's, KN is K's key without Calendar.

SELECT test.person(n) FROM unnest(ARRAY['O', 'K', 'B', 'N']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('K'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('N'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CW'), test.id('W'), test.id('O'), 'Work', 'custom');
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label)
VALUES (test.id('A'), test.id('W'), test.id('O'), 'google', 'o@example.com', 'o@example.com');
CREATE FUNCTION pg_temp.ci() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.calendars WHERE account_id = md5('db-test:A')::uuid AND deleted_at IS NULL
$$;
DELETE FROM public.resource_grants WHERE resource_type = 'calendar'
  AND resource_id IN (test.id('CW'), pg_temp.ci());
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('K'), 'view', test.id('O')),
       (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('B'), 'freebusy', test.id('O')),
       (test.id('W'), 'calendar', pg_temp.ci(), 'member', test.id('K'), 'view', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KO'), test.id('W'), 'O agent', 'mdo_ko', md5('db-test-ko'), '{"calendar": "view"}'::jsonb, test.id('O')),
  (test.id('KK'), test.id('W'), 'K agent', 'mdo_kk', md5('db-test-kk'), '{"calendar": "view"}'::jsonb, test.id('K')),
  (test.id('KN'), test.id('W'), 'K tasks', 'mdo_kn', md5('db-test-kn'), '{"tasks": "view"}'::jsonb, test.id('K'));

DO $$
DECLARE
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Therapy', p_starts_at => '2026-11-03 17:00+00', p_ends_at => '2026-11-03 18:00+00',
    p_description => 'Bring the notebook', p_calendar_id => %L, p_location => 'Dr Lane, 4 Elm St',
    p_attendees => '[{"email": "lane@example.com", "name": "Dr Lane"}]'::jsonb,
    p_conference_url => 'https://meet.google.com/abc-defg-hij', p_conference_provider => 'google_meet',
    p_is_private => true)$q$, test.id('W'), test.id('CW')));
  PERFORM test.ok(r = 'ok 1', 'O creates a private event on Work', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => '1:1 with Priya', p_starts_at => '2026-10-06 09:00+00', p_ends_at => '2026-10-06 09:30+00',
    p_rrule => 'FREQ=WEEKLY', p_calendar_id => %L, p_is_private => true)$q$, test.id('W'), test.id('CW')));
  PERFORM test.ok(r = 'ok 1', 'and a private weekly series that started weeks ago', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_create(p_workspace_id => %L,
    p_title => 'Board review', p_starts_at => '2026-11-04 10:00+00', p_ends_at => '2026-11-04 11:00+00',
    p_location => 'Room 4', p_calendar_id => %L)$q$, test.id('W'), test.id('CW')));
  PERFORM test.ok(r = 'ok 1', 'and a public one', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
    test.id('W'), test.id('A'), jsonb_build_array(jsonb_build_object('externalEventId', 'g-dentist',
      'title', 'Dentist', 'startsAt', '2026-11-05T08:00:00Z', 'endsAt', '2026-11-05T09:00:00Z',
      'location', 'Smile Clinic', 'isPrivate', true,
      'attendees', jsonb_build_array(jsonb_build_object('email', 'desk@smile.example', 'name', 'Front desk'))))));
  PERFORM test.ok((SELECT is_private FROM public.calendar_events WHERE external_event_id = 'g-dentist'),
    'a Google event marked private mirrors as private', r);
END;
$$;

CREATE FUNCTION pg_temp.ev(p_title text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.calendar_events WHERE workspace_id = md5('db-test:W')::uuid AND title = p_title
$$;
-- The masked read over the test week, as SQL text (run under another role).
CREATE FUNCTION pg_temp.visible(p_select text, p_where text DEFAULT 'true') RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT %s FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') e WHERE %s$q$,
    p_select, md5('db-test:W')::uuid, p_where)
$$;

-- The table itself (what the app's live channel streams, under each
-- subscriber's SELECT policy) never hands a teammate a private row.
DO $$
DECLARE
  v_therapy uuid := pg_temp.ev('Therapy');
  v_series uuid := pg_temp.ev('1:1 with Priya');
  v_board uuid := pg_temp.ev('Board review');
  v_dentist uuid := pg_temp.ev('Dentist');
BEGIN
  PERFORM test.ok(test.value_as('O', format($q$SELECT count(*) FROM public.calendar_events WHERE id IN (%L, %L, %L, %L)$q$,
      v_therapy, v_series, v_board, v_dentist)) = '4',
    'O reads all four of their events from the table');
  PERFORM test.ok(test.value_as('K', format($q$SELECT string_agg(title, ',' ORDER BY title) FROM public.calendar_events WHERE id IN (%L, %L, %L, %L)$q$,
      v_therapy, v_series, v_board, v_dentist)) = 'Board review',
    'at All details, K reads only the public event from the table: the private rows never stream to K');
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events WHERE title IN ('Therapy', 'Dentist', '1:1 with Priya') OR location IN ('Dr Lane, 4 Elm St', 'Smile Clinic')$q$)) = '0',
    'no private title or place is readable by K from the table at all');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*) FROM public.calendar_events WHERE id IN (%L, %L, %L, %L)$q$,
      v_therapy, v_series, v_board, v_dentist)) = '0',
    'Busy only reads no rows from the table (busy blocks carry the times)');
END;
$$;

-- The masked read: owners get their rows whole; a teammate at All details gets
-- a private row as "Busy" with its times and nothing else.
DO $$
DECLARE
  v_therapy uuid := pg_temp.ev('Therapy');
  v_series uuid := pg_temp.ev('1:1 with Priya');
  v_board uuid := pg_temp.ev('Board review');
  v_dentist uuid := pg_temp.ev('Dentist');
  r text;
BEGIN
  PERFORM test.ok(test.value_as('O', pg_temp.visible(format('string_agg(title, %L ORDER BY title)', ','))) = '1:1 with Priya,Board review,Dentist,Therapy',
    'O''s masked read is their own week, titles and all (the weekly series comes along for its occurrences)');
  PERFORM test.ok(test.value_as('O', pg_temp.visible($w$location || '|' || description || '|' || conference_url || '|' || (attendees->0->>'email')$w$, format('id = %L', v_therapy)))
      = 'Dr Lane, 4 Elm St|Bring the notebook|https://meet.google.com/abc-defg-hij|lane@example.com',
    'O sees their private event in full');

  r := test.value_as('K', pg_temp.visible(format('string_agg(title, %L ORDER BY start_time)', ',')));
  PERFORM test.ok(r = 'Busy,Busy,Board review,Busy',
    'K at All details gets the public event whole and every private one as "Busy"', r);
  r := test.value_as('K', pg_temp.visible($w$count(*) FILTER (WHERE title = 'Busy' AND is_private
        AND description IS NULL AND location IS NULL AND conference_url IS NULL AND conference_provider IS NULL
        AND attendees = '[]'::jsonb AND tags = '[]'::jsonb AND external_event_id IS NULL AND focus_task_id IS NULL)$w$,
      format('id IN (%L, %L, %L)', v_therapy, v_series, v_dentist)));
  PERFORM test.ok(r = '3', 'each private row carries no description, place, link, people, tags or Google id', r);
  r := test.value_as('K', pg_temp.visible($w$start_time || '|' || end_time || '|' || calendar_ref || '|' || owner_id$w$, format('id = %L', v_therapy)));
  PERFORM test.ok(r = format('%s|%s|%s|%s', '2026-11-03 17:00:00+00'::timestamptz, '2026-11-03 18:00:00+00'::timestamptz, test.id('CW'), test.id('O')),
    'but keeps its times, its calendar and its owner, so it lands on the grid as busy', r);
  r := test.value_as('K', pg_temp.visible('recurrence_rule', format('id = %L', v_series)));
  PERFORM test.ok(r = 'FREQ=WEEKLY', 'a private series keeps its repeat, so every occurrence shows busy', r);
  r := test.value_as('K', pg_temp.visible('location', format('id = %L', v_board)));
  PERFORM test.ok(r = 'Room 4', 'the public event keeps its place for K', coalesce(r, 'null'));

  PERFORM test.ok(test.value_as('B', pg_temp.visible('count(*)')) = '0',
    'Busy only gets no rows from the masked read');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*) FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00')$q$, test.id('W'))) = '2',
    'but busy blocks for the two Work events in that week');
  PERFORM test.ok(test.value_as('N', pg_temp.visible('count(*)')) = '0'
              AND test.value_as('N', format($q$SELECT count(*) FROM public.calendar_busy_blocks(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00')$q$, test.id('W'))) = '0',
    'N, who Work isn''t shared with, gets nothing either way');
END;
$$;

-- Everything around the event: registry title, links, comments, access.
DO $$
DECLARE
  v_therapy uuid := pg_temp.ev('Therapy');
  v_board uuid := pg_temp.ev('Board review');
  v_note uuid := test.id('NOTE');
BEGIN
  INSERT INTO public.notes (id, workspace_id, created_by, title) VALUES (v_note, test.id('W'), test.id('O'), 'Session notes');
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label)
  VALUES (test.id('W'), 'note', v_note, 'Session notes') ON CONFLICT DO NOTHING;
  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'note', v_note, 'workspace', NULL, 'view', test.id('O'))
  ON CONFLICT DO NOTHING;
  INSERT INTO public.entity_links (workspace_id, source_type, source_id, target_type, target_id, created_by) VALUES
    (test.id('W'), 'event', v_therapy, 'note', v_note, test.id('O')),
    (test.id('W'), 'note', v_note, 'event', v_board, test.id('O'));

  PERFORM test.ok(test.value_as('K', format($q$SELECT public.can_access('event', %L, 'view')::text$q$, v_therapy)) = 'false'
              AND test.value_as('K', format($q$SELECT public.can_access('event', %L, 'view')::text$q$, v_board)) = 'true'
              AND test.value_as('O', format($q$SELECT public.can_access('event', %L, 'full')::text$q$, v_therapy)) = 'true',
    'can_access: K can''t view the private event (but the public one), O still owns it');
  PERFORM test.ok(test.value_as('K', format($q$SELECT public.can_access('event', %L, 'freebusy')::text$q$, v_therapy)) = 'true',
    'K still knows the time is taken (freebusy)');
  PERFORM test.ok(test.value_as('K', format($q$SELECT public.perm_can_see_entity(%L, 'event', %L)::text$q$, test.id('W'), v_therapy)) = 'false',
    'perm_can_see_entity hides the private event from K (search, mentions, links)');
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.entities WHERE entity_type = 'event' AND entity_id = %L$q$, v_therapy)) = '0'
              AND test.value_as('O', format($q$SELECT count(*) FROM public.entities WHERE entity_type = 'event' AND entity_id = %L$q$, v_therapy)) = '1',
    'the registry row (its title) is O''s alone');
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.entity_links WHERE (source_type = 'event' AND source_id = %L) OR (target_type = 'event' AND target_id = %L)$q$, v_therapy, v_therapy)) = '0'
              AND test.value_as('O', format($q$SELECT count(*) FROM public.entity_links WHERE source_type = 'event' AND source_id = %L$q$, v_therapy)) = '1',
    'K can''t read which note is linked to the private event; O can');
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.entity_links WHERE target_type = 'event' AND target_id = %L$q$, v_board)) = '1',
    'links to an event K can see stay readable');
  PERFORM test.ok(public.comments__item_visible_to(test.id('W'), 'event', v_therapy, test.id('K')) = false
              AND public.comments__item_visible_to(test.id('W'), 'event', v_therapy, test.id('O')) = true,
    'comments on the private event are O''s alone');
END;
$$;

-- Making an event private (or public again) takes effect for the next read and
-- for the live channel's policy at once.
DO $$
DECLARE
  v_board uuid := pg_temp.ev('Board review');
  r text;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"isPrivate": true}'::jsonb)$q$, test.id('W'), v_board));
  PERFORM test.ok(r = 'ok 1' AND (SELECT is_private FROM public.calendar_events WHERE id = v_board), 'O makes the board review private', r);
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events WHERE id = %L$q$, v_board)) = '0',
    'the update no longer passes K''s SELECT policy, so the live channel stops sending it');
  PERFORM test.ok(test.value_as('K', pg_temp.visible('title', format('id = %L', v_board))) = 'Busy',
    'and K''s next read shows it as "Busy"');
  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"isPrivate": false}'::jsonb)$q$, test.id('W'), v_board));
  PERFORM test.ok(test.value_as('K', format($q$SELECT title FROM public.calendar_events WHERE id = %L$q$, v_board)) = 'Board review',
    'made public again, K reads it whole');
END;
$$;

-- An assistant reads through its person's eyes: the same masking for a key.
DO $$
DECLARE
  v_therapy uuid := pg_temp.ev('Therapy');
  r text;
BEGIN
  r := test.as_key('KK', format($q$SELECT 1 FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') e
    WHERE e.id = %L AND e.title = 'Busy' AND e.location IS NULL AND e.attendees = '[]'::jsonb$q$, test.id('W'), v_therapy));
  PERFORM test.ok(r = 'ok 1', 'K''s key reads the private event as "Busy"', r);
  r := test.as_key('KK', format($q$SELECT 1 FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') e
    WHERE e.title IN ('Therapy', 'Dentist', '1:1 with Priya')$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 0', 'and never a private title', r);
  r := test.as_key('KO', format($q$SELECT 1 FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00') e
    WHERE e.id = %L AND e.title = 'Therapy'$q$, test.id('W'), v_therapy));
  PERFORM test.ok(r = 'ok 1', 'O''s key reads O''s own private event whole', r);
  r := test.as_key('KN', format($q$SELECT 1 FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00')$q$, test.id('W')));
  PERFORM test.ok(r = 'ok 0', 'a key without Calendar reads nothing', r);
END;
$$;

DO $$
BEGIN
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.calendar_events_visible(uuid, timestamptz, timestamptz)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.calendar_events_visible(uuid, timestamptz, timestamptz)', 'EXECUTE')
              AND has_function_privilege('service_role', 'public.calendar_events_visible(uuid, timestamptz, timestamptz)', 'EXECUTE'),
    'the masked read is for signed-in people and the connector, never anon');
  PERFORM test.ok(test.value_as('K', format($q$SELECT count(*) FROM public.calendar_events_visible(%L, '2026-11-02 00:00+00', '2026-11-09 00:00+00')$q$, md5('db-test:nowhere')::uuid)) = '0',
    'another workspace reads as empty');
  PERFORM test.ok(NOT has_table_privilege('anon', 'public.calendar_events', 'SELECT')
              OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_events' AND 'anon' = ANY (roles) AND cmd = 'SELECT'),
    'anon still reads no events');
END;
$$;
