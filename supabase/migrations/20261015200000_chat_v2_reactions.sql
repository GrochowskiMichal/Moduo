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
--      nothing else on the row and nothing the second time.
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
-- goes, and a pictograph below U+1F000 or a keycap's #, * or digit gets U+FE0F
-- unless one (or a skin tone) already follows. So ❤ and ❤️ are one key, not two
-- chips. The ops store keys in this form; canonicalReactionKey in @contracts
-- does the same for the app's own optimistic copy.
CREATE OR REPLACE FUNCTION public.reactions__key_canonical(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT regexp_replace(
    replace(p_key, chr(65038), ''),
    '([#*0-9' || chr(169) || chr(174) || chr(8252) || chr(8265) || chr(8482) || chr(8505)
      || chr(8596) || '-' || chr(8618) || chr(8986) || '-' || chr(9215) || chr(9410)
      || chr(9642) || '-' || chr(9726) || chr(9728) || '-' || chr(10175)
      || chr(10548) || chr(10549) || chr(11013) || '-' || chr(11093)
      || chr(12336) || chr(12349) || chr(12951) || chr(12953)
      || '])(?![' || chr(65039) || chr(127995) || '-' || chr(127999) || '])',
    '\1' || chr(65039), 'g')
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

ALTER TABLE public.comment_reactions DROP CONSTRAINT IF EXISTS comment_reactions_reaction_check;
SELECT public.comment_reactions__words_to_emoji();
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
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
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
