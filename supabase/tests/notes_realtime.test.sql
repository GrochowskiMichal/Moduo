-- NR-7: a note's live channel (supabase/migrations/20261016120000_notes_live_channel.sql).
--
-- Cast: O owns workspace W and the private note N. E has an edit share on N,
-- V a view share. M is a member with no share; X is in no workspace. Each
-- person listens on their own topic `notes-live:<uid>`; the server says who
-- is viewing and hands saved updates to the people who have the note open.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'M', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['E', 'V', 'M']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.notes (id, workspace_id, created_by, title, share_mode)
VALUES (test.id('N'), test.id('W'), test.id('O'), 'Board plan', 'custom');
DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = test.id('N');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('N'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'note', test.id('N'), 'member', test.id('V'), 'view', test.id('O'));

-- What the server told a person's own topic, by event.
CREATE FUNCTION test.told(p_who text, p_event text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM realtime.messages
  WHERE topic = 'notes-live:' || test.id(p_who)::text AND event = p_event AND private
    AND payload ->> 'noteId' = test.id('N')::text
$$;
-- Messages within one transaction share a timestamp, so tests ask whether a
-- message with some content was sent, not which one came last.
CREATE FUNCTION test.told_with(p_who text, p_event text, p_has jsonb) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM realtime.messages
    WHERE topic = 'notes-live:' || test.id(p_who)::text AND event = p_event AND payload @> p_has)
$$;
-- A "viewers" message to p_who that leaves p_missing out.
CREATE FUNCTION test.told_without(p_who text, p_missing text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM realtime.messages
    WHERE topic = 'notes-live:' || test.id(p_who)::text AND event = 'viewers'
      AND NOT payload -> 'viewers' @> to_jsonb(ARRAY[test.id(p_missing)::text]))
$$;
CREATE FUNCTION test.here(p_who text, p_session text DEFAULT 's1', p_leaving boolean DEFAULT false)
RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT public.notes_live_here(%L, %L, %L)::text$q$,
                                     test.id('N'), p_session, p_leaving))
$$;
-- Saved updates are sent at commit. The test is one transaction that rolls
-- back, so "commit" here is switching the deferred trigger to immediate,
-- which runs what is waiting, then back.
CREATE FUNCTION test.commit_point() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET CONSTRAINTS public.notes_live_send_pending IMMEDIATE;
  SET CONSTRAINTS public.notes_live_send_pending DEFERRED;
END;
$$;
CREATE FUNCTION test.save(p_seq int, p_origin text DEFAULT 'user', p_b64 text DEFAULT 'AQ==') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.note_updates (workspace_id, note_id, client_id, client_seq, update_b64, origin)
  VALUES (test.id('W'), test.id('N'), 'probe', p_seq, p_b64, p_origin);
  PERFORM test.commit_point();
END;
$$;
-- A join the way Realtime authorizes it: the topic for the connection, then the policy.
CREATE FUNCTION test.reads(p_who text, p_topic text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('realtime.topic', p_topic, true);
  v := test.value_as(p_who, format($q$SELECT count(*)::text FROM realtime.messages WHERE topic = %L$q$, p_topic));
  PERFORM set_config('realtime.topic', '', true);
  RETURN v::int;
END;
$$;
CREATE FUNCTION test.writes(p_who text, p_topic text, p_extension text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('realtime.topic', p_topic, true);
  v := test.as_user(p_who, format(
    $q$INSERT INTO realtime.messages (topic, extension, payload, event, private) VALUES (%L, %L, '{}'::jsonb, 'viewers', true)$q$,
    p_topic, p_extension));
  PERFORM set_config('realtime.topic', '', true);
  RETURN v;
END;
$$;

DO $$
DECLARE
  i int;
  v text;
  o text := test.id('O')::text;
  vv text := test.id('V')::text;
BEGIN
  -- ── Presence: the server says who, from the session ────────────────────────
  v := test.here('O');
  PERFORM test.ok(v = format('{%s}', o), 'here: O opens N and is the only viewer', v);
  v := test.here('V');
  PERFORM test.ok(v LIKE '%' || o || '%' AND v LIKE '%' || vv || '%', 'here: V (view share) opens N and sees O and V', v);
  PERFORM test.ok(test.told_with('O', 'viewers', jsonb_build_object('viewers', jsonb_build_array(vv))),
    'here: O is told V is viewing, by the server');
  v := test.here('M');
  PERFORM test.ok(v IS NULL, 'here: M, without a share, is refused', v);
  v := test.here('X');
  PERFORM test.ok(v IS NULL, 'here: X, outside the workspace, is refused', v);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.note_live_viewers WHERE user_id IN (test.id('M'), test.id('X'))),
    'here: a refused person is never recorded as viewing');
  PERFORM test.ok(NOT test.told_with('O', 'viewers', jsonb_build_object('viewers', jsonb_build_array(test.id('M')::text))),
    'here: so they never appear in anyone''s facepile');
  PERFORM test.ok(test.told('M', 'viewers') = 0 AND test.told('X', 'viewers') = 0,
    'here: and they are told nothing');

  -- ── Saved updates reach the people viewing, inline ────────────────────────
  PERFORM test.save(1);
  PERFORM test.ok(test.told('V', 'changed') = 1
              AND test.told_with('V', 'changed', '{"updates": ["AQ=="]}'),
    'save: a viewer gets the saved update inline');
  PERFORM test.ok(test.told('O', 'changed') = 1, 'save: so does O');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.note_live_pending), 'save: nothing is left waiting after commit');
  PERFORM test.ok(test.told('M', 'changed') = 0 AND test.told('E', 'changed') = 0,
    'save: people without the note open (or without access) get nothing');

  -- The app's save: several updates in one call are ONE message, in order.
  v := test.as_user('E', format(
    $q$SELECT public.notes_op_apply_updates(%L, %L, 'tab-e', '[{"clientSeq": 1, "updateB64": "Ag=="}, {"clientSeq": 2, "updateB64": "Aw=="}, {"clientSeq": 3, "updateB64": "BA=="}]'::jsonb)$q$,
    test.id('W'), test.id('N')));
  PERFORM test.commit_point();
  PERFORM test.ok(v LIKE 'ok %' AND test.told('V', 'changed') = 2
              AND test.told_with('V', 'changed', '{"updates": ["Ag==", "Aw==", "BA=="]}'),
    'save: one save of three updates is one message, in order', v);
  -- A message that can't be sent never fails the save.
  v := test.as_user('E', format(
    $q$SELECT public.notes_op_apply_updates(%L, %L, 'tab-e', '[{"clientSeq": 4, "updateB64": "BQ=="}]'::jsonb)$q$,
    test.id('W'), test.id('N')));
  ALTER FUNCTION public.notes_live__tell(uuid, text, jsonb) RENAME TO notes_live__tell_off;
  BEGIN
    PERFORM test.commit_point();
    PERFORM test.ok(true, 'save: a failing send doesn''t fail the save');
  EXCEPTION WHEN OTHERS THEN
    PERFORM test.ok(false, 'save: a failing send doesn''t fail the save', SQLERRM);
  END;
  ALTER FUNCTION public.notes_live__tell_off(uuid, text, jsonb) RENAME TO notes_live__tell;

  -- An agent's write is announced, never relayed (clients pull the stored row).
  PERFORM test.save(2, 'api_key');
  PERFORM test.ok(test.told('V', 'changed') = 3
              AND (SELECT count(*) FROM realtime.messages WHERE topic = 'notes-live:' || vv
                   AND event = 'changed' AND payload @> '{"pull": true}' AND NOT payload ? 'updates') = 1,
    'save: an agent write goes out content-free (pull)');
  -- A big update is announced too.
  PERFORM test.save(3, 'user', repeat('A', 70000));
  PERFORM test.ok(test.told('V', 'changed') = 4
              AND NOT EXISTS (SELECT 1 FROM realtime.messages WHERE topic = 'notes-live:' || vv
                              AND payload::text LIKE '%AAAAAAAAAA%'),
    'save: an oversized update is pulled, not relayed');

  -- ── Taking the share away cuts V off at the next save ─────────────────────
  DELETE FROM public.resource_grants
  WHERE resource_type = 'note' AND resource_id = test.id('N') AND subject_id = test.id('V');
  PERFORM test.save(4);
  PERFORM test.ok(test.told('V', 'changed') = 4, 'revoke: V hears nothing after the share is gone', test.told('V', 'changed')::text);
  PERFORM test.ok(test.told('O', 'changed') = 5, 'revoke: O still does', test.told('O', 'changed')::text);
  v := test.here('V');
  PERFORM test.ok(v IS NULL, 'revoke: V''s next heartbeat is refused', v);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.note_live_viewers WHERE user_id = test.id('V')),
    'revoke: and V is no longer recorded as viewing');
  PERFORM test.ok(test.told_without('O', 'V'), 'revoke: O is told V left');

  -- ── Closing a tab ─────────────────────────────────────────────────────────
  PERFORM test.here('E', 'a');
  PERFORM test.here('E', 'b');
  PERFORM test.here('E', 'a', true);
  PERFORM test.ok(test.id('E') = ANY (public.notes_live__viewers(test.id('N'))),
    'leave: E closing one of two tabs is still viewing');
  PERFORM test.here('E', 'b', true);
  PERFORM test.ok(NOT (test.id('E') = ANY (public.notes_live__viewers(test.id('N'))))
              AND test.told_without('O', 'E'),
    'leave: closing the last tab leaves, and O is told');
  -- Made-up session ids can't pile up: a person keeps at most five tabs.
  FOR i IN 1..12 LOOP PERFORM test.here('E', 'spam' || i); END LOOP;
  PERFORM test.ok((SELECT count(*) FROM public.note_live_viewers WHERE user_id = test.id('E')) = 5,
    'leave: at most five tabs per person are kept');
  -- A tab that went quiet ages out.
  UPDATE public.note_live_viewers SET seen_at = now() - interval '2 minutes';
  PERFORM test.ok(public.notes_live__viewers(test.id('N')) = '{}', 'leave: a quiet tab ages out after a minute');

  -- ── The topics: your own, read-only ───────────────────────────────────────
  PERFORM test.ok(test.reads('O', 'notes-live:' || o) > 0, 'topic: O reads their own topic');
  PERFORM test.ok(test.reads('M', 'notes-live:' || o) = 0, 'topic: M can''t read O''s');
  PERFORM test.ok(test.reads('V', 'notes-live:' || o) = 0, 'topic: nor can V');
  v := test.writes('O', 'notes-live:' || o, 'broadcast');
  PERFORM test.ok(v LIKE '42501 %', 'topic: nobody can broadcast, not even on their own topic', v);
  v := test.writes('O', 'notes-live:' || o, 'presence');
  PERFORM test.ok(v LIKE '42501 %', 'topic: nobody can track presence on it', v);
  v := test.writes('E', 'note:' || test.id('N')::text, 'broadcast');
  PERFORM test.ok(v LIKE '42501 %', 'topic: there is no per-note topic to send on', v);

  -- ── Grants ───────────────────────────────────────────────────────────────
  PERFORM test.ok(has_function_privilege('authenticated', 'public.notes_live_here(uuid, text, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.notes_live_here(uuid, text, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.notes_live__tell(uuid, text, jsonb)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.notes_live__viewers(uuid)', 'EXECUTE'),
    'grants: only the heartbeat is callable, by signed-in people');
  PERFORM test.ok(test.value_as('O', 'SELECT count(*)::text FROM public.note_live_viewers') LIKE 'ERROR %',
    'grants: nobody reads the viewers table directly');
END;
$$;
