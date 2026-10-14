-- Chat v2 · converting live v1 data (CV-1: supabase/migrations/…_chat_v2_foundation.sql
-- defines chat__convert_v1, …_chat_v2_convert_v1.sql runs it). Proves AC13.1–13.7.
--
-- Cast: O owns workspace W; A, B and C are members. The fixture is v1 data as v1
-- left it (written with triggers off, format_version 1):
--   G  "general"          A, B, C
--   E  "every-message"    A (Mentions), B and C (Every message); every v1 body of
--                         spike 4's hand fixture (68), an app's post, @channel
--   R  "old-stuff"        archived; B on Every message
--   T  "threads"          a root by A at 10:00, replies by B (10:05) and C (10:10),
--                         a top-level message by A (10:20); B read up to 10:02,
--                         C up to 09:00, A up to 10:30
--   P  "secret"           private; A on Every message, B on Mentions
--   D  direct message A + B, both on Every message
--   S  C's notes to self: two messages and a deleted one
--   S0 B's notes to self, empty
--   X  a direct message A + C where only A is left (not notes to self)
-- plus three of the bell's v1 rows. The conversion runs for W only, twice.

-- fixture:begin
SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'C']) AS n;
INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W'), test.id('O'), 'Conversion fixture');
INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT test.id('W'), test.id(n), 'member' FROM unnest(ARRAY['A', 'B', 'C']) AS n
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE TABLE test.v1_pairs (fid text PRIMARY KEY, v1 text NOT NULL, v2 text NOT NULL);
INSERT INTO test.v1_pairs (fid, v1, v2) VALUES
  ('f01', 'Hey <@11111111-1111-4111-8111-111111111111> look', 'Hey moduo://person/11111111-1111-4111-8111-111111111111 look'),
  ('f02', '<@ABCDEF12-1111-4111-8111-111111111111>', 'moduo://person/abcdef12-1111-4111-8111-111111111111'),
  ('f03', '<!channel> standup moves', '@channel standup moves'),
  ('f04', 'hi<!channel>s', 'hi @channel s'),
  ('f05', 'Tracking <moduo:task:d037b0b7-4125-415d-bef9-72662d6b58e6|Ship the onboarding checklist>', 'Tracking moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6'),
  ('f06', '<moduo:note:d037b0b7-4125-415d-bef9-72662d6b58e6|a *b* `c` [d](e)>', 'moduo://note/d037b0b7-4125-415d-bef9-72662d6b58e6'),
  ('f07', 'Do we keep the _Friday_ demo?', 'Do we keep the *Friday* demo?'),
  ('f08', 'my_var_name and _x_y', 'my_var_name and _x_y'),
  ('f09', '*_x_*', '*x*'),
  ('f10', '** a ** b', ' **a**  b'),
  ('f11', '**_both_**', '***both***'),
  ('f12', '`<@11111111-1111-4111-8111-111111111111>` and `_x_`', '`<@11111111-1111-4111-8111-111111111111>` and `_x_`'),
  ('f13', '```
<!channel> _x_ **y**
```', '```
<!channel> _x_ **y**
```'),
  ('f14', 'see ```code``` here', 'see

```
code
```

 here'),
  ('f15', '```js
const a = 1;
```', '```js
const a = 1;
```'),
  ('f16', '2*3*4 = 24 and 5 * 3', '2\*3\*4 = 24 and 5 \* 3'),
  ('f17', 'a `` b', 'a \`\` b'),
  ('f18', '~5 min ~~ maybe', '\~5 min \~\~ maybe'),
  ('f19', 'C:\Users\me and \*', 'C:\\Users\\me and \\\*'),
  ('f20', 'moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6', 'moduo\://task/d037b0b7-4125-415d-bef9-72662d6b58e6'),
  ('f21', 'https://x.com/a_b_*c*', '[https://x.com/a_b_\*c\*](https://x.com/a_b_*c*)'),
  ('f22', 'Plan:
- one
- two', 'Plan:
- one
- two'),
  ('f23', '1. first
2. second', '1. first
2. second'),
  ('f24', '[docs](https://moduo.app)', '[docs](https://moduo.app)'),
  ('f25', '> quoted _it_
reply', '> quoted *it*
reply'),
  ('f26', 'nice :tada: at 10:30:45', 'nice :tada: at 10:30:45'),
  ('f27', '**Hey** <@11111111-1111-4111-8111-111111111111>, see <moduo:task:d037b0b7-4125-415d-bef9-72662d6b58e6|X> by _Friday_ ~~not~~ `now` https://moduo.app.', '**Hey** moduo://person/11111111-1111-4111-8111-111111111111, see moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6 by *Friday* ~~not~~ `now` https://moduo.app.'),
  ('f28', '_a
b_', '_a
b_'),
  ('f29', '~~a~~b~~c~~', '~~a~~b~~c~~'),
  ('f30', '# Title', '# Title'),
  ('f31', '_a*b_', '*a\*b*'),
  ('f32', 'Zażółć _gęślą_ **jaźń**', 'Zażółć *gęślą* **jaźń**'),
  ('f33', '  
', '  
'),
  ('f34', 'a <b> c <@not-a-uuid>', 'a <b> c <@not-a-uuid>'),
  ('f35', '```
never closed', '\`\`\`
never closed'),
  ('f36', '**run `make`**', '**run `make`**'),
  ('f37', '**open', '\*\*open'),
  ('f38', '**a**_b_', '**a***b*'),
  ('f39', '_a_**b**', '*a***b**'),
  ('f40', '**<!channel>** now', '**@channel** now'),
  ('f41', 'a
```
x
```
b', 'a

```
x
```

b'),
  ('f42', '*a* and *b c*', '*a* and *b c*'),
  ('f43', '~~ gone ~~ here', ' ~~gone~~  here'),
  ('f44', 'see <moduo:bucket:5abe4f3d-8b6c-4d7e-8fc0-6b7c8d9eafb0|Acme>!', 'see moduo://bucket/5abe4f3d-8b6c-4d7e-8fc0-6b7c8d9eafb0!'),
  ('f45', '> line one
> <!channel> line two', '> line one
> @channel line two'),
  ('f46', '```spacing: 12px
radius: 8px```', '```
spacing: 12px
radius: 8px
```'),
  ('f47', '```js 
x```', '```js
x
```'),
  ('f48', 'text ```a``` and ```b``` end', 'text

```
a
```

 and

```
b
```

 end'),
  ('f49', '**bold _and italic <@11111111-1111-4111-8111-111111111111>_**', '**bold *and italic moduo://person/11111111-1111-4111-8111-111111111111***'),
  ('f50', 'ping <!channel>, <!channel>!', 'ping @channel, @channel!'),
  ('f51', '**C:\Users\**', '**C:\\Users\\**'),
  ('f52', '_a\_', '*a\\*'),
  ('f53', '~~a\~~', '~~a\\~~'),
  ('f54', '**\**', '**\\**'),
  ('f55', '*a\*', '*a\\*'),
  ('f56', '`a``b`', '`ab`'),
  ('f57', '` a `', '`  a  `'),
  ('f58', '  > x', '  \> x'),
  ('f59', 'see https://x.com/a_ ok', 'see [https://x.com/a_](https://x.com/a_) ok'),
  ('f60', 'go https://x.com/a} ok', 'go [https://x.com/a}](https://x.com/a}) ok'),
  ('f61', 'xhttps://x.com/a', 'x[https://x.com/a](https://x.com/a)'),
  ('f62', 'https://en.wikipedia.org/wiki/Mars_(planet)', '[https://en.wikipedia.org/wiki/Mars_(planet](https://en.wikipedia.org/wiki/Mars_\(planet))'),
  ('f63', 'see https://x.com/[a] ok', 'see [https://x.com/\[a](https://x.com/[a)] ok'),
  ('f64', 'a
  > b', 'a
  \> b'),
  ('f65', '**bold https://x.com/a* x**', '**bold [https://x.com/a\*](https://x.com/a*) x**'),
  ('f66', 'hey**<!channel>**', 'hey **@channel**'),
  ('f67', 'a~~<!channel> now~~', 'a ~~@channel now~~'),
  ('f68', 'see https://x.com/?r=moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6 ok', 'see https://x.com/?r=moduo\://task/d037b0b7-4125-415d-bef9-72662d6b58e6 ok')
;

-- v1's rows, exactly as v1 wrote them: no trigger, no guard.
SET LOCAL session_replication_role = replica;

INSERT INTO public.chat_channels (id, workspace_id, kind, name, is_private, dm_key, created_at, archived_at)
VALUES
  (test.id('G'),  test.id('W'), 'channel', 'general',       false, NULL, '2026-01-01 09:00Z', NULL),
  (test.id('E'),  test.id('W'), 'channel', 'every-message', false, NULL, '2026-01-02 09:00Z', NULL),
  (test.id('R'),  test.id('W'), 'channel', 'old-stuff',     false, NULL, '2026-01-03 09:00Z', '2026-02-01 09:00Z'),
  (test.id('T'),  test.id('W'), 'channel', 'threads',       false, NULL, '2026-01-04 09:00Z', NULL),
  (test.id('P'),  test.id('W'), 'channel', 'secret',        true,  NULL, '2026-01-05 09:00Z', NULL),
  (test.id('D'),  test.id('W'), 'dm', NULL, true, test.id('A')::text || ',' || test.id('B')::text, '2026-01-06 09:00Z', NULL),
  (test.id('S'),  test.id('W'), 'dm', NULL, true, test.id('C')::text, '2026-01-07 09:00Z', NULL),
  (test.id('S0'), test.id('W'), 'dm', NULL, true, test.id('B')::text, '2026-01-08 09:00Z', NULL),
  (test.id('X'),  test.id('W'), 'dm', NULL, true, test.id('A')::text || ',' || test.id('C')::text, '2026-01-09 09:00Z', NULL);

INSERT INTO public.chat_members (channel_id, user_id, workspace_id, notify_level, last_read_at, joined_at)
SELECT test.id(c), test.id(u), test.id('W'), lvl, coalesce(rd, '2026-06-01 00:00Z'), '2026-01-01 00:00Z'
FROM (VALUES
  ('G', 'A', 'mentions', NULL::timestamptz), ('G', 'B', 'mentions', NULL), ('G', 'C', 'mentions', NULL),
  ('E', 'A', 'mentions', NULL), ('E', 'B', 'all', NULL), ('E', 'C', 'all', NULL),
  ('R', 'B', 'all', NULL),
  ('T', 'A', 'mentions', '2026-04-01 10:30Z'), ('T', 'B', 'mentions', '2026-04-01 10:02Z'),
  ('T', 'C', 'mentions', '2026-04-01 09:00Z'),
  ('P', 'A', 'all', NULL), ('P', 'B', 'mentions', NULL),
  ('D', 'A', 'all', NULL), ('D', 'B', 'all', NULL),
  ('S', 'C', 'all', NULL),
  ('S0', 'B', 'all', NULL),
  ('X', 'A', 'all', NULL)
) AS f(c, u, lvl, rd);

-- E: every hand-made v1 body, one a second, by A; @channel; an app's post.
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, created_at)
SELECT test.id('msg:' || p.fid), test.id('W'), test.id('E'), test.id('A'), p.v1,
       '2026-02-01 09:00Z'::timestamptz + (row_number() OVER (ORDER BY p.fid)) * interval '1 second'
FROM test.v1_pairs p;
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, author_kind, author_label, body, created_at)
VALUES (test.id('msg:app'), test.id('W'), test.id('E'), NULL, 'api_key', 'Claude Desktop',
        'Deployed <moduo:task:d037b0b7-4125-415d-bef9-72662d6b58e6|Ship it> for <@' || test.id('B') || '>',
        '2026-02-02 09:00Z');

-- T: a thread.
INSERT INTO public.chat_messages (id, workspace_id, channel_id, parent_id, author_id, body, created_at,
                                  reply_count, last_reply_at)
VALUES
  (test.id('t:root'), test.id('W'), test.id('T'), NULL, test.id('A'), 'Which _empty state_ first?',
   '2026-04-01 10:00Z', 2, '2026-04-01 10:10Z'),
  (test.id('t:r1'), test.id('W'), test.id('T'), test.id('t:root'), test.id('B'), 'Tasks, <@' || test.id('C') || '>',
   '2026-04-01 10:05Z', 0, NULL),
  (test.id('t:r2'), test.id('W'), test.id('T'), test.id('t:root'), test.id('C'), 'Agreed',
   '2026-04-01 10:10Z', 0, NULL),
  (test.id('t:top'), test.id('W'), test.id('T'), NULL, test.id('A'), 'Shipping **today**',
   '2026-04-01 10:20Z', 0, NULL);

-- P, D, X: one message each.
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, created_at) VALUES
  (test.id('p:1'), test.id('W'), test.id('P'), test.id('A'), 'Budget <moduo:note:' || test.id('N') || '|Q3 budget>', '2026-03-01 09:00Z'),
  (test.id('d:1'), test.id('W'), test.id('D'), test.id('A'), 'psst <@' || test.id('B') || '>', '2026-03-01 09:00Z'),
  (test.id('x:1'), test.id('W'), test.id('X'), test.id('A'), 'still here', '2026-03-01 09:00Z');

-- S: C's notes to self (the deleted one stays out of the note).
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body, created_at, deleted_at) VALUES
  (test.id('s:1'), test.id('W'), test.id('S'), test.id('C'), 'Buy milk _today_', '2026-03-01 08:00Z', NULL),
  (test.id('s:2'), test.id('W'), test.id('S'), test.id('C'),
   '<moduo:task:d037b0b7-4125-415d-bef9-72662d6b58e6|Secret title> follow up', '2026-03-01 08:30Z', NULL),
  (test.id('s:3'), test.id('W'), test.id('S'), test.id('C'), 'gone', '2026-03-01 09:00Z', '2026-03-01 09:01Z');

-- The bell's v1 rows (excerpts as v1 wrote them).
INSERT INTO public.module_activity (id, workspace_id, module, entity_type, entity_id, op, actor_type, actor_id, payload)
VALUES
  (test.id('bell:1'), test.id('W'), 'chat', 'chat_channel', test.id('E'), 'chat.mention', 'user', test.id('A'),
   jsonb_build_object('excerpt', 'Hey <@' || test.id('B') || '> look _now_', 'message_id', test.id('msg:f01'),
                      'notify_user_ids', jsonb_build_array(test.id('B')))),
  (test.id('bell:2'), test.id('W'), 'chat', 'chat_channel', test.id('T'), 'chat.reply', 'user', test.id('B'),
   jsonb_build_object('excerpt', 'Agreed, cut it to one line.', 'message_id', test.id('t:r1'))),
  (test.id('bell:3'), test.id('W'), 'chat', 'chat_channel', test.id('T'), 'chat.reply', 'user', test.id('C'),
   jsonb_build_object('excerpt', '_only italic_', 'message_id', test.id('t:r2')));

SET LOCAL session_replication_role = origin;
-- fixture:end

-- v1's unread counts per membership of T, before the conversion: top-level only,
-- after last_read_at, not your own.
CREATE TABLE test.v1_unread AS
SELECT cm.user_id,
       (SELECT count(*) FROM public.chat_messages m
         WHERE m.channel_id = cm.channel_id AND m.parent_id IS NULL AND m.deleted_at IS NULL
           AND m.created_at > cm.last_read_at AND m.author_id IS DISTINCT FROM cm.user_id)::int AS unread
FROM public.chat_members cm WHERE cm.channel_id = test.id('T');

-- What every row looked like before, to see a second run change nothing.
CREATE FUNCTION test.row_versions() RETURNS TABLE (t text, k text, v text) LANGUAGE sql AS $$
  SELECT 'messages', id::text, ctid::text FROM public.chat_messages WHERE workspace_id = test.id('W')
  UNION ALL SELECT 'channels', id::text, ctid::text FROM public.chat_channels WHERE workspace_id = test.id('W')
  UNION ALL SELECT 'members', channel_id::text || user_id::text, ctid::text FROM public.chat_members WHERE workspace_id = test.id('W')
  UNION ALL SELECT 'catchup', id::text, ctid::text FROM public.chat_catchup WHERE workspace_id = test.id('W')
  UNION ALL SELECT 'notes', id::text, ctid::text FROM public.notes WHERE workspace_id = test.id('W')
  UNION ALL SELECT 'entities', entity_type || entity_id::text, ctid::text FROM public.entities WHERE workspace_id = test.id('W')
  UNION ALL SELECT 'grants', id::text, ctid::text FROM public.resource_grants WHERE workspace_id = test.id('W')
  UNION ALL SELECT 'activity', id::text, ctid::text FROM public.module_activity WHERE workspace_id = test.id('W')
$$;

DO $$
DECLARE
  v jsonb;
  v_again jsonb;
  v_note public.notes;
  v_bad text;
BEGIN
  -- ── The converter, pair by pair (spike 4's hand fixture) ──
  SELECT string_agg(fid, ', ') INTO v_bad FROM test.v1_pairs WHERE public.chat__v1_to_v2(v1) IS DISTINCT FROM v2;
  PERFORM test.ok(v_bad IS NULL, 'converter: all 68 hand-made v1 bodies give spike 4''s v2 text', v_bad);

  PERFORM test.ok((SELECT count(*) FROM public.chat_messages WHERE workspace_id = test.id('W') AND format_version = 1) = 79,
    'setup: 79 v1 messages in W, all format_version 1');

  v := public.chat__convert_v1(test.id('W'));
  PERFORM test.ok(v = jsonb_build_object(
      'bodies', 79, 'replies_flagged', 2, 'self_dms_closed', 2, 'notes_written', 1,
      'levels_reset', 4, 'level_reset_lines', 3, 'general_flagged', 1, 'read_marks', 11,
      'registered', 7, 'excerpts', 3),
    'convert: each step changed what it should', v::text);

  -- ── AC13.1 bodies ──
  SELECT string_agg(p.fid, ', ') INTO v_bad
    FROM test.v1_pairs p JOIN public.chat_messages m ON m.id = test.id('msg:' || p.fid)
   WHERE m.body IS DISTINCT FROM p.v2 OR m.format_version <> 2;
  PERFORM test.ok(v_bad IS NULL, 'AC13.1: every v1 token converts: the stored bodies are the v2 text', v_bad);
  PERFORM test.ok((SELECT count(*) FROM public.chat_messages WHERE workspace_id = test.id('W') AND format_version = 1) = 0,
    'AC13.1: nothing is left in the v1 form');
  PERFORM test.ok(
    (SELECT body FROM public.chat_messages WHERE id = test.id('msg:app'))
      = 'Deployed moduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6 for moduo://person/' || test.id('B')
    AND (SELECT author_id IS NULL AND author_kind = 'api_key' AND author_label = 'Claude Desktop'
           FROM public.chat_messages WHERE id = test.id('msg:app')),
    'AC13.1: an app''s post converts and keeps its null author ("<key name> (app)")');
  PERFORM test.ok(
    (SELECT body_text FROM public.chat_messages WHERE id = test.id('msg:f05')) = 'Tracking'
    AND (SELECT body_text FROM public.chat_messages WHERE id = test.id('msg:app')) = 'Deployed  for',
    'AC13.1: body_text keeps the words, never a title or an id', (SELECT body_text FROM public.chat_messages WHERE id = test.id('msg:app')));
  PERFORM test.ok(
    (SELECT mentions_everyone FROM public.chat_messages WHERE id = test.id('msg:f03'))
    AND NOT (SELECT mentions_everyone FROM public.chat_messages WHERE id = test.id('msg:f01')),
    'AC13.1: a v1 @channel is flagged mentions_everyone');
  PERFORM test.ok(
    (SELECT search_tsv @@ to_tsquery('simple', 'friday') FROM public.chat_messages WHERE id = test.id('msg:f07')),
    'AC13.1: converted text is searchable');

  -- ── AC13.2 threads ──
  PERFORM test.ok(
    (SELECT bool_and(v1_thread_reply) FROM public.chat_messages WHERE parent_id = test.id('t:root'))
    AND NOT (SELECT bool_or(v1_thread_reply) FROM public.chat_messages WHERE workspace_id = test.id('W') AND parent_id IS NULL)
    AND (SELECT count(*) FROM public.chat_messages WHERE parent_id = test.id('t:root') AND reply_to_id IS NULL) = 2,
    'AC13.2: v1 replies are flagged (and quote nothing); top-level messages aren''t');
  PERFORM test.ok(
    (SELECT last_read_id FROM public.chat_members WHERE channel_id = test.id('T') AND user_id = test.id('B')) = test.id('t:root')
    AND (SELECT last_read_id FROM public.chat_members WHERE channel_id = test.id('T') AND user_id = test.id('A')) = test.id('t:top')
    AND (SELECT last_read_id FROM public.chat_members WHERE channel_id = test.id('T') AND user_id = test.id('C')) IS NULL,
    'AC13.2: the read mark is the newest message at or before last_read_at');
  -- v2's count: every message after the mark (replies too), not your own, except a
  -- converted reply whose root you had read.
  PERFORM test.ok(NOT EXISTS (
    SELECT 1 FROM test.v1_unread u
      JOIN public.chat_members cm ON cm.channel_id = test.id('T') AND cm.user_id = u.user_id
      LEFT JOIN public.chat_messages mk ON mk.id = cm.last_read_id
     WHERE u.unread + (
             SELECT count(*) FROM public.chat_messages m
              JOIN public.chat_messages root ON root.id = m.parent_id
             WHERE m.channel_id = cm.channel_id AND m.v1_thread_reply AND m.deleted_at IS NULL
               AND m.author_id IS DISTINCT FROM cm.user_id
               AND (mk.id IS NULL OR (root.created_at, root.id) > (mk.created_at, mk.id)))
        <> (SELECT count(*) FROM public.chat_messages m
             LEFT JOIN public.chat_messages root ON root.id = m.parent_id
             WHERE m.channel_id = cm.channel_id AND m.deleted_at IS NULL
               AND m.author_id IS DISTINCT FROM cm.user_id
               AND (mk.id IS NULL OR (m.created_at, m.id) > (mk.created_at, mk.id))
               AND NOT (m.v1_thread_reply AND mk.id IS NOT NULL
                        AND (root.created_at, root.id) <= (mk.created_at, mk.id)))),
    'AC13.2: unread counts are v1''s plus only the replies whose root was unread');
  PERFORM test.ok(
    (SELECT unread FROM test.v1_unread WHERE user_id = test.id('B')) = 1
    AND (SELECT unread FROM test.v1_unread WHERE user_id = test.id('C')) = 2,
    'setup: B had 1 unread in T (read the root), C had 2 (read nothing)');

  -- ── AC13.3 notes to self ──
  SELECT * INTO v_note FROM public.notes WHERE workspace_id = test.id('W');
  PERFORM test.ok(
    (SELECT count(*) FROM public.notes WHERE workspace_id = test.id('W')) = 1
    AND v_note.title = 'Notes to self (from Chat)' AND v_note.created_by = test.id('C')
    AND v_note.in_inbox AND v_note.parent_id IS NULL AND v_note.deleted_at IS NULL,
    'AC13.3: C''s notes to self become one note, C''s, in C''s Inbox');
  PERFORM test.ok(
    v_note.body_md = E'**2026-03-01 08:00 UTC**\nBuy milk *today*\n\n**2026-03-01 08:30 UTC**\nmoduo://task/d037b0b7-4125-415d-bef9-72662d6b58e6 follow up',
    'AC13.3: every message, in order, with its time; the deleted one and the title stay out', v_note.body_md);
  PERFORM test.ok(
    public.can_access('note', v_note.id, 'view', test.id('C'))
    AND NOT public.can_access('note', v_note.id, 'view', test.id('A'))
    AND NOT public.can_access('note', v_note.id, 'view', test.id('O'))
    AND NOT EXISTS (SELECT 1 FROM public.resource_grants WHERE resource_type = 'note' AND resource_id = v_note.id),
    'AC13.3: the note is private: C reads it, A and the owner don''t');
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.entities WHERE entity_type = 'note' AND entity_id = v_note.id
                            AND label = 'Notes to self (from Chat)'),
    'AC13.3: the note is in the registry');
  PERFORM test.ok(
    (SELECT deleted_at IS NOT NULL AND deleted_by = test.id('C') FROM public.chat_channels WHERE id = test.id('S'))
    AND (SELECT deleted_at IS NOT NULL AND deleted_by = test.id('B') FROM public.chat_channels WHERE id = test.id('S0'))
    AND test.value_as('C', format($q$SELECT count(*)::text FROM public.chat_channels WHERE id = %L$q$, test.id('S'))) = '0',
    'AC13.3: the notes-to-self conversations are gone (an empty one makes no note)');
  PERFORM test.ok(
    (SELECT deleted_at IS NULL FROM public.chat_channels WHERE id = test.id('X'))
    AND (SELECT body FROM public.chat_messages WHERE id = test.id('x:1')) = 'still here',
    'AC13.3: a direct message whose other person left is not notes to self');

  -- ── AC13.4 levels ──
  PERFORM test.ok(
    (SELECT string_agg(c || ':' || u || '=' || notify_level, ' ' ORDER BY c, u) FROM (
       SELECT CASE cm.channel_id WHEN test.id('E') THEN 'E' WHEN test.id('R') THEN 'R' WHEN test.id('P') THEN 'P'
                                 WHEN test.id('D') THEN 'D' WHEN test.id('X') THEN 'X' WHEN test.id('G') THEN 'G' END AS c,
              CASE cm.user_id WHEN test.id('A') THEN 'A' WHEN test.id('B') THEN 'B' WHEN test.id('C') THEN 'C' END AS u,
              cm.notify_level
         FROM public.chat_members cm
        WHERE cm.channel_id IN (test.id('E'), test.id('R'), test.id('P'), test.id('D'), test.id('X'))) s)
    = 'D:A=all D:B=all E:A=mentions E:B=mentions E:C=mentions P:A=mentions P:B=mentions R:B=mentions X:A=all',
    'AC13.4: channels go to Mentions and replies; direct messages keep notifying');
  PERFORM test.ok(
    (SELECT string_agg(x, ' ' ORDER BY x) FROM (
       SELECT CASE channel_id WHEN test.id('E') THEN 'E' WHEN test.id('P') THEN 'P' ELSE '?' END || ':'
              || CASE user_id WHEN test.id('A') THEN 'A' WHEN test.id('B') THEN 'B' WHEN test.id('C') THEN 'C' END AS x
         FROM public.chat_catchup WHERE workspace_id = test.id('W') AND reason = 'level_reset'
          AND done_at IS NULL AND message_id IS NULL) s)
    = 'E:B E:C P:A',
    'AC13.4: one quiet Catch up line per person and conversation reset (none for the archived one)');

  -- ── AC13.5 slugs ──
  PERFORM test.ok(
    (SELECT string_agg(name, ',' ORDER BY name) FROM public.chat_channels WHERE workspace_id = test.id('W') AND kind = 'channel')
    = 'every-message,general,old-stuff,secret,threads',
    'AC13.5: channel names are kept as they were');

  -- ── AC13.6 General ──
  PERFORM test.ok(
    (SELECT is_default FROM public.chat_channels WHERE id = test.id('G'))
    AND (SELECT count(*) FROM public.chat_channels WHERE workspace_id = test.id('W') AND is_default) = 1
    AND (SELECT count(*) FROM public.chat_members WHERE channel_id = test.id('G')) = 3,
    'AC13.6: General is flagged and nobody is added (the owner, not in it, still isn''t)');

  -- Every live conversation is registered; a DM without a label.
  PERFORM test.ok(
    (SELECT count(*) FROM public.entities WHERE workspace_id = test.id('W') AND entity_type = 'chat_channel') = 7
    AND (SELECT label FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = test.id('E')) = 'every-message'
    AND (SELECT label FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = test.id('D')) = ''
    AND NOT EXISTS (SELECT 1 FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = test.id('S')),
    'convert: every live conversation is in the registry (DMs unlabelled, deleted ones not)');
  PERFORM test.ok(
    test.value_as('C', format($q$SELECT count(*)::text FROM public.entities WHERE entity_type = 'chat_channel' AND entity_id = %L$q$,
      test.id('P'))) = '0',
    'convert: the registry row of a private conversation is not readable by someone outside it');

  -- ── AC13.7 bell excerpts ──
  PERFORM test.ok(
    (SELECT payload ->> 'excerpt' FROM public.module_activity WHERE id = test.id('bell:1'))
      = 'Hey moduo://person/' || test.id('B') || ' look *now*'
    AND (SELECT payload ->> 'excerpt' FROM public.module_activity WHERE id = test.id('bell:2')) = 'Agreed, cut it to one line.'
    AND (SELECT payload ->> 'excerpt' FROM public.module_activity WHERE id = test.id('bell:3')) = '_only italic_'
    AND (SELECT bool_and(payload ->> 'format_version' = '2') FROM public.module_activity
          WHERE workspace_id = test.id('W') AND op IN ('chat.mention', 'chat.reply')),
    'AC13.7: an excerpt with v1 tokens is rewritten; a plain-text one keeps its text; all are marked');

  -- ── Twice: a second run changes nothing ──
  CREATE TEMP TABLE before_rerun ON COMMIT DROP AS SELECT * FROM test.row_versions();
  v_again := public.chat__convert_v1(test.id('W'));
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM jsonb_each_text(v_again) WHERE value <> '0'),
    'convert again: every step finds nothing to do', v_again::text);
  PERFORM test.ok(
    NOT EXISTS (SELECT * FROM test.row_versions() EXCEPT SELECT * FROM before_rerun)
    AND NOT EXISTS (SELECT * FROM before_rerun EXCEPT SELECT * FROM test.row_versions()),
    'convert again: zero rows change (no row of W has a new version)');
END;
$$;

-- ── What the converter can't carry is refused before anything changes ──
DO $$
DECLARE
  v_msg text;
BEGIN
  INSERT INTO public.workspaces (id, owner_id, name) VALUES (test.id('W2'), test.id('O'), 'Refusals');
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.chat_channels (id, workspace_id, kind, name) VALUES (test.id('W2:c'), test.id('W2'), 'channel', 'odd');
  INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body) VALUES
    (test.id('W2:m1'), test.id('W2'), test.id('W2:c'), test.id('A'), 'a' || chr(1) || 'b');
  SET LOCAL session_replication_role = origin;
  BEGIN
    PERFORM public.chat__convert_v1(test.id('W2'));
    v_msg := 'converted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  PERFORM test.ok(v_msg LIKE '%U+0001 or U+0002%', 'refuse: a v1 body holding the converter''s marker', v_msg);

  UPDATE public.chat_messages SET body = repeat('<@' || test.id('B')::text || '> ', 200), format_version = 1
   WHERE id = test.id('W2:m1');
  BEGIN
    PERFORM public.chat__convert_v1(test.id('W2'));
    v_msg := 'converted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  PERFORM test.ok(v_msg LIKE '%1 v1 message(s) would be longer than 8,000 characters%'
                  AND (SELECT format_version FROM public.chat_messages WHERE id = test.id('W2:m1')) = 1,
    'refuse: a body that would grow past 8,000 characters, leaving it as it was', v_msg);
END;
$$;

-- ── It runs before the v2 ops, never after: v2 data stops it ────────────────
DO $$
DECLARE
  v_msg text;
BEGIN
  UPDATE public.chat_messages SET body = 'fine', format_version = 1 WHERE id = test.id('W2:m1');
  INSERT INTO public.chat_chain_mutes (user_id, root_id, workspace_id) VALUES (test.id('A'), test.id('W2:m1'), test.id('W2'));
  BEGIN
    PERFORM public.chat__convert_v1(test.id('W2'));
    v_msg := 'converted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  PERFORM test.ok(v_msg LIKE '%v2 data is already here%'
                  AND (SELECT format_version FROM public.chat_messages WHERE id = test.id('W2:m1')) = 1,
    'refuse: a row only a v2 op writes (a chain mute) stops the conversion', v_msg);
  DELETE FROM public.chat_chain_mutes WHERE workspace_id = test.id('W2');

  ALTER TABLE public.chat_messages ALTER COLUMN format_version SET DEFAULT 2;
  BEGIN
    PERFORM public.chat__convert_v1(test.id('W2'));
    v_msg := 'converted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  ALTER TABLE public.chat_messages ALTER COLUMN format_version SET DEFAULT 1;
  PERFORM test.ok(v_msg LIKE '%v2 data is already here%',
    'refuse: once the v2 ops are in (format_version defaults to 2)', v_msg);
  PERFORM test.ok(public.chat__convert_v1(test.id('W2')) ->> 'bodies' = '1',
    'refuse: with neither, it converts');
END;
$$;
