-- GS-2: Notes on the global search contract (specs/global-search.md,
-- Assumptions 5, 6, 7, 9, 10, 11; AC1–AC4, AC8, AC10).
--
-- Search is federated: each module answers <module>__search(ws, query, limit)
-- with SearchHit rows (supabase/functions/_shared/contracts/search.ts) and
-- search_all (GS-3) merges them. Notes is the first module on the contract.
--
--   1. search__unaccent stays server-only: the rebuilt column and the title
--      index call it as the writer, and only definer ops write notes.
--   2. notes.search_tsv is rebuilt over unaccented text (title A, body B), with
--      its GIN index; a trigram index on the unaccented, lower-cased title
--      serves typo forgiveness.
--   3. notes__visible_ids(ws, actor): the set form of can_access('note', id,
--      'view', actor), one recursive walk down the tree with the module ceiling
--      applied once (notes_visible_ids.test.sql proves it equal). Server-only.
--   4. notes__search(ws, query, limit): text first, visibility before the
--      limit, title hits above body hits, archived below live, typo-forgiven
--      titles below every exact hit (only when exact hits are fewer than 3),
--      and the snippet and parent path built only for the rows it returns.
--      The actor comes from the request (perm_actor_id(), and a key's scope
--      through notes_module_permission), never from an argument, so it is
--      granted to authenticated: the Notes sidebar calls it directly, and the
--      MCP's notes_search does through the service role with its key header.
--
-- Re-runnable: the column is rebuilt only while it still lacks the unaccent,
-- indexes IF NOT EXISTS, functions OR REPLACE, grants re-stated by name.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.search__unaccent(text)') IS NULL
     OR to_regprocedure('public.search__query(text)') IS NULL
     OR to_regprocedure('public.search__snippet(text, tsquery)') IS NULL THEN
    RAISE EXCEPTION 'GS-2 needs the search primitives (20261028220000_search_primitives.sql) applied first.';
  END IF;
END;
$$;

-- ── 1. Who evaluates search__unaccent ────────────────────────────────────────
-- A generated column and an index expression run their functions with the
-- writer's privileges. notes has no INSERT or UPDATE policy: every write goes
-- through a notes_op_* definer function (owner postgres), so search__unaccent
-- stays server-only, as GS-1 left it. A client write path added later needs
-- GRANT EXECUTE … TO authenticated on it first (search__unaccent is pure).

-- ── 2. search_tsv, unaccented, and the title trigram index ───────────────────
-- Dropping the column drops its old index; the table is rewritten once without
-- firing triggers (no updated_at stamps, no Realtime). 129 rows on prod.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.notes'::regclass AND a.attname = 'search_tsv' AND NOT a.attisdropped
       AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) LIKE '%search__unaccent%'
  ) THEN
    ALTER TABLE public.notes DROP COLUMN IF EXISTS search_tsv;
    ALTER TABLE public.notes ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('pg_catalog.simple'::regconfig,
                public.search__unaccent(coalesce(title, ''))), 'A')
      || setweight(to_tsvector('pg_catalog.simple'::regconfig,
                public.search__unaccent(left(coalesce(body_text, ''), 150000))), 'B')
    ) STORED;
  END IF;
END;
$do$;

CREATE INDEX IF NOT EXISTS notes_search_tsv_idx ON public.notes USING gin (search_tsv);

CREATE INDEX IF NOT EXISTS notes_title_trgm_idx ON public.notes
  USING gin (lower(public.search__unaccent(title)) extensions.gin_trgm_ops);

-- ── 3. notes__visible_ids ────────────────────────────────────────────────────
-- can_access('note', …) walks up from one note: its rank is the best of its
-- creator (4) and its direct grants (member or workspace), plus its parent's
-- while it inherits. Here the same rule runs down from every root at once: a
-- note that doesn't inherit (or has no parent) starts with its own rank, an
-- inheriting child takes the better of its own and its parent's. The module
-- ceiling is the same for every note of one workspace, so it is read once.
-- Trashed notes are included, as can_access includes them; callers filter.
-- An array, not a set: PostgREST caps a set at 1,000 rows, the MCP reads this.

CREATE OR REPLACE FUNCTION public.notes__visible_ids(p_workspace_id uuid, p_actor uuid)
  RETURNS uuid[]
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_actor IS NULL
     OR public.perm_ceiling_rank(p_workspace_id, p_actor, 'notes') < 2 THEN
    RETURN '{}';
  END IF;
  RETURN coalesce((
    WITH RECURSIVE
      granted AS (
        SELECT g.resource_id AS id,
               max(CASE g.level WHEN 'freebusy' THEN 1 WHEN 'view' THEN 2
                                WHEN 'edit' THEN 3 WHEN 'full' THEN 4 ELSE 0 END) AS rank
          FROM public.resource_grants g
         WHERE g.resource_type = 'note'
           AND (g.subject_type = 'workspace' OR (g.subject_type = 'member' AND g.subject_id = p_actor))
           AND g.resource_id IN (SELECT n.id FROM public.notes n WHERE n.workspace_id = p_workspace_id)
         GROUP BY g.resource_id
      ),
      own AS (
        SELECT n.id, n.parent_id, n.share_mode,
               greatest(CASE WHEN n.created_by = p_actor THEN 4 ELSE 0 END, coalesce(gr.rank, 0)) AS rank
          FROM public.notes n
          LEFT JOIN granted gr ON gr.id = n.id
         WHERE n.workspace_id = p_workspace_id
      ),
      tree AS (
        SELECT o.id, o.rank, 1 AS depth
          FROM own o
         WHERE o.share_mode IS DISTINCT FROM 'inherit' OR o.parent_id IS NULL
        UNION ALL
        SELECT c.id, greatest(c.rank, t.rank), t.depth + 1
          FROM tree t
          JOIN own c ON c.parent_id = t.id AND c.share_mode = 'inherit'
         WHERE t.depth < 100
      )
    SELECT array_agg(t.id) FROM tree t WHERE t.rank >= 2
  ), '{}');
END;
$$;

COMMENT ON FUNCTION public.notes__visible_ids(uuid, uuid) IS
  'Search (GS-2): every note of the workspace the actor can view, as can_access(''note'', id, ''view'', actor) answers. Server-only.';

-- ── 4. notes__search ─────────────────────────────────────────────────────────
-- Rank (0..1, the SearchHit contract) is a band, so the order between kinds
-- never depends on how often a word occurs:
--   title, live      0.75             body, live       0.40
--   title, archived  0.60             body, archived   0.25
--   typo in a title  0.10 – 0.20 (0.2 × word similarity, at least 0.5)
-- Within a band the newer note comes first. ts_rank was measured and left out:
-- at 10k notes it doubles the cost of a common word-start (search_all adds its
-- own recency and context terms on top of this rank). A note matching in its
-- title and its body is a title hit, and a title hit has no snippet (Q6). The
-- context is the parent path, at most two ancestors ("… / Grandparent /
-- Parent" when there are more), each visible and live: an ancestor you can't
-- see ends the path, so its title never leaks.

CREATE OR REPLACE FUNCTION public.notes__search(p_workspace_id uuid, p_query text, p_limit integer)
  RETURNS TABLE (entity_type text, entity_id uuid, title text, context text, snippet text,
                 icon text, match text, rank real, updated_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = ''
  -- After five calls plpgsql would switch to a generic plan, which can't see
  -- how many ids the visible set holds and reads every visible note (17 ms →
  -- 50 ms at 10k notes). Planning each call costs ~1 ms.
  SET plan_cache_mode = 'force_custom_plan'
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := public.perm_actor_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q tsquery;
  v_vis uuid[];
  v_fuzzy text;
  v_threshold text;
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
    v_fuzzy := pg_catalog.lower(public.search__unaccent(pg_catalog.translate(pg_catalog.array_to_string(
      ARRAY(SELECT w FROM unnest((pg_catalog.regexp_split_to_array(
                pg_catalog.btrim(pg_catalog.left(p_query, 256)), '\s+'))[1:32]) AS w
             WHERE w NOT LIKE '-%'), ' '), '"', '')));
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
           n.updated_at
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
  'Search (GS-2): the notes the caller can open that match the query, as SearchHit rows (at most 50). The actor comes from the request, never an argument.';

-- ── 5. Grants ────────────────────────────────────────────────────────────────
-- notes__visible_ids takes the actor as an argument: server-only.
-- notes__search reads the actor from the request: signed-in people and the
-- server (the MCP, with its key header) may call it.

REVOKE ALL ON FUNCTION public.notes__visible_ids(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notes__visible_ids(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.notes__search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notes__search(uuid, text, integer) TO authenticated, service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.notes__visible_ids(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notes__visible_ids(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.notes__visible_ids(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public.notes__visible_ids must be server-only.';
  END IF;
  IF has_function_privilege('anon', 'public.notes__search(uuid, text, integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.notes__search(uuid, text, integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.notes__search(uuid, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public.notes__search must be callable by authenticated and service_role, never anon.';
  END IF;
END;
$$;
