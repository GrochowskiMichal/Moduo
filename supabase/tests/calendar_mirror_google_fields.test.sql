-- Google two-way (CALR-8, specs/calendar-rethink.md AC43): the mirror stores
-- what Google answers about privacy and guests, so a Google-first edit reads
-- back as saved (supabase/migrations/20261028120000_calendar_mirror_google_fields.sql).
-- Key present = the provider's truth; key absent keeps what is stored. A guest
-- list Google sends that we can't read never wedges the sync.
--
-- Cast: O owns workspace W and its Google account A.

SELECT test.person('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Hale & Co');
INSERT INTO public.calendar_accounts (id, workspace_id, owner_id, provider, external_id, display_label)
VALUES (test.id('A'), test.id('W'), test.id('O'), 'google', 'o@example.com', 'o@example.com');

CREATE FUNCTION pg_temp.mirror(p_extra jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT public.calendar_op_mirror_events(%L, %L, %L::jsonb)$q$,
    md5('db-test:W')::uuid, md5('db-test:A')::uuid,
    jsonb_build_array(jsonb_build_object('externalEventId', 'g1', 'title', 'Board',
      'startsAt', '2026-11-05T10:00:00Z', 'endsAt', '2026-11-05T11:00:00Z') || p_extra))
$$;
CREATE FUNCTION pg_temp.g1() RETURNS public.calendar_events LANGUAGE sql AS $$
  SELECT * FROM public.calendar_events
   WHERE source_account_id = md5('db-test:A')::uuid AND external_event_id = 'g1'
$$;

DO $$
DECLARE
  r text;
  v_stamp timestamptz;
BEGIN
  r := test.as_user('O', pg_temp.mirror(jsonb_build_object('isPrivate', true,
         'attendees', jsonb_build_array(
           jsonb_build_object('email', 'Priya@Example.com', 'name', 'Priya', 'status', 'accepted'),
           jsonb_build_object('email', 'o@example.com', 'self', true)))));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.g1()).is_private
              AND jsonb_array_length((pg_temp.g1()).attendees) = 2
              AND (pg_temp.g1()).attendees -> 0 ->> 'email' = 'priya@example.com'
              AND (pg_temp.g1()).attendees -> 0 ->> 'status' = 'accepted'
              AND (pg_temp.g1()).attendees -> 1 -> 'self' = 'true'::jsonb,
    'a new mirrored event stores privacy and guests, normalised', r);

  v_stamp := (pg_temp.g1()).updated_at;
  r := test.as_user('O', pg_temp.mirror(jsonb_build_object('isPrivate', true,
         'attendees', jsonb_build_array(
           jsonb_build_object('email', 'Priya@Example.com', 'name', 'Priya', 'status', 'accepted'),
           jsonb_build_object('email', 'o@example.com', 'self', true)))));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.g1()).updated_at = v_stamp,
    'the same privacy and guests again rewrite nothing', r);

  r := test.as_user('O', pg_temp.mirror('{}'::jsonb));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.g1()).is_private AND jsonb_array_length((pg_temp.g1()).attendees) = 2,
    'keys left out keep what is stored', r);

  r := test.as_user('O', pg_temp.mirror(jsonb_build_object('isPrivate', false,
         'attendees', jsonb_build_array(jsonb_build_object('email', 'nora@example.com', 'status', 'needsAction')))));
  PERFORM test.ok(r = 'ok 1' AND NOT (pg_temp.g1()).is_private
              AND (pg_temp.g1()).attendees = '[{"email": "nora@example.com", "name": "", "status": "needsAction"}]'::jsonb
              AND (pg_temp.g1()).updated_at > v_stamp,
    'a change in privacy or guests is written and re-stamped', r);

  r := test.as_user('O', pg_temp.mirror(jsonb_build_object('title', 'Board (moved)',
         'attendees', jsonb_build_array(jsonb_build_object('name', 'no email')))));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.g1()).title = 'Board (moved)'
              AND (pg_temp.g1()).attendees -> 0 ->> 'email' = 'nora@example.com',
    'a guest list we can''t read keeps the stored one, and the rest of the event still mirrors', r);

  r := test.as_user('O', pg_temp.mirror(jsonb_build_object('attendees', '[]'::jsonb)));
  PERFORM test.ok(r = 'ok 1' AND (pg_temp.g1()).attendees = '[]'::jsonb,
    'an empty guest list clears the guests', r);
END;
$$;
