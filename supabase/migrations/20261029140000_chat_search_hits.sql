-- GS-6: Chat through the search contract (specs/global-search.md AC3, AC4, AC5;
-- Assumptions 3, 6, 7, 11).
--
--   1. chat__search_query becomes a one-line call to search__query: one
--      dialect everywhere. chat__unaccent stays, because chat_messages'
--      search_tsv (and its GIN index) names it; it is the same unaccent, so the
--      lexemes agree (chat_search_hits.test.sql checks the two answer alike).
--   2. chat__search_hits(ws, query, limit): Chat's half of ⌘K as SearchHit rows.
--      - Messages (chat_message): chat_search's query, newest first, the author
--        as title, the conversation as context, a marked snippet, a body match.
--      - Conversations (chat_channel): by name (a direct message by its other
--        people, a note-to-self by yours), word-starts without diacritics, a
--        title match; typo-forgiven names when fewer than 3 match exactly.
--      - Who reads what: a person, chat__readable_channel_ids (what chat_search
--        reads); a key, chat__key_channel_ids (what chat_agent_search reads):
--        never a direct message, a private channel only with
--        include_private_chat. A key Chat doesn't let in gets no rows, never an
--        error, so search_all keeps the other modules' answer.
--      - Visibility goes before the limit: the readable set is in the indexed
--        query. SECURITY DEFINER: the actor comes from the request.
--   3. search_all asks chat__search_hits for chat_message and chat_channel
--      (now among the default types). Built on GS-3's body
--      (20261029090000_search_all.sql); only the type lists and one UNION ALL
--      branch change.
--   4. Grants, by name.
--
-- Re-runnable: functions OR REPLACE, grants re-stated by name.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.search_all(uuid, text, text[], integer, text, uuid)') IS NULL
     OR to_regprocedure('public.search__snippet(text, tsquery)') IS NULL
     OR to_regprocedure('public.chat__key_channel_ids(uuid, uuid, boolean)') IS NULL THEN
    RAISE EXCEPTION 'GS-6 needs GS-1 and GS-3 (20261028220000_search_primitives.sql, 20261029090000_search_all.sql) and Chat v2''s agents (20261017123000_chat_v2_agents.sql) applied first.';
  END IF;
END;
$$;

-- ── 1. One dialect ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat__search_query(p_query text)
  RETURNS tsquery
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = ''
AS $$
  SELECT public.search__query(p_query)
$$;

COMMENT ON FUNCTION public.chat__search_query(text) IS
  'Chat search''s query (CV-19, GS-6): search__query, the one dialect every module shares.';

-- ── 2. chat__search_hits ─────────────────────────────────────────────────────
-- Up to p_limit messages and p_limit conversations (at most 50 each). Ranks:
-- a message 0.40 (a body match), a conversation's name 0.75, 0.15 less when
-- its conversation is archived (it stays findable, tagged), a typo-forgiven
-- name 0.2 × its word similarity. A message's time is when it was sent; a
-- conversation's, its last message.

CREATE OR REPLACE FUNCTION public.chat__search_hits(p_workspace_id uuid, p_query text, p_limit integer)
  RETURNS TABLE (entity_type text, entity_id uuid, title text, context text, snippet text,
                 icon text, match text, rank real, updated_at timestamptz, archived boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  -- The readable set's size changes per caller: plan each call (notes__search).
  SET plan_cache_mode = 'force_custom_plan'
  SET client_min_messages = warning
AS $$
#variable_conflict use_column
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_me uuid;
  v_actor record;
  v_channels uuid[];
  v_q tsquery;
  v_conv uuid[];
  v_label text[];
  v_arch boolean[];
  v_at timestamptz[];
  v_exact uuid[];
  v_words text[];
  v_fuzzy text;
  v_not tsquery;
BEGIN
  IF p_workspace_id IS NULL OR p_query IS NULL THEN
    RETURN;
  END IF;
  IF public.module_api_key_id() IS NOT NULL THEN
    -- A key reads as its creator, under its own rules; one Chat doesn't let
    -- in answers nothing here (chat__key_actor says why to the chat tools).
    BEGIN
      v_actor := public.chat__key_actor('view');
    EXCEPTION WHEN insufficient_privilege THEN
      RETURN;
    END;
    IF v_actor.workspace_id IS DISTINCT FROM p_workspace_id THEN
      RETURN;
    END IF;
    v_me := v_actor.creator;
    v_channels := ARRAY(SELECT public.chat__key_channel_ids(v_actor.workspace_id, v_actor.creator,
                                                             v_actor.private_ok));
  ELSE
    v_me := auth.uid();
    IF v_me IS NULL THEN
      RETURN;
    END IF;
    v_channels := ARRAY(SELECT public.chat__readable_channel_ids(p_workspace_id, v_me));
  END IF;
  IF pg_catalog.cardinality(v_channels) = 0 THEN
    RETURN;
  END IF;
  v_q := public.search__query(p_query);
  IF v_q IS NULL THEN
    RETURN;
  END IF;

  -- Each readable conversation's name as ⌘K shows it: a channel's own; a direct
  -- message's other people (who it was opened with, from its dm_key, so one
  -- they left keeps their name); a note-to-self, yours.
  WITH readable AS MATERIALIZED (SELECT u.id FROM unnest(v_channels) AS u(id)),
  others AS (
    SELECT o.channel_id, o.uid
      FROM (SELECT c.id AS channel_id,
                   CASE WHEN k.id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                        THEN k.id::uuid END AS uid
              FROM public.chat_channels c
              JOIN readable r ON r.id = c.id
             CROSS JOIN LATERAL pg_catalog.unnest(pg_catalog.string_to_array(c.dm_key, ',')) AS k(id)
             WHERE c.kind = 'dm') o
     WHERE o.uid IS NOT NULL AND o.uid <> v_me
  ),
  named AS (
    SELECT c.id, c.archived_at IS NOT NULL AS archived,
           coalesce(c.last_message_at, c.updated_at, c.created_at) AS at,
           CASE WHEN c.kind = 'channel' THEN coalesce(c.name, '')
                ELSE coalesce(
                  (SELECT pg_catalog.string_agg(coalesce(nullif(pg_catalog.btrim(p.display_name), ''), 'Former member'),
                                                ', ' ORDER BY o.uid)
                     FROM others o
                     LEFT JOIN public.profiles p ON p.id = o.uid
                    WHERE o.channel_id = c.id),
                  (SELECT nullif(pg_catalog.btrim(p.display_name), '') FROM public.profiles p WHERE p.id = v_me),
                  'You') END AS label
      FROM public.chat_channels c
      JOIN readable r ON r.id = c.id
  )
  SELECT coalesce(array_agg(n.id), '{}'), coalesce(array_agg(n.label), '{}'),
         coalesce(array_agg(n.archived), '{}'), coalesce(array_agg(n.at), '{}')
    INTO v_conv, v_label, v_arch, v_at
    FROM named n;

  -- Messages: chat_search's query over the same readable set (the text and
  -- the set together in the indexed query, so unreadable matches never take
  -- a place), then shaped for the rows returned only.
  RETURN QUERY
    WITH hits AS MATERIALIZED (
      SELECT m.id, m.channel_id, m.author_id, m.author_label, m.created_at, m.body_text
        FROM public.chat_messages m
       WHERE m.search_tsv OPERATOR(pg_catalog.@@) v_q
         AND m.deleted_at IS NULL
         AND m.kind = 'message'
         AND m.workspace_id = p_workspace_id
         AND m.channel_id = ANY (v_channels)
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT v_limit
    ),
    conv AS (
      SELECT x.id, x.label, x.archived FROM unnest(v_conv, v_label, v_arch) AS x(id, label, archived)
    )
    SELECT 'chat_message'::text,
           h.id,
           coalesce(CASE WHEN h.author_id IS NOT NULL THEN
                      coalesce(nullif(pg_catalog.btrim(p.display_name), ''), 'Former member') END,
                    nullif(pg_catalog.btrim(h.author_label), ''), 'An app'),
           c.label,
           public.search__snippet(h.body_text, v_q),
           NULL::text,
           'body'::text,
           (0.40 - CASE WHEN c.archived THEN 0.15 ELSE 0 END)::real,
           h.created_at,
           coalesce(c.archived, false)
      FROM hits h
      LEFT JOIN conv c ON c.id = h.channel_id
      LEFT JOIN public.profiles p ON p.id = h.author_id
     ORDER BY h.created_at DESC, h.id DESC;

  -- Conversations by name: every word, word-starts, no diacritics.
  v_exact := ARRAY(
    SELECT x.id
      FROM unnest(v_conv, v_label, v_arch, v_at) AS x(id, label, archived, at)
     WHERE pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(x.label))
           OPERATOR(pg_catalog.@@) v_q
     ORDER BY x.archived, x.at DESC, x.id
     LIMIT v_limit);
  RETURN QUERY
    SELECT 'chat_channel'::text, x.id, x.label, NULL::text, NULL::text, NULL::text, 'title'::text,
           (0.75 - CASE WHEN x.archived THEN 0.15 ELSE 0 END)::real, x.at, x.archived
      FROM unnest(v_conv, v_label, v_arch, v_at) AS x(id, label, archived, at)
     WHERE x.id = ANY (v_exact);

  -- Typo forgiveness on names, when exact matching found fewer than 3: the
  -- typed words (no quotes, no excluded words) against the best-matching
  -- stretch of each name, as notes__search does. The set is the caller's
  -- readable conversations, so it is compared directly, without an index.
  IF pg_catalog.cardinality(v_exact) < 3 AND pg_catalog.cardinality(v_exact) < v_limit THEN
    v_words := (pg_catalog.regexp_split_to_array(
      pg_catalog.translate(pg_catalog.btrim(pg_catalog.left(p_query, 256)), '"', ''), '\s+'))[1:32];
    v_fuzzy := pg_catalog.lower(public.search__unaccent(pg_catalog.array_to_string(
      ARRAY(SELECT w FROM unnest(v_words) AS w WHERE w NOT LIKE '-%'), ' ')));
    v_not := pg_catalog.websearch_to_tsquery('pg_catalog.simple'::regconfig,
      public.search__unaccent(pg_catalog.array_to_string(
        ARRAY(SELECT pg_catalog.substr(w, 2) FROM unnest(v_words) AS w WHERE w LIKE '-_%'), ' or ')));
    IF pg_catalog.length(pg_catalog.btrim(v_fuzzy)) >= 3 THEN
      RETURN QUERY
        SELECT 'chat_channel'::text, f.id, f.label, NULL::text, NULL::text, NULL::text, 'title_fuzzy'::text,
               (0.2 * f.sim)::real, f.at, f.archived
          FROM (SELECT x.id, x.label, x.archived, x.at,
                       extensions.word_similarity(v_fuzzy, pg_catalog.lower(public.search__unaccent(x.label))) AS sim
                  FROM unnest(v_conv, v_label, v_arch, v_at) AS x(id, label, archived, at)
                 WHERE NOT (x.id = ANY (v_exact))
                   AND (pg_catalog.numnode(v_not) = 0
                        OR NOT (pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(x.label))
                                OPERATOR(pg_catalog.@@) v_not))) f
         WHERE f.sim >= 0.5
         ORDER BY f.sim DESC, f.archived, f.at DESC, f.id
         LIMIT v_limit - pg_catalog.cardinality(v_exact);
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.chat__search_hits(uuid, text, integer) IS
  'Search (GS-6): Chat''s messages and conversations as SearchHit rows, at most p_limit of each, only from conversations the caller (a person, or a key by chat__key_channel_ids) reads. The actor comes from the request, never an argument.';

-- ── 3. search_all, with Chat ─────────────────────────────────────────────────
-- GS-3's body; chat_message and chat_channel join the types and come from
-- chat__search_hits, never the registry.

CREATE OR REPLACE FUNCTION public.search_all(p_workspace_id uuid, p_query text, p_types text[] DEFAULT NULL,
                                             p_limit_per_type integer DEFAULT 8,
                                             p_context_type text DEFAULT NULL, p_context_id uuid DEFAULT NULL)
  RETURNS TABLE (entity_type text, entity_id uuid, title text, context text, snippet text,
                 icon text, match text, rank real, updated_at timestamptz, archived boolean,
                 score real, type_total integer, top boolean)
  LANGUAGE plpgsql STABLE SECURITY INVOKER
  SET search_path = ''
  SET statement_timeout = '5s'
AS $$
#variable_conflict use_column
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit_per_type, 8), 1), 50);
  v_types text[];
  v_registry text[];
  v_chat boolean;
  v_ctx_type text := CASE lower(btrim(coalesce(p_context_type, '')))
                       WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread'
                       ELSE nullif(lower(btrim(coalesce(p_context_type, ''))), '') END;
  v_ctx boolean := false;
BEGIN
  IF p_workspace_id IS NULL OR pg_catalog.length(pg_catalog.btrim(coalesce(p_query, ''))) < 2 THEN
    RETURN;
  END IF;
  -- The palette's types.
  v_types := ARRAY(
    SELECT DISTINCT t
      FROM (SELECT CASE lower(btrim(x)) WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread'
                                        ELSE lower(btrim(x)) END AS t
              FROM unnest(coalesce(p_types, ARRAY['task', 'bucket', 'note', 'contact', 'company', 'event',
                                                  'chat_message', 'chat_channel', 'email_thread'])) AS x) s
     WHERE t IN ('task', 'bucket', 'note', 'contact', 'company', 'event', 'chat_message', 'chat_channel',
                 'email_thread'));
  v_registry := pg_catalog.array_remove(pg_catalog.array_remove(pg_catalog.array_remove(
                  v_types, 'note'), 'chat_message'), 'chat_channel');
  v_chat := v_types && ARRAY['chat_message', 'chat_channel'];
  -- A person's context only: a key has no item open, and its creator's
  -- visibility isn't the key's scope.
  IF v_ctx_type IS NOT NULL AND p_context_id IS NOT NULL AND public.module_api_key_id() IS NULL THEN
    v_ctx := coalesce(public.perm_can_see_entity(p_workspace_id, v_ctx_type, p_context_id), false);
  END IF;

  RETURN QUERY
    WITH hits AS MATERIALIZED (
      SELECT n.entity_type, n.entity_id, n.title, n.context, n.snippet, n.icon, n.match, n.rank,
             n.updated_at, n.archived
        FROM public.notes__search(p_workspace_id, p_query, 50) n
       WHERE 'note' = ANY (v_types)
      UNION ALL
      SELECT r.entity_type, r.entity_id, r.title, r.context, r.snippet, r.icon, r.match, r.rank,
             r.updated_at, r.archived
        FROM public.registry__search(p_workspace_id, p_query, 50, v_registry) r
       WHERE cardinality(v_registry) > 0
      UNION ALL
      SELECT c.entity_type, c.entity_id, c.title, c.context, c.snippet, c.icon, c.match, c.rank,
             c.updated_at, c.archived
        FROM public.chat__search_hits(p_workspace_id, p_query, 50) c
       WHERE v_chat AND c.entity_type = ANY (v_types)
    ),
    one_all AS MATERIALIZED (
      SELECT DISTINCT ON (h.entity_type, h.entity_id) h.*,
             CASE WHEN h.match = 'handle' AND h.rank >= 1 THEN 0 WHEN h.match = 'title_fuzzy' THEN 2 ELSE 1 END AS tier
        FROM hits h
       ORDER BY h.entity_type, h.entity_id,
                CASE WHEN h.match = 'handle' AND h.rank >= 1 THEN 0 WHEN h.match = 'title_fuzzy' THEN 2 ELSE 1 END,
                h.rank DESC
    ),
    -- Typo forgiveness holds across the merged list: once 3 exact hits exist
    -- in any modules, every typo-forgiven row goes (each module decides on its
    -- own count, so a typo task could otherwise sit above exact notes).
    kept AS (
      SELECT a.*
        FROM one_all a
       WHERE a.tier < 2 OR (SELECT count(*) FROM one_all b WHERE b.tier < 2) < 3
    ),
    linked AS MATERIALIZED (
      SELECT CASE WHEN l.source_type = v_ctx_type AND l.source_id = p_context_id THEN l.target_type ELSE l.source_type END AS t,
             CASE WHEN l.source_type = v_ctx_type AND l.source_id = p_context_id THEN l.target_id ELSE l.source_id END AS id
        FROM public.entity_links l
       WHERE v_ctx
         AND l.workspace_id = p_workspace_id
         AND l.deleted_at IS NULL
         AND ((l.source_type = v_ctx_type AND l.source_id = p_context_id)
              OR (l.target_type = v_ctx_type AND l.target_id = p_context_id))
    ),
    scored AS (
      SELECT o.*,
             least(1.0, greatest(0.0,
               0.55 * o.rank
               + 0.15 * pg_catalog.power(0.5, greatest(extract(epoch FROM (now() - o.updated_at)), 0) / (30 * 86400.0))
               + 0.20 * 0
               + 0.10 * (CASE WHEN EXISTS (SELECT 1 FROM linked k WHERE k.t = o.entity_type AND k.id = o.entity_id)
                              THEN 1 ELSE 0 END)))::real AS sc,
             (count(*) OVER (PARTITION BY o.entity_type))::integer AS total
        FROM kept o
    ),
    ordered AS (
      SELECT s.*,
             row_number() OVER (ORDER BY s.tier, s.sc DESC, s.updated_at DESC, s.entity_id) AS pos,
             row_number() OVER (PARTITION BY s.entity_type ORDER BY s.tier, s.sc DESC, s.updated_at DESC, s.entity_id) AS k
        FROM scored s
    )
    SELECT o.entity_type, o.entity_id, o.title, o.context, o.snippet, o.icon, o.match, o.rank, o.updated_at,
           o.archived, o.sc, o.total, o.pos = 1
      FROM ordered o
     WHERE o.k <= v_limit
     ORDER BY o.pos;
END;
$$;

COMMENT ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) IS
  'Search (GS-3, GS-6): ⌘K''s one search. Merges every module''s <module>__search (registry__search for types not yet on the contract; chat__search_hits for messages and conversations), ranks, and returns up to limit_per_type rows per type with the type''s total and one Top result. SECURITY INVOKER: every hit comes from a module function that resolves the caller.';

-- ── 4. Grants ────────────────────────────────────────────────────────────────
-- chat__search_hits and search_all read the actor from the request:
-- signed-in people and the server (the MCP, with its key header), never anon.
-- chat__search_query stays server-only.

REVOKE ALL ON FUNCTION public.chat__search_hits(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat__search_hits(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat__search_query(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat__search_query(text) TO service_role;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.chat__search_hits(uuid, text, integer)',
                           'public.search_all(uuid, text, text[], integer, text, uuid)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be callable by authenticated and service_role, never anon.', f;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.chat__search_query(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.chat__search_query(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public.chat__search_query must not be callable by clients.';
  END IF;
END;
$$;
