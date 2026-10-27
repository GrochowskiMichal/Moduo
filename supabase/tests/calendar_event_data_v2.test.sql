-- Event data v2 (CALR-6, specs/calendar-rethink.md §Assumptions, data model):
-- calendar_events gains privacy, a meeting link (conference_url and
-- conference_provider), a kind (event, focus, hold), a focus task, an offer and
-- the repeat-exception columns; create and update take place, people, link,
-- privacy, kind and focus task; meeting URLs move out of location, on every
-- write and in the backfill (supabase/migrations/20261027230000_calendar_event_data_v2.sql).
--
-- Cast: O owns workspace W, M is a member. T is a task in W, T2 a task in W2.
-- A is O's Google account in W.

SELECT test.person(n) FROM unnest(ARRAY['O', 'M']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Hale & Co'),
  (test.id('W2'), test.id('M'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('M'), 'member')
ON CONFLICT DO NOTHING;
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('P'), test.id('W'), test.id('O'), 'Fundraise', false),
  (test.id('P2'), test.id('W2'), test.id('M'), 'Theirs', false);
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status) VALUES
  (test.id('T'), test.id('W'), test.id('P'), test.id('O'), 'Write the deck', 'todo'),
  (test.id('T2'), test.id('W2'), test.id('P2'), test.id('M'), 'Not yours', 'todo');
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label)
VALUES (test.id('A'), test.id('W'), test.id('O'), 'google', 'o@example.com', 'o@example.com');

-- One create call with only the named arguments given.
CREATE FUNCTION pg_temp.create_sql(p_title text, p_extra text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT format(
    $q$SELECT public.calendar_op_event_create(p_workspace_id => %L, p_title => %L,
         p_starts_at => '2026-11-03 10:00+00', p_ends_at => '2026-11-03 11:00+00'%s)$q$,
    md5('db-test:W')::uuid, p_title, p_extra)
$$;
CREATE FUNCTION pg_temp.ev(p_title text) RETURNS public.calendar_events LANGUAGE sql AS $$
  SELECT * FROM public.calendar_events WHERE workspace_id = md5('db-test:W')::uuid AND title = p_title
$$;
CREATE FUNCTION pg_temp.update_sql(p_title text, p_patch jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.calendar_op_event_update(%L, %L, %L::jsonb)$q$,
    md5('db-test:W')::uuid, (pg_temp.ev(p_title)).id, p_patch)
$$;

-- The shape: new columns, their defaults, the vocabularies' CHECKs.
DO $$
DECLARE
  r text;
  e public.calendar_events;
BEGIN
  r := test.as_user('O', pg_temp.create_sql('Plain'));
  e := pg_temp.ev('Plain');
  PERFORM test.ok(r = 'ok 1' AND e.kind = 'event' AND e.is_private = false AND e.exdates = '{}'
              AND e.conference_url IS NULL AND e.conference_provider IS NULL
              AND e.focus_task_id IS NULL AND e.offer_id IS NULL AND e.series_id IS NULL
              AND e.original_start IS NULL AND e.external_series_id IS NULL
              AND e.attendees = '[]'::jsonb AND e.location IS NULL,
    'a plain event: kind event, not private, no link, no exceptions, no people', r);

  r := test.as_op('O', format($q$UPDATE public.calendar_events SET conference_url = 'https://x.example/1', conference_provider = 'skype' WHERE id = %L$q$, e.id));
  PERFORM test.ok(r LIKE '23514%', 'conference_provider is a closed vocabulary', r);
  r := test.as_op('O', format($q$UPDATE public.calendar_events SET kind = 'meeting' WHERE id = %L$q$, e.id));
  PERFORM test.ok(r LIKE '23514%', 'kind is a closed vocabulary', r);
  r := test.as_op('O', format($q$UPDATE public.calendar_events SET conference_url = 'javascript:alert(1)', conference_provider = 'other' WHERE id = %L$q$, e.id));
  PERFORM test.ok(r LIKE '23514%', 'a meeting link must be a web address', r);
  r := test.as_op('O', format($q$UPDATE public.calendar_events SET conference_provider = 'zoom' WHERE id = %L$q$, e.id));
  PERFORM test.ok(r LIKE '23514%', 'a provider without a link is refused', r);
  r := test.as_op('O', format($q$UPDATE public.calendar_events SET focus_task_id = %L WHERE id = %L$q$, test.id('T'), e.id));
  PERFORM test.ok(r LIKE '23514%', 'only focus time holds a task', r);
  r := test.as_op('O', format($q$UPDATE public.calendar_events SET series_id = id WHERE id = %L$q$, e.id));
  PERFORM test.ok(r LIKE '23514%', 'an event is not its own series', r);
END;
$$;

-- Create with place, people, link, privacy, kind and focus task.
DO $$
DECLARE
  r text;
  e public.calendar_events;
BEGIN
  r := test.as_user('O', pg_temp.create_sql('October update', $x$,
         p_location => '  Hale & Co, 12 Rua Augusta  ',
         p_attendees => '[{"email": " Priya@Example.com ", "name": "Priya"}, {"email": "priya@example.com"}, {"email": "kai@example.com", "status": "accepted"}]',
         p_conference_url => 'https://meet.google.com/abc-defg-hij',
         p_is_private => true$x$));
  e := pg_temp.ev('October update');
  PERFORM test.ok(r = 'ok 1' AND e.location = 'Hale & Co, 12 Rua Augusta'
              AND e.conference_url = 'https://meet.google.com/abc-defg-hij'
              AND e.conference_provider = 'google_meet' AND e.is_private,
    'create stores the place, the link (provider read from it) and privacy', r);
  PERFORM test.ok(jsonb_array_length(e.attendees) = 2
              AND e.attendees -> 0 ->> 'email' = 'priya@example.com'
              AND e.attendees -> 0 ->> 'name' = 'Priya'
              AND e.attendees -> 0 ->> 'status' = 'needsAction'
              AND e.attendees -> 1 ->> 'email' = 'kai@example.com'
              AND e.attendees -> 1 ->> 'status' = 'accepted',
    'people: emails trimmed and lower-cased, one row per email, status defaults to needsAction', e.attendees::text);

  r := test.as_user('O', pg_temp.create_sql('Zoom sync', $x$, p_conference_url => 'https://us02web.zoom.us/j/8123', p_conference_provider => 'teams'$x$));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.ev('Zoom sync')).conference_provider = 'teams',
    'an explicit provider is kept', r);
  r := test.as_user('O', pg_temp.create_sql('Odd link', $x$, p_conference_url => 'https://whereby.com/hale'$x$));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.ev('Odd link')).conference_provider = 'other',
    'an unknown host is provider other', r);
  r := test.as_user('O', pg_temp.create_sql('No link', $x$, p_conference_provider => 'zoom'$x$));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.ev('No link')).conference_provider IS NULL,
    'a provider without a link is dropped', r);

  r := test.try('O', pg_temp.create_sql('Bad', $x$, p_conference_url => 'ftp://files.example/x'$x$));
  PERFORM test.ok(r LIKE '%web address%', 'create refuses a link that is not a web address', r);
  r := test.try('O', pg_temp.create_sql('Bad', $x$, p_conference_url => 'https://meet.google.com/a', p_conference_provider => 'skype'$x$));
  PERFORM test.ok(r LIKE '%meeting link provider%', 'create refuses an unknown provider', r);
  r := test.try('O', pg_temp.create_sql('Bad', $x$, p_attendees => '[{"name": "No email"}]'$x$));
  PERFORM test.ok(r LIKE '%email address%', 'create refuses a guest without an email', r);
  r := test.try('O', pg_temp.create_sql('Bad', $x$, p_attendees => '{"email": "a@b.co"}'$x$));
  PERFORM test.ok(r LIKE '%email address%', 'people must be a list', r);
  r := test.try('O', pg_temp.create_sql('Bad', $x$, p_kind => 'meeting'$x$));
  PERFORM test.ok(r LIKE '%kind%', 'create refuses an unknown kind', r);
  r := test.try('O', pg_temp.create_sql('Bad', $x$, p_kind => 'hold'$x$));
  PERFORM test.ok(r LIKE '%Held times come from an offer%', 'holds are not created by hand', r);
  r := test.try('O', pg_temp.create_sql('Bad', format($x$, p_focus_task_id => %L$x$, test.id('T'))));
  PERFORM test.ok(r LIKE '%Only focus time can hold a task%', 'a task needs kind focus', r);
  r := test.try('O', pg_temp.create_sql('Bad', format($x$, p_kind => 'focus', p_focus_task_id => %L$x$, test.id('T2'))));
  PERFORM test.ok(r LIKE '%Task not found%', 'a task from another workspace is not found', r);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.calendar_events WHERE workspace_id = test.id('W') AND title = 'Bad'),
    'none of the refused creates wrote a row');

  r := test.as_user('O', pg_temp.create_sql('Deck time', format($x$, p_kind => 'focus', p_focus_task_id => %L$x$, test.id('T'))));
  e := pg_temp.ev('Deck time');
  PERFORM test.ok(r = 'ok 1' AND e.kind = 'focus' AND e.focus_task_id = test.id('T'),
    'focus time holds a task from your workspace', r);
END;
$$;

-- Meeting URLs never stay in location: the create path, any other write
-- (booking_op_commit writes the join link there), and the backfill's helper.
DO $$
DECLARE
  r text;
  e public.calendar_events;
  s record;
BEGIN
  r := test.as_user('O', pg_temp.create_sql('Zoom only', $x$, p_location => 'https://zoom.us/j/123'$x$));
  e := pg_temp.ev('Zoom only');
  PERFORM test.ok(r = 'ok 1' AND e.location IS NULL AND e.conference_url = 'https://zoom.us/j/123'
              AND e.conference_provider = 'zoom',
    'a location that is a meeting URL becomes the link', r);

  r := test.as_user('O', pg_temp.create_sql('Room and Teams', $x$, p_location => 'Room 4, https://teams.microsoft.com/l/meetup-join/abc'$x$));
  e := pg_temp.ev('Room and Teams');
  PERFORM test.ok(r = 'ok 1' AND e.location = 'Room 4'
              AND e.conference_url = 'https://teams.microsoft.com/l/meetup-join/abc'
              AND e.conference_provider = 'teams',
    'a place with a meeting URL keeps the place and moves the URL', r);

  r := test.as_user('O', pg_temp.create_sql('Both given', $x$, p_location => 'https://meet.google.com/zzz-zzzz-zzz', p_conference_url => 'https://zoom.us/j/9'$x$));
  e := pg_temp.ev('Both given');
  PERFORM test.ok(r = 'ok 1' AND e.location IS NULL AND e.conference_url = 'https://zoom.us/j/9',
    'an explicit link wins and the URL still leaves location', r);

  r := test.as_user('O', pg_temp.create_sql('Just a place', $x$, p_location => 'Café Lisboa, https://maps.example/cafe'$x$));
  e := pg_temp.ev('Just a place');
  PERFORM test.ok(r = 'ok 1' AND e.location = 'Café Lisboa, https://maps.example/cafe' AND e.conference_url IS NULL,
    'a place with a URL that is no meeting stays a place', r);

  UPDATE public.calendar_events SET location = 'https://meet.google.com/bok-king-xyz'
    WHERE id = (pg_temp.ev('Plain')).id;
  e := pg_temp.ev('Plain');
  PERFORM test.ok(e.location IS NULL AND e.conference_url = 'https://meet.google.com/bok-king-xyz'
              AND e.conference_provider = 'google_meet',
    'any write that puts a meeting URL in location moves it to the link (the booking path)');

  SELECT * INTO s FROM public.calendar__split_location('Room 2 · https://us05web.zoom.us/j/81?pwd=x');
  PERFORM test.ok(s.place = 'Room 2' AND s.url = 'https://us05web.zoom.us/j/81?pwd=x' AND s.provider = 'zoom',
    'the backfill helper splits a place from its meeting URL', s::text);
  SELECT * INTO s FROM public.calendar__split_location('https://teams.live.com/meet/9');
  PERFORM test.ok(s.place IS NULL AND s.url = 'https://teams.live.com/meet/9' AND s.provider = 'teams',
    'a bare meeting URL leaves no place', s::text);
  SELECT * INTO s FROM public.calendar__split_location('Office');
  PERFORM test.ok(s.place = 'Office' AND s.url IS NULL AND s.provider IS NULL, 'a plain place stays', s::text);
  SELECT * INTO s FROM public.calendar__split_location(NULL);
  PERFORM test.ok(s.place IS NULL AND s.url IS NULL AND s.provider IS NULL, 'null stays null', s::text);
END;
$$;

-- Update takes the same fields; only present keys change.
DO $$
DECLARE
  r text;
  e public.calendar_events;
BEGIN
  r := test.as_user('O', pg_temp.update_sql('October update', '{"location": "Café Lisboa"}'));
  e := pg_temp.ev('October update');
  PERFORM test.ok(r = 'ok 1' AND e.location = 'Café Lisboa'
              AND e.conference_url = 'https://meet.google.com/abc-defg-hij' AND e.is_private
              AND jsonb_array_length(e.attendees) = 2,
    'a location patch changes the place and nothing else', r);

  r := test.as_user('O', pg_temp.update_sql('October update', '{"attendees": [{"email": "Nora@Example.com", "name": "Nora"}]}'));
  e := pg_temp.ev('October update');
  PERFORM test.ok(r = 'ok 1' AND jsonb_array_length(e.attendees) = 1
              AND e.attendees -> 0 ->> 'email' = 'nora@example.com',
    'an attendees patch replaces the people, normalised', r);

  r := test.as_user('O', pg_temp.update_sql('October update', '{"conferenceUrl": "https://us02web.zoom.us/j/9"}'));
  e := pg_temp.ev('October update');
  PERFORM test.ok(r = 'ok 1' AND e.conference_url = 'https://us02web.zoom.us/j/9' AND e.conference_provider = 'zoom',
    'a new link brings its provider', r);

  r := test.as_user('O', pg_temp.update_sql('October update', '{"conferenceUrl": null}'));
  e := pg_temp.ev('October update');
  PERFORM test.ok(r = 'ok 1' AND e.conference_url IS NULL AND e.conference_provider IS NULL,
    'conferenceUrl null removes the link and its provider', r);

  r := test.as_user('O', pg_temp.update_sql('October update', '{"isPrivate": false}'));
  PERFORM test.ok(r = 'ok 1' AND NOT (pg_temp.ev('October update')).is_private, 'privacy turns off', r);

  r := test.as_user('O', pg_temp.update_sql('October update', '{"conferenceUrl": "mailto:x@y.z"}'));
  PERFORM test.ok(r LIKE '%web address%' AND (pg_temp.ev('October update')).conference_url IS NULL,
    'update refuses a link that is not a web address', r);
  r := test.as_user('O', pg_temp.update_sql('October update', '{"attendees": [{"email": "nope"}]}'));
  PERFORM test.ok(r LIKE '%email address%', 'update refuses a guest without a real email', r);
  r := test.as_user('O', pg_temp.update_sql('October update', '{"kind": "hold"}'));
  PERFORM test.ok(r LIKE '%Held times come from an offer%', 'update can''t make a hold', r);
  r := test.as_user('O', pg_temp.update_sql('October update', jsonb_build_object('focusTaskId', test.id('T'))));
  PERFORM test.ok(r LIKE '%Only focus time can hold a task%', 'update can''t put a task on a plain event', r);

  r := test.as_user('O', pg_temp.update_sql('October update', jsonb_build_object('kind', 'focus', 'focusTaskId', test.id('T'))));
  e := pg_temp.ev('October update');
  PERFORM test.ok(r = 'ok 1' AND e.kind = 'focus' AND e.focus_task_id = test.id('T'),
    'kind and task change together', r);
  r := test.as_user('O', pg_temp.update_sql('October update', '{"kind": "event"}'));
  e := pg_temp.ev('October update');
  PERFORM test.ok(r = 'ok 1' AND e.kind = 'event' AND e.focus_task_id IS NULL,
    'back to a plain event, the task lets go', r);

  r := test.as_user('M', pg_temp.update_sql('October update', '{"location": "Mine now"}'));
  PERFORM test.ok(r NOT LIKE 'ok%' AND (pg_temp.ev('October update')).location = 'Café Lisboa',
    'a teammate can''t edit your event', r);
END;
$$;

-- The mirror writes the provider's meeting link into the new columns.
DO $$
DECLARE
  r text;
  e public.calendar_events;
BEGIN
  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
         test.id('W'), test.id('A'), jsonb_build_array(
           jsonb_build_object('externalEventId', 'g1', 'title', 'Old client', 'startsAt', '2026-11-05T10:00:00Z',
             'endsAt', '2026-11-05T11:00:00Z', 'location', 'https://meet.google.com/old-clie-ntx'),
           jsonb_build_object('externalEventId', 'g2', 'title', 'New client', 'startsAt', '2026-11-05T12:00:00Z',
             'endsAt', '2026-11-05T13:00:00Z', 'location', 'Room 1', 'conferenceUrl', 'https://meet.google.com/new-clie-ntx'),
           jsonb_build_object('externalEventId', 'g3', 'title', 'Bad link', 'startsAt', '2026-11-05T14:00:00Z',
             'endsAt', '2026-11-05T15:00:00Z', 'conferenceUrl', 'javascript:alert(1)'))));
  PERFORM test.ok(r = 'ok 1', 'the mirror accepts the batch', r);
  e := pg_temp.ev('Old client');
  PERFORM test.ok(e.location IS NULL AND e.conference_url = 'https://meet.google.com/old-clie-ntx'
              AND e.conference_provider = 'google_meet',
    'a meeting URL sent as location (older clients) lands in the link', e.location);
  e := pg_temp.ev('New client');
  PERFORM test.ok(e.location = 'Room 1' AND e.conference_url = 'https://meet.google.com/new-clie-ntx'
              AND e.conference_provider = 'google_meet',
    'conferenceUrl lands in the link beside the place');
  e := pg_temp.ev('Bad link');
  PERFORM test.ok(e.id IS NOT NULL AND e.conference_url IS NULL,
    'a link that is no web address is dropped, the event still mirrors');

  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
         test.id('W'), test.id('A'), jsonb_build_array(
           jsonb_build_object('externalEventId', 'g2', 'title', 'New client', 'startsAt', '2026-11-05T12:00:00Z',
             'endsAt', '2026-11-05T13:00:00Z'))));
  e := pg_temp.ev('New client');
  PERFORM test.ok(r = 'ok 1' AND e.location = 'Room 1' AND e.conference_url = 'https://meet.google.com/new-clie-ntx',
    'keys left out keep what is stored', r);
  r := test.as_user('O', format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
         test.id('W'), test.id('A'), jsonb_build_array(
           jsonb_build_object('externalEventId', 'g2', 'title', 'New client', 'startsAt', '2026-11-05T12:00:00Z',
             'endsAt', '2026-11-05T13:00:00Z', 'conferenceUrl', NULL))));
  e := pg_temp.ev('New client');
  PERFORM test.ok(r = 'ok 1' AND e.conference_url IS NULL AND e.conference_provider IS NULL,
    'conferenceUrl null is the provider saying the link is gone', r);
END;
$$;

-- Signatures and grants.
DO $$
BEGIN
  PERFORM test.ok(to_regprocedure('public.calendar_op_event_create(uuid,text,timestamptz,timestamptz,boolean,text,text)') IS NULL,
    'the old create signature is gone (no overloads)');
  PERFORM test.ok((SELECT count(*) FROM pg_proc WHERE proname = 'calendar_op_event_create'
                     AND pronamespace = 'public'::regnamespace) = 1,
    'one calendar_op_event_create');
  PERFORM test.ok(has_function_privilege('authenticated',
                    (SELECT oid FROM pg_proc WHERE proname = 'calendar_op_event_create' AND pronamespace = 'public'::regnamespace), 'EXECUTE')
              AND NOT has_function_privilege('anon',
                    (SELECT oid FROM pg_proc WHERE proname = 'calendar_op_event_create' AND pronamespace = 'public'::regnamespace), 'EXECUTE'),
    'create: signed-in people may call it, anon may not');
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.calendar__split_location(text)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.calendar__split_location(text)', 'EXECUTE'),
    'the split helper is internal');
END;
$$;

-- Follow-ups from the validator: brackets, the booking host's marker, a cap on people.
DO $$
DECLARE
  r text;
  s record;
  e public.calendar_events;
BEGIN
  SELECT * INTO s FROM public.calendar__split_location('Call (https://zoom.us/j/9)');
  PERFORM test.ok(s.place = 'Call' AND s.url = 'https://zoom.us/j/9', 'no empty brackets are left in the place', s::text);

  r := test.as_user('O', pg_temp.create_sql('Booked', $x$,
         p_attendees => '[{"email": "o@example.com", "self": true}, {"email": "guest@example.com", "self": "yes"}]'$x$));
  e := pg_temp.ev('Booked');
  PERFORM test.ok(r = 'ok 1' AND (e.attendees -> 0 -> 'self') = 'true'::jsonb AND NOT (e.attendees -> 1 ? 'self'),
    'the host''s self: true survives normalising; anything else is dropped', e.attendees::text);

  r := test.try('O', pg_temp.create_sql('Crowd', format($x$, p_attendees => %L$x$,
         (SELECT jsonb_agg(jsonb_build_object('email', 'p' || i || '@example.com')) FROM generate_series(1, 201) i))));
  PERFORM test.ok(r LIKE '%up to 200 people%', 'an event takes up to 200 people', r);
END;
$$;
