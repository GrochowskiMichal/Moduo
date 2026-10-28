-- GS-4: tasks and projects on the search contract (specs/global-search.md
-- AC1–AC4, AC6, AC8; Assumptions 5, 6, 7, 11, 13).
--
--   1. Writers may run search__unaccent and the new tasks__plain_text: the app
--      writes tasks directly, and an index expression runs its functions with
--      the writer's privileges. Both are pure (they read only their argument).
--   2. Tasks get a text index (title A, the description with its HTML stripped
--      B, an import's key C; unaccented, `simple`) and a title trigram index.
--      Expression indexes, not a stored column: the app reads tasks with
--      select=*, and a tsvector column would travel to every device.
--   3. tasks__hits(ws, query, limit): the one tasks matcher. The handle first
--      (with the workspace's earlier keys), then text hits, then typo-forgiven
--      titles; tasks__visible_to on each candidate before the limit, at most
--      500 candidates. Server-only; the two below call it.
--   4. tasks__search(ws, query, limit): the contract (SearchHit + archived, at
--      most 50), the project as context when you can see it.
--   5. tasks_search(ws, query, limit): the app's and the MCP's RPC, same
--      signature, now its ids (exact matches only, at most 200).
--   6. projects__search(ws, query, limit): projects as entity_type bucket.
--   7. Projects are registered on create, rename, trash and restore (a trigger,
--      so the ops, duplicates and the app's direct writes all count), with a
--      backfill.
--   8. search_all asks tasks__search and projects__search instead of the
--      registry adapter for task and bucket.
--
-- Re-runnable: indexes IF NOT EXISTS, functions OR REPLACE, the trigger
-- dropped IF EXISTS, the backfill idempotent, grants re-stated by name.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.registry__search(uuid, text, integer, text[])') IS NULL
     OR to_regprocedure('public.search_all(uuid, text, text[], integer, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'GS-4 needs GS-3 (20261029090000_search_all.sql) applied first.';
  END IF;
END;
$$;

-- ── 1. The pure helpers ──────────────────────────────────────────────────────
-- A description as text: the editor stores HTML, so a reference's stored text
-- goes, tags go and the common entities are decoded (tasks_search's rules
-- since TV-D11b, and the app's descriptionText). Plain text stays as it is.

CREATE OR REPLACE FUNCTION public.tasks__plain_text(p_text text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = ''
AS $$
  SELECT CASE
           WHEN p_text ~ '^\s*<' THEN
             pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
               pg_catalog.regexp_replace(
                 pg_catalog.regexp_replace(p_text,
                   '<span[^>]*data-lexical-entity-ref[^>]*>[^<]*</span>', ' ', 'g'),
                 '<[^>]*>', ' ', 'g'),
               '&nbsp;', ' '), '&quot;', '"'), '&#39;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
           ELSE p_text
         END
$$;

COMMENT ON FUNCTION public.tasks__plain_text(text) IS
  'Search (GS-4): a task''s or project''s description as plain text (HTML stripped, references dropped, entities decoded). Pure; writers run it through the tasks search index.';

-- ── 2. The tasks indexes ─────────────────────────────────────────────────────
-- tasks__hits repeats this expression word for word, so the planner uses the
-- index; change one, change the other.

CREATE INDEX IF NOT EXISTS tasks_search_idx ON public.tasks USING gin ((
  pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(title)), 'A')
  || pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
       public.search__unaccent(pg_catalog.left(public.tasks__plain_text(description), 150000))), 'B')
  || pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
       public.search__unaccent(coalesce(imported_from ->> 'key', ''))), 'C')))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_title_trgm_idx ON public.tasks
  USING gin (pg_catalog.lower(public.search__unaccent(title)) extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ── 3. tasks__hits ───────────────────────────────────────────────────────────
-- Rank bands (0..1, as notes__search's):
--   the exact handle   1.00
--   title              0.75      body (description, import key)  0.40
--   archived (a task in an archived project)  −0.15, except the handle
--   typo in a title    0.10 – 0.20 (0.2 × word similarity, at least 0.5)

CREATE OR REPLACE FUNCTION public.tasks__hits(p_workspace_id uuid, p_query text, p_limit integer)
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
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 200);
  v_q tsquery;
  v_m text[];
  v_task_key text;
  v_aliases text[];
  v_num bigint;
  v_words text[];
  v_fuzzy text;
  v_not tsquery;
  v_threshold text;
  v_ids uuid[] := '{}';
  v_ranks real[] := '{}';
  v_kinds text[] := '{}';
  v_seen integer := 0;
  r record;
BEGIN
  IF v_actor IS NULL OR p_workspace_id IS NULL OR p_query IS NULL
     OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RETURN;
  END IF;
  v_q := public.search__query(p_query);

  -- A task's ID: "MOD-142", "mod 142", or one typed with an earlier key.
  v_m := pg_catalog.regexp_match(pg_catalog.btrim(pg_catalog.left(p_query, 256)), '^([A-Za-z]{2,5})[- ]?([0-9]{1,9})$');
  IF v_m IS NOT NULL THEN
    SELECT w.task_key, w.task_key_aliases INTO v_task_key, v_aliases
      FROM public.workspaces w WHERE w.id = p_workspace_id;
    IF pg_catalog.upper(v_m[1]) = pg_catalog.upper(v_task_key)
       OR pg_catalog.upper(v_m[1]) = ANY (ARRAY(SELECT pg_catalog.upper(a) FROM unnest(coalesce(v_aliases, '{}')) AS a)) THEN
      v_num := v_m[2]::bigint;
    END IF;
  END IF;

  IF v_q IS NULL AND v_num IS NULL THEN
    RETURN;
  END IF;

  -- Exact hits: the text (the GIN index) or the handle first, then each
  -- task's own rule, both before the limit. Walked best first and checked one
  -- by one, stopping at the limit or after 500 candidates (a check costs
  -- ~0.2 ms; a common word-start can match thousands).
  FOR r IN
    WITH cand AS MATERIALIZED (
      SELECT t.id, t.bucket_id, t.updated_at, false AS is_handle,
             pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(t.title))
               OPERATOR(pg_catalog.@@) v_q AS in_title
        FROM public.tasks t
       WHERE v_q IS NOT NULL
         AND t.workspace_id = p_workspace_id
         AND t.deleted_at IS NULL
         AND (pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(t.title)), 'A')
              || pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
                   public.search__unaccent(pg_catalog.left(public.tasks__plain_text(t.description), 150000))), 'B')
              || pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
                   public.search__unaccent(coalesce(t.imported_from ->> 'key', ''))), 'C'))
             OPERATOR(pg_catalog.@@) v_q
      UNION ALL
      SELECT t.id, t.bucket_id, t.updated_at, true, true
        FROM public.tasks t
       WHERE v_num IS NOT NULL
         AND t.workspace_id = p_workspace_id
         AND t.number = v_num
         AND t.deleted_at IS NULL
    ),
    one AS (
      SELECT DISTINCT ON (c.id) c.*
        FROM cand c
       ORDER BY c.id, c.is_handle DESC
    )
    SELECT o.id,
           CASE WHEN o.is_handle THEN 'handle' WHEN o.in_title THEN 'title' ELSE 'body' END AS kind,
           (CASE WHEN o.is_handle THEN 1.0
                 ELSE (CASE WHEN o.in_title THEN 0.75 ELSE 0.40 END)
                      - (CASE WHEN b.archived_at IS NOT NULL THEN 0.15 ELSE 0 END)
            END)::real AS band
      FROM one o
      JOIN public.buckets b ON b.id = o.bucket_id AND b.deleted_at IS NULL
     ORDER BY 3 DESC, o.updated_at DESC, o.id
  LOOP
    EXIT WHEN cardinality(v_ids) >= v_limit OR v_seen >= 500;
    v_seen := v_seen + 1;
    IF public.tasks__visible_to(r.id, v_actor) THEN
      v_ids := v_ids || r.id;
      v_ranks := v_ranks || r.band;
      v_kinds := v_kinds || r.kind;
    END IF;
  END LOOP;

  -- Typo forgiveness, titles only, as notes__search's: when exact matching
  -- found fewer than 3, the typed words (no quotes, no excluded words) against
  -- the best-matching stretch of each title, word similarity ≥ 0.5; an
  -- excluded word still excludes, and these rank below every exact hit.
  IF cardinality(v_ids) < 3 AND cardinality(v_ids) < v_limit THEN
    v_words := (pg_catalog.regexp_split_to_array(
      pg_catalog.translate(pg_catalog.btrim(pg_catalog.left(p_query, 256)), '"', ''), '\s+'))[1:32];
    v_fuzzy := pg_catalog.lower(public.search__unaccent(pg_catalog.array_to_string(
      ARRAY(SELECT w FROM unnest(v_words) AS w WHERE w NOT LIKE '-%'), ' ')));
    v_not := pg_catalog.websearch_to_tsquery('pg_catalog.simple'::regconfig,
      public.search__unaccent(pg_catalog.array_to_string(
        ARRAY(SELECT pg_catalog.substr(w, 2) FROM unnest(v_words) AS w WHERE w LIKE '-_%'), ' or ')));
    IF pg_catalog.length(pg_catalog.btrim(coalesce(v_fuzzy, ''))) >= 3 THEN
      PERFORM extensions.word_similarity('', '');
      v_threshold := pg_catalog.current_setting('pg_trgm.word_similarity_threshold');
      PERFORM pg_catalog.set_config('pg_trgm.word_similarity_threshold', '0.5', true);
      v_seen := 0;
      FOR r IN
        WITH cand AS MATERIALIZED (
          SELECT t.id, t.updated_at, t.bucket_id,
                 extensions.word_similarity(v_fuzzy, pg_catalog.lower(public.search__unaccent(t.title))) AS sim
            FROM public.tasks t
           WHERE t.workspace_id = p_workspace_id
             AND t.deleted_at IS NULL
             AND v_fuzzy OPERATOR(extensions.<%) pg_catalog.lower(public.search__unaccent(t.title))
        )
        SELECT c.id, c.sim
          FROM cand c
          JOIN public.tasks t ON t.id = c.id
          JOIN public.buckets b ON b.id = c.bucket_id AND b.deleted_at IS NULL
         WHERE c.sim >= 0.5
           AND NOT (c.id = ANY (v_ids))
           AND (pg_catalog.numnode(v_not) = 0
                OR NOT ((pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(t.title))
                         || pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
                              public.search__unaccent(pg_catalog.left(public.tasks__plain_text(t.description), 150000))))
                        OPERATOR(pg_catalog.@@) v_not))
         ORDER BY c.sim DESC, c.updated_at DESC, c.id
      LOOP
        EXIT WHEN cardinality(v_ids) >= v_limit OR v_seen >= 500;
        v_seen := v_seen + 1;
        IF public.tasks__visible_to(r.id, v_actor) THEN
          v_ids := v_ids || r.id;
          v_ranks := v_ranks || (0.2 * r.sim)::real;
          v_kinds := v_kinds || 'title_fuzzy'::text;
        END IF;
      END LOOP;
      PERFORM pg_catalog.set_config('pg_trgm.word_similarity_threshold', v_threshold, true);
    END IF;
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  -- Shape only the rows returned: the snippet for body hits and the project's
  -- name when the caller can see the project.
  RETURN QUERY
    SELECT 'task'::text,
           t.id,
           coalesce(nullif(pg_catalog.btrim(t.title), ''), 'Untitled'),
           CASE WHEN public.projects__visible_to(b.id, v_actor) THEN nullif(pg_catalog.btrim(b.name), '') END,
           CASE WHEN x.kind = 'body' THEN public.search__snippet(public.tasks__plain_text(t.description), v_q) END,
           'task'::text,
           x.kind,
           x.rank,
           t.updated_at,
           b.archived_at IS NOT NULL
      FROM unnest(v_ids, v_ranks, v_kinds) WITH ORDINALITY AS x(id, rank, kind, ord)
      JOIN public.tasks t ON t.id = x.id
      JOIN public.buckets b ON b.id = t.bucket_id
     ORDER BY x.ord;
END;
$$;

COMMENT ON FUNCTION public.tasks__hits(uuid, text, integer) IS
  'Search (GS-4): the tasks the caller can open that match the query, as SearchHit rows (at most 200). Server-only: tasks__search and tasks_search call it. The actor comes from the request, never an argument.';

-- ── 4. tasks__search ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tasks__search(p_workspace_id uuid, p_query text, p_limit integer)
  RETURNS TABLE (entity_type text, entity_id uuid, title text, context text, snippet text,
                 icon text, match text, rank real, updated_at timestamptz, archived boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT h.entity_type, h.entity_id, h.title, h.context, h.snippet, h.icon, h.match, h.rank,
         h.updated_at, h.archived
    FROM public.tasks__hits(p_workspace_id, p_query, least(greatest(coalesce(p_limit, 20), 1), 50)) h
$$;

COMMENT ON FUNCTION public.tasks__search(uuid, text, integer) IS
  'Search (GS-4): the tasks the caller can open that match the query, as SearchHit rows with archived (at most 50): the handle first, the project as context. The actor comes from the request, never an argument.';

-- ── 5. tasks_search, backed by it ────────────────────────────────────────────
-- Same signature and answer (ids, best first) for the app's store and the
-- MCP's tasks_search. Matching moves from substrings to the contract's
-- word-starts (the same everywhere), the handle comes first, and typo matches
-- stay out: callers read these ids as "matches every word".

CREATE OR REPLACE FUNCTION public.tasks_search(p_workspace_id uuid, p_query text, p_limit integer DEFAULT 200)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT h.entity_id
    FROM public.tasks__hits(p_workspace_id, p_query, least(greatest(coalesce(p_limit, 200), 1), 200)) h
   WHERE h.match <> 'title_fuzzy'
$$;

-- ── 6. projects__search ──────────────────────────────────────────────────────
-- A workspace holds tens to hundreds of projects, so no index: the name (A)
-- and the description (B) are matched on the fly. Bands as tasks'. The system
-- Inbox is never a result. Context: the project's group (its area's name).

CREATE OR REPLACE FUNCTION public.projects__search(p_workspace_id uuid, p_query text, p_limit integer)
  RETURNS TABLE (entity_type text, entity_id uuid, title text, context text, snippet text,
                 icon text, match text, rank real, updated_at timestamptz, archived boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  SET client_min_messages = warning
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q tsquery;
  v_words text[];
  v_fuzzy text;
  v_not tsquery;
  v_ids uuid[] := '{}';
  v_ranks real[] := '{}';
  v_kinds text[] := '{}';
  v_seen integer := 0;
  r record;
BEGIN
  IF v_actor IS NULL OR p_workspace_id IS NULL OR p_query IS NULL
     OR public.tasks_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RETURN;
  END IF;
  v_q := public.search__query(p_query);
  IF v_q IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    WITH cand AS MATERIALIZED (
      SELECT b.id, b.updated_at, b.archived_at,
             pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(b.name))
               OPERATOR(pg_catalog.@@) v_q AS in_title
        FROM public.buckets b
       WHERE b.workspace_id = p_workspace_id
         AND b.deleted_at IS NULL
         AND NOT b.is_system
         AND (pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(b.name)), 'A')
              || pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
                   public.search__unaccent(pg_catalog.left(public.tasks__plain_text(b.description), 150000))), 'B'))
             OPERATOR(pg_catalog.@@) v_q
    )
    SELECT c.id,
           CASE WHEN c.in_title THEN 'title' ELSE 'body' END AS kind,
           ((CASE WHEN c.in_title THEN 0.75 ELSE 0.40 END)
            - (CASE WHEN c.archived_at IS NOT NULL THEN 0.15 ELSE 0 END))::real AS band
      FROM cand c
     ORDER BY 3 DESC, c.updated_at DESC, c.id
  LOOP
    EXIT WHEN cardinality(v_ids) >= v_limit OR v_seen >= 500;
    v_seen := v_seen + 1;
    IF public.projects__visible_to(r.id, v_actor) THEN
      v_ids := v_ids || r.id;
      v_ranks := v_ranks || r.band;
      v_kinds := v_kinds || r.kind;
    END IF;
  END LOOP;

  -- Typo forgiveness on names, as tasks__hits'.
  IF cardinality(v_ids) < 3 AND cardinality(v_ids) < v_limit THEN
    v_words := (pg_catalog.regexp_split_to_array(
      pg_catalog.translate(pg_catalog.btrim(pg_catalog.left(p_query, 256)), '"', ''), '\s+'))[1:32];
    v_fuzzy := pg_catalog.lower(public.search__unaccent(pg_catalog.array_to_string(
      ARRAY(SELECT w FROM unnest(v_words) AS w WHERE w NOT LIKE '-%'), ' ')));
    v_not := pg_catalog.websearch_to_tsquery('pg_catalog.simple'::regconfig,
      public.search__unaccent(pg_catalog.array_to_string(
        ARRAY(SELECT pg_catalog.substr(w, 2) FROM unnest(v_words) AS w WHERE w LIKE '-_%'), ' or ')));
    IF pg_catalog.length(pg_catalog.btrim(coalesce(v_fuzzy, ''))) >= 3 THEN
      v_seen := 0;
      FOR r IN
        SELECT s.id, s.sim
          FROM (SELECT b.id, b.updated_at, b.name, b.description,
                       extensions.word_similarity(v_fuzzy, pg_catalog.lower(public.search__unaccent(b.name))) AS sim
                  FROM public.buckets b
                 WHERE b.workspace_id = p_workspace_id
                   AND b.deleted_at IS NULL
                   AND NOT b.is_system) s
         WHERE s.sim >= 0.5
           AND NOT (s.id = ANY (v_ids))
           AND (pg_catalog.numnode(v_not) = 0
                OR NOT ((pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(s.name))
                         || pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
                              public.search__unaccent(public.tasks__plain_text(s.description))))
                        OPERATOR(pg_catalog.@@) v_not))
         ORDER BY s.sim DESC, s.updated_at DESC, s.id
      LOOP
        EXIT WHEN cardinality(v_ids) >= v_limit OR v_seen >= 500;
        v_seen := v_seen + 1;
        IF public.projects__visible_to(r.id, v_actor) THEN
          v_ids := v_ids || r.id;
          v_ranks := v_ranks || (0.2 * r.sim)::real;
          v_kinds := v_kinds || 'title_fuzzy'::text;
        END IF;
      END LOOP;
    END IF;
  END IF;

  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT 'bucket'::text,
           b.id,
           coalesce(nullif(pg_catalog.btrim(b.name), ''), 'Untitled'),
           nullif(pg_catalog.btrim(b.group_label), ''),
           CASE WHEN x.kind = 'body' THEN public.search__snippet(public.tasks__plain_text(b.description), v_q) END,
           NULL::text,
           x.kind,
           x.rank,
           b.updated_at,
           b.archived_at IS NOT NULL
      FROM unnest(v_ids, v_ranks, v_kinds) WITH ORDINALITY AS x(id, rank, kind, ord)
      JOIN public.buckets b ON b.id = x.id
     ORDER BY x.ord;
END;
$$;

COMMENT ON FUNCTION public.projects__search(uuid, text, integer) IS
  'Search (GS-4): the projects the caller can open that match the query, as SearchHit rows (entity_type bucket) with archived (at most 50). The actor comes from the request, never an argument.';

-- ── 7. The project registry ──────────────────────────────────────────────────
-- Projects entered the registry only when first linked, and kept that label
-- (spec Assumption 13). A trigger keeps it current for every writer: the ops,
-- a duplicate, and the app's direct inserts. The system Inbox is never
-- registered.

CREATE OR REPLACE FUNCTION public.buckets__registry_sync()
  RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF NEW.is_system THEN
    RETURN NULL;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL THEN
      UPDATE public.entities e
         SET deleted_at = now(), updated_at = now()
       WHERE e.workspace_id = NEW.workspace_id AND e.entity_type = 'bucket'
         AND e.entity_id = NEW.id AND e.deleted_at IS NULL;
    END IF;
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' OR OLD.deleted_at IS NOT NULL OR NEW.name IS DISTINCT FROM OLD.name THEN
    PERFORM public.entities_op_upsert(NEW.workspace_id, 'bucket', NEW.id, NEW.name, NULL);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS buckets_registry_sync ON public.buckets;
CREATE TRIGGER buckets_registry_sync
  AFTER INSERT OR UPDATE OF name, deleted_at ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.buckets__registry_sync();

-- The backfill: every live project under its current name; trashed projects
-- out. A data fix, so it writes the registry directly; only rows that differ.
INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, updated_at)
SELECT b.workspace_id, 'bucket', b.id, b.name, now()
  FROM public.buckets b
 WHERE NOT b.is_system AND b.deleted_at IS NULL
ON CONFLICT (workspace_id, entity_type, entity_id) DO UPDATE
  SET label = excluded.label, deleted_at = NULL, updated_at = now()
  WHERE public.entities.label IS DISTINCT FROM excluded.label OR public.entities.deleted_at IS NOT NULL;

UPDATE public.entities e
   SET deleted_at = now(), updated_at = now()
  FROM public.buckets b
 WHERE e.entity_type = 'bucket' AND e.entity_id = b.id AND e.workspace_id = b.workspace_id
   AND e.deleted_at IS NULL AND b.deleted_at IS NOT NULL;

-- ── 8. search_all ────────────────────────────────────────────────────────────
-- 20261029090000_search_all.sql's function, with tasks and projects asked of
-- their own module and taken out of the registry adapter's list.

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
  -- Types on the contract answer for themselves; the adapter covers the rest.
  v_registry := ARRAY(SELECT t FROM unnest(v_types) AS t WHERE t NOT IN ('note', 'task', 'bucket'));
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
      SELECT t.entity_type, t.entity_id, t.title, t.context, t.snippet, t.icon, t.match, t.rank,
             t.updated_at, t.archived
        FROM public.tasks__search(p_workspace_id, p_query, 50) t
       WHERE 'task' = ANY (v_types)
      UNION ALL
      SELECT p.entity_type, p.entity_id, p.title, p.context, p.snippet, p.icon, p.match, p.rank,
             p.updated_at, p.archived
        FROM public.projects__search(p_workspace_id, p_query, 50) p
       WHERE 'bucket' = ANY (v_types)
      UNION ALL
      SELECT r.entity_type, r.entity_id, r.title, r.context, r.snippet, r.icon, r.match, r.rank,
             r.updated_at, r.archived
        FROM public.registry__search(p_workspace_id, p_query, 50, v_registry) r
       WHERE cardinality(v_registry) > 0
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
  'Search (GS-3, GS-4): ⌘K''s one search. Merges every module''s <module>__search (registry__search for types not yet on the contract), ranks, and returns up to limit_per_type rows per type with the type''s total and one Top result. SECURITY INVOKER: every hit comes from a module function that resolves the caller.';

-- ── 9. Grants ────────────────────────────────────────────────────────────────

-- The index expression's functions run as whoever writes a task: signed-in
-- people (the app writes tasks directly) and the server. Pure, never anon.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['search__unaccent(text)', 'tasks__plain_text(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;

-- Internal: the matcher and the trigger function.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['tasks__hits(uuid, text, integer)', 'buckets__registry_sync()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% must be server-only.', fn;
    END IF;
  END LOOP;
END;
$$;

-- The searches read the actor from the request: signed-in people and the
-- server (the MCP, with its key header) may call them, never anon.
REVOKE ALL ON FUNCTION public.tasks__search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tasks__search(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.projects__search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.projects__search(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tasks_search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tasks_search(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) TO authenticated, service_role;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.search__unaccent(text)',
                           'public.tasks__plain_text(text)',
                           'public.tasks__search(uuid, text, integer)',
                           'public.projects__search(uuid, text, integer)',
                           'public.tasks_search(uuid, text, integer)',
                           'public.search_all(uuid, text, text[], integer, text, uuid)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be callable by authenticated and service_role, never anon.', f;
    END IF;
  END LOOP;
END;
$$;
