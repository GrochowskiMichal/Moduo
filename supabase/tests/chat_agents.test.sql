-- Chat v2 · CV-21 Agents and MCP tools ("tools, scopes, rate limit"; AC4.2,
-- AC15.1, AC15.4): supabase/migrations/20261017000000_chat_v2_agents.sql.
--
-- Cast: O owns W (Duo, so chat is on); A, B and C are members; O2 owns W2.
-- A makes the public channel Q and the private channel P with B; B makes the
-- private channel R with C (A isn't in it); A and B have a direct message D.
-- A is an admin (keys are made by key managers). Keys in W: KA (A, "CI key", Chat: Edit), KV (A, Chat: View), KN (A, Tasks
-- only), KB (B, Chat: Edit); K2 (O2, Chat: Edit) is W2's. Every key call goes
-- the way the connector calls (service role + x-moduo-key-id).
--
-- One transaction: every message carries the same now(), so a test that sends
-- many moves the earlier ones back (test.age) to stay under the 10-in-10 s
-- limit while counting the 30-a-minute one.

SELECT test.person(n) FROM unnest(ARRAY['O', 'O2', 'A', 'B', 'C', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id IN (test.id('O'), test.id('O2'));
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Acme'),
  (test.id('W2'), test.id('O2'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
-- A manages the workspace's keys (only key managers make keys).
UPDATE public.workspace_members SET role = 'admin' WHERE workspace_id = test.id('W') AND user_id = test.id('A');

INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('KA'), test.id('W'), 'CI key', 'mdo_cv21a', md5('db-test-cv21-ka'), '{"chat": "edit"}', test.id('A')),
  (test.id('KV'), test.id('W'), 'Reader', 'mdo_cv21v', md5('db-test-cv21-kv'), '{"chat": "view"}', test.id('A')),
  (test.id('KN'), test.id('W'), 'Tasks bot', 'mdo_cv21n', md5('db-test-cv21-kn'), '{"tasks": "view"}', test.id('A')),
  (test.id('KB'), test.id('W'), 'B bot', 'mdo_cv21b', md5('db-test-cv21-kb'), '{"chat": "edit"}', test.id('B')),
  (test.id('K2'), test.id('W2'), 'Other', 'mdo_cv21o', md5('db-test-cv21-k2'), '{"chat": "edit"}', test.id('O2'));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.uri(p_type text, p_id uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'moduo://' || p_type || '/' || p_id
$$;
-- One value a statement returns, read as a key (the connector's way in).
CREATE FUNCTION test.key_value(p_key text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
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
-- A person's message (the app's send), its id kept under a name.
CREATE FUNCTION test.say(p_who text, p_conv text, p_name text, p_body text, p_reply text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  v := test.as_user(p_who, format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, %L::uuid)$q$,
    test.id(p_name), test.ref(p_conv), p_body, test.ref(p_reply)));
  IF v LIKE 'ok %' THEN
    INSERT INTO test.ids VALUES (p_name, test.id(p_name)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN v;
END;
$$;
-- A key's post; its id kept under a name.
CREATE FUNCTION test.post(p_key text, p_conv text, p_name text, p_body text, p_reply text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  v := test.key_value(p_key, format($q$SELECT (public.chat_op_agent_post(%L, %L, %L, %L)).id::text$q$,
    test.id('W'), test.ref(p_conv), p_body, test.ref(p_reply)));
  IF v ~ '^[0-9a-f-]{36}$' THEN
    INSERT INTO test.ids VALUES (p_name, v::uuid) ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id;
    RETURN 'ok';
  END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION test.age(p_by interval) RETURNS void LANGUAGE sql AS $$
  UPDATE public.chat_messages SET created_at = created_at - p_by WHERE workspace_id = test.id('W')
$$;
CREATE FUNCTION test.items(p_who text, p_msg text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(reason, ',' ORDER BY reason), '') FROM public.chat_catchup
   WHERE user_id = test.id(p_who) AND message_id = test.ref(p_msg)
$$;
CREATE FUNCTION test.set_key_replies(p_who text, p_key text, p_on boolean) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.user_preferences (user_id, preferences)
  VALUES (test.id(p_who), jsonb_build_object('notifications', jsonb_build_object('chatKeys',
          jsonb_build_object(test.id(p_key)::text, p_on))))
  ON CONFLICT (user_id) DO UPDATE
    SET preferences = jsonb_set(coalesce(public.user_preferences.preferences, '{}'), '{notifications}',
          coalesce(public.user_preferences.preferences -> 'notifications', '{}')
          || jsonb_build_object('chatKeys', jsonb_build_object(test.id(p_key)::text, p_on)))
$$;

-- ── Setup ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: chat starts in W', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'builds', '', false)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes #builds (Q)', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'builds';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'secret', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'secret';
  v := test.as_user('B', format($q$SELECT public.chat_op_create_channel(%L, 'hidden', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('C')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: B makes the private channel R with C', v);
  INSERT INTO test.ids SELECT 'R', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'hidden';
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A and B have a direct message D', v);
  INSERT INTO test.ids SELECT 'D', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm';
  v := test.as_user('O', format($q$SELECT public.chat_op_create_channel(%L, 'news', '', false, '{}'::uuid[], true)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: O makes the announcement channel N', v);
  INSERT INTO test.ids SELECT 'N', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'news';
  PERFORM test.say('B', 'D', 'dm1', 'zebra in the direct message');
  PERFORM test.say('B', 'R', 'r1', 'zebra in the hidden channel');
  PERFORM test.say('A', 'P', 'p1', 'zebra in the secret channel');
  PERFORM test.age(interval '15 seconds');
END;
$$;

-- ── 1. Posting: the post is its creator's, via the key ───────────────────────
DO $$
DECLARE
  v text;
  m public.chat_messages;
BEGIN
  -- A read #builds a while ago (one transaction: now() never moves).
  UPDATE public.chat_members SET last_read_at = now() - interval '1 hour', last_read_id = NULL
   WHERE channel_id = test.ref('Q') AND user_id = test.id('A');
  v := test.post('KA', 'Q', 'k1', 'zebra build is green');
  SELECT * INTO m FROM public.chat_messages WHERE id = test.ref('k1');
  PERFORM test.ok(v = 'ok' AND m.author_id = test.id('A') AND m.author_kind = 'api_key'
                  AND m.author_label = 'CI key' AND m.api_key_id = test.id('KA') AND m.parent_id IS NULL,
    'post: author is the key''s creator, author_kind api_key, labelled with the key, api_key_id set', v);
  PERFORM test.ok(public.chat__sender_label(m, test.id('A')) = 'A · via CI key',
    'post: notices and emails name "<person> · via <key>"');
  PERFORM test.ok(test.value_as('A', format(
      $q$SELECT unread::text FROM public.chat_unread_counts(%L) WHERE channel_id = %L$q$,
      test.id('W'), test.ref('Q'))) = '1',
    'post: a post through your key counts as new for you', test.value_as('A', format(
      $q$SELECT string_agg(unread::text, ',') FROM public.chat_unread_counts(%L) WHERE channel_id = %L$q$,
      test.id('W'), test.ref('Q'))));

  v := test.post('KV', 'Q', 'kv1', 'from the reader');
  PERFORM test.ok(v LIKE 'ERROR This API key can''t post to chat%', 'scope: Chat: View can''t post', v);
  v := test.key_value('KN', format($q$SELECT count(*)::text FROM public.chat_agent_conversations(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ERROR This API key can''t read chat%', 'scope: no Chat scope reads nothing', v);
  v := test.key_value('K2', format($q$SELECT count(*)::text FROM public.chat_agent_conversations(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ERROR This API key belongs to another workspace%', 'scope: another workspace''s key reads nothing here', v);
  v := test.key_value('K2', format($q$SELECT (public.chat_op_agent_post(%L, %L, 'hi')).id::text$q$,
    test.id('W2'), test.ref('Q')));
  PERFORM test.ok(v LIKE 'ERROR Apps can only post in channels their key can read%', 'scope: another workspace''s key can''t post here', v);

  v := test.post('KA', 'D', 'kd', 'into the DM');
  PERFORM test.ok(v LIKE 'ERROR Apps can only post in channels their key can read%', 'dm: a key never posts in a direct message', v);
  v := test.post('KA', 'P', 'kp', 'into the secret channel');
  PERFORM test.ok(v LIKE 'ERROR Apps can only post in channels their key can read%', 'private: switch off, the key can''t post', v);
  v := test.post('KA', 'N', 'kn', 'news from the app');
  PERFORM test.ok(v = 'ERROR Only managers can post in this channel.', 'announcement: only if the creator manages it', v);
  v := test.as_user('A', 'SELECT public.chat_op_agent_post(gen_random_uuid(), gen_random_uuid(), ''x'')');
  PERFORM test.ok(v LIKE '42501 %', 'grants: a person can''t call the agent post', v);
  PERFORM test.age(interval '15 seconds');
END;
$$;

-- ── 2. @channel only if the creator may; mentions notify like a person's ────
DO $$
DECLARE
  v text;
BEGIN
  v := test.post('KA', 'Q', 'k2', format('<!channel> deploy done <@%s>', test.id('B')));
  PERFORM test.ok(v = 'ok' AND (SELECT mentions_everyone FROM public.chat_messages WHERE id = test.ref('k2'))
                  AND (SELECT test.id('B') = ANY (mentioned_user_ids) FROM public.chat_messages WHERE id = test.ref('k2')),
    '@channel: a creator who may mention everyone does; the named person is mentioned', v);
  PERFORM test.ok(test.items('B', 'k2') = 'mention', 'mention: B gets a mention item, like a person''s', test.items('B', 'k2'));
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a
                           WHERE a.workspace_id = test.id('W') AND a.op = 'chat.mention'
                             AND a.payload ->> 'message_id' = test.ref('k2')::text
                             AND a.actor_type = 'api_key' AND a.actor_label = 'A · via CI key'),
    'mention: the bell row reads "A · via CI key"');

  UPDATE public.workspace_chat_caps SET mention_everyone = false
   WHERE workspace_id = test.id('W') AND role_key IN ('member', 'admin');
  PERFORM test.age(interval '15 seconds');
  v := test.post('KA', 'Q', 'k3', '<!channel> second deploy');
  PERFORM test.ok(v = 'ok' AND NOT (SELECT mentions_everyone FROM public.chat_messages WHERE id = test.ref('k3'))
                  AND (SELECT body FROM public.chat_messages WHERE id = test.ref('k3')) LIKE '%@channel%',
    '@channel: a creator who may not → sent as plain text', v);
  UPDATE public.workspace_chat_caps SET mention_everyone = true
   WHERE workspace_id = test.id('W') AND role_key IN ('member', 'admin');
  PERFORM test.age(interval '15 seconds');
END;
$$;

-- ── 3. Replies to a key's post reach its creator only through the switch ────
DO $$
DECLARE
  v text;
  m public.chat_messages;
BEGIN
  v := test.say('B', 'Q', 'b1', 'what failed?', 'k1');
  PERFORM test.ok(v LIKE 'ok %' AND test.items('A', 'b1') = 'reply',
    'switch on (default): B''s reply to the key''s post reaches A', test.items('A', 'b1'));

  PERFORM test.set_key_replies('A', 'KA', false);
  v := test.say('C', 'Q', 'c1', 'still failing', 'k2');
  PERFORM test.ok(v LIKE 'ok %' AND test.items('A', 'c1') = '',
    'switch off: a reply to the key''s post doesn''t reach A', test.items('A', 'c1'));
  PERFORM test.ok(test.value_as('A', format(
      $q$SELECT addressed::text FROM public.chat_unread_counts(%L) WHERE channel_id = %L$q$,
      test.id('W'), test.ref('Q'))) IS NOT NULL,
    'switch off: counts still answer');
  v := test.say('C', 'Q', 'c2', format('ping %s', test.uri('person', test.id('A'))), 'k2');
  PERFORM test.ok(v LIKE 'ok %' AND test.items('A', 'c2') = 'mention',
    'switch off: a reply that mentions A still reaches A', test.items('A', 'c2'));
  PERFORM test.set_key_replies('A', 'KA', true);
  PERFORM test.age(interval '15 seconds');

  -- The key answers B's reply: it joins the chain and quotes it.
  v := test.post('KA', 'Q', 'k4', 'the lint step', 'b1');
  SELECT * INTO m FROM public.chat_messages WHERE id = test.ref('k4');
  PERFORM test.ok(v = 'ok' AND m.parent_id = test.ref('k1') AND m.reply_to_id = test.ref('b1')
                  AND (SELECT reply_count FROM public.chat_messages WHERE id = test.ref('k1')) = 2,
    'reply: the key''s reply joins the chain of what it answers, with the quote', v);
  PERFORM test.ok(test.items('B', 'k4') = 'reply', 'reply: B, quoted, hears it', test.items('B', 'k4'));
  PERFORM test.age(interval '15 seconds');
END;
$$;

-- ── 4. Private channels: only with the switch and membership ────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.key_value('KA', format($q$SELECT string_agg(name, ',' ORDER BY name) FROM public.chat_agent_conversations(%L)$q$, test.id('W')));
  PERFORM test.ok(v NOT LIKE '%secret%' AND v NOT LIKE '%hidden%' AND v LIKE '%builds%',
    'private: switch off, the key lists public channels only', v);
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.chat_key_readers(%L)$q$, test.ref('P'))) = '0',
    'Details: no app reads P yet');

  v := test.as_user('O', format($q$SELECT public.workspace_api_keys_set_private_chat(%L, true)$q$, test.id('KA')));
  PERFORM test.ok(v LIKE '42501 Only the person who created this key%', 'switch: only the creator turns it on', v);
  v := test.as_user('A', format($q$SELECT public.workspace_api_keys_set_private_chat(%L, true)$q$, test.id('KA')));
  PERFORM test.ok(v LIKE 'ok %' AND (SELECT include_private_chat FROM public.workspace_api_keys WHERE id = test.id('KA')),
    'switch: A turns on "Include private channels I''m in"', v);

  v := test.key_value('KA', format($q$SELECT string_agg(name, ',' ORDER BY name) FROM public.chat_agent_conversations(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE '%secret%' AND v NOT LIKE '%hidden%',
    'private: switch on, P (A is in it) is listed, R (A isn''t) never', v);
  v := test.key_value('KA', format($q$SELECT count(*)::text FROM public.chat_agent_conversations(%L) WHERE name IS NULL$q$, test.id('W')));
  PERFORM test.ok(v = '0', 'dm: a direct message is never listed', v);
  v := test.post('KA', 'P', 'kp', 'now in the secret channel');
  PERFORM test.ok(v = 'ok', 'private: switch on, the key posts in P', v);
  v := test.post('KA', 'R', 'kr', 'into R');
  PERFORM test.ok(v LIKE 'ERROR Apps can only post in channels their key can read%', 'private: never where the creator isn''t a member', v);
  v := test.key_value('KA', format($q$SELECT count(*)::text FROM public.chat_agent_messages(%L)$q$, test.ref('D')));
  PERFORM test.ok(v LIKE 'ERROR That conversation no longer exists%', 'dm: a key reads no direct message', v);
  v := test.key_value('KA', format($q$SELECT count(*)::text FROM public.chat_agent_messages(%L)$q$, test.ref('R')));
  PERFORM test.ok(v LIKE 'ERROR That conversation no longer exists%', 'private: a key reads no channel its creator isn''t in', v);

  v := test.value_as('B', format($q$SELECT string_agg(display_name, ',') FROM public.chat_key_readers(%L)$q$, test.ref('P')));
  PERFORM test.ok(v = 'A', 'Details: P says an app of A''s can read it', v);
  PERFORM test.ok(test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_key_readers(%L)$q$, test.ref('P'))) = '0',
    'Details: someone who can''t read P learns nothing');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.chat_key_readers(%L)$q$, test.ref('Q'))) = '0',
    'Details: a public channel lists no app');

  -- A leaves P: the key stops reading it.
  v := test.as_user('A', format($q$SELECT public.chat_op_leave(%L)$q$, test.ref('P')));
  v := test.key_value('KA', format($q$SELECT count(*)::text FROM public.chat_agent_messages(%L)$q$, test.ref('P')));
  PERFORM test.ok(v LIKE 'ERROR That conversation no longer exists%', 'private: once A leaves P, the key reads it no more', v);
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.chat_key_readers(%L)$q$, test.ref('P'))) = '0',
    'Details: and P stops naming A''s app');

  v := test.as_user('O', format($q$SELECT public.workspace_api_keys_set_private_chat(%L, false)$q$, test.id('KA')));
  PERFORM test.ok(v LIKE 'ok %' AND NOT (SELECT include_private_chat FROM public.workspace_api_keys WHERE id = test.id('KA')),
    'switch: a key manager turns it off', v);
  PERFORM test.age(interval '15 seconds');
END;
$$;

-- ── 5. Reads as the creator: messages, chains, search, addressed ────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.key_value('KV', format($q$SELECT author_name || '|' || coalesce(via, '') FROM public.chat_agent_messages(%L) WHERE id = %L$q$,
    test.ref('Q'), test.ref('k1')));
  PERFORM test.ok(v = 'A|CI key', 'read: Chat: View reads a conversation; the key''s post reads "A · via CI key"', v);
  v := test.key_value('KV', format($q$SELECT string_agg(id::text, ',' ORDER BY created_at, id) FROM public.chat_agent_messages(%L, %L)$q$,
    test.ref('Q'), test.ref('k1')));
  PERFORM test.ok(v LIKE test.ref('k1')::text || '%' AND v LIKE '%' || test.ref('b1')::text || '%'
                  AND v LIKE '%' || test.ref('k4')::text || '%',
    'read: a chain is its root and its replies', v);
  v := test.key_value('KV', format($q$SELECT count(*)::text FROM public.chat_agent_messages(%L, NULL, NULL, NULL, 1)$q$, test.ref('Q')));
  PERFORM test.ok(v = '1', 'read: pages are capped by the limit', v);

  v := test.key_value('KV', format($q$SELECT string_agg(channel_name, ',' ORDER BY channel_name) FROM public.chat_agent_search(%L, 'zebra')$q$, test.id('W')));
  PERFORM test.ok(v = 'builds', 'search: finds the public channel''s message, never the DM, P (switch off) or R', v);
  v := test.as_user('A', format($q$SELECT * FROM public.chat_agent_search(%L, 'zebra')$q$, test.id('W')));
  PERFORM test.ok(v LIKE '42501 %', 'grants: the agent search is the connector''s alone', v);

  -- B mentions A in Q and in D: only Q's is addressed to A through the key.
  PERFORM test.say('B', 'Q', 'bq', format('review %s', test.uri('person', test.id('A'))));
  PERFORM test.say('B', 'D', 'bd', format('secret %s', test.uri('person', test.id('A'))));
  v := test.key_value('KV', format($q$SELECT string_agg(message_id::text, ',') FROM public.chat_agent_addressed(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE '%' || test.ref('bq')::text || '%' AND v NOT LIKE '%' || test.ref('bd')::text || '%',
    'addressed: A''s mention in Q is listed; the direct message never', v);
  PERFORM test.age(interval '15 seconds');
END;
$$;

-- ── 6. Writes as the creator, attributed via the key ────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.key_value('KV', format($q$SELECT (public.chat_op_agent_react(%L, %L, '👍', true)).id::text$q$, test.id('W'), test.ref('b1')));
  PERFORM test.ok(v LIKE 'ERROR This API key can''t post to chat%', 'react: Chat: View can''t react', v);
  v := test.key_value('KA', format($q$SELECT (public.chat_op_agent_react(%L, %L, '👍', true)).reactions::text$q$, test.id('W'), test.ref('b1')));
  PERFORM test.ok(v LIKE '%' || test.id('A')::text || '%', 'react: the reaction is A''s', v);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a WHERE a.op = 'chat.react'
                           AND a.payload ->> 'message_id' = test.ref('b1')::text AND a.actor_label = 'A · via CI key'),
    'react: the trail reads "A · via CI key"');
  v := test.key_value('KA', format($q$SELECT (public.chat_op_agent_react(%L, %L, '👍', true)).id::text$q$, test.id('W'), test.ref('dm1')));
  PERFORM test.ok(v LIKE 'ERROR That message no longer exists%', 'react: never in a direct message', v);
  v := test.key_value('KA', format($q$SELECT (public.chat_op_agent_react(%L, %L, '👍', true)).id::text$q$, test.id('W'), test.ref('r1')));
  PERFORM test.ok(v LIKE 'ERROR That message no longer exists%', 'react: never where the key can''t read', v);

  v := test.key_value('KA', format($q$SELECT (public.chat_op_agent_mark_decision(%L, %L, true)).decision_by::text$q$, test.id('W'), test.ref('b1')));
  PERFORM test.ok(v = test.id('A')::text, 'decision: marked as A', v);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a WHERE a.op = 'chat.decision'
                           AND a.payload ->> 'message_id' = test.ref('b1')::text AND a.actor_label = 'A · via CI key'),
    'decision: the trail reads "A · via CI key"');
  v := test.key_value('KA', format($q$SELECT (public.chat_op_agent_mark_decision(%L, %L, true)).id::text$q$, test.id('W'), test.ref('p1')));
  PERFORM test.ok(v LIKE 'ERROR That message no longer exists%', 'decision: never in a private channel with the switch off', v);

  v := test.key_value('KA', format($q$SELECT (public.chat_op_agent_wrap_up(%L, %L, %L, false)).wrapped_by::text$q$,
    test.id('W'), test.ref('k1'), test.ref('b1')));
  PERFORM test.ok(v = test.id('A')::text, 'wrap up: the key wraps up its own chain as A', v);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity a WHERE a.op = 'chat.wrap_up'
                           AND a.payload ->> 'message_id' = test.ref('k1')::text AND a.actor_label = 'A · via CI key'),
    'wrap up: the trail reads "A · via CI key"');

  v := test.key_value('KA', format($q$SELECT (public.chat_op_agent_create_channel(%L, 'Release Train', 'cuts')).created_by::text$q$, test.id('W')));
  PERFORM test.ok(v = test.id('A')::text
                  AND EXISTS (SELECT 1 FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Release Train'),
    'create: the key makes a channel as A, the name as typed', v);
  v := test.key_value('KA', format($q$SELECT (public.chat_op_agent_create_channel(%L, 'shh', '', true)).id::text$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ERROR Turn on "Include private channels I''m in"%', 'create: no private channel with the switch off', v);
  v := test.key_value('KV', format($q$SELECT (public.chat_op_agent_create_channel(%L, 'viewer-made')).id::text$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ERROR This API key can''t post to chat%', 'create: Chat: View can''t create', v);
END;
$$;

-- ── 7. 30 posts a minute per key ────────────────────────────────────────────
DO $$
DECLARE
  v text;
  i int;
  v_bad text;
BEGIN
  -- Clear the minute, then 30 posts in batches of 9 spread over it.
  PERFORM test.age(interval '2 minutes');
  FOR i IN 1 .. 30 LOOP
    v := test.post('KB', 'Q', 'burst', 'tick ' || i);
    IF v <> 'ok' THEN v_bad := coalesce(v_bad, i || ': ' || v); END IF;
    IF i % 9 = 0 THEN
      UPDATE public.chat_messages SET created_at = created_at - interval '11 seconds'
       WHERE api_key_id = test.id('KB');
    END IF;
  END LOOP;
  PERFORM test.ok(v_bad IS NULL, 'limit: 30 posts in a minute go through', v_bad);
  UPDATE public.chat_messages SET created_at = created_at - interval '11 seconds' WHERE api_key_id = test.id('KB');
  v := test.post('KB', 'Q', 'burst31', 'tick 31');
  PERFORM test.ok(v LIKE 'ERROR You''re sending messages too quickly%', 'limit: the 31st in a minute is refused', v);
  v := test.post('KA', 'Q', 'other-key', 'another key is not held back');
  PERFORM test.ok(v = 'ok', 'limit: per key, another key still posts', v);
END;
$$;

-- ── 8. Grants ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(f, ', ') INTO v_bad FROM unnest(ARRAY[
    'chat_op_agent_post(uuid, uuid, text, uuid)', 'chat_op_agent_react(uuid, uuid, text, boolean)',
    'chat_op_agent_mark_decision(uuid, uuid, boolean)', 'chat_op_agent_wrap_up(uuid, uuid, uuid, boolean)',
    'chat_op_agent_create_channel(uuid, text, text, boolean)', 'chat_agent_conversations(uuid)',
    'chat_agent_messages(uuid, uuid, timestamptz, uuid, integer)',
    'chat_agent_search(uuid, text, uuid, timestamptz, uuid, integer)', 'chat_agent_addressed(uuid, integer)']) f
   WHERE has_function_privilege('anon', 'public.' || f, 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')
      OR NOT has_function_privilege('service_role', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'grants: the agent ops and reads are the connector''s alone', v_bad);
  SELECT string_agg(f, ', ') INTO v_bad FROM unnest(ARRAY[
    'chat__key_actor(text)', 'chat__key_reads_channel(uuid, uuid, boolean)', 'chat__key_replies_on(uuid, uuid)',
    'chat__react_as(uuid, uuid, text, boolean)', 'chat__mark_decision_as(uuid, uuid, boolean)',
    'chat__wrap_up_as(uuid, uuid, uuid, boolean)',
    'chat__create_channel_as(uuid, uuid, text, text, boolean, uuid[], boolean, text, uuid)',
    'chat__search_in(uuid[], uuid, text, timestamptz, uuid, integer, uuid, timestamptz, boolean)']) f
   WHERE has_function_privilege('anon', 'public.' || f, 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'grants: the "as a person" bodies aren''t callable by clients', v_bad);
  SELECT string_agg(f, ', ') INTO v_bad FROM unnest(ARRAY[
    'chat_key_readers(uuid)', 'workspace_api_keys_set_private_chat(uuid, boolean)']) f
   WHERE has_function_privilege('anon', 'public.' || f, 'EXECUTE')
      OR has_function_privilege('service_role', 'public.' || f, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', 'public.' || f, 'EXECUTE');
  PERFORM test.ok(v_bad IS NULL, 'grants: Details'' line and the switch are signed-in people''s', v_bad);
  PERFORM test.ok(EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_name = 'workspace_api_keys' AND column_name = 'include_private_chat'
                             AND is_nullable = 'NO' AND column_default = 'false'),
    'column: include_private_chat is not null, off by default');
END;
$$;
