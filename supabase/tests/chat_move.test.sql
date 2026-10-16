-- Chat v2 · CV-16 "Move to…" (AC8.6, AC5.6;
-- supabase/migrations/…_chat_v2_move_messages.sql). The audience rule: your
-- own messages move anywhere, with the count of people who couldn't read the
-- source answered first; someone else's only by the source's managers and
-- admins, and only to a same-or-narrower audience. A root brings its chain, a
-- reply moved alone leaves its chain, pins drop, nothing pings again; one
-- quiet line in each conversation; Undo puts everything back. The person
-- comes from the session; outsiders, viewers and keys can't move anything.
--
-- Cast: O owns workspace W (Duo, an admin). A, B, C are members; V is a
-- viewer; X is a member outside every private conversation. Q is a public
-- channel A makes (A manages it) with B, C and V; F ("founders") is private
-- with A, B and C; P is private with A and B; D is B and C's direct message.
-- K is A's API key.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'V', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moves');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('C'), 'member'),
  (test.id('W'), test.id('X'), 'member'),
  (test.id('W'), test.id('V'), 'viewer')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv16'),
        '{"chat": "edit"}'::jsonb, test.id('A'));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
CREATE FUNCTION test.msg(p_name text) RETURNS public.chat_messages LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_messages WHERE id = test.mid(p_name)
$$;
CREATE SEQUENCE test.tick;
CREATE FUNCTION test.post(p_who text, p_conv text, p_name text, p_to text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := test.as_user(p_who, format($q$SELECT id FROM public.chat_op_send(%L::uuid, %L::uuid, %L::text, %L::uuid)$q$,
    test.mid(p_name), test.ref(p_conv), 'message ' || p_name,
    CASE WHEN p_to IS NULL THEN NULL ELSE test.mid(p_to) END));
  UPDATE public.chat_messages SET created_at = now() + nextval('test.tick') * interval '1 second'
   WHERE id = test.mid(p_name);
  RETURN v;
END;
$$;
-- Moves the named messages as p_who (through RLS, the person from the
-- session, or a key): the op's answer, or "<sqlstate> <message>".
CREATE FUNCTION test.mv(p_who text, p_names text[], p_conv text, p_confirm boolean DEFAULT false,
                        p_undo boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
  v_state text;
  v_msg text;
  v_sql text := format($q$SELECT public.chat_op_move_messages(%L::uuid[], %L::uuid, %L, %L)::text$q$,
    ARRAY(SELECT test.mid(n) FROM unnest(p_names) n), test.ref(p_conv), p_confirm, p_undo);
BEGIN
  BEGIN
    IF p_who = 'K' THEN
      PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
      PERFORM set_config('request.headers', json_build_object('x-moduo-key-id', test.id('K'))::text, true);
      SET LOCAL ROLE service_role;
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', test.id(p_who), 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
    END IF;
    EXECUTE v_sql INTO v;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    PERFORM set_config('request.headers', '{}', true);
    RETURN v;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{}', true);
    PERFORM set_config('request.headers', '{}', true);
    RETURN v_state || ' ' || v_msg;
  END;
END;
$$;
-- The newest move line of a type in a conversation, deleted or not.
CREATE FUNCTION test.line(p_conv text, p_type text) RETURNS public.chat_messages LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_messages
   WHERE channel_id = test.ref(p_conv) AND kind = 'event' AND event ->> 'type' = p_type
   ORDER BY created_at DESC, updated_at DESC LIMIT 1
$$;
-- Can p_who read the named message (through RLS)?
CREATE FUNCTION test.sees(p_who text, p_name text) RETURNS boolean LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.chat_messages WHERE id = %L$q$,
    test.mid(p_name))) = '1'
$$;

-- ── Setup ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'questions', '', false, ARRAY[%L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C'), test.id('V')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q with B, C and V', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'questions';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'founders', '', true, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel F with B and C', v);
  INSERT INTO test.ids SELECT 'F', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'founders';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'pair', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'pair';
  v := test.value_as('B', format($q$SELECT id::text FROM public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('C')));
  PERFORM test.ok(v ~ '^[0-9a-f-]{36}$', 'setup: B opens a direct message with C', v);
  INSERT INTO test.ids VALUES ('D', v::uuid);
END;
$$;

-- ── The audience rule: your own message into a wider audience ──────────────
DO $$
DECLARE
  v text;
  j jsonb;
BEGIN
  PERFORM test.ok(test.post('B', 'P', 'b1') LIKE 'ok %', 'B posts b1 in the private channel P');
  v := test.mv('B', ARRAY['b1'], 'Q');
  j := v::jsonb;
  PERFORM test.ok(j ->> 'status' = 'confirm' AND (j ->> 'newly')::int = 4,
    'moving your own message into Q first answers how many people couldn''t read P (O, C, V, X: 4)', v);
  PERFORM test.ok((test.msg('b1')).channel_id = test.ref('P') AND test.line('P', 'moved_out') IS NULL,
    'nothing moved before the confirm');
  PERFORM test.ok(NOT test.sees('X', 'b1'), 'X can''t read b1 yet');

  v := test.mv('B', ARRAY['b1'], 'Q', true);
  j := v::jsonb;
  PERFORM test.ok(j ->> 'status' = 'moved', 'confirmed, it moves', v);
  PERFORM test.ok((test.msg('b1')).channel_id = test.ref('Q')
              AND (test.msg('b1')).author_id = test.id('B')
              AND (test.msg('b1')).moved_by = test.id('B')
              AND (test.msg('b1')).moved_from_channel_id = test.ref('P')
              AND (test.msg('b1')).moved_at IS NOT NULL,
    'the moved message keeps its author and records who moved it, when and from where');
  PERFORM test.ok(test.sees('X', 'b1'), 'X reads it in Q now');
  PERFORM test.ok((test.line('P', 'moved_out')).author_id = test.id('B')
              AND (test.line('P', 'moved_out')).event -> 'ids' = jsonb_build_array(test.mid('b1'))
              AND (test.line('P', 'moved_out')).event ->> 'to' = 'moduo://chat_channel/' || test.ref('Q'),
    'P gets a moved_out line: who, which ids, where to');
  PERFORM test.ok((test.line('Q', 'moved_in')).author_id = test.id('B')
              AND (test.line('Q', 'moved_in')).event ->> 'from' = 'moduo://chat_channel/' || test.ref('P')
              AND ((test.line('Q', 'moved_in')).event ->> 'count')::int = 1,
    'Q gets a moved_in line naming P as a reference (read as "Private item" by those who can''t)');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_catchup k WHERE k.message_id = test.mid('b1')
                                AND k.user_id IN (test.id('O'), test.id('C'), test.id('V'), test.id('X'))),
    'nothing pings the people who newly see it');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity
                           WHERE workspace_id = test.id('W') AND op = 'chat.move'
                             AND payload ->> 'to_id' = test.ref('Q')::text AND actor_id = test.id('B')),
    'History records the move');
END;
$$;

-- ── Undo ────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.mv('C', ARRAY['b1'], 'P', false, true);
  PERFORM test.ok(v LIKE '42501 %' OR v LIKE 'P0002 %' OR v LIKE '22023 %', 'only the mover undoes (C can''t move B''s message)', v);
  v := test.mv('B', ARRAY['b1'], 'P', false, true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'undone', 'B undoes within the window', v);
  PERFORM test.ok((test.msg('b1')).channel_id = test.ref('P') AND (test.msg('b1')).moved_at IS NULL
              AND (test.msg('b1')).moved_by IS NULL AND (test.msg('b1')).moved_from_channel_id IS NULL,
    'Undo puts it back as it was');
  PERFORM test.ok((test.line('P', 'moved_out')).deleted_at IS NOT NULL
              AND (test.line('Q', 'moved_in')).deleted_at IS NOT NULL,
    'Undo soft-deletes both lines');
  PERFORM test.ok(test.line('Q', 'moved_out') IS NULL AND
                  (SELECT count(*) FROM public.chat_messages WHERE channel_id = test.ref('P')
                     AND kind = 'event' AND event ->> 'type' = 'moved_in') = 0,
    'Undo writes no new lines');
  PERFORM test.ok(NOT test.sees('X', 'b1'), 'X can''t read b1 again');
END;
$$;

-- ── Someone else's messages: managers, same or narrower only ────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.post('B', 'P', 'b2') LIKE 'ok %', 'B posts b2 in P');
  v := test.mv('A', ARRAY['b2'], 'Q');
  PERFORM test.ok(v LIKE '42501 %', 'P''s manager can''t move B''s message into a wider audience', v);
  v := test.mv('A', ARRAY['b2'], 'Q', true);
  PERFORM test.ok(v LIKE '42501 %', '… not even with confirm', v);
  PERFORM test.ok((test.msg('b2')).channel_id = test.ref('P'), 'b2 stayed in P');

  PERFORM test.ok(test.post('C', 'Q', 'c1') LIKE 'ok %', 'C posts c1 in Q');
  v := test.mv('B', ARRAY['c1'], 'F');
  PERFORM test.ok(v LIKE '42501 %', 'a plain member can''t move someone else''s message', v);
  v := test.mv('A', ARRAY['c1'], 'F');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'Q''s manager moves C''s message into the narrower F at once', v);
  PERFORM test.ok((test.msg('c1')).channel_id = test.ref('F') AND (test.msg('c1')).author_id = test.id('C'),
    'it keeps C as its author');

  PERFORM test.ok(test.post('B', 'Q', 'b3') LIKE 'ok %', 'B posts b3 in Q');
  v := test.mv('O', ARRAY['b3'], 'P');
  PERFORM test.ok(v LIKE '42501 %', 'an admin can''t post in P (not in it), so nothing moves there', v);
  v := test.mv('O', ARRAY['b3'], 'D');
  PERFORM test.ok(v LIKE '42501 %' OR v LIKE 'P0002 %', 'nor into a direct message they aren''t in', v);
  PERFORM test.ok(test.post('C', 'Q', 'c2') LIKE 'ok %', 'C posts c2 in Q');
  v := test.as_user('O', format($q$SELECT public.chat_op_join(%L)$q$, test.ref('Q')));
  v := test.as_user('A', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])$q$, test.ref('F'), test.id('O')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: O joins F', v);
  v := test.mv('O', ARRAY['c2'], 'F');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'an admin moves someone else''s message into a narrower audience', v);
END;
$$;

-- ── A root brings its chain; Catch up follows; the left-behind lose it ──────
DO $$
DECLARE
  v text;
  ids uuid[];
BEGIN
  PERFORM test.ok(test.post('A', 'F', 'r') LIKE 'ok %', 'A asks r in F');
  PERFORM test.ok(test.post('B', 'F', 'r1', 'r') LIKE 'ok %', 'B replies r1');
  PERFORM test.ok(test.post('C', 'F', 'r2', 'r1') LIKE 'ok %', 'C replies r2 to r1');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.chat_catchup WHERE chain_root_id = test.mid('r') AND done_at IS NULL),
    'setup: the chain has open Catch up items');
  v := test.mv('A', ARRAY['r'], 'P');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'F''s manager moves the root into the narrower P', v);
  ids := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text((v::jsonb) -> 'ids') x);
  PERFORM test.ok(cardinality(ids) = 3 AND test.mid('r1') = ANY (ids) AND test.mid('r2') = ANY (ids),
    'the whole chain moves with its root', v);
  PERFORM test.ok((test.msg('r1')).channel_id = test.ref('P') AND (test.msg('r2')).channel_id = test.ref('P')
              AND (test.msg('r2')).parent_id = test.mid('r') AND (test.msg('r2')).reply_to_id = test.mid('r1')
              AND (test.msg('r')).reply_count = 2,
    'the chain and its quotes stay whole; the rollup stays right');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_catchup WHERE chain_root_id = test.mid('r')
                                AND done_at IS NULL AND channel_id <> test.ref('P')),
    'open Catch up items follow the chain to P');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_catchup WHERE chain_root_id = test.mid('r')
                                AND user_id = test.id('C') AND done_at IS NULL),
    'C, who can''t read P, has none left open');
  PERFORM test.ok(NOT test.sees('C', 'r2'), 'C can''t read even their own reply in P');
  PERFORM test.ok(EXISTS (SELECT 1 FROM test.ids i,
                            LATERAL (SELECT * FROM test.value_as('C', format(
                              $q$SELECT string_agg(id::text, ',') FROM public.chat_sync_ids(%L) WHERE kind = 'moved_away'$q$,
                              test.id('W')))) s(v)
                           WHERE i.name = 'F' AND s.v LIKE '%' || test.mid('r2')::text || '%'),
    'C''s access check names the moved ids (spike 2), so their copy drops them');
END;
$$;

-- ── A reply moved alone leaves its chain; the settled chain reopens; Undo ───
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.post('A', 'Q', 's') LIKE 'ok %', 'A asks s in Q');
  PERFORM test.ok(test.post('B', 'Q', 's1', 's') LIKE 'ok %', 'B replies s1');
  PERFORM test.ok(test.post('C', 'Q', 's2', 's1') LIKE 'ok %', 'C replies s2');
  v := test.as_user('A', format($q$SELECT id FROM public.chat_op_wrap_up(%L::uuid, %L::uuid)$q$, test.mid('s'), test.mid('s1')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A wraps s up with s1', v);
  v := test.mv('B', ARRAY['s1'], 'D');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'B moves their own reply s1 to the direct message D (narrower)', v);
  PERFORM test.ok((test.msg('s1')).parent_id IS NULL AND (test.msg('s1')).reply_to_id IS NULL
              AND (test.msg('s1')).channel_id = test.ref('D'),
    'a reply moved alone leaves its chain');
  PERFORM test.ok((test.msg('s')).reply_count = 1 AND (test.msg('s')).wrapped_at IS NULL
              AND (test.msg('s')).reopened_by = test.id('B'),
    'the chain it left counts one reply and is open again (it settled it)');
  PERFORM test.ok((test.msg('s2')).reply_to_id IS NULL AND (test.msg('s2')).channel_id = test.ref('Q'),
    'C''s s2, left behind, loses its quote of the moved s1 (a quote stays in its conversation)');
  v := test.mv('B', ARRAY['s1'], 'Q', false, true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'undone', 'B undoes', v);
  PERFORM test.ok((test.msg('s1')).parent_id = test.mid('s') AND (test.msg('s1')).reply_to_id = test.mid('s')
              AND (test.msg('s')).reply_count = 2 AND (test.msg('s1')).channel_id = test.ref('Q'),
    'Undo puts the reply back in its chain');
  PERFORM test.ok((test.msg('s2')).reply_to_id = test.mid('s1'), 'Undo gives s2 its quote back');
  PERFORM test.ok((test.msg('s')).wrapped_at IS NOT NULL AND (test.msg('s')).settled_id = test.mid('s1')
              AND (test.msg('s')).reopened_by IS NULL,
    'Undo wraps the chain up again as it was (settled by s1)');
END;
$$;

-- ── Pins drop; refusals; keys ───────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.post('A', 'Q', 'pin') LIKE 'ok %', 'A posts pin in Q');
  v := test.as_user('A', format($q$SELECT id FROM public.chat_op_pin(%L::uuid, true)$q$, test.mid('pin')));
  PERFORM test.ok((test.msg('pin')).pinned_at IS NOT NULL, 'setup: A pins it', v);
  v := test.mv('A', ARRAY['pin'], 'F');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved' AND (test.msg('pin')).pinned_at IS NULL
              AND (test.msg('pin')).pinned_by IS NULL, 'a moved message loses its pin', v);
  v := test.mv('A', ARRAY['pin'], 'Q', false, true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'undone' AND (test.msg('pin')).pinned_by = test.id('A'),
    'Undo pins it again', v);
  v := test.mv('A', ARRAY['pin'], 'F', false, true);
  PERFORM test.ok(v LIKE '22023 %' AND (test.msg('pin')).channel_id = test.ref('Q'),
    'an Undo with no move to undo moves nothing (never a fresh move)', v);

  PERFORM test.ok(test.post('C', 'Q', 'v1') LIKE 'ok %', 'C posts v1 in Q');
  v := test.mv('V', ARRAY['v1'], 'Q');
  PERFORM test.ok(v NOT LIKE '{%', 'a viewer moves nothing', v);
  v := test.mv('X', ARRAY['b2'], 'Q');
  PERFORM test.ok(v LIKE 'P0002 %', 'an outsider can''t move what they can''t read (it doesn''t exist for them)', v);
  v := test.mv('K', ARRAY['v1'], 'F');
  PERFORM test.ok(v LIKE '42501 %', 'a key moves nothing (no session)', v);
  v := test.mv('C', ARRAY['v1', 'c1'], 'D');
  PERFORM test.ok(v LIKE '22023 %', 'messages from two conversations are refused', v);
  v := test.mv('C', ARRAY['v1'], 'Q');
  PERFORM test.ok(v LIKE '22023 %', 'moving into the same conversation is refused', v);
  v := test.mv('C', ARRAY['v1'], 'P');
  PERFORM test.ok(v LIKE '42501 %' OR v LIKE 'P0002 %', 'C can''t move into P (can''t read or post there)', v);
  PERFORM test.ok((test.msg('v1')).channel_id = test.ref('Q'), 'nothing refused moved anything');
  v := test.as_user('A', format($q$SELECT public.chat_op_archive_channel(%L, true)$q$, test.ref('F')));
  v := test.mv('C', ARRAY['v1'], 'F');
  PERFORM test.ok(v LIKE '42501 %', 'nothing moves into an archived channel', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_archive_channel(%L, false)$q$, test.ref('F')));
END;
$$;

-- ── "Mentioned in" follows the message (CV-10's writer, the author's rights) ─
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002');
DELETE FROM public.resource_grants WHERE resource_type = 'bucket' AND resource_id = test.id('PB');
CREATE FUNCTION test.uri(p_type text, p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'moduo://' || p_type || '/' || test.id(p_name)
$$;
CREATE FUNCTION test.mentions(p_channel text, p_task text) RETURNS bigint LANGUAGE sql VOLATILE AS $$
  SELECT count(*) FROM public.entity_links l
   WHERE l.workspace_id = test.id('W') AND l.deleted_at IS NULL AND l.relation_kind = 'mentions'
     AND l.pair_key = public.spine_pair_key('chat_channel', test.ref(p_channel), 'task', test.id(p_task))
$$;
CREATE FUNCTION test.lines(p_who text, p_task text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce(string_agg(coalesce(channel_name, channel_kind), ',' ORDER BY channel_name), '')
         FROM public.chat_conversations_for_item('task', %L::uuid)$q$, test.id(p_task)))
$$;
CREATE FUNCTION test.say(p_who text, p_conv text, p_name text, p_body text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, NULL::uuid)$q$,
    test.mid(p_name), test.ref(p_conv), p_body))
$$;
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T'), 'title', 'Get logo SVGs', 'bucket_id', test.id('SB'))));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TP'), 'title', 'Secret plan', 'bucket_id', test.id('PB'))));
  PERFORM test.ok((SELECT count(*) FROM public.entities WHERE workspace_id = test.id('W') AND entity_type = 'task'
                    AND entity_id IN (test.id('T'), test.id('TP'))) = 2, 'setup: the tasks are in the registry');

  v := test.say('A', 'Q', 'lk', 'Can someone take ' || test.uri('task', 'T'));
  PERFORM test.ok(v LIKE 'ok %' AND test.mentions('Q', 'T') = 1, 'setup: A mentions T in Q', v);
  PERFORM test.ok(test.lines('B', 'T') LIKE '%questions%', 'setup: T reads "Mentioned in questions"');
  v := test.mv('A', ARRAY['lk'], 'F');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'A moves it to F', v);
  PERFORM test.ok(test.mentions('F', 'T') = 1 AND test.mentions('Q', 'T') = 0,
    'the "Mentioned in" line follows it to F and leaves Q (nothing left there refers to T)');
  PERFORM test.ok(test.lines('B', 'T') = 'founders', 'T now reads "Mentioned in founders" only', test.lines('B', 'T'));
  PERFORM test.ok(test.lines('X', 'T') = '', 'X, outside F, sees no line for it');
  v := test.mv('A', ARRAY['lk'], 'Q', false, true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'undone' AND test.mentions('Q', 'T') = 1 AND test.mentions('F', 'T') = 0,
    'Undo puts the line back in Q and retires F''s', v);

  -- A line stays where another message still refers to the item.
  PERFORM test.ok(test.say('A', 'Q', 'lk3', 'Also ' || test.uri('task', 'T')) LIKE 'ok %', 'A mentions T again in Q');
  v := test.mv('A', ARRAY['lk3'], 'F');
  PERFORM test.ok(test.mentions('Q', 'T') = 1 AND test.mentions('F', 'T') = 1,
    'moving one of two mentions keeps Q''s line and adds F''s', v);

  -- The author's rights, not the mover's: B can't open TP, so no line, even moved by O who can.
  v := test.say('B', 'Q', 'lk2', 'What is ' || test.uri('task', 'TP') || '?');
  PERFORM test.ok(v LIKE 'ok %' AND test.mentions('Q', 'TP') = 0, 'B''s mention of TP (which B can''t open) leaves no line', v);
  v := test.mv('O', ARRAY['lk2'], 'F');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'the admin O, who can open TP, moves it into F', v);
  PERFORM test.ok(test.mentions('F', 'TP') = 0, 'still no line: a move never adds what the author''s mention couldn''t');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.entity_links WHERE workspace_id = test.id('W')
                                AND relation_kind = 'mentions' AND created_by = test.id('O')),
    'no line is written in the mover''s name');
END;
$$;

-- ── The pace: at most five moves in 10 s ────────────────────────────────────
DO $$
DECLARE
  v text;
  i int;
BEGIN
  -- Written straight in (the sending limit would stop six posts in a row).
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body)
  SELECT test.mid('pace' || g.n), test.id('W'), test.ref('Q'), test.id('C'), 'pace ' || g.n
    FROM generate_series(1, 6) g(n);
  FOR i IN 1..5 LOOP
    v := test.mv('C', ARRAY['pace' || i], 'D');
    PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'C''s move ' || i || ' of 5 goes through', v);
  END LOOP;
  v := test.mv('C', ARRAY['pace6'], 'D');
  PERFORM test.ok(v LIKE 'PT429 %', 'a sixth move in 10 s is refused with the sending limit''s code', v);
  PERFORM test.ok((test.msg('pace6')).channel_id = test.ref('Q'), 'and moved nothing');
END;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'chat__channel_readers(uuid)',
    'chat__move_refile_items(uuid[], uuid)',
    'chat__move_scrub_notices(uuid[], uuid)',
    'chat__move_relink(uuid[], uuid, uuid)'
  ] LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
                    AND NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')
                    AND has_function_privilege('service_role', 'public.' || fn, 'EXECUTE'),
      'grants: ' || fn || ' is server-only');
  END LOOP;
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.chat_op_move_messages(uuid[], uuid, boolean, boolean)', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.chat_op_move_messages(uuid[], uuid, boolean, boolean)', 'EXECUTE')
                  AND has_function_privilege('service_role', 'public.chat_op_move_messages(uuid[], uuid, boolean, boolean)', 'EXECUTE'),
    'grants: chat_op_move_messages is for signed-in people, never anon');
END;
$$;

-- ── Files follow their message (CV-9); conversation references stay quiet (CV-13) ─
CREATE FUNCTION test.file(p_name text) RETURNS public.attachments LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.attachments WHERE file_name = p_name
$$;
CREATE FUNCTION test.sees_file(p_who text, p_file text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM public.attachments WHERE id = %L$q$,
    (test.file(p_file)).id))
$$;
CREATE FUNCTION test.sees_bytes(p_who text, p_file text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT count(*)::text FROM storage.objects
    WHERE bucket_id = 'attachments' AND name = %L$q$, (test.file(p_file)).object_path))
$$;
CREATE FUNCTION test.files_view(p_who text, p_conv text) RETURNS text LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format($q$SELECT coalesce(string_agg(file_name, ',' ORDER BY file_name), '')
    FROM public.chat_files(%L)$q$, test.ref(p_conv)))
$$;
DO $$
DECLARE
  v text;
  j jsonb;
BEGIN
  -- The earlier sections' moves happened "now" too: out of the pace window.
  UPDATE public.chat_messages SET created_at = created_at - interval '1 minute'
   WHERE workspace_id = test.id('W') AND kind = 'event' AND event ->> 'type' = 'moved_out';

  v := test.as_user('B', format(
    $q$SELECT public.attachments_op_begin(p_workspace_id => %L, p_entity_type => 'chat_message',
         p_entity_id => %L, p_file_name => 'moved.png', p_mime => 'image/png', p_size_bytes => 1000,
         p_channel_id => %L)$q$, test.id('W'), test.mid('fl'), test.ref('P')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: B uploads moved.png for a message in P', v);
  v := test.as_user('B', format(
    $q$INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
       VALUES ('attachments', %L, %L, %L, jsonb_build_object('size', 1000))$q$,
    (test.file('moved.png')).object_path, test.id('B'), test.id('B')::text));
  v := test.as_user('B', format($q$SELECT public.attachments_op_finalize(%L)$q$, (test.file('moved.png')).id));
  PERFORM test.ok(v LIKE 'ok %', 'setup: the upload finishes', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, NULL::uuid)$q$,
    test.mid('fl'), test.ref('P'), 'See ' || 'moduo://chat_channel/' || test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %' AND (test.msg('fl')).file_count = 1, 'setup: B sends it with the file', v);
  PERFORM test.ok(test.sees_file('C', 'moved.png') = '0' AND test.sees_bytes('C', 'moved.png') = '0',
    'C, outside P, reads neither the file nor its bytes');

  v := test.mv('B', ARRAY['fl'], 'F');
  j := v::jsonb;
  PERFORM test.ok(j ->> 'status' = 'confirm' AND (j ->> 'newly')::int = 2,
    'the file''s message into F first asks (C and O couldn''t read P)', v);
  PERFORM test.ok(test.sees_file('C', 'moved.png') = '0', 'the question shows C nothing');
  v := test.mv('B', ARRAY['fl'], 'F', true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'confirmed, it moves', v);
  PERFORM test.ok((test.msg('fl')).file_count = 1 AND (test.file('moved.png')).entity_id = test.mid('fl')
              AND (test.file('moved.png')).deleted_at IS NULL,
    'the file rides the message (same row, same count, not trashed)');
  PERFORM test.ok(test.sees_file('C', 'moved.png') = '1' AND test.sees_bytes('C', 'moved.png') = '1',
    'C reads the file and its bytes in F now');
  PERFORM test.ok(test.files_view('B', 'F') LIKE '%moved.png%' AND test.files_view('B', 'P') NOT LIKE '%moved.png%',
    'the Files view lists it in F, no longer in P');
  PERFORM test.ok(test.sees_file('X', 'moved.png') = '0', 'X, in neither, still reads nothing');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.entity_links
                               WHERE workspace_id = test.id('W') AND deleted_at IS NULL
                                 AND (target_type IN ('chat_channel', 'chat_message')
                                      AND source_type = 'chat_channel' AND relation_kind = 'mentions')),
    'a reference to a conversation makes no "Mentioned in" line, moved or not');

  v := test.mv('B', ARRAY['fl'], 'P', false, true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'undone', 'B undoes it', v);
  PERFORM test.ok(test.sees_file('C', 'moved.png') = '0' AND test.sees_bytes('C', 'moved.png') = '0'
              AND test.files_view('B', 'P') LIKE '%moved.png%',
    'Undo takes the file back to P: C reads it no more');

  -- Nobody outside the source moves it (its file with it).
  v := test.mv('C', ARRAY['fl'], 'F');
  PERFORM test.ok(v LIKE 'P0002 %' OR v LIKE '42501 %', 'C can''t move a message it can''t read', v);
END;
$$;

-- ── A manager moves someone else's mention: the line follows in the author's name ─
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T2'), 'title', 'Brief the printer', 'bucket_id', test.id('SB'))));
  v := test.say('B', 'Q', 'lkb', 'Who has ' || test.uri('task', 'T2'));
  PERFORM test.ok(v LIKE 'ok %' AND test.mentions('Q', 'T2') = 1, 'setup: B mentions T2 in Q', v);
  v := test.mv('A', ARRAY['lkb'], 'F');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'Q''s manager A moves B''s message into the narrower F', v);
  PERFORM test.ok(test.mentions('F', 'T2') = 1 AND test.mentions('Q', 'T2') = 0,
    'the line follows it to F and leaves Q');
  PERFORM test.ok((SELECT l.created_by FROM public.entity_links l
                    WHERE l.workspace_id = test.id('W') AND l.deleted_at IS NULL AND l.relation_kind = 'mentions'
                      AND l.pair_key = public.spine_pair_key('chat_channel', test.ref('F'), 'task', test.id('T2')))
                  = test.id('B'),
    'the line is written in B''s name (the author), not the mover''s');
END;
$$;

-- ── A chain with a deleted reply moves and comes back with Undo ─────────────
DO $$
DECLARE
  v text;
BEGIN
  UPDATE public.chat_messages SET created_at = created_at - interval '1 minute'
   WHERE workspace_id = test.id('W') AND kind = 'event' AND event ->> 'type' = 'moved_out';
  -- Written straight in (the sending limit has seen this transaction's posts).
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, parent_id, deleted_at)
  VALUES (test.mid('dr'), test.id('W'), test.ref('F'), test.id('C'), 'dr', NULL, NULL),
         (test.mid('dr1'), test.id('W'), test.ref('F'), test.id('C'), 'dr1', test.mid('dr'), NULL),
         (test.mid('dr2'), test.id('W'), test.ref('F'), test.id('C'), 'dr2', test.mid('dr'), now());
  v := test.mv('C', ARRAY['dr'], 'D');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved'
              AND (v::jsonb) -> 'ids' @> to_jsonb(ARRAY[test.mid('dr2')]),
    'the chain moves to D with its deleted reply', v);
  v := test.mv('C', ARRAY['dr', 'dr1', 'dr2'], 'F', false, true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'undone' AND (test.msg('dr2')).channel_id = test.ref('F'),
    'Undo with every moved id (the deleted reply too) puts the chain back', v);
END;
$$;

-- ── Waiting notices lose the words for people who can't read where it went ─
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.post('A', 'Q', 'nt') LIKE 'ok %', 'A posts nt in the public Q');
  DELETE FROM public.notice_deliveries WHERE message_id = test.mid('nt');
  INSERT INTO public.notice_deliveries (user_id, workspace_id, kind, title, body, message_id, channel_id)
  VALUES (test.id('X'), test.id('W'), 'chat_message', 'questions', 'message nt', test.mid('nt'), test.ref('Q')),
         (test.id('C'), test.id('W'), 'chat_message', 'questions', 'message nt', test.mid('nt'), test.ref('Q'));
  INSERT INTO public.notice_deliveries (user_id, workspace_id, kind, title, body, message_id, channel_id, pushed_at)
  VALUES (test.id('X'), test.id('W'), 'chat_message', 'questions', 'message nt', test.mid('nt'), test.ref('Q'), now());
  INSERT INTO public.email_outbox (kind, to_email, to_user_id, dedupe_key, payload)
  VALUES ('chat_waiting', 'db-test-x@example.com', test.id('X'), 'cv16-x',
          jsonb_build_object('text', 'message nt', 'path', '/chat?c=' || test.ref('Q') || '&m=' || test.mid('nt'))),
         ('chat_waiting', 'db-test-c@example.com', test.id('C'), 'cv16-c',
          jsonb_build_object('text', 'message nt', 'path', '/chat?c=' || test.ref('Q') || '&m=' || test.mid('nt')));
  v := test.mv('A', ARRAY['nt'], 'F');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'A moves nt into the narrower F at once', v);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries
                               WHERE message_id = test.mid('nt') AND user_id = test.id('X') AND pushed_at IS NULL)
              AND NOT EXISTS (SELECT 1 FROM public.notice_deliveries
                               WHERE message_id = test.mid('nt') AND user_id = test.id('X') AND body IS NOT NULL),
    'X, outside F: the unsent notice goes and the sent one keeps no words');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.notice_deliveries
                           WHERE message_id = test.mid('nt') AND user_id = test.id('C') AND body = 'message nt'),
    'C, in F, keeps theirs');
  PERFORM test.ok((SELECT payload ->> 'text' FROM public.email_outbox WHERE to_user_id = test.id('X')
                     AND payload ->> 'path' LIKE '%' || test.mid('nt')) IS NULL
              AND (SELECT payload ->> 'text' FROM public.email_outbox WHERE to_user_id = test.id('C')
                     AND payload ->> 'path' LIKE '%' || test.mid('nt')) = 'message nt',
    'the waiting email to X drops its text; C''s keeps it');
END;
$$;

-- Everything this workspace wrote moves an hour back, order kept, so the
-- sending limit and the move pace start afresh (one now() per test).
CREATE FUNCTION test.rewind() RETURNS void LANGUAGE sql AS $$
  UPDATE public.chat_messages SET created_at = created_at - interval '1 hour'
   WHERE workspace_id = test.id('W')
$$;

-- ── Undo gives quotes back only inside the conversation they went back to ──
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.rewind();
  PERFORM test.ok(test.post('A', 'Q', 'w') LIKE 'ok %', 'A asks w in Q');
  PERFORM test.ok(test.post('B', 'Q', 'w1', 'w') LIKE 'ok %', 'B replies w1');
  v := test.post('C', 'Q', 'w2', 'w1');
  PERFORM test.ok(v LIKE 'ok %', 'C replies w2, quoting w1', v);
  v := test.mv('B', ARRAY['w1'], 'D');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved' AND (test.msg('w2')).reply_to_id IS NULL,
    'B moves w1 alone to D; w2 loses its quote', v);
  v := test.mv('C', ARRAY['w2'], 'F');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved' AND (test.msg('w2')).channel_id = test.ref('F'),
    'C then moves w2 alone to F', v);
  v := test.mv('B', ARRAY['w1'], 'Q', false, true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'undone' AND (test.msg('w1')).parent_id = test.mid('w'),
    'B undoes: w1 is back in its chain in Q', v);
  PERFORM test.ok((test.msg('w2')).channel_id = test.ref('F') AND (test.msg('w2')).parent_id IS NULL
              AND (test.msg('w2')).reply_to_id IS NULL AND (test.msg('w')).reply_count = 1,
    'w2, now in F, gets no chain or quote pointing back into Q');
END;
$$;

-- ── Any id you can't read answers like one that doesn't exist ──────────────
DO $$
DECLARE
  v text;
  ghost text;
BEGIN
  PERFORM test.rewind();
  ghost := test.mv('X', ARRAY['v1', 'never-sent'], 'D');
  PERFORM test.ok(ghost LIKE 'P0002 %', 'a made-up id among the picks: "no longer exists"', ghost);
  v := test.mv('X', ARRAY['v1', 'b2'], 'D');
  PERFORM test.ok(v = ghost,
    'X picks v1 (Q, readable) with b2 (P, which X can''t read): the same answer, never "two conversations"', v);
  v := test.mv('X', ARRAY['b2', 'v1'], 'D');
  PERFORM test.ok(v = ghost, '… in either order', v);
  v := test.mv('X', ARRAY['b2'], 'Q');
  PERFORM test.ok(v = ghost, '… and on its own', v);

  -- A conversation in another workspace answers like one that doesn't exist.
  INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W2'), test.id('O'), 'Elsewhere');
  v := test.as_user('O', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W2')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: O''s other workspace has its General', v);
  INSERT INTO test.ids SELECT 'G2', id FROM public.chat_channels WHERE workspace_id = test.id('W2') LIMIT 1;
  INSERT INTO test.ids VALUES ('nowhere', test.id('no-such-conversation'));
  PERFORM test.ok(test.post('O', 'Q', 'o1') LIKE 'ok %', 'O posts o1 in Q');
  ghost := test.mv('O', ARRAY['o1'], 'nowhere');
  PERFORM test.ok(ghost LIKE 'P0002 %', 'a made-up destination: "no longer exists"', ghost);
  v := test.mv('O', ARRAY['o1'], 'G2', true);
  PERFORM test.ok(v = ghost AND (test.msg('o1')).channel_id = test.ref('Q'),
    'a destination in another workspace (even one O can read) gets the same answer and nothing moves', v);
END;
$$;

-- ── Undo isn't held to the 100-message pick ─────────────────────────────────
DO $$
DECLARE
  v text;
  names text[] := ARRAY(SELECT 'big' || g FROM generate_series(1, 101) g);
BEGIN
  PERFORM test.rewind();
  -- Written straight in (the sending limit would stop 102 posts).
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body)
  VALUES (test.mid('big'), test.id('W'), test.ref('F'), test.id('C'), 'big');
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, parent_id)
  SELECT test.mid(n), test.id('W'), test.ref('F'), test.id('C'), n, test.mid('big') FROM unnest(names) n;
  v := test.mv('C', names, 'D');
  PERFORM test.ok(v LIKE '22023 %', 'picking 101 messages is refused', v);
  v := test.mv('C', ARRAY['big'], 'D');
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved' AND jsonb_array_length((v::jsonb) -> 'ids') = 102,
    'a root with 101 replies moves as 102 messages', v);
  v := test.mv('C', ARRAY['big'] || names, 'F', false, true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'undone'
              AND NOT EXISTS (SELECT 1 FROM public.chat_messages
                               WHERE parent_id = test.mid('big') AND channel_id <> test.ref('F')),
    'Undo names all 102 and puts every one back', v);
END;
$$;

-- ── Undo reaches a device that was offline: the access check names the ids ─
DO $$
DECLARE
  v text;
  away text;
BEGIN
  PERFORM test.rewind();
  PERFORM test.ok(test.post('B', 'P', 'ub') LIKE 'ok %', 'B posts ub in P');
  v := test.mv('B', ARRAY['ub'], 'Q', true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'moved', 'B moves ub into Q (confirmed)', v);
  away := test.value_as('X', format($q$SELECT coalesce(string_agg(id::text, ','), '') FROM public.chat_sync_ids(%L) WHERE kind = 'moved_away'$q$, test.id('W')));
  PERFORM test.ok(away NOT LIKE '%' || test.mid('ub')::text || '%', 'X reads ub in Q: not named as moved away', away);
  v := test.mv('B', ARRAY['ub'], 'P', false, true);
  PERFORM test.ok((v::jsonb) ->> 'status' = 'undone', 'B undoes', v);
  away := test.value_as('X', format($q$SELECT coalesce(string_agg(id::text || '@' || conversation_id::text, ','), '') FROM public.chat_sync_ids(%L) WHERE kind = 'moved_away'$q$, test.id('W')));
  PERFORM test.ok(away LIKE '%' || test.mid('ub')::text || '@' || test.ref('Q')::text || '%',
    'X''s next sync names ub as moved away from Q, so an offline copy drops it', away);
  away := test.value_as('B', format($q$SELECT coalesce(string_agg(id::text, ','), '') FROM public.chat_sync_ids(%L) WHERE kind = 'moved_away'$q$, test.id('W')));
  PERFORM test.ok(away NOT LIKE '%' || test.mid('ub')::text || '%', 'B, who reads P, keeps it', away);
END;
$$;

-- ── A reply never joins a chain that sits in another conversation ──────────
-- (Two sessions can't interleave in one test transaction: the root is put in
-- F straight in, as a move landing between the reply's first read and its
-- lock would leave it.)
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.rewind();
  PERFORM test.ok(test.post('A', 'Q', 'k') LIKE 'ok %', 'A asks k in Q');
  PERFORM test.ok(test.post('B', 'Q', 'k1', 'k') LIKE 'ok %', 'B replies k1');
  PERFORM test.ok(test.post('C', 'Q', 'k2') LIKE 'ok %', 'C posts k2 in Q');
  UPDATE public.chat_messages SET channel_id = test.ref('F') WHERE id = test.mid('k');
  v := test.post('C', 'Q', 'k3', 'k1');
  PERFORM test.ok(v LIKE 'P0002 %' AND test.msg('k3') IS NULL,
    'a reply to k1 whose root now sits in F is refused and nothing is posted', v);
  v := test.as_user('C', format($q$SELECT id FROM public.chat_op_attach_to_chain(%L::uuid, %L::uuid)$q$,
    test.mid('k2'), test.mid('k1')));
  PERFORM test.ok(v LIKE '22023 %' AND (test.msg('k2')).parent_id IS NULL,
    'attaching k2 to k1 is refused too: its chain isn''t in this conversation', v);
  UPDATE public.chat_messages SET channel_id = test.ref('Q') WHERE id = test.mid('k');
END;
$$;
