-- Announcement channels (CV-15; AC5.5, AC10.4, AC10.9, AC1.8, AC1.12): the
-- switch is a manager's and flips later; members can't post, replies
-- included; a manager's post reaches every member once, even on Mentions and
-- replies, and only Nothing silences it; Reply privately is a direct message
-- to the author carrying the post's link; viewers react and receive, never post.
--
-- Cast: O owns W (Duo); D is an admin; A, B, C are members; V is a viewer;
-- K is A's key. A makes N (public, with B, C, D, V).

SELECT test.person(n) FROM unnest(ARRAY['O', 'D', 'A', 'B', 'C', 'V']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'News');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('D'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer')
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
CREATE FUNCTION test.send(p_who text, p_conv text, p_msg text, p_body text, p_reply text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, %L::uuid)$q$,
    test.mid(p_msg), test.ref(p_conv), p_body, CASE WHEN p_reply IS NOT NULL THEN test.mid(p_reply) END))
$$;
CREATE FUNCTION test.items(p_who text, p_msg text, p_reason text) RETURNS int LANGUAGE sql VOLATILE AS $$
  SELECT count(*)::int FROM public.chat_catchup
   WHERE user_id = test.id(p_who) AND message_id = test.mid(p_msg) AND reason = p_reason
$$;
CREATE FUNCTION test.switch(p_who text, p_on boolean) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_set_announcement(%L, %L)$q$, test.ref('N'), p_on))
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'news', '', false, ARRAY[%L, %L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C'), test.id('D'), test.id('V')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes N', v);
  INSERT INTO test.ids SELECT 'N', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'news';
  -- B listens on Mentions and replies (the default), C on Nothing.
  PERFORM test.as_user('C', format($q$SELECT public.chat_op_set_prefs(%L, 'none', NULL)$q$, test.ref('N')));
  INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
  VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv15a'),
          '{"chat": "edit"}'::jsonb, test.id('A'));
END;
$$;

-- ── The switch: a manager's, later, both ways ──────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(test.switch('B', true) LIKE '42501%', 'switch: a member can''t flip it');
  PERFORM test.ok(test.switch('V', true) LIKE '42501%', 'switch: a viewer can''t');
  v := test.as_key('K', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('N')));
  PERFORM test.ok(v NOT LIKE 'ok%', 'switch: a key can''t', v);
  v := test.switch('A', true);
  PERFORM test.ok(v LIKE 'ok%' AND (SELECT managers_only FROM public.chat_channels WHERE id = test.ref('N')),
    'switch: its manager turns N into an announcement channel after it was made (AC1.12)', v);
  PERFORM test.ok((SELECT count(*) FROM public.module_activity WHERE entity_id = test.ref('N')
                    AND op = 'chat.announcement_switch' AND payload ->> 'on' = 'true') = 1,
    'switch: one history row, not the bell''s chat.announcement');
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')));
  INSERT INTO test.ids SELECT 'DM', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm';
  v := test.as_user('A', format($q$SELECT public.chat_op_set_announcement(%L, true)$q$, test.ref('DM')));
  PERFORM test.ok(v LIKE '22023%', 'switch: never on a direct message', v);
END;
$$;

-- ── Posting: managers only, replies included; pings once ───────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.send('B', 'N', 'b1', 'can I post?');
  PERFORM test.ok(v LIKE '42501%' AND v LIKE '%Only managers%', 'post: a member is refused', v);
  v := test.send('D', 'N', 'd1', 'admin here');
  PERFORM test.ok(v LIKE '42501%', 'post: an admin who isn''t one of its managers is refused too', v);
  v := test.send('V', 'N', 'v1', 'viewer');
  PERFORM test.ok(v LIKE '42501%', 'post: a viewer is refused (AC10.9)', v);
  v := test.send('A', 'N', 'a1', 'Launch is Thursday');
  PERFORM test.ok(v LIKE 'ok%', 'post: its manager posts', v);
  PERFORM test.ok(test.items('B', 'a1', 'announcement') = 1, 'ping: B (Mentions and replies) gets it once (AC5.5)');
  PERFORM test.ok(test.items('D', 'a1', 'announcement') = 1, 'ping: D gets it once');
  PERFORM test.ok(test.items('V', 'a1', 'announcement') = 1, 'ping: a viewer receives it (AC10.9)');
  PERFORM test.ok(test.items('C', 'a1', 'announcement') = 0, 'ping: Nothing silences it');
  PERFORM test.ok((SELECT count(*) FROM public.chat_catchup WHERE message_id = test.mid('a1')) = 3,
    'ping: one item each, nothing more');
  v := test.send('B', 'N', 'b2', 'reply', 'a1');
  PERFORM test.ok(v LIKE '42501%', 'post: a member''s reply is refused too', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_react(%L, '👍', true)$q$, test.mid('a1')));
  PERFORM test.ok(v LIKE 'ok%', 'react: a viewer reacts (AC10.9)', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L, '👀', true)$q$, test.mid('a1')));
  PERFORM test.ok(v LIKE 'ok%', 'react: a member reacts', v);
  -- D makes themselves a manager, then posts.
  v := test.as_user('D', format($q$SELECT public.chat_op_set_manager(%L, %L, true)$q$, test.ref('N'), test.id('D')));
  PERFORM test.ok(v LIKE 'ok%' AND test.send('D', 'N', 'd2', 'now I can') LIKE 'ok%',
    'post: an admin who makes themselves a manager posts');
END;
$$;

-- ── Reply privately: a direct message to the author, carrying the post ─────
DO $$
DECLARE
  v text;
  v_dm uuid;
BEGIN
  v := test.as_user('B', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('A')));
  SELECT id INTO v_dm FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm'
     AND EXISTS (SELECT 1 FROM public.chat_members m WHERE m.channel_id = chat_channels.id AND m.user_id = test.id('A'))
     AND EXISTS (SELECT 1 FROM public.chat_members m WHERE m.channel_id = chat_channels.id AND m.user_id = test.id('B'));
  INSERT INTO test.ids VALUES ('BA', v_dm) ON CONFLICT (name) DO UPDATE SET id = excluded.id;
  v := test.send('B', 'BA', 'rp', format('[Launch is Thursday](moduo://chat_message/%s) Which time?', test.mid('a1')));
  PERFORM test.ok(v LIKE 'ok%' AND test.items('A', 'rp', 'dm') = 1,
    'Reply privately: B''s direct message to A carries the post and reaches A');
  v := test.send('V', 'BA', 'vx', 'x');
  PERFORM test.ok(v NOT LIKE 'ok%', 'viewer: can''t post into someone else''s direct message', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('A')));
  PERFORM test.ok(v LIKE '42501%', 'viewer: can''t start a direct message', v);
END;
$$;

-- ── Off again, later ───────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.switch('A', false);
  PERFORM test.ok(v LIKE 'ok%' AND test.send('B', 'N', 'b3', 'open again') LIKE 'ok%',
    'switch: off later, members post again', v);
  v := test.as_user('A', format($q$SELECT public.share_op_announce(%L, true)$q$, test.ref('N')));
  PERFORM test.ok(v LIKE 'ok%' AND (SELECT managers_only FROM public.chat_channels WHERE id = test.ref('N')),
    'v1 switch: share_op_announce still works through the new op', v);
  v := test.as_user('B', format($q$SELECT public.share_op_announce(%L, false)$q$, test.ref('N')));
  PERFORM test.ok(v LIKE '42501%', 'v1 switch: and refuses a member', v);
END;
$$;
