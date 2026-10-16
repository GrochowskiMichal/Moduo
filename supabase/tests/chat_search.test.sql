-- Chat search (CV-19, supabase/migrations/20261016190000_chat_v2_search.sql):
-- "simple + unaccent, readers only".
--
-- Cast: O owns workspace W on the Duo plan. A, B and C are members; X is in no
-- workspace; K is an app's key made by A. A makes a private channel P with B, a
-- public channel Q, a direct message D with B, a public channel R (archived
-- later), a public channel Z (deleted later) and a private channel L with C (C is
-- removed later). Everything is said through the ops; the 100,000-message timing
-- set at the end is written straight into the table.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Moduo Labs');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;

-- Say something as someone and remember the message under a name.
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

-- What a search returns for someone: the remembered names of the rows, sorted,
-- or 'ERROR …'. Rows the test didn't name read as '?'.
CREATE FUNCTION test.found(p_who text, p_query text, p_conv text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text := test.value_as(p_who, format(
    $q$SELECT coalesce(string_agg(message_id::text, ','), '') FROM public.chat_search(%L, %L, %L)$q$,
    test.id('W'), p_query, CASE WHEN p_conv IS NULL THEN NULL ELSE test.ref(p_conv) END));
BEGIN
  IF v LIKE 'ERROR%' OR v = '' THEN
    RETURN v;
  END IF;
  RETURN (SELECT string_agg(coalesce(i.name, '?'), ',' ORDER BY coalesce(i.name, '?'))
            FROM unnest(string_to_array(v, ',')::uuid[]) AS x(id) LEFT JOIN test.ids i ON i.id = x.id);
END;
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
    $q$SELECT public.chat_op_create_channel(%L, 'with-c', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('C'))) LIKE 'ok %', 'setup: A makes the private channel L with C');
  INSERT INTO test.ids SELECT 'L', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'with-c';
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

  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-search-key'),
          '{"chat": "view"}'::jsonb, test.id('A'));
END;
$$;

-- ── 1. Polish without diacritics, prefixes ──────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(test.found('C', 'zolw') = 'q_zolw,q_zolw_b,r_zolw',
    'words: "zolw" finds "żółw" (C: Q and the archived R)', test.found('C', 'zolw'));
  PERFORM test.ok(test.found('C', 'żółw') = test.found('C', 'zolw') AND test.found('C', 'ŻÓŁW') = test.found('C', 'zolw'),
    'words: "żółw", "ŻÓŁW" and "zolw" find the same messages');
  PERFORM test.ok(test.found('C', 'zadan') = 'q_zadania,q_zadaniem',
    'words: "zadan" finds "zadania" and "zadaniem"', test.found('C', 'zadan'));
  PERFORM test.ok(test.found('C', 'za') = 'q_za',
    'words: a two-letter word matches whole words only ("za" is not "zadania")', test.found('C', 'za'));
  PERFORM test.ok(test.found('C', 'zolw ogrod') = 'q_zolw',
    'words: every word must match, each a prefix', test.found('C', 'zolw ogrod'));
  PERFORM test.ok(test.found('C', 'zolw -ogrodzie') = 'q_zolw_b,r_zolw',
    'words: a negated word leaves its messages out', test.found('C', 'zolw -ogrodzie'));
  PERFORM test.ok(test.found('C', '"zadaniem jest"') = 'q_zadaniem',
    'words: a quoted phrase matches in order', test.found('C', '"zadaniem jest"'));
  PERFORM test.ok(test.value_as('C', format(
      $q$SELECT bool_and(snippet LIKE '%%' || chr(57344) || 'żółw' || chr(57345) || '%%' OR snippet LIKE '%%' || chr(57344) || 'Żółw' || chr(57345) || '%%')::text
           FROM public.chat_search(%L, 'zolw')$q$, test.id('W'))) = 'true',
    'snippet: every "zolw" snippet marks the word as written ("żółw"), with U+E000 … U+E001');
  PERFORM test.ok(test.value_as('C', format(
      $q$SELECT string_agg(snippet, '|') FROM public.chat_search(%L, 'zolw') WHERE snippet LIKE '%%<%%'$q$,
      test.id('W'))) IS NULL,
    'snippet: no HTML markers');
END;
$$;

-- ── 2. Only what the caller can read right now ──────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(test.found('B', 'zolw') = 'd_zolw,p_zolw,q_zolw,q_zolw_b,r_zolw',
    'readers: B finds Q, R, the private P and the direct message D', test.found('B', 'zolw'));
  PERFORM test.ok(test.found('C', 'tajny') = '' AND test.found('C', 'tylko dla') = '',
    'readers: C, not in P or D, finds nothing from them');
  PERFORM test.ok(test.found('C', 'zolw', 'P') = '' AND test.found('C', 'zolw', 'D') = '',
    'readers: C scoped to P or D gets nothing (no error that would say it exists)');
  PERFORM test.ok(test.found('B', 'zolw', 'P') = 'p_zolw',
    'readers: B scoped to P finds P''s message only');
  PERFORM test.ok(test.found('C', 'zolw', 'L') = '' AND test.found('A', 'zolw', 'L') = 'l_zolw',
    'readers: C, removed from L, no longer finds its messages; A still does');
  PERFORM test.ok(test.found('A', 'usunietym') = '' AND test.found('O', 'usunietym') = '',
    'readers: a deleted channel''s messages never come back, for anyone');
  PERFORM test.ok(test.found('A', 'zniknie') = '',
    'readers: a deleted message never comes back');
  PERFORM test.ok(test.found('X', 'zolw') = '',
    'readers: X, in no workspace, finds nothing');
  PERFORM test.ok(test.found('O', 'zolw') = 'q_zolw,q_zolw_b,r_zolw',
    'readers: the owner, in none of the private conversations, finds only the public ones', test.found('O', 'zolw'));
  PERFORM test.ok(test.as_user(NULL, format($q$SELECT * FROM public.chat_search(%L, 'zolw')$q$, test.id('W'))) = 'ok 0',
    'readers: no session, no rows');
  PERFORM test.ok(test.as_key('K', format($q$SELECT * FROM public.chat_search(%L, 'zolw')$q$, test.id('W'))) LIKE '42501 %',
    'readers: an app''s key cannot call chat search');
  PERFORM test.ok(test.as_key('K', format(
      $q$SELECT 1 WHERE public.perm_can_see_entity(%L, 'chat_message', %L)
               OR public.perm_can_see_entity(%L, 'chat_message', %L)$q$,
      test.id('W'), test.ref('q_zolw'), test.id('W'), test.ref('p_zolw'))) = 'ok 0',
    'readers: a key reads no message through the spine, public or private');
  PERFORM test.ok(test.found('C', 'zolw') = test.found('C', 'zolw', NULL)
      AND (SELECT count(*) FROM public.chat_search(test.id('W'), 'zolw')) = 0,
    'readers: the admin role without a session gets nothing either');

  -- Reading never needs the plan: the owner drops to Free, people still search.
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');
  PERFORM test.ok(test.found('C', 'zolw') = 'q_zolw,q_zolw_b,r_zolw',
    'readers: a paused workspace still searches');
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
END;
$$;

-- Parity: the readable set chat_search uses says exactly what the read rule says,
-- for every conversation in W and every person.
DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.chat_channels c
    CROSS JOIN unnest(ARRAY['O', 'A', 'B', 'C', 'X']) AS who
   WHERE c.workspace_id = test.id('W')
     AND (c.id = ANY (ARRAY(SELECT public.chat__readable_channel_ids(test.id('W'), test.id(who)))))
         IS DISTINCT FROM (test.value_as(who, format($q$SELECT public.chat_can_read_channel(%L)::text$q$, c.id)) = 'true');
  PERFORM test.ok(v_bad = 0, 'parity: the readable set equals chat_can_read_channel for every conversation and person',
    v_bad || ' mismatches');
END;
$$;

-- ── 3. Filters, paging and odd input ────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.value_as('C', format(
      $q$SELECT string_agg(message_id::text, ',') FROM public.chat_search(%L, 'zolw', p_from => %L)$q$,
      test.id('W'), test.id('B'))) = test.ref('q_zolw_b')::text,
    'filters: from B finds only what B said');
  PERFORM test.ok(test.value_as('C', format(
      $q$SELECT count(*)::text FROM public.chat_search(%L, 'zolw', p_after => now() + interval '1 minute')$q$,
      test.id('W'))) = '0',
    'filters: a date after everything finds nothing');

  INSERT INTO public.attachments (workspace_id, entity_type, entity_id, uploader_id, file_name, mime,
                                  size_bytes, object_path, status)
  VALUES (test.id('W'), 'chat_message', test.ref('q_zolw'), test.id('A'), 'zolw.png', 'image/png', 10,
          'db-test/search/zolw.png', 'ready'),
         (test.id('W'), 'chat_message', test.ref('r_zolw'), test.id('A'), 'r.png', 'image/png', 10,
          'db-test/search/r.png', 'pending');
  PERFORM test.ok(test.value_as('C', format(
      $q$SELECT string_agg(message_id::text, ',') FROM public.chat_search(%L, 'zolw', p_has_file => true)$q$,
      test.id('W'))) = test.ref('q_zolw')::text,
    'filters: "has a file" finds only messages with a finished file');

  -- Odd input never raises and never matches everything.
  FOREACH v IN ARRAY ARRAY['', '   ', ' - ', '!!!', '<-> & | !', 'a:* & b | !c <-> d', '"unclosed',
                           'back\slash''quote', 'C++ C#', 'https://example.com/a?b=c', '😀 żółw',
                           repeat('zolw ', 500), repeat('x', 10000)] LOOP
    PERFORM test.ok(test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_search(%L, %L)$q$,
        test.id('W'), v)) ~ '^[0-9]+$',
      'input: ' || left(v, 24) || ' (' || length(v) || ' chars) answers without an error');
  END LOOP;
  PERFORM test.ok(test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_search(%L, NULL)$q$, test.id('W'))) = '0'
      AND test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_search(%L, '!!!')$q$, test.id('W'))) = '0',
    'input: nothing searchable finds nothing');
  PERFORM test.ok(test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_search(%L, '😀 żółw')$q$, test.id('W'))) = '3',
    'input: an emoji next to a word still finds the word');
  PERFORM test.ok(test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_search(%L, 'zolw', p_limit => 1)$q$, test.id('W'))) = '1',
    'input: p_limit is honoured');
END;
$$;

-- ── 4. Grants ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_sig text := 'public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz, boolean)';
BEGIN
  PERFORM test.ok(has_function_privilege('authenticated', v_sig, 'EXECUTE')
      AND NOT has_function_privilege('anon', v_sig, 'EXECUTE')
      AND NOT has_function_privilege('service_role', v_sig, 'EXECUTE'),
    'grants: chat_search is for signed-in people only (not anon, not a key)');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.chat__search_query(text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.chat__search_query(text)', 'EXECUTE'),
    'grants: the query builder is server-only');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.chat__readable_channel_ids(uuid, uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.chat__readable_channel_ids(uuid, uuid)', 'EXECUTE'),
    'grants: the readable set stays server-only');
  PERFORM test.ok(
    (SELECT p.prosecdef AND 'search_path=""' = ANY (p.proconfig)
            AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'statement_timeout=%')
       FROM pg_proc p WHERE p.oid = v_sig::regprocedure),
    'grants: chat_search pins its search_path and carries a statement timeout');
  PERFORM test.ok(NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid = v_sig::regprocedure
         AND (p.prosrc ~* '\mexecute\M' OR p.prosrc ~* 'format\s*\(')),
    'grants: chat_search builds no SQL from its input');
END;
$$;

-- ── 5. 100,000 messages: starvation, paging and p95 ─────────────────────────
-- Written straight into the table with triggers off (the ops' rate limit and
-- fan-out aren't what is measured). C reads Q and General; P is B's and A's.
-- The newest 20,000 matches of "kotwica" are in P; 300 older ones are in Q.
SET LOCAL session_replication_role = replica;
SELECT setseed(0.19);
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, author_kind, kind,
                                  format_version, body, body_text, created_at)
SELECT gen_random_uuid(), test.id('W'),
       CASE WHEN g <= 20000 THEN test.ref('P')
            WHEN g % 3 = 0 THEN test.ref('Q') WHEN g % 3 = 1 THEN test.ref('G') ELSE test.ref('D') END,
       test.id(CASE WHEN g % 2 = 0 THEN 'A' ELSE 'B' END), 'user', 'message', 2, t.body, t.body,
       now() - interval '1 hour' - g * interval '1 second'
  FROM generate_series(1, 100000) AS g
  CROSS JOIN LATERAL (
    SELECT CASE WHEN g <= 20000 OR (g BETWEEN 50001 AND 50900 AND g % 3 = 0) THEN 'kotwica ' ELSE '' END
           || string_agg(
                CASE WHEN random() < 0.65
                     THEN (ARRAY['zadania', 'zadaniem', 'zadanie', 'żółw', 'spotkanie', 'jutro', 'projekt',
                                 'klient', 'faktura', 'wdrożenie', 'błąd', 'poprawka', 'przegląd', 'termin',
                                 'the', 'release', 'deploy', 'review', 'meeting', 'design', 'logo', 'svg',
                                 'budget', 'ticket', 'sprint', 'ok', 'za', 'po', 'na', 'w', 'i', 'że',
                                 'łódź', 'gęś', 'źródło', 'ćma', 'staging', 'hotfix', 'calendar', 'notes'])
                          [1 + floor(power(random(), 2) * 40)::int]
                     ELSE 'w' || floor(random() * 40000)::int::text END, ' ')
           AS body
      FROM generate_series(1, 6 + (g % 14)) AS w
  ) t;
SET LOCAL session_replication_role = origin;
ANALYZE public.chat_messages;

DO $$
DECLARE
  v_rows int;
  v_from_p int;
  v_page1 uuid[];
  v_page2 uuid[];
  v_page3 uuid[];
  v_all uuid[];
  v_last record;
  v_t0 timestamptz;
  v_ms double precision[] := '{}';
  v_q text;
  v_words text[] := ARRAY['zadania', 'zadan', 'zolw', 'żółw', 'spotkanie', 'jutro projekt', 'klient faktura',
                          'wdrozenie', 'blad poprawka', 'przeglad termin', 'the', 'release deploy', 'review',
                          'meeting design', 'logo svg', 'budget', 'ticket sprint', 'ok', 'lodz', 'gesi',
                          'zrodlo', 'cma', 'staging hotfix', 'calendar notes', 'w123', 'w39999',
                          'zad', 'spot', 'proj', 'deplo', 'kotwica', 'zolw jutro klient', 'the logo svg',
                          'nothing-here', 'release -deploy', '"jutro projekt"', 'faktur', 'pop', 'term', 'des'];
  v_p50 double precision;
  v_p95 double precision;
  v_p99 double precision;
  v_w uuid := test.id('W');
  v_p uuid := test.ref('P');
  v_c jsonb := json_build_object('sub', test.id('C'), 'role', 'authenticated')::jsonb;
  v_b jsonb := json_build_object('sub', test.id('B'), 'role', 'authenticated')::jsonb;
BEGIN
  -- Starvation: C asks for "kotwica"; 20,000 newer matches are unreadable to C.
  PERFORM set_config('request.jwt.claims', v_c::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), count(*) FILTER (WHERE s.channel_id = v_p) INTO v_rows, v_from_p
    FROM public.chat_search(v_w, 'kotwica') s;
  RESET ROLE;
  PERFORM test.ok(v_rows = 50 AND v_from_p = 0,
    'scale: 20,000 newer unreadable matches don''t starve the 300 readable ones (50 rows, none from P)',
    v_rows || ' rows, ' || v_from_p || ' from P');

  -- Keyset paging: three pages of 50 equal the first 150 of one ordered read.
  PERFORM set_config('request.jwt.claims', v_b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(message_id ORDER BY created_at DESC, message_id DESC) INTO v_page1
    FROM public.chat_search(v_w, 'zadania', p_limit => 50);
  SELECT created_at, message_id INTO v_last FROM public.chat_search(v_w, 'zadania', p_limit => 50)
   ORDER BY created_at ASC, message_id ASC LIMIT 1;
  SELECT array_agg(message_id ORDER BY created_at DESC, message_id DESC) INTO v_page2
    FROM public.chat_search(v_w, 'zadania', p_before => v_last.created_at, p_before_id => v_last.message_id);
  SELECT created_at, message_id INTO v_last FROM public.chat_search(v_w, 'zadania',
      p_before => v_last.created_at, p_before_id => v_last.message_id)
   ORDER BY created_at ASC, message_id ASC LIMIT 1;
  SELECT array_agg(message_id ORDER BY created_at DESC, message_id DESC) INTO v_page3
    FROM public.chat_search(v_w, 'zadania', p_before => v_last.created_at, p_before_id => v_last.message_id);
  SELECT count(*) INTO v_rows FROM public.chat_search(v_w, 'zadania', p_limit => 500);
  RESET ROLE;
  PERFORM test.ok(v_rows = 50, 'scale: at most 50 rows a call', v_rows::text);
  SELECT array_agg(id ORDER BY created_at DESC, id DESC) INTO v_all FROM (
    SELECT m.id, m.created_at FROM public.chat_messages m
     WHERE m.workspace_id = test.id('W') AND m.deleted_at IS NULL AND m.kind = 'message'
       AND m.channel_id = ANY (ARRAY(SELECT public.chat__readable_channel_ids(test.id('W'), test.id('B'))))
       AND m.search_tsv @@ public.chat__search_query('zadania')
     ORDER BY m.created_at DESC, m.id DESC LIMIT 150) x;
  PERFORM test.ok(v_page1 || v_page2 || v_page3 = v_all,
    'scale: three pages of 50 are the newest 150, no repeat, no gap');

  -- p95 over 200 queries as C (1–3 words, prefixes, unaccented, rare and common).
  PERFORM set_config('request.jwt.claims', v_c::text, true);
  FOR i IN 1..200 LOOP
    v_q := v_words[1 + (i % array_length(v_words, 1))];
    SET LOCAL ROLE authenticated;
    v_t0 := clock_timestamp();
    PERFORM count(*) FROM public.chat_search(v_w, v_q);
    v_ms := v_ms || (extract(epoch FROM clock_timestamp() - v_t0) * 1000);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x), percentile_cont(0.95) WITHIN GROUP (ORDER BY x),
         percentile_cont(0.99) WITHIN GROUP (ORDER BY x)
    INTO v_p50, v_p95, v_p99 FROM unnest(v_ms) AS x;
  PERFORM test.ok(v_p95 <= 150,
    format('scale: p95 ≤ 150 ms over 200 queries at 100,000 messages (p50 %s · p95 %s · p99 %s ms)',
      round(v_p50::numeric, 2), round(v_p95::numeric, 2), round(v_p99::numeric, 2)));
END;
$$;
