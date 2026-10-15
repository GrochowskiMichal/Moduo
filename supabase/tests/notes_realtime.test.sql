-- NR-7: a note's private live channel (supabase/migrations/20261016120000_notes_live_channel.sql).
--
-- Cast: O owns workspace W and the private note N, with an inheriting
-- sub-note NC. E has an edit share on N, V a view share. M is a member with no
-- share; X is in no workspace. Realtime authorizes a join by setting the topic
-- for the connection and reading (or, to send/track, inserting into)
-- realtime.messages as the person, through these policies.

SELECT test.person(n) FROM unnest(ARRAY['O', 'E', 'V', 'M', 'X']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['E', 'V', 'M']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;

INSERT INTO public.notes (id, workspace_id, created_by, title, share_mode)
VALUES (test.id('N'), test.id('W'), test.id('O'), 'Board plan', 'custom');
INSERT INTO public.notes (id, workspace_id, created_by, parent_id, title, share_mode)
VALUES (test.id('NC'), test.id('W'), test.id('O'), test.id('N'), 'Board plan / numbers', 'inherit');
DELETE FROM public.resource_grants WHERE resource_type = 'note' AND resource_id IN (test.id('N'), test.id('NC'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'note', test.id('N'), 'member', test.id('E'), 'edit', test.id('O')),
       (test.id('W'), 'note', test.id('N'), 'member', test.id('V'), 'view', test.id('O'));

-- A read of realtime.messages the way Realtime authorizes a join.
CREATE FUNCTION test.realtime_reads(p_who text, p_topic text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('realtime.topic', p_topic, true);
  v := test.value_as(p_who, format($q$SELECT count(*)::text FROM realtime.messages WHERE topic = %L$q$, p_topic));
  PERFORM set_config('realtime.topic', '', true);
  RETURN v::int;
END;
$$;
-- A send (broadcast) or a track (presence), authorized the same way.
CREATE FUNCTION test.realtime_writes(p_who text, p_topic text, p_extension text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('realtime.topic', p_topic, true);
  v := test.as_user(p_who, format(
    $q$INSERT INTO realtime.messages (topic, extension, payload, event, private) VALUES (%L, %L, '{}'::jsonb, 'probe', true)$q$,
    p_topic, p_extension));
  PERFORM set_config('realtime.topic', '', true);
  RETURN v;
END;
$$;

DO $$
DECLARE
  v_n text := 'note:' || test.id('N')::text;
  v_nc text := 'note:' || test.id('NC')::text;
  v text;
BEGIN
  -- What's on the channel: an edit and a presence entry, as Realtime stores them.
  INSERT INTO realtime.messages (topic, extension, payload, event, private)
  VALUES (v_n, 'broadcast', '{"b64": "AA=="}', 'u', true),
         (v_n, 'presence', '{}', 'presence', true),
         (v_nc, 'broadcast', '{"origin": "api_key"}', 'u', true);

  -- ── Listening: view access and up ──────────────────────────────────────────
  PERFORM test.ok(test.realtime_reads('O', v_n) = 2, 'read: O, who made N, hears its channel');
  PERFORM test.ok(test.realtime_reads('E', v_n) = 2, 'read: E (edit share) hears N');
  PERFORM test.ok(test.realtime_reads('V', v_n) = 2, 'read: V (view share) hears N');
  PERFORM test.ok(test.realtime_reads('M', v_n) = 0, 'read: M, a member N isn''t shared with, hears nothing');
  PERFORM test.ok(test.realtime_reads('X', v_n) = 0, 'read: X, outside the workspace, hears nothing');
  PERFORM test.ok(test.realtime_reads('V', v_nc) = 1, 'read: V hears the sub-note NC, which inherits N''s access');
  PERFORM test.ok(test.realtime_reads('M', v_nc) = 0, 'read: M hears nothing on NC either');

  -- ── Presence: view access and up ───────────────────────────────────────────
  v := test.realtime_writes('V', v_n, 'presence');
  PERFORM test.ok(v = 'ok 1', 'presence: V appears on N', v);
  v := test.realtime_writes('E', v_n, 'presence');
  PERFORM test.ok(v = 'ok 1', 'presence: E appears on N', v);
  v := test.realtime_writes('M', v_n, 'presence');
  PERFORM test.ok(v LIKE '42501 %', 'presence: M never appears on N', v);
  v := test.realtime_writes('X', v_n, 'presence');
  PERFORM test.ok(v LIKE '42501 %', 'presence: X never appears on N', v);

  -- ── Sending edits: edit access and up ──────────────────────────────────────
  v := test.realtime_writes('E', v_n, 'broadcast');
  PERFORM test.ok(v = 'ok 1', 'send: E relays edits on N', v);
  v := test.realtime_writes('O', v_n, 'broadcast');
  PERFORM test.ok(v = 'ok 1', 'send: O relays edits on N', v);
  v := test.realtime_writes('V', v_n, 'broadcast');
  PERFORM test.ok(v LIKE '42501 %', 'send: V (view only) can listen but not send', v);
  v := test.realtime_writes('M', v_n, 'broadcast');
  PERFORM test.ok(v LIKE '42501 %', 'send: M cannot send on N', v);
  v := test.realtime_writes('E', v_nc, 'broadcast');
  PERFORM test.ok(v = 'ok 1', 'send: E relays edits on the inheriting NC', v);

  -- ── The old public topic and other shapes get nothing from these policies ──
  v := test.realtime_writes('E', 'notes:' || test.id('N')::text, 'broadcast');
  PERFORM test.ok(v LIKE '42501 %', 'topics: no private send on the retired notes:<id> name', v);
  v := test.realtime_writes('E', upper(v_n), 'broadcast');
  PERFORM test.ok(v LIKE '42501 %', 'topics: a topic not in the exact note:<uuid> shape is refused', v);
  v := test.realtime_writes('E', 'chat:' || test.id('W')::text, 'presence');
  PERFORM test.ok(v LIKE '42501 %', 'topics: note access opens no chat topic', v);
  PERFORM test.ok(NOT public.notes_realtime_topic_allowed(v_n, 'full')
              AND NOT public.notes_realtime_topic_allowed(v_n, NULL)
              AND NOT public.notes_realtime_topic_allowed(NULL, 'view'),
    'topics: only view/edit are asked, and nothing answers yes to a NULL');
  v := test.realtime_writes('E', v_n, 'postgres_changes');
  PERFORM test.ok(v LIKE '42501 %', 'topics: only broadcast and presence are allowed', v);

  -- ── Taking the share back closes the channel to V ─────────────────────────
  DELETE FROM public.resource_grants
  WHERE resource_type = 'note' AND resource_id = test.id('N') AND subject_id = test.id('V');
  PERFORM test.ok(test.realtime_reads('V', v_n) = 0, 'revoke: V hears nothing once N is no longer shared');
  v := test.realtime_writes('V', v_n, 'presence');
  PERFORM test.ok(v LIKE '42501 %', 'revoke: and no longer appears in presence', v);

  -- ── Grants ─────────────────────────────────────────────────────────────────
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.notes_realtime_topic_allowed(text, text)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.notes_realtime_topic_allowed(text, text)', 'EXECUTE'),
    'grants: signed-in people only, never anon');
  PERFORM test.ok((SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'
                   AND policyname IN ('notes_realtime_read', 'notes_realtime_write')
                   AND roles = '{authenticated}') = 2,
    'policies: both notes policies are on realtime.messages, for signed-in people');
END;
$$;
