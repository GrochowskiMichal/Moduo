-- CV-19: message search for ⌘K, Chat's Search and a conversation's own Search
-- (spec §13, round-3 §2.5, Assumption #9, CV-0 spike 5: docs/build/chat-v2/CV-0-S5.md).
--
--   1. chat__search_query: the query builder (websearch syntax over the
--      unaccented text, each word of 3+ letters a prefix, bounded input).
--   2. chat_headline: a display-only text search config, so the snippet marks
--      "żółw" when someone typed "zolw".
--   3. chat_search: newest first, at most 50 rows, a marked snippet; only
--      messages of conversations the caller can read right now.
--   4. Grants, by name.
--
-- The columns (body_text, search_tsv), chat__unaccent and the GIN index came with
-- CV-1. The read rule is the live chat__readable_channel_ids(workspace, person)
-- (CV-2b), the set form of chat_can_read_channel: applied once per call inside the
-- indexed query, never per match (spike 5: a per-match loop starves or crawls when
-- many newer matches are unreadable). No dynamic SQL: the text someone typed is
-- only ever a parameter of websearch_to_tsquery.

SET LOCAL lock_timeout = '5s';

-- ── 1. The query builder ─────────────────────────────────────────────────────
-- websearch syntax ("a phrase", or, -word) over the unaccented query, at most 256
-- characters and 32 words; each word of 3+ letters becomes a prefix ('zadan':*),
-- shorter ones match whole words only ("ok", "UI", "za"), a negated word stays
-- exact. Punctuation-only input gives null (no rows, never every row). It never
-- raises on what someone typed: if the rewrite can't be read back, the plain query
-- is used.

CREATE OR REPLACE FUNCTION public.chat__search_query(p_query text)
  RETURNS tsquery
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = ''
  SET client_min_messages = warning
AS $$
DECLARE
  v_text text := pg_catalog.array_to_string(
    (pg_catalog.regexp_split_to_array(
       pg_catalog.btrim(pg_catalog.left(p_query, 256)), '\s+'))[1:32], ' ');
  v_q tsquery := pg_catalog.websearch_to_tsquery(
    'pg_catalog.simple'::regconfig, public.chat__unaccent(v_text));
BEGIN
  IF pg_catalog.numnode(v_q) = 0 THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN pg_catalog.regexp_replace(
      v_q::text, '(^|[ (])''([^'']{3,})''(?=$|[ )])', '\1''\2'':*', 'g')::tsquery;
  EXCEPTION WHEN OTHERS THEN
    RETURN v_q;
  END;
END;
$$;

COMMENT ON FUNCTION public.chat__search_query(text) IS
  'Chat search''s query (CV-19): websearch syntax, unaccented, words of 3+ letters as prefixes; null when nothing is searchable.';

-- ── 2. The snippet's text search config ──────────────────────────────────────
-- Display only: it unaccents per token, so ts_headline over the original body_text
-- marks "żółw" for 'zolw':*. The index keeps CV-1's wrapper (it unaccents before
-- parsing, so it doesn't depend on the database's ctype).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config
                  WHERE cfgname = 'chat_headline' AND cfgnamespace = 'public'::regnamespace) THEN
    CREATE TEXT SEARCH CONFIGURATION public.chat_headline (COPY = pg_catalog.simple);
    ALTER TEXT SEARCH CONFIGURATION public.chat_headline
      ALTER MAPPING FOR word, hword, hword_part WITH extensions.unaccent, pg_catalog.simple;
  END IF;
END;
$$;

-- ── 3. chat_search ───────────────────────────────────────────────────────────
-- ⌘K (p_limit 5), Chat's Search and a conversation's own Search (p_channel_id).
-- People only: an app's key reads no chat row here (CV-21 decides what a key may
-- search). Reading never needs the plan, so a paused workspace still searches,
-- and an archived conversation stays findable; a deleted one, a deleted message,
-- and a conversation you left or were removed from never are.
-- Paging: the next page passes the last row's (created_at, message_id) as
-- (p_before, p_before_id). The snippet marks matches with U+E000 … U+E001 and is
-- plain text: the client splits on them and draws text, never HTML.
-- The function returns no count: nothing it says depends on a row the caller can't
-- read. The statement_timeout below bounds a call through the API (PostgREST
-- applies a function's statement_timeout); the input caps above keep it cheap.

CREATE OR REPLACE FUNCTION public.chat_search(
  p_workspace_id uuid,
  p_query text,
  p_channel_id uuid DEFAULT NULL,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_from uuid DEFAULT NULL,
  p_after timestamptz DEFAULT NULL,
  p_has_file boolean DEFAULT false
)
  RETURNS TABLE (
    message_id uuid,
    channel_id uuid,
    parent_id uuid,
    reply_to_id uuid,
    author_id uuid,
    author_kind text,
    author_label text,
    created_at timestamptz,
    snippet text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  SET statement_timeout = '5s'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_q tsquery;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_channels uuid[];
BEGIN
  IF v_me IS NULL OR p_workspace_id IS NULL OR p_query IS NULL THEN
    RETURN;
  END IF;
  v_q := public.chat__search_query(p_query);
  IF v_q IS NULL THEN
    RETURN;
  END IF;
  v_channels := ARRAY(SELECT public.chat__readable_channel_ids(p_workspace_id, v_me));
  IF p_channel_id IS NOT NULL THEN
    v_channels := CASE WHEN p_channel_id = ANY (v_channels)
                       THEN ARRAY[p_channel_id] ELSE '{}'::uuid[] END;
  END IF;
  IF pg_catalog.cardinality(v_channels) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT h.id, h.channel_id, h.parent_id, h.reply_to_id, h.author_id, h.author_kind,
           h.author_label, h.created_at,
           pg_catalog.ts_headline('public.chat_headline'::regconfig, h.body_text, v_q,
             'StartSel=' || pg_catalog.chr(57344) || ', StopSel=' || pg_catalog.chr(57345)
             || ', MaxWords=24, MinWords=8, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "')
      FROM (
        SELECT m.id, m.channel_id, m.parent_id, m.reply_to_id, m.author_id, m.author_kind,
               m.author_label, m.created_at, m.body_text
          FROM public.chat_messages m
         WHERE m.search_tsv @@ v_q
           AND m.deleted_at IS NULL
           AND m.kind = 'message'
           AND m.workspace_id = p_workspace_id
           AND m.channel_id = ANY (v_channels)
           AND (p_from IS NULL OR m.author_id = p_from)
           AND (p_after IS NULL OR m.created_at >= p_after)
           AND (p_before IS NULL
                OR m.created_at < p_before
                OR (m.created_at = p_before AND p_before_id IS NOT NULL AND m.id < p_before_id))
           AND (NOT coalesce(p_has_file, false) OR EXISTS (
                 SELECT 1 FROM public.attachments a
                  WHERE a.workspace_id = m.workspace_id
                    AND a.entity_type = 'chat_message' AND a.entity_id = m.id
                    AND a.status = 'ready' AND a.deleted_at IS NULL))
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT v_limit
      ) h
     ORDER BY h.created_at DESC, h.id DESC;
END;
$$;

COMMENT ON FUNCTION public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz, boolean) IS
  'Chat search (CV-19): messages of conversations the caller can read now, newest first, at most 50, with a marked snippet (U+E000/U+E001).';

-- ── 4. Grants ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- The query builder: server-only.
  REVOKE ALL ON FUNCTION public.chat__search_query(text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.chat__search_query(text) TO service_role;
  IF has_function_privilege('anon', 'public.chat__search_query(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat__search_query(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public.chat__search_query must not be callable by clients.';
  END IF;

  -- The read answers people only: a key (the service role) and anon get nothing.
  REVOKE ALL ON FUNCTION public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz, boolean)
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz, boolean)
    TO authenticated;
  IF has_function_privilege('anon', 'public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz, boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Grants on public.chat_search are not as intended: signed-in people only.';
  END IF;
END;
$$;
