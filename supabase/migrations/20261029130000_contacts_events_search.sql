-- GS-5: contacts, companies and events on the search contract
-- (specs/global-search.md AC1–AC4; Assumptions 6, 7, 11; Q23).
--
--   1. Text helpers and indexes. Each type's searchable text is one IMMUTABLE
--      helper, indexed by expression (GIN), with a trigram index on the
--      unaccented, lower-cased title for typo forgiveness:
--        contact  name (A); job title and email addresses (B)
--        company  name (A); domains and website (B)
--        event    title (A); location, description, attendees (B)
--   2. contacts__search and companies__search: text first, then each item's
--      own rule (can_access, so a company is visible through any visible
--      person) before the limit, walking the matches best first and stopping
--      at the limit or after 500 candidates (Assumption 6).
--   3. events__search: set-based. The calendar ceiling is read once, the
--      calendars the actor can view are listed once, and an event matches
--      only when it is the actor's own or sits on one of those calendars and
--      is neither private nor focus time. Someone else's private event is never matched by its
--      title, description, location or attendees (Q23). The rule is
--      can_access('event', …, 'view') written out; contacts_events_search.test.sql
--      guards the copy with a parity check.
--   4. search_all takes contact, company and event from these functions
--      instead of the registry adapter, cut into its live body.
--
-- Context lines (Assumption 11): a person's company; a company's first
-- domain; an event's start date in the asker's time zone ("Tue 3 Nov 2026"),
-- an all-day event's in its owner's.
--
-- Every function resolves the actor from the request (perm_actor_id(), the
-- key's module scope through <module>_module_permission), never an argument.
-- Re-runnable: helpers and functions OR REPLACE, indexes IF NOT EXISTS,
-- search_all cut once, grants re-stated by name.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.search_all(uuid, text, text[], integer, text, uuid)') IS NULL
     OR to_regprocedure('public.registry__search(uuid, text, integer, text[])') IS NULL
     OR to_regprocedure('public.search__snippet(text, tsquery)') IS NULL THEN
    RAISE EXCEPTION 'GS-5 needs GS-1 to GS-3 (20261028220000, 20261028230000, 20261029090000) applied first.';
  END IF;
END;
$$;

-- ── 1. Text helpers and indexes ──────────────────────────────────────────────
-- Index expressions run with the writer's privileges. Nobody writes these
-- tables as a client: they have SELECT policies only, and every writer is a
-- definer op or the service role, so the helpers stay server-only, as
-- search__unaccent is.
--
-- An email address is kept whole (a typed address finds it) and shown with a
-- zero-width space after the @, so the parser also reads its domain as a
-- word ("quincefarm" finds edith@quincefarm.example) and the snippet can mark
-- it. The MCP strips the zero-width space.

CREATE OR REPLACE FUNCTION public.contacts__search_emails(p_email text, p_emails jsonb)
  RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT x.v ORDER BY x.v), '{}')
    FROM (SELECT pg_catalog.btrim(p_email) AS v
          UNION ALL
          SELECT pg_catalog.btrim(e ->> 'value')
            FROM pg_catalog.jsonb_array_elements(
                   CASE WHEN pg_catalog.jsonb_typeof(p_emails) = 'array' THEN p_emails ELSE '[]'::jsonb END) e) x
   WHERE coalesce(x.v, '') <> ''
$$;

CREATE OR REPLACE FUNCTION public.contacts__search_body(p_title text, p_email text, p_emails jsonb)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = ''
AS $$
  SELECT pg_catalog.concat_ws(' · ',
           nullif(pg_catalog.btrim(p_title), ''),
           nullif(pg_catalog.array_to_string(ARRAY(
             SELECT pg_catalog.replace(v, '@', '@' || pg_catalog.chr(8203))
               FROM unnest(public.contacts__search_emails(p_email, p_emails)) AS v), ', '), ''))
$$;

CREATE OR REPLACE FUNCTION public.contacts__search_tsv(p_name text, p_title text, p_email text, p_emails jsonb)
  RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = ''
AS $$
  SELECT pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
           public.search__unaccent(coalesce(p_name, ''))), 'A')
      OPERATOR(pg_catalog.||)
         pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
           public.search__unaccent(public.contacts__search_body(p_title, p_email, p_emails) || ' '
             || pg_catalog.array_to_string(public.contacts__search_emails(p_email, p_emails), ' '))), 'B')
$$;

CREATE OR REPLACE FUNCTION public.companies__search_body(p_domains text[], p_website text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = ''
AS $$
  SELECT pg_catalog.concat_ws(' · ',
           nullif(pg_catalog.array_to_string(coalesce(p_domains, '{}'), ', '), ''),
           nullif(pg_catalog.btrim(p_website), ''))
$$;

CREATE OR REPLACE FUNCTION public.companies__search_tsv(p_name text, p_domains text[], p_website text)
  RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = ''
AS $$
  SELECT pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
           public.search__unaccent(coalesce(p_name, ''))), 'A')
      OPERATOR(pg_catalog.||)
         pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
           public.search__unaccent(public.companies__search_body(p_domains, p_website))), 'B')
$$;

CREATE OR REPLACE FUNCTION public.events__search_body(p_description text, p_location text, p_attendees jsonb)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = ''
AS $$
  SELECT pg_catalog.concat_ws(' · ',
           nullif(pg_catalog.btrim(p_location), ''),
           nullif(pg_catalog.btrim(pg_catalog.left(p_description, 150000)), ''),
           nullif(pg_catalog.array_to_string(ARRAY(
             SELECT pg_catalog.concat_ws(' ', nullif(pg_catalog.btrim(a ->> 'name'), ''),
                      pg_catalog.replace(nullif(pg_catalog.btrim(a ->> 'email'), ''), '@', '@' || pg_catalog.chr(8203)))
               FROM pg_catalog.jsonb_array_elements(
                      CASE WHEN pg_catalog.jsonb_typeof(p_attendees) = 'array' THEN p_attendees ELSE '[]'::jsonb END) a
              WHERE pg_catalog.jsonb_typeof(a) = 'object'), ', '), ''))
$$;

CREATE OR REPLACE FUNCTION public.events__search_tsv(p_title text, p_description text, p_location text,
                                                     p_attendees jsonb)
  RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = ''
AS $$
  SELECT pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
           public.search__unaccent(coalesce(p_title, ''))), 'A')
      OPERATOR(pg_catalog.||)
         pg_catalog.setweight(pg_catalog.to_tsvector('pg_catalog.simple'::regconfig,
           public.search__unaccent(public.events__search_body(p_description, p_location, p_attendees))), 'B')
$$;

-- The indexes hold the helpers' output: a later change to a helper's body
-- needs a REINDEX of its indexes in the same migration.
CREATE INDEX IF NOT EXISTS contacts_search_idx ON public.contacts
  USING gin (public.contacts__search_tsv(name, title, email, emails)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contacts_name_trgm_idx ON public.contacts
  USING gin (lower(public.search__unaccent(name)) extensions.gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS companies_search_idx ON public.companies
  USING gin (public.companies__search_tsv(name, domains, website)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS companies_name_trgm_idx ON public.companies
  USING gin (lower(public.search__unaccent(name)) extensions.gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS calendar_events_search_idx ON public.calendar_events
  USING gin (public.events__search_tsv(title, description, location, attendees)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS calendar_events_title_trgm_idx ON public.calendar_events
  USING gin (lower(public.search__unaccent(title)) extensions.gin_trgm_ops) WHERE deleted_at IS NULL;

-- ── 2. contacts__search and companies__search ────────────────────────────────
-- Rank bands, as notes__search's: title 0.75, body 0.40, a typo in the title
-- 0.2 × word similarity (at least 0.5), only when exact matching found fewer
-- than 3. Nothing here is archived.

CREATE OR REPLACE FUNCTION public.contacts__search(p_workspace_id uuid, p_query text, p_limit integer)
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
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q tsquery;
  v_ids uuid[] := '{}';
  v_ranks real[] := '{}';
  v_kinds text[] := '{}';
  v_exact integer;
  v_seen integer := 0;
  v_words text[];
  v_fuzzy text;
  v_not tsquery;
  v_threshold text;
  r record;
BEGIN
  IF v_actor IS NULL OR p_workspace_id IS NULL OR p_query IS NULL
     OR public.contacts_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RETURN;
  END IF;
  v_q := public.search__query(p_query);
  IF v_q IS NULL THEN
    RETURN;
  END IF;

  -- Exact hits: the text first (the GIN index), then each person's own rule,
  -- both before the limit, best first.
  FOR r IN
    WITH cand AS MATERIALIZED (
      SELECT c.id, c.updated_at,
             pg_catalog.ts_filter(public.contacts__search_tsv(c.name, c.title, c.email, c.emails), '{a}')
               OPERATOR(pg_catalog.@@) v_q AS in_title
        FROM public.contacts c
       WHERE c.workspace_id = p_workspace_id
         AND c.deleted_at IS NULL
         AND public.contacts__search_tsv(c.name, c.title, c.email, c.emails) OPERATOR(pg_catalog.@@) v_q
    )
    SELECT cand.id, cand.in_title FROM cand ORDER BY cand.in_title DESC, cand.updated_at DESC, cand.id
  LOOP
    EXIT WHEN cardinality(v_ids) >= v_limit OR v_seen >= 500;
    v_seen := v_seen + 1;
    IF public.can_access('contact', r.id, 'view', v_actor) THEN
      v_ids := v_ids || r.id;
      v_ranks := v_ranks || (CASE WHEN r.in_title THEN 0.75 ELSE 0.40 END)::real;
      v_kinds := v_kinds || (CASE WHEN r.in_title THEN 'title' ELSE 'body' END);
    END IF;
  END LOOP;
  v_exact := cardinality(v_ids);

  -- Typo forgiveness on the name, as notes__search's.
  IF v_exact < 3 AND v_exact < v_limit THEN
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
          SELECT c.id, c.updated_at,
                 extensions.word_similarity(v_fuzzy, pg_catalog.lower(public.search__unaccent(c.name))) AS sim
            FROM public.contacts c
           WHERE c.workspace_id = p_workspace_id
             AND c.deleted_at IS NULL
             AND v_fuzzy OPERATOR(extensions.<%) pg_catalog.lower(public.search__unaccent(c.name))
             AND (pg_catalog.numnode(v_not) = 0
                  OR NOT (public.contacts__search_tsv(c.name, c.title, c.email, c.emails) OPERATOR(pg_catalog.@@) v_not))
        )
        SELECT cand.id, cand.sim FROM cand
         WHERE cand.sim >= 0.5 AND NOT (cand.id = ANY (v_ids))
         ORDER BY cand.sim DESC, cand.updated_at DESC, cand.id
      LOOP
        EXIT WHEN cardinality(v_ids) >= v_limit OR v_seen >= 500;
        v_seen := v_seen + 1;
        IF public.can_access('contact', r.id, 'view', v_actor) THEN
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

  -- Shape only the rows returned. A visible person's company is visible
  -- through them (can_access('company')), so it is named without a check.
  RETURN QUERY
    SELECT 'contact'::text,
           c.id,
           c.name,
           nullif(pg_catalog.btrim(co.name), ''),
           -- A whole typed address matches only the address kept whole.
           CASE WHEN h.kind = 'body'
                THEN coalesce(public.search__snippet(public.contacts__search_body(c.title, c.email, c.emails), v_q),
                              public.search__snippet(pg_catalog.array_to_string(
                                public.contacts__search_emails(c.email, c.emails), ', '), v_q)) END,
           'user'::text,
           h.kind,
           h.rank,
           c.updated_at,
           false
      FROM unnest(v_ids, v_ranks, v_kinds) WITH ORDINALITY AS h(id, rank, kind, ord)
      JOIN public.contacts c ON c.id = h.id
      LEFT JOIN public.companies co ON co.id = c.company_id AND co.deleted_at IS NULL
     ORDER BY h.ord;
END;
$$;

COMMENT ON FUNCTION public.contacts__search(uuid, text, integer) IS
  'Search (GS-5): the people the caller can open that match the query, as SearchHit rows (at most 50), with the person''s company as context. The actor comes from the request, never an argument.';

CREATE OR REPLACE FUNCTION public.companies__search(p_workspace_id uuid, p_query text, p_limit integer)
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
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q tsquery;
  v_ids uuid[] := '{}';
  v_ranks real[] := '{}';
  v_kinds text[] := '{}';
  v_exact integer;
  v_seen integer := 0;
  v_words text[];
  v_fuzzy text;
  v_not tsquery;
  v_threshold text;
  r record;
BEGIN
  IF v_actor IS NULL OR p_workspace_id IS NULL OR p_query IS NULL
     OR public.contacts_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin') THEN
    RETURN;
  END IF;
  v_q := public.search__query(p_query);
  IF v_q IS NULL THEN
    RETURN;
  END IF;

  -- A company is visible to its owner and through any person the caller can
  -- see (can_access('company')), checked per match before the limit.
  FOR r IN
    WITH cand AS MATERIALIZED (
      SELECT co.id, co.updated_at,
             pg_catalog.ts_filter(public.companies__search_tsv(co.name, co.domains, co.website), '{a}')
               OPERATOR(pg_catalog.@@) v_q AS in_title
        FROM public.companies co
       WHERE co.workspace_id = p_workspace_id
         AND co.deleted_at IS NULL
         AND public.companies__search_tsv(co.name, co.domains, co.website) OPERATOR(pg_catalog.@@) v_q
    )
    SELECT cand.id, cand.in_title FROM cand ORDER BY cand.in_title DESC, cand.updated_at DESC, cand.id
  LOOP
    EXIT WHEN cardinality(v_ids) >= v_limit OR v_seen >= 500;
    v_seen := v_seen + 1;
    IF public.can_access('company', r.id, 'view', v_actor) THEN
      v_ids := v_ids || r.id;
      v_ranks := v_ranks || (CASE WHEN r.in_title THEN 0.75 ELSE 0.40 END)::real;
      v_kinds := v_kinds || (CASE WHEN r.in_title THEN 'title' ELSE 'body' END);
    END IF;
  END LOOP;
  v_exact := cardinality(v_ids);

  IF v_exact < 3 AND v_exact < v_limit THEN
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
          SELECT co.id, co.updated_at,
                 extensions.word_similarity(v_fuzzy, pg_catalog.lower(public.search__unaccent(co.name))) AS sim
            FROM public.companies co
           WHERE co.workspace_id = p_workspace_id
             AND co.deleted_at IS NULL
             AND v_fuzzy OPERATOR(extensions.<%) pg_catalog.lower(public.search__unaccent(co.name))
             AND (pg_catalog.numnode(v_not) = 0
                  OR NOT (public.companies__search_tsv(co.name, co.domains, co.website) OPERATOR(pg_catalog.@@) v_not))
        )
        SELECT cand.id, cand.sim FROM cand
         WHERE cand.sim >= 0.5 AND NOT (cand.id = ANY (v_ids))
         ORDER BY cand.sim DESC, cand.updated_at DESC, cand.id
      LOOP
        EXIT WHEN cardinality(v_ids) >= v_limit OR v_seen >= 500;
        v_seen := v_seen + 1;
        IF public.can_access('company', r.id, 'view', v_actor) THEN
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

  RETURN QUERY
    SELECT 'company'::text,
           co.id,
           co.name,
           (SELECT nullif(pg_catalog.btrim(d), '') FROM unnest(co.domains) AS d
             WHERE nullif(pg_catalog.btrim(d), '') IS NOT NULL LIMIT 1),
           CASE WHEN h.kind = 'body'
                THEN public.search__snippet(public.companies__search_body(co.domains, co.website), v_q) END,
           'building-2'::text,
           h.kind,
           h.rank,
           co.updated_at,
           false
      FROM unnest(v_ids, v_ranks, v_kinds) WITH ORDINALITY AS h(id, rank, kind, ord)
      JOIN public.companies co ON co.id = h.id
     ORDER BY h.ord;
END;
$$;

COMMENT ON FUNCTION public.companies__search(uuid, text, integer) IS
  'Search (GS-5): the companies the caller can open (their own, or through any person they can see) that match the query, as SearchHit rows (at most 50), with the first domain as context. The actor comes from the request, never an argument.';

-- ── 3. events__search ────────────────────────────────────────────────────────
-- can_access('event', id, 'view', actor), written out for the set:
--   the actor's own event                      rank 4
--   an event on a calendar the actor can view  the calendar's rank, unless
--   (owner of the calendar, or a direct share   the event is private or focus
--   at view or more)                            time (CALR-14: a focus block
--                                               can carry a task's title)
-- then least(rank, the calendar ceiling) ≥ view. The ceiling is the same for
-- every event of the workspace, so it is read once; below view nothing
-- matches. Visibility sits in the same WHERE as the text, so a private event
-- of someone else is never a match, by any of its words.

CREATE OR REPLACE FUNCTION public.events__search(p_workspace_id uuid, p_query text, p_limit integer)
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
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q tsquery;
  v_cals uuid[];
  v_tz text;
  v_ids uuid[] := '{}';
  v_ranks real[] := '{}';
  v_kinds text[] := '{}';
  v_words text[];
  v_fuzzy text;
  v_not tsquery;
  v_threshold text;
BEGIN
  IF v_actor IS NULL OR p_workspace_id IS NULL OR p_query IS NULL
     OR public.calendar_module_permission(p_workspace_id) NOT IN ('view', 'edit', 'admin')
     OR public.perm_ceiling_rank(p_workspace_id, v_actor, 'calendar') < 2 THEN
    RETURN;
  END IF;
  v_q := public.search__query(p_query);
  IF v_q IS NULL THEN
    RETURN;
  END IF;
  v_cals := ARRAY(
    SELECT c.id FROM public.calendars c
     WHERE c.workspace_id = p_workspace_id
       AND c.deleted_at IS NULL
       AND (c.owner_id = v_actor OR public.share_direct_rank('calendar', c.id, v_actor) >= 2));

  WITH cand AS MATERIALIZED (
    SELECT e.id, e.updated_at,
           pg_catalog.ts_filter(public.events__search_tsv(e.title, e.description, e.location, e.attendees), '{a}')
             OPERATOR(pg_catalog.@@) v_q AS in_title
      FROM public.calendar_events e
     WHERE e.workspace_id = p_workspace_id
       AND e.deleted_at IS NULL
       AND (e.owner_id = v_actor
            OR (e.calendar_ref = ANY (v_cals) AND NOT e.is_private AND e.kind <> 'focus'))
       AND public.events__search_tsv(e.title, e.description, e.location, e.attendees) OPERATOR(pg_catalog.@@) v_q
  ),
  ranked AS (
    SELECT c.id, c.updated_at,
           CASE WHEN c.in_title THEN 'title' ELSE 'body' END AS kind,
           (CASE WHEN c.in_title THEN 0.75 ELSE 0.40 END)::real AS rank
      FROM cand c
     ORDER BY 4 DESC, c.updated_at DESC, c.id
     LIMIT v_limit
  )
  SELECT coalesce(array_agg(r.id ORDER BY r.rank DESC, r.updated_at DESC, r.id), '{}'),
         coalesce(array_agg(r.rank ORDER BY r.rank DESC, r.updated_at DESC, r.id), '{}'),
         coalesce(array_agg(r.kind ORDER BY r.rank DESC, r.updated_at DESC, r.id), '{}')
    INTO v_ids, v_ranks, v_kinds
    FROM ranked r;

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
      WITH cand AS MATERIALIZED (
        SELECT e.id, e.updated_at,
               extensions.word_similarity(v_fuzzy, pg_catalog.lower(public.search__unaccent(e.title))) AS sim
          FROM public.calendar_events e
         WHERE e.workspace_id = p_workspace_id
           AND e.deleted_at IS NULL
           AND (e.owner_id = v_actor
            OR (e.calendar_ref = ANY (v_cals) AND NOT e.is_private AND e.kind <> 'focus'))
           AND v_fuzzy OPERATOR(extensions.<%) pg_catalog.lower(public.search__unaccent(e.title))
           AND (pg_catalog.numnode(v_not) = 0
                OR NOT (public.events__search_tsv(e.title, e.description, e.location, e.attendees)
                        OPERATOR(pg_catalog.@@) v_not))
      ),
      fuzzy AS (
        SELECT c.id, c.updated_at, c.sim
          FROM cand c
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

  -- The start date reads in the asker's time zone (UTC when they have none
  -- or it isn't one Postgres knows).
  SELECT p.time_zone INTO v_tz FROM public.user_preferences p WHERE p.user_id = v_actor;
  BEGIN
    PERFORM now() AT TIME ZONE coalesce(v_tz, 'UTC');
  EXCEPTION WHEN OTHERS THEN
    v_tz := NULL;
  END;
  v_tz := coalesce(v_tz, 'UTC');

  RETURN QUERY
    SELECT 'event'::text,
           e.id,
           e.title,
           pg_catalog.to_char(e.start_time AT TIME ZONE
             CASE WHEN e.all_day THEN coalesce(z.tz, 'UTC') ELSE v_tz END, 'Dy FMDD Mon YYYY'),
           CASE WHEN h.kind = 'body'
                THEN public.search__snippet(public.events__search_body(e.description, e.location, e.attendees), v_q) END,
           'calendar'::text,
           h.kind,
           h.rank,
           e.updated_at,
           false
      FROM unnest(v_ids, v_ranks, v_kinds) WITH ORDINALITY AS h(id, rank, kind, ord)
      JOIN public.calendar_events e ON e.id = h.id
      -- An all-day event is stored at its owner's midnight: its day is read
      -- in the owner's zone, or a teammate to the west sees the day before.
      -- Stored zones are checked against the catalog when written
      -- (user_op_set_time_region).
      LEFT JOIN LATERAL (SELECT nullif(p.time_zone, '') AS tz FROM public.user_preferences p
                          WHERE p.user_id = e.owner_id AND e.all_day) z ON true
     ORDER BY h.ord;
END;
$$;

COMMENT ON FUNCTION public.events__search(uuid, text, integer) IS
  'Search (GS-5): the events the caller can open that match the query, as SearchHit rows (at most 50), with the start date as context. Someone else''s private event never matches. The actor comes from the request, never an argument.';

-- ── 4. search_all ────────────────────────────────────────────────────────────
-- contact, company and event come from their module functions instead of the
-- registry adapter. Cut into the live body (as GS-8 does), never redefined
-- from an older file, so it keeps whichever modules' sources the live
-- search_all already has (GS-4, GS-6, GS-8 change it in parallel): the three
-- arms go in before the registry arm, and the three types leave the
-- registry's list right before a person's context is read.

DO $do$
DECLARE
  v_fn regprocedure := 'public.search_all(uuid, text, text[], integer, text, uuid)'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_arm_at text := $o$      UNION ALL
      SELECT r.entity_type, r.entity_id, r.title, r.context, r.snippet, r.icon, r.match, r.rank,
             r.updated_at, r.archived
        FROM public.registry__search($o$;
  v_arms text := $n$      UNION ALL
      SELECT c.entity_type, c.entity_id, c.title, c.context, c.snippet, c.icon, c.match, c.rank,
             c.updated_at, c.archived
        FROM public.contacts__search(p_workspace_id, p_query, 50) c
       WHERE 'contact' = ANY (v_types)
      UNION ALL
      SELECT c.entity_type, c.entity_id, c.title, c.context, c.snippet, c.icon, c.match, c.rank,
             c.updated_at, c.archived
        FROM public.companies__search(p_workspace_id, p_query, 50) c
       WHERE 'company' = ANY (v_types)
      UNION ALL
      SELECT e.entity_type, e.entity_id, e.title, e.context, e.snippet, e.icon, e.match, e.rank,
             e.updated_at, e.archived
        FROM public.events__search(p_workspace_id, p_query, 50) e
       WHERE 'event' = ANY (v_types)
$n$;
  v_ctx_at text := $o$  -- A person's context only: a key has no item open$o$;
  v_drop text := $n$  -- contact, company and event answer through their own functions (GS-5).
  v_registry := ARRAY(SELECT t FROM unnest(v_registry) AS t WHERE t NOT IN ('contact', 'company', 'event'));
$n$;
BEGIN
  -- Already cut (a re-run).
  IF position('public.contacts__search(' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF position(v_arm_at IN v_def) = 0 OR position(v_ctx_at IN v_def) = 0 THEN
    RAISE EXCEPTION 'search_all isn''t the body GS-5 expects; add its sources by hand.';
  END IF;
  v_def := replace(v_def, v_arm_at, v_arms || v_arm_at);
  v_def := replace(v_def, v_ctx_at, v_drop || v_ctx_at);
  EXECUTE v_def;
END;
$do$;

COMMENT ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) IS
  'Search (GS-3, GS-5): ⌘K''s one search. Merges every module''s <module>__search (registry__search for types not yet on the contract), ranks, and returns up to limit_per_type rows per type with the type''s total and one Top result. SECURITY INVOKER: every hit comes from a module function that resolves the caller.';

-- ── 5. Grants ────────────────────────────────────────────────────────────────
-- The three searches read the actor from the request: signed-in people and
-- the server (the MCP, with its key header) may call them, never anon. The
-- text helpers are the server's alone, as search__unaccent is.

REVOKE ALL ON FUNCTION public.contacts__search_emails(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contacts__search_emails(text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.contacts__search_body(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contacts__search_body(text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.contacts__search_tsv(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contacts__search_tsv(text, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.companies__search_body(text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.companies__search_body(text[], text) TO service_role;
REVOKE ALL ON FUNCTION public.companies__search_tsv(text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.companies__search_tsv(text, text[], text) TO service_role;
REVOKE ALL ON FUNCTION public.events__search_body(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.events__search_body(text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.events__search_tsv(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.events__search_tsv(text, text, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.contacts__search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts__search(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.companies__search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.companies__search(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.events__search(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.events__search(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_all(uuid, text, text[], integer, text, uuid) TO authenticated, service_role;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.contacts__search(uuid, text, integer)',
                           'public.companies__search(uuid, text, integer)',
                           'public.events__search(uuid, text, integer)',
                           'public.search_all(uuid, text, text[], integer, text, uuid)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be callable by authenticated and service_role, never anon.', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.contacts__search_emails(text, jsonb)',
                           'public.contacts__search_body(text, text, jsonb)',
                           'public.contacts__search_tsv(text, text, text, jsonb)',
                           'public.companies__search_body(text[], text)',
                           'public.companies__search_tsv(text, text[], text)',
                           'public.events__search_body(text, text, jsonb)',
                           'public.events__search_tsv(text, text, text, jsonb)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '% is the server''s alone.', f;
    END IF;
  END LOOP;
END;
$$;
