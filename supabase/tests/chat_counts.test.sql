-- Chat v2 counts and the read mark (CV-2b: supabase/migrations/…_chat_v2_conversation_ops.sql).
-- "Counts count what's addressed to you" (AC1.7) and "opening a conversation
-- marks read only what was on screen" (AC1.2): chat_unread_counts per
-- conversation (unread, mentions, addressed, catchup), chat_op_mark_read
-- forward only, chat_op_mark_unread over the whole conversation, v1's
-- timestamp wrappers.
--
-- Cast: O owns workspace W (Duo); A, B and C are members; X is in no
-- workspace; K is A's API key. Messages are written straight into the tables
-- at fixed times (one transaction gives every op the same now()), after each
-- reader's mark.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C', 'X']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Counts');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Claude Desktop', 'mdo_test', md5('db-test-key-cv2b-counts'),
        '{"chat": "edit"}'::jsonb, test.id('A'));

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
CREATE FUNCTION test.mid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT test.id('msg:' || p_name)
$$;
-- The fixed clock messages are written on: a minute apart from 09:00 on 1 Oct.
CREATE FUNCTION test.at(p_n int) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT '2026-10-01 09:00:00+00'::timestamptz + make_interval(mins => p_n)
$$;
-- A message by p_who in p_conv at minute p_n (a reply when p_root is given).
CREATE FUNCTION test.put(p_conv text, p_who text, p_msg text, p_n int, p_body text DEFAULT 'hello',
                         p_root text DEFAULT NULL, p_quote text DEFAULT NULL,
                         p_mentions text[] DEFAULT '{}', p_everyone boolean DEFAULT false)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.chat_messages
    (id, workspace_id, channel_id, author_id, body, created_at, parent_id, reply_to_id,
     mentioned_user_ids, mentions_everyone)
  VALUES
    (test.mid(p_msg), test.id('W'), test.ref(p_conv), test.id(p_who), p_body, test.at(p_n),
     CASE WHEN p_root IS NOT NULL THEN test.mid(p_root) END,
     CASE WHEN coalesce(p_quote, p_root) IS NOT NULL THEN test.mid(coalesce(p_quote, p_root)) END,
     ARRAY(SELECT test.id(u) FROM unnest(p_mentions) u), p_everyone)
$$;
-- Everyone's read mark in p_conv back to before minute 0.
CREATE FUNCTION test.unread_all(p_conv text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.chat_members SET last_read_id = NULL, last_read_at = test.at(-1)
   WHERE channel_id = test.ref(p_conv)
$$;
-- One person's counts for one conversation: 'unread/mentions/addressed/catchup'.
CREATE FUNCTION test.counts(p_who text, p_conv text) RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT test.value_as(p_who, format(
    $q$SELECT coalesce((SELECT concat_ws('/', unread, mentions, addressed, catchup)
                          FROM public.chat_unread_counts(%L) WHERE channel_id = %L), 'none')$q$,
    test.id('W'), test.ref(p_conv)))
$$;
CREATE FUNCTION test.mark(p_who text, p_conv text) RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT last_read_id FROM public.chat_members WHERE channel_id = test.ref(p_conv) AND user_id = test.id(p_who)
$$;

DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: General exists', v);
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Plans', '', false, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the public channel Plans with B and C', v);
  INSERT INTO test.ids SELECT 'L', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Plans';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'News', '', false, ARRAY[%L, %L]::uuid[], true)$q$,
    test.id('W'), test.id('B'), test.id('C')));
  PERFORM test.ok(v = 'ok 1', 'setup: A makes the announcement channel News with B and C', v);
  INSERT INTO test.ids SELECT 'N', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'News';
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'Long read', '', false, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('C')));
  INSERT INTO test.ids SELECT 'R', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'Long read';
  v := test.as_user('A', format($q$SELECT public.chat_op_open_dm(%L, ARRAY[%L]::uuid[])$q$, test.id('W'), test.id('B')));
  PERFORM test.ok(v = 'ok 1', 'setup: A opens a direct message with B', v);
  INSERT INTO test.ids SELECT 'D', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'dm';
  INSERT INTO public.teams (id, workspace_id, name, mark) VALUES (test.id('T'), test.id('W'), 'Design', 'D');
  INSERT INTO public.team_members (workspace_id, team_id, user_id) VALUES (test.id('W'), test.id('T'), test.id('B'));
  PERFORM test.unread_all('L');
  PERFORM test.unread_all('N');
  PERFORM test.unread_all('R');
  PERFORM test.unread_all('D');
END;
$$;

-- ── Levels: the creator isn't forced onto Every message ────────────────────
DO $$
BEGIN
  PERFORM test.ok((SELECT notify_level FROM public.chat_members WHERE channel_id = test.ref('L') AND user_id = test.id('A')) = 'mentions'
                  AND (SELECT notify_level FROM public.chat_members WHERE channel_id = test.ref('L') AND user_id = test.id('B')) = 'mentions',
    'levels: the channel''s creator lands on Mentions and replies, like the people added (AC1.7)');
  PERFORM test.ok(test.counts('B', 'L') = '0/0/0/0' AND test.counts('B', 'D') = '0/0/0/0',
    'counts: nothing new, nothing counted; every conversation you''re in answers');
END;
$$;

-- ── Channel at Mentions and replies: only what's addressed to you counts ───
DO $$
BEGIN
  PERFORM test.put('L', 'C', 'l1', 1, 'morning all');
  PERFORM test.put('L', 'C', 'l2', 2, 'standup at ten');
  PERFORM test.ok(test.counts('B', 'L') = '2/0/0/0' AND test.counts('A', 'L') = '2/0/0/0',
    'mentions level: two plain messages make the channel unread (bold) and count nothing');

  PERFORM test.put('L', 'C', 'l3', 3, 'over to moduo://person/' || test.id('B'), p_mentions => ARRAY['B']);
  PERFORM test.ok(test.counts('B', 'L') = '3/1/1/1', 'mentions level: @B counts for B', test.counts('B', 'L'));
  PERFORM test.put('L', 'C', 'l4', 4, 'design moduo://team/' || test.id('T'));
  UPDATE public.chat_messages SET mentioned_team_ids = ARRAY[test.id('T')] WHERE id = test.mid('l4');
  PERFORM test.ok(test.counts('B', 'L') = '4/2/2/2' AND test.counts('A', 'L') = '4/0/0/0',
    'mentions level: @Design counts for B, in the team, and not for A', test.counts('B', 'L'));
  PERFORM test.put('L', 'C', 'l5', 5, '@channel heads up', p_everyone => true);
  PERFORM test.ok(test.counts('B', 'L') = '5/3/3/3' AND test.counts('A', 'L') = '5/1/1/1',
    'mentions level: @channel counts for everyone in it', test.counts('A', 'L'));

  -- Replies: a chain you're in (you wrote its first message, replied or were
  -- named in it), or a reply to your own message.
  PERFORM test.put('L', 'A', 'r1', 6, 'what about the logo?');
  PERFORM test.put('L', 'C', 'r1a', 7, 'on it', p_root => 'r1');
  PERFORM test.put('L', 'C', 'r1b', 8, 'done', p_root => 'r1');
  PERFORM test.ok(test.counts('A', 'L') = '7/1/3/2' AND test.counts('B', 'L') = '8/3/3/3',
    'replies: they count as messages; A, whose message started the chain, gets two replies as one Catch up item; B, not in it, gets none',
    test.counts('A', 'L') || ' ' || test.counts('B', 'L'));
  PERFORM test.put('L', 'B', 'b1', 9, 'my take');
  PERFORM test.put('L', 'C', 'q1', 10, 'agreed', p_root => 'b1', p_quote => 'b1');
  PERFORM test.ok(test.counts('B', 'L') = '9/3/4/4',
    'replies: a reply to B''s own message counts for B (B''s own message doesn''t)', test.counts('B', 'L'));
  PERFORM test.put('L', 'B', 'r1c', 11, 'and the colours?', p_root => 'r1');
  PERFORM test.put('L', 'C', 'r1d', 12, 'later', p_root => 'r1');
  PERFORM test.ok(test.counts('B', 'L') = '10/3/5/5',
    'replies: once B replied in the chain, its later replies count for B (the earlier ones don''t)', test.counts('B', 'L'));
  INSERT INTO public.chat_chain_mutes (user_id, root_id, workspace_id) VALUES (test.id('B'), test.mid('r1'), test.id('W'));
  PERFORM test.ok(test.counts('B', 'L') = '10/3/4/4',
    'replies: after "Stop following", the chain''s replies stop counting (still unread)', test.counts('B', 'L'));
  DELETE FROM public.chat_chain_mutes WHERE user_id = test.id('B');

  -- Deleted messages and event lines don't count.
  UPDATE public.chat_messages SET deleted_at = now() WHERE id = test.mid('l1');
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, kind, event, created_at)
  VALUES (test.mid('ev1'), test.id('W'), test.ref('L'), test.id('C'), '', 'event',
          jsonb_build_object('type', 'moved_in', 'ids', '[]'::jsonb), test.at(13));
  PERFORM test.ok(test.counts('B', 'L') = '9/3/5/5',
    'counts: a deleted message and an event line are not counted', test.counts('B', 'L'));
END;
$$;

-- ── Every message, Nothing, a direct message, an announcement channel ──────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('B', format($q$SELECT public.chat_op_set_prefs(%L, 'all', NULL)$q$, test.ref('L')));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'L') = '9/3/9/6',
    'Every message: every unread message counts; in Catch up the plain ones are one item (the mentions and the chain keep theirs)',
    test.counts('B', 'L'));
  PERFORM test.ok(test.counts('C', 'L') = '3/0/1/1',
    'counts: your own messages are never unread (C wrote most of them); B''s reply in C''s chain counts for C', test.counts('C', 'L'));
  v := test.as_user('B', format($q$SELECT public.chat_op_set_prefs(%L, 'none', NULL)$q$, test.ref('L')));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'L') = '9/3/0/0',
    'Nothing: still unread (bold), but no number and nothing in Catch up''s count, mentions included', test.counts('B', 'L'));
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_set_prefs(%L, 'mentions', NULL)$q$, test.ref('L')));

  PERFORM test.put('D', 'A', 'd1', 1, 'hi');
  PERFORM test.put('D', 'A', 'd2', 2, 'got a minute?');
  PERFORM test.put('D', 'A', 'd3', 3, 'moduo://person/' || test.id('B'), p_mentions => ARRAY['B']);
  PERFORM test.ok(test.counts('B', 'D') = '3/1/3/3' AND test.counts('A', 'D') = '0/0/0/0',
    'direct message: every message from the other person counts, each its own Catch up item', test.counts('B', 'D'));
  v := test.as_user('B', format($q$SELECT public.chat_op_set_prefs(%L, 'none', NULL)$q$, test.ref('D')));
  PERFORM test.ok(test.counts('B', 'D') = '3/1/0/0', 'direct message on Nothing: bold, no number', test.counts('B', 'D'));
  PERFORM test.as_user('B', format($q$SELECT public.chat_op_set_prefs(%L, 'all', NULL)$q$, test.ref('D')));

  PERFORM test.put('N', 'A', 'n1', 1, 'We ship on Friday');
  PERFORM test.put('N', 'A', 'n2', 2, 'Office closed Monday');
  PERFORM test.ok(test.counts('B', 'N') = '2/0/2/2',
    'announcement channel: each post counts on Mentions and replies', test.counts('B', 'N'));

  -- Archived conversations drop out of the counts.
  UPDATE public.chat_channels SET archived_at = now() WHERE id = test.ref('N');
  PERFORM test.ok(test.counts('B', 'N') = 'none', 'archived: no row');
  UPDATE public.chat_channels SET archived_at = NULL WHERE id = test.ref('N');
END;
$$;

-- ── The read mark is a message (AC1.2) ─────────────────────────────────────
DO $$
DECLARE
  v text;
  i int;
BEGIN
  -- 200 unread from C in "Long read".
  FOR i IN 1..200 LOOP
    PERFORM test.put('R', 'C', 'R' || i, i, 'line ' || i);
  END LOOP;
  PERFORM test.ok(test.counts('B', 'R') = '200/0/0/0', 'setup: 200 unread for B', test.counts('B', 'R'));

  -- Opening it showed messages 1–50: only those become read.
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('R'), test.mid('R50')));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'R') = '150/0/0/0' AND test.mark('B', 'R') = test.mid('R50'),
    'mark read: only what was on screen is read; the mark is the last message seen (AC1.2)', v || ' ' || test.counts('B', 'R'));
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('R'), test.mid('R10')));
  PERFORM test.ok(v = 'ok 1' AND test.mark('B', 'R') = test.mid('R50') AND test.counts('B', 'R') = '150/0/0/0',
    'mark read: never moves back (an older page loading doesn''t)', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('R'), test.mid('l2')));
  PERFORM test.ok(v = 'P0002 That message isn''t in this conversation.', 'mark read: a message of another conversation is refused', v);

  -- Mark unread counts the whole conversation, not what's loaded.
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_unread(%L::uuid, %L::uuid)$q$, test.ref('R'), test.mid('R1')));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'R') = '200/0/0/0' AND test.mark('B', 'R') IS NULL,
    'mark unread: from the first message, all 200 are unread again', v || ' ' || test.counts('B', 'R'));
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_unread(%L::uuid, %L::uuid)$q$, test.ref('R'), test.mid('R121')));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'R') = '80/0/0/0' AND test.mark('B', 'R') = test.mid('R120'),
    'mark unread: the mark moves to just before that message; 80 unread, whatever the screen had loaded', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('R'), test.mid('R200')));
  PERFORM test.ok(test.counts('B', 'R') = '0/0/0/0', 'mark read: the newest message reads them all');

  -- v1's wrappers (timestamps), until CV-3.
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_unread(%L::uuid, %L::timestamptz)$q$, test.ref('R'), test.at(191)));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'R') = '10/0/0/0',
    'v1 mark unread: a time reads as the first message at or after it', v || ' ' || test.counts('B', 'R'));
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::timestamptz)$q$, test.ref('R'), test.at(195)));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'R') = '5/0/0/0' AND test.mark('B', 'R') = test.mid('R195'),
    'v1 mark read: a time reads as the newest message at or before it', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_read(%L::uuid, NULL::timestamptz)$q$, test.ref('R')));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'R') = '0/0/0/0', 'v1 mark read: no time means everything so far', v);

  -- Read marks log nothing; a non-member's mark is no one's.
  PERFORM test.ok((SELECT count(*) FROM public.module_activity WHERE entity_id = test.ref('R')) = 1,
    'mark read and unread write no activity (only the channel''s creation is there)');
  v := test.as_user('O', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('R'), test.mid('R5')));
  PERFORM test.ok(v = 'ok 1' AND NOT EXISTS (SELECT 1 FROM public.chat_members WHERE channel_id = test.ref('R') AND user_id = test.id('O')),
    'mark read: someone who only reads the public channel has no mark to move', v);
  v := test.as_user('X', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('R'), test.mid('R5')));
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'mark read: an outsider is refused', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('R'), test.mid('R5')));
  PERFORM test.ok(v = '42501 You don''t have access to this workspace.', 'mark read: a key is refused', v);
END;
$$;

-- ── A converted v1 reply is unread only if its root is ─────────────────────
DO $$
BEGIN
  PERFORM test.put('L', 'C', 'v1root', 20, 'old thread');
  PERFORM test.put('L', 'C', 'v1reply', 40, 'old reply', p_root => 'v1root');
  UPDATE public.chat_messages SET v1_thread_reply = true WHERE id = test.mid('v1reply');
  UPDATE public.chat_members SET last_read_id = test.mid('v1root'), last_read_at = test.at(20)
   WHERE channel_id = test.ref('L') AND user_id = test.id('A');
  PERFORM test.ok(test.counts('A', 'L') = '0/0/0/0',
    'v1 replies: read root, so its converted reply isn''t unread (v1 never counted it)', test.counts('A', 'L'));
  UPDATE public.chat_members SET last_read_id = test.mid('l5'), last_read_at = test.at(5)
   WHERE channel_id = test.ref('L') AND user_id = test.id('A');
  -- After l5: r1a, r1b, b1, q1, r1c, r1d (A's chain r1 has four of them), the v1 root and its reply.
  PERFORM test.ok(test.counts('A', 'L') = '8/0/4/1',
    'v1 replies: with its root unread, the converted reply is unread too', test.counts('A', 'L'));
END;
$$;

-- ── Who gets counts: no plan needed; nobody else's ─────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  UPDATE public.profiles SET plan_tier = 'free' WHERE id = test.id('O');
  PERFORM test.ok(test.counts('B', 'D') = '3/1/3/3',
    'paused: counts still answer when the plan doesn''t include chat', test.counts('B', 'D'));
  v := test.as_user('B', format($q$SELECT public.chat_op_mark_read(%L::uuid, %L::uuid)$q$, test.ref('D'), test.mid('d3')));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'D') = '0/0/0/0', 'paused: marking read still works', v);
  UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');

  PERFORM test.ok(test.value_as('X', format($q$SELECT count(*)::text FROM public.chat_unread_counts(%L)$q$, test.id('W'))) = '0',
    'outsider: no rows');
  PERFORM test.ok(test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_unread_counts(%L) WHERE channel_id = %L$q$,
      test.id('W'), test.ref('D'))) = '0',
    'counts: only your own conversations (C gets nothing for A and B''s direct message)');
  v := test.as_key('K', format($q$SELECT * FROM public.chat_unread_counts(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE '42501 %', 'a key: refused (counts are people''s)', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_leave(%L)$q$, test.ref('L')));
  PERFORM test.ok(v = 'ok 1' AND test.counts('B', 'L') = 'none', 'left: a conversation you left has no counts', v);
END;
$$;
