-- Chat v2 · CV-1 foundation (specs/chat-v2.md; .design/chat-v2/research/round-3-database.md
-- §2.1, §2.2, §2.5, §2.7, §2.25 a and h). The stamp is provisional: re-cut on the day it
-- applies, after everything landed by then, keeping chat's order (foundation, then
-- …_chat_v2_convert_v1).
--
-- What it adds, all before any v2 row is written:
--   1. Search plumbing: `unaccent`, `chat__unaccent`, `chat__body_text` (the stored
--      form's words: spike 4's `toBodyText`, in SQL) and the v1 → v2 converter
--      (`chat__v1_to_v2`, spike 4's draft). The conversion itself is
--      `chat__convert_v1()`, defined here and run by …_chat_v2_convert_v1.
--   2. New columns on the three chat tables (messages: updated_at, format_version,
--      body_text, search_tsv, reply_to_id, v1_thread_reply, kind, event,
--      mentioned_team_ids, mentions_everyone, api_key_id; channels: is_default,
--      deleted_at/by; members: last_read_id, left_at, removed_by, updated_at), the
--      `zz_stamp_updated_at` triggers and the body_text trigger.
--   3. `chat_catchup` and `chat_chain_mutes`, empty: own rows only, written by ops.
--   4. The read rule without the plan (CH4a): a member with Chat at View reads a
--      conversation, unless they left it or it was deleted. The registry, activity
--      and link rows about a conversation follow it (perm_can_see_entity's chat
--      branches are live since 20261014090000; spine__visible_to and the
--      entity_links read policy gain theirs here).
--   5. Realtime: a conversation's typing topic is read by its members only; the
--      publication is re-asserted with chat_catchup.
--   6. Account erasure counts and deletes the two new per-person tables.
--
-- Existing rows keep their v1 text (format_version 1) until the conversion runs;
-- this file adds columns and backfills only new columns.
--
-- Every redefined function starts from its live body (2026-10-14). Grants are
-- re-stated and asserted at the end.

-- Fail fast instead of queueing the app behind the table rewrite (search_tsv is a
-- stored generated column: one rewrite of chat_messages, ~0.8 s per 100,000 rows).
SET LOCAL lock_timeout = '5s';

-- ── 1. Search plumbing and the stored form ──────────────────────────────────

-- Release train: `unaccent` must be in prod's pg_available_extensions (risk 10).
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- IMMUTABLE so a stored generated column may call it (unaccent() alone is STABLE).
-- The dictionary is schema-qualified, so no search_path can swap it. If unaccent's
-- rules ever change, rewrite the column: UPDATE chat_messages SET body_text = body_text.
CREATE OR REPLACE FUNCTION public.chat__unaccent(p_text text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = ''
  RETURN extensions.unaccent('extensions.unaccent'::regdictionary, p_text);

-- A real calendar day (types.ts isIsoDay).
CREATE OR REPLACE FUNCTION public.chat__is_iso_day(p_day text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  y integer;
  mo integer;
  d integer;
BEGIN
  IF p_day IS NULL OR p_day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN false;
  END IF;
  y := substr(p_day, 1, 4)::integer;
  mo := substr(p_day, 6, 2)::integer;
  d := substr(p_day, 9, 2)::integer;
  IF y < 1 OR mo < 1 OR mo > 12 OR d < 1 THEN
    RETURN false;
  END IF;
  RETURN d <= extract(day FROM (make_date(y, mo, 1) + interval '1 month' - interval '1 day'))::integer;
END
$fn$;

-- The words of one run of inline content in the v2 stored form (markup-v2
-- parse.ts parseInline, read as text.ts inlineText): escapes resolved, code kept
-- as typed, a link's label kept and its target dropped, `moduo://` references and
-- days read as nothing (a title or an id never becomes searchable text), `*`/`~~`
-- emphasis markers dropped; URLs, `@channel` and `:name:` stay as text.
-- Markers pair loosely (one with a partner of its character on the right side is
-- dropped; one without stays text). The client's emphasis stack can read a few
-- unusual runs differently; the serializer and the conversion escape every
-- literal `*` and `~~`, so only text no editor writes can hold such a run.
-- Agreement with the client was checked on 3,111 converted rows and spike 4's
-- 290 corpus strings (docs/build/chat-v2/CV-1.md).
CREATE OR REPLACE FUNCTION public.chat__inline_text(p_src text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  c text[];
  n integer;
  i integer := 1;
  j integer;
  r integer;
  v_run integer;
  v_close integer;
  o text[] := '{}';
  lbs integer[] := '{}';   -- positions in o of a '[' that may still open a link
  v_np integer := 0;       -- o's length when a reference, day, link or break was last read
  ch text;
  v text;
  m text[];
  v_lb integer;
  v_href text;
  v_depth integer;
  v_ok boolean;
  v_before text;
  v_after text;
  -- Emphasis markers read so far: where in o, which character, how long, and
  -- whether the run could open or close.
  d_pos integer[] := '{}';
  d_ch text[] := '{}';
  d_n integer[] := '{}';
  d_open boolean[] := '{}';
  d_close boolean[] := '{}';
  k integer;
  q integer;
BEGIN
  IF p_src IS NULL OR p_src = '' THEN
    RETURN p_src;
  END IF;
  c := regexp_split_to_array(p_src, '');
  n := cardinality(c);
  WHILE i <= n LOOP
    ch := c[i];
    -- Plain text up to the next character that can mean something.
    IF ch !~ '[\\`m\[\]*~\n]' THEN
      j := i + 1;
      WHILE j <= n AND c[j] !~ '[\\`m\[\]*~\n]' LOOP
        j := j + 1;
      END LOOP;
      o := o || array_to_string(c[i:j - 1], '');
      i := j;
      CONTINUE;
    END IF;
    IF ch = '\' THEN
      IF i < n AND c[i + 1] ~ '^[!-/:-@\[-`{-~]$' THEN
        o := o || c[i + 1];
        i := i + 2;
      ELSE
        o := o || '\'::text;
        i := i + 1;
      END IF;
      CONTINUE;
    END IF;
    IF ch = '`' THEN
      v_run := 1;
      WHILE i + v_run <= n AND c[i + v_run] = '`' LOOP
        v_run := v_run + 1;
      END LOOP;
      -- The closing run: exactly as long, on the same line.
      j := i + v_run;
      v_close := -1;
      WHILE j <= n AND c[j] <> E'\n' LOOP
        IF c[j] = '`' THEN
          r := 1;
          WHILE j + r <= n AND c[j + r] = '`' LOOP
            r := r + 1;
          END LOOP;
          IF r = v_run THEN
            v_close := j;
            EXIT;
          END IF;
          j := j + r;
        ELSE
          j := j + 1;
        END IF;
      END LOOP;
      IF v_close < 0 THEN
        o := o || repeat('`', v_run);
        i := i + v_run;
        CONTINUE;
      END IF;
      v := array_to_string(c[i + v_run:v_close - 1], '');
      IF length(v) >= 2 AND left(v, 1) = ' ' AND right(v, 1) = ' ' AND v !~ '^ +$' THEN
        v := substr(v, 2, length(v) - 2);
      END IF;
      o := o || v;
      i := v_close + v_run;
      CONTINUE;
    END IF;
    IF ch = 'm' THEN
      IF array_to_string(c[i:i + 7], '') = 'moduo://' THEN
        m := regexp_match(array_to_string(c[i:i + 80], ''),
          '^moduo://(?:date/([0-9]{4}-[0-9]{2}-[0-9]{2})|([a-z][a-z_-]{0,31})/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))');
        IF m IS NOT NULL AND (m[1] IS NULL OR public.chat__is_iso_day(m[1])) THEN
          i := i + length(CASE WHEN m[1] IS NOT NULL THEN 'moduo://date/' || m[1]
                               ELSE 'moduo://' || m[2] || '/' || m[3] END);
          v_np := cardinality(o);
          CONTINUE;
        END IF;
      END IF;
      o := o || ch;
      i := i + 1;
      CONTINUE;
    END IF;
    IF ch = '[' THEN
      o := o || '['::text;
      lbs := lbs || cardinality(o);
      i := i + 1;
      CONTINUE;
    END IF;
    IF ch = ']' THEN
      v_lb := CASE WHEN cardinality(lbs) > 0 THEN lbs[cardinality(lbs)] END;
      v_ok := false;
      IF v_lb IS NOT NULL AND i < n AND c[i + 1] = '(' AND v_np < v_lb AND cardinality(o) > v_lb THEN
        -- The destination (parse.ts parseDestination).
        j := i + 2;
        v_href := '';
        IF j <= n AND c[j] = '<' THEN
          j := j + 1;
          WHILE j <= n AND c[j] <> '>' LOOP
            EXIT WHEN c[j] = E'\n' OR c[j] = '<';
            IF c[j] = '\' AND j < n AND c[j + 1] ~ '^[!-/:-@\[-`{-~]$' THEN
              v_href := v_href || c[j + 1];
              j := j + 2;
            ELSE
              v_href := v_href || c[j];
              j := j + 1;
            END IF;
          END LOOP;
          IF j <= n AND c[j] = '>' THEN
            j := j + 1;
            v_ok := j <= n AND c[j] = ')';
          END IF;
        ELSE
          v_depth := 0;
          WHILE j <= n LOOP
            EXIT WHEN c[j] ~ '[[:space:]]' OR ascii(c[j]) < 32;
            IF c[j] = '\' AND j < n AND c[j + 1] ~ '^[!-/:-@\[-`{-~]$' THEN
              v_href := v_href || c[j + 1];
              j := j + 2;
              CONTINUE;
            END IF;
            IF c[j] = '(' THEN
              v_depth := v_depth + 1;
            ELSIF c[j] = ')' THEN
              EXIT WHEN v_depth = 0;
              v_depth := v_depth - 1;
            END IF;
            v_href := v_href || c[j];
            j := j + 1;
          END LOOP;
          v_ok := v_depth = 0 AND j <= n AND c[j] = ')';
        END IF;
        IF v_ok THEN
          m := regexp_match(v_href,
            '^moduo://(?:date/([0-9]{4}-[0-9]{2}-[0-9]{2})|([a-z][a-z_-]{0,31})/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))$');
          IF m IS NOT NULL AND (m[2] IS NOT NULL OR public.chat__is_iso_day(m[1])) THEN
            -- `[title](moduo://…)`: the title is never stored or drawn.
            o := o[1:v_lb - 1];
            k := 1;
            WHILE k <= cardinality(d_pos) LOOP
              IF d_pos[k] >= v_lb THEN
                d_pos := d_pos[1:k - 1] || d_pos[k + 1:];
                d_ch := d_ch[1:k - 1] || d_ch[k + 1:];
                d_n := d_n[1:k - 1] || d_n[k + 1:];
                d_open := d_open[1:k - 1] || d_open[k + 1:];
                d_close := d_close[1:k - 1] || d_close[k + 1:];
              ELSE
                k := k + 1;
              END IF;
            END LOOP;
          ELSIF m IS NULL AND v_href ~* '^(https?://[^[:space:]]+|mailto:[^[:space:]]+)$'
                AND v_href !~ '[\x01-\x1f\x7f]' THEN
            o[v_lb] := '';
          ELSE
            v_ok := false;
          END IF;
        END IF;
        IF v_ok THEN
          lbs := '{}';
          v_np := cardinality(o);
          i := j + 1;
          CONTINUE;
        END IF;
      END IF;
      IF v_lb IS NOT NULL THEN
        lbs := lbs[1:cardinality(lbs) - 1];
      END IF;
      o := o || ']'::text;
      i := i + 1;
      CONTINUE;
    END IF;
    IF ch = '*' OR ch = '~' THEN
      v_run := 1;
      WHILE i + v_run <= n AND c[i + v_run] = ch LOOP
        v_run := v_run + 1;
      END LOOP;
      v_before := CASE WHEN i > 1 THEN c[i - 1] END;
      v_after := CASE WHEN i + v_run <= n THEN c[i + v_run] END;
      IF (ch = '~' AND v_run <> 2)
         OR ((v_after IS NULL OR v_after ~ '[[:space:]]') AND (v_before IS NULL OR v_before ~ '[[:space:]]')) THEN
        o := o || repeat(ch, v_run);
      ELSE
        o := o || ''::text;   -- an emphasis marker: no words (unless it never pairs, below)
        d_pos := d_pos || cardinality(o);
        d_ch := d_ch || ch;
        d_n := d_n || v_run;
        d_open := d_open || (v_after IS NOT NULL AND v_after !~ '[[:space:]]');
        d_close := d_close || (v_before IS NOT NULL AND v_before !~ '[[:space:]]');
      END IF;
      i := i + v_run;
      CONTINUE;
    END IF;
    -- A line break.
    o := o || E'\n'::text;
    v_np := cardinality(o);
    i := i + 1;
  END LOOP;
  -- A marker with no partner of its character (an opener with no closer after it,
  -- a closer with no opener before it) is text, as the client reads it (`**open`).
  FOR k IN 1 .. coalesce(cardinality(d_pos), 0) LOOP
    v_ok := false;
    IF d_open[k] THEN
      FOR q IN k + 1 .. cardinality(d_pos) LOOP
        IF d_ch[q] = d_ch[k] AND d_close[q] THEN
          v_ok := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    IF NOT v_ok AND d_close[k] THEN
      FOR q IN 1 .. k - 1 LOOP
        IF d_ch[q] = d_ch[k] AND d_open[q] THEN
          v_ok := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;
    IF NOT v_ok THEN
      o[d_pos[k]] := repeat(d_ch[k], d_n[k]);
    END IF;
  END LOOP;
  RETURN array_to_string(o, '');
END
$fn$;

-- A list item's marker (parse.ts listMarker): {ordered, char, number, indent, content}.
CREATE OR REPLACE FUNCTION public.chat__list_marker(p_line text)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  m text[];
BEGIN
  m := regexp_match(p_line, '^( {0,3})([-*+])(?:[ \t](.*))?$');
  IF m IS NOT NULL THEN
    RETURN ARRAY['f', m[2], '1', (length(m[1]) + 2)::text, coalesce(m[3], '')];
  END IF;
  m := regexp_match(p_line, '^( {0,3})([0-9]{1,9})([.)])(?:[ \t](.*))?$');
  IF m IS NOT NULL THEN
    RETURN ARRAY['t', m[3], m[2], (length(m[1]) + length(m[2]) + 2)::text, coalesce(m[4], '')];
  END IF;
  RETURN NULL;
END
$fn$;

-- body_text: the words of a v2 stored body (markup-v2 text.ts toBodyText over
-- parse.ts parseStored): code blocks as typed, quote and list markers dropped,
-- blocks and lines kept apart by "\n", trimmed. Never a person's id or a
-- reference's label, so nobody is found through message text.
CREATE OR REPLACE FUNCTION public.chat__body_text(p_body text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  v_lines text[];
  n integer;
  i integer := 1;
  v_blocks text[] := '{}';
  v_line text;
  m text[];
  v_size integer;
  v_body text[];
  v_items text[];
  v_item text[];
  v_first text[];
  v_mark text[];
  v_next text[];
  v_indent integer;
  v_para text[];
  v_prev text;
  v_cand text;
  v_cut boolean;
BEGIN
  IF p_body IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_body = '' THEN
    RETURN '';
  END IF;
  v_lines := string_to_array(regexp_replace(p_body, E'\r\n?', E'\n', 'g'), E'\n');
  n := cardinality(v_lines);
  WHILE i <= n LOOP
    v_line := v_lines[i];
    m := regexp_match(v_line, '^ {0,3}(`{3,})([^`]*)$');
    IF m IS NOT NULL THEN
      v_size := length(m[1]);
      v_body := '{}';
      i := i + 1;
      WHILE i <= n AND v_lines[i] !~ ('^ {0,3}`{' || v_size || ',}[ \t]*$') LOOP
        v_body := v_body || v_lines[i];
        i := i + 1;
      END LOOP;
      i := i + 1;
      v_blocks := v_blocks || array_to_string(v_body, E'\n');
      IF i <= n AND v_lines[i] = '' THEN i := i + 1; END IF;
      CONTINUE;
    END IF;
    IF v_line ~ '^ {0,3}>' THEN
      v_body := '{}';
      WHILE i <= n AND v_lines[i] ~ '^ {0,3}>' LOOP
        v_body := v_body || substring(v_lines[i] FROM '^ {0,3}> ?(.*)$');
        i := i + 1;
      END LOOP;
      v_blocks := v_blocks || public.chat__inline_text(array_to_string(v_body, E'\n'));
      IF i <= n AND v_lines[i] = '' THEN i := i + 1; END IF;
      CONTINUE;
    END IF;
    v_first := public.chat__list_marker(v_line);
    IF v_first IS NOT NULL THEN
      v_items := '{}';
      v_mark := v_first;
      WHILE v_mark IS NOT NULL LOOP
        v_item := ARRAY[v_mark[5]];
        v_indent := v_mark[4]::integer;
        i := i + 1;
        LOOP
          EXIT WHEN i > n OR v_lines[i] = '';
          IF v_lines[i] ~ '^[[:space:]]+$' THEN
            v_item := v_item || CASE WHEN length(v_lines[i]) > v_indent THEN substr(v_lines[i], v_indent + 1) ELSE '' END;
          ELSIF left(v_lines[i], v_indent) = repeat(' ', v_indent) THEN
            v_item := v_item || substr(v_lines[i], v_indent + 1);
          ELSE
            EXIT;
          END IF;
          i := i + 1;
        END LOOP;
        v_items := v_items || public.chat__inline_text(array_to_string(v_item, E'\n'));
        v_next := CASE WHEN i <= n THEN public.chat__list_marker(v_lines[i]) END;
        v_mark := CASE WHEN v_next IS NOT NULL AND v_next[1] = v_first[1] AND v_next[2] = v_first[2]
                       THEN v_next END;
      END LOOP;
      v_blocks := v_blocks || array_to_string(v_items, E'\n');
      IF i <= n AND v_lines[i] = '' THEN i := i + 1; END IF;
      CONTINUE;
    END IF;
    -- A paragraph, until a line that starts a block (parse.ts interrupts).
    v_para := ARRAY[v_line];
    i := i + 1;
    LOOP
      EXIT WHEN i > n;
      v_cand := v_lines[i];
      v_prev := v_lines[i - 1];
      IF v_cand ~ '^ {0,3}(`{3,})([^`]*)$' OR v_cand ~ '^ {0,3}>' THEN
        v_cut := true;
      ELSE
        v_mark := public.chat__list_marker(v_cand);
        v_cut := v_mark IS NOT NULL AND (
          v_prev = ''
          OR (btrim(v_mark[5], E' \t\n\r\f\v') <> ''
              AND (v_mark[1] = 'f' OR v_mark[3]::bigint = 1)));
      END IF;
      EXIT WHEN v_cut;
      v_para := v_para || v_cand;
      i := i + 1;
    END LOOP;
    IF i <= n AND cardinality(v_para) > 1 AND v_para[cardinality(v_para)] = '' THEN
      v_para := v_para[1:cardinality(v_para) - 1];
    ELSIF i <= n AND cardinality(v_para) = 1 AND v_para[1] = '' THEN
      CONTINUE;
    END IF;
    v_blocks := v_blocks || public.chat__inline_text(array_to_string(v_para, E'\n'));
  END LOOP;
  RETURN btrim(regexp_replace(array_to_string(v_blocks, E'\n'), E'[ \t]+\n', E'\n', 'g'),
               E' \t\n\r\f\v ﻿');
END
$fn$;

-- ── The v1 → v2 converter (CV-0 spike 4's draft, docs/build/chat-v2/drafts/chat_v1_to_v2.sql) ──
-- chat__v1_to_v2(body): a v1 chat body → the v2 stored form. IMMUTABLE, text in,
-- text out, and NOT idempotent (a second pass escapes the escapes): every caller
-- gates on format_version = 1.
--   <@id>                  → moduo://person/<id>   (id lower-cased)
--   <!channel>             → @channel              (a space where v1 glued it to a word)
--   <moduo:TYPE:ID|Label>  → moduo://TYPE/<id>     (the label goes)
--   _italic_               → *italic*
--   **bold**, ~~strike~~   → kept; spaces at their inner edges move outside
--   ```fences```           → on their own lines; a one-line ```x``` keeps x as code
--   `code`                 → re-fenced so v2 reads the same code
--   URLs                   → kept; written `[url](url)` where v2 would cut elsewhere
-- Anything v1 drew as text but v2 would read as syntax is escaped. Tokens inside
-- code stay literal (they were literal in v1). Uses chr(1)/chr(2) as markers: the
-- conversion refuses a v1 body that holds either.

CREATE OR REPLACE FUNCTION public.chat__v1_inline(p_text text, p_in_italic boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  v_out text := '';
  m text[];
  v_inner text;
  v_lead text;
  v_trail text;
  v_code text;
  v_code_prev text;
  v_code_start integer := -1;
  v_code_end integer := -1;
  v_url text;
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN p_text;
  END IF;
  -- One alternation in v1's order (markup.ts INLINE_RE); every character of the
  -- text lands in exactly one match, so the pieces join back losslessly.
  FOR m IN
    SELECT x
    FROM regexp_matches(
      p_text,
      '(`[^`\n]+`)'                                                                   -- 1 code span
      || '|<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>' -- 2 mention
      || '|(<!channel>)'                                                              -- 3 @channel
      || '|<moduo:([a-z_]{1,32}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\|[^>\n]{0,200}>' -- 4 type, 5 id
      || '|(https?://[^\s<>]+[^\s<>.,;:!?"'')\]])'                                    -- 6 url
      || '|\*\*((?:[^*\n]|\*(?!\*))+)\*\*'                                             -- 7 bold (v1: shortest **…**)
      || '|~~((?:[^~\n]|~(?!~))+)~~'                                                   -- 8 strike
      || '|(?<![A-Za-z0-9_*])\*((?![[:space:]])[^*\n]+?(?<![[:space:]]))\*(?![A-Za-z0-9_*])' -- 9 *italic*
      || '|(?<![A-Za-z0-9_])_((?![[:space:]])[^_\n]+?(?<![[:space:]]))_(?![A-Za-z0-9_])'   -- 10 _italic_
      || '|(\\)'                                                                       -- 11 a backslash
      || '|([^`<h*~_\\]+|.)',                                                          -- 12 plain text
      'g'
    ) AS x
  LOOP
    IF m[1] IS NOT NULL THEN
      -- v2 pairs backtick runs by length and trims one padding space each side:
      -- pad spans that start and end with a space, and join two spans in a row.
      v_code := substr(m[1], 2, length(m[1]) - 2);
      IF v_code_end = length(v_out) THEN
        v_code := v_code_prev || v_code;
        v_out := left(v_out, v_code_start);
      END IF;
      v_code_prev := v_code;
      v_code_start := length(v_out);
      v_out := v_out || '`'
        || CASE WHEN v_code ~ '^ .* $' AND v_code !~ '^ +$' THEN ' ' || v_code || ' ' ELSE v_code END
        || '`';
      v_code_end := length(v_out);
    ELSIF m[2] IS NOT NULL THEN
      v_out := v_out || 'moduo://person/' || lower(m[2]);
    ELSIF m[3] IS NOT NULL THEN
      -- v2's @channel needs a token start, across emphasis too. chr(2) marks one
      -- that opens this (maybe nested) text, chr(1) its end; chat__v1_to_v2 adds
      -- the spaces where a word is glued on either side.
      v_out := v_out
        || CASE WHEN v_out = '' THEN chr(2) WHEN v_out ~ '[[:space:]]$' THEN '' ELSE ' ' END
        || '@channel' || chr(1);
    ELSIF m[4] IS NOT NULL THEN
      v_out := v_out || 'moduo://' || m[4] || '/' || lower(m[5]);
    ELSIF m[6] IS NOT NULL THEN
      -- v1 drew the whole URL as a link: v2 must not read syntax inside it, and
      -- must link exactly these characters. Where v2's bare-URL rule would cut
      -- elsewhere, write the link out: `[url](url)`.
      v_url := replace(regexp_replace(m[6], '([\\*`~\[\]])', '\\\1', 'g'), 'moduo://', 'moduo\://');
      IF m[6] ~ '[*_~}]$'
        OR m[6] ~ '\\'
        OR v_out ~ '[A-Za-z0-9]$'
        OR length(m[6]) - length(replace(m[6], '(', '')) <> length(m[6]) - length(replace(m[6], ')', ''))
        OR length(m[6]) - length(replace(m[6], '[', '')) <> length(m[6]) - length(replace(m[6], ']', ''))
        OR length(m[6]) - length(replace(m[6], '{', '')) <> length(m[6]) - length(replace(m[6], '}', ''))
      THEN
        v_out := v_out || '[' || v_url || '](' || regexp_replace(m[6], '([\\()<>])', '\\\1', 'g') || ')';
      ELSE
        v_out := v_out || v_url;
      END IF;
    ELSIF m[7] IS NOT NULL OR m[8] IS NOT NULL THEN
      v_inner := coalesce(m[7], m[8]);
      v_lead := substring(v_inner FROM '^[[:space:]]*');
      v_trail := substring(v_inner FROM '[[:space:]]*$');
      IF length(v_lead) = length(v_inner) THEN
        v_out := v_out || v_inner;
      ELSE
        v_out := v_out || v_lead
          || CASE WHEN m[7] IS NOT NULL THEN '**' ELSE '~~' END
          || public.chat__v1_inline(substring(v_inner FROM length(v_lead) + 1
               FOR length(v_inner) - length(v_lead) - length(v_trail)), p_in_italic)
          || CASE WHEN m[7] IS NOT NULL THEN '**' ELSE '~~' END
          || v_trail;
      END IF;
    ELSIF m[9] IS NOT NULL OR m[10] IS NOT NULL THEN
      v_inner := public.chat__v1_inline(coalesce(m[9], m[10]), true);
      v_out := v_out || CASE WHEN p_in_italic THEN v_inner ELSE '*' || v_inner || '*' END;
    ELSIF m[11] IS NOT NULL THEN
      v_out := v_out || '\\';
    ELSE
      v_out := v_out || replace(regexp_replace(m[12], '([*`~])', '\\\1', 'g'), 'moduo://', 'moduo\://');
    END IF;
  END LOOP;
  RETURN v_out;
END
$fn$;

-- Prose between fences: inline conversion, then a `>` after 1–3 spaces at a line
-- start is escaped (v1 drew it as text; v2 would start a quote).
CREATE OR REPLACE FUNCTION public.chat__v1_prose(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.regexp_replace(public.chat__v1_inline(p_text), '(^|\n)( {1,3})>', '\1\2\\>', 'g')
$fn$;

CREATE OR REPLACE FUNCTION public.chat__v1_to_v2(p_body text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  v_rest text := p_body;
  v_parts text[] := '{}';
  v_prose text;
  m text[];
  v_out text;
  v_lang text;
  v_code text;
BEGIN
  IF p_body IS NULL THEN
    RETURN NULL;
  END IF;
  -- Fences first, as v1 split them (markup.ts parseBody): ```lang\n?…``` anywhere.
  LOOP
    m := regexp_match(
      v_rest,
      '^((?:[^`]|`(?!``))*)```([a-zA-Z0-9_+-]*)(\n?)((?:[^`]|`(?!``))*)```(.*)$'
    );
    EXIT WHEN m IS NULL;
    -- Text before a fence: v1 dropped its blank lines; trailing spaces hang invisibly.
    v_prose := regexp_replace(m[1], '^\n+|[[:space:]]+$', '', 'g');
    IF v_prose <> '' THEN
      v_parts := v_parts || public.chat__v1_prose(v_prose);
    END IF;
    -- ```code``` (no line break after the fence): v1 read "code" as the language
    -- (a v1 bug); the person meant the code, so it is the content.
    v_lang := m[2];
    v_code := regexp_replace(m[4], '\n$', '');
    IF m[3] = '' THEN
      IF v_code ~ '^[ \t]*\n' THEN
        v_code := regexp_replace(v_code, '^[ \t]*\n', '');
      ELSE
        v_code := v_lang || v_code;
        v_lang := '';
      END IF;
    END IF;
    v_parts := v_parts || ('```' || v_lang || E'\n'
      || CASE WHEN v_code = '' THEN '' ELSE v_code || E'\n' END
      || '```');
    v_rest := m[5];
  END LOOP;
  IF v_parts = '{}' THEN
    v_out := public.chat__v1_prose(p_body);
  ELSE
    v_prose := regexp_replace(v_rest, '^\n+|\n+$', '', 'g');
    IF v_prose <> '' THEN
      v_parts := v_parts || public.chat__v1_prose(v_prose);
    END IF;
    v_out := array_to_string(v_parts, E'\n\n');
  END IF;
  -- A converted @channel glued to a word gets a space after it, too, and one
  -- before the emphasis it opens (`hey**<!channel>**` → `hey **@channel**`).
  v_out := regexp_replace(v_out, chr(1) || '(?=[A-Za-z0-9_-])', ' ', 'g');
  v_out := regexp_replace(v_out, '([^[:space:]*~])((?:\*\*|~~|\*)+)' || chr(2), '\1 \2', 'g');
  RETURN replace(replace(v_out, chr(1), ''), chr(2), '');
END
$fn$;

-- ── 2. Columns ──────────────────────────────────────────────────────────────

-- chat_messages. format_version: the stored form; existing rows (and anything v1's
-- ops write until CV-2a) are 1, converted and v2 rows 2. The default stays 1 here
-- on purpose: v1's live ops keep writing v1 text until CV-2a redefines them, and
-- a row they write must stay convertible (CV-2a writes 2 explicitly).
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS format_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS body_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.chat_messages (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS v1_thread_reply boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'message',
  ADD COLUMN IF NOT EXISTS event jsonb,
  ADD COLUMN IF NOT EXISTS mentioned_team_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mentions_everyone boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS api_key_id uuid REFERENCES public.workspace_api_keys (id) ON DELETE SET NULL;

-- chat_channels: General by its flag (CH37), Recently deleted (CH62).
ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

-- chat_members: the read mark as a message, leaving and removal as stamps.
ALTER TABLE public.chat_members
  ADD COLUMN IF NOT EXISTS last_read_id uuid REFERENCES public.chat_messages (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS left_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Backfill the new columns (no trigger stamps them yet). A row's last change is
-- the latest of what v1 recorded; body_text reads v1 text through the converter
-- without changing the body.
UPDATE public.chat_messages
   SET updated_at = greatest(created_at, edited_at, deleted_at, pinned_at, last_reply_at),
       body_text = coalesce(public.chat__body_text(
         CASE WHEN format_version >= 2 THEN body ELSE public.chat__v1_to_v2(body) END), '')
 WHERE updated_at IS NULL;
UPDATE public.chat_members
   SET updated_at = greatest(joined_at, last_read_at)
 WHERE updated_at IS NULL;

ALTER TABLE public.chat_messages
  ALTER COLUMN updated_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.chat_members
  ALTER COLUMN updated_at SET DEFAULT clock_timestamp(),
  ALTER COLUMN updated_at SET NOT NULL;

-- One table rewrite. Queries must say `deleted_at IS NULL` to use the index below.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('pg_catalog.simple'::regconfig, public.chat__unaccent(coalesce(body_text, '')))
  ) STORED;

-- Closed vocabularies (@contracts CHAT_MESSAGE_KINDS, CHAT_EVENT_TYPES) and shapes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_kind_check'
                  AND conrelid = 'public.chat_messages'::regclass) THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_kind_check
      CHECK (kind IN ('message','event'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_event_check'
                  AND conrelid = 'public.chat_messages'::regclass) THEN
    -- An event line carries its event; a message carries none.
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_event_check
      CHECK ((kind = 'event') = (event IS NOT NULL)
             AND (event IS NULL OR (event ->> 'type') IN ('moved_out','moved_in')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_format_version_check'
                  AND conrelid = 'public.chat_messages'::regclass) THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_format_version_check
      CHECK (format_version IN (1, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_channels_name_trimmed'
                  AND conrelid = 'public.chat_channels'::regclass) THEN
    -- Names as typed (CH3a): trimmed, 1–80 characters (the length CHECK exists).
    ALTER TABLE public.chat_channels ADD CONSTRAINT chat_channels_name_trimmed
      CHECK (name IS NULL OR name = btrim(name));
  END IF;
END;
$$;

-- ── 3. Stamps and body_text, kept by triggers ───────────────────────────────

-- clock_timestamp(), not now(): rows written in one transaction get distinct,
-- increasing stamps (gotchas §Supabase; the Tasks zz_stamp_updated_at pattern).
CREATE OR REPLACE FUNCTION public.chat__stamp_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$fn$;

-- body_text follows the body. A v1 row (format_version 1) is read through the
-- converter, so it is searchable before the conversion runs.
CREATE OR REPLACE FUNCTION public.chat__messages_body_text()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  NEW.body_text := coalesce(public.chat__body_text(
    CASE WHEN NEW.format_version >= 2 THEN NEW.body ELSE public.chat__v1_to_v2(NEW.body) END), '');
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS chat_messages_body_text ON public.chat_messages;
CREATE TRIGGER chat_messages_body_text
  BEFORE INSERT OR UPDATE OF body, format_version ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat__messages_body_text();

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.chat_messages;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat__stamp_updated_at();
DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.chat_channels;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.chat_channels
  FOR EACH ROW EXECUTE FUNCTION public.chat__stamp_updated_at();
DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.chat_members;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.chat_members
  FOR EACH ROW EXECUTE FUNCTION public.chat__stamp_updated_at();

-- ── 4. Indexes (round-3 §2.5, the rows for this block's columns) ────────────
-- v1's chat_messages_channel_idx (top level only) and chat_channels_name_uq (all
-- channels) stay until nothing reads them (CV-15 / CV-23 drop them).

-- The stream: keyset pages by (created_at, id), replies and event lines included.
CREATE INDEX IF NOT EXISTS chat_messages_stream_idx
  ON public.chat_messages (channel_id, created_at, id);
-- Delta reads by the server's stamp.
CREATE INDEX IF NOT EXISTS chat_messages_delta_idx
  ON public.chat_messages (workspace_id, updated_at, id);
-- chat_search (CV-19).
CREATE INDEX IF NOT EXISTS chat_messages_search_idx
  ON public.chat_messages USING gin (search_tsv) WHERE deleted_at IS NULL;
-- Names unique ignoring case among live channels; one General per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_live_name_uq
  ON public.chat_channels (workspace_id, lower(name)) WHERE kind = 'channel' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_default_uq
  ON public.chat_channels (workspace_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS chat_channels_delta_idx
  ON public.chat_channels (workspace_id, updated_at, id);
CREATE INDEX IF NOT EXISTS chat_channels_deleted_idx
  ON public.chat_channels (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_members_delta_idx
  ON public.chat_members (user_id, workspace_id, updated_at);

-- ── 5. Catch up and Stop following (empty until CV-5 and CV-12 write them) ──

CREATE TABLE IF NOT EXISTS public.chat_catchup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  chain_root_id uuid REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  reason text NOT NULL,
  actor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  activity_id uuid REFERENCES public.module_activity (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  held_at timestamptz,
  done_at timestamptz,
  done_how text,
  later_until timestamptz,
  later_notified_at timestamptz,
  emailed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chat_catchup_reason_check
    CHECK (reason IN ('dm','mention','team_mention','everyone','reply','announcement','every_message','reminder','added','removed','level_reset')),
  CONSTRAINT chat_catchup_done_how_check
    CHECK (done_how IS NULL OR done_how IN ('done','read','bell','closed')),
  CONSTRAINT chat_catchup_done_shape CHECK ((done_at IS NULL) = (done_how IS NULL))
);

CREATE INDEX IF NOT EXISTS chat_catchup_open_idx
  ON public.chat_catchup (user_id, workspace_id, created_at DESC) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_catchup_channel_open_idx
  ON public.chat_catchup (user_id, channel_id, created_at) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS chat_catchup_later_idx
  ON public.chat_catchup (later_until) WHERE done_at IS NULL AND later_notified_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_catchup_message_reason_uq
  ON public.chat_catchup (user_id, message_id, reason) WHERE message_id IS NOT NULL;
-- The conversion's level_reset line: one per person and conversation.
CREATE UNIQUE INDEX IF NOT EXISTS chat_catchup_level_reset_uq
  ON public.chat_catchup (user_id, channel_id) WHERE reason = 'level_reset';
CREATE INDEX IF NOT EXISTS chat_catchup_workspace_idx ON public.chat_catchup (workspace_id);
CREATE INDEX IF NOT EXISTS chat_catchup_message_idx ON public.chat_catchup (message_id) WHERE message_id IS NOT NULL;

DROP TRIGGER IF EXISTS zz_stamp_updated_at ON public.chat_catchup;
CREATE TRIGGER zz_stamp_updated_at BEFORE INSERT OR UPDATE ON public.chat_catchup
  FOR EACH ROW EXECUTE FUNCTION public.chat__stamp_updated_at();

CREATE TABLE IF NOT EXISTS public.chat_chain_mutes (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  root_id uuid NOT NULL REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, root_id)
);
CREATE INDEX IF NOT EXISTS chat_chain_mutes_root_idx ON public.chat_chain_mutes (root_id);
CREATE INDEX IF NOT EXISTS chat_chain_mutes_workspace_idx ON public.chat_chain_mutes (workspace_id);

-- Own rows only; every write goes through an op.
ALTER TABLE public.chat_catchup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_chain_mutes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_catchup_own_read ON public.chat_catchup;
CREATE POLICY chat_catchup_own_read ON public.chat_catchup FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS chat_chain_mutes_own_read ON public.chat_chain_mutes;
CREATE POLICY chat_chain_mutes_own_read ON public.chat_chain_mutes FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Table grants: reads through RLS, writes only through ops (re-stated: the local
-- snapshot grants every table broadly).
REVOKE ALL ON public.chat_catchup FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_catchup TO authenticated;
GRANT ALL ON public.chat_catchup TO service_role;
REVOKE ALL ON public.chat_chain_mutes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_chain_mutes TO authenticated;
GRANT ALL ON public.chat_chain_mutes TO service_role;
REVOKE ALL ON public.chat_channels FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_channels TO authenticated;
GRANT ALL ON public.chat_channels TO service_role;
REVOKE ALL ON public.chat_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_members TO authenticated;
GRANT ALL ON public.chat_members TO service_role;
REVOKE ALL ON public.chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;

-- ── 6. Who reads a conversation (CH4a, §2.25 a) ─────────────────────────────

-- A person reads a conversation when (the workspace part) they are in the
-- workspace, it isn't deleted and their role has Chat at View, and (the
-- conversation part) it is live and either a public channel or one they are in
-- and haven't left. The plan is not asked: history stays readable while chat is
-- paused; every write still asks it (chat_op__guard). CV-19's
-- chat__readable_channel_ids must say exactly this, set-based.
CREATE OR REPLACE FUNCTION public.chat__can_read_channel_as(p_channel_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.chat_channels c
      JOIN public.workspaces w ON w.id = c.workspace_id AND w.deleted_at IS NULL
     WHERE c.id = p_channel_id
       -- the workspace part
       AND public.chat_is_workspace_member(c.workspace_id, p_user)
       AND public.perm_user_has(c.workspace_id, p_user, 'chat.view')
       -- the conversation part
       AND c.deleted_at IS NULL
       AND ((c.kind = 'channel' AND NOT c.is_private)
            OR EXISTS (SELECT 1 FROM public.chat_members m
                        WHERE m.channel_id = c.id AND m.user_id = p_user AND m.left_at IS NULL)))
$fn$;

-- The RLS read rule of every chat table, the signed-in person's reading.
CREATE OR REPLACE FUNCTION public.chat_can_read_channel(p_channel_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.chat__can_read_channel_as(p_channel_id, auth.uid())
$function$;

-- "Can this person see it", for notifications and the spine: conversations and
-- messages follow the conversation's read rule (they fell through to workspace
-- membership before, which a private conversation must not).
CREATE OR REPLACE FUNCTION public.spine__visible_to(p_workspace_id uuid, p_type text, p_id uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user IS NULL OR p_id IS NULL THEN
    RETURN false;
  END IF;
  IF p_type IN ('task', 'task_project') THEN
    RETURN public.tasks__visible_to(p_id, p_user);
  ELSIF p_type IN ('note', 'bucket', 'contact', 'company', 'event') THEN
    RETURN public.can_access(p_type, p_id, 'view', p_user);
  ELSIF p_type = 'email_thread' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_refs r WHERE r.id = p_id AND r.owner_id = p_user);
  ELSIF p_type = 'email_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.email_accounts a WHERE a.id = p_id AND a.owner_id = p_user);
  ELSIF p_type = 'calendar_account' THEN
    RETURN EXISTS (SELECT 1 FROM public.calendar_accounts a WHERE a.id = p_id AND a.owner_id = p_user);
  ELSIF p_type = 'chat_channel' THEN
    RETURN EXISTS (SELECT 1 FROM public.chat_channels c
                   WHERE c.id = p_id AND c.workspace_id = p_workspace_id)
       AND public.chat__can_read_channel_as(p_id, p_user);
  ELSIF p_type = 'chat_message' THEN
    RETURN EXISTS (SELECT 1 FROM public.chat_messages m
                   WHERE m.id = p_id AND m.workspace_id = p_workspace_id
                     AND public.chat__can_read_channel_as(m.channel_id, p_user));
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.workspace_members m
                 WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user);
END;
$function$;

-- Link rows: a row with a conversation or a message at either end is read only by
-- that conversation's readers (perm_can_see_entity's chat branches; a key reads
-- none through the spine).
DROP POLICY IF EXISTS entity_links_workspace_read ON public.entity_links;
CREATE POLICY entity_links_workspace_read ON public.entity_links FOR SELECT TO authenticated
  USING (public.tasks_module_can_access_workspace(workspace_id)
         AND (source_type NOT IN ('chat_channel', 'chat_message')
              OR public.perm_can_see_entity(workspace_id, source_type, source_id))
         AND (target_type NOT IN ('chat_channel', 'chat_message')
              OR public.perm_can_see_entity(workspace_id, target_type, target_id)));

-- ── 7. Realtime (§2.7) ──────────────────────────────────────────────────────

-- The workspace's presence topic (chat:<workspace id>): members of a workspace
-- with chat. A conversation's typing topic (chat:typing:<channel id>): the people
-- in that conversation who can read it. Writing stays as 20261014090000 left it:
-- presence on the workspace topic only; typing is written by chat_op_typing.
CREATE OR REPLACE FUNCTION public.chat_realtime_topic_allowed(p_topic text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.chat_can_access_workspace(substring(p_topic from 6)::uuid)
    WHEN p_topic ~ '^chat:typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN EXISTS (SELECT 1 FROM public.chat_members m
                   WHERE m.channel_id = substring(p_topic from 13)::uuid
                     AND m.user_id = auth.uid() AND m.left_at IS NULL)
       AND public.chat_can_read_channel(substring(p_topic from 13)::uuid)
    ELSE false
  END
$function$;

-- The publication: the three chat tables and Catch up (re-asserted: the local
-- snapshot carries no membership). chat_chain_mutes isn't published. A column
-- list wouldn't narrow Postgres Changes (spike 3); the store's binding `select` does.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'The supabase_realtime publication is missing.';
  END IF;
  FOREACH t IN ARRAY ARRAY['chat_channels', 'chat_members', 'chat_messages', 'chat_catchup'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;

-- ── 8. The conversion (round-3 §2.6), run by …_chat_v2_convert_v1 ───────────

-- Idempotent per step; a second run changes nothing. p_workspace_id narrows it
-- to one workspace (the SQL tests); the migration runs it for all. Returns how
-- many rows each step changed. System work: no session, so the write guards
-- (perm_enforce_write) let it through.
CREATE OR REPLACE FUNCTION public.chat__convert_v1(p_workspace_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_bodies integer := 0;
  v_replies integer := 0;
  v_notes integer := 0;
  v_self_dms integer := 0;
  v_levels integer := 0;
  v_lines integer := 0;
  v_general integer := 0;
  v_last_read integer := 0;
  v_registered integer := 0;
  v_excerpts integer := 0;
  v_too_long integer;
  r record;
  v_note uuid;
  v_md text;
  v_text text;
  v_tz text;
  v_title constant text := 'Notes to self (from Chat)';
BEGIN
  -- Refuse what the converter can't carry, before anything changes.
  IF EXISTS (SELECT 1 FROM public.chat_messages m
              WHERE m.format_version = 1
                AND (p_workspace_id IS NULL OR m.workspace_id = p_workspace_id)
                AND (strpos(m.body, chr(1)) > 0 OR strpos(m.body, chr(2)) > 0)) THEN
    RAISE EXCEPTION 'chat__convert_v1: a v1 message holds U+0001 or U+0002, which the converter uses as a marker.';
  END IF;
  SELECT count(*) INTO v_too_long FROM public.chat_messages m
   WHERE m.format_version = 1
     AND (p_workspace_id IS NULL OR m.workspace_id = p_workspace_id)
     AND char_length(public.chat__v1_to_v2(m.body)) > 8000;
  IF v_too_long > 0 THEN
    RAISE EXCEPTION 'chat__convert_v1: % v1 message(s) would be longer than 8,000 characters once converted.', v_too_long;
  END IF;

  -- 1. Bodies → the v2 stored form (body_text follows by trigger, search_tsv by
  --    generation, updated_at by stamp). v1 thread replies are flagged: they sit
  --    in the stream at their own times and count as read with their root.
  WITH up AS (
    UPDATE public.chat_messages m
       SET body = public.chat__v1_to_v2(m.body),
           mentions_everyone = m.mentions_everyone OR strpos(m.body, '<!channel>') > 0,
           v1_thread_reply = (m.parent_id IS NOT NULL),
           format_version = 2
     WHERE m.format_version = 1
       AND (p_workspace_id IS NULL OR m.workspace_id = p_workspace_id)
    RETURNING m.parent_id
  )
  SELECT count(*), count(*) FILTER (WHERE parent_id IS NOT NULL) INTO v_bodies, v_replies FROM up;

  -- 2. Notes to self: a direct message with only its creator becomes one private
  --    note in that person's Notes Inbox, every message in order with its time,
  --    and the conversation is deleted (CV-15's purge clears it after 30 days).
  FOR r IN
    SELECT c.id, c.workspace_id, cm.user_id
      FROM public.chat_channels c
      JOIN public.chat_members cm ON cm.channel_id = c.id
     WHERE c.kind = 'dm' AND c.deleted_at IS NULL
       AND c.dm_key = cm.user_id::text
       AND (p_workspace_id IS NULL OR c.workspace_id = p_workspace_id)
       AND NOT EXISTS (SELECT 1 FROM public.chat_members o
                        WHERE o.channel_id = c.id AND o.user_id <> cm.user_id)
     ORDER BY c.created_at, c.id
  LOOP
    SELECT nullif(btrim(p.time_zone), '') INTO v_tz FROM public.user_preferences p WHERE p.user_id = r.user_id;
    IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_tz) THEN
      v_tz := 'UTC';
    END IF;
    SELECT string_agg('**' || to_char(m.created_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI')
                        || CASE WHEN v_tz = 'UTC' THEN ' UTC' ELSE '' END || '**'
                        || E'\n' || m.body,
                      E'\n\n' ORDER BY m.created_at, m.id),
           string_agg(to_char(m.created_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI')
                        || CASE WHEN v_tz = 'UTC' THEN ' UTC' ELSE '' END
                        || E'\n' || m.body_text,
                      E'\n\n' ORDER BY m.created_at, m.id)
      INTO v_md, v_text
      FROM public.chat_messages m
     WHERE m.channel_id = r.id AND m.deleted_at IS NULL AND m.kind = 'message';
    IF v_md IS NOT NULL THEN
      INSERT INTO public.notes (workspace_id, created_by, title, kind, position, body_md, body_text, in_inbox)
      VALUES (r.workspace_id, r.user_id, v_title, 'note', '', v_md, coalesce(v_text, ''), true)
      RETURNING id INTO v_note;
      -- Private: the note's own person only (share_note_after shared it with the
      -- workspace at its default level; share_mode 'custom' and workspace_shared
      -- false are the insert's defaults).
      DELETE FROM public.resource_grants g WHERE g.resource_type = 'note' AND g.resource_id = v_note;
      INSERT INTO public.entities (workspace_id, entity_type, entity_id, label, icon)
      VALUES (r.workspace_id, 'note', v_note, v_title, 'note')
      ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING;
      v_notes := v_notes + 1;
    END IF;
    UPDATE public.chat_channels SET deleted_at = now(), deleted_by = r.user_id WHERE id = r.id;
    v_self_dms := v_self_dms + 1;
  END LOOP;

  -- 3. Channels on Every message go to Mentions and replies, with one quiet Catch
  --    up line per person and conversation (none for an archived one). Direct
  --    messages keep notifying. A line already written means the reset happened.
  WITH reset AS (
    SELECT cm.channel_id, cm.user_id, cm.workspace_id, c.archived_at
      FROM public.chat_members cm
      JOIN public.chat_channels c ON c.id = cm.channel_id
     WHERE c.kind = 'channel' AND c.deleted_at IS NULL AND cm.notify_level = 'all'
       AND (p_workspace_id IS NULL OR cm.workspace_id = p_workspace_id)
       AND NOT EXISTS (SELECT 1 FROM public.chat_catchup k
                        WHERE k.user_id = cm.user_id AND k.channel_id = cm.channel_id
                          AND k.reason = 'level_reset')
  ), lines AS (
    INSERT INTO public.chat_catchup (workspace_id, user_id, channel_id, reason)
    SELECT x.workspace_id, x.user_id, x.channel_id, 'level_reset'
      FROM reset x
     WHERE x.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.user_id)
    ON CONFLICT DO NOTHING
    RETURNING 1
  ), up AS (
    UPDATE public.chat_members cm SET notify_level = 'mentions'
      FROM reset x
     WHERE cm.channel_id = x.channel_id AND cm.user_id = x.user_id
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM up), (SELECT count(*) FROM lines) INTO v_levels, v_lines;

  -- 4. General: each workspace's first live channel named "general" is flagged.
  --    Nobody is added (only people who join from now on are).
  WITH g AS (
    SELECT DISTINCT ON (c.workspace_id) c.id
      FROM public.chat_channels c
     WHERE c.kind = 'channel' AND lower(c.name) = 'general' AND c.deleted_at IS NULL
       AND (p_workspace_id IS NULL OR c.workspace_id = p_workspace_id)
       AND NOT EXISTS (SELECT 1 FROM public.chat_channels d
                        WHERE d.workspace_id = c.workspace_id AND d.is_default)
     ORDER BY c.workspace_id, c.created_at, c.id
  ), up AS (
    UPDATE public.chat_channels c SET is_default = true FROM g WHERE c.id = g.id RETURNING 1
  )
  SELECT count(*) INTO v_general FROM up;

  -- 5. The read mark as a message: the newest message at or before last_read_at.
  WITH x AS (
    SELECT cm.channel_id, cm.user_id,
           (SELECT m.id FROM public.chat_messages m
             WHERE m.channel_id = cm.channel_id AND m.created_at <= cm.last_read_at
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT 1) AS mark
      FROM public.chat_members cm
     WHERE cm.last_read_id IS NULL
       AND (p_workspace_id IS NULL OR cm.workspace_id = p_workspace_id)
  ), up AS (
    UPDATE public.chat_members cm SET last_read_id = x.mark
      FROM x
     WHERE cm.channel_id = x.channel_id AND cm.user_id = x.user_id AND x.mark IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_last_read FROM up;

  -- 6. Every live conversation in the registry (label = its name; none for a DM).
  WITH ins AS (
    INSERT INTO public.entities (workspace_id, entity_type, entity_id, label)
    SELECT c.workspace_id, 'chat_channel', c.id, coalesce(c.name, '')
      FROM public.chat_channels c
     WHERE c.deleted_at IS NULL
       AND (p_workspace_id IS NULL OR c.workspace_id = p_workspace_id)
    ON CONFLICT (workspace_id, entity_type, entity_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_registered FROM ins;

  -- 7. The bell's old excerpts, rewritten so they draw like new ones; the marker
  --    in the payload says it's done.
  WITH up AS (
    UPDATE public.module_activity a
       SET payload = jsonb_set(a.payload, '{excerpt}',
                               to_jsonb(public.chat__v1_to_v2(a.payload ->> 'excerpt')))
                     || '{"format_version": 2}'::jsonb
     WHERE a.op IN ('chat.mention', 'chat.reply')
       AND jsonb_typeof(a.payload -> 'excerpt') = 'string'
       AND (a.payload ->> 'format_version') IS DISTINCT FROM '2'
       AND (p_workspace_id IS NULL OR a.workspace_id = p_workspace_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_excerpts FROM up;

  RETURN jsonb_build_object(
    'bodies', v_bodies,
    'replies_flagged', v_replies,
    'self_dms_closed', v_self_dms,
    'notes_written', v_notes,
    'levels_reset', v_levels,
    'level_reset_lines', v_lines,
    'general_flagged', v_general,
    'read_marks', v_last_read,
    'registered', v_registered,
    'excerpts', v_excerpts);
END;
$fn$;

-- ── 9. Account erasure covers the two new per-person tables (§2.25 h) ───────

-- A person's Catch up items and the chains they stopped following go with them,
-- in every workspace (their own workspaces' rows go with those anyway), and the
-- preview counts both. "Nobody else is in it" (a DM or private channel that goes)
-- and the handover of a channel they managed alone count only people who haven't
-- left. Patched into the live body by anchored replace.
DO $erase$
DECLARE
  v_def text := pg_get_functiondef('public.account_erase_workspace_data(uuid, boolean)'::regprocedure);
  v_new text;
  a text;
BEGIN
  IF position('chat_catchup' IN v_def) > 0 THEN
    RETURN; -- re-run
  END IF;
  FOREACH a IN ARRAY ARRAY[
    'v_time_notes integer;',
    '  v_counts := jsonb_build_object(',
    '''time_notes_cleared'', v_time_notes',
    'DELETE FROM public.chat_channels c WHERE c.id = ANY (v_channel_del);',
    'WHERE cm.channel_id = c.id AND cm.user_id <> p_user',
    'WHERE cm.channel_id = r.id AND cm.user_id <> p_user'
  ] LOOP
    IF (length(v_def) - length(replace(v_def, a, ''))) / length(a) <> 1 THEN
      RAISE EXCEPTION 'account_erase_workspace_data isn''t the body this migration expects (%); redefine it by hand.', a;
    END IF;
  END LOOP;
  v_new := replace(v_def, 'v_time_notes integer;',
    'v_time_notes integer;'
    || E'\n  v_chat_catchup integer;'
    || E'\n  v_chat_mutes integer;');
  v_new := replace(v_new, '  v_counts := jsonb_build_object(',
    '  -- Chat v2 (CV-1): their Catch up items and the chains they stopped following.'
    || E'\n  SELECT count(*) INTO v_chat_catchup FROM public.chat_catchup x WHERE x.user_id = p_user;'
    || E'\n  SELECT count(*) INTO v_chat_mutes FROM public.chat_chain_mutes x WHERE x.user_id = p_user;'
    || E'\n\n  v_counts := jsonb_build_object(');
  v_new := replace(v_new, '''time_notes_cleared'', v_time_notes',
    '''time_notes_cleared'', v_time_notes,'
    || E'\n    ''chat_catchup_deleted'', v_chat_catchup,'
    || E'\n    ''chat_chain_mutes_deleted'', v_chat_mutes');
  v_new := replace(v_new, 'DELETE FROM public.chat_channels c WHERE c.id = ANY (v_channel_del);',
    'DELETE FROM public.chat_channels c WHERE c.id = ANY (v_channel_del);'
    || E'\n  DELETE FROM public.chat_catchup x WHERE x.user_id = p_user;'
    || E'\n  DELETE FROM public.chat_chain_mutes x WHERE x.user_id = p_user;');
  v_new := replace(v_new, 'WHERE cm.channel_id = c.id AND cm.user_id <> p_user',
    'WHERE cm.channel_id = c.id AND cm.user_id <> p_user AND cm.left_at IS NULL');
  v_new := replace(v_new, 'WHERE cm.channel_id = r.id AND cm.user_id <> p_user',
    'WHERE cm.channel_id = r.id AND cm.user_id <> p_user AND cm.left_at IS NULL');
  EXECUTE v_new;
END;
$erase$;

-- ── 10. Grants, asserted ────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Internal helpers: only definer functions, triggers and the service role call them.
  FOREACH fn IN ARRAY ARRAY[
    'chat__is_iso_day(text)',
    'chat__inline_text(text)',
    'chat__list_marker(text)',
    'chat__body_text(text)',
    'chat__v1_inline(text, boolean)',
    'chat__v1_prose(text)',
    'chat__v1_to_v2(text)',
    'chat__stamp_updated_at()',
    'chat__messages_body_text()',
    'chat__can_read_channel_as(uuid, uuid)',
    'chat__convert_v1(uuid)',
    'spine__visible_to(uuid, text, uuid, uuid)',
    'account_erase_workspace_data(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% must not be callable by clients.', fn;
    END IF;
  END LOOP;
  -- The generated column calls chat__unaccent as whoever writes the row: pure,
  -- so signed-in people keep it (gotchas §Supabase: CHECK/policy/trigger helpers).
  REVOKE ALL ON FUNCTION public.chat__unaccent(text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.chat__unaccent(text) TO authenticated, service_role;
  -- The read rules the policies call.
  FOREACH fn IN ARRAY ARRAY[
    'chat_can_read_channel(uuid)',
    'chat_realtime_topic_allowed(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people, never anon.', fn;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.chat__unaccent(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'public.chat__unaccent must not be callable by anon.';
  END IF;
  -- Tables: signed-in people read through RLS and write nothing.
  IF has_table_privilege('authenticated', 'public.chat_catchup', 'INSERT')
     OR has_table_privilege('authenticated', 'public.chat_chain_mutes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.chat_messages', 'UPDATE')
     OR has_table_privilege('anon', 'public.chat_catchup', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.chat_catchup', 'SELECT') THEN
    RAISE EXCEPTION 'Chat table grants are not as intended: SELECT for signed-in people, nothing else.';
  END IF;
  IF (SELECT count(*) FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename IN ('chat_channels', 'chat_members', 'chat_messages', 'chat_catchup')) <> 4 THEN
    RAISE EXCEPTION 'The chat tables are not all in supabase_realtime.';
  END IF;
END;
$$;
