-- GS-1: the shared search primitives (specs/global-search.md, Assumptions 2–5).
--
-- Global ⌘K search is federated: each module answers <module>__search with one
-- row shape (SearchHit, supabase/functions/_shared/contracts/search.ts) and
-- search_all merges them. These are the text primitives every module uses, so
-- matching is the same everywhere. They are lifted from Chat's CV-19 search
-- (20261017117000_chat_v2_search.sql) with the same semantics; Chat itself is
-- untouched here (its GIN index names chat__unaccent; GS-6 points
-- chat__search_query at search__query).
--
--   1. pg_trgm in extensions: typo forgiveness on titles (GS-2 on).
--   2. search__unaccent: unaccent behind an IMMUTABLE wrapper, so a generated
--      column or an index expression may call it.
--   3. search__query: the query builder (websearch syntax over the unaccented
--      text, each word of 3+ letters a prefix, bounded input; null when nothing
--      is searchable).
--   4. search_headline: a display-only text search config, so a snippet marks
--      "żółw" when someone typed "zolw".
--   5. search__snippet: the marked snippet (U+E000 … U+E001, plain text).
--   6. Grants, by name: server-only. Every <module>__search is SECURITY DEFINER
--      and calls these as its owner.
--
-- Re-runnable: CREATE … IF NOT EXISTS / OR REPLACE, grants re-stated.

SET LOCAL lock_timeout = '5s';

-- ── 1. pg_trgm ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension
                  WHERE extname = 'pg_trgm' AND extnamespace = 'extensions'::regnamespace) THEN
    RAISE EXCEPTION 'pg_trgm is installed outside the extensions schema; move it there first.';
  END IF;
END;
$$;

-- ── 2. search__unaccent ──────────────────────────────────────────────────────
-- IMMUTABLE so a stored generated column may call it (unaccent() alone is STABLE).
-- The dictionary is schema-qualified, so no search_path can swap it. If unaccent's
-- rules ever change, rewrite the columns built on it.

CREATE OR REPLACE FUNCTION public.search__unaccent(p_text text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = ''
  RETURN extensions.unaccent('extensions.unaccent'::regdictionary, p_text);

COMMENT ON FUNCTION public.search__unaccent(text) IS
  'Search (GS-1): unaccent as an IMMUTABLE function, for indexed text and queries alike.';

-- ── 3. search__query ─────────────────────────────────────────────────────────
-- websearch syntax ("a phrase", or, -word) over the unaccented query, at most 256
-- characters and 32 words; each word of 3+ letters becomes a prefix ('zadan':*),
-- shorter ones match whole words only ("ok", "UI", "za"), a negated word stays
-- exact. Punctuation-only input, or a query with no word it needs (only negated
-- words, "x or -y"), gives null (no rows, never every row). It never raises on
-- what someone typed: if the rewrite can't be read back, the plain query is used.
-- The text someone typed is only ever a parameter of websearch_to_tsquery.

CREATE OR REPLACE FUNCTION public.search__query(p_query text)
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
    'pg_catalog.simple'::regconfig, public.search__unaccent(v_text));
BEGIN
  -- Nothing searchable, or nothing to find: a query an empty document would match
  -- ("-standup", "x or -y") has no word it needs, so it would list every row.
  IF pg_catalog.numnode(v_q) = 0
     OR ''::pg_catalog.tsvector OPERATOR(pg_catalog.@@) v_q THEN
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

COMMENT ON FUNCTION public.search__query(text) IS
  'Search (GS-1): websearch syntax, unaccented, words of 3+ letters as prefixes, 256 characters / 32 words; null when nothing is searchable.';

-- ── 4. The snippet's text search config ──────────────────────────────────────
-- Display only: it unaccents per token, so ts_headline over the original text
-- marks "żółw" for 'zolw':*. Indexes use search__unaccent before parsing (it
-- doesn't depend on the database's ctype).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config
                  WHERE cfgname = 'search_headline' AND cfgnamespace = 'public'::regnamespace) THEN
    CREATE TEXT SEARCH CONFIGURATION public.search_headline (COPY = pg_catalog.simple);
    ALTER TEXT SEARCH CONFIGURATION public.search_headline
      ALTER MAPPING FOR word, hword, hword_part WITH extensions.unaccent, pg_catalog.simple;
  END IF;
END;
$$;

-- ── 5. search__snippet ───────────────────────────────────────────────────────
-- One fragment of 8–24 words around the first match, matches between U+E000 and
-- U+E001: plain text the client splits on and draws, never HTML. Only the first
-- 20,000 characters are read (headline cost grows with the text), and callers
-- build snippets only for the rows they return (Assumption 9).

CREATE OR REPLACE FUNCTION public.search__snippet(p_text text, p_query tsquery)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = ''
  RETURN pg_catalog.ts_headline('public.search_headline'::regconfig,
    pg_catalog.left(p_text, 20000), p_query,
    'StartSel=' || pg_catalog.chr(57344) || ', StopSel=' || pg_catalog.chr(57345)
    || ', MaxWords=24, MinWords=8, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "');

COMMENT ON FUNCTION public.search__snippet(text, tsquery) IS
  'Search (GS-1): a short snippet of the text with matches between U+E000 and U+E001.';

-- ── 6. Grants ────────────────────────────────────────────────────────────────
-- Server-only: the module searches are definer functions and call these as their
-- owner; clients never call them. A generated column or index that calls
-- search__unaccent runs it as whoever writes the row: the block that adds one
-- grants its writers EXECUTE (or writes through a definer op).

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'search__unaccent(text)',
    'search__query(text)',
    'search__snippet(text, tsquery)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% must be server-only (service_role, never anon or authenticated).', fn;
    END IF;
  END LOOP;
END;
$$;
