-- Chat v2 · CV-7c "one key for chat and comments" (AC10.9;
-- supabase/migrations/…_chat_v2_reactions.sql). Any emoji is a reaction on a
-- message, a comment and in your quick row, through one server check; at most
-- 20 kinds; the six TV-U13 words became emoji, losslessly and only once; a
-- viewer reacts in chat; only people who can read a message or comment react
-- to it or see who reacted; the reactor is always the signed-in person; a
-- reaction never writes a notice.
--
-- Cast: O owns workspace W (Duo). A and B are members; V is a viewer; X is in
-- no workspace; K is A's API key (chat and tasks at Edit). Q is a public
-- channel A makes with B and V; P a private one of A and B. T is a task in
-- the shared project SB; PB is O's private project with task TP. N can only
-- view O's project PV (task TV).

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'V', 'N', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Reactions');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('N'), 'member'),
  (test.id('W'), test.id('V'), 'viewer')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001'),
  (test.id('PB'), test.id('W'), test.id('O'), 'O private', false, '0002'),
  (test.id('PV'), test.id('W'), test.id('O'), 'O view-only', false, '0003');
DELETE FROM public.resource_grants
WHERE resource_type = 'bucket' AND resource_id IN (test.id('PB'), test.id('PV'));
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES (test.id('W'), 'bucket', test.id('PV'), 'member', test.id('N'), 'view', test.id('O'));
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv7c'),
        '{"chat": "edit", "tasks": "edit"}'::jsonb, test.id('A'));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
CREATE FUNCTION test.react(p_who text, p_msg text, p_key text, p_on boolean DEFAULT true) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_react(%L::uuid, %L::text, %L::boolean)$q$,
    test.mid(p_msg), p_key, p_on))
$$;
CREATE FUNCTION test.creact(p_who text, p_comment text, p_key text, p_on boolean DEFAULT true) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT * FROM public.comments_op_react(%L, %L, %L)$q$,
    test.id(p_comment), p_key, p_on))
$$;
CREATE FUNCTION test.msg(p_name text) RETURNS public.chat_messages LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_messages WHERE id = test.mid(p_name)
$$;
CREATE FUNCTION test.notices() RETURNS bigint LANGUAGE sql VOLATILE AS $$
  SELECT (SELECT count(*) FROM public.notice_deliveries)
       + (SELECT count(*) FROM public.module_activity
           WHERE workspace_id = test.id('W') AND op NOT IN ('chat.react'))
$$;

-- ── Setup: two conversations with a message each; three tasks with a comment each
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'plans', '', false, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('V')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the public channel Q with B and V', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'plans';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'secret', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'secret';
  v := test.as_user('A', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, 'hello'::text, NULL::uuid)$q$,
    test.mid('q1'), test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A posts q1 in Q', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, 'just us'::text, NULL::uuid)$q$,
    test.mid('p1'), test.ref('P')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A posts p1 in P', v);

  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T'), 'title', 'Logo', 'bucket_id', test.id('SB'))));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TP'), 'title', 'Secret', 'bucket_id', test.id('PB'))));
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('TV'), 'title', 'Brief', 'bucket_id', test.id('PV'))));
  -- Comments with stable ids (the op mints its own; rename after).
  INSERT INTO public.comments (id, workspace_id, entity_type, entity_id, created_by, body)
  VALUES (test.id('C'), test.id('W'), 'task', test.id('T'), test.id('O'), 'First pass'),
         (test.id('CP'), test.id('W'), 'task', test.id('TP'), test.id('O'), 'Only mine'),
         (test.id('CV'), test.id('W'), 'task', test.id('TV'), test.id('O'), 'Read-only brief');
END;
$$;

-- ── One key: exactly one emoji, nothing else ────────────────────────────────
-- The corpus below is shared: vocabularies.test.ts reads these lines and holds
-- isReactionKey to the same answers, so the app and the server accept exactly
-- the same keys. Code points in hex, then whether it is a key.
CREATE TABLE test.key_corpus (hex text NOT NULL, ok boolean NOT NULL);
INSERT INTO test.key_corpus (hex, ok) VALUES
-- corpus:begin
  ('1F44D', true),
  ('2705', true),
  ('1F440', true),
  ('1F64F', true),
  ('2764 FE0F', true),
  ('1F604', true),
  ('1F389', true),
  ('1F44D 1F3FD', true),
  ('1F468 200D 1F469 200D 1F467', true),
  ('1F1F5 1F1F1', true),
  ('23 FE0F 20E3', true),
  ('2A 20E3', true),
  ('2139 FE0F', true),
  ('A9 FE0F', true),
  ('1F3C3 1F3FD 200D 2642 FE0F', true),
  ('2764 FE0F 200D 1F525', true),
  ('1F3F4 E0067 E0062 E0065 E006E E0067 E007F', true),
  ('1F9D1 1F3FD 200D 1F91D 200D 1F9D1 1F3FB', true),
  ('1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D', true),
  ('1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D 200D 1F44D', false),
  ('', false),
  ('74 68 75 6D 62 73 5F 75 70', false),
  ('3A 70 61 72 74 79 3A', false),
  ('61', false),
  ('31', false),
  ('31 FE0F 20E3', true),
  ('30 20E3', true),
  ('23', false),
  ('21 21', false),
  ('20', false),
  ('3000', false),
  ('A', false),
  ('1F44D 1F44D', false),
  ('1F44D 20', false),
  ('1F44D A', false),
  ('1F44D 61', false),
  ('FE0F', false),
  ('200D', false),
  ('200D 1F44D', false),
  ('1F44D 200D', false),
  ('1F1F5', false),
  ('1F1F5 1F1F1 1F1F5', false),
  ('1F3FD', false),
  ('E0067', false),
  ('1F44D E007F', false),
  ('1F44D 202E', false),
  ('202E 1F44D', false),
  ('200B 1F44D', false),
  ('2066 1F44D 2069', false),
  ('1F44D FEFF', false),
  ('1F44D 0301', false),
  ('E000', false)
-- corpus:end
;

-- One spelling per emoji (shared with vocabularies.test.ts too): what is
-- sent, then what is stored.
CREATE TABLE test.canonical_corpus (hex text NOT NULL, want text NOT NULL);
INSERT INTO test.canonical_corpus (hex, want) VALUES
-- canonical:begin
  ('2764', '2764 FE0F'),
  ('2764 FE0F', '2764 FE0F'),
  ('2764 FE0E', '2764 FE0F'),
  ('23 20E3', '23 FE0F 20E3'),
  ('31 FE0F 20E3', '31 FE0F 20E3'),
  ('261D 1F3FD', '261D 1F3FD'),
  ('2764 200D 1F525', '2764 FE0F 200D 1F525'),
  ('1F44D', '1F44D'),
  ('1F3C3 1F3FD 200D 2642', '1F3C3 1F3FD 200D 2642 FE0F')
-- canonical:end
;

CREATE FUNCTION test.from_hex(p_hex text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_hex = '' THEN '' ELSE (
    SELECT string_agg(chr(('x' || lpad(x, 8, '0'))::bit(32)::int), '' ORDER BY o)
      FROM unnest(string_to_array(p_hex, ' ')) WITH ORDINALITY AS t(x, o)) END
$$;

DO $$
DECLARE
  r record;
  k text;
BEGIN
  FOR r IN SELECT hex, ok FROM test.key_corpus LOOP
    k := test.from_hex(r.hex);
    PERFORM test.ok(public.reactions__key_ok(k) = r.ok,
      format('key: [%s] %s', r.hex, CASE WHEN r.ok THEN 'is a reaction' ELSE 'is refused' END));
  END LOOP;
  FOR r IN SELECT hex, want FROM test.canonical_corpus LOOP
    PERFORM test.ok(public.reactions__key_canonical(test.from_hex(r.hex)) = test.from_hex(r.want)
                AND public.reactions__key_ok(test.from_hex(r.want)),
      format('key: [%s] is stored as [%s]', r.hex, r.want));
  END LOOP;
  PERFORM test.ok(NOT coalesce(public.reactions__key_ok(NULL), true), 'key: nothing is refused');
  PERFORM test.ok(NOT public.reactions__key_ok(repeat('👍', 400)), 'key: a long string is refused');
  PERFORM test.ok(NOT public.reactions__key_ok(E'👍\n'), 'key: a line break is refused');
  -- Custom emoji (`:name:`) arrive with CV-20, which widens this one check.
  PERFORM test.ok(
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'comment_reactions_reaction_check'))
      LIKE '%reactions__key_ok(reaction)%',
    'key: comments store only what the shared check allows');
  PERFORM test.ok(position('reactions__key_ok' IN pg_get_functiondef('public.chat_op_react(uuid, text, boolean)'::regprocedure)) > 0
              AND position('reactions__key_ok' IN pg_get_functiondef('public.comments_op_react(uuid, text, boolean)'::regprocedure)) > 0
              AND position('reactions__key_ok' IN pg_get_functiondef('public.user_op_set_chat_prefs(jsonb)'::regprocedure)) > 0,
    'key: chat, comments and the quick row ask the same check');
END;
$$;

-- ── Chat: any emoji, viewers too, never a notice ────────────────────────────
DO $$
DECLARE
  v text;
  v_before bigint := test.notices();
BEGIN
  v := test.react('V', 'q1', '🎉');
  PERFORM test.ok(v = 'ok 1' AND (test.msg('q1')).reactions -> '🎉' = jsonb_build_array(test.id('V')::text),
    'chat: a viewer reacts with any emoji (AC10.9)', v);
  v := test.react('B', 'q1', '👨‍👩‍👧');
  PERFORM test.ok(v = 'ok 1', 'chat: a joined emoji is one key', v);
  PERFORM test.react('B', 'q1', chr(10084));
  PERFORM test.react('V', 'q1', chr(10084) || chr(65039));
  PERFORM test.ok(jsonb_array_length((test.msg('q1')).reactions -> (chr(10084) || chr(65039))) = 2
              AND NOT ((test.msg('q1')).reactions ? chr(10084)),
    'chat: ❤ and ❤️ are one key (one spelling is stored)');
  PERFORM test.react('B', 'q1', chr(10084), false);
  PERFORM test.react('V', 'q1', chr(10084), false);
  v := test.react('B', 'q1', 'party');
  PERFORM test.ok(v = '22023 That reaction isn''t supported.', 'chat: a word is refused', v);
  v := test.react('B', 'q1', ':party:');
  PERFORM test.ok(v = '22023 That reaction isn''t supported.', 'chat: a custom name waits for CV-20', v);
  PERFORM test.ok(test.notices() = v_before, 'chat: reacting writes no notice and no notifying activity');

  -- Only readers react, and only readers see who reacted.
  -- A message you can't read gets the same answer as one that doesn't exist.
  v := test.react('V', 'missing', '👍');
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'chat: a missing message is not there', v);
  v := test.react('V', 'p1', '👍');
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'chat: one you can''t read answers the same as a missing one', v);
  v := test.react('X', 'q1', '👍');
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'chat: an outsider gets the same answer', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text)$q$, test.mid('q1')));
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'chat: the toggle form answers the same', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_react(%L::uuid, '👍'::text, true)$q$, test.mid('q1')));
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'chat: a key is refused the same way', v);
  PERFORM test.react('B', 'p1', '👀');
  PERFORM test.ok(test.value_as('V', format($q$SELECT count(*)::text FROM public.chat_messages WHERE id = %L$q$, test.mid('p1'))) = '0'
              AND test.value_as('X', format($q$SELECT count(*)::text FROM public.chat_messages WHERE id = %L$q$, test.mid('q1'))) = '0',
    'chat: who reacted stays with the message''s readers');

  -- At most 20 kinds per message.
  UPDATE public.chat_messages
     SET reactions = (SELECT jsonb_object_agg(chr(128512 + g), jsonb_build_array(test.id('A')::text)) FROM generate_series(1, 20) g)
   WHERE id = test.mid('q1');
  v := test.react('B', 'q1', '🦄');
  PERFORM test.ok(v = '22023 This message has the most reactions it can hold.', 'chat: a 21st kind is refused', v);
  PERFORM test.ok(test.react('B', 'q1', chr(128513)) = 'ok 1', 'chat: joining one of the 20 still works');
END;
$$;

-- ── Comments: any emoji, ≤ 20 kinds, who may react unchanged ────────────────
DO $$
DECLARE
  v text;
  v_before bigint := test.notices();
  g int;
BEGIN
  v := test.creact('A', 'C', '🎉');
  PERFORM test.ok(v = 'ok 1', 'comment: a member reacts with any emoji', v);
  -- An app from before CV-7c sends the old words: they land as their emoji.
  v := test.creact('A', 'C', 'thumbs_up');
  PERFORM test.ok(v = 'ok 2' AND EXISTS (SELECT 1 FROM public.comment_reactions
                                           WHERE comment_id = test.id('C') AND reaction = '👍'),
    'comment: an old app''s word lands as its emoji', v);
  v := test.creact('A', 'C', 'thumbs_up', false);
  PERFORM test.ok(v = 'ok 1', 'comment: and takes it back the same way', v);
  v := test.creact('A', 'C', 'party');
  PERFORM test.ok(v = '22023 That reaction isn''t supported.', 'comment: any other word is refused', v);
  v := test.creact('N', 'CV', '👀');
  PERFORM test.ok(v = 'ok 1', 'comment: a view-only share reacts to what it can comment on', v);
  v := test.creact('V', 'C', '👀');
  PERFORM test.ok(v NOT LIKE 'ok%', 'comment: a workspace viewer still doesn''t (unchanged)', v);
  v := test.creact('B', 'CP', '👀');
  PERFORM test.ok(v LIKE 'P0002%', 'comment: no reaction on what you can''t see', v);
  v := test.creact('X', 'C', '👀');
  PERFORM test.ok(v LIKE 'P0002%', 'comment: an outsider is told it isn''t there', v);
  v := test.as_key('K', format($q$SELECT * FROM public.comments_op_react(%L, '👀')$q$, test.id('C')));
  PERFORM test.ok(v NOT LIKE 'ok%', 'comment: a key can''t react', v);
  PERFORM test.creact('O', 'CP', '🙏');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.comment_reactions WHERE comment_id = %L$q$, test.id('CP'))) = '0'
              AND test.value_as('X', format($q$SELECT count(*)::text FROM public.comment_reactions WHERE comment_id = %L$q$, test.id('C'))) = '0'
              AND test.value_as('B', format($q$SELECT count(*)::text FROM public.comment_reactions WHERE comment_id = %L$q$, test.id('C'))) = '1',
    'comment: who reacted stays with the comment''s readers');
  PERFORM test.ok(test.notices() = v_before, 'comment: reacting writes no notice and no activity');

  -- 20 kinds: the 21st is refused, joining one isn't.
  FOR g IN 1..19 LOOP
    PERFORM test.creact('A', 'C', chr(128512 + g));
  END LOOP;
  PERFORM test.ok((SELECT count(DISTINCT reaction) FROM public.comment_reactions WHERE comment_id = test.id('C')) = 20,
    'comment: 20 kinds held');
  v := test.creact('B', 'C', '🦄');
  PERFORM test.ok(v = '22023 This comment has the most reactions it can hold.', 'comment: a 21st kind is refused', v);
  v := test.creact('B', 'C', '🎉');
  PERFORM test.ok(v LIKE 'ok %', 'comment: joining one of the 20 still works', v);
END;
$$;

-- ── The reactor is always the signed-in person ──────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(
    (SELECT bool_and(NOT (p.proargnames && ARRAY['p_user_id', 'p_user', 'p_actor', 'p_author_id', 'p_by']))
            AND bool_and(p.pronargs <= 3)
       FROM pg_proc p
      WHERE p.oid IN ('public.chat_op_react(uuid, text, boolean)'::regprocedure,
                      'public.chat_op_react(uuid, text)'::regprocedure,
                      'public.comments_op_react(uuid, text, boolean)'::regprocedure,
                      'public.user_op_set_chat_prefs(jsonb)'::regprocedure)),
    'ops: none takes a person from the caller');
  PERFORM test.ok((SELECT bool_and(user_id IN (test.id('A'), test.id('B'), test.id('N'), test.id('O')))
                     FROM public.comment_reactions WHERE workspace_id = test.id('W')),
    'ops: every stored reaction is its reactor''s own');
  PERFORM test.ok(has_function_privilege('authenticated', 'public.comments_op_react(uuid, text, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.comments_op_react(uuid, text, boolean)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.chat_op_react(uuid, text, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.chat_op_react(uuid, text, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.reactions__key_ok(text)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.comment_reactions__words_to_emoji()', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.comment_reactions__words_to_emoji()', 'EXECUTE'),
    'grants: members call the ops, never anonymously; the rewrite is the server''s only');
END;
$$;

-- ── The quick row: the same key ─────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('B', $q$SELECT public.user_op_set_chat_prefs('{"reaction_row": ["🎉", "👍", "👨‍👩‍👧"]}'::jsonb)$q$);
  PERFORM test.ok(v = 'ok 1' AND (SELECT reaction_row FROM public.user_preferences WHERE user_id = test.id('B')) = ARRAY['🎉', '👍', '👨‍👩‍👧'],
    'quick row: any emoji, in your order', v);
  v := test.as_user('B', $q$SELECT public.user_op_set_chat_prefs('{"reaction_row": ["👍", "!!"]}'::jsonb)$q$);
  PERFORM test.ok(v = '22023 A reaction is an emoji.', 'quick row: what isn''t a reaction is refused', v);
  v := test.as_user('B', $q$SELECT public.user_op_set_chat_prefs('{"reaction_row": null}'::jsonb)$q$);
  PERFORM test.ok(v = 'ok 1' AND (SELECT reaction_row FROM public.user_preferences WHERE user_id = test.id('B')) IS NULL,
    'quick row: null is back to Moduo''s six', v);
END;
$$;

-- ── The six words became emoji: lossless, and only once ─────────────────────
DO $$
DECLARE
  v_n int;
  v_before jsonb;
  v_after jsonb;
BEGIN
  -- Rows as TV-U13 stored them (the old CHECK set aside inside this rolled-back test).
  ALTER TABLE public.comment_reactions DROP CONSTRAINT comment_reactions_reaction_check;
  DELETE FROM public.comment_reactions WHERE comment_id = test.id('CV');
  INSERT INTO public.comment_reactions (comment_id, user_id, reaction, workspace_id, created_at)
  SELECT test.id('CV'), test.id(u), w, test.id('W'), timestamptz '2026-10-01 10:00Z' + make_interval(mins => i)
    FROM (VALUES ('O', 'thumbs_up', 1), ('A', 'thumbs_up', 2), ('A', 'check', 3), ('B', 'eyes', 4),
                 ('N', 'pray', 5), ('O', 'heart', 6), ('B', 'smile', 7), ('N', '🎉', 8)) AS s(u, w, i);
  SELECT jsonb_agg(jsonb_build_array(comment_id, user_id, workspace_id, created_at,
           CASE reaction WHEN 'thumbs_up' THEN '👍' WHEN 'check' THEN '✅' WHEN 'eyes' THEN '👀'
                         WHEN 'pray' THEN '🙏' WHEN 'heart' THEN '❤️' WHEN 'smile' THEN '😄' ELSE reaction END)
           ORDER BY created_at)
    INTO v_before FROM public.comment_reactions WHERE comment_id = test.id('CV');

  v_n := public.comment_reactions__words_to_emoji();
  SELECT jsonb_agg(jsonb_build_array(comment_id, user_id, workspace_id, created_at, reaction) ORDER BY created_at)
    INTO v_after FROM public.comment_reactions WHERE comment_id = test.id('CV');
  PERFORM test.ok(v_n = 7 AND v_after = v_before,
    'rewrite: each word became its emoji; who, when and where kept; an emoji untouched', format('%s rows', v_n));
  PERFORM test.ok(public.comment_reactions__words_to_emoji() = 0
              AND (SELECT jsonb_agg(jsonb_build_array(comment_id, user_id, workspace_id, created_at, reaction) ORDER BY created_at)
                     FROM public.comment_reactions WHERE comment_id = test.id('CV')) = v_after,
    'rewrite: a second run changes nothing');
  ALTER TABLE public.comment_reactions
    ADD CONSTRAINT comment_reactions_reaction_check CHECK (public.reactions__key_ok(reaction));
  PERFORM test.ok(true, 'rewrite: every rewritten row passes the shared check');
END;
$$;
