-- Chat v2 Catch up and the bell (CV-5: supabase/migrations/…_chat_v2_catchup.sql).
-- "Addressed to you, row by row" (AC7.1, AC7.3, AC7.4, AC7.10): each event of
-- §11 writes exactly its Catch up item and bell row, and no device notice yet
-- (CV-6a). "One state with the bell" (AC7.2): Done dismisses the bell twin;
-- dismissing in the bell closes the item; reading closes both; undismiss,
-- Undo and marking unread bring them back.
--
-- Cast: O owns workspace W (Duo); A, B, C and E are members; X is in no
-- workspace; K is A's API key with Chat at Edit. A makes the public channel L
-- (B, C, E: only A writes there, so nobody's own sends read their items), the
-- public channel G (B, C, E: chains and Every message), the private channel P
-- (B), the announcement channel N (B, C) and a direct message D with B. Team T
-- is B and C. Messages are sent through the ops, then moved to fixed times a
-- minute apart on 1 Oct (one transaction gives every op the same now(); the old
-- times also keep the sending limit out of the way). A check never shares a
-- statement with the send it looks at (a statement sees the rows as they were
-- when it started).

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'E', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Catch up');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C', 'E']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv5-catchup'),
        '{"chat": "edit"}'::jsonb, test.id('A'));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
CREATE FUNCTION test.at(p_n int) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT '2026-10-01 09:00:00+00'::timestamptz + make_interval(mins => p_n)
$$;
CREATE FUNCTION test.person_ref(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'moduo://person/' || test.id(p)
$$;
-- Send as a person (the op the app calls), then move the message to minute p_n.
CREATE FUNCTION test.send(p_who text, p_conv text, p_msg text, p_body text, p_n int, p_reply text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  v := test.as_user(p_who, format(
    $q$SELECT public.chat_op_send(%L::uuid, %L::uuid, %L::text, %L::uuid)$q$,
    test.mid(p_msg), test.ref(p_conv), p_body, CASE WHEN p_reply IS NOT NULL THEN test.mid(p_reply) END));
  UPDATE public.chat_messages SET created_at = test.at(p_n) WHERE id = test.mid(p_msg);
  RETURN v;
END;
$$;
CREATE FUNCTION test.edit(p_who text, p_msg text, p_body text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_edit(%L::uuid, %L::text)$q$, test.mid(p_msg), p_body))
$$;
-- One person's item for a message and reason: 'open' / 'done:<how>', '+bell'
-- when it has a twin; 'none'.
CREATE FUNCTION test.item(p_who text, p_msg text, p_reason text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((
    SELECT CASE WHEN k.done_at IS NULL THEN 'open' ELSE 'done:' || k.done_how END
           || CASE WHEN k.activity_id IS NOT NULL THEN '+bell' ELSE '' END
      FROM public.chat_catchup k
     WHERE k.user_id = test.id(p_who) AND k.message_id = test.mid(p_msg) AND k.reason = p_reason), 'none')
$$;
CREATE FUNCTION test.item_id(p_who text, p_msg text, p_reason text) RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT k.id FROM public.chat_catchup k
   WHERE k.user_id = test.id(p_who) AND k.message_id = test.mid(p_msg) AND k.reason = p_reason
$$;
-- Every item a person has about one message (any reason), e.g. 'mention'.
CREATE FUNCTION test.reasons(p_who text, p_msg text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce(string_agg(k.reason, ',' ORDER BY k.reason), '')
    FROM public.chat_catchup k WHERE k.user_id = test.id(p_who) AND k.message_id = test.mid(p_msg)
$$;
-- Who a bell row about a message tells ('B,E'; '' when there's no such row).
CREATE FUNCTION test.told(p_msg text, p_op text, p_reason text DEFAULT NULL) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT coalesce(string_agg(DISTINCT n, ',' ORDER BY n), '')
    FROM public.module_activity a
   CROSS JOIN unnest(ARRAY['O', 'A', 'B', 'C', 'E', 'X']) n
   WHERE a.workspace_id = test.id('W') AND a.payload ->> 'message_id' = test.mid(p_msg)::text
     AND a.op = p_op AND (p_reason IS NULL OR a.payload ->> 'reason' = p_reason)
     AND a.payload -> 'notify_user_ids' ? test.id(n)::text
$$;
CREATE FUNCTION test.bells(p_msg text) RETURNS int LANGUAGE sql VOLATILE AS $$
  SELECT count(*)::int FROM public.module_activity a
   WHERE a.workspace_id = test.id('W') AND a.payload ->> 'message_id' = test.mid(p_msg)::text
     AND a.op IN ('chat.mention', 'chat.reply', 'chat.announcement')
$$;
-- The bell twin of a person's item, and whether that person dismissed it.
CREATE FUNCTION test.twin_dismissed(p_who text, p_msg text, p_reason text) RETURNS boolean LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((SELECT ns.dismissed_at IS NOT NULL FROM public.chat_catchup k
                     JOIN public.notification_state ns ON ns.activity_id = k.activity_id AND ns.user_id = k.user_id
                    WHERE k.user_id = test.id(p_who) AND k.message_id = test.mid(p_msg) AND k.reason = p_reason), false)
$$;
CREATE FUNCTION test.twin(p_who text, p_msg text, p_reason text) RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT k.activity_id FROM public.chat_catchup k
   WHERE k.user_id = test.id(p_who) AND k.message_id = test.mid(p_msg) AND k.reason = p_reason
$$;
CREATE FUNCTION test.counts(p_who text, p_conv text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce((SELECT concat_ws('/', unread, mentions, addressed, catchup)
                          FROM public.chat_unread_counts(%L) WHERE channel_id = %L), 'none')$q$,
    test.id('W'), test.ref(p_conv)))
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Plans', '', false, ARRAY[%L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C'), test.id('E')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the public channel L with B, C and E', v);
  INSERT INTO test.ids SELECT 'L', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Plans';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Logo', '', false, ARRAY[%L, %L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C'), test.id('E')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the public channel G with B, C and E', v);
  INSERT INTO test.ids SELECT 'G', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Logo';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Secret', '', true, ARRAY[%L]::uuid[])$q$,
    test.id('W'), test.id('B')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the private channel P with B', v);
  INSERT INTO test.ids SELECT 'P', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Secret';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'News', '', false, ARRAY[%L, %L]::uuid[], true)$q$,
    test.id('W'), test.id('B'), test.id('C')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the announcement channel N with B and C', v);
  INSERT INTO test.ids SELECT 'N', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'News';
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')));
  PERFORM test.ok(v = 'ok 1', 'setup: A opens a direct message D with B', v);
  INSERT INTO test.ids SELECT 'D', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm';
  INSERT INTO public.teams (id, workspace_id, name, mark) VALUES (test.id('T'), test.id('W'), 'Design', 'D');
  INSERT INTO public.team_members (workspace_id, team_id, user_id)
  SELECT test.id('W'), test.id('T'), test.id(n) FROM unnest(ARRAY['B', 'C']) n;
  -- Everyone's read mark before minute 0, so the counts see the messages.
  UPDATE public.chat_members SET last_read_id = NULL, last_read_at = test.at(-1)
   WHERE workspace_id = test.id('W');
END;
$$;

-- ── 1. Addressed to you, row by row (AC7.1, AC7.3, AC7.4, AC7.10) ──────────
DO $$
DECLARE
  v text;
BEGIN
  -- A direct message: an item, no bell row (the bell is for work items).
  v := test.send('A', 'D', 'dm1', 'got a minute?', 1);
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'dm1', 'dm') = 'open' AND test.bells('dm1') = 0
                  AND test.reasons('A', 'dm1') = '',
    'direct message: B gets a Catch up item and no bell row; the sender gets nothing', v);
  v := test.send('A', 'D', 'dm2', 'see ' || test.person_ref('B'), 2);
  PERFORM test.ok(v = 'ok 1' AND test.reasons('B', 'dm2') = 'dm' AND test.bells('dm2') = 0,
    'direct message: naming B there is still one direct-message item, no bell row', v);
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_set_prefs(%L, 'none', NULL)$q$, test.ref('D')));
  v := test.send('A', 'D', 'dm3', 'still there?', 22);
  v := v || ' ' || test.send('A', 'D', 'dm4', 'hello ' || test.person_ref('B'), 23);
  PERFORM test.ok(v = 'ok 1 ok 1' AND test.reasons('B', 'dm3') = '' AND test.item('B', 'dm4', 'mention') = 'open'
                  AND test.bells('dm4') = 0,
    'direct message on Nothing: nothing, unless it names B (then a silent mention item)', v);
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_set_prefs(%L, 'mentions', NULL)$q$, test.ref('D')));

  -- @you in a channel: item and bell; a reader who isn't a member hears it too.
  v := test.send('A', 'L', 'm1', 'look ' || test.person_ref('B') || ' and ' || test.person_ref('O'), 3);
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm1', 'mention') = 'open+bell' AND test.item('O', 'm1', 'mention') = 'open+bell'
                  AND test.told('m1', 'chat.mention', 'person') = 'B,O' AND test.bells('m1') = 1
                  AND test.reasons('C', 'm1') = '' AND test.reasons('E', 'm1') = '',
    '@you: B, and O who reads the public channel without being in it, each get an item and the bell; nobody else', v);

  -- On Nothing an @you waits silently (AC7.4).
  PERFORM test.as_user('C', format($q$SELECT public.chat_op_set_prefs(%L, 'none', NULL)$q$, test.ref('L')));
  v := test.send('A', 'L', 'm2', 'and you ' || test.person_ref('C'), 4);
  PERFORM test.ok(v = 'ok 1' AND test.item('C', 'm2', 'mention') = 'open' AND test.bells('m2') = 0
                  AND test.counts('C', 'L') = '2/1/0/0',
    'Nothing: an @you is in Catch up only: no bell row, no number, not in the tab''s count (AC7.4)', test.counts('C', 'L'));

  -- @Team: each member who can read it, once; on Nothing silently.
  v := test.send('A', 'L', 'm3', 'over to moduo://team/' || test.id('T'), 5);
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm3', 'team_mention') = 'open+bell' AND test.item('C', 'm3', 'team_mention') = 'open'
                  AND test.told('m3', 'chat.mention', 'team') = 'B'
                  AND (SELECT payload -> 'team_ids' FROM public.module_activity
                        WHERE payload ->> 'message_id' = test.mid('m3')::text) = jsonb_build_array(test.id('T')::text)
                  AND test.reasons('E', 'm3') = '',
    '@Team: B gets the item and the bell (the row names the team); C, on Nothing, the item only; E, not in it, nothing', v);
  v := test.send('A', 'L', 'm4', test.person_ref('B') || ' and moduo://team/' || test.id('T'), 6);
  PERFORM test.ok(v = 'ok 1' AND test.reasons('B', 'm4') = 'mention' AND test.told('m4', 'chat.mention', 'team') = '',
    '@Team: B, named in person too, hears it once (as @you)', v);

  -- The team's mute (TV-D13's "Your teams" off).
  INSERT INTO public.user_preferences (user_id, preferences) VALUES (test.id('B'), '{"notifications": {"teams": false}}')
  ON CONFLICT (user_id) DO UPDATE SET preferences = '{"notifications": {"teams": false}}';
  v := test.send('A', 'L', 'm5', 'design again moduo://team/' || test.id('T'), 7);
  PERFORM test.ok(v = 'ok 1' AND test.reasons('B', 'm5') = '' AND test.item('C', 'm5', 'team_mention') = 'open'
                  AND test.bells('m5') = 0,
    '@Team: with "Your teams" off, B hears nothing; C still gets the silent item', v);
  PERFORM test.ok(test.counts('B', 'L') = '5/2/2/2',
    'team mute: while it''s on, team mentions count nowhere: mentions, the number, the tab (m1 and m4 do)',
    test.counts('B', 'L'));
  UPDATE public.user_preferences SET preferences = '{}' WHERE user_id = test.id('B');
  PERFORM test.ok(test.counts('B', 'L') = '5/4/4/3',
    'team mute: off again, team mentions count again; m5, sent while it was on, has no Catch up item to count',
    test.counts('B', 'L'));

  -- @channel: every member not on Nothing, once.
  v := test.send('A', 'L', 'm6', '@channel standup moved', 8);
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm6', 'everyone') = 'open+bell' AND test.item('E', 'm6', 'everyone') = 'open+bell'
                  AND test.told('m6', 'chat.mention', 'everyone') = 'B,E'
                  AND test.reasons('C', 'm6') = '' AND test.reasons('O', 'm6') = '' AND test.reasons('A', 'm6') = '',
    '@channel: B and E; not C (on Nothing), not O (not in it), not the sender', v);

  -- A reply in a chain you're in: one item per chain (in G).
  v := test.send('B', 'G', 'r0', 'which logo, ' || test.person_ref('O') || '?', 9);
  PERFORM test.ok(v = 'ok 1' AND test.item('O', 'r0', 'mention') = 'open+bell', 'chain: B asks in G, naming O', v);
  v := test.send('E', 'G', 'r1', 'the round one', 10, 'r0');
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'r1', 'reply') = 'open+bell' AND test.item('O', 'r1', 'reply') = 'open+bell'
                  AND test.told('r1', 'chat.reply') = 'B,O' AND test.reasons('C', 'r1') = '',
    'chain: a reply reaches the root''s author and who it named; not C, who isn''t in it', v);
  v := test.send('E', 'G', 'r2', 'or the square', 11, 'r0');
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'r2', 'reply') = 'open+bell' AND test.item('B', 'r1', 'reply') = 'none'
                  AND (SELECT count(*) FROM public.chat_catchup WHERE user_id = test.id('B') AND chain_root_id = test.mid('r0')) = 1
                  AND (SELECT ns.dismissed_at IS NOT NULL FROM public.notification_state ns
                        JOIN public.module_activity a ON a.id = ns.activity_id
                        WHERE ns.user_id = test.id('B') AND a.payload ->> 'message_id' = test.mid('r1')::text),
    'chain: a second reply moves B''s one chain item to it; the bell keeps one row for the chain (the older one is dismissed)', v);
  v := test.send('A', 'G', 'r3', 'square', 12, 'r1');
  PERFORM test.ok(v = 'ok 1' AND test.told('r3', 'chat.reply') = 'B,E,O' AND test.item('E', 'r3', 'reply') = 'open+bell',
    'chain: E, who replied and is quoted, hears the chain too', v);

  -- Stop following, and follow again.
  v := test.as_user('B', format($q$SELECT public.chat_op_follow_chain(%L::uuid, false)$q$, test.mid('r2')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'r3', 'reply') = 'done:done+bell' AND test.twin_dismissed('B', 'r3', 'reply')
                  AND EXISTS (SELECT 1 FROM public.chat_chain_mutes WHERE user_id = test.id('B') AND root_id = test.mid('r0')),
    'stop following: named by any of its messages, the chain is muted and its open item leaves Catch up with its bell row', v);
  v := test.send('E', 'G', 'r4', 'final answer', 13, 'r0');
  PERFORM test.ok(v = 'ok 1' AND test.reasons('B', 'r4') = '' AND test.told('r4', 'chat.reply') = 'A,O',
    'stop following: the next reply doesn''t reach B', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_follow_chain(%L::uuid, true)$q$, test.mid('r0')));
  PERFORM test.ok(v = 'ok 1', 'follow again: B follows the chain again', v);
  v := test.send('E', 'G', 'r5', 'really final', 14, 'r0');
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'r5', 'reply') = 'open+bell',
    'follow again: the next reply reaches B with a new item', v);
  -- On Nothing, a chain's replies reach nobody.
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_set_prefs(%L, 'none', NULL)$q$, test.ref('G')));
  v := test.send('A', 'G', 'r6', 'one more', 24, 'r0');
  PERFORM test.ok(v = 'ok 1' AND test.reasons('B', 'r6') = '' AND test.item('B', 'r5', 'reply') = 'open+bell'
                  AND test.told('r6', 'chat.reply') = 'E,O',
    'chain on Nothing: B hears nothing and B''s chain item stays where it was', v);
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_set_prefs(%L, 'mentions', NULL)$q$, test.ref('G')));
  v := test.as_user('X', format($q$SELECT public.chat_op_follow_chain(%L::uuid, false)$q$, test.mid('r0')));
  PERFORM test.ok(v = 'P0002 That message no longer exists.', 'stop following: an outsider is told the message isn''t there', v);

  -- An announcement: every member, once; Nothing turns it off.
  PERFORM test.as_user('C', format($q$SELECT public.chat_op_set_prefs(%L, 'none', NULL)$q$, test.ref('N')));
  v := test.send('A', 'N', 'n1', 'We ship on Friday', 15);
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'n1', 'announcement') = 'open+bell' AND test.told('n1', 'chat.announcement') = 'B'
                  AND test.reasons('C', 'n1') = '',
    'announcement: B gets the item and the bell; C, on Nothing, nothing', v);

  -- Every message: one line per conversation, no bell (AC7.3).
  PERFORM test.as_user('C', format($q$SELECT public.chat_op_set_prefs(%L, 'all', NULL)$q$, test.ref('G')));
  UPDATE public.chat_members SET last_read_id = NULL, last_read_at = test.at(24)
   WHERE channel_id = test.ref('G') AND user_id = test.id('C');
  PERFORM test.send('E', 'G', 'p1', 'one', 25);
  PERFORM test.send('E', 'G', 'p2', 'two', 26);
  PERFORM test.send('E', 'G', 'p3', 'three', 27);
  PERFORM test.ok((SELECT count(*) FROM public.chat_catchup
                    WHERE user_id = test.id('C') AND channel_id = test.ref('G') AND reason = 'every_message') = 1
                  AND test.item('C', 'p3', 'every_message') = 'open'
                  AND test.bells('p1') + test.bells('p2') + test.bells('p3') = 0
                  AND test.counts('C', 'G') = '3/0/3/1',
    'Every message: three messages are one line (at the newest) and no bell row; the conversation counts 3, the tab 1 (AC7.3)',
    test.counts('C', 'G'));
  v := test.send('E', 'G', 'p4', 'and ' || test.person_ref('C'), 28);
  PERFORM test.ok(v = 'ok 1' AND test.item('C', 'p4', 'mention') = 'open+bell' AND test.item('C', 'p3', 'every_message') = 'open'
                  AND test.counts('C', 'G') = '4/1/4/2',
    'Every message: a mention there is its own item; the line stays', test.counts('C', 'G'));
  -- A send that commits after a newer one never moves the line back.
  PERFORM public.chat__fan_out(m, c, m.author_id)
     FROM public.chat_messages m JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.id = test.mid('p1');
  PERFORM test.ok(test.item('C', 'p3', 'every_message') = 'open'
                  AND (SELECT count(*) FROM public.chat_catchup
                        WHERE user_id = test.id('C') AND channel_id = test.ref('G') AND reason = 'every_message') = 1,
    'Every message: an older message arriving late leaves the line on the newest');

  -- An edit tells only people named for the first time (AC7.10).
  v := test.send('A', 'L', 'e1', 'hi ' || test.person_ref('B'), 20);
  v := test.edit('A', 'e1', 'hi ' || test.person_ref('B') || ' ' || test.person_ref('O'));
  PERFORM test.ok(v = 'ok 1' AND test.item('O', 'e1', 'mention') = 'open+bell' AND test.reasons('B', 'e1') = 'mention'
                  AND test.told('e1', 'chat.mention', 'person') = 'B,O' AND test.bells('e1') = 2,
    'edit: O, named for the first time, is told (one new bell row); B isn''t told again', v);
  v := test.edit('A', 'e1', 'hi ' || test.person_ref('O'));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'e1', 'mention') = 'done:closed+bell' AND test.twin_dismissed('B', 'e1', 'mention')
                  AND test.item('O', 'e1', 'mention') = 'open+bell',
    'edit: taking B out closes B''s mention and its bell row; O keeps theirs', v);
  v := test.edit('A', 'e1', 'hi ' || test.person_ref('O') || ' ' || test.person_ref('B'));
  PERFORM test.ok(v = 'ok 1' AND test.bells('e1') = 2 AND test.reasons('B', 'e1') = 'mention'
                  AND test.item('B', 'e1', 'mention') = 'done:closed+bell',
    'edit: putting B back tells nobody again', v);
  v := test.edit('A', 'e1', 'hi ' || test.person_ref('O') || ' ' || test.person_ref('B') || ' moduo://team/' || test.id('T'));
  PERFORM test.ok(v = 'ok 1' AND test.reasons('B', 'e1') = 'mention' AND test.item('C', 'e1', 'team_mention') = 'open'
                  AND test.bells('e1') = 2,
    'edit: adding @Team tells C (on Nothing: the item only), not B, already named', v);
  v := test.edit('A', 'e1', 'hi ' || test.person_ref('O') || ' ' || test.person_ref('B') || ' moduo://team/' || test.id('T') || ' @channel');
  PERFORM test.ok(v = 'ok 1' AND test.item('E', 'e1', 'everyone') = 'open+bell' AND test.told('e1', 'chat.mention', 'everyone') = 'E'
                  AND test.reasons('B', 'e1') = 'mention',
    'edit: adding @channel tells the members not told yet (E), not B or the sender', v);
  v := test.edit('A', 'e1', 'hi ' || test.person_ref('O') || ' ' || test.person_ref('B') || ' moduo://team/' || test.id('T') || ' @channel!');
  PERFORM test.ok(v = 'ok 1' AND test.bells('e1') = 3, 'edit: an edit without a new mention tells nobody', v);

  -- Never across the conversation's read rule; never the sender.
  v := test.send('A', 'P', 's1', 'moduo://team/' || test.id('T'), 21);
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 's1', 'team_mention') = 'open+bell' AND test.reasons('C', 's1') = ''
                  AND test.told('s1', 'chat.mention', 'team') = 'B',
    'private: @Team reaches B, in P; never C, who can''t read it', v);

  -- An app's post through a key: like a person's.
  v := test.as_key('K', format($q$SELECT public.chat_op_agent_post(%L, %L, %L, NULL)$q$,
    test.id('W'), test.ref('L'), format('deploy done <@%s>', test.id('B'))));
  PERFORM test.ok(v = 'ok 1'
                  AND (SELECT k.reason || ':' || a.actor_type || ':' || (a.payload ->> 'reason')
                         FROM public.chat_catchup k JOIN public.module_activity a ON a.id = k.activity_id
                         JOIN public.chat_messages m ON m.id = k.message_id
                        WHERE k.user_id = test.id('B') AND m.author_kind = 'api_key') = 'mention:api_key:person',
    'app post: naming B gives B the item and the bell, attributed to the key', v);

  -- Device notices are CV-6a's: chat writes none yet.
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.notice_deliveries WHERE workspace_id = test.id('W')),
    'no device notice is written yet (CV-6a)');
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_catchup WHERE workspace_id = test.id('W') AND held_at IS NOT NULL),
    'held_at stays empty until the holds arrive (CV-18)');
END;
$$;

-- ── 2. One state with the bell (AC7.2) ─────────────────────────────────────
DO $$
DECLARE
  v text;
  v_acts int := (SELECT count(*) FROM public.module_activity WHERE workspace_id = test.id('W'));
BEGIN
  -- Done in Catch up dismisses the bell twin; Undo brings both back.
  v := test.as_user('B', format($q$SELECT public.chat_op_catchup_done(ARRAY[%L]::uuid[])$q$, test.item_id('B', 'm1', 'mention')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm1', 'mention') = 'done:done+bell' AND test.twin_dismissed('B', 'm1', 'mention')
                  AND NOT test.twin_dismissed('O', 'm1', 'mention'),
    'Done: the item closes and its bell row is dismissed, for B only', v);
  PERFORM test.ok(test.value_as('B', format($q$SELECT (dismissed_at IS NOT NULL)::text FROM public.notifications_list(%L, 200) WHERE id = %L$q$,
                    test.id('W'), test.twin('B', 'm1', 'mention'))) = 'true',
    'Done: the bell shows it dismissed');
  v := test.as_user('B', format($q$SELECT public.chat_op_catchup_reopen(ARRAY[%L]::uuid[])$q$, test.item_id('B', 'm1', 'mention')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm1', 'mention') = 'open+bell' AND NOT test.twin_dismissed('B', 'm1', 'mention'),
    'Undo: the item and its bell row are back', v);

  -- Dismissing in the bell closes the item; undismissing reopens it.
  v := test.as_user('B', format($q$SELECT public.notifications_op_dismiss(%L, %L)$q$, test.id('W'), test.twin('B', 'm1', 'mention')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm1', 'mention') = 'done:bell+bell',
    'bell: dismissing a mention closes it in Catch up', v);
  v := test.as_user('B', format($q$SELECT public.notifications_op_undismiss(%L, %L)$q$, test.id('W'), test.twin('B', 'm1', 'mention')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm1', 'mention') = 'open+bell' AND NOT test.twin_dismissed('B', 'm1', 'mention'),
    'bell: undismissing brings it back to Catch up', v);
  v := test.as_user('B', format($q$SELECT public.notifications_op_mark_read(%L, %L)$q$, test.id('W'), test.twin('B', 'm1', 'mention')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm1', 'mention') = 'open+bell',
    'bell: its read dot is the bell''s own (Catch up keeps the item)', v);

  -- Reading closes both, up to the message read; marking unread reopens them.
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_catchup_done(ARRAY[%L]::uuid[])$q$, test.item_id('B', 'm3', 'team_mention')));
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('L'), test.mid('m4')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm1', 'mention') = 'done:read+bell' AND test.twin_dismissed('B', 'm1', 'mention')
                  AND test.item('B', 'm4', 'mention') = 'done:read+bell'
                  AND test.item('B', 'm6', 'everyone') = 'open+bell',
    'read: reading up to m4 closes m1 and m4 with their bell rows; m6, after it, stays', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_unread(%L::uuid, %L::uuid)$q$, test.ref('L'), test.mid('m1')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm1', 'mention') = 'open+bell' AND NOT test.twin_dismissed('B', 'm1', 'mention')
                  AND test.item('B', 'm4', 'mention') = 'open+bell'
                  AND test.item('B', 'm3', 'team_mention') = 'done:done+bell',
    'mark unread: what reading closed comes back; what was Done stays Done', v);
  -- A non-member who was named reads the public channel: theirs close too.
  v := test.as_user('O', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('L'), test.mid('m1')));
  PERFORM test.ok(v = 'ok 1' AND test.item('O', 'm1', 'mention') = 'done:read+bell',
    'read: O, who reads L without being in it, clears the mention by reading it', v);

  -- Sending is reading up to your own message.
  v := test.send('B', 'L', 'b9', 'all caught up', 30);
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'm6', 'everyone') = 'done:read+bell' AND test.item('B', 'm1', 'mention') = 'done:read+bell',
    'send: B''s own items in L up to B''s message close as read', v);

  -- Only your own items; never a key; at most 1,000 at a time.
  v := test.as_user('C', format($q$SELECT public.chat_op_catchup_done(ARRAY[%L]::uuid[])$q$, test.item_id('E', 'm6', 'everyone')));
  PERFORM test.ok(v = 'ok 1' AND test.item('E', 'm6', 'everyone') = 'open+bell'
                  AND test.value_as('C', format($q$SELECT public.chat_op_catchup_done(ARRAY[%L]::uuid[])::text$q$,
                        test.item_id('E', 'm6', 'everyone'))) = '0',
    'Done: someone else''s item is untouched (0 closed)', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_catchup_done(ARRAY[%L]::uuid[])$q$, test.item_id('B', 'm6', 'everyone')));
  PERFORM test.ok(v = '42501 Sign in first.', 'Done: a key is refused', v);
  v := test.as_user('B', $q$SELECT public.chat_op_catchup_done(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 1001)))$q$);
  PERFORM test.ok(v = '22023 Up to 1,000 items at a time.', 'Done: up to 1,000 items at a time', v);

  -- A chain item: Done dismisses its current bell row.
  v := test.as_user('B', format($q$SELECT public.chat_op_catchup_done(ARRAY[%L]::uuid[])$q$, test.item_id('B', 'r5', 'reply')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'r5', 'reply') = 'done:done+bell' AND test.twin_dismissed('B', 'r5', 'reply'),
    'chain: Done on the chain''s item dismisses its bell row', v);
  -- Undo of two items of one chain reopens only the newest (one open item per chain).
  v := test.as_user('B', format($q$SELECT public.chat_op_catchup_reopen(ARRAY[%L, %L]::uuid[])$q$,
    test.item_id('B', 'r3', 'reply'), test.item_id('B', 'r5', 'reply')));
  PERFORM test.ok(v = 'ok 1' AND test.item('B', 'r5', 'reply') = 'open+bell' AND test.item('B', 'r3', 'reply') = 'done:done+bell',
    'chain: Undo of two of its items reopens the newest only', v);
  PERFORM test.ok(test.value_as('B', format($q$SELECT public.chat_op_catchup_reopen(ARRAY[%L]::uuid[])::text$q$,
                    test.item_id('B', 'r3', 'reply'))) = '0'
                  AND test.item('B', 'r3', 'reply') = 'done:done+bell',
    'chain: Undo of an older item while the chain has an open one reopens nothing');

  -- Marking unread brings back a grouped line too.
  v := test.as_user('C', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('G'), test.mid('p4')));
  PERFORM test.ok(v = 'ok 1' AND test.item('C', 'p3', 'every_message') = 'done:read' AND test.item('C', 'p4', 'mention') = 'done:read+bell'
                  AND test.counts('C', 'G') = '0/0/0/0',
    'read: reading G to the newest closes C''s line and mention', v);
  v := test.as_user('C', format($q$SELECT public.chat_op_mark_unread(%L::uuid, %L::uuid)$q$, test.ref('G'), test.mid('p1')));
  PERFORM test.ok(v = 'ok 1' AND test.item('C', 'p3', 'every_message') = 'open' AND test.item('C', 'p4', 'mention') = 'open+bell'
                  AND test.counts('C', 'G') = '4/1/4/2',
    'mark unread: the Every-message line and the mention come back', v);

  -- A line whose newest message was deleted is read once what's shown is.
  v := test.send('E', 'G', 'p5', 'five', 40);
  UPDATE public.chat_messages SET deleted_at = now() WHERE id = test.mid('p5');
  PERFORM test.ok(v = 'ok 1' AND test.item('C', 'p5', 'every_message') = 'open' AND test.counts('C', 'G') = '4/1/4/1',
    'deleted: the line moved to p5, and with p5 deleted it leaves the count', test.counts('C', 'G'));
  v := test.as_user('C', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('G'), test.mid('p4')));
  PERFORM test.ok(v = 'ok 1' AND test.item('C', 'p5', 'every_message') = 'done:read' AND test.item('C', 'p4', 'mention') = 'done:read+bell',
    'deleted: reading to p4, the last message shown, closes the line on deleted p5 too', v);

  -- Joining reads to the newest message: what Catch up held there is read.
  v := test.as_user('O', format($q$SELECT public.chat_op_join(%L::uuid)$q$, test.ref('G')));
  PERFORM test.ok(v LIKE 'ok %' AND test.item('O', 'r0', 'mention') = 'done:read+bell'
                  AND (SELECT count(*) FROM public.chat_catchup
                        WHERE user_id = test.id('O') AND channel_id = test.ref('G') AND done_at IS NULL) = 0,
    'join: O, named in G before joining, has nothing left open there once in', v);

  -- These ops need no plan and log no activity.
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');
  v := test.as_user('B', format($q$SELECT public.chat_op_catchup_done(ARRAY[%L]::uuid[])$q$, test.item_id('B', 'r5', 'reply')));
  v := v || ' ' || test.as_user('B', format($q$SELECT public.chat_op_follow_chain(%L::uuid, false)$q$, test.mid('r0')));
  PERFORM test.ok(v = 'ok 1 ok 1' AND test.item('B', 'r5', 'reply') = 'done:done+bell',
    'paused: Done and Stop following still work (no plan needed)', v);
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
  PERFORM test.ok((SELECT count(*) FROM public.module_activity WHERE workspace_id = test.id('W')) = v_acts + 1
                  AND (SELECT count(*) FROM public.module_activity WHERE workspace_id = test.id('W') AND op = 'chat.join') = 1,
    'activity: Catch up''s ops, the bell''s, read marks and following log nothing (plain sends ring no bell; O''s join is its own row)');
END;
$$;

-- ── 3. Written only by ops ──────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('B', format(
    $q$INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, reason) VALUES (%L, %L, %L, 'mention')$q$,
    test.id('W'), test.id('B'), test.ref('L')));
  PERFORM test.ok(v LIKE '42501 %', 'tables: a client can''t write Catch up items', v);
  v := test.as_user('B', format($q$UPDATE public.chat_catchup SET done_at = NULL, done_how = NULL WHERE user_id = %L$q$, test.id('B')));
  PERFORM test.ok(v LIKE '42501 %', 'tables: nor reopen them by hand', v);
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.chat__fan_out(public.chat_messages, public.chat_channels, uuid, public.chat_messages)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.chat__close(uuid, uuid[], text, public.chat_messages)', 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', 'public.chat__reopen(uuid, uuid[])', 'EXECUTE')
                  AND NOT has_function_privilege('anon', 'public.chat_op_catchup_done(uuid[])', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.chat_op_catchup_done(uuid[])', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.chat_op_follow_chain(uuid, boolean)', 'EXECUTE'),
    'grants: the fan-out and its helpers are server-only; the ops are for signed-in people');
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.module_activity'::regclass
                            AND tgname = 'module_activity_gate_recipients'
                            AND pg_get_triggerdef(oid) LIKE '%chat.announcement%'),
    'the bell''s recipient guard covers chat''s rows');
END;
$$;
