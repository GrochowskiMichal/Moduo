-- CV-0 spike 2 draft: the server half of the chat store.
--
-- Written against the scratch schema `spike_s2` on the local stack, where
-- `scripts/spikes/chat/s2/run.ts` applies it, proves it and drops it. Nothing
-- here touches `public`: the tables are copies of the live chat tables' shape
-- (`like public.… including defaults including constraints`, read only) with
-- the v2 columns the store needs. Lines marked "CV-1:" say how the real
-- migration differs.
--
-- What CV-1 should take from it:
--   1. `updated_at` on chat_messages and chat_members (chat_channels has one),
--      stamped by a BEFORE INSERT OR UPDATE trigger with clock_timestamp(),
--      named `zz_stamp_updated_at` like Tasks' (fires last).
--   2. Two indexes on chat_messages: the stream `(channel_id, created_at, id)`
--      without v1's `where parent_id is null` (v2 replies live in the stream),
--      and the delta `(workspace_id, updated_at, id)`.
--   3. Keyset reads with a row comparison, `(created_at, id) < ($t, $id)`.
--   4. `chat_sync_ids`: the conversations you can read, your memberships, and
--      the ids moved out of a conversation you can read into one you can't.

create schema spike_s2;

-- Stand-in for chat_can_access_workspace + perm_can_view (the workspace's
-- members with chat). CV-1: not created; the real check is public's.
create table spike_s2.workspace_members (
  workspace_id uuid not null,
  user_id uuid not null,
  primary key (workspace_id, user_id)
);

-- ── Tables (v1's shape + the v2 columns the store reads) ───────────────────

create table spike_s2.chat_channels (
  like public.chat_channels including defaults including constraints
);
alter table spike_s2.chat_channels
  add primary key (id),
  -- CV-1 (round-3 §2.1): Recently deleted.
  add column deleted_at timestamptz,
  add column deleted_by uuid;

create table spike_s2.chat_members (
  like public.chat_members including defaults including constraints
);
alter table spike_s2.chat_members
  add primary key (channel_id, user_id),
  -- CV-1 (round-3 §2.1): leaving or removal stamps the row, never deletes it.
  add column left_at timestamptz,
  add column removed_by uuid,
  add column updated_at timestamptz not null default clock_timestamp();

create table spike_s2.chat_messages (
  like public.chat_messages including defaults including constraints
);
alter table spike_s2.chat_messages
  add primary key (id),
  -- The delta clock. Every edit, delete, reaction, pin, reply rollup and move
  -- rewrites the row, so the trigger below moves it.
  add column updated_at timestamptz not null default clock_timestamp(),
  add column reply_to_id uuid,
  add column kind text not null default 'message' check (kind in ('message', 'event')),
  -- moved_out / moved_in: {"type": …, "ids": [...], "to"/"from": <channel id>}.
  add column event jsonb,
  add column moved_at timestamptz,
  add column moved_by uuid,
  add column moved_from_channel_id uuid;

create unique index chat_messages_client_uq
  on spike_s2.chat_messages (author_id, client_id) where client_id is not null;

-- The stream: history pages by (created_at, id), replies included.
-- CV-1: replaces v1's chat_messages_channel_idx (… where parent_id is null).
create index chat_messages_stream_idx on spike_s2.chat_messages (channel_id, created_at, id);

-- The delta: rows changed since a stamp, for one workspace, by (updated_at, id).
create index chat_messages_delta_idx on spike_s2.chat_messages (workspace_id, updated_at, id);

create index chat_members_user_idx on spike_s2.chat_members (user_id, workspace_id);

-- ── The stamp trigger (Tasks' zz_stamp_updated_at pattern) ─────────────────

-- clock_timestamp(), not now(): rows written in one transaction get distinct,
-- increasing stamps, and a row saved later in a long transaction never reads
-- as older than its own transaction's start (gotchas §Supabase).
create function spike_s2.stamp_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger zz_stamp_updated_at before insert or update on spike_s2.chat_channels
  for each row execute function spike_s2.stamp_updated_at();
create trigger zz_stamp_updated_at before insert or update on spike_s2.chat_members
  for each row execute function spike_s2.stamp_updated_at();
create trigger zz_stamp_updated_at before insert or update on spike_s2.chat_messages
  for each row execute function spike_s2.stamp_updated_at();

-- ── Who can read a conversation (v2's rule) ─────────────────────────────────

-- CV-1: this is public.chat_can_read_channel(p_channel_id) with auth.uid()
-- and its live workspace/plan checks, plus the two v2 conditions:
-- `c.deleted_at is null` and `m.left_at is null`.
create function spike_s2.chat_can_read(p_channel_id uuid, p_user_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from spike_s2.chat_channels c
     where c.id = p_channel_id
       and c.deleted_at is null
       and exists (select 1 from spike_s2.workspace_members w
                    where w.workspace_id = c.workspace_id and w.user_id = p_user_id)
       and (
         (c.kind = 'channel' and not c.is_private)
         or exists (select 1 from spike_s2.chat_members m
                     where m.channel_id = c.id and m.user_id = p_user_id and m.left_at is null)
       )
  )
$$;

-- ── The access check ────────────────────────────────────────────────────────

-- What the store compares its copy with, on rejoin, focus, every 10 minutes
-- and when one of your membership rows changes. Losing access sends no event
-- (a row RLS stops returning is never delivered), so this is how the device
-- learns it:
--   conversation  every conversation of the workspace you can read now; the
--                 store drops any other it holds (removed, deleted, made
--                 private), from memory and the device copy.
--   member        the conversations you're an active member of (the sidebar).
--   moved_away    message ids named by a `moved_out` line, in a conversation
--                 you can read, written since p_since, whose message now sits
--                 where you can't read it (or is gone). The line itself is
--                 the fast path (it reaches you by Realtime/delta); this is
--                 the backstop for a line you missed.
-- checked_at is the server's clock at the start; the store keeps it and sends
-- it back, minus a 5-minute lookback, as the next p_since.
--
-- CV-1: `chat_sync_ids(p_workspace_id uuid, p_since timestamptz default null)`,
-- SECURITY DEFINER with `set search_path = ''`, the caller from auth.uid()
-- (an API key reads none: perm_can_see_entity's chat branch), execute granted
-- to authenticated only.
create function spike_s2.chat_sync_ids(
  p_workspace_id uuid,
  p_user_id uuid,
  p_since timestamptz default null
) returns table (kind text, id uuid, conversation_id uuid, checked_at timestamptz)
language sql stable set search_path = '' as $$
  with t as (select clock_timestamp() as at),
  readable as (
    select c.id
      from spike_s2.chat_channels c
     where c.workspace_id = p_workspace_id
       and spike_s2.chat_can_read(c.id, p_user_id)
  ),
  moved as (
    select distinct x.mid, e.channel_id as source
      from spike_s2.chat_messages e
      join readable r on r.id = e.channel_id
     cross join lateral (
       select v::uuid as mid from jsonb_array_elements_text(e.event -> 'ids') v
     ) x
      left join spike_s2.chat_messages m on m.id = x.mid
     where e.workspace_id = p_workspace_id
       and e.kind = 'event'
       and e.event ->> 'type' = 'moved_out'
       and e.deleted_at is null
       and e.updated_at >= coalesce(p_since, '-infinity'::timestamptz)
       and (m.id is null or not exists (select 1 from readable r2 where r2.id = m.channel_id))
  )
  select 'conversation'::text, r.id, r.id, t.at from readable r, t
  union all
  select 'member'::text, m.channel_id, m.channel_id, t.at
    from spike_s2.chat_members m
    join readable r on r.id = m.channel_id, t
   where m.user_id = p_user_id and m.left_at is null
  union all
  select 'moved_away'::text, mv.mid, mv.source, t.at from moved mv, t
$$;

-- ── Keyset reads ───────────────────────────────────────────────────────────

-- One page of a conversation's stream, older (`before`) or newer (`after`)
-- than a message, by (created_at, id). The row comparison uses
-- chat_messages_stream_idx as one range; ties on created_at (every row of
-- one transaction shares it) fall on either side by id, so no page boundary
-- loses or repeats a row.
-- CV-1: as an op or a plain SELECT under RLS; the PostgREST spelling of the
-- same predicate is `or=(created_at.lt."T",and(created_at.eq."T",id.lt.X))`
-- (timestamps double-quoted inside or=, micro precision kept as text).
create function spike_s2.chat_messages_page(
  p_channel_id uuid,
  p_user_id uuid,
  p_created_at timestamptz,
  p_id uuid,
  p_direction text,
  p_limit int
) returns setof spike_s2.chat_messages
language sql stable set search_path = '' as $$
  select * from (
    select m.*
      from spike_s2.chat_messages m
     where m.channel_id = p_channel_id
       and spike_s2.chat_can_read(p_channel_id, p_user_id)
       and p_direction = 'before'
       and (p_created_at is null or (m.created_at, m.id) < (p_created_at, p_id))
     order by m.created_at desc, m.id desc
     limit p_limit
  ) older
  union all
  select * from (
    select m.*
      from spike_s2.chat_messages m
     where m.channel_id = p_channel_id
       and spike_s2.chat_can_read(p_channel_id, p_user_id)
       and p_direction = 'after'
       and (p_created_at is null or (m.created_at, m.id) > (p_created_at, p_id))
     order by m.created_at, m.id
     limit p_limit
  ) newer
$$;

-- One page of a workspace's changes since a stamp, by (updated_at, id): the
-- delta read. The caller starts at its cursor minus 5 minutes (a transaction
-- stamped earlier can commit after a later one was read) and keeps the
-- newest stamp per id.
create function spike_s2.chat_messages_delta(
  p_workspace_id uuid,
  p_user_id uuid,
  p_after_stamp timestamptz,
  p_after_id uuid,
  p_limit int
) returns setof spike_s2.chat_messages
language sql stable set search_path = '' as $$
  select m.*
    from spike_s2.chat_messages m
   where m.workspace_id = p_workspace_id
     and (m.updated_at, m.id) > (p_after_stamp, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
     and spike_s2.chat_can_read(m.channel_id, p_user_id)
   order by m.updated_at, m.id
   limit p_limit
$$;
