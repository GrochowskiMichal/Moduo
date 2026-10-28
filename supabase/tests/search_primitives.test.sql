-- GS-1: the shared search primitives every <module>__search builds on
-- (specs/global-search.md, Assumptions 2–5, AC2): search__unaccent,
-- search__query, the search_headline config, search__snippet, and pg_trgm in
-- extensions. "unaccent, prefixes, bounds, negation".
--
-- test.hit(doc, query) indexes doc the way a module will (simple config over the
-- unaccented text) and says whether the query finds it.

CREATE FUNCTION test.hit(p_doc text, p_query text) RETURNS boolean LANGUAGE sql AS $$
  SELECT coalesce(
    pg_catalog.to_tsvector('pg_catalog.simple'::regconfig, public.search__unaccent(p_doc))
      @@ public.search__query(p_query),
    false)
$$;

-- ── 1. Accents ignored, both ways ────────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(public.search__unaccent('Żółw łąka') = 'Zolw laka',
    'unaccent: "Żółw łąka" becomes "Zolw laka" ("ł" is "l", "ż" is "z")', public.search__unaccent('Żółw łąka'));
  PERFORM test.ok(test.hit('żółw w ogrodzie', 'zolw'),
    'accents: "zolw" finds "żółw"');
  PERFORM test.ok(test.hit('zolw w ogrodzie', 'żółw'),
    'accents: "żółw" finds "zolw" (the reverse)');
  PERFORM test.ok(test.hit('Spotkanie z Łukaszem', 'LUKASZ') AND test.hit('spotkanie z lukaszem', 'Łukasz'),
    'accents: case and diacritics are ignored together');
  PERFORM test.ok(test.hit('Café crème', 'cafe creme'),
    'accents: Latin diacritics beyond Polish are ignored too');
END;
$$;

-- ── 2. Prefixes from 3 letters, whole words below ────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(test.hit('Q4 planning review', 'pla'),
    'prefix: "pla" finds "planning"');
  PERFORM test.ok(NOT test.hit('Q4 planning review', 'pl'),
    'prefix: "pl" does not find "planning" (under 3 letters is a whole word)');
  PERFORM test.ok(test.hit('copy the pl file', 'pl'),
    'prefix: "pl" still finds the whole word "pl"');
  PERFORM test.ok(test.hit('Q4 planning review', 'Q4'),
    'prefix: a two-character word matches itself');
  PERFORM test.ok(public.search__query('pla')::text = '''pla'':*',
    'prefix: the query for "pla" is pla:*', public.search__query('pla')::text);
END;
$$;

-- ── 3. Every word must match, in any order ───────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(test.hit('żółw w ogrodzie', 'ogrod zolw'),
    'words: every word matches, in any order');
  PERFORM test.ok(NOT test.hit('żółw w ogrodzie', 'zolw kot'),
    'words: one missing word means no match');
  PERFORM test.ok(test.hit('the budget for next quarter', '"next quarter"')
      AND NOT test.hit('quarter is next', '"next quarter"'),
    'words: a quoted phrase matches in order only');
  PERFORM test.ok(test.hit('alpha only', 'alpha or omega') AND test.hit('omega only', 'alpha or omega'),
    'words: "or" matches either word');
END;
$$;

-- ── 4. Negation and nothing to search: NULL, never every row ─────────────────
DO $$
BEGIN
  PERFORM test.ok(test.hit('żółw na łące', 'zolw -ogrodzie') AND NOT test.hit('żółw w ogrodzie', 'zolw -ogrodzie'),
    'negation: "-word" leaves out what has it');
  PERFORM test.ok(public.search__query('-x') IS NULL,
    'negation: "-x" alone is null (it would match every row)');
  PERFORM test.ok(public.search__query('-standup -zolw') IS NULL,
    'negation: only negated words is null');
  PERFORM test.ok(public.search__query('zolw or -ogrodzie') IS NULL,
    'negation: "x or -y" needs no word, so it is null');
  PERFORM test.ok(public.search__query('') IS NULL
      AND public.search__query('   ') IS NULL
      AND public.search__query('!!! ... ???') IS NULL
      AND public.search__query(NULL) IS NULL,
    'empty: empty, blank, punctuation-only and NULL input are null');
  PERFORM test.ok(public.search__query('zolw -standup') IS NOT NULL,
    'negation: a needed word beside a negated one still searches');
  PERFORM test.ok(NOT test.hit('anything at all', '-x'),
    'negation: a null query finds nothing');
END;
$$;

-- ── 5. Bounds: 256 characters, 32 words, never an error ──────────────────────
DO $$
DECLARE
  v_paste text := pg_catalog.repeat('lorem ipsum dolor ', 56);  -- 1,008 characters
  v_one_word text := pg_catalog.repeat('x', 1000);
  v_32 text := pg_catalog.array_to_string(ARRAY(SELECT 'w' || g || 'abc' FROM generate_series(1, 32) g), ' ');
  v_ok boolean;
BEGIN
  PERFORM test.ok(pg_catalog.length(v_paste) > 1000, 'bounds: the paste is over 1,000 characters');
  BEGIN
    v_ok := public.search__query(v_paste) IS NOT NULL
        AND public.search__query(v_one_word) IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;
  PERFORM test.ok(v_ok, 'bounds: a 1,000-character paste and a 1,000-letter word are cut without an error');
  -- Word 33 is dropped: a document with the first 32 words but not the 33rd matches.
  PERFORM test.ok(test.hit(v_32, v_32 || ' missingword'),
    'bounds: only the first 32 words count');
  PERFORM test.ok(NOT test.hit(v_32, pg_catalog.replace(v_32, 'w32abc', 'missingword')),
    'bounds: the 32nd word still counts');
  -- Text past character 256 is dropped: "zebra" starts at character 258.
  PERFORM test.ok(test.hit('alpha', pg_catalog.repeat(' ', 250) || 'alpha  zebra'),
    'bounds: words past 256 characters are dropped');
  PERFORM test.ok(NOT test.hit('alpha', pg_catalog.repeat(' ', 240) || 'alpha  zebra'),
    'bounds: words inside 256 characters count');
END;
$$;

-- ── 6. The snippet: U+E000 … U+E001 around the match, accents kept ───────────
DO $$
DECLARE
  v_body text := 'Notatki ze spotkania. Żółw mieszka w ogrodzie od zeszłego lata i je sałatę.';
  v_snip text := public.search__snippet(v_body, public.search__query('zolw'));
  v_long text := pg_catalog.repeat('filler words here ', 3000) || ' needle at the end';
  v_long_snip text := public.search__snippet(v_long, public.search__query('filler'));
BEGIN
  PERFORM test.ok(v_snip LIKE '%' || pg_catalog.chr(57344) || 'Żółw' || pg_catalog.chr(57345) || '%',
    'snippet: "zolw" marks the original "Żółw" with U+E000 … U+E001', v_snip);
  PERFORM test.ok(v_snip NOT LIKE '%<b>%',
    'snippet: no HTML markers', v_snip);
  PERFORM test.ok(public.search__snippet('Q4 planning review', public.search__query('pla'))
      LIKE '%' || pg_catalog.chr(57344) || 'planning' || pg_catalog.chr(57345) || '%',
    'snippet: a prefix marks the whole word', public.search__snippet('Q4 planning review', public.search__query('pla')));
  PERFORM test.ok(pg_catalog.length(v_long_snip) < 400,
    'snippet: a long body gives a short snippet', pg_catalog.length(v_long_snip)::text);
  PERFORM test.ok(public.search__snippet(NULL, public.search__query('zolw')) IS NULL
      AND public.search__snippet(v_body, NULL) IS NULL,
    'snippet: NULL text or a NULL query gives NULL');
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_ts_config
                           WHERE cfgname = 'search_headline' AND cfgnamespace = 'public'::regnamespace),
    'snippet: public.search_headline exists');
END;
$$;

-- ── 7. Shape: immutable, pinned search_path, pg_trgm in extensions ───────────
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['search__unaccent(text)', 'search__query(text)', 'search__snippet(text, tsquery)'] LOOP
    PERFORM test.ok(EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc
         WHERE oid = to_regprocedure('public.' || v_fn)
           AND provolatile = 'i' AND NOT prosecdef
           AND proconfig @> ARRAY['search_path=""']),
      'shape: public.' || v_fn || ' is IMMUTABLE, invoker, with an empty search_path');
  END LOOP;
  PERFORM test.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_extension
                           WHERE extname = 'pg_trgm' AND extnamespace = 'extensions'::regnamespace),
    'trigram: pg_trgm is installed in extensions');
  PERFORM test.ok(extensions.similarity('planning', 'planing') >= 0.3,
    'trigram: a one-letter typo is similar at 0.3 or more');
END;
$$;

-- ── 8. Server-only ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['search__unaccent(text)', 'search__query(text)', 'search__snippet(text, tsquery)'] LOOP
    PERFORM test.ok(NOT has_function_privilege('anon', 'public.' || v_fn, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.' || v_fn, 'EXECUTE')
        AND has_function_privilege('service_role', 'public.' || v_fn, 'EXECUTE'),
      'grants: public.' || v_fn || ' is server-only (service_role, never anon or authenticated)');
  END LOOP;
END;
$$;

-- ── 9. Chat untouched ────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM test.ok(public.chat__search_query('zolw')::text = public.search__query('zolw')::text
      AND public.chat__search_query('-standup') IS NULL,
    'chat: chat__search_query still answers, the same as search__query');
END;
$$;
