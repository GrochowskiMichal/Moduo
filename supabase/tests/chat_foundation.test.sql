-- Chat v2 foundation (CV-1: supabase/migrations/…_chat_v2_foundation.sql).
-- "Read rules follow the conversation" (AC12.5, AC10.1) and the new columns,
-- triggers, tables and vocabularies.
--
-- Cast: O owns workspace W on the Duo plan; A, B and C are members, V a viewer;
-- X is in no workspace. A makes a private channel P with B, a public channel Q
-- and a direct message D with B; A writes M in P and N in Q. The registry holds
-- P, M and Q; links join P → a note T, T → M and Q → T. K is A's API key.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'V', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Foundation');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES (test.id('W'), test.id('V'), 'viewer') ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
-- How many rows of a table a person reads, filtered by an SQL condition.
CREATE FUNCTION test.reads(p_who text, p_table text, p_where text) RETURNS int LANGUAGE sql AS $$
  SELECT test.value_as(p_who, format('SELECT count(*)::text FROM public.%I WHERE %s', p_table, p_where))::int
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'secret-plans', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'secret-plans';
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_create_channel(%L, 'open-plans', '', false, '{}'::uuid[])$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'open-plans';
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A opens the direct message D with B', v);
  INSERT INTO test.ids SELECT 'D', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm';
  v := test.as_user('A', format(
    $q$SELECT public.chat_op_send(%L, 'hello <@%s>', NULL, ARRAY[%L]::uuid[], false, NULL, 'hello @B')$q$,
    test.ref('P'), test.id('B'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A mentions B in P', v);
  INSERT INTO test.ids SELECT 'M', id FROM public.chat_messages WHERE channel_id = test.ref('P');
  v := test.as_user('A', format($q$SELECT public.chat_op_send(%L, 'Żółw _ahead_', NULL, '{}'::uuid[], false, NULL, NULL)$q$,
    test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A writes in Q', v);
  INSERT INTO test.ids SELECT 'N', id FROM public.chat_messages WHERE channel_id = test.ref('Q');

  -- The registry and links, as later ops write them.
  INSERT INTO public.entities (workspace_id, entity_type, entity_id, label) VALUES
    (test.id('W'), 'chat_channel', test.ref('P'), 'secret-plans'),
    (test.id('W'), 'chat_message', test.ref('M'), ''),
    (test.id('W'), 'chat_channel', test.ref('Q'), 'open-plans'),
    (test.id('W'), 'note', test.id('T'), 'Plan')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.entity_links (workspace_id, source_type, source_id, target_type, target_id, relation_kind, created_by) VALUES
    (test.id('W'), 'chat_channel', test.ref('P'), 'note', test.id('T'), 'references', test.id('A')),
    (test.id('W'), 'note', test.id('T'), 'chat_message', test.ref('M'), 'mentions', test.id('A')),
    (test.id('W'), 'chat_channel', test.ref('Q'), 'note', test.id('T'), 'mentions', test.id('A'));
  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv1'),
          '{"chat": "view", "links": "view"}'::jsonb, test.id('A'));
END;
$$;

-- What one person reads about P, M and Q, as one line: messages, registry, links, activity.
CREATE FUNCTION test.sees(p_who text) RETURNS text LANGUAGE sql AS $$
  SELECT format('P:%s M:%s regP:%s regM:%s linkP:%s linkM:%s actP:%s Q:%s regQ:%s linkQ:%s',
    test.reads(p_who, 'chat_channels', format('id = %L', test.ref('P'))),
    test.reads(p_who, 'chat_messages', format('id = %L', test.ref('M'))),
    test.reads(p_who, 'entities', format('entity_id = %L', test.ref('P'))),
    test.reads(p_who, 'entities', format('entity_id = %L', test.ref('M'))),
    test.reads(p_who, 'entity_links', format('source_id = %L', test.ref('P'))),
    test.reads(p_who, 'entity_links', format('target_id = %L', test.ref('M'))),
    test.reads(p_who, 'module_activity', format('entity_id = %L', test.ref('P'))),
    test.reads(p_who, 'chat_messages', format('id = %L', test.ref('N'))),
    test.reads(p_who, 'entities', format('entity_id = %L', test.ref('Q'))),
    test.reads(p_who, 'entity_links', format('source_id = %L', test.ref('Q'))))
$$;

-- ── Read rules follow the conversation (AC12.5, AC10.1) ─────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.sees('B');
  PERFORM test.ok(v LIKE 'P:1 M:1 regP:1 regM:1 linkP:1 linkM:1 actP:% Q:1 regQ:1 linkQ:1' AND v NOT LIKE '%actP:0%',
    'member: B, in P, reads P, its message, its registry, link and activity rows', v);
  v := test.sees('A');
  PERFORM test.ok(v LIKE 'P:1 M:1 regP:1 regM:1 linkP:1 linkM:1 actP:% Q:1 regQ:1 linkQ:1', 'member: A reads them too', v);
  v := test.sees('C');
  PERFORM test.ok(v = 'P:0 M:0 regP:0 regM:0 linkP:0 linkM:0 actP:0 Q:1 regQ:1 linkQ:1',
    'plain member: C reads nothing about P (no row, registry, link or activity) and everything about the public Q', v);
  v := test.sees('V');
  PERFORM test.ok(v = 'P:0 M:0 regP:0 regM:0 linkP:0 linkM:0 actP:0 Q:1 regQ:1 linkQ:1',
    'viewer: V reads the public Q, nothing about P', v);
  v := test.sees('X');
  PERFORM test.ok(v = 'P:0 M:0 regP:0 regM:0 linkP:0 linkM:0 actP:0 Q:0 regQ:0 linkQ:0',
    'outsider: X reads nothing', v);
  PERFORM test.ok(
    test.reads('C', 'entity_links', format('target_id = %L', test.id('T'))) = 1
    AND test.reads('B', 'entity_links', format('target_id = %L', test.id('T'))) = 2,
    'plain member: of the two links into T, C reads the one from the public Q, not the one from P');

  -- A key reads chat through the chat tools only, never through the spine.
  PERFORM test.ok(
    test.as_key('K', format($q$SELECT 1 WHERE public.perm_can_see_entity(%L, 'chat_channel', %L)
                                 OR public.perm_can_see_entity(%L, 'chat_message', %L)
                                 OR public.perm_can_see_entity(%L, 'chat_channel', %L)$q$,
      test.id('W'), test.ref('P'), test.id('W'), test.ref('M'), test.id('W'), test.ref('Q'))) = 'ok 0',
    'key: K (A''s, chat at View) reads no conversation, message or link end through the spine');
  PERFORM test.ok(
    NOT has_function_privilege('authenticated', 'public.spine__visible_to(uuid, text, uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.spine__visible_to(uuid, text, uuid, uuid)', 'EXECUTE'),
    'grants: spine__visible_to is server-only');

  -- "Can this person see it" (notifications, the spine) asks the same rule.
  PERFORM test.ok(
    public.spine__visible_to(test.id('W'), 'chat_channel', test.ref('P'), test.id('B'))
    AND NOT public.spine__visible_to(test.id('W'), 'chat_channel', test.ref('P'), test.id('C'))
    AND public.spine__visible_to(test.id('W'), 'chat_message', test.ref('M'), test.id('A'))
    AND NOT public.spine__visible_to(test.id('W'), 'chat_message', test.ref('M'), test.id('C'))
    AND public.spine__visible_to(test.id('W'), 'chat_channel', test.ref('Q'), test.id('C'))
    AND NOT public.spine__visible_to(test.id('W'), 'chat_channel', test.ref('Q'), test.id('X'))
    AND NOT public.spine__visible_to(test.id('X'), 'chat_channel', test.ref('P'), test.id('B')),
    'spine__visible_to: a conversation and its messages are visible to its readers only');
END;
$$;

-- ── Reading never needs the plan; leaving and deleting end it ───────────────
DO $$
DECLARE
  v text;
BEGIN
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');
  v := test.sees('B');
  PERFORM test.ok(v LIKE 'P:1 M:1 regP:1 regM:1 linkP:1 linkM:1 actP:% Q:1 regQ:1 linkQ:1' AND v NOT LIKE '%actP:0%',
    'plan off: B still reads P, its message, registry, link and activity rows (CH4a)', v);
  PERFORM test.ok(test.sees('C') = 'P:0 M:0 regP:0 regM:0 linkP:0 linkM:0 actP:0 Q:1 regQ:1 linkQ:1',
    'plan off: C still reads nothing about P');
  v := test.as_user('B', format($q$SELECT public.chat_op_send(%L, 'still?', NULL, '{}'::uuid[], false, NULL, NULL)$q$,
    test.ref('P')));
  PERFORM test.ok(v = '42501 Chat is available on the Duo and Team plans.', 'plan off: writing still needs the plan', v);
  v := test.as_user('A', format($q$SELECT public.share_op_announce(%L, true)$q$, test.ref('P')));
  PERFORM test.ok(v = '42501 Chat is available on the Duo and Team plans.'
                  AND NOT (SELECT managers_only FROM public.chat_channels WHERE id = test.ref('P')),
    'plan off: announcement mode, a write, needs the plan too', v);
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');

  -- B leaves P (v2 stamps the row instead of deleting it).
  UPDATE public.chat_members SET left_at = now() WHERE channel_id = test.ref('P') AND user_id = test.id('B');
  PERFORM test.ok(test.sees('B') LIKE 'P:0 M:0 regP:0 regM:0 linkP:0 linkM:0 actP:0 %',
    'left: B, who left P, reads nothing about it any more', test.sees('B'));
  PERFORM test.ok(test.reads('B', 'chat_members', format('channel_id = %L AND user_id = %L', test.ref('P'), test.id('B'))) = 1,
    'left: B still reads their own membership row (that is how the removal reaches them)');
  PERFORM test.ok(NOT public.spine__visible_to(test.id('W'), 'chat_channel', test.ref('P'), test.id('B')),
    'left: spine__visible_to says no for B');

  -- Q is deleted (Recently deleted, CH62).
  UPDATE public.chat_channels SET deleted_at = now(), deleted_by = test.id('A') WHERE id = test.ref('Q');
  PERFORM test.ok(test.sees('C') = 'P:0 M:0 regP:0 regM:0 linkP:0 linkM:0 actP:0 Q:0 regQ:0 linkQ:0'
                  AND test.sees('A') LIKE '% Q:0 regQ:0 linkQ:0',
    'deleted: nobody reads a deleted conversation, its messages, registry or links', test.sees('A'));
END;
$$;

-- ── Columns, stamps and body_text ───────────────────────────────────────────
DO $$
DECLARE
  v_before timestamptz;
  v_after timestamptz;
  v text;
BEGIN
  PERFORM test.ok(
    (SELECT format_version FROM public.chat_messages WHERE id = test.ref('N')) = 2
    AND (SELECT body FROM public.chat_messages WHERE id = test.ref('N')) = 'Żółw *ahead*'
    AND (SELECT body_text FROM public.chat_messages WHERE id = test.ref('N')) = 'Żółw ahead'
    AND (SELECT body_text FROM public.chat_messages WHERE id = test.ref('M')) = 'hello',
    'body_text: a v1 send (through its wrapper, CV-2a) is stored as v2 and its words carry no person id');
  PERFORM test.ok(
    (SELECT search_tsv @@ to_tsquery('simple', 'zolw') FROM public.chat_messages WHERE id = test.ref('N'))
    AND (SELECT search_tsv @@ to_tsquery('simple', 'ahead') FROM public.chat_messages WHERE id = test.ref('N')),
    'search_tsv: "zolw" finds "Żółw" (simple + unaccent)');

  SELECT updated_at INTO v_before FROM public.chat_messages WHERE id = test.ref('N');
  v := test.as_user('C', format($q$SELECT public.chat_op_react(%L, 'thumbs_up')$q$, test.ref('M')));
  v := test.as_user('A', format($q$SELECT public.chat_op_react(%L, 'thumbs_up')$q$, test.ref('M')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A reacts to M', v);
  SELECT updated_at INTO v_after FROM public.chat_messages WHERE id = test.ref('M');
  PERFORM test.ok(v_after > (SELECT created_at FROM public.chat_messages WHERE id = test.ref('M'))
                  AND v_after <= clock_timestamp(),
    'updated_at: a reaction moves the message''s stamp (server clock)');
  PERFORM test.ok(
    (SELECT updated_at FROM public.chat_members WHERE channel_id = test.ref('P') AND user_id = test.id('B'))
      > (SELECT joined_at FROM public.chat_members WHERE channel_id = test.ref('P') AND user_id = test.id('B'))
    AND (SELECT updated_at FROM public.chat_channels WHERE id = test.ref('Q'))
      > (SELECT created_at FROM public.chat_channels WHERE id = test.ref('Q')),
    'updated_at: membership and conversation rows are stamped when they change');

  -- A v2 row: references, days and link targets add no words.
  INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, format_version)
  VALUES (test.id('W'), test.ref('P'), test.id('A'),
          E'**Zółw** moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6 [docs](https://moduo.app) moduo://date/2026-10-14\n\n- one\n- `two`',
          2)
  RETURNING id INTO v;
  PERFORM test.ok((SELECT body_text FROM public.chat_messages WHERE id = v::uuid) = E'Zółw  docs\none\ntwo',
    'body_text: a v2 body''s words, without syntax, URIs or link targets',
    (SELECT body_text FROM public.chat_messages WHERE id = v::uuid));
  PERFORM test.ok(public.chat__body_text(E'> quoted *it*\n\n```\nraw **x**\n```') = E'quoted it\nraw **x**'
                  AND public.chat__body_text('a \*literal\* star') = 'a *literal* star'
                  AND public.chat__body_text('[title](moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6) x') = 'x'
                  AND public.chat__body_text('**open') = '**open',
    'body_text: quotes, code blocks, escapes, titled references, an unclosed marker');
  PERFORM test.ok(
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'format_version') = '2'
    AND (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'kind') = '''message''::text',
    'columns: new rows are v2 (format_version defaults to 2 since CV-2a); rows are messages by default');
END;
$$;

-- ── Closed vocabularies and shapes ──────────────────────────────────────────
CREATE FUNCTION test.refused(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END;
$$;
DO $$
BEGIN
  PERFORM test.ok(test.refused(format(
      $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, kind) VALUES (%L, %L, %L, 'x', 'note')$q$,
      test.id('W'), test.ref('P'), test.id('A'))) = '23514'
    AND test.refused(format(
      $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, kind, event) VALUES (%L, %L, %L, '', 'event', '{"type": "copied"}')$q$,
      test.id('W'), test.ref('P'), test.id('A'))) = '23514'
    AND test.refused(format(
      $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, kind) VALUES (%L, %L, %L, '', 'event')$q$,
      test.id('W'), test.ref('P'), test.id('A'))) = '23514'
    AND test.refused(format(
      $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, format_version) VALUES (%L, %L, %L, 'x', 3)$q$,
      test.id('W'), test.ref('P'), test.id('A'))) = '23514'
    AND test.refused(format(
      $q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, kind, event) VALUES (%L, %L, %L, '', 'event', '{"type": "moved_out", "ids": []}')$q$,
      test.id('W'), test.ref('P'), test.id('A'))) = 'ok',
    'CHECKs: message kinds and event types are closed; an event line carries its event');
  PERFORM test.ok(test.refused(format(
      $q$INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, reason) VALUES (%L, %L, %L, 'gossip')$q$,
      test.id('W'), test.id('B'), test.ref('P'))) = '23514'
    AND test.refused(format(
      $q$INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, reason, done_at, done_how) VALUES (%L, %L, %L, 'mention', now(), 'ignored')$q$,
      test.id('W'), test.id('B'), test.ref('P'))) = '23514'
    AND test.refused(format(
      $q$INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, reason, done_at) VALUES (%L, %L, %L, 'mention', now())$q$,
      test.id('W'), test.id('B'), test.ref('P'))) = '23514',
    'CHECKs: Catch up reasons and how-done are closed; done needs its how');
  PERFORM test.ok(test.refused(format(
      $q$INSERT INTO public.chat_channels (workspace_id, kind, name) VALUES (%L, 'channel', ' Launch')$q$, test.id('W'))) = '23514'
    AND test.refused(format(
      $q$INSERT INTO public.chat_channels (workspace_id, kind, name, is_default) VALUES (%L, 'channel', 'Second', true), (%L, 'channel', 'Third', true)$q$,
      test.id('W'), test.id('W'))) = '23505',
    'channels: names are trimmed; one General per workspace');
END;
$$;

-- ── Catch up and Stop following: own rows, written by ops only ──────────────
DO $$
BEGIN
  INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, message_id, reason)
  VALUES (test.id('W'), test.id('B'), test.ref('D'), NULL, 'dm'),
         (test.id('W'), test.id('C'), test.ref('Q'), NULL, 'everyone');
  INSERT INTO public.chat_chain_mutes (user_id, root_id, workspace_id) VALUES (test.id('B'), test.ref('M'), test.id('W'));
  PERFORM test.ok(
    test.reads('B', 'chat_catchup', 'true') = 1 AND test.reads('C', 'chat_catchup', 'true') = 1
    AND test.reads('A', 'chat_catchup', 'true') = 0 AND test.reads('X', 'chat_catchup', 'true') = 0
    AND test.reads('B', 'chat_chain_mutes', 'true') = 1 AND test.reads('A', 'chat_chain_mutes', 'true') = 0,
    'own rows: each person reads only their own Catch up items and chain mutes');
  PERFORM test.ok(
    test.as_user('B', format($q$INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, reason) VALUES (%L, %L, %L, 'dm')$q$,
      test.id('W'), test.id('B'), test.ref('D'))) LIKE '42501%'
    AND test.as_user('B', 'UPDATE public.chat_catchup SET done_at = now(), done_how = ''done''') LIKE '42501%'
    AND test.as_user('B', 'DELETE FROM public.chat_chain_mutes') LIKE '42501%'
    AND test.as_user('B', format($q$UPDATE public.chat_messages SET body = 'x' WHERE id = %L$q$, test.ref('M'))) LIKE '42501%'
    AND NOT has_table_privilege('anon', 'public.chat_catchup', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.chat_chain_mutes', 'SELECT'),
    'grants: signed-in people only read; nobody writes these tables directly; anon nothing');
  PERFORM test.ok(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.chat_catchup'::regclass)
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.chat_chain_mutes'::regclass),
    'RLS is on for both new tables');
  PERFORM test.ok(
    NOT has_function_privilege('authenticated', 'public.chat__convert_v1(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.chat__can_read_channel_as(uuid, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.chat__v1_to_v2(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat_can_read_channel(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.chat_can_read_channel(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.chat__unaccent(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.chat__unaccent(text)', 'EXECUTE'),
    'grants: the helpers are server-only; the read rule is for signed-in people');
  PERFORM test.ok(
    (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
      'chat_messages_stream_idx', 'chat_messages_delta_idx', 'chat_messages_search_idx',
      'chat_channels_public_name_uq', 'chat_channels_default_uq', 'chat_channels_delta_idx',
      'chat_channels_deleted_idx', 'chat_members_delta_idx', 'chat_catchup_open_idx',
      'chat_catchup_channel_open_idx', 'chat_catchup_later_idx', 'chat_catchup_message_reason_uq',
      'chat_catchup_level_reset_uq')) = 13,
    'indexes: the stream, delta, search, name, General and Catch up indexes exist');
END;
$$;

-- ── body_text runs on every write: its work stays linear in the body ────────
-- Bodies built to be slow (8,000 characters each); each must take well under a
-- second (they take ~10–70 ms locally; a quadratic reading took seconds).
DO $$
DECLARE
  v_body text;
  v_start timestamptz;
  v_worst interval := interval '0';
BEGIN
  FOREACH v_body IN ARRAY ARRAY[
    repeat('[a](', 2000),
    repeat('*a ', 2666),
    repeat('[', 4000) || repeat(']', 4000),
    '[' || repeat('*a*', 2600) || '](moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6)',
    (SELECT string_agg(repeat('`', g), ' ') FROM generate_series(1, 125) g),
    repeat('[x](<', 1600),
    repeat(E'1. a\n   b\n', 800)
  ] LOOP
    v_start := clock_timestamp();
    PERFORM public.chat__body_text(v_body);
    v_worst := greatest(v_worst, clock_timestamp() - v_start);
  END LOOP;
  FOREACH v_body IN ARRAY ARRAY[repeat('```', 2666), repeat('_*', 4000), repeat('**_~~', 1600)] LOOP
    v_start := clock_timestamp();
    PERFORM public.chat__body_text(public.chat__v1_to_v2(v_body));
    v_worst := greatest(v_worst, clock_timestamp() - v_start);
  END LOOP;
  PERFORM test.ok(v_worst < interval '1 second',
    'cost: the slowest crafted 8,000-character body is read in under a second', v_worst::text);
END;
$$;

-- ── The read rule is written out twice: both agree, and agree with perm_user_has ──
-- (chat_can_read_channel for the session, chat__can_read_channel_as for a given
-- person; the reference below composes the rule from perm_user_has itself, so a
-- change to the permission core shows up here).
CREATE FUNCTION test.read_rule_mismatches() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(u || '/' || ch, ' ' ORDER BY u, ch)
  FROM unnest(ARRAY['O', 'A', 'B', 'C', 'V', 'X']) AS u
  CROSS JOIN unnest(ARRAY['P', 'Q', 'D']) AS ch
  CROSS JOIN LATERAL (
    SELECT test.value_as(u, format('SELECT public.chat_can_read_channel(%L)::text', test.ref(ch))) AS session,
           public.chat__can_read_channel_as(test.ref(ch), test.id(u))::text AS given,
           coalesce((SELECT (w.deleted_at IS NULL AND c.deleted_at IS NULL
                             AND public.perm_user_has(c.workspace_id, test.id(u), 'chat.view')
                             AND ((c.kind = 'channel' AND NOT c.is_private)
                                  OR EXISTS (SELECT 1 FROM public.chat_members m
                                              WHERE m.channel_id = c.id AND m.user_id = test.id(u)
                                                AND m.left_at IS NULL)))::text
                       FROM public.chat_channels c JOIN public.workspaces w ON w.id = c.workspace_id
                      WHERE c.id = test.ref(ch)), 'false') AS reference) r
  WHERE r.session IS DISTINCT FROM r.given OR r.given IS DISTINCT FROM r.reference
$$;
DO $$
BEGIN
  PERFORM test.ok(test.read_rule_mismatches() IS NULL,
    'parity: session and per-person read rules agree with perm_user_has (after a leave and a delete)',
    test.read_rule_mismatches());
  UPDATE public.chat_channels SET deleted_at = NULL, deleted_by = NULL WHERE id = test.ref('Q');
  UPDATE public.chat_members SET left_at = NULL WHERE channel_id = test.ref('P') AND user_id = test.id('B');
  PERFORM test.ok(test.read_rule_mismatches() IS NULL,
    'parity: … with everyone back in', test.read_rule_mismatches());
  -- (perm_members_resolve would recompute perms from the role: set them as the
  -- role editor's overrides would leave them.)
  SET LOCAL session_replication_role = replica;
  UPDATE public.workspace_members SET perms = array_remove(perms, 'chat.view')
   WHERE workspace_id = test.id('W') AND user_id = test.id('C');
  SET LOCAL session_replication_role = origin;
  PERFORM test.ok(test.read_rule_mismatches() IS NULL
                  AND NOT public.chat__can_read_channel_as(test.ref('Q'), test.id('C')),
    'parity: … and with Chat at None for C (C reads nothing, even the public Q)', test.read_rule_mismatches());
  UPDATE public.workspaces SET deleted_at = now() WHERE id = test.id('W');
  PERFORM test.ok(test.read_rule_mismatches() IS NULL
                  AND NOT public.chat__can_read_channel_as(test.ref('P'), test.id('A'))
                  AND NOT public.chat__can_read_channel_as(test.ref('Q'), test.id('O')),
    'parity: … and once the workspace is deleted (nobody reads, the owner included)', test.read_rule_mismatches());
END;
$$;

-- ── A long code fence reads as code, never an error (the trigger runs on every write) ──
DO $$
BEGIN
  PERFORM test.ok(public.chat__body_text(repeat('`', 300) || E'\nfoo\n' || repeat('`', 301)) = 'foo'
                  AND public.chat__body_text(repeat('`', 300) || E'\nfoo') = 'foo',
    'body_text: a fence of 300 backticks reads its code (closed or not)');
END;
$$;

-- ── Every SECURITY DEFINER function this block adds or redefines pins its
--    search_path and is executable by no one it shouldn't be (no PUBLIC grant,
--    never anon; signed-in people only for the read rules and the announce op) ──
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p
   WHERE p.oid IN (
           'public.chat__can_read_channel_as(uuid, uuid)'::regprocedure,
           'public.chat_can_read_channel(uuid)'::regprocedure,
           'public.spine__visible_to(uuid, text, uuid, uuid)'::regprocedure,
           'public.chat_realtime_topic_allowed(text)'::regprocedure,
           'public.share_op_announce(uuid, boolean)'::regprocedure,
           'public.chat__convert_v1(uuid)'::regprocedure,
           'public.chat__messages_body_text()'::regprocedure,
           'public.account_erase_workspace_data(uuid, boolean)'::regprocedure)
     AND (NOT p.prosecdef
          OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
          OR p.proacl IS NULL
          OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
          OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  PERFORM test.ok(v_bad IS NULL, 'definers: search_path pinned, no PUBLIC or anon EXECUTE', v_bad);
  SELECT string_agg(f, ', ') INTO v_bad
    FROM unnest(ARRAY['chat__can_read_channel_as(uuid, uuid)', 'spine__visible_to(uuid, text, uuid, uuid)',
                      'chat__convert_v1(uuid)', 'chat__messages_body_text()',
                      'account_erase_workspace_data(uuid, boolean)', 'chat__body_text(text)',
                      'chat__v1_to_v2(text)', 'chat__unaccent(text)']) AS f
   WHERE has_function_privilege('authenticated', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'definers: the server-only helpers are not callable by signed-in people', v_bad);
END;
$$;
