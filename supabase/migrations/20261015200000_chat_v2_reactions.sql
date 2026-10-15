-- Chat v2 · CV-7c Reactions widened (specs/chat-v2.md §6; CH16a, CH49, CH60;
-- §Assumptions #18, #29; .design/chat-v2/research/round-3-database.md §2.8).
-- The stamp is provisional: re-cut on the day it applies; it must stay after
-- …_chat_v2_device_notices (CV-6a), whose user_op_set_chat_prefs it narrows.
-- It runs again cleanly over itself.
--
-- What it does:
--   1. One reaction key for chat and comments: reactions__key_ok(text), the
--      server's half of REACTION_KEY in @contracts. A key is exactly one
--      standard emoji as Emojibase writes it, 1–32 code points (so at most
--      128 bytes): a pair of regional indicators (a flag), a #/* keycap, or
--      one pictograph from the emoji blocks with an optional variation
--      selector, skin tone and tag sequence, joined to more of the same only
--      by U+200D. Every code point comes from that closed set: no letters,
--      digits, spaces, controls, invisible or direction marks, and never two
--      emoji side by side. reactions__key_pattern() spells the set as code
--      point numbers, the same numbers @contracts uses. (The `:name:` form of
--      a live custom emoji arrives with CV-20, whose migration widens this.)
--   2. Comments take any key. comment_reactions' CHECK (the six words) becomes
--      reactions__key_ok(reaction), and the six stored words become their
--      emoji (thumbs_up → 👍, check → ✅, eyes → 👀, pray → 🙏, heart → ❤️,
--      smile → 😄) through comment_reactions__words_to_emoji(), which changes
--      nothing else on the row and nothing the second time. Then
--      reactions__respell_stored() stores every key already held (comments
--      and chat messages) in the one spelling (reactions__key_canonical),
--      merging two spellings one person holds.
--   3. comments_op_react (from its live body) checks the shared key and holds
--      at most 20 kinds per comment; who may react is unchanged
--      (comments__find). chat_op_react (from its live body) checks the shared
--      key; its 20-kind cap stays. Neither takes a person from the caller:
--      the reactor is always auth.uid(). Reactions never notify.
--   4. Your quick row (user_op_set_chat_prefs, from its live body) checks
--      each key with the same function.

SET LOCAL lock_timeout = '5s';

-- ── 1. The shared key ───────────────────────────────────────────────────────
-- Code points in decimal (chr), the same numbers as REACTION_KEY_SET in
-- @contracts; the drift gate compares the two lists.
CREATE OR REPLACE FUNCTION public.reactions__key_pattern()
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
  WITH c AS (
    SELECT
      -- one pictograph: ©, ®, ‼, ⁉, ™, ℹ, arrows, ⌚…⏿, Ⓜ, ▪…◾, ☀…➿, ⤴⤵,
      -- ⬅…⭕, 〰, 〽, ㊗, ㊙, and U+1F000–1FAFF less the flags' letters and
      -- the skin tones
      '[' || chr(169) || chr(174) || chr(8252) || chr(8265) || chr(8482) || chr(8505)
          || chr(8596) || '-' || chr(8618) || chr(8986) || '-' || chr(9215) || chr(9410)
          || chr(9642) || '-' || chr(9726) || chr(9728) || '-' || chr(10175)
          || chr(10548) || chr(10549) || chr(11013) || '-' || chr(11093)
          || chr(12336) || chr(12349) || chr(12951) || chr(12953)
          || chr(126976) || '-' || chr(127461) || chr(127488) || '-' || chr(127994)
          || chr(128000) || '-' || chr(129791) || ']' AS base,
      '[' || chr(65038) || chr(65039) || ']' AS vs,                  -- U+FE0E, U+FE0F
      '[' || chr(127995) || '-' || chr(127999) || ']' AS skin,       -- U+1F3FB–1F3FF
      '[' || chr(917536) || '-' || chr(917630) || ']' AS tag,        -- U+E0020–E007E
      chr(917631) AS tag_end,                                        -- U+E007F
      chr(8205) AS zwj,                                              -- U+200D
      chr(8419) AS keycap,                                           -- U+20E3
      '[' || chr(127462) || '-' || chr(127487) || ']' AS ri          -- U+1F1E6–1F1FF
  ), e AS (
    SELECT c.*, '(?:' || base || vs || '?' || skin || '?' || chr(65039) || '?(?:'
                || tag || '+' || tag_end || ')?)' AS one
      FROM c
  )
  SELECT '^(?:' || ri || ri
      || '|[#*0-9]' || chr(65039) || '?' || keycap
      || '|' || one || '(?:' || zwj || one || ')*'
      || ')$'
    FROM e
$function$;

CREATE OR REPLACE FUNCTION public.reactions__key_ok(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT p_key IS NOT NULL
     AND char_length(p_key) BETWEEN 1 AND 32
     AND p_key ~ public.reactions__key_pattern()
$function$;

-- One spelling per emoji, as Emojibase writes it: the text selector (U+FE0E)
-- goes; U+FE0F goes before a skin tone and unless it follows a text-default
-- code point; a text-default pictograph (Unicode's Emoji_Presentation=No, read
-- from emoji-test.txt 18.0) or a keycap's #, * or digit gets U+FE0F unless one
-- or a skin tone already follows. So ❤ and ❤️ are one key, ✅ stays ✅ and ✅️
-- becomes ✅. The ops store keys in this form; canonicalReactionKey in
-- @contracts takes the same steps (the list is REACTION_KEY_SET.textDefault;
-- the drift gate compares them).
CREATE OR REPLACE FUNCTION public.reactions__key_canonical(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
  WITH c AS (
    -- the keycap bases, then REACTION_KEY_SET.textDefault
    SELECT '[#*0-9'
      || chr(169) || chr(174) || chr(8252) || chr(8265) || chr(8482) || chr(8505)
      || chr(8596) || '-' || chr(8601) || chr(8617) || '-' || chr(8618) || chr(9000)
      || chr(9167) || chr(9197) || '-' || chr(9199) || chr(9201) || '-' || chr(9202)
      || chr(9208) || '-' || chr(9210) || chr(9410) || chr(9642) || '-' || chr(9643)
      || chr(9654) || chr(9664) || chr(9723) || '-' || chr(9724)
      || chr(9728) || '-' || chr(9732) || chr(9742) || chr(9745) || chr(9752)
      || chr(9757) || chr(9760) || chr(9762) || '-' || chr(9763) || chr(9766)
      || chr(9770) || chr(9774) || '-' || chr(9775) || chr(9784) || '-' || chr(9786)
      || chr(9792) || chr(9794) || chr(9823) || '-' || chr(9824) || chr(9827)
      || chr(9829) || '-' || chr(9830) || chr(9832) || chr(9851) || chr(9854)
      || chr(9874) || chr(9876) || '-' || chr(9879) || chr(9881)
      || chr(9883) || '-' || chr(9884) || chr(9888) || chr(9895)
      || chr(9904) || '-' || chr(9905) || chr(9928) || chr(9935) || chr(9937)
      || chr(9939) || chr(9961) || chr(9968) || '-' || chr(9969) || chr(9972)
      || chr(9975) || '-' || chr(9977) || chr(9986) || chr(9992) || '-' || chr(9993)
      || chr(9996) || '-' || chr(9997) || chr(9999) || chr(10002) || chr(10004)
      || chr(10006) || chr(10013) || chr(10017) || chr(10035) || '-' || chr(10036)
      || chr(10052) || chr(10055) || chr(10083) || '-' || chr(10084) || chr(10145)
      || chr(10548) || '-' || chr(10549) || chr(11013) || '-' || chr(11015)
      || chr(12336) || chr(12349) || chr(12951) || chr(12953)
      || chr(127344) || '-' || chr(127345) || chr(127358) || '-' || chr(127359)
      || chr(127490) || chr(127543) || chr(127777) || chr(127780) || '-' || chr(127788)
      || chr(127798) || chr(127869) || chr(127894) || '-' || chr(127895)
      || chr(127897) || '-' || chr(127899) || chr(127902) || '-' || chr(127903)
      || chr(127947) || '-' || chr(127950) || chr(127956) || '-' || chr(127967)
      || chr(127987) || chr(127989) || chr(127991) || chr(128063) || chr(128065)
      || chr(128253) || chr(128329) || '-' || chr(128330)
      || chr(128367) || '-' || chr(128368) || chr(128371) || '-' || chr(128377)
      || chr(128391) || chr(128394) || '-' || chr(128397) || chr(128400) || chr(128421)
      || chr(128424) || chr(128433) || '-' || chr(128434) || chr(128444)
      || chr(128450) || '-' || chr(128452) || chr(128465) || '-' || chr(128467)
      || chr(128476) || '-' || chr(128478) || chr(128481) || chr(128483) || chr(128488)
      || chr(128495) || chr(128499) || chr(128506) || chr(128715)
      || chr(128717) || '-' || chr(128719) || chr(128736) || '-' || chr(128741)
      || chr(128745) || chr(128752) || chr(128755)
      || ']' AS td,
      '[' || chr(127995) || '-' || chr(127999) || ']' AS skin
  )
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(replace(p_key, chr(65038), ''),
                            chr(65039) || '(?=' || skin || ')', '', 'g'),
             '(?<!' || td || ')' || chr(65039), '', 'g'),
           '(' || td || ')(?![' || chr(65039) || chr(127995) || '-' || chr(127999) || '])',
           '\1' || chr(65039), 'g')
    FROM c
$function$;

REVOKE ALL ON FUNCTION public.reactions__key_canonical(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactions__key_canonical(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reactions__key_pattern() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactions__key_pattern() TO authenticated, service_role;

COMMENT ON FUNCTION public.reactions__key_ok(text) IS
  'CV-7c: a reaction key (chat messages, comments, the quick row) is a standard emoji. Mirrors REACTION_KEY in @contracts.';

REVOKE ALL ON FUNCTION public.reactions__key_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactions__key_ok(text) TO authenticated, service_role;

-- ── 2. Comments: the six words become emoji ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.comment_reactions__words_to_emoji()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- Only the reaction changes: who, when, which comment and workspace stay.
  -- A person couldn't hold both a word and its emoji (the old CHECK allowed
  -- only the words), so the primary key never collides.
  UPDATE public.comment_reactions r
     SET reaction = m.emoji
    FROM (VALUES ('thumbs_up', '👍'), ('check', '✅'), ('eyes', '👀'),
                 ('pray', '🙏'), ('heart', '❤️'), ('smile', '😄')) AS m(word, emoji)
   WHERE r.reaction = m.word;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.comment_reactions__words_to_emoji() IS
  'CV-7c: rewrites the six TV-U13 reaction words to their emoji; lossless, and a no-op the second time.';

REVOKE ALL ON FUNCTION public.comment_reactions__words_to_emoji() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comment_reactions__words_to_emoji() TO service_role;

-- Stored keys in the one spelling: a key someone stored as ✅️ or ❤ before
-- this migration (chat v1, or a comment) becomes ✅ or ❤️, so a chip and the
-- key it reacts with match and the person can take it off. Two spellings one
-- person holds become one (the earliest is kept). What isn't a key is left as
-- it is. A chat message it changes gets a new updated_at, as a reaction does.
CREATE OR REPLACE FUNCTION public.reactions__respell_stored()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_n integer := 0;
  v_m integer;
BEGIN
  -- Comments: drop a second spelling the same person already holds …
  DELETE FROM public.comment_reactions r
   WHERE public.reactions__key_ok(r.reaction)
     AND r.reaction <> public.reactions__key_canonical(r.reaction)
     AND EXISTS (
       SELECT 1 FROM public.comment_reactions o
        WHERE o.comment_id = r.comment_id AND o.user_id = r.user_id
          AND o.reaction <> r.reaction
          AND public.reactions__key_ok(o.reaction)
          AND public.reactions__key_canonical(o.reaction) = public.reactions__key_canonical(r.reaction)
          AND (o.reaction = public.reactions__key_canonical(o.reaction)
               OR (o.created_at, o.reaction) < (r.created_at, r.reaction)));
  GET DIAGNOSTICS v_m = ROW_COUNT;
  v_n := v_n + v_m;
  -- … then store the rest in the one spelling (who, when and where kept).
  UPDATE public.comment_reactions r
     SET reaction = public.reactions__key_canonical(r.reaction)
   WHERE public.reactions__key_ok(r.reaction)
     AND r.reaction <> public.reactions__key_canonical(r.reaction);
  GET DIAGNOSTICS v_m = ROW_COUNT;
  v_n := v_n + v_m;

  -- Chat messages: merge the people under each key's one spelling.
  UPDATE public.chat_messages m
     SET reactions = x.reactions
    FROM (
      SELECT g.id, jsonb_object_agg(g.k, g.people) AS reactions
        FROM (
          SELECT u.id, u.k, jsonb_agg(u.person ORDER BY u.first) AS people
            FROM (
              SELECT e.id, e.k, e.person, min(ARRAY[e.ko, e.po]) AS first
                FROM (
                  SELECT m2.id,
                         CASE WHEN public.reactions__key_ok(kv.key)
                              THEN public.reactions__key_canonical(kv.key) ELSE kv.key END AS k,
                         p.person, kv.ko, p.po
                    FROM public.chat_messages m2
                    CROSS JOIN LATERAL jsonb_each(m2.reactions) WITH ORDINALITY AS kv(key, value, ko)
                    CROSS JOIN LATERAL jsonb_array_elements(
                      CASE WHEN jsonb_typeof(kv.value) = 'array' THEN kv.value ELSE '[]'::jsonb END
                    ) WITH ORDINALITY AS p(person, po)
                   WHERE jsonb_typeof(m2.reactions) = 'object'
                     AND EXISTS (SELECT 1 FROM jsonb_object_keys(m2.reactions) k2
                                  WHERE public.reactions__key_ok(k2)
                                    AND k2 <> public.reactions__key_canonical(k2))
                ) e
               GROUP BY e.id, e.k, e.person
            ) u
           GROUP BY u.id, u.k
        ) g
       GROUP BY g.id
    ) x
   WHERE m.id = x.id;
  GET DIAGNOSTICS v_m = ROW_COUNT;
  RETURN v_n + v_m;
END;
$function$;

COMMENT ON FUNCTION public.reactions__respell_stored() IS
  'CV-7c: stores every reaction key in its one spelling (comments and chat messages), merging two spellings one person holds; a no-op the second time.';

REVOKE ALL ON FUNCTION public.reactions__respell_stored() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reactions__respell_stored() TO service_role;

ALTER TABLE public.comment_reactions DROP CONSTRAINT IF EXISTS comment_reactions_reaction_check;
SELECT public.comment_reactions__words_to_emoji();
SELECT public.reactions__respell_stored();
ALTER TABLE public.comment_reactions
  ADD CONSTRAINT comment_reactions_reaction_check CHECK (public.reactions__key_ok(reaction));

-- ── 3. The ops ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.comments_op_react(p_comment_id uuid, p_reaction text, p_on boolean DEFAULT true)
 RETURNS SETOF comment_reactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.comments;
BEGIN
  -- An app from before CV-7c still sends the six TV-U13 words: they mean their
  -- emoji, so this can ship before every app (desktop bundles its UI) updates.
  p_reaction := CASE p_reaction
    WHEN 'thumbs_up' THEN '👍' WHEN 'check' THEN '✅' WHEN 'eyes' THEN '👀'
    WHEN 'pray' THEN '🙏' WHEN 'heart' THEN '❤️' WHEN 'smile' THEN '😄'
    ELSE p_reaction END;
  p_reaction := public.reactions__key_canonical(p_reaction);
  IF NOT public.reactions__key_ok(p_reaction) THEN
    RAISE EXCEPTION 'That reaction isn''t supported.' USING ERRCODE = '22023';
  END IF;
  v := public.comments__find(p_comment_id);
  IF v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That comment was deleted.' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(p_on, true) THEN
    -- At most 20 kinds per comment (comments__find holds the comment's row,
    -- so two people can't both add the 21st).
    IF NOT EXISTS (SELECT 1 FROM public.comment_reactions
                    WHERE comment_id = v.id AND reaction = p_reaction)
       AND (SELECT count(DISTINCT reaction) FROM public.comment_reactions
             WHERE comment_id = v.id) >= 20 THEN
      RAISE EXCEPTION 'This comment has the most reactions it can hold.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.comment_reactions (comment_id, user_id, reaction, workspace_id)
    VALUES (v.id, auth.uid(), p_reaction, v.workspace_id)
    ON CONFLICT (comment_id, user_id, reaction) DO NOTHING;
  ELSE
    DELETE FROM public.comment_reactions
     WHERE comment_id = v.id AND user_id = auth.uid() AND reaction = p_reaction;
  END IF;
  -- Carries the change to open panels (delta + Realtime); not an edit.
  UPDATE public.comments SET updated_at = now() WHERE id = v.id;

  RETURN QUERY
    SELECT r.* FROM public.comment_reactions r
     WHERE r.comment_id = v.id
     ORDER BY r.created_at, r.user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.comments_op_react(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comments_op_react(uuid, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_op_react(p_message_id uuid, p_key text, p_on boolean)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
  v_me text := auth.uid()::text;
  v_list jsonb;
BEGIN
  p_key := public.reactions__key_canonical(p_key);
  IF NOT public.reactions__key_ok(p_key) THEN
    RAISE EXCEPTION 'That reaction isn''t supported.' USING ERRCODE = '22023';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Say whether the reaction is on or off.' USING ERRCODE = '22023';
  END IF;
  -- A message the caller can't read gets the same answer as a missing one.
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL
     OR NOT public.chat_can_read_channel(v_msg.channel_id) THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF (public.chat_op__reader(v_msg.channel_id)).archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'Only a message takes reactions.' USING ERRCODE = '22023';
  END IF;

  v_list := coalesce(v_msg.reactions -> p_key, '[]'::jsonb);
  IF p_on = (v_list ? v_me) THEN
    RETURN v_msg;
  END IF;
  IF p_on THEN
    IF NOT (v_msg.reactions ? p_key) AND (SELECT count(*) FROM jsonb_object_keys(v_msg.reactions)) >= 20 THEN
      RAISE EXCEPTION 'This message has the most reactions it can hold.' USING ERRCODE = '22023';
    END IF;
    v_list := v_list || to_jsonb(v_me);
  ELSE
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_list
      FROM jsonb_array_elements_text(v_list) x WHERE x <> v_me;
  END IF;

  UPDATE public.chat_messages
     SET reactions = CASE WHEN jsonb_array_length(v_list) = 0 THEN reactions - p_key
                          ELSE jsonb_set(reactions, array[p_key], v_list) END
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.react', jsonb_build_object('message_id', v_msg.id, 'key', p_key, 'on', p_on));
  RETURN v_msg;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_op_react(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_op_react(uuid, text, boolean) TO authenticated, service_role;

-- The toggle form (from its live body): it reads the message only after the
-- reader check, and looks up the stored spelling of the key.
CREATE OR REPLACE FUNCTION public.chat_op_react(p_message_id uuid, p_emoji text)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_on boolean;
BEGIN
  SELECT NOT coalesce((m.reactions -> public.reactions__key_canonical(p_emoji)) ? auth.uid()::text, false) INTO v_on
    FROM public.chat_messages m
   WHERE m.id = p_message_id
     AND public.chat_can_read_channel(m.channel_id);
  RETURN public.chat_op_react(p_message_id, p_emoji, coalesce(v_on, true));
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_op_react(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_op_react(uuid, text) TO authenticated, service_role;

-- ── 4. Your quick row ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_op_set_chat_prefs(p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_key text;
  v_row text[];
  v_item text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Send the settings to change.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('reaction_row', 'show_online', 'show_focus_task', 'notice_show_text', 'email_when_away') THEN
      RAISE EXCEPTION 'Unknown setting: %', v_key USING ERRCODE = '22023';
    END IF;
    IF v_key <> 'reaction_row' AND jsonb_typeof(p_patch -> v_key) <> 'boolean' THEN
      RAISE EXCEPTION '% is on or off.', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Your quick reactions: null is Moduo's six; at most six, each once. A key
  -- is a reaction key (public.reactions__key_ok, shared with chat and comments).
  IF p_patch ? 'reaction_row' AND jsonb_typeof(p_patch -> 'reaction_row') <> 'null' THEN
    IF jsonb_typeof(p_patch -> 'reaction_row') <> 'array'
       OR jsonb_array_length(p_patch -> 'reaction_row') > 6 THEN
      RAISE EXCEPTION 'Pick up to six reactions.' USING ERRCODE = '22023';
    END IF;
    v_row := '{}'::text[];
    FOR v_item IN SELECT e FROM jsonb_array_elements(p_patch -> 'reaction_row') AS x(e) LOOP
      IF jsonb_typeof(v_item::jsonb) <> 'string' THEN
        RAISE EXCEPTION 'A reaction is an emoji.' USING ERRCODE = '22023';
      END IF;
      v_item := public.reactions__key_canonical(v_item::jsonb #>> '{}');
      IF NOT public.reactions__key_ok(v_item) THEN
        RAISE EXCEPTION 'A reaction is an emoji.' USING ERRCODE = '22023';
      END IF;
      IF v_item = ANY (v_row) THEN
        RAISE EXCEPTION 'Each reaction once.' USING ERRCODE = '22023';
      END IF;
      v_row := v_row || v_item;
    END LOOP;
  END IF;

  INSERT INTO public.user_preferences (user_id) VALUES (v_user)
  ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_preferences p SET
    reaction_row = CASE WHEN p_patch ? 'reaction_row' THEN v_row ELSE p.reaction_row END,
    show_online = coalesce((p_patch ->> 'show_online')::boolean, p.show_online),
    show_focus_task = coalesce((p_patch ->> 'show_focus_task')::boolean, p.show_focus_task),
    notice_show_text = coalesce((p_patch ->> 'notice_show_text')::boolean, p.notice_show_text),
    email_when_away = coalesce((p_patch ->> 'email_when_away')::boolean, p.email_when_away)
  WHERE p.user_id = v_user;
  RETURN public.user_chat_prefs();
END;
$function$;

REVOKE ALL ON FUNCTION public.user_op_set_chat_prefs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_op_set_chat_prefs(jsonb) TO authenticated, service_role;
