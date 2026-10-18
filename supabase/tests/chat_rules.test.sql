-- Chat v2 rules shared by the message and conversation ops (CV-2-fix:
-- supabase/migrations/…_chat_v2_rules_fix.sql).
--   1. One manager rule: a manager is someone with a manager row who is in the
--      channel and whose role posts. Posting in an announcement channel (the
--      op, the row trigger, an app's key), pinning there, switching
--      announcement-only and the account erasure's hand-over all read it.
--   2. A removal is its own stamp: erasing the remover's account changes
--      nothing for the person they removed.
--   3. A channel's name clashes only with channels its creator can see: every
--      public channel, the private ones they're in.
--
-- Cast: O owns workspace W (Duo); A, B, C, E, R, Z and L are members, V a
-- viewer. N is an announcement channel A manages, where L still has a manager
-- row though they left and V (a viewer) has one while in it. R removes Z from a
-- public and a private channel, then R's account is erased. O3 owns W3, where
-- M3 is a member.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'E', 'R', 'Z', 'L', 'V', 'O3', 'M3']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id IN (test.id('O'), test.id('O3'));
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Rules'),
  (test.id('W3'), test.id('O3'), 'Fresh');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C', 'E', 'R', 'Z', 'L']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W3'), test.id('M3'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
-- A v2 send as a person: the op's answer ('ok 1' or '<sqlstate> <message>').
CREATE FUNCTION test.send(p_who text, p_conv text, p_msg text, p_body text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text)$q$, test.mid(p_msg), test.ref(p_conv), p_body))
$$;
-- A channel made by an op, by name, as a person; remembered as p_ref.
CREATE FUNCTION test.make(p_who text, p_ref text, p_ws text, p_name text, p_private boolean, p_members text[] DEFAULT '{}')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := test.as_user(p_who, format(
    $q$SELECT public.chat_op_create_channel(%L, %L, '', %L, %L::uuid[])$q$,
    test.id(p_ws), p_name, p_private, (SELECT coalesce(array_agg(test.id(m)), '{}') FROM unnest(p_members) m)));
  IF v = 'ok 1' AND p_ref IS NOT NULL THEN
    INSERT INTO test.ids
    SELECT p_ref, c.id FROM public.chat_channels c
     WHERE c.workspace_id = test.id(p_ws) AND c.name = p_name AND c.created_by = test.id(p_who)
       AND c.deleted_at IS NULL;
  END IF;
  RETURN v;
END;
$$;
-- What a statement run by the server (no RLS) answers: 'ok' or its SQLSTATE and message.
CREATE FUNCTION test.err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END;
$$;
CREATE FUNCTION test.row(p_conv text, p_who text) RETURNS public.chat_members LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_members WHERE channel_id = test.ref(p_conv) AND user_id = test.id(p_who)
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('O', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.make('A', 'N', 'W', 'news', false, ARRAY['B', 'L', 'V']);
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the public channel N with B, L and V', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('N')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: N is an announcement channel A manages', v);
  -- L has a manager row but isn't in N;
  -- V, a viewer, has a manager row while in it.
  INSERT INTO public.chat_channel_managers (channel_id, user_id) VALUES
    (test.ref('N'), test.id('L')), (test.ref('N'), test.id('V'));
  UPDATE public.chat_members SET left_at = now() WHERE channel_id = test.ref('N') AND user_id = test.id('L');
  v := test.send('A', 'N', 'n1', 'the plan');
  PERFORM test.ok(v = 'ok 1', 'setup: A posts in N', v);

  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
    (test.id('K:A'), test.id('W'), 'A''s app', 'mdo_ta', md5('db-test-key-rules-a'), '{"chat": "edit"}'::jsonb, test.id('A')),
    (test.id('K:L'), test.id('W'), 'L''s app', 'mdo_tl', md5('db-test-key-rules-l'), '{"chat": "edit"}'::jsonb, test.id('L')),
    (test.id('K:Z'), test.id('W'), 'Z''s app', 'mdo_tz', md5('db-test-key-rules-z'), '{"chat": "edit"}'::jsonb, test.id('Z'));
END;
$$;

-- ── 1. One manager rule ─────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('L', 'N', 'n-l', 'from a manager who left');
  PERFORM test.ok(v = '42501 Only managers can post in this channel.',
    'announcement: a manager who left can''t post (and isn''t brought back by trying)', v);
  PERFORM test.ok((test.row('N', 'L')).left_at IS NOT NULL, 'announcement: L is still out of N');
  v := test.send('V', 'N', 'n-v', 'from a read-only manager');
  PERFORM test.ok(v = '42501 Your role can''t post in chat.', 'announcement: a manager whose role is read-only can''t post', v);
  v := test.send('B', 'N', 'n-b', 'from a member');
  PERFORM test.ok(v = '42501 Only managers can post in this channel.', 'announcement: a member who isn''t a manager can''t post', v);

  -- The row trigger holds the same rule for any writer.
  v := test.err(format($q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, format_version)
                          VALUES (%L, %L, %L, 'direct', 2)$q$, test.id('W'), test.ref('N'), test.id('L')));
  PERFORM test.ok(v = '42501 Only managers can post in this channel.', 'trigger: a manager who left can''t post a row', v);
  v := test.err(format($q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, format_version)
                          VALUES (%L, %L, %L, 'direct', 2)$q$, test.id('W'), test.ref('N'), test.id('V')));
  PERFORM test.ok(v = '42501 Your role can''t post in chat.', 'trigger: nor a read-only manager', v);

  -- An app posts as its key's creator.
  v := test.as_key('K:L', format($q$SELECT public.chat_op_agent_post(%L, %L, 'from L''s app')$q$, test.id('W'), test.ref('N')));
  PERFORM test.ok(v = '42501 Only managers can post in this channel.', 'key: the app of a manager who left can''t post', v);
  v := test.as_key('K:A', format($q$SELECT public.chat_op_agent_post(%L, %L, 'from A''s app')$q$, test.id('W'), test.ref('N')));
  PERFORM test.ok(v = 'ok 1', 'key: the app of a manager in the channel posts', v);

  v := test.as_user('L', format($q$SELECT public.chat_op_pin(%L, true)$q$, test.mid('n1')));
  PERFORM test.ok(v = '42501 Your role can''t pin messages here.', 'pin: a manager who left can''t pin in an announcement channel', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_pin(%L, true)$q$, test.mid('n1')));
  PERFORM test.ok(v = '42501 Your role can''t pin messages here.', 'pin: nor a read-only manager', v);

  v := test.as_user('L', format($q$SELECT public.chat_op_set_announcement(%L, false)$q$, test.ref('N')));
  PERFORM test.ok(v = '42501 Only this channel''s managers and admins can change who posts.', 'announce: a manager who left can''t switch it', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_set_announcement(%L, false)$q$, test.ref('N')));
  PERFORM test.ok(v = '42501 Only this channel''s managers and admins can change who posts.', 'announce: nor a read-only manager', v);
  PERFORM test.ok((SELECT managers_only FROM public.chat_channels WHERE id = test.ref('N')),
    'announce: N is still announcement-only');

  -- The manager in it does all three.
  v := test.send('A', 'N', 'n2', 'second');
  PERFORM test.ok(v = 'ok 1', 'announcement: its manager in it posts', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_pin(%L, true)$q$, test.mid('n1')));
  PERFORM test.ok(v = 'ok 1' AND (SELECT pinned_at IS NOT NULL FROM public.chat_messages WHERE id = test.mid('n1')),
    'pin: its manager in it pins', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_set_announcement(%L, false)$q$, test.ref('N')));
  PERFORM test.ok(v LIKE 'ok %' AND NOT (SELECT managers_only FROM public.chat_channels WHERE id = test.ref('N')),
    'announce: its manager in it switches it off', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('N')));
  PERFORM test.ok(v LIKE 'ok %', 'announce: and on again', v);
  -- An admin ("Manage any channel"): the owner, not in N.
  v := test.as_user('O', format($q$SELECT public.chat_op_pin(%L, false)$q$, test.mid('n1')));
  PERFORM test.ok(v = 'ok 1', 'pin: an admin outside the channel unpins', v);
END;
$$;

-- The erasure hands a channel on unless someone still manages it (a viewer's
-- manager row doesn't count), and only to someone whose role posts.
DO $$
DECLARE
  v text;
  r jsonb;
BEGIN
  v := test.make('E', 'H', 'W', 'handoff', false, ARRAY['V']);
  PERFORM test.ok(v = 'ok 1', 'erasure setup: E makes the public channel H with V', v);
  INSERT INTO public.chat_channel_managers (channel_id, user_id) VALUES (test.ref('H'), test.id('V'));
  v := test.make('E', 'QE', 'W', 'quiet-room', true, ARRAY['V']);
  PERFORM test.ok(v = 'ok 1', 'erasure setup: E makes the private channel QE with only V, a viewer', v);
  r := public.account_erase_workspace_data(test.id('E'), true);
  PERFORM test.ok((r ->> 'chat_managers_handed_over')::int = 1,
    'erasure preview: H is handed on (its other manager row is a viewer''s); QE has nobody whose role posts', r::text);
  PERFORM public.account_erase_workspace_data(test.id('E'), false);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.chat_channel_managers
                           WHERE channel_id = test.ref('H') AND user_id = test.id('O')),
    'erasure: H gets the workspace owner as its manager');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_channel_managers WHERE channel_id = test.ref('QE'))
                  AND EXISTS (SELECT 1 FROM public.chat_channels WHERE id = test.ref('QE')),
    'erasure: QE stays, and a viewer isn''t made its manager');
END;
$$;

-- ── 2. A removal outlives the remover's account ─────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.make('R', 'QR', 'W', 'open-room', false, ARRAY['Z', 'B']);
  PERFORM test.ok(v = 'ok 1', 'removal setup: R makes the public channel QR with Z and B', v);
  v := test.make('R', 'PR', 'W', 'back-room', true, ARRAY['Z', 'B']);
  PERFORM test.ok(v = 'ok 1', 'removal setup: R makes the private channel PR with Z and B', v);
  v := test.send('B', 'PR', 'pr1', 'in the back room');
  PERFORM test.ok(v = 'ok 1', 'removal setup: B posts in PR', v);

  v := test.as_user('R', format($q$SELECT public.chat_op_remove_member(%L, %L)$q$, test.ref('QR'), test.id('Z')));
  PERFORM test.ok(v LIKE 'ok %', 'removal: R removes Z from QR', v);
  v := test.as_user('R', format($q$SELECT public.chat_op_remove_member(%L, %L)$q$, test.ref('PR'), test.id('Z')));
  PERFORM test.ok(v LIKE 'ok %', 'removal: and from PR', v);
  PERFORM test.ok((test.row('QR', 'Z')).removed_at IS NOT NULL AND (test.row('QR', 'Z')).removed_by = test.id('R')
                  AND (test.row('QR', 'Z')).left_at IS NOT NULL,
    'removal: stamped when it happened, with who removed them');

  -- R's account goes: the erasure, then the account itself.
  PERFORM public.account_erase_workspace_data(test.id('R'), false);
  DELETE FROM auth.users WHERE id = test.id('R');
  PERFORM test.ok((test.row('QR', 'Z')).removed_by IS NULL AND (test.row('QR', 'Z')).removed_at IS NOT NULL
                  AND (test.row('PR', 'Z')).removed_by IS NULL AND (test.row('PR', 'Z')).removed_at IS NOT NULL,
    'erased remover: who removed Z is gone, the removal stays');

  v := test.as_user('Z', format($q$SELECT public.chat_op_join(%L)$q$, test.ref('QR')));
  PERFORM test.ok(v = '42501 You were removed from this channel. A manager can add you back.',
    'erased remover: Z still can''t join the public channel again', v);
  v := test.send('Z', 'QR', 'qr-z', 'back?');
  PERFORM test.ok(v = '42501 You were removed from this conversation.', 'erased remover: nor post in it', v);
  v := test.as_key('K:Z', format($q$SELECT public.chat_op_agent_post(%L, %L, 'from Z''s app')$q$, test.id('W'), test.ref('QR')));
  PERFORM test.ok(v = '42501 You were removed from this conversation.', 'erased remover: nor through Z''s app', v);
  v := test.err(format($q$INSERT INTO public.chat_messages (workspace_id, channel_id, author_id, body, format_version)
                          VALUES (%L, %L, %L, 'direct', 2)$q$, test.id('W'), test.ref('QR'), test.id('Z')));
  PERFORM test.ok(v = '42501 You were removed from this conversation.', 'trigger: a removed person''s row is refused', v);
  v := test.as_user('Z', format($q$SELECT public.chat_op_join(%L)$q$, test.ref('PR')));
  PERFORM test.ok(v NOT LIKE 'ok %', 'erased remover: Z can''t join the private one', v);
  PERFORM test.ok(test.value_as('Z', format($q$SELECT public.chat_can_read_channel(%L)::text$q$, test.ref('PR'))) = 'false'
                  AND test.value_as('Z', format($q$SELECT count(*)::text FROM public.chat_messages WHERE channel_id = %L$q$,
                                                test.ref('PR'))) = '0',
    'erased remover: nor read it');
  v := test.value_as('B', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])::text$q$,
                                 test.ref('QR'), test.id('Z')));
  PERFORM test.ok(v = '0' AND (test.row('QR', 'Z')).left_at IS NOT NULL,
    'erased remover: a member who doesn''t manage it can''t add Z back', v);
  PERFORM test.ok(test.err(format($q$UPDATE public.chat_members SET left_at = NULL WHERE channel_id = %L AND user_id = %L$q$,
                                  test.ref('QR'), test.id('Z'))) LIKE '23514 %',
    'a removed row can''t be made active without ending the removal');

  -- The managers the erasure handed the channels to bring Z back.
  v := test.value_as('O', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])::text$q$,
                                 test.ref('QR'), test.id('Z')));
  PERFORM test.ok(v = '1' AND (test.row('QR', 'Z')).left_at IS NULL AND (test.row('QR', 'Z')).removed_at IS NULL,
    'a manager (the owner, who got QR) adds Z back; the removal ends', v);
  v := test.as_key('K:Z', format($q$SELECT public.chat_op_agent_post(%L, %L, 'back, from Z''s app')$q$, test.id('W'), test.ref('QR')));
  PERFORM test.ok(v = 'ok 1', 'and Z''s app posts there again', v);
  v := test.value_as('B', format($q$SELECT public.chat_op_add_members(%L, ARRAY[%L]::uuid[])::text$q$,
                                 test.ref('PR'), test.id('Z')));
  PERFORM test.ok(v = '1' AND (test.row('PR', 'Z')).removed_at IS NULL,
    'and B, who got PR, adds Z back to it', v);

  -- Leaving on your own is no removal.
  v := test.as_user('B', format($q$SELECT public.chat_op_leave(%L)$q$, test.ref('QR')));
  PERFORM test.ok(v LIKE 'ok %' AND (test.row('QR', 'B')).left_at IS NOT NULL AND (test.row('QR', 'B')).removed_at IS NULL,
    'leaving stamps left_at only', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_join(%L)$q$, test.ref('QR')));
  PERFORM test.ok(v = 'ok 1', 'and someone who left joins again', v);

  PERFORM test.ok(test.err(format($q$UPDATE public.chat_members SET removed_by = %L WHERE channel_id = %L AND user_id = %L$q$,
                                  test.id('A'), test.ref('QR'), test.id('B'))) LIKE '23514 %',
    'a remover is recorded only on a removal');
END;
$$;

-- ── 3. Names clash only with channels the creator can see ───────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.make('A', 'SK', 'W', 'Skunkworks', true, ARRAY['B']);
  PERFORM test.ok(v = 'ok 1', 'names: A makes the private channel "Skunkworks" with B', v);

  -- A private channel someone isn't in never refuses their name.
  v := test.make('C', 'SK2', 'W', 'skunkworks', true);
  PERFORM test.ok(v = 'ok 1', 'names: C, not in it, makes a private "skunkworks"', v);
  v := test.try('O', format($q$SELECT public.chat_op_create_channel(%L, 'SKUNKWORKS')$q$, test.id('W')));
  PERFORM test.ok(v = 'ok 1', 'names: the owner, in neither, makes a public "SKUNKWORKS"', v);

  -- A channel the creator can see does.
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, 'skunkWorks')$q$, test.id('W')));
  PERFORM test.ok(v = '23505 A channel named "skunkWorks" already exists.',
    'names: B, in A''s private channel, can''t take its name for a public one', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, 'skunkworks', '', true)$q$, test.id('W')));
  PERFORM test.ok(v = '23505 A channel named "skunkworks" already exists.', 'names: nor for a private one', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_create_channel(%L, 'Skunkworks')$q$, test.id('W')));
  PERFORM test.ok(v = '23505 A channel named "Skunkworks" already exists.',
    'names: C can''t take the name of their own private channel', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_create_channel(%L, 'NEWS', '', true)$q$, test.id('W')));
  PERFORM test.ok(v = '23505 A channel named "NEWS" already exists.',
    'names: a private channel can''t take a public channel''s name', v);

  -- Once a public channel holds the name, it clashes for everyone.
  v := test.make('O', 'OP', 'W', 'Open plan', false);
  PERFORM test.ok(v = 'ok 1', 'names: the owner makes the public channel "Open plan"', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_create_channel(%L, 'open plan', '', true)$q$, test.id('W')));
  PERFORM test.ok(v = '23505 A channel named "open plan" already exists.', 'names: a public name is everyone''s to see', v);

  -- Renames read the same rule.
  v := test.make('C', 'MS', 'W', 'Moonshot', true);
  PERFORM test.ok(v = 'ok 1', 'rename setup: C makes the private channel "Moonshot"', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_update_channel(%L, 'moonshot')$q$, test.ref('SK')));
  PERFORM test.ok(v = 'ok 1' AND (SELECT name FROM public.chat_channels WHERE id = test.ref('SK')) = 'moonshot',
    'rename: A renames her private channel to the name of one she isn''t in', v);
  v := test.try('O', format($q$SELECT public.chat_op_update_channel(%L, 'MOONSHOT')$q$, test.ref('OP')));
  PERFORM test.ok(v = 'ok 1', 'rename: the owner, in neither, gives a public channel that name', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_update_channel(%L, 'Moonshot')$q$, test.ref('N')));
  PERFORM test.ok(v = '23505 A channel named "Moonshot" already exists.',
    'rename: A can''t give her public channel the name of her own private one', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_update_channel(%L, 'open PLAN')$q$, test.ref('SK')));
  PERFORM test.ok(v = '23505 A channel named "open PLAN" already exists.',
    'rename: nor her private channel a public channel''s name', v);

  -- The index holds public names only; a deleted channel's name is free.
  PERFORM test.ok(test.err(format($q$INSERT INTO public.chat_channels (workspace_id, kind, name) VALUES (%L, 'channel', 'OPEN PLAN')$q$,
                                  test.id('W'))) LIKE '23505 %',
    'index: two live public channels never share a name');
  PERFORM test.ok(test.err(format($q$INSERT INTO public.chat_channels (workspace_id, kind, name, is_private) VALUES (%L, 'channel', 'Open plan', true)$q$,
                                  test.id('W'))) = 'ok',
    'index: a private channel isn''t held by it (the ops check what the creator sees)');
  UPDATE public.chat_channels SET deleted_at = now() WHERE id = test.ref('OP');
  v := test.as_user('C', format($q$SELECT public.chat_op_create_channel(%L, 'Open Plan')$q$, test.id('W')));
  PERFORM test.ok(v = 'ok 1', 'names: a deleted channel''s name can be used again', v);

  -- General is made on the workspace's behalf: a private "general" doesn't push it aside.
  v := test.make('M3', 'G3P', 'W3', 'general', true);
  PERFORM test.ok(v = 'ok 1', 'General: M3 makes a private "general" in a workspace without General', v);
  v := test.as_user('O3', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W3')));
  PERFORM test.ok(v LIKE 'ok %'
                  AND (SELECT name FROM public.chat_channels WHERE workspace_id = test.id('W3') AND is_default) = 'General'
                  AND NOT (SELECT is_default FROM public.chat_channels WHERE id = test.ref('G3P')),
    'General: is named "General" beside it, and the private one stays private and not General', v);
END;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(f, ', ') INTO v_bad
    FROM unnest(ARRAY['chat__was_removed(uuid, uuid)', 'chat__name_taken(uuid, text, uuid, uuid)',
                      'chat__lock_name(uuid, text)', 'chat__enter(uuid, uuid, uuid, text)',
                      'share_chat_message_guard()', 'account_erase_workspace_data(uuid, boolean)']) AS f
   WHERE has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')
      OR has_function_privilege('anon', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'grants: the helpers, the trigger and the erasure are server-only', v_bad);
  SELECT string_agg(f, ', ') INTO v_bad
    FROM unnest(ARRAY['chat_op_send(uuid, uuid, text, uuid)', 'chat_op_pin(uuid, boolean)',
                      'chat_op_set_announcement(uuid, boolean)', 'chat_op_leave(uuid)', 'chat_op_remove_member(uuid, uuid)',
                      'chat_op_create_channel(uuid, text, text, boolean, uuid[], boolean, text, uuid)',
                      'chat_op_update_channel(uuid, text, text)', 'chat_op_bootstrap(uuid)']) AS f
   WHERE has_function_privilege('anon', 'public.' || f, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'grants: the ops are signed-in people''s, never anon''s', v_bad);
END;
$$;
