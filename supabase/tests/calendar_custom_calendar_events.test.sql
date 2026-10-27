-- Events on custom calendars (CALR-6, specs/calendar-rethink.md AC41, hole K9):
-- calendar_op_event_create and calendar_op_event_update put an event on any
-- calendar you can edit in the workspace, custom Moduo calendars included, and
-- that calendar's grants decide who else sees it
-- (supabase/migrations/20261027230000_calendar_event_data_v2.sql).
--
-- Cast: O owns workspace W; M and X are members. O has a custom calendar CW
-- ("Work"), a deleted one CD, a connected-account calendar CI, and a custom
-- calendar C2 in another workspace W2. M has custom calendars CM (shared with
-- O at Edit) and CV (shared with O at View). Nothing else is shared.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Hale & Co'),
  (test.id('W2'), test.id('O'), 'Side project');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('M'), 'member'),
  (test.id('W'), test.id('X'), 'member')
ON CONFLICT DO NOTHING;

INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label)
VALUES (test.id('A'), test.id('W'), test.id('O'), 'google', 'o@example.com', 'o@example.com');
-- Connecting the account made its calendar (CI).
CREATE FUNCTION pg_temp.ci() RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.calendars WHERE account_id = md5('db-test:A')::uuid AND deleted_at IS NULL
$$;

INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind, account_id, deleted_at) VALUES
  (test.id('CW'), test.id('W'), test.id('O'), 'Work', 'custom', NULL, NULL),
  (test.id('CD'), test.id('W'), test.id('O'), 'Old', 'custom', NULL, now()),
  (test.id('C2'), test.id('W2'), test.id('O'), 'Elsewhere', 'custom', NULL, NULL),
  (test.id('CM'), test.id('W'), test.id('M'), 'Launch', 'custom', NULL, NULL),
  (test.id('CV'), test.id('W'), test.id('M'), 'Hiring', 'custom', NULL, NULL);
DELETE FROM public.resource_grants WHERE resource_type = 'calendar'
  AND resource_id IN (test.id('CW'), test.id('CD'), pg_temp.ci(), test.id('C2'), test.id('CM'), test.id('CV'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'calendar', test.id('CM'), 'member', test.id('O'), 'edit', test.id('M')),
       (test.id('W'), 'calendar', test.id('CV'), 'member', test.id('O'), 'view', test.id('M'));

CREATE FUNCTION pg_temp.create_on(p_title text, p_calendar uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format(
    $q$SELECT public.calendar_op_event_create(p_workspace_id => %L, p_title => %L,
         p_starts_at => '2026-11-03 10:00+00', p_ends_at => '2026-11-03 11:00+00',
         p_calendar_id => %L)$q$,
    md5('db-test:W')::uuid, p_title, p_calendar)
$$;

DO $$
DECLARE
  r text;
  v_moduo uuid;
BEGIN
  -- A new event with no calendar named lands on O's own Moduo calendar.
  r := test.as_user('O', pg_temp.create_on('Standup', NULL));
  SELECT c.id INTO v_moduo FROM public.calendars c
    WHERE c.workspace_id = test.id('W') AND c.owner_id = test.id('O') AND c.kind = 'moduo' AND c.deleted_at IS NULL;
  PERFORM test.ok(r = 'ok 1' AND v_moduo IS NOT NULL
              AND (SELECT calendar_ref FROM public.calendar_events
                   WHERE workspace_id = test.id('W') AND title = 'Standup') = v_moduo,
    'no calendar named: the event goes to your Moduo calendar', r);

  r := test.as_user('O', pg_temp.create_on('Investor prep', test.id('CW')));
  PERFORM test.ok(r = 'ok 1'
              AND EXISTS (SELECT 1 FROM public.calendar_events
                          WHERE workspace_id = test.id('W') AND title = 'Investor prep'
                            AND calendar_ref = test.id('CW') AND owner_id = test.id('O')
                            AND source_account_id IS NULL AND calendar_id = 'moduo'),
    'an event can be created on your own custom calendar', r);

  r := test.as_user('O', pg_temp.create_on('Launch review', test.id('CM')));
  PERFORM test.ok(r = 'ok 1'
              AND EXISTS (SELECT 1 FROM public.calendar_events
                          WHERE workspace_id = test.id('W') AND title = 'Launch review'
                            AND calendar_ref = test.id('CM') AND owner_id = test.id('O')),
    'and on a teammate''s custom calendar you can edit', r);

  r := test.try('O', pg_temp.create_on('Panel', test.id('CV')));
  PERFORM test.ok(r LIKE '42501%can''t add events to this calendar%', 'not on a calendar you can only view', r);
  r := test.try('X', pg_temp.create_on('Panel', test.id('CW')));
  PERFORM test.ok(r LIKE '%Calendar not found in this workspace%',
    'one that isn''t shared with you answers like a missing one (no hint that it exists)', r);
  r := test.try('O', pg_temp.create_on('Panel', pg_temp.ci()));
  PERFORM test.ok(r LIKE '%connected calendar%', 'a connected account''s calendar is refused here (it saves through its account)', r);
  r := test.try('O', pg_temp.create_on('Panel', test.id('CD')));
  PERFORM test.ok(r LIKE '%Calendar not found in this workspace%', 'a deleted calendar is not found', r);
  r := test.try('O', pg_temp.create_on('Panel', test.id('C2')));
  PERFORM test.ok(r LIKE '%Calendar not found in this workspace%', 'nor is a calendar in another workspace', r);
  r := test.try('O', pg_temp.create_on('Panel', test.id('nope')));
  PERFORM test.ok(r LIKE '%Calendar not found in this workspace%', 'nor an id that is no calendar', r);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.calendar_events
                              WHERE workspace_id IN (test.id('W'), test.id('W2')) AND title = 'Panel'),
    'and none of the refused creates wrote a row');
END;
$$;

-- The calendar's grants decide who sees the event.
DO $$
DECLARE
  r text;
BEGIN
  r := test.value_as('M', format($q$SELECT count(*)::text FROM public.calendar_events
         WHERE workspace_id = %L AND title = 'Launch review'$q$, test.id('W')));
  PERFORM test.ok(r = '1', 'M sees the event O put on M''s calendar', r);
  r := test.value_as('X', format($q$SELECT count(*)::text FROM public.calendar_events
         WHERE workspace_id = %L AND title IN ('Launch review', 'Investor prep')$q$, test.id('W')));
  PERFORM test.ok(r = '0', 'X, with no grant on either calendar, sees neither event', r);

  INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
  VALUES (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('X'), 'view', test.id('O'));
  r := test.value_as('X', format($q$SELECT count(*)::text FROM public.calendar_events
         WHERE workspace_id = %L AND title = 'Investor prep'$q$, test.id('W')));
  PERFORM test.ok(r = '1', 'once O shares Work with X, X sees the event on it', r);
END;
$$;

-- Moving an event between calendars (calendar_op_event_update's calendarId).
DO $$
DECLARE
  r text;
  v_id uuid;
  v_moduo uuid;
BEGIN
  SELECT id INTO v_id FROM public.calendar_events WHERE workspace_id = test.id('W') AND title = 'Standup';
  SELECT c.id INTO v_moduo FROM public.calendars c
    WHERE c.workspace_id = test.id('W') AND c.owner_id = test.id('O') AND c.kind = 'moduo' AND c.deleted_at IS NULL;

  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, %L::jsonb)$q$,
         test.id('W'), v_id, json_build_object('calendarId', test.id('CW'))));
  PERFORM test.ok(r = 'ok 1' AND (SELECT calendar_ref FROM public.calendar_events WHERE id = v_id) = test.id('CW'),
    'an event moves onto a custom calendar you can edit', r);

  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, %L::jsonb)$q$,
         test.id('W'), v_id, json_build_object('calendarId', test.id('CV'))));
  PERFORM test.ok(r LIKE '42501%can''t add events to this calendar%'
              AND (SELECT calendar_ref FROM public.calendar_events WHERE id = v_id) = test.id('CW'),
    'not onto one you can only view, and it stays where it was', r);

  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, %L::jsonb)$q$,
         test.id('W'), v_id, json_build_object('calendarId', pg_temp.ci())));
  PERFORM test.ok(r LIKE '%connected calendar%', 'nor onto a connected account''s calendar', r);

  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, %L::jsonb)$q$,
         test.id('W'), v_id, json_build_object('calendarId', test.id('C2'))));
  PERFORM test.ok(r LIKE '%Calendar not found in this workspace%', 'nor into another workspace''s calendar', r);

  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"calendarId": null}'::jsonb)$q$,
         test.id('W'), v_id));
  PERFORM test.ok(r = 'ok 1' AND (SELECT calendar_ref FROM public.calendar_events WHERE id = v_id) = v_moduo,
    'calendarId null moves it back to your Moduo calendar', r);

  r := test.as_user('O', format($q$SELECT public.calendar_op_event_update(%L, %L, '{"title": "Daily standup"}'::jsonb)$q$,
         test.id('W'), v_id));
  PERFORM test.ok(r = 'ok 1' AND (SELECT calendar_ref FROM public.calendar_events WHERE id = v_id) = v_moduo,
    'a patch without calendarId leaves the calendar alone', r);
END;
$$;

-- The insert trigger keeps an explicit calendar only when the writer can edit it.
DO $$
DECLARE
  r text;
BEGIN
  r := test.as_op('O', format($q$INSERT INTO public.calendar_events
         (workspace_id, owner_id, title, start_time, end_time, calendar_ref)
         VALUES (%L, %L, 'Sneaky', '2026-11-04 10:00+00', '2026-11-04 11:00+00', %L)$q$,
         test.id('W'), test.id('O'), test.id('CV')));
  PERFORM test.ok(r LIKE '42501%can''t add events to this calendar%', 'a direct insert onto a view-only calendar is refused', r);
  r := test.as_op('O', format($q$INSERT INTO public.calendar_events
         (workspace_id, owner_id, title, start_time, end_time, calendar_ref)
         VALUES (%L, %L, 'Sneaky', '2026-11-04 10:00+00', '2026-11-04 11:00+00', %L)$q$,
         test.id('W'), test.id('O'), test.id('C2')));
  PERFORM test.ok(r LIKE '%Calendar not found in this workspace%', 'and onto another workspace''s calendar', r);
  r := test.as_op('O', format($q$INSERT INTO public.calendar_events
         (workspace_id, owner_id, title, start_time, end_time, calendar_ref)
         VALUES (%L, %L, 'Allowed', '2026-11-04 10:00+00', '2026-11-04 11:00+00', %L)$q$,
         test.id('W'), test.id('O'), test.id('CM')));
  PERFORM test.ok(r = 'ok 1', 'onto a calendar the writer can edit it is kept', r);
END;
$$;
