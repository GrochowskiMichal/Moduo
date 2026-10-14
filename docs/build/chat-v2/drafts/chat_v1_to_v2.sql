-- DRAFT (CV-0 spike 4) — not a migration. CV-1's `…_chat_v2_convert_v1`
-- adopts these three functions; see docs/build/chat-v2/CV-0-S4.md.
--
-- chat__v1_to_v2(body): a v1 chat body → the v2 stored form (specs/chat-v2.md
-- Assumptions #3, #27; round-3 §2.6). IMMUTABLE, pure text in, text out.
--
--   <@id>                  → moduo://person/<id>          (id lower-cased)
--   <!channel>             → @channel                     (a space is added
--                            where v1 glued it to a word, so it stays a token)
--   <moduo:TYPE:ID|Label>  → moduo://TYPE/<id>            (the label goes)
--   _italic_               → *italic*                     (italic inside
--                            italic loses its delimiters: v1 drew it the same)
--   **bold**, ~~strike~~   → kept; spaces at their inner edges move outside
--                            (`** a **` was bold in v1, v2 can't write it)
--   ```fences```           → kept, always on their own lines, set off by a
--                            blank line (v1 drew a mid-line fence as a block);
--                            a one-line ```x``` keeps x as the code (v1 took
--                            it for the language of an empty block: a bug)
--   `code`                 → the same code; re-fenced so v2 reads it the same
--                            (outer spaces kept, two spans in a row joined)
--   URLs                   → kept; where v2 would cut a bare URL elsewhere
--                            (a trailing `_*~}`, unbalanced brackets, glued
--                            to a word, a backslash) it becomes `[url](url)`
--   anything v1 drew as plain text but v2 would read as syntax is escaped:
--   a stray `*`, `` ` `` or `~`, every backslash, a literal `moduo://`, a
--   `>` after 1–3 spaces at a line start. Not escaped, on purpose (accepted
--   as better formatting, round-3 §2.6): lines starting "- ", "+ ", "1. "
--   and `[text](url)` (a line starting "* " stays text: its `*` is escaped).
--
-- Tokens inside code spans and fences stay literal (they were literal in v1).
-- `set search_path from current`: CV-1 creates them in `public`; the spike
-- created them in a scratch schema.

create or replace function chat__v1_inline(p_text text, p_in_italic boolean default false)
returns text
language plpgsql
immutable
parallel safe
set search_path from current
as $fn$
declare
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
begin
  if p_text is null or p_text = '' then
    return p_text;
  end if;
  -- One alternation in v1's order (markup.ts INLINE_RE); every character of
  -- the text lands in exactly one match, so the pieces join back losslessly.
  for m in
    select x
    from regexp_matches(
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
      || '|(\\)'                                                                       -- 11 a backslash (v2 reads \ as an escape)
      || '|([^`<h*~_\\]+|.)',                                                          -- 12 plain text
      'g'
    ) as x
  loop
    if m[1] is not null then
      -- v2 pairs backtick runs by length and trims one padding space each
      -- side: pad spans that start and end with a space, and join two spans
      -- in a row (`a``b` was two spans in v1; v2 would read one `a``b`).
      v_code := substr(m[1], 2, length(m[1]) - 2);
      if v_code_end = length(v_out) then
        v_code := v_code_prev || v_code;
        v_out := left(v_out, v_code_start);
      end if;
      v_code_prev := v_code;
      v_code_start := length(v_out);
      v_out := v_out || '`'
        || case when v_code ~ '^ .* $' and v_code !~ '^ +$' then ' ' || v_code || ' ' else v_code end
        || '`';
      v_code_end := length(v_out);
    elsif m[2] is not null then
      v_out := v_out || 'moduo://person/' || lower(m[2]);
    elsif m[3] is not null then
      -- v2's @channel needs a token start; chr(1) marks the end for the caller.
      v_out := v_out
        || case when v_out = '' or v_out ~ '[[:space:]]$' then '' else ' ' end
        || '@channel' || chr(1);
    elsif m[4] is not null then
      v_out := v_out || 'moduo://' || m[4] || '/' || lower(m[5]);
    elsif m[6] is not null then
      -- v1 drew the whole URL as a link: v2 must not read syntax inside it,
      -- and must link exactly these characters. Where v2's bare-URL rule would
      -- cut elsewhere, write the link out: `[url](url)`.
      v_url := regexp_replace(m[6], '([\\*`~\[\]])', '\\\1', 'g');
      if m[6] ~ '[*_~}]$'
        or m[6] ~ '\\'
        or v_out ~ '[A-Za-z0-9]$'
        or length(m[6]) - length(replace(m[6], '(', '')) <> length(m[6]) - length(replace(m[6], ')', ''))
        or length(m[6]) - length(replace(m[6], '[', '')) <> length(m[6]) - length(replace(m[6], ']', ''))
        or length(m[6]) - length(replace(m[6], '{', '')) <> length(m[6]) - length(replace(m[6], '}', ''))
      then
        v_out := v_out || '[' || v_url || '](' || regexp_replace(m[6], '([\\()<>])', '\\\1', 'g') || ')';
      else
        v_out := v_out || v_url;
      end if;
    elsif m[7] is not null or m[8] is not null then
      v_inner := coalesce(m[7], m[8]);
      v_lead := substring(v_inner from '^[[:space:]]*');
      v_trail := substring(v_inner from '[[:space:]]*$');
      if length(v_lead) = length(v_inner) then
        v_out := v_out || v_inner;
      else
        v_out := v_out || v_lead
          || case when m[7] is not null then '**' else '~~' end
          || chat__v1_inline(substring(v_inner from length(v_lead) + 1
               for length(v_inner) - length(v_lead) - length(v_trail)), p_in_italic)
          || case when m[7] is not null then '**' else '~~' end
          || v_trail;
      end if;
    elsif m[9] is not null or m[10] is not null then
      v_inner := chat__v1_inline(coalesce(m[9], m[10]), true);
      v_out := v_out || case when p_in_italic then v_inner else '*' || v_inner || '*' end;
    elsif m[11] is not null then
      v_out := v_out || '\\';
    else
      v_out := v_out || replace(regexp_replace(m[12], '([*`~])', '\\\1', 'g'), 'moduo://', 'moduo\://');
    end if;
  end loop;
  return v_out;
end
$fn$;

-- Prose between fences: inline conversion, then a `>` after 1–3 spaces at a
-- line start is escaped (v1 drew it as text; v2 would start a quote).
create or replace function chat__v1_prose(p_text text)
returns text
language sql
immutable
parallel safe
set search_path from current
as $fn$
  select regexp_replace(chat__v1_inline(p_text), '(^|\n)( {1,3})>', '\1\2\\>', 'g')
$fn$;

create or replace function chat__v1_to_v2(p_body text)
returns text
language plpgsql
immutable
parallel safe
set search_path from current
as $fn$
declare
  v_rest text := p_body;
  v_parts text[] := '{}';
  v_prose text;
  m text[];
  v_out text;
  v_lang text;
  v_code text;
begin
  if p_body is null then
    return null;
  end if;
  -- Fences first, as v1 split them (markup.ts parseBody): ```lang\n?…``` anywhere.
  loop
    m := regexp_match(
      v_rest,
      '^((?:[^`]|`(?!``))*)```([a-zA-Z0-9_+-]*)(\n?)((?:[^`]|`(?!``))*)```(.*)$'
    );
    exit when m is null;
    -- Text before a fence: v1 dropped its blank lines; trailing spaces hang invisibly.
    v_prose := regexp_replace(m[1], '^\n+|[[:space:]]+$', '', 'g');
    if v_prose <> '' then
      v_parts := v_parts || chat__v1_prose(v_prose);
    end if;
    -- `` ```code``` `` (no line break after the fence): v1 read "code" as the
    -- language (a v1 bug); the person meant the code, so it is the content.
    v_lang := m[2];
    v_code := regexp_replace(m[4], '\n$', '');
    if m[3] = '' then
      if v_code ~ '^[ \t]*\n' then
        v_code := regexp_replace(v_code, '^[ \t]*\n', '');
      else
        v_code := v_lang || v_code;
        v_lang := '';
      end if;
    end if;
    v_parts := v_parts || ('```' || v_lang || E'\n'
      || case when v_code = '' then '' else v_code || E'\n' end
      || '```');
    v_rest := m[5];
  end loop;
  if v_parts = '{}' then
    v_out := chat__v1_prose(p_body);
  else
    v_prose := regexp_replace(v_rest, '^\n+|\n+$', '', 'g');
    if v_prose <> '' then
      v_parts := v_parts || chat__v1_prose(v_prose);
    end if;
    v_out := array_to_string(v_parts, E'\n\n');
  end if;
  -- A converted @channel glued to a word gets a space after it, too.
  v_out := regexp_replace(v_out, chr(1) || '(?=[A-Za-z0-9_-])', ' ', 'g');
  return replace(v_out, chr(1), '');
end
$fn$;
