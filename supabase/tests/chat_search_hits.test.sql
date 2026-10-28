-- Chat through the search contract (GS-6, specs/global-search.md AC3, AC4, AC5):
-- "chat through the contract".
--
-- chat__search_hits(ws, query, limit) answers Chat's half of ⌘K as SearchHit
-- rows: messages (chat_message, the conversation as context) and conversations
-- (chat_channel), and search_all merges them. People read what chat_search and
-- chat__readable_channel_ids give them; a key reads chat__key_channel_ids:
-- never a direct message, a private channel only with include_private_chat.
-- chat__search_query is now search__query.
--
-- Cast: O owns workspace W on the Duo plan. A, B and C are members; X is in no
-- workspace. A makes a private channel P with B, public channels Q, R (archived
-- later) and Z (deleted later), a private channel L with C (C is removed
-- later) and a direct message D with B. Keys made by A: K (Chat: View), KP
-- (Chat: View, private channels on) and KN (Notes only).

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
UPDATE public.profiles SET display_name = 'Alicja Żak' WHERE id = test.id('A');
UPDATE public.profiles SET display_name = 'Bożena Wróbel' WHERE id = test.id('B');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;

CREATE FUNCTION test.say(p_who text, p_conv text, p_body text, p_name text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := test.as_user(p_who, format(
    $q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, NULL::uuid)$q$,
    test.id('msg:' || p_name), test.ref(p_conv), p_body));
  PERFORM test.ok(v LIKE 'ok %', format('setup: %s says %s in %s', p_who, p_name, p_conv), v);
  INSERT INTO test.ids VALUES (p_name, test.id('msg:' || p_name));
END;
$$;

-- A value a statement returns, read as a key (service_role + its header).
CREATE FUNCTION test.value_as_key(p_key text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  PERFORM set_config('request.headers', json_build_object('x-moduo-key-id', test.id(p_key))::text, true);
  SET LOCAL ROLE service_role;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.headers', '{}', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.headers', '{}', true);
  RETURN 'ERROR ' || SQLERRM;
END;
$$;

-- Ids → the names the test gave them, sorted ('?' for a row it didn't name).
CREATE FUNCTION test.names(p_ids text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_ids IS NULL OR p_ids = '' OR p_ids LIKE 'ERROR%' THEN coalesce(p_ids, '')
         ELSE (SELECT string_agg(coalesce(i.name, '?'), ',' ORDER BY coalesce(i.name, '?'))
                 FROM unnest(string_to_array(p_ids, ',')::uuid[]) AS x(id)
                 LEFT JOIN test.ids i ON i.id = x.id) END
$$;

-- What someone (a person, or a key when p_key) finds of one type: through
-- chat__search_hits ('hits') or through search_all ('all').
CREATE FUNCTION test.found(p_who text, p_via text, p_type text, p_query text, p_key boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_sql text := CASE p_via
    WHEN 'hits' THEN format(
      $q$SELECT coalesce(string_agg(entity_id::text, ','), '') FROM public.chat__search_hits(%L, %L, 50)
          WHERE entity_type = %L$q$, test.id('W'), p_query, p_type)
    ELSE format(
      $q$SELECT coalesce(string_agg(entity_id::text, ','), '')
           FROM public.search_all(%L, %L, ARRAY[%L], 50, NULL, NULL) WHERE entity_type = %L$q$,
      test.id('W'), p_query, p_type, p_type) END;
BEGIN
  RETURN test.names(CASE WHEN p_key THEN test.value_as_key(p_who, v_sql) ELSE test.value_as(p_who, v_sql) END);
END;
$$;

-- What chat_search (people) and chat_agent_search (keys) find: the reference.
CREATE FUNCTION test.chat_search(p_who text, p_query text) RETURNS text LANGUAGE sql AS $$
  SELECT test.names(test.value_as(p_who, format(
    $q$SELECT coalesce(string_agg(message_id::text, ','), '') FROM public.chat_search(%L, %L, NULL, NULL, NULL, 50)$q$,
    test.id('W'), p_query)))
$$;
CREATE FUNCTION test.agent_search(p_key text, p_query text) RETURNS text LANGUAGE sql AS $$
  SELECT test.names(test.value_as_key(p_key, format(
    $q$SELECT coalesce(string_agg(message_id::text, ','), '') FROM public.chat_agent_search(%L, %L, NULL, NULL, NULL, 50)$q$,
    test.id('W'), p_query)))
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  INSERT INTO test.ids SELECT 'G', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND kind = 'channel' AND is_default;

  PERFORM test.ok(test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'secret-plans', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B'))) LIKE 'ok %', 'setup: A makes the private channel P with B');
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'secret-plans';
  PERFORM test.ok(test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'open-plans', '', false, '{}'::uuid[])$q$,
    test.id('W'))) LIKE 'ok %', 'setup: A makes the public channel Q');
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'open-plans';
  PERFORM test.ok(test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'old-plans', '', false, '{}'::uuid[])$q$,
    test.id('W'))) LIKE 'ok %', 'setup: A makes the public channel R');
  INSERT INTO test.ids SELECT 'R', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'old-plans';
  PERFORM test.ok(test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'gone-plans', '', false, '{}'::uuid[])$q$,
    test.id('W'))) LIKE 'ok %', 'setup: A makes the public channel Z');
  INSERT INTO test.ids SELECT 'Z', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'gone-plans';
  PERFORM test.ok(test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'with-c-plans', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('C'))) LIKE 'ok %', 'setup: A makes the private channel L with C');
  INSERT INTO test.ids SELECT 'L', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'with-c-plans';
  PERFORM test.ok(test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B'))) LIKE 'ok %', 'setup: A opens a direct message D with B');
  INSERT INTO test.ids SELECT 'D', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm';

  PERFORM test.say('A', 'Q', 'Mamy żółw w ogrodzie', 'q_zolw');
  PERFORM test.say('A', 'Q', 'Lista zadania na jutro', 'q_zadania');
  PERFORM test.say('A', 'Q', 'Z tym zadaniem jest ok', 'q_zadaniem');
  PERFORM test.say('A', 'Q', 'Za to nic więcej', 'q_za');
  PERFORM test.say('B', 'Q', 'Żółw od Basi', 'q_zolw_b');
  PERFORM test.say('A', 'Q', 'Ten żółw zniknie', 'q_deleted');
  PERFORM test.say('A', 'P', 'Tajny żółw plan', 'p_zolw');
  PERFORM test.say('A', 'D', 'Żółw tylko dla ciebie', 'd_zolw');
  PERFORM test.say('A', 'R', 'Stary żółw w archiwum', 'r_zolw');
  PERFORM test.say('A', 'Z', 'Żółw w usuniętym kanale', 'z_zolw');
  PERFORM test.say('A', 'L', 'Żółw tylko z C', 'l_zolw');

  PERFORM test.ok(test.as_user('A', format($q$SELECT public.chat_op_delete(%L)$q$, test.ref('q_deleted'))) LIKE 'ok %',
    'setup: A deletes one message in Q');
  PERFORM test.ok(test.as_user('A', format($q$SELECT public.chat_op_archive_channel(%L, true)$q$, test.ref('R'))) LIKE 'ok %',
    'setup: A archives R');
  PERFORM test.ok(test.as_user('A', format($q$SELECT public.chat_op_delete_channel(%L)$q$, test.ref('Z'))) LIKE 'ok %',
    'setup: A deletes Z');
  v := test.as_user('A', format($q$SELECT public.chat_op_remove_member(%L, %L)$q$, test.ref('L'), test.id('C')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A removes C from L', v);

  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by,
                                         include_private_chat)
  VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_gs6a', md5('db-test-gs6-k'),
          '{"chat": "view"}'::jsonb, test.id('A'), false),
         (test.id('KP'), test.id('W'), 'Claude Code', 'mdo_gs6b', md5('db-test-gs6-kp'),
          '{"chat": "view"}'::jsonb, test.id('A'), true),
         (test.id('KN'), test.id('W'), 'Notes only', 'mdo_gs6c', md5('db-test-gs6-kn'),
          '{"notes": "view"}'::jsonb, test.id('A'), false);
END;
$$;

-- ── 1. People: the same messages as chat_search ─────────────────────────────
DO $$
DECLARE
  who text;
  q text;
  v_bad text := '';
BEGIN
  FOREACH who IN ARRAY ARRAY['O', 'A', 'B', 'C', 'X'] LOOP
    FOREACH q IN ARRAY ARRAY['zolw', 'żółw', 'zadan', 'za', 'zolw -ogrodzie', '"zadaniem jest"', 'tajny',
                             'tylko', '-zolw', 'x'] LOOP
      IF test.found(who, 'all', 'chat_message', q) IS DISTINCT FROM test.chat_search(who, q)
         OR test.found(who, 'hits', 'chat_message', q) IS DISTINCT FROM test.chat_search(who, q) THEN
        v_bad := v_bad || format('%s/%s: all=%s hits=%s chat_search=%s; ', who, q,
          test.found(who, 'all', 'chat_message', q), test.found(who, 'hits', 'chat_message', q),
          test.chat_search(who, q));
      END IF;
    END LOOP;
  END LOOP;
  PERFORM test.ok(v_bad = '', 'people: search_all''s and chat__search_hits'' messages equal chat_search''s for everyone', v_bad);

  PERFORM test.ok(test.found('B', 'all', 'chat_message', 'zolw') = 'd_zolw,p_zolw,q_zolw,q_zolw_b,r_zolw',
    'people: B finds Q, the archived R, the private P and the direct message D',
    test.found('B', 'all', 'chat_message', 'zolw'));
  PERFORM test.ok(test.found('C', 'all', 'chat_message', 'zolw') = 'q_zolw,q_zolw_b,r_zolw',
    'people: C, removed from L and in neither P nor D, finds only the public ones',
    test.found('C', 'all', 'chat_message', 'zolw'));
  PERFORM test.ok(test.found('X', 'all', 'chat_message', 'zolw') = ''
      AND test.as_user(NULL, format($q$SELECT * FROM public.chat__search_hits(%L, 'zolw', 50)$q$, test.id('W'))) = 'ok 0',
    'people: an outsider, or no session, finds nothing');
END;
$$;

-- ── 2. The row: a message with its conversation as context ──────────────────
DO $$
DECLARE
  r record;
  v_w uuid := test.id('W');
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test.id('B'), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT h.* INTO r FROM public.search_all(v_w, 'ogrod', ARRAY['chat_message'], 50, NULL, NULL) h
   WHERE h.entity_type = 'chat_message';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM test.ok(r.entity_id = test.ref('q_zolw') AND r.match = 'body' AND r.context = 'open-plans'
      AND r.title = 'Alicja Żak' AND NOT r.archived AND r.rank BETWEEN 0 AND 1,
    'row: a message reads as its author, in its conversation, a body match',
    format('%s / %s / %s / %s / %s', r.title, r.context, r.match, r.archived, r.rank));
  PERFORM test.ok(r.snippet LIKE '%' || chr(57344) || 'ogrodzie' || chr(57345) || '%',
    'row: the snippet marks the match (U+E000 … U+E001)', r.snippet);
  PERFORM test.ok(r.updated_at = (SELECT created_at FROM public.chat_messages WHERE id = test.ref('q_zolw')),
    'row: its time is when it was sent');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', test.id('B'), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT h.* INTO r FROM public.chat__search_hits(v_w, 'archiwum', 50) h WHERE h.entity_type = 'chat_message';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM test.ok(r.entity_id = test.ref('r_zolw') AND r.archived AND r.context = 'old-plans',
    'row: a message in an archived conversation is tagged archived', format('%s / %s', r.archived, r.context));

  -- A direct message's context names its other people, never you.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', test.id('B'), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT h.* INTO r FROM public.chat__search_hits(v_w, 'ciebie', 50) h WHERE h.entity_type = 'chat_message';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM test.ok(r.entity_id = test.ref('d_zolw') AND r.context = 'Alicja Żak',
    'row: a direct message''s context is the other person', r.context);

  PERFORM test.ok(test.value_as('B', format(
      $q$SELECT bool_and(match IN ('handle', 'title', 'title_fuzzy', 'body') AND rank BETWEEN 0 AND 1
                         AND entity_type IN ('chat_message', 'chat_channel'))::text
           FROM public.chat__search_hits(%L, 'plans', 50)$q$, test.id('W'))) = 'true',
    'row: every hit''s match is in the vocabulary and its rank in 0..1');
END;
$$;

-- ── 3. People: conversations by name ────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(test.found('C', 'all', 'chat_channel', 'plans') = 'Q,R',
    'conversations: C finds the public and the archived channel, never P, the deleted Z or L it left',
    test.found('C', 'all', 'chat_channel', 'plans'));
  PERFORM test.ok(test.found('B', 'all', 'chat_channel', 'plans') = 'P,Q,R',
    'conversations: B, in P, finds it', test.found('B', 'all', 'chat_channel', 'plans'));
  PERFORM test.ok(test.found('O', 'all', 'chat_channel', 'secret') = '',
    'conversations: the owner never finds a private channel they aren''t in');
  PERFORM test.ok(test.found('B', 'all', 'chat_channel', 'alicja zak') = 'D'
      AND test.found('C', 'all', 'chat_channel', 'alicja') = '',
    'conversations: a direct message by its other person''s name, without diacritics, only for its people',
    test.found('B', 'all', 'chat_channel', 'alicja zak'));
  PERFORM test.ok(test.found('A', 'all', 'chat_channel', 'alicja') = '',
    'conversations: your own name doesn''t list your direct messages', test.found('A', 'all', 'chat_channel', 'alicja'));
  PERFORM test.ok(test.value_as('C', format(
      $q$SELECT string_agg(title || ':' || archived::text || ':' || match, ',' ORDER BY title)
           FROM public.chat__search_hits(%L, 'plans', 50) WHERE entity_type = 'chat_channel'$q$, test.id('W')))
      = 'old-plans:true:title,open-plans:false:title',
    'conversations: a channel reads as its name, a title match, archived when it is');
END;
$$;

-- ── 4. Keys: chat__key_channel_ids, never a direct message ──────────────────
DO $$
BEGIN
  PERFORM test.ok(test.found('K', 'all', 'chat_message', 'zolw', true) = 'q_zolw,q_zolw_b,r_zolw',
    'keys: a key without private chat finds public channels only',
    test.found('K', 'all', 'chat_message', 'zolw', true));
  PERFORM test.ok(test.found('KP', 'all', 'chat_message', 'zolw', true) = 'l_zolw,p_zolw,q_zolw,q_zolw_b,r_zolw',
    'keys: with private chat on, its creator''s private channels too, never the direct message',
    test.found('KP', 'all', 'chat_message', 'zolw', true));
  PERFORM test.ok(test.found('K', 'all', 'chat_message', 'zolw', true) = test.agent_search('K', 'zolw')
      AND test.found('KP', 'all', 'chat_message', 'zolw', true) = test.agent_search('KP', 'zolw')
      AND test.found('KP', 'hits', 'chat_message', 'tylko', true) = test.agent_search('KP', 'tylko'),
    'keys: the same messages as chat_agent_search (chat__key_channel_ids)');
  PERFORM test.ok(test.found('K', 'all', 'chat_channel', 'plans', true) = 'Q,R'
      AND test.found('KP', 'all', 'chat_channel', 'plans', true) = 'L,P,Q,R',
    'keys: conversations follow the same rule',
    test.found('KP', 'all', 'chat_channel', 'plans', true));
  PERFORM test.ok(test.found('KP', 'all', 'chat_channel', 'bozena', true) = '',
    'keys: a direct message is never found by its people',
    test.found('KP', 'all', 'chat_channel', 'bozena', true));
  PERFORM test.ok(test.value_as_key('KN', format(
      $q$SELECT count(*)::text FROM public.search_all(%L, 'zolw', NULL, 50, NULL, NULL)
          WHERE entity_type IN ('chat_message', 'chat_channel')$q$, test.id('W'))) = '0',
    'keys: a key without Chat scope gets no chat rows, and no error');
  UPDATE public.workspace_api_keys SET revoked_at = now() WHERE id = test.id('K');
  PERFORM test.ok(test.value_as_key('K', format(
      $q$SELECT count(*)::text FROM public.chat__search_hits(%L, 'zolw', 50)$q$, test.id('W'))) = '0',
    'keys: a revoked key gets nothing, and no error');
  UPDATE public.workspace_api_keys SET revoked_at = NULL WHERE id = test.id('K');
  PERFORM test.ok(test.value_as_key('K', format(
      $q$SELECT count(*)::text FROM public.chat__search_hits(%L, 'zolw', 50)$q$, test.id('X'))) = '0',
    'keys: another workspace gets nothing, and no error');
END;
$$;

-- ── 5. All types by default; visibility before the limit ───────────────────
DO $$
BEGIN
  PERFORM test.ok(test.value_as('B', format(
      $q$SELECT string_agg(DISTINCT entity_type, ',' ORDER BY entity_type)
           FROM public.search_all(%L, 'plan', NULL, 8, NULL, NULL)
          WHERE entity_type IN ('chat_message', 'chat_channel')$q$, test.id('W'))) = 'chat_channel,chat_message',
    'search_all: Messages and Conversations come with the default types');
  PERFORM test.ok(test.value_as('B', format(
      $q$SELECT count(*)::text FROM public.search_all(%L, 'zolw', ARRAY['task'], 8, NULL, NULL)
          WHERE entity_type LIKE 'chat_%%'$q$, test.id('W'))) = '0',
    'search_all: another type''s chip asks no chat rows');
END;
$$;

-- 60 newer matches in P, which C can't read, and one older match in Q.
SET LOCAL session_replication_role = replica;
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, author_kind, kind,
                                  format_version, body, body_text, created_at)
SELECT gen_random_uuid(), test.id('W'), test.ref('P'), test.id('A'), 'user', 'message', 2,
       'kotwica ukryta ' || g, 'kotwica ukryta ' || g, now() + g * interval '1 second'
  FROM generate_series(1, 60) AS g;
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, author_kind, kind,
                                  format_version, body, body_text, created_at)
VALUES (test.id('msg:q_kotwica'), test.id('W'), test.ref('Q'), test.id('A'), 'user', 'message', 2,
        'kotwica widoczna', 'kotwica widoczna', now() - interval '1 day');
INSERT INTO test.ids VALUES ('q_kotwica', test.id('msg:q_kotwica'));
SET LOCAL session_replication_role = origin;

DO $$
BEGIN
  PERFORM test.ok(test.names(test.value_as('C', format(
      $q$SELECT string_agg(entity_id::text, ',') FROM public.chat__search_hits(%L, 'kotwica', 5)
          WHERE entity_type = 'chat_message'$q$, test.id('W')))) = 'q_kotwica',
    'limit: 60 newer unreadable matches don''t crowd out the one C can read');
  PERFORM test.ok(test.value_as('B', format(
      $q$SELECT count(*)::text FROM public.chat__search_hits(%L, 'kotwica', 5) WHERE entity_type = 'chat_message'$q$,
      test.id('W'))) = '5',
    'limit: the limit holds per type');
END;
$$;

-- ── 6. One dialect: chat__search_query is search__query ─────────────────────
DO $$
DECLARE
  q text;
  v_bad text := '';
BEGIN
  FOREACH q IN ARRAY ARRAY['zolw', 'ŻÓŁW ogrod', 'za', '"zadaniem jest"', 'zolw -ogrodzie', '-standup',
                           'x or -y', '!!!', '', repeat('słowo ', 400)] LOOP
    IF public.chat__search_query(q)::text IS DISTINCT FROM public.search__query(q)::text THEN
      v_bad := v_bad || q || '; ';
    END IF;
  END LOOP;
  PERFORM test.ok(v_bad = '', 'dialect: chat__search_query answers what search__query answers', v_bad);
  PERFORM test.ok((SELECT prosrc FROM pg_proc WHERE oid = 'public.chat__search_query(text)'::regprocedure)
      LIKE '%search__query%',
    'dialect: chat__search_query delegates to search__query');
  PERFORM test.ok(to_regprocedure('public.chat__unaccent(text)') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                   WHERE d.adrelid = 'public.chat_messages'::regclass AND a.attname = 'search_tsv'
                     AND pg_get_expr(d.adbin, d.adrelid) LIKE '%chat__unaccent%'),
    'dialect: chat__unaccent stays, as chat_messages.search_tsv names it');
END;
$$;

-- ── 6b. Review additions: Chat taken away, a direct message left, a key's post ─
DO $$
DECLARE
  v text;
BEGIN
  -- A member whose role lost Chat finds no chat rows, and search_all still answers.
  SET LOCAL session_replication_role = replica;
  UPDATE public.workspace_members SET perms = array_remove(perms, 'chat.view')
   WHERE workspace_id = test.id('W') AND user_id = test.id('C');
  SET LOCAL session_replication_role = origin;
  PERFORM test.ok(test.found('C', 'all', 'chat_message', 'zolw') = ''
      AND test.found('C', 'all', 'chat_channel', 'plans') = ''
      AND test.value_as('C', format($q$SELECT count(*)::text FROM public.search_all(%L, 'zolw', NULL, 8, NULL, NULL)$q$,
                                    test.id('W'))) NOT LIKE 'ERROR%',
    'review: a member without Chat finds no messages or conversations, and no error');
  SET LOCAL session_replication_role = replica;
  UPDATE public.workspace_members SET perms = array_append(perms, 'chat.view')
   WHERE workspace_id = test.id('W') AND user_id = test.id('C');
  SET LOCAL session_replication_role = origin;

  -- A direct message C leaves stops matching for C, its message and its name.
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('C')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A opens a direct message E with C', v);
  INSERT INTO test.ids SELECT 'E', id FROM public.chat_channels
    WHERE workspace_id = test.id('W') AND kind = 'dm' AND id <> test.ref('D');
  -- Written straight in: the 60 rows above count against A's sending limit.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, author_kind, kind,
                                    format_version, body, body_text, created_at)
  VALUES (test.id('msg:e_zurek'), test.id('W'), test.ref('E'), test.id('A'), 'user', 'message', 2,
          'Pożegnalny żurek', 'Pożegnalny żurek', now() - interval '2 hours');
  SET LOCAL session_replication_role = origin;
  INSERT INTO test.ids VALUES ('e_zurek', test.id('msg:e_zurek'));
  PERFORM test.ok(test.found('C', 'all', 'chat_message', 'zurek') = 'e_zurek'
      AND test.found('C', 'all', 'chat_channel', 'alicja') = 'E',
    'review: C finds the direct message with A, and its message, while in it');
  v := test.as_user('C', format($q$SELECT public.chat_op_leave(%L)$q$, test.ref('E')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: C leaves E', v);
  PERFORM test.ok(test.found('C', 'all', 'chat_message', 'zurek') = ''
      AND test.found('C', 'all', 'chat_channel', 'alicja') = '',
    'review: after leaving it, C finds neither', test.found('C', 'all', 'chat_channel', 'alicja'));

  -- A post made through a key reads as its creator "via" the key, as Chat shows it.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, author_kind, author_label, kind,
                                    format_version, body, body_text, created_at)
  VALUES (test.id('msg:q_raport'), test.id('W'), test.ref('Q'), test.id('A'), 'api_key', 'CI key', 'message', 2,
          'Raport wdrożenia gotowy', 'Raport wdrożenia gotowy', now() - interval '1 hour');
  SET LOCAL session_replication_role = origin;
  PERFORM test.ok(test.value_as('B', format(
      $q$SELECT title FROM public.chat__search_hits(%L, 'raport wdroz', 50) WHERE entity_type = 'chat_message'$q$,
      test.id('W'))) = 'Alicja Żak · via CI key',
    'review: a post made through a key reads "Alicja Żak · via CI key"');
END;
$$;

-- search_all keeps one chat branch, patched on its live body (other blocks' sources stay).
DO $$
DECLARE
  v_def text := pg_get_functiondef('public.search_all(uuid, text, text[], integer, text, uuid)'::regprocedure);
BEGIN
  PERFORM test.ok((length(v_def) - length(replace(v_def, 'chat__search_hits(', ''))) / length('chat__search_hits(') = 1
      AND position('notes__search(' IN v_def) > 0 AND position('registry__search(' IN v_def) > 0,
    'search_all: one chat branch beside the other modules'' sources');
END;
$$;

-- ── 7. Grants ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(has_function_privilege('authenticated', 'public.chat__search_hits(uuid, text, integer)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.chat__search_hits(uuid, text, integer)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.chat__search_hits(uuid, text, integer)', 'EXECUTE'),
    'grants: chat__search_hits is for signed-in people and the server, never anon');
  PERFORM test.ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.chat__search_hits(uuid, text, integer)'::regprocedure),
    'grants: chat__search_hits is SECURITY DEFINER (it resolves the actor itself)');
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.chat__search_query(text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.chat__search_query(text)', 'EXECUTE'),
    'grants: chat__search_query stays server-only');
  PERFORM test.ok(has_function_privilege('authenticated', 'public.search_all(uuid, text, text[], integer, text, uuid)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.search_all(uuid, text, text[], integer, text, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.search_all(uuid, text, text[], integer, text, uuid)', 'EXECUTE'),
    'grants: search_all is re-stated for authenticated and service_role, never anon');
END;
$$;
