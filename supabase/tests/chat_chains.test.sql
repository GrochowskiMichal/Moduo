-- Chat v2 · CV-12 "chains, Wrap up, reopen, Reply to…" (AC8.1–8.5, AC2.6;
-- supabase/migrations/…_chat_v2_chains.sql). A reply to a reply joins the
-- root's chain and quotes the reply; Wrap up needs a reply of that chain and
-- the right person (the root's author, a manager, an admin, anyone who can
-- post in a direct message; never a viewer); unread replies a wrap-up hides
-- stay in Catch up until the chain is read; a new reply reopens it visibly;
-- the toast's Undo leaves no line; Reply to… re-parents and fixes counts;
-- only people who can read a conversation act on its chains; every op takes
-- the person from the session.
--
-- Cast: O owns workspace W (Duo, an admin). A, B, C are members; V is a
-- viewer; X is a member outside the private channel P. Q is a public channel
-- A makes (A manages it) with B, C and V; P is a private one of A and B; D is
-- B and C's direct message. K is A's API key.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'V', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Chains');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('C'), 'member'),
  (test.id('W'), test.id('X'), 'member'),
  (test.id('W'), test.id('V'), 'viewer')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv12'),
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
-- Posts p_name in conversation p_conv, answering p_to (or nothing). The test
-- runs in one transaction (one now()), so each post is stamped a second after
-- the last: messages keep the order they were posted in.
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
CREATE FUNCTION test.wrap(p_who text, p_root text, p_settled text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT id FROM public.chat_op_wrap_up(%L::uuid, %L::uuid)$q$,
    test.mid(p_root), test.mid(p_settled)))
$$;
CREATE FUNCTION test.reopen(p_who text, p_root text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT id FROM public.chat_op_reopen(%L::uuid)$q$, test.mid(p_root)))
$$;
CREATE FUNCTION test.attach(p_who text, p_msg text, p_to text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT id FROM public.chat_op_attach_to_chain(%L::uuid, %L::uuid)$q$,
    test.mid(p_msg), test.mid(p_to)))
$$;
-- p_who's open Catch up items for a chain.
CREATE FUNCTION test.open_items(p_who text, p_root text) RETURNS bigint LANGUAGE sql VOLATILE AS $$
  SELECT count(*) FROM public.chat_catchup k
   WHERE k.user_id = test.id(p_who) AND k.done_at IS NULL AND k.chain_root_id = test.mid(p_root)
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
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'secret', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'secret';
  v := test.value_as('B', format($q$SELECT id::text FROM public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('C')));
  PERFORM test.ok(v ~ '^[0-9a-f-]{36}$', 'setup: B opens a direct message with C', v);
  INSERT INTO test.ids VALUES ('D', v::uuid);
END;
$$;

-- ── AC8.1 · a reply quotes and joins the root's chain ───────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.post('A', 'Q', 'early') LIKE 'ok %', 'A says hello in Q');
  PERFORM test.ok(test.post('A', 'Q', 'r') LIKE 'ok %', 'A asks r in Q');
  PERFORM test.ok(test.post('B', 'Q', 'r1', 'r') LIKE 'ok %', 'B replies r1 to r');
  v := test.post('C', 'Q', 'r2', 'r1');
  PERFORM test.ok(v LIKE 'ok %', 'C replies r2 to the reply r1', v);
  PERFORM test.ok((test.msg('r2')).parent_id = test.mid('r') AND (test.msg('r2')).reply_to_id = test.mid('r1'),
    'a reply to a reply joins the root''s chain and quotes the reply it answers');
  PERFORM test.ok((test.msg('r')).reply_count = 2 AND (test.msg('r')).reply_user_ids[1] = test.id('C'),
    '"N replies" counts it, newest replier first');
  PERFORM test.ok(test.open_items('A', 'r') = 1, 'the root''s author has one Catch up item for the chain');
END;
$$;

-- ── AC8.3 · who may wrap up, and with which reply ───────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.wrap('C', 'r', 'r1');
  PERFORM test.ok(v LIKE '42501 %', 'a member who didn''t start the chain can''t wrap it up', v);
  v := test.wrap('V', 'r', 'r1');
  PERFORM test.ok(v NOT LIKE 'ok %', 'a viewer can''t wrap up', v);
  v := test.wrap('X', 'r', 'r1');
  PERFORM test.ok(v LIKE '42501 %', 'a workspace member outside the chain''s people can''t wrap up', v);
  v := test.wrap('A', 'r', 'r');
  PERFORM test.ok(v LIKE '22023 %', 'the root itself didn''t settle its chain', v);
  PERFORM test.ok(test.post('C', 'Q', 'other') LIKE 'ok %', 'C posts a stray message');
  v := test.wrap('A', 'r', 'other');
  PERFORM test.ok(v LIKE '22023 %', 'a message outside the chain didn''t settle it', v);
  v := test.wrap('A', 'r1', 'r2');
  PERFORM test.ok(v LIKE '22023 %', 'only a chain''s first message is wrapped up', v);
  PERFORM test.ok((test.msg('r')).wrapped_at IS NULL, 'nothing refused changed the chain');

  v := test.wrap('A', 'r', 'r1');
  PERFORM test.ok(v LIKE 'ok %', 'the root''s author wraps it up with the reply that settled it', v);
  PERFORM test.ok((test.msg('r')).wrapped_by = test.id('A') AND (test.msg('r')).settled_id = test.mid('r1')
              AND (test.msg('r')).reopened_at IS NULL, 'the root keeps who wrapped it up and the settling reply');
  PERFORM test.ok((test.msg('r1')).deleted_at IS NULL AND (test.msg('r1')).parent_id = test.mid('r')
              AND (test.msg('r')).reply_count = 2, 'the replies stay rows of the chain (a drawing rule)');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity WHERE workspace_id = test.id('W')
                           AND op = 'chat.wrap_up' AND payload->>'message_id' = test.mid('r')::text
                           AND payload->>'settled_id' = test.mid('r1')::text),
    'a chat.wrap_up line is logged');
END;
$$;

-- ── AC8.3 · unread replies a wrap-up hides stay in Catch up ─────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.post('B', 'Q', 'later') LIKE 'ok %', 'B posts after the chain');
  v := test.as_user('A', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('Q'), test.mid('later')));
  PERFORM test.ok(v LIKE 'ok %', 'A reads the stream past the hidden replies', v);
  PERFORM test.ok(test.open_items('A', 'r') = 1, 'the hidden replies stay in A''s Catch up as one chain item');
  v := test.as_user('C', format($q$SELECT public.chat_op_chain_read(%L::uuid)$q$, test.mid('r')));
  PERFORM test.ok(v LIKE 'ok %' AND test.open_items('A', 'r') = 1, 'someone else reading the chain closes nothing of A''s', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_chain_read(%L::uuid)$q$, test.mid('r')));
  PERFORM test.ok(v LIKE 'ok %', 'reading a public channel''s chain needs only reading it', v);
  v := test.value_as('A', format($q$SELECT public.chat_op_chain_read(%L::uuid)::text$q$, test.mid('r')));
  PERFORM test.ok(v = '1' AND test.open_items('A', 'r') = 0, 'reading the chain on the right closes it', v);
END;
$$;

-- ── Undo, Reopen, and a new reply reopening (CH54) ──────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.reopen('C', 'r');
  PERFORM test.ok(v LIKE '42501 %', 'a member who didn''t start the chain can''t reopen it', v);
  v := test.reopen('A', 'r');
  PERFORM test.ok(v LIKE 'ok %' AND (test.msg('r')).wrapped_at IS NULL AND (test.msg('r')).settled_id IS NULL
              AND (test.msg('r')).reopened_at IS NULL,
    'the Undo right after wrapping opens it again without a "Reopened by" line', v);
  v := test.wrap('O', 'r', 'r2');
  PERFORM test.ok(v LIKE 'ok %', 'an admin wraps up a chain in a channel they''re not in', v);
  PERFORM test.ok(test.post('B', 'Q', 'r3', 'r2') LIKE 'ok %', 'B replies to the wrapped chain');
  PERFORM test.ok((test.msg('r')).wrapped_at IS NULL AND (test.msg('r')).reopened_by = test.id('B')
              AND (test.msg('r')).reopened_at IS NOT NULL AND (test.msg('r')).reply_count = 3,
    'a new reply reopens it visibly: "Reopened by" the sender');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity WHERE workspace_id = test.id('W')
                           AND op = 'chat.reopen' AND actor_id = test.id('B')
                           AND payload->>'message_id' = test.mid('r')::text),
    'a chat.reopen line names who reopened it');

  -- A manager, not the author: A manages Q; C asks.
  PERFORM test.ok(test.post('C', 'Q', 'c') LIKE 'ok %', 'C asks c');
  PERFORM test.ok(test.post('B', 'Q', 'c1', 'c') LIKE 'ok %', 'B answers c1');
  v := test.wrap('A', 'c', 'c1');
  PERFORM test.ok(v LIKE 'ok %', 'the channel''s manager wraps up someone else''s chain', v);
  v := test.reopen('C', 'c');
  PERFORM test.ok(v LIKE 'ok %' AND (test.msg('c')).reopened_by = test.id('C'),
    'the root''s author reopens it ("Reopened by")', v);

  -- A direct message: anyone in it who can post.
  PERFORM test.ok(test.post('B', 'D', 'd') LIKE 'ok %', 'B asks d in the direct message');
  PERFORM test.ok(test.post('C', 'D', 'd1', 'd') LIKE 'ok %', 'C answers d1');
  v := test.wrap('C', 'd', 'd1');
  PERFORM test.ok(v LIKE 'ok %', 'in a direct message anyone in it wraps up', v);
  v := test.wrap('O', 'd', 'd1');
  PERFORM test.ok(v LIKE 'P0002 %' OR v LIKE '42501 %', 'nobody outside a direct message touches its chains', v);
END;
$$;

-- ── AC8.5 · Reply to… ───────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.post('C', 'Q', 's') LIKE 'ok %', 'C posts a stray answer s');
  v := test.attach('B', 's', 'r1');
  PERFORM test.ok(v LIKE '42501 %', 'a member can''t move someone else''s message', v);
  v := test.attach('C', 's', 'r1');
  PERFORM test.ok(v LIKE 'ok %' AND (test.msg('s')).parent_id = test.mid('r') AND (test.msg('s')).reply_to_id = test.mid('r1')
              AND (test.msg('r')).reply_count = 4,
    'Reply to… attaches your stray message to the chain and counts it', v);
  v := test.attach('A', 's', 'c');
  PERFORM test.ok(v LIKE 'ok %' AND (test.msg('s')).parent_id = test.mid('c')
              AND (test.msg('r')).reply_count = 3 AND (test.msg('c')).reply_count = 2,
    'a manager re-parents someone''s reply: the old chain''s count drops, the new one''s grows', v);
  v := test.attach('A', 'r', 'early');
  PERFORM test.ok(v LIKE '22023 %', 'a message with replies of its own stays a root', v);
  v := test.attach('C', 'other', 'later');
  PERFORM test.ok(v LIKE '22023 %', 'a message can''t answer a later one', v);
  PERFORM test.ok(test.post('A', 'P', 'p') LIKE 'ok %', 'A posts p in the private channel');
  v := test.attach('C', 'other', 'p');
  PERFORM test.ok(v LIKE '22023 %', 'Reply to… stays in its conversation', v);

  -- Joining a wrapped chain reopens it, as a new reply does.
  PERFORM test.ok(test.wrap('C', 'c', 's') LIKE 'ok %', 'C wraps up c again');
  PERFORM test.ok(test.post('C', 'Q', 'tail') LIKE 'ok %', 'C posts another stray answer');
  v := test.attach('C', 'tail', 'c');
  PERFORM test.ok(v LIKE 'ok %' AND (test.msg('c')).wrapped_at IS NULL AND (test.msg('c')).reopened_by = test.id('C'),
    'a message joining a wrapped chain reopens it', v);
  v := test.as_user('V', format($q$SELECT id FROM public.chat_op_attach_to_chain(%L::uuid, %L::uuid)$q$,
    test.mid('later'), test.mid('r')));
  PERFORM test.ok(v NOT LIKE 'ok %', 'a viewer moves nothing', v);
END;
$$;

-- ── Only people who can read a conversation act on its chains ───────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.post('B', 'P', 'p1', 'p') LIKE 'ok %', 'B answers p in the private channel');
  v := test.wrap('X', 'p', 'p1');
  PERFORM test.ok(v LIKE 'P0002 %', 'outside a private channel, its chain reads as missing (wrap up)', v);
  v := test.reopen('X', 'p');
  PERFORM test.ok(v LIKE 'P0002 %', 'outside a private channel, its chain reads as missing (reopen)', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_chain_read(%L::uuid)$q$, test.mid('p')));
  PERFORM test.ok(v LIKE 'P0002 %', 'outside a private channel, its chain reads as missing (read)', v);
  v := test.as_user('X', format($q$SELECT id FROM public.chat_op_attach_to_chain(%L::uuid, %L::uuid)$q$,
    test.mid('p1'), test.mid('p')));
  PERFORM test.ok(v LIKE 'P0002 %', 'outside a private channel, its messages read as missing (Reply to…)', v);
  v := test.as_key('K', format($q$SELECT id FROM public.chat_op_wrap_up(%L::uuid, %L::uuid)$q$, test.mid('r'), test.mid('r1')));
  PERFORM test.ok(v NOT LIKE 'ok %', 'an API key doesn''t wrap up (ops take the signed-in person)', v);
  PERFORM test.ok(NOT has_function_privilege('anon', 'public.chat_op_wrap_up(uuid, uuid, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.chat_op_reopen(uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.chat_op_attach_to_chain(uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.chat_op_chain_read(uuid)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.chat__reopen_chain(public.chat_messages, uuid, timestamptz)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.chat__may_wrap(public.chat_channels, public.chat_messages, uuid)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.chat_op_send(uuid, uuid, text, uuid)', 'EXECUTE'),
    'grants: the ops for signed-in people, the helpers server only');
  -- The spine: a key reads no chat row through it.
  v := test.as_key('K', format($q$SELECT 1 WHERE public.perm_can_see_entity(%L, 'chat_message', %L)$q$,
    test.id('W'), test.mid('r')));
  PERFORM test.ok(v = 'ok 0', 'a key reads no chat row through the spine, a wrapped chain''s root included', v);
END;
$$;

-- ── Grants: each function exactly as intended ───────────────────────────────
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.chat_op_wrap_up(uuid, uuid, boolean)', true),
    ('public.chat_op_reopen(uuid)', true),
    ('public.chat_op_attach_to_chain(uuid, uuid)', true),
    ('public.chat_op_chain_read(uuid)', true),
    ('public.chat_op_send(uuid, uuid, text, uuid)', true),
    ('public.chat__may_wrap(public.chat_channels, public.chat_messages, uuid)', false),
    ('public.chat__chain_root(uuid)', false),
    ('public.chat__reopen_chain(public.chat_messages, uuid, timestamptz)', false),
    ('public.chat__close_read(uuid, uuid, public.chat_messages)', false)) AS t(fn, signed_in)
  LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', f.fn, 'EXECUTE')
                AND has_function_privilege('authenticated', f.fn, 'EXECUTE') = f.signed_in
                AND has_function_privilege('service_role', f.fn, 'EXECUTE')
                AND NOT EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = f.fn::regprocedure)) a
                                 WHERE a.grantee = 0),
      format('grants: %s is %s', f.fn, CASE WHEN f.signed_in THEN 'for signed-in people, never anon or PUBLIC' ELSE 'server only' END));
  END LOOP;
END;
$$;
