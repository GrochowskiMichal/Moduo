-- GS-3: search_all and the registry adapter (specs/global-search.md AC3–AC6;
-- Assumptions 2, 5, 7, 8, 12, 18).
--
--   1. The registry gets an unaccented text index and a trigram index on its
--      labels, for the adapter below.
--   2. notes__search gains an `archived` column (Q8). Its return type changes,
--      so it is dropped and re-created, and its grants are re-stated.
--   3. registry__search(ws, query, limit, types): the adapter for every type
--      not yet on the contract (tasks and projects until GS-4, contacts,
--      companies and events until GS-5, pulled-in mail). An unaccented
--      word-start match on entities.label, a task's handle (with the
--      workspace's earlier keys), typo-forgiven labels (word_similarity ≥ 0.5,
--      only when exact matching finds fewer than 3), each type's own rule
--      (perm_can_see_entity) before the limit over at most 500 candidates per
--      type, and a key's module scopes. SECURITY DEFINER: the actor comes from
--      the request, never an argument.
--   4. search_all(ws, query, types, limit_per_type, context_type, context_id):
--      merges notes__search and registry__search, dedupes, ranks
--      (0.55·text + 0.15·recency + 0.20·personal + 0.10·context) and returns
--      up to limit_per_type rows per type (8 by default, 50 at most), the
--      type's total and one Top result. SECURITY INVOKER: it reads nothing
--      itself but the context link, and every hit comes from a module function
--      that resolves the actor, so it holds no privilege of its own.
--
-- Re-runnable: indexes IF NOT EXISTS, notes__search dropped IF EXISTS,
-- functions OR REPLACE, grants re-stated by name.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.notes__search(uuid, text, integer)') IS NULL
     OR to_regprocedure('public.search__query(text)') IS NULL THEN
    RAISE EXCEPTION 'GS-3 needs GS-1 and GS-2 (20261028220000_search_primitives.sql, 20261028230000_notes_search.sql) applied first.';
  END IF;
END;
$$;

-- ── 1. The registry's label indexes ──────────────────────────────────────────
-- Index expressions run with the writer's privileges. Nobody writes entities
-- directly: the table has only a SELECT policy, and every writer is a definer
-- (entities_op_upsert, tasks__register, the module ops), so search__unaccent
-- stays server-only. ~30k rows on the local prod snapshot.

CREATE INDEX IF NOT EXISTS entities_label_search_idx ON public.entities
  USING gin (pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(label)))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS entities_label_trgm_idx ON public.entities
  USING gin (lower(public.search__unaccent(label)) extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── 2. notes__search, with archived ──────────────────────────────────────────
-- The same function as 20261028230000_notes_search.sql, with the note's
-- is_archived as a last column.

DROP FUNCTION IF EXISTS public.notes__search(uuid, text, integer);

CREATE FUNCTION public.notes__search(p_workspace_id uuid, p_query text, p_limit integer)
  RETURNS TABLE (entity_type text, entity_id uuid, title text, context text, snippet text,
                 icon text, match text, rank real, updated_at timestamptz,
                 archived boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  -- After five calls plpgsql would switch to a generic plan, which can't see
  -- how many ids the visible set holds and reads every visible note (17 ms →
  -- 50 ms at 10k notes). Planning each call costs ~1 ms.
  SET plan_cache_mode = 'force_custom_plan'
  -- An empty websearch query ("no excluded words") notices; keep it quiet.
  SET client_min_messages = warning
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q tsquery;
  v_vis uuid[];
  v_fuzzy text;
  v_threshold text;
  v_words text[];
  v_not tsquery;
  v_ids uuid[] := '{}';
  v_ranks real[] := '{}';
  v_kinds text[] := '{}';
BEGIN
  IF v_actor IS NULL OR p_workspace_id IS NULL OR p_query IS NULL
     OR public.notes_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RETURN;
  END IF;
  v_q := public.search__query(p_query);
  IF v_q IS NULL THEN
    RETURN;
  END IF;
  v_vis := public.notes__visible_ids(p_workspace_id, v_actor);
  IF cardinality(v_vis) = 0 THEN
    RETURN;
  END IF;

  -- Exact hits: the text first (the GIN index), then visibility, both before
  -- the limit. The matches are collected on their own (MATERIALIZED) so the
  -- planner can't drive the join from the visible set (thousands of ids it
  -- guesses at 100) and test the text one note at a time.
  WITH cand AS MATERIALIZED (
    SELECT n.id, n.updated_at, n.is_archived,
           pg_catalog.ts_filter(n.search_tsv, '{a}') OPERATOR(pg_catalog.@@) v_q AS in_title
      FROM public.notes n
     WHERE n.workspace_id = p_workspace_id
       AND n.deleted_at IS NULL
       AND n.search_tsv OPERATOR(pg_catalog.@@) v_q
  ),
  vis AS MATERIALIZED (SELECT u.id FROM unnest(v_vis) AS u(id)),
  ranked AS (
    SELECT c.id, c.updated_at,
           CASE WHEN c.in_title THEN 'title' ELSE 'body' END AS kind,
           ((CASE WHEN c.in_title THEN 0.75 ELSE 0.40 END)
            - (CASE WHEN c.is_archived THEN 0.15 ELSE 0 END))::real AS rank
      FROM cand c
      JOIN vis ON vis.id = c.id
     ORDER BY 4 DESC, c.updated_at DESC, c.id
     LIMIT v_limit
  )
  SELECT coalesce(array_agg(r.id ORDER BY r.rank DESC, r.updated_at DESC, r.id), '{}'),
         coalesce(array_agg(r.rank ORDER BY r.rank DESC, r.updated_at DESC, r.id), '{}'),
         coalesce(array_agg(r.kind ORDER BY r.rank DESC, r.updated_at DESC, r.id), '{}')
    INTO v_ids, v_ranks, v_kinds
    FROM ranked r;

  -- Typo forgiveness, titles only, when exact matching found fewer than 3:
  -- the words someone typed (no quotes, no excluded words), unaccented, against
  -- the best-matching stretch of each title (word similarity ≥ 0.5). The
  -- index operator <% reads pg_trgm.word_similarity_threshold, so it is set for
  -- this one query and put back (a function's own SET of an extension setting
  -- needs a superuser on Supabase); calling pg_trgm first loads the setting.
  IF cardinality(v_ids) < 3 AND cardinality(v_ids) < v_limit THEN
    v_words := (pg_catalog.regexp_split_to_array(
      pg_catalog.translate(pg_catalog.btrim(pg_catalog.left(p_query, 256)), '"', ''), '\s+'))[1:32];
    v_fuzzy := pg_catalog.lower(public.search__unaccent(pg_catalog.array_to_string(
      ARRAY(SELECT w FROM unnest(v_words) AS w WHERE w NOT LIKE '-%'), ' ')));
    -- An excluded word still excludes ("meetng -weekly"): exact, as in search__query.
    v_not := pg_catalog.websearch_to_tsquery('pg_catalog.simple'::regconfig,
      public.search__unaccent(pg_catalog.array_to_string(
        ARRAY(SELECT pg_catalog.substr(w, 2) FROM unnest(v_words) AS w WHERE w LIKE '-_%'), ' or ')));
    IF pg_catalog.length(pg_catalog.btrim(v_fuzzy)) >= 3 THEN
      PERFORM extensions.word_similarity('', '');
      v_threshold := pg_catalog.current_setting('pg_trgm.word_similarity_threshold');
      PERFORM pg_catalog.set_config('pg_trgm.word_similarity_threshold', '0.5', true);
      WITH cand AS MATERIALIZED (
        SELECT n.id, n.updated_at,
               extensions.word_similarity(v_fuzzy, pg_catalog.lower(public.search__unaccent(n.title))) AS sim
          FROM public.notes n
         WHERE n.workspace_id = p_workspace_id
           AND n.deleted_at IS NULL
           AND v_fuzzy OPERATOR(extensions.<%) pg_catalog.lower(public.search__unaccent(n.title))
           AND (pg_catalog.numnode(v_not) = 0 OR NOT (n.search_tsv OPERATOR(pg_catalog.@@) v_not))
      ),
      vis AS MATERIALIZED (SELECT u.id FROM unnest(v_vis) AS u(id)),
      fuzzy AS (
        SELECT c.id, c.updated_at, c.sim
          FROM cand c
          JOIN vis ON vis.id = c.id
         WHERE c.sim >= 0.5
           AND NOT (c.id = ANY (v_ids))
         ORDER BY c.sim DESC, c.updated_at DESC, c.id
         LIMIT v_limit - cardinality(v_ids)
      )
      SELECT v_ids || coalesce(array_agg(f.id ORDER BY f.sim DESC, f.updated_at DESC, f.id), '{}'),
             v_ranks || coalesce(array_agg((0.2 * f.sim)::real ORDER BY f.sim DESC, f.updated_at DESC, f.id), '{}'),
             v_kinds || coalesce(array_agg('title_fuzzy'::text ORDER BY f.sim DESC, f.updated_at DESC, f.id), '{}')
        INTO v_ids, v_ranks, v_kinds
        FROM fuzzy f;
      PERFORM pg_catalog.set_config('pg_trgm.word_similarity_threshold', v_threshold, true);
    END IF;
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  -- Shape only the rows returned: the snippet (ts_headline is the costly part)
  -- and the parent path. The ancestors (at most three per hit) are found
  -- first and only they are checked against the visible set; joining the set
  -- to notes the other way round reads every visible note.
  RETURN QUERY
    WITH hits AS MATERIALIZED (
      SELECT x.id, x.rank, x.kind, x.ord
        FROM unnest(v_ids, v_ranks, v_kinds) WITH ORDINALITY AS x(id, rank, kind, ord)
    ),
    up AS MATERIALIZED (
      SELECT a.id
        FROM hits h
        JOIN public.notes n ON n.id = h.id
        LEFT JOIN public.notes q1 ON q1.id = n.parent_id
        LEFT JOIN public.notes q2 ON q2.id = q1.parent_id
       CROSS JOIN LATERAL unnest(ARRAY[n.parent_id, q1.parent_id, q2.parent_id]) AS a(id)
       WHERE a.id IS NOT NULL
    ),
    vis AS MATERIALIZED (SELECT u.id FROM unnest(v_vis) AS u(id)),
    seen AS MATERIALIZED (SELECT DISTINCT up.id FROM up JOIN vis ON vis.id = up.id)
    SELECT 'note'::text,
           n.id,
           n.title,
           CASE
             WHEN p1.id IS NULL THEN NULL
             WHEN p2.id IS NULL THEN coalesce(nullif(pg_catalog.btrim(p1.title), ''), 'Untitled')
             ELSE CASE WHEN p3.id IS NOT NULL THEN '… / ' ELSE '' END
                  || coalesce(nullif(pg_catalog.btrim(p2.title), ''), 'Untitled') || ' / '
                  || coalesce(nullif(pg_catalog.btrim(p1.title), ''), 'Untitled')
           END,
           CASE WHEN h.kind = 'body' THEN public.search__snippet(n.body_text, v_q) END,
           n.icon,
           h.kind,
           h.rank,
           n.updated_at,
           n.is_archived
      FROM hits h
      JOIN public.notes n ON n.id = h.id
      LEFT JOIN public.notes p1 ON p1.id = n.parent_id AND p1.deleted_at IS NULL
                                AND p1.id IN (SELECT seen.id FROM seen)
      LEFT JOIN public.notes p2 ON p1.id IS NOT NULL AND p2.id = p1.parent_id AND p2.deleted_at IS NULL
                                AND p2.id IN (SELECT seen.id FROM seen)
      LEFT JOIN public.notes p3 ON p2.id IS NOT NULL AND p3.id = p2.parent_id AND p3.deleted_at IS NULL
                                AND p3.id IN (SELECT seen.id FROM seen)
     ORDER BY h.ord;
END;
$$;

COMMENT ON FUNCTION public.notes__search(uuid, text, integer) IS
  'Search (GS-2, GS-3): the notes the caller can open that match the query, as SearchHit rows with archived (at most 50). The actor comes from the request, never an argument.';

-- ── 3. registry__search ──────────────────────────────────────────────────────
-- Rank bands, as notes__search's (0..1, the SearchHit contract):
--   a task's exact handle  1.00
--   label, live            0.75      label, archived (a task in an archived
--                                    project, an archived project)  0.60
--   typo in a label        0.10 – 0.20 (0.2 × word similarity, at least 0.5)
-- The limit is per type, so one busy type never crowds out another. Types it
-- answers: task, bucket (projects; 'project' is read as bucket), contact,
-- company, event, email_thread (owner-only), chat_channel. Never note: notes
-- are on the contract.

CREATE OR REPLACE FUNCTION public.registry__search(p_workspace_id uuid, p_query text, p_limit integer,
                                                   p_types text[] DEFAULT NULL)
  RETURNS TABLE (entity_type text, entity_id uuid, title text, context text, snippet text,
                 icon text, match text, rank real, updated_at timestamptz, archived boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  SET plan_cache_mode = 'force_custom_plan'
  SET client_min_messages = warning
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_key uuid := public.module_api_key_id();
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 50);
  v_types text[];
  v_q tsquery;
  v_m text[];
  v_task_key text;
  v_aliases text[];
  v_handle text;
  v_exact integer := 0;
  v_words text[];
  v_fuzzy text;
  v_not tsquery;
  v_threshold text;
  r record;
  v_type text;
  v_seen integer := 0;
  v_kept integer := 0;
BEGIN
  IF v_actor IS NULL OR p_workspace_id IS NULL OR p_query IS NULL THEN
    RETURN;
  END IF;
  -- A person answers for a workspace they belong to; a key only for its own.
  IF v_key IS NULL THEN
    IF NOT (public.perm_is_owner(p_workspace_id, v_actor)
            OR EXISTS (SELECT 1 FROM public.workspace_members m
                        WHERE m.workspace_id = p_workspace_id AND m.user_id = v_actor)) THEN
      RETURN;
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM public.workspace_api_keys k
                     WHERE k.id = v_key AND k.workspace_id = p_workspace_id AND k.revoked_at IS NULL
                       AND (k.expires_at IS NULL OR k.expires_at > now())) THEN
    RETURN;
  END IF;

  v_types := ARRAY(
    SELECT DISTINCT t
      FROM (SELECT CASE lower(btrim(x)) WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread'
                                        ELSE lower(btrim(x)) END AS t
              FROM unnest(coalesce(p_types, ARRAY['task', 'bucket', 'contact', 'company', 'event',
                                                  'email_thread', 'chat_channel'])) AS x) s
     WHERE t IN ('task', 'bucket', 'contact', 'company', 'event', 'email_thread', 'chat_channel'));
  -- A key sees a type only through its module scope (and its person's access,
  -- which perm_can_see_entity applies per row). Chat never answers a key here
  -- (perm_can_see_entity refuses it; GS-6 brings chat__key_channel_ids).
  IF v_key IS NOT NULL THEN
    v_types := ARRAY(
      SELECT s.t
        FROM (SELECT x AS t,
                     CASE x WHEN 'task' THEN 'tasks' WHEN 'bucket' THEN 'tasks'
                            WHEN 'contact' THEN 'contacts' WHEN 'company' THEN 'contacts'
                            WHEN 'event' THEN 'calendar' WHEN 'email_thread' THEN 'email'
                            WHEN 'chat_channel' THEN 'chat' END AS m
                FROM unnest(v_types) AS x) s
       WHERE s.m IS NOT NULL
         AND public.module_api_key_scope(p_workspace_id, s.m, s.m) IN ('view', 'edit'));
  END IF;
  IF cardinality(v_types) = 0 THEN
    RETURN;
  END IF;

  v_q := public.search__query(p_query);

  -- A task's ID: "MOD-142", "mod 142", or one typed with an earlier key.
  v_m := pg_catalog.regexp_match(pg_catalog.btrim(pg_catalog.left(p_query, 256)), '^([A-Za-z]{2,5})[- ]?([0-9]{1,9})$');
  IF v_m IS NOT NULL AND 'task' = ANY (v_types) THEN
    SELECT w.task_key, w.task_key_aliases INTO v_task_key, v_aliases
      FROM public.workspaces w WHERE w.id = p_workspace_id;
    v_handle := pg_catalog.upper(v_m[1]);
    IF v_handle IS DISTINCT FROM v_task_key
       AND v_handle = ANY (ARRAY(SELECT pg_catalog.upper(a) FROM unnest(coalesce(v_aliases, '{}')) AS a)) THEN
      v_handle := v_task_key;
    END IF;
    v_handle := v_handle || '-' || (v_m[2]::bigint)::text;
  END IF;

  IF v_q IS NULL AND v_handle IS NULL THEN
    RETURN;
  END IF;

  -- Exact hits: text (or the handle) first, then each type's own rule, both
  -- before the limit. The matches are walked best first (handle, live,
  -- archived; newer first) and checked one by one, stopping for a type once it
  -- has its limit of visible rows or after 500 candidates: a per-row check
  -- costs ~0.2 ms, so checking every match of a common word-start would cost
  -- far more than the few that are shown.
  FOR r IN
    WITH cand AS MATERIALIZED (
      SELECT e.entity_type, e.entity_id, e.label, e.icon, e.updated_at, 'title'::text AS kind
        FROM public.entities e
       WHERE v_q IS NOT NULL
         AND e.workspace_id = p_workspace_id
         AND e.deleted_at IS NULL
         AND e.entity_type = ANY (v_types)
         AND pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(e.label))
             OPERATOR(pg_catalog.@@) v_q
      UNION ALL
      SELECT e.entity_type, e.entity_id, e.label, e.icon, e.updated_at, 'handle'::text
        FROM public.entities e
       WHERE v_handle IS NOT NULL
         AND e.workspace_id = p_workspace_id
         AND e.entity_type = 'task'
         AND e.deleted_at IS NULL
         AND e.handle = v_handle
    ),
    one AS (
      SELECT DISTINCT ON (c.entity_type, c.entity_id) c.*
        FROM cand c
       ORDER BY c.entity_type, c.entity_id, (c.kind = 'handle') DESC
    ),
    flagged AS (
      SELECT o.*,
             CASE o.entity_type
               WHEN 'task' THEN EXISTS (SELECT 1 FROM public.tasks t JOIN public.buckets b ON b.id = t.bucket_id
                                         WHERE t.id = o.entity_id AND b.archived_at IS NOT NULL)
               WHEN 'bucket' THEN EXISTS (SELECT 1 FROM public.buckets b
                                           WHERE b.id = o.entity_id AND b.archived_at IS NOT NULL)
               ELSE false
             END AS is_archived
        FROM one o
    )
    SELECT f.entity_type, f.entity_id, f.label, f.icon, f.updated_at, f.kind, f.is_archived,
           (CASE WHEN f.kind = 'handle' THEN 1.0 WHEN f.is_archived THEN 0.60 ELSE 0.75 END)::real AS band
      FROM flagged f
     ORDER BY f.entity_type, 8 DESC, f.updated_at DESC, f.entity_id
  LOOP
    IF r.entity_type IS DISTINCT FROM v_type THEN
      v_type := r.entity_type;
      v_seen := 0;
      v_kept := 0;
    END IF;
    CONTINUE WHEN v_kept >= v_limit OR v_seen >= 500;
    v_seen := v_seen + 1;
    IF public.perm_can_see_entity(p_workspace_id, r.entity_type, r.entity_id) THEN
      v_kept := v_kept + 1;
      entity_type := r.entity_type;
      entity_id := r.entity_id;
      title := r.label;
      context := NULL;
      snippet := NULL;
      icon := r.icon;
      match := r.kind;
      rank := r.band;
      updated_at := r.updated_at;
      archived := r.is_archived;
      v_exact := v_exact + 1;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Typo forgiveness, as notes__search's: when exact matching found fewer than
  -- 3, the typed words (no quotes, no excluded words) against the
  -- best-matching stretch of each label, word similarity ≥ 0.5; an excluded
  -- word still excludes, and fuzzy hits rank below every exact one.
  IF v_exact >= 3 OR v_exact >= v_limit THEN
    RETURN;
  END IF;
  v_words := (pg_catalog.regexp_split_to_array(
    pg_catalog.translate(pg_catalog.btrim(pg_catalog.left(p_query, 256)), '"', ''), '\s+'))[1:32];
  v_fuzzy := pg_catalog.lower(public.search__unaccent(pg_catalog.array_to_string(
    ARRAY(SELECT w FROM unnest(v_words) AS w WHERE w NOT LIKE '-%'), ' ')));
  IF pg_catalog.length(pg_catalog.btrim(coalesce(v_fuzzy, ''))) < 3 THEN
    RETURN;
  END IF;
  v_not := pg_catalog.websearch_to_tsquery('pg_catalog.simple'::regconfig,
    public.search__unaccent(pg_catalog.array_to_string(
      ARRAY(SELECT pg_catalog.substr(w, 2) FROM unnest(v_words) AS w WHERE w LIKE '-_%'), ' or ')));

  PERFORM extensions.word_similarity('', '');
  v_threshold := pg_catalog.current_setting('pg_trgm.word_similarity_threshold');
  PERFORM pg_catalog.set_config('pg_trgm.word_similarity_threshold', '0.5', true);
  v_type := NULL;
  FOR r IN
    WITH cand AS MATERIALIZED (
      SELECT e.entity_type, e.entity_id, e.label, e.icon, e.updated_at,
             extensions.word_similarity(v_fuzzy, pg_catalog.lower(public.search__unaccent(e.label))) AS sim
        FROM public.entities e
       WHERE e.workspace_id = p_workspace_id
         AND e.deleted_at IS NULL
         AND e.entity_type = ANY (v_types)
         AND v_fuzzy OPERATOR(extensions.<%) pg_catalog.lower(public.search__unaccent(e.label))
         AND (v_q IS NULL OR NOT (pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(e.label))
                                   OPERATOR(pg_catalog.@@) v_q))
         AND (pg_catalog.numnode(v_not) = 0
              OR NOT (pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(e.label))
                      OPERATOR(pg_catalog.@@) v_not))
    )
    SELECT c.*
      FROM cand c
     WHERE c.sim >= 0.5
     ORDER BY c.entity_type, c.sim DESC, c.updated_at DESC, c.entity_id
  LOOP
    IF r.entity_type IS DISTINCT FROM v_type THEN
      v_type := r.entity_type;
      v_seen := 0;
      v_kept := 0;
    END IF;
    CONTINUE WHEN v_kept >= v_limit - v_exact OR v_seen >= 500;
    v_seen := v_seen + 1;
    IF public.perm_can_see_entity(p_workspace_id, r.entity_type, r.entity_id) THEN
      v_kept := v_kept + 1;
      entity_type := r.entity_type;
      entity_id := r.entity_id;
      title := r.label;
      context := NULL;
      snippet := NULL;
      icon := r.icon;
      match := 'title_fuzzy';
      rank := (0.2 * r.sim)::real;
      updated_at := r.updated_at;
      archived := CASE r.entity_type
        WHEN 'task' THEN EXISTS (SELECT 1 FROM public.tasks t JOIN public.buckets b ON b.id = t.bucket_id
                                  WHERE t.id = r.entity_id AND b.archived_at IS NOT NULL)
        WHEN 'bucket' THEN EXISTS (SELECT 1 FROM public.buckets b
                                    WHERE b.id = r.entity_id AND b.archived_at IS NOT NULL)
        ELSE false
      END;
      RETURN NEXT;
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('pg_trgm.word_similarity_threshold', v_threshold, true);
END;
$$;

COMMENT ON FUNCTION public.registry__search(uuid, text, integer, text[]) IS
  'Search (GS-3): the registry adapter for types not yet on the contract, as SearchHit rows with archived, at most 50 per type, each visible to the caller. The actor comes from the request, never an argument.';

-- ── 4. search_all ────────────────────────────────────────────────────────────
-- score = 0.55·text + 0.15·recency + 0.20·personal + 0.10·context, where text
-- is the module's rank, recency halves every 30 days since updated_at,
-- personal is 0 until GS-8, and context is 1 for a hit with a live spine link
-- to the item open now (checked for visibility first; either direction).
-- Order is tiered first so the score never overturns two promises: a task's
-- exact handle leads (AC6), and a typo-forgiven title never ranks above an
-- exact hit (Assumption 5). Inside a tier, the score.
--
-- Every module is asked for its 50 best (the most a type can show), so the
-- type's total ("Show all N") counts what you can see, capped at 50; then
-- each type is cut to limit_per_type. The first row is the Top result.
--
-- statement_timeout: Postgres ignores a function's own SET of it for the
-- statement already running, but PostgREST applies it to the request
-- (db-hoisted-tx-settings), which is how the app and the MCP call this.

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
  v_ctx_type text := CASE lower(btrim(coalesce(p_context_type, '')))
                       WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread'
                       ELSE nullif(lower(btrim(coalesce(p_context_type, ''))), '') END;
  v_ctx boolean := false;
BEGIN
  IF p_workspace_id IS NULL OR pg_catalog.length(pg_catalog.btrim(coalesce(p_query, ''))) < 2 THEN
    RETURN;
  END IF;
  -- The palette's types (chat joins with GS-6).
  v_types := ARRAY(
    SELECT DISTINCT t
      FROM (SELECT CASE lower(btrim(x)) WHEN 'project' THEN 'bucket' WHEN 'email' THEN 'email_thread'
                                        ELSE lower(btrim(x)) END AS t
              FROM unnest(coalesce(p_types, ARRAY['task', 'bucket', 'note', 'contact', 'company', 'event',
                                                  'email_thread'])) AS x) s
     WHERE t IN ('task', 'bucket', 'note', 'contact', 'company', 'event', 'email_thread'));
  v_registry := pg_catalog.array_remove(v_types, 'note');
  IF v_ctx_type IS NOT NULL AND p_context_id IS NOT NULL THEN
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
    ),
    one AS (
      SELECT DISTINCT ON (h.entity_type, h.entity_id) h.*,
             CASE WHEN h.match = 'handle' AND h.rank >= 1 THEN 0 WHEN h.match = 'title_fuzzy' THEN 2 ELSE 1 END AS tier
        FROM hits h
       ORDER BY h.entity_type, h.entity_id,
                CASE WHEN h.match = 'handle' AND h.rank >= 1 THEN 0 WHEN h.match = 'title_fuzzy' THEN 2 ELSE 1 END,
                h.rank DESC
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
        FROM one o
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
  'Search (GS-3): ⌘K''s one search. Merges every module''s <module>__search (registry__search for types not yet on the contract), ranks, and returns up to limit_per_type rows per type with the type''s total and one Top result. SECURITY INVOKER: every hit comes from a module function that resolves the caller.';

-- ── 5. Grants ────────────────────────────────────────────────────────────────
-- All three read the actor from the request: signed-in people and the server
-- (the MCP, with its key header) may call them, never anon.

REVOKE ALL ON FUNCTION public.notes__search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes__search(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.registry__search(uuid, text, integer, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registry__search(uuid, text, integer, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) TO authenticated, service_role;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.notes__search(uuid, text, integer)',
                           'public.registry__search(uuid, text, integer, text[])',
                           'public.search_all(uuid, text, text[], integer, text, uuid)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be callable by authenticated and service_role, never anon.', f;
    END IF;
  END LOOP;
END;
$$;
