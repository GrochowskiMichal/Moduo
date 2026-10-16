-- Chat v2 · message search: draft SQL from CV-0 spike 5 (record: docs/build/chat-v2/CV-0-S5.md).
-- NOT a migration. CV-1 copies part 1 into `…_chat_v2_foundation`; CV-19 copies part 2 into
-- `…_chat_v2_search`, each rebuilt from the live catalog of its day (runbook step 4).
-- Proven in the scratch schema spike_s5 on the local stack (Postgres 17.11): 100,000 messages,
-- p95 4.3 ms over 200 queries; "zolw" finds "żółw"; "zadan" finds zadania/zadaniem/zadań/…

-- =============================================================================================
-- Part 1 · CV-1 (foundation): the extension, the wrapper, the columns, the index
-- =============================================================================================

-- Release train: confirm `unaccent` is in prod's pg_available_extensions before this applies (risk 10).
create extension if not exists unaccent with schema extensions;

-- IMMUTABLE so a stored generated column may call it (unaccent() itself is only STABLE: its
-- rules file could change). The dictionary is named schema-qualified, so no search_path can
-- swap it; `set search_path = ''` costs nothing measurable (0.2 µs a row) and keeps the linter quiet.
-- If unaccent's rules ever change, rewrite the column: update chat_messages set body_text = body_text.
create or replace function public.chat__unaccent(p_text text)
  returns text
  language sql immutable parallel safe strict
  set search_path = ''
  return extensions.unaccent('extensions.unaccent'::regdictionary, p_text);

-- body_text: the stored Markdown with syntax and moduo:// URIs stripped, written by the send/edit
-- ops and by the conversion (spike 4's rules). It never holds a person's id or a reference's
-- label, so people are never found through message text.
alter table public.chat_messages
  add column if not exists body_text text not null default '';

-- One table rewrite (0.8 s at 100,000 rows on the local stack, 15 ms at the research
-- workspace's 3,032). Run inside the migration's transaction with `set local lock_timeout = '5s'`.
-- Adding it after the conversion fills body_text, or before (the conversion's UPDATE then
-- computes it), is one pass either way.
alter table public.chat_messages
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('pg_catalog.simple'::regconfig, public.chat__unaccent(coalesce(body_text, '')))
  ) stored;

-- 0.3 s to build at 100,000 rows; ~17 µs added per single-row insert with the column (fastupdate
-- on, the default; fastupdate off costs 41 µs). Queries must say `deleted_at is null` to use it.
create index if not exists chat_messages_search_idx
  on public.chat_messages using gin (search_tsv)
  where deleted_at is null;

-- search_tsv averages 202 bytes a row (body: 107). The supabase_realtime publication ships every
-- column of chat_messages today: give it a column list without search_tsv (and decide body_text)
-- when §2.7's Realtime design lands, and never `select *` from the store.

-- =============================================================================================
-- Part 2 · CV-19: the query builder, the headline config, the readable set, chat_search
-- =============================================================================================

-- websearch syntax ("quoted phrase", or, -word) over the unaccented query; each word of 3+
-- letters becomes a prefix ('zadan':*), shorter words match whole words only ("ok", "UI", "za"),
-- a negated word stays exact. Punctuation-only input gives null (= no rows, never every row).
-- Never raises on user input: if the rewrite can't be cast, the plain query is used.
create or replace function public.chat__search_query(p_query text)
  returns tsquery
  language plpgsql immutable parallel safe strict
  set search_path = ''
  set client_min_messages = warning
as $$
declare
  v_q tsquery := pg_catalog.websearch_to_tsquery(
    'pg_catalog.simple'::regconfig, public.chat__unaccent(pg_catalog.left(p_query, 256)));
begin
  if pg_catalog.numnode(v_q) = 0 then
    return null;
  end if;
  begin
    return pg_catalog.regexp_replace(
      v_q::text, '(^|[ (])''([^'']{3,})''(?=$|[ )])', '\1''\2'':*', 'g')::tsquery;
  exception when others then
    return v_q;
  end;
end;
$$;

-- Display only: unaccents per token, so ts_headline over the original body_text highlights
-- "żółw" for 'zolw':*. On the 100,000-row fixture it produced the same lexemes and positions
-- as search_tsv on every row. The index keeps the wrapper above (it unaccents before parsing,
-- so it doesn't depend on the database's ctype for Polish letters).
do $$
begin
  if not exists (select 1 from pg_catalog.pg_ts_config
                  where cfgname = 'chat_headline' and cfgnamespace = 'public'::regnamespace) then
    create text search configuration public.chat_headline (copy = pg_catalog.simple);
    alter text search configuration public.chat_headline
      alter mapping for word, hword, hword_part with extensions.unaccent, pg_catalog.simple;
  end if;
end $$;

-- The caller's readable conversations in one workspace, set-based: the workspace gate once (as
-- InitPlans), the per-conversation part as one query. It must say exactly what
-- chat_can_read_channel says: rebuild this body from CV-1's live chat_can_read_channel, and keep
-- the parity test in chat_search.test.sql. (Calling chat_can_read_channel per conversation
-- costs ~83 µs each: 4 ms at 50 conversations, ~170 ms at 2,000; this costs 0.7 ms at 2,025.)
create or replace function public.chat__readable_channel_ids(p_workspace_id uuid)
  returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(c.id), '{}'::uuid[])
    from public.chat_channels c
   where c.workspace_id = p_workspace_id
     and (select public.chat_can_access_workspace(p_workspace_id))  -- CV-1: no plan needed to read
     and (select public.perm_can_view(p_workspace_id, 'chat'))
     and c.deleted_at is null                                         -- CV-15's column
     and ((c.kind = 'channel' and not c.is_private)
          or exists (select 1 from public.chat_members m
                      where m.channel_id = c.id
                        and m.user_id = (select auth.uid())
                        /* and m.left_at is null: CV-1's "people who left drop out" */));
  -- CV-21: a key reads as its creator (perm_actor_id()); public channels only, private ones the
  -- creator is in when the key's "Include private channels I'm in" switch is on, never a DM.
$$;
revoke all on function public.chat__readable_channel_ids(uuid) from public, anon, authenticated;

-- ⌘K (p_limit 5), Chat's Search and a conversation's Search (p_channel_id), the MCP tool.
-- SECURITY DEFINER: the readable set is the only gate, applied inside the indexed query
-- (never per match: with 5,000 unreadable newest matches the per-match loop took 713 ms, and a
-- capped loop returned nothing). Newest first; the next page passes the last row's
-- (created_at, message_id) as (p_before, p_before_id). The snippet marks hits with U+E000 …
-- U+E001 and is plain text: the client splits on them and renders text nodes, never HTML.
create or replace function public.chat_search(
  p_workspace_id uuid,
  p_query text,
  p_channel_id uuid default null,
  p_before timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50,
  p_from uuid default null,           -- FilterBar "from"
  p_after timestamptz default null    -- FilterBar date, with p_before; "has a file" waits for CV-9
)
  returns table (
    message_id uuid, channel_id uuid, parent_id uuid, author_id uuid,
    created_at timestamptz, snippet text)
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  v_q tsquery := public.chat__search_query(p_query);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_channels uuid[];
begin
  if v_q is null or p_workspace_id is null or public.perm_actor_id() is null then
    return;
  end if;
  v_channels := public.chat__readable_channel_ids(p_workspace_id);
  if p_channel_id is not null then
    v_channels := case when p_channel_id = any (v_channels) then array[p_channel_id] else '{}'::uuid[] end;
  end if;
  if pg_catalog.cardinality(v_channels) = 0 then
    return;
  end if;
  return query
    select h.id, h.channel_id, h.parent_id, h.author_id, h.created_at,
           pg_catalog.ts_headline('public.chat_headline'::regconfig, h.body_text, v_q,
             'StartSel=' || pg_catalog.chr(57344) || ', StopSel=' || pg_catalog.chr(57345)
             || ', MaxWords=24, MinWords=8, ShortWord=2, MaxFragments=2, FragmentDelimiter=" … "')
      from (
        select m.id, m.channel_id, m.parent_id, m.author_id, m.created_at, m.body_text
          from public.chat_messages m
         where m.search_tsv @@ v_q
           and m.deleted_at is null
           and m.channel_id = any (v_channels)
           and (p_from is null or m.author_id = p_from)
           and (p_after is null or m.created_at >= p_after)
           and (p_before is null
                or m.created_at < p_before
                or (m.created_at = p_before and p_before_id is not null and m.id < p_before_id))
         order by m.created_at desc, m.id desc
         limit v_limit
      ) h
     order by h.created_at desc, h.id desc;
end;
$$;
revoke all on function public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz) from public, anon;
grant execute on function public.chat_search(uuid, text, uuid, timestamptz, uuid, integer, uuid, timestamptz) to authenticated;

-- =============================================================================================
-- For supabase/tests/chat_search.test.sql (CV-19); fixture: drafts/search-fixture.py (100,000 rows)
-- =============================================================================================
-- · "zolw" and "żółw" return the same rows, all containing "żółw"; "zadan" returns zadania,
--   zadaniem, zadań, zadanie, zadaniu (count = rows whose unaccented body_text matches \mzadan).
-- · as an outsider, a member of another workspace, a plain member and a member of the private
--   channel: no returned row is from a conversation chat_can_read_channel refuses; the private
--   channel's rows reach only its member, also with p_channel_id set to it.
-- · parity: for every conversation and caller, (id = any(chat__readable_channel_ids(ws))) =
--   chat_can_read_channel(id).
-- · 300 readable older matches under 20,000 unreadable newer ones: still 50 rows.
-- · '', '   ', ' - ', '!!!', null → no rows, no error; p_limit 500 → 50 rows; three keyset
--   pages of 50 → 150 distinct rows equal to the first 150 of one ordered query.
-- · deleted messages and messages of a deleted channel never return; an archived channel's do.
-- · timing: p95 of the 200 fixture queries ≤ 150 ms (spike: 4.3 ms on an 18-core Mac).
