-- Chat v2 · CV-20 "custom emoji rules" (AC4.8; supabase/migrations/
-- …_chat_v2_custom_emoji.sql). Names (2–32 of a–z 0–9 - _, a letter, never a
-- standard shortcode, unique among live ones), PNG/GIF/WebP only (never SVG),
-- images only under a slot the server minted for that uploader in that
-- workspace (never someone else's, never changed or deleted), the type naming
-- the extension, 256 KB, 128 px, both images uploaded, 500 per workspace, the "Add custom emoji" switch, the plan; removal is a soft
-- delete by the adder or an admin; a `:name:` reacts only while live in that
-- workspace (chat and comments); members read the rows and images, nobody
-- else; a key does nothing; erasure keeps the emoji and forgets the adder.
--
-- Cast: O owns W (Duo). A and B are members, M an admin, V a viewer, X in no
-- workspace. F owns W2 on the free plan with A as a member. K is A's API key.

SELECT test.person(n) FROM unnest(ARRAY['O', 'A', 'B', 'M', 'V', 'X', 'F']) AS n;
UPDATE public.profiles SET plan_tier = 'duo' WHERE id = test.id('O');
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('O'), 'Emoji'),
  (test.id('W2'), test.id('F'), 'Free');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('A'), 'member'),
  (test.id('W'), test.id('B'), 'member'),
  (test.id('W'), test.id('M'), 'admin'),
  (test.id('W'), test.id('V'), 'viewer'),
  (test.id('W2'), test.id('A'), 'member')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES (test.id('K'), test.id('W'), 'Agent', 'mdo_test', md5('db-test-key-cv20'),
        '{"chat": "edit", "tasks": "edit"}'::jsonb, test.id('A'));
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system, position) VALUES
  (test.id('SB'), test.id('W'), test.id('O'), 'Shared', false, '0001');

CREATE TABLE test.ids (name text PRIMARY KEY, id uuid NOT NULL);
CREATE FUNCTION test.ref(p_name text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM test.ids WHERE name = p_name
$$;
-- An upload slot the server mints for someone (kept under a name).
CREATE FUNCTION test.slot(p_who text, p_key text, p_ws text DEFAULT 'W') RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text := test.value_as(p_who, format($q$SELECT public.chat_op_custom_emoji_begin(%L)::text$q$, test.id(p_ws)));
BEGIN
  IF v ~ '^[0-9a-f-]{36}$' THEN
    INSERT INTO test.ids VALUES (p_key, v::uuid) ON CONFLICT (name) DO UPDATE SET id = excluded.id;
    RETURN 'ok';
  END IF;
  RETURN v;
END;
$$;
CREATE FUNCTION test.path(p_ws text, p_key text, p_ext text DEFAULT 'png') RETURNS text LANGUAGE sql STABLE AS $$
  SELECT test.id(p_ws)::text || '/' || test.ref(p_key)::text || '.' || p_ext
$$;
CREATE FUNCTION test.poster(p_ws text, p_key text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT test.id(p_ws)::text || '/' || test.ref(p_key)::text || '.poster.png'
$$;
-- An upload through the bucket's rule, as a person.
CREATE FUNCTION test.upload(p_who text, p_name text, p_mime text DEFAULT 'image/png', p_size int DEFAULT 1000)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
       VALUES ('chat-emoji', %L, %L, %L, jsonb_build_object('mimetype', %L, 'size', %s))$q$,
    p_name, test.id(p_who), test.id(p_who)::text, p_mime, p_size))
$$;
-- A slot for p_who with both images in it, as after their browser's upload
-- (written directly, so the op's own checks are what's tested).
CREATE FUNCTION test.seed(p_who text, p_key text, p_ext text DEFAULT 'png', p_mime text DEFAULT 'image/png',
                          p_size int DEFAULT 1000, p_poster_mime text DEFAULT 'image/png',
                          p_owner text DEFAULT NULL, p_ws text DEFAULT 'W')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM test.slot(p_who, p_key, p_ws);
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES
    ('chat-emoji', test.path(p_ws, p_key, p_ext), test.id(coalesce(p_owner, p_who)),
     test.id(coalesce(p_owner, p_who))::text, jsonb_build_object('mimetype', p_mime, 'size', p_size)),
    ('chat-emoji', test.poster(p_ws, p_key), test.id(coalesce(p_owner, p_who)),
     test.id(coalesce(p_owner, p_who))::text, jsonb_build_object('mimetype', p_poster_mime, 'size', 500));
END;
$$;
CREATE FUNCTION test.add(p_who text, p_name text, p_key text, p_mime text DEFAULT 'image/png',
                         p_w int DEFAULT 64, p_bytes int DEFAULT 1000, p_animated boolean DEFAULT false)
RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format(
    $q$SELECT public.chat_op_custom_emoji_add(%L::uuid, %L, %L, %s, %s, %s, %L)$q$,
    test.ref(p_key), p_name, p_mime, p_w, p_w, p_bytes, p_animated))
$$;
CREATE FUNCTION test.emoji(p_name text) RETURNS public.chat_custom_emoji LANGUAGE sql VOLATILE AS $$
  SELECT * FROM public.chat_custom_emoji
   WHERE workspace_id = test.id('W') AND name = p_name ORDER BY created_at DESC LIMIT 1
$$;
CREATE FUNCTION test.remove(p_who text, p_name text) RETURNS text LANGUAGE sql AS $$
  SELECT test.as_user(p_who, format($q$SELECT public.chat_op_custom_emoji_remove(%L)$q$, (test.emoji(p_name)).id))
$$;

-- ── The switch ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok(
    (SELECT add_emoji FROM public.workspace_chat_caps WHERE workspace_id = test.id('W') AND role_key = 'admin')
    AND (SELECT add_emoji FROM public.workspace_chat_caps WHERE workspace_id = test.id('W') AND role_key = 'member')
    AND NOT (SELECT add_emoji FROM public.workspace_chat_caps WHERE workspace_id = test.id('W') AND role_key = 'viewer'),
    'switch: a new workspace has it on for admins and members, off for viewers');
  PERFORM test.ok(public.chat_has_cap(test.id('W'), test.id('A'), 'add_emoji')
              AND public.chat_has_cap(test.id('W'), test.id('O'), 'add_emoji')
              AND NOT public.chat_has_cap(test.id('W'), test.id('V'), 'add_emoji')
              AND NOT public.chat_has_cap(test.id('W'), test.id('X'), 'add_emoji'),
    'switch: the server reads it per role (the owner always)');
  v := test.as_user('A', format($q$SELECT public.chat_caps_get(%L)$q$, test.id('W')));
  PERFORM test.ok(test.value_as('A', format($q$SELECT (SELECT bool_and(c ? 'add_emoji') FROM jsonb_array_elements(public.chat_caps_get(%L)) c)::text$q$,
    test.id('W'))) = 'true', 'switch: chat_caps_get carries it (the role editor shows the row)');
  v := test.as_user('O', format($q$SELECT public.chat_caps_set(%L, 'viewer', '{"add_emoji": true}'::jsonb)$q$, test.id('W')));
  PERFORM test.ok(NOT (SELECT add_emoji FROM public.workspace_chat_caps WHERE workspace_id = test.id('W') AND role_key = 'viewer'),
    'switch: a viewer''s stays off', v);
  v := test.as_user('A', format($q$SELECT public.chat_caps_set(%L, 'member', '{"add_emoji": false}'::jsonb)$q$, test.id('W')));
  PERFORM test.ok(v LIKE '42501%', 'switch: a member can''t change it', v);
END;
$$;

-- ── Upload slots and the bucket's rules ──────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  PERFORM test.ok((SELECT NOT public AND file_size_limit = 262144
                          AND allowed_mime_types = ARRAY['image/png', 'image/gif', 'image/webp']
                     FROM storage.buckets WHERE id = 'chat-emoji'),
    'bucket: private, 256 KB, PNG GIF WebP only (no SVG)');
  v := test.slot('A', 'up1');
  PERFORM test.ok(v = 'ok', 'slot: a member gets a slot the server names', v);
  v := test.slot('V', 'vs');
  PERFORM test.ok(v = 'ERROR Your role can''t add custom emoji.', 'slot: a viewer gets none', v);
  v := test.slot('X', 'xs');
  PERFORM test.ok(v = 'ERROR You don''t have access to this workspace.', 'slot: an outsider gets none', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_custom_emoji_begin(%L)$q$, test.id('W')));
  PERFORM test.ok(v LIKE '42501%', 'slot: a key gets none', v);
  v := test.slot('A', 'fs', 'W2');
  PERFORM test.ok(v = 'ERROR Chat is available on the Duo and Team plans.', 'slot: not without chat on the plan', v);
  PERFORM test.ok(test.value_as('A', 'SELECT count(*)::text FROM public.chat_custom_emoji_uploads') LIKE 'ERROR%',
    'slot: nobody reads the slots (the server''s only)');

  v := test.upload('A', test.path('W', 'up1'));
  PERFORM test.ok(v = 'ok 1', 'bucket: a member uploads into their own slot', v);
  v := test.upload('A', test.poster('W', 'up1'));
  PERFORM test.ok(v = 'ok 1', 'bucket: and its still frame', v);
  v := test.upload('B', test.path('W', 'up1', 'gif'), 'image/gif');
  PERFORM test.ok(v NOT LIKE 'ok%', 'bucket: nobody uploads into someone else''s slot', v);
  INSERT INTO test.ids VALUES ('guess', gen_random_uuid());
  v := test.upload('A', test.path('W', 'guess'));
  PERFORM test.ok(v NOT LIKE 'ok%', 'bucket: nor under a name the server didn''t mint', v);
  v := test.upload('A', test.path('W2', 'up1'));
  PERFORM test.ok(v NOT LIKE 'ok%', 'bucket: nor with a slot in another workspace''s folder', v);
  PERFORM test.slot('A', 'svg');
  v := test.upload('A', test.id('W')::text || '/' || test.ref('svg')::text || '.svg', 'image/svg+xml');
  PERFORM test.ok(v NOT LIKE 'ok%', 'bucket: an .svg path is refused', v);
  v := test.upload('A', test.id('W')::text || '/../x.png');
  PERFORM test.ok(v NOT LIKE 'ok%', 'bucket: a path that isn''t <workspace>/<slot>.<ext> is refused', v);
  v := test.upload('A', 'not-a-uuid/' || test.ref('svg')::text || '.png');
  PERFORM test.ok(v NOT LIKE 'ok%' AND v NOT LIKE '22P02%', 'bucket: a stray folder is refused, not an error', v);
  -- Nobody changes or deletes an image (only insert and read rules).
  v := test.as_user('A', format($q$UPDATE storage.objects SET metadata = '{"mimetype": "image/png", "size": 1}'
      WHERE bucket_id = 'chat-emoji' AND name = %L$q$, test.path('W', 'up1')));
  PERFORM test.ok(v = 'ok 0', 'bucket: even the uploader can''t change an image', v);
  v := test.as_user('M', format($q$DELETE FROM storage.objects WHERE bucket_id = 'chat-emoji' AND name = %L$q$,
    test.path('W', 'up1')));
  PERFORM test.ok(v NOT LIKE 'ok 1', 'bucket: nor can an admin delete one', v);
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'chat-emoji' AND name = %L$q$, test.path('W', 'up1'))) = '1'
    AND test.value_as('V', format($q$SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'chat-emoji' AND name = %L$q$, test.path('W', 'up1'))) = '1',
    'bucket: everyone in the workspace sees the images (viewers too)');
  PERFORM test.ok(test.value_as('X', format($q$SELECT count(*)::text FROM storage.objects
      WHERE bucket_id = 'chat-emoji' AND name = %L$q$, test.path('W', 'up1'))) = '0',
    'bucket: nobody else does');
END;
$$;

-- ── Adding ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.add('A', 'shipit', 'up1');
  PERFORM test.ok(v = 'ok 1' AND (test.emoji('shipit')).created_by = test.id('A')
              AND (test.emoji('shipit')).deleted_at IS NULL
              AND (test.emoji('shipit')).storage_path = test.path('W', 'up1')
              AND (test.emoji('shipit')).poster_path = test.poster('W', 'up1'),
    'add: a member adds :shipit: from their slot (AC4.8); the adder is the session', v);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity WHERE workspace_id = test.id('W')
                           AND op = 'chat.emoji_add' AND entity_id = (test.emoji('shipit')).id),
    'add: it''s in the activity');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.chat_custom_emoji WHERE workspace_id = %L$q$, test.id('W'))) = '1'
              AND test.value_as('V', format($q$SELECT count(*)::text FROM public.chat_custom_emoji WHERE workspace_id = %L$q$, test.id('W'))) = '1'
              AND test.value_as('X', format($q$SELECT count(*)::text FROM public.chat_custom_emoji WHERE workspace_id = %L$q$, test.id('W'))) = '0',
    'read: everyone in the workspace reads the list; nobody else');
  v := test.add('A', 'again', 'up1');
  PERFORM test.ok(v = '22023 Upload the image first.', 'add: a used slot makes nothing more', v);
  v := test.upload('A', test.path('W', 'up1', 'gif'), 'image/gif');
  PERFORM test.ok(v NOT LIKE 'ok%', 'add: nor takes new uploads', v);
  PERFORM test.seed('B', 'dup');
  v := test.add('B', 'shipit', 'dup');
  PERFORM test.ok(v = '23505 There''s already an emoji called :shipit:.', 'add: names are unique among live emoji', v);

  -- Someone else's slot or images.
  PERFORM test.seed('A', 'mine');
  v := test.add('B', 'stolen', 'mine');
  PERFORM test.ok(v = '22023 Upload the image first.', 'squat: nobody makes an emoji from someone else''s slot', v);
  PERFORM test.seed('A', 'planted', 'png', 'image/png', 1000, 'image/png', 'B');
  v := test.add('A', 'planted', 'planted');
  PERFORM test.ok(v = '22023 Upload the image first.', 'squat: images someone else put in your slot are refused', v);
  PERFORM test.seed('A', 'old');
  UPDATE public.chat_custom_emoji_uploads SET created_at = now() - interval '2 hours' WHERE id = test.ref('old');
  v := test.add('A', 'stale', 'old');
  PERFORM test.ok(v = '22023 Upload the image first.', 'slot: one older than an hour is closed', v);

  -- Names.
  PERFORM test.seed('A', 'n1');
  v := test.add('A', 'a', 'n1');
  PERFORM test.ok(v LIKE '22023 A name is 2 to 32%', 'name: one character is refused', v);
  v := test.add('A', '12', 'n1');
  PERFORM test.ok(v LIKE '22023 A name is 2 to 32%', 'name: digits alone are refused', v);
  v := test.add('A', 'ship it', 'n1');
  PERFORM test.ok(v LIKE '22023 A name is 2 to 32%', 'name: a space is refused', v);
  v := test.add('A', 'a+b', 'n1');
  PERFORM test.ok(v LIKE '22023 A name is 2 to 32%', 'name: a + is refused', v);
  v := test.add('A', repeat('x', 33), 'n1');
  PERFORM test.ok(v LIKE '22023 A name is 2 to 32%', 'name: 33 characters is refused', v);
  v := test.add('A', 'thumbsup', 'n1');
  PERFORM test.ok(v = '22023 :thumbsup: is a standard emoji. Pick another name.', 'name: a standard shortcode is refused', v);
  v := test.add('A', 'tada', 'n1');
  PERFORM test.ok(v LIKE '22023 :tada: is a standard emoji%', 'name: another one too', v);
  v := test.add('A', ':LGTM:', 'n1');
  PERFORM test.ok(v = 'ok 1' AND (test.emoji('lgtm')).id IS NOT NULL, 'name: colons and capitals are tidied (:LGTM: → lgtm)', v);

  -- Types, sizes and the images.
  PERFORM test.seed('A', 's1', 'svg', 'image/svg+xml');
  v := test.add('A', 'vector', 's1', 'image/svg+xml');
  PERFORM test.ok(v = '22023 Use a PNG, GIF or WebP image.', 'type: SVG is refused', v);
  PERFORM test.seed('A', 'j1', 'jpg', 'image/jpeg');
  v := test.add('A', 'photo', 'j1', 'image/jpeg');
  PERFORM test.ok(v = '22023 Use a PNG, GIF or WebP image.', 'type: a JPEG is stored only as the PNG it''s turned into', v);
  PERFORM test.seed('A', 'g1', 'png');
  v := test.add('A', 'liar', 'g1', 'image/gif');
  PERFORM test.ok(v = '22023 Upload the image first.', 'type: the extension is the type''s (a .png isn''t a GIF)', v);
  PERFORM test.seed('A', 'g2', 'gif', 'image/svg+xml');
  v := test.add('A', 'sneaky', 'g2', 'image/gif');
  PERFORM test.ok(v = '22023 The uploaded image isn''t the one described.', 'type: the stored type must be the one claimed', v);
  PERFORM test.seed('A', 'b1', 'png', 'image/png', 262145);
  v := test.add('A', 'big', 'b1', 'image/png', 64, 262145);
  PERFORM test.ok(v = '22023 A custom emoji is at most 256 KB.', 'size: over 256 KB is refused', v);
  PERFORM test.seed('A', 'b2', 'png', 'image/png', 5000);
  v := test.add('A', 'fib', 'b2', 'image/png', 64, 1000);
  PERFORM test.ok(v = '22023 The uploaded image isn''t the one described.', 'size: the stored size must be the one claimed', v);
  PERFORM test.seed('A', 'h1');
  v := test.add('A', 'huge', 'h1', 'image/png', 129);
  PERFORM test.ok(v = '22023 A custom emoji is at most 128 by 128 pixels.', 'size: over 128 px is refused', v);
  PERFORM test.slot('A', 'empty');
  v := test.add('A', 'phantom', 'empty');
  PERFORM test.ok(v = '22023 Upload the image first.', 'images: nothing uploaded is refused', v);
  PERFORM test.slot('A', 'np');
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata)
  VALUES ('chat-emoji', test.path('W', 'np'), test.id('A'), test.id('A')::text, '{"mimetype": "image/png", "size": 1000}');
  v := test.add('A', 'noposter', 'np');
  PERFORM test.ok(v = '22023 Upload the image first.', 'images: the still frame must exist too', v);
  PERFORM test.seed('A', 'pp', 'gif', 'image/gif', 1000, 'image/gif');
  v := test.add('A', 'gifposter', 'pp', 'image/gif', 64, 1000, true);
  PERFORM test.ok(v = '22023 The still frame must be a PNG of at most 256 KB.', 'images: the still frame is a PNG', v);
  PERFORM test.seed('A', 'anim', 'gif', 'image/gif');
  v := test.add('A', 'party-moduo', 'anim', 'image/gif', 64, 1000, true);
  PERFORM test.ok(v = 'ok 1' AND (test.emoji('party-moduo')).animated, 'add: an animated GIF with its still frame', v);

  -- Who may add.
  PERFORM test.seed('A', 'w1');
  v := test.as_key('K', format($q$SELECT public.chat_op_custom_emoji_add(%L, 'keyed', 'image/png', 64, 64, 1000, false)$q$,
    test.ref('w1')));
  PERFORM test.ok(v NOT LIKE 'ok%', 'who: a key can''t', v);
  PERFORM test.seed('B', 'sw');
  UPDATE public.workspace_chat_caps SET add_emoji = false WHERE workspace_id = test.id('W') AND role_key = 'member';
  v := test.add('B', 'switched', 'sw');
  PERFORM test.ok(v = '42501 Your role can''t add custom emoji.', 'who: the switch off stops members, even with a slot', v);
  v := test.slot('B', 'sw2');
  PERFORM test.ok(v = 'ERROR Your role can''t add custom emoji.', 'who: and they get no new slot', v);
  PERFORM test.seed('M', 'adm');
  v := test.add('M', 'admins', 'adm');
  PERFORM test.ok(v = 'ok 1', 'who: admins keep theirs', v);
  UPDATE public.workspace_chat_caps SET add_emoji = true WHERE workspace_id = test.id('W') AND role_key = 'member';
END;
$$;

-- ── 500 per workspace; 20 open slots a person ────────────────────────────────
DO $$
DECLARE
  v text;
  v_live int := (SELECT count(*) FROM public.chat_custom_emoji WHERE workspace_id = test.id('W') AND deleted_at IS NULL);
BEGIN
  INSERT INTO public.chat_custom_emoji (workspace_id, name, storage_path, poster_path, mime, width, height, bytes, created_by)
  SELECT test.id('W'), 'filler' || g, 'x', 'x', 'image/png', 1, 1, 1, test.id('O')
    FROM generate_series(1, 500 - v_live) g;
  PERFORM test.seed('B', 'full');
  v := test.add('B', 'onetoomany', 'full');
  PERFORM test.ok(v LIKE '22023 This workspace has 500 custom emoji%', 'limit: the 501st is refused', v);
  DELETE FROM public.chat_custom_emoji WHERE workspace_id = test.id('W') AND name LIKE 'filler%';
  v := test.add('B', 'onetoomany', 'full');
  PERFORM test.ok(v = 'ok 1', 'limit: with room again it goes in', v);
  DELETE FROM public.chat_custom_emoji_uploads WHERE uploader_id = test.id('V');
  INSERT INTO public.chat_custom_emoji_uploads (workspace_id, uploader_id)
  SELECT test.id('W'), test.id('O') FROM generate_series(1, 20);
  v := test.slot('O', 'too-many');
  PERFORM test.ok(v LIKE 'ERROR Too many emoji uploads%', 'slot: at most 20 open at once', v);
END;
$$;

-- ── Reactions: a live `:name:` only ──────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.as_user('A', format($q$SELECT public.chat_op_bootstrap(%L)$q$, test.id('W')));
  v := test.as_user('A', format($q$SELECT public.chat_op_create_channel(%L, 'ship', '', false, ARRAY[%L, %L]::uuid[])$q$,
    test.id('W'), test.id('B'), test.id('V')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A makes a channel with B and V', v);
  INSERT INTO test.ids SELECT 'Q', id FROM public.chat_channels WHERE workspace_id = test.id('W') AND name = 'ship';
  v := test.as_user('A', format($q$SELECT public.chat_op_send(%L::uuid, %L::uuid, 'ready :shipit:'::text, NULL::uuid)$q$,
    test.id('msg:q1'), test.ref('Q')));
  PERFORM test.ok(v LIKE 'ok %', 'setup: A posts', v);
  PERFORM test.as_user('O', format($q$SELECT public.tasks_op_create(%L, %L::jsonb)$q$, test.id('W'),
    jsonb_build_object('id', test.id('T'), 'title', 'Ship', 'bucket_id', test.id('SB'))));
  INSERT INTO public.comments (id, workspace_id, entity_type, entity_id, created_by, body)
  VALUES (test.id('C'), test.id('W'), 'task', test.id('T'), test.id('O'), 'Done :shipit:');

  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, ':shipit:'::text, true)$q$, test.id('msg:q1')));
  PERFORM test.ok(v = 'ok 1' AND (SELECT reactions ? ':shipit:' FROM public.chat_messages WHERE id = test.id('msg:q1')),
    'react: :shipit: works as a reaction in chat (AC4.8)', v);
  v := test.as_user('V', format($q$SELECT public.chat_op_react(%L::uuid, ':shipit:'::text, true)$q$, test.id('msg:q1')));
  PERFORM test.ok(v = 'ok 1', 'react: a viewer reacts with it too', v);
  v := test.as_user('B', format($q$SELECT * FROM public.comments_op_react(%L, ':shipit:', true)$q$, test.id('C')));
  PERFORM test.ok(v LIKE 'ok %' AND EXISTS (SELECT 1 FROM public.comment_reactions WHERE comment_id = test.id('C') AND reaction = ':shipit:'),
    'react: and on a task comment (AC4.8)', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, ':nope:'::text, true)$q$, test.id('msg:q1')));
  PERFORM test.ok(v = '22023 That emoji isn''t in this workspace.', 'react: a name that isn''t here is refused (chat)', v);
  v := test.as_user('B', format($q$SELECT * FROM public.comments_op_react(%L, ':nope:', true)$q$, test.id('C')));
  PERFORM test.ok(v = '22023 That emoji isn''t in this workspace.', 'react: and on a comment', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, ':Shipit:'::text, true)$q$, test.id('msg:q1')));
  PERFORM test.ok(v = '22023 That reaction isn''t supported.', 'react: the shape check refuses a bad name first', v);
END;
$$;

-- ── Removing ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v text;
BEGIN
  v := test.remove('B', 'shipit');
  PERFORM test.ok(v = '42501 Only whoever added it or an admin can remove it.', 'remove: another member can''t', v);
  v := test.remove('X', 'shipit');
  PERFORM test.ok(v = 'P0002 That emoji no longer exists.', 'remove: an outsider is told it isn''t there', v);
  v := test.as_key('K', format($q$SELECT public.chat_op_custom_emoji_remove(%L)$q$, (test.emoji('shipit')).id));
  PERFORM test.ok(v NOT LIKE 'ok%', 'remove: a key can''t', v);
  v := test.remove('A', 'shipit');
  PERFORM test.ok(v = 'ok 1' AND (test.emoji('shipit')).deleted_at IS NOT NULL,
    'remove: its adder removes it; the row stays, marked removed (soft delete)', v);
  PERFORM test.ok(EXISTS (SELECT 1 FROM public.module_activity WHERE workspace_id = test.id('W') AND op = 'chat.emoji_remove'),
    'remove: it''s in the activity');
  PERFORM test.ok(test.value_as('B', format($q$SELECT count(*)::text FROM public.chat_custom_emoji WHERE id = %L AND deleted_at IS NOT NULL$q$,
    (test.emoji('shipit')).id)) = '1', 'remove: members still read the removed row (open apps hear of it)');
  PERFORM test.ok((SELECT jsonb_array_length(reactions -> ':shipit:') = 2 FROM public.chat_messages WHERE id = test.id('msg:q1'))
              AND EXISTS (SELECT 1 FROM public.comment_reactions WHERE comment_id = test.id('C') AND reaction = ':shipit:'),
    'remove: reactions already there stay (the app draws them as text)');
  v := test.as_user('A', format($q$SELECT public.chat_op_react(%L::uuid, ':shipit:'::text, true)$q$, test.id('msg:q1')));
  PERFORM test.ok(v = '22023 That emoji isn''t in this workspace.', 'remove: nobody adds it as a new reaction', v);
  v := test.as_user('B', format($q$SELECT public.chat_op_react(%L::uuid, ':shipit:'::text, false)$q$, test.id('msg:q1')));
  PERFORM test.ok(v = 'ok 1' AND (SELECT reactions -> ':shipit:' = jsonb_build_array(test.id('V')::text) FROM public.chat_messages WHERE id = test.id('msg:q1')),
    'remove: taking yours back still works', v);
  v := test.as_user('B', format($q$SELECT * FROM public.comments_op_react(%L, ':shipit:', false)$q$, test.id('C')));
  PERFORM test.ok(v LIKE 'ok %', 'remove: and on a comment', v);
  v := test.remove('M', 'lgtm');
  PERFORM test.ok(v = 'ok 1', 'remove: an admin removes anyone''s', v);
  PERFORM test.seed('B', 'readd');
  v := test.add('B', 'shipit', 'readd');
  PERFORM test.ok(v = 'ok 1', 'remove: the name is free again', v);
END;
$$;

-- ── Grants, publication, erasure ─────────────────────────────────────────────
DO $$
DECLARE
  v jsonb;
BEGIN
  PERFORM test.ok(NOT has_table_privilege('authenticated', 'public.chat_custom_emoji', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.chat_custom_emoji', 'UPDATE')
              AND NOT has_table_privilege('authenticated', 'public.chat_custom_emoji', 'DELETE')
              AND NOT has_table_privilege('anon', 'public.chat_custom_emoji', 'SELECT')
              AND has_table_privilege('authenticated', 'public.chat_custom_emoji', 'SELECT'),
    'grants: the app reads the table; only the ops write it');
  PERFORM test.ok(NOT has_function_privilege('authenticated', 'public.chat__emoji_live(uuid, text)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.chat__emoji_name_reserved(text)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.chat_emoji__path_workspace(text)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.chat_has_cap(uuid, uuid, text)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.chat_op_custom_emoji_add(uuid, text, text, integer, integer, integer, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.chat_op_custom_emoji_remove(uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.chat_op_custom_emoji_begin(uuid)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.chat_emoji__path_slot(text)', 'EXECUTE')
              AND NOT has_table_privilege('authenticated', 'public.chat_custom_emoji_uploads', 'SELECT')
              AND NOT has_function_privilege('anon', 'public.chat_emoji__may_upload(text)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.chat_op_custom_emoji_add(uuid, text, text, integer, integer, integer, boolean)', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.reactions__key_ok(text)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.reactions__key_ok(text)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.chat_op_react(uuid, text, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.comments_op_react(uuid, text, boolean)', 'EXECUTE'),
    'grants: helpers stay server-side; the ops are for people only');
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                           AND schemaname = 'public' AND tablename = 'chat_custom_emoji'),
    'live: the table is published (adds and removals reach open apps)');

  v := public.account_erase_workspace_data(test.id('A'), true);
  PERFORM test.ok((v ->> 'custom_emoji_unattributed')::int >= 3, 'erasure: the preview counts their emoji', v::text);
  PERFORM public.account_erase_workspace_data(test.id('A'), false);
  PERFORM test.ok(NOT EXISTS (SELECT 1 FROM public.chat_custom_emoji WHERE created_by = test.id('A'))
              AND NOT EXISTS (SELECT 1 FROM public.chat_custom_emoji_uploads WHERE uploader_id = test.id('A'))
              AND (SELECT count(*) FROM public.chat_custom_emoji WHERE workspace_id = test.id('W') AND name = 'party-moduo') = 1,
    'erasure: the emoji stay with the workspace, no longer theirs; their upload slots go');
END;
$$;
