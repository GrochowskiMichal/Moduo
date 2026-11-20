-- Rename, delete and Undo for a calendar you made
-- (supabase/migrations/20261103180000_calendar_custom_rename_remove.sql): only
-- its owner, only a custom calendar (never your Moduo calendar). Delete
-- tombstones the calendar with the owner's own events on it and their registry
-- entries; a teammate's event and a booked one move to their owner's Moduo
-- calendar instead. Restore brings back exactly what was tombstoned, not an
-- event deleted before.
--
-- Cast: O owns workspace W; M is a plain member. O has a custom calendar CW
-- ("Work"), shared with M at Edit, with two of O's events, one deleted earlier,
-- one of M's and one booked by a guest; and a Moduo calendar with one event.
-- M has a custom calendar CM of their own.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('M'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.calendars (id, workspace_id, owner_id, name, kind) VALUES
  (test.id('CW'), test.id('W'), test.id('O'), 'Work', 'custom'),
  (test.id('CM'), test.id('W'), test.id('M'), 'Side', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'calendar'
  AND resource_id IN (test.id('CW'), test.id('CM'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'calendar', test.id('CW'), 'member', test.id('M'), 'edit', test.id('O'));
INSERT INTO public.exposed_slot_links (id, slot_id, slug, owner_user_id, workspace_id, name)
VALUES (test.id('L'), 'slot-crr', 'crr-intro', test.id('O')::text, test.id('W'), 'Intro call');

CREATE FUNCTION pg_temp.create_on(p_title text, p_calendar uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format(
    $q$SELECT public.calendar_op_event_create(p_workspace_id => %L, p_title => %L,
         p_starts_at => '2026-11-03 10:00+00', p_ends_at => '2026-11-03 11:00+00',
         p_calendar_id => %L)$q$,
    md5('db-test:W')::uuid, p_title, p_calendar)
$$;
CREATE FUNCTION pg_temp.op(p_fn text, p_calendar uuid, p_extra text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.%s(%L, %L%s)', p_fn, md5('db-test:W')::uuid, p_calendar,
                coalesce(', ' || quote_literal(p_extra), ''))
$$;
CREATE FUNCTION pg_temp.event(p_title text) RETURNS public.calendar_events LANGUAGE sql AS $$
  SELECT * FROM public.calendar_events e
   WHERE e.workspace_id = md5('db-test:W')::uuid AND e.title = p_title
$$;
CREATE FUNCTION pg_temp.live(p_title text) RETURNS boolean LANGUAGE sql AS $$
  SELECT (pg_temp.event(p_title)).deleted_at IS NULL
$$;
CREATE FUNCTION pg_temp.entity_live(p_title text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.entities en
                  WHERE en.entity_type = 'event' AND en.entity_id = (pg_temp.event(p_title)).id
                    AND en.deleted_at IS NULL)
$$;
CREATE FUNCTION pg_temp.moduo_of(p_who text) RETURNS uuid LANGUAGE sql AS $$
  SELECT c.id FROM public.calendars c
   WHERE c.workspace_id = md5('db-test:W')::uuid AND c.owner_id = md5('db-test:' || p_who)::uuid
     AND c.kind = 'moduo' AND c.deleted_at IS NULL
$$;

DO $$
DECLARE
  r text;
BEGIN
  PERFORM test.as_user('O', pg_temp.create_on('Standup', NULL));
  PERFORM test.as_user('O', pg_temp.create_on('Investor prep', test.id('CW')));
  PERFORM test.as_user('O', pg_temp.create_on('Board call', test.id('CW')));
  PERFORM test.as_user('O', pg_temp.create_on('Cancelled sync', test.id('CW')));
  PERFORM test.as_user('O', pg_temp.create_on('Intro with Tom', test.id('CW')));
  r := test.as_user('M', pg_temp.create_on('M on Work', test.id('CW')));
  PERFORM test.ok(r = 'ok 1', 'M can put an event on O''s shared calendar (setup)', r);
  PERFORM test.as_user('M', pg_temp.create_on('M on Side', test.id('CM')));
  UPDATE public.calendar_events SET deleted_at = now() - interval '1 hour'
   WHERE workspace_id = test.id('W') AND title = 'Cancelled sync';
  INSERT INTO public.slot_bookings (id, slot_id, slot_slug, start_at, end_at, attendee_name, attendee_email,
                                    status, calendar_event_id)
  VALUES (test.id('B'), 'slot-crr', 'crr-intro', '2026-11-03 10:00+00', '2026-11-03 10:30+00',
          'Tom Becker', 'tom@becker.studio', 'confirmed', (pg_temp.event('Intro with Tom')).id);

  -- Grants
  PERFORM test.ok(
    NOT has_function_privilege('anon', 'public.calendar_op_calendar_remove(uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.calendar_op_calendar_restore(uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.calendar_op_calendar_rename(uuid, uuid, text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.calendar_op_calendar_remove(uuid, uuid)', 'EXECUTE'),
    'signed-in people can call the ops, anon can''t');

  -- Rename
  r := test.as_user('O', pg_temp.op('calendar_op_calendar_rename', test.id('CW'), '  Deep work  '));
  PERFORM test.ok(r = 'ok 1' AND (SELECT name FROM public.calendars WHERE id = test.id('CW')) = 'Deep work',
    'the owner renames a calendar they made (trimmed)', r);
  r := test.try('O', pg_temp.op('calendar_op_calendar_rename', test.id('CW'), '   '));
  PERFORM test.ok(r LIKE '%needs a name%', 'never to an empty name', r);
  r := test.try('M', pg_temp.op('calendar_op_calendar_rename', test.id('CW'), 'Mine now'));
  PERFORM test.ok(r LIKE '%Calendar not found%', 'a member can''t rename someone else''s calendar, even with Edit', r);
  r := test.try('O', pg_temp.op('calendar_op_calendar_rename', pg_temp.moduo_of('O'), 'Renamed'));
  PERFORM test.ok(r LIKE '%Calendar not found%', 'your Moduo calendar keeps its name', r);

  -- Delete
  r := test.try('M', pg_temp.op('calendar_op_calendar_remove', test.id('CW')));
  PERFORM test.ok(r LIKE '%Calendar not found%' AND pg_temp.live('Investor prep'),
    'a member can''t delete someone else''s calendar', r);
  r := test.try('O', pg_temp.op('calendar_op_calendar_remove', pg_temp.moduo_of('O')));
  PERFORM test.ok(r LIKE '%Calendar not found%' AND pg_temp.live('Standup'),
    'your Moduo calendar can''t be deleted', r);
  r := test.as_user('O', pg_temp.op('calendar_op_calendar_remove', test.id('CW')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT deleted_at IS NOT NULL FROM public.calendars WHERE id = test.id('CW'))
              AND NOT pg_temp.live('Investor prep') AND NOT pg_temp.live('Board call')
              AND NOT pg_temp.entity_live('Investor prep')
              AND pg_temp.live('Standup'),
    'delete takes the calendar, your events on it and their registry entries; other calendars keep theirs', r);
  PERFORM test.ok(pg_temp.live('M on Work') AND (pg_temp.event('M on Work')).calendar_ref = pg_temp.moduo_of('M'),
    'a teammate''s event on it moves to their own Moduo calendar, never deleted');
  PERFORM test.ok(pg_temp.live('Intro with Tom')
              AND (pg_temp.event('Intro with Tom')).calendar_ref = pg_temp.moduo_of('O')
              AND (SELECT status FROM public.slot_bookings WHERE id = test.id('B')) = 'confirmed',
    'a booked event moves to your Moduo calendar, so its guests get no cancellation');
  r := test.try('O', pg_temp.op('calendar_op_calendar_remove', test.id('CW')));
  PERFORM test.ok(r LIKE '%Calendar not found%', 'a deleted calendar can''t be deleted again', r);

  -- Undo
  r := test.try('M', pg_temp.op('calendar_op_calendar_restore', test.id('CW')));
  PERFORM test.ok(r LIKE '%Calendar not found%', 'only the owner can bring it back', r);
  r := test.as_user('O', pg_temp.op('calendar_op_calendar_restore', test.id('CW')));
  PERFORM test.ok(r = 'ok 1'
              AND (SELECT deleted_at IS NULL FROM public.calendars WHERE id = test.id('CW'))
              AND pg_temp.live('Investor prep') AND pg_temp.live('Board call')
              AND pg_temp.entity_live('Board call')
              AND NOT pg_temp.live('Cancelled sync'),
    'restore brings back the calendar and exactly the events deleted with it', r);

  -- A plain member deletes a calendar of their own, with an event on it.
  r := test.as_user('M', pg_temp.op('calendar_op_calendar_remove', test.id('CM')));
  PERFORM test.ok(r = 'ok 1' AND NOT pg_temp.live('M on Side'),
    'a member deletes their own calendar and their events on it', r);

  -- A day later it is gone for good.
  PERFORM test.as_user('O', pg_temp.op('calendar_op_calendar_remove', test.id('CW')));
  UPDATE public.calendars SET deleted_at = now() - interval '2 days' WHERE id = test.id('CW');
  r := test.try('O', pg_temp.op('calendar_op_calendar_restore', test.id('CW')));
  PERFORM test.ok(r LIKE '%Calendar not found%', 'Undo lasts a day, not forever', r);
END;
$$;
