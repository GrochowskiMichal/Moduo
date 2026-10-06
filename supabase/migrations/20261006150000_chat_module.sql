-- Chat module (specs/chat.md) — channels, private channels, DMs, threads,
-- reactions, pins, mentions, read state. Duo / Team / Founder workspaces only.
--
-- Shape:
--   • Three tables: chat_channels, chat_members (per-user state: read mark,
--     notify level, star), chat_messages (top-level + thread replies). Reactions
--     and thread rollups are DENORMALIZED onto the message row so every live
--     change is a single UPDATE on one table — Realtime postgres_changes then
--     carries it to subscribers with RLS applied (deletes are soft for the same
--     reason: a hard DELETE event bypasses RLS).
--   • Clients only SELECT. Every write is a SECURITY DEFINER `chat_op_*` op
--     (module contract Pillar 1) that re-checks access + the plan gate.
--   • Gate: the workspace OWNER's plan ranks ≥ duo (duo/team/founder). Members
--     inherit it — a Duo plan covers both people. Enforced in RLS (reads) and
--     in every op (writes), so a downgrade closes chat server-side.
--   • Notifications ride module_activity's `notify_user_ids` branch, only for
--     @mentions, @channel, and thread replies — never per message (quiet bar,
--     PRODUCT_BRIEF §7). Plain messages are not logged as activity: the message
--     row is its own attributed record (author_id + created_at).
--   • Typing + presence use a PRIVATE Realtime channel `chat:<workspace id>`,
--     authorized by the realtime.messages policies at the bottom.

-- ── Gate + access helpers ────────────────────────────────────────────────────

create or replace function public.chat_workspace_enabled(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspaces w
     where w.id = p_workspace_id
       and w.deleted_at is null
       and public.plan_tier_rank(public.profile_plan_tier_text(w.owner_id)) >= 2
  )
$$;

create or replace function public.chat_is_workspace_member(p_workspace_id uuid, p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_workspace_id and m.user_id = p_user_id
  ) or exists (
    select 1 from public.workspaces w
     where w.id = p_workspace_id and w.owner_id = p_user_id and w.deleted_at is null
  )
$$;

create or replace function public.chat_can_access_workspace(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and public.chat_is_workspace_member(p_workspace_id, auth.uid())
     and public.chat_workspace_enabled(p_workspace_id)
$$;

create or replace function public.chat_is_workspace_admin(p_workspace_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspaces w
     where w.id = p_workspace_id and w.owner_id = auth.uid() and w.deleted_at is null
  ) or exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_workspace_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  )
$$;

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.chat_channels (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  kind            text not null check (kind in ('channel', 'dm')),
  name            text check (name is null or char_length(name) between 1 and 80),
  topic           text not null default '' check (char_length(topic) <= 250),
  is_private      boolean not null default false,
  -- Sorted, comma-joined member ids — one DM per set of people.
  dm_key          text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  last_message_at timestamptz,
  constraint chat_channels_kind_shape check (
    (kind = 'channel' and name is not null and dm_key is null)
    or (kind = 'dm' and dm_key is not null and name is null)
  )
);
create unique index if not exists chat_channels_name_uq
  on public.chat_channels (workspace_id, lower(name)) where kind = 'channel';
create unique index if not exists chat_channels_dm_uq
  on public.chat_channels (workspace_id, dm_key) where kind = 'dm';
create index if not exists chat_channels_workspace_idx on public.chat_channels (workspace_id);

create table if not exists public.chat_members (
  channel_id   uuid not null references public.chat_channels(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  notify_level text not null default 'mentions' check (notify_level in ('all', 'mentions', 'none')),
  starred      boolean not null default false,
  last_read_at timestamptz not null default now(),
  joined_at    timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id, workspace_id);

create table if not exists public.chat_messages (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  channel_id         uuid not null references public.chat_channels(id) on delete cascade,
  parent_id          uuid references public.chat_messages(id) on delete cascade,
  author_id          uuid references auth.users(id) on delete set null,
  body               text not null default '' check (char_length(body) <= 8000),
  mentioned_user_ids uuid[] not null default '{}',
  -- { "<emoji>": ["<user id>", …] } — maintained only by chat_op_react.
  reactions          jsonb not null default '{}'::jsonb,
  reply_count        int not null default 0,
  last_reply_at      timestamptz,
  -- Most recent distinct repliers, newest first (≤ 5) — the thread facepile.
  reply_user_ids     uuid[] not null default '{}',
  pinned_at          timestamptz,
  pinned_by          uuid references auth.users(id) on delete set null,
  edited_at          timestamptz,
  deleted_at         timestamptz,
  -- Client-generated id so an optimistic send that retries can't double-post.
  client_id          uuid,
  created_at         timestamptz not null default now()
);
create index if not exists chat_messages_channel_idx
  on public.chat_messages (channel_id, created_at desc, id desc) where parent_id is null;
create index if not exists chat_messages_thread_idx
  on public.chat_messages (parent_id, created_at, id) where parent_id is not null;
create unique index if not exists chat_messages_client_uq
  on public.chat_messages (author_id, client_id) where client_id is not null;

-- ── Read helper (used by RLS + every op) ─────────────────────────────────────

create or replace function public.chat_can_read_channel(p_channel_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_channels c
     where c.id = p_channel_id
       and public.chat_can_access_workspace(c.workspace_id)
       and (
         (c.kind = 'channel' and not c.is_private)
         or exists (select 1 from public.chat_members m where m.channel_id = c.id and m.user_id = auth.uid())
       )
  )
$$;

-- ── RLS: SELECT only; writes go through the ops ──────────────────────────────

alter table public.chat_channels enable row level security;
alter table public.chat_members  enable row level security;
alter table public.chat_messages enable row level security;

revoke all on public.chat_channels, public.chat_members, public.chat_messages from public, anon, authenticated;
grant select on public.chat_channels, public.chat_members, public.chat_messages to authenticated;
grant all on public.chat_channels, public.chat_members, public.chat_messages to service_role;

drop policy if exists chat_channels_select on public.chat_channels;
create policy chat_channels_select on public.chat_channels for select to authenticated
  using (public.chat_can_read_channel(id));

drop policy if exists chat_members_select on public.chat_members;
create policy chat_members_select on public.chat_members for select to authenticated
  using (user_id = auth.uid() or public.chat_can_read_channel(channel_id));

drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to authenticated
  using (public.chat_can_read_channel(channel_id));

-- ── Op guards ────────────────────────────────────────────────────────────────

create or replace function public.chat_op__guard(p_workspace_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.chat_is_workspace_member(p_workspace_id, auth.uid()) then
    raise exception 'You don''t have access to this workspace.';
  end if;
  if not public.chat_workspace_enabled(p_workspace_id) then
    raise exception 'Chat is available on the Duo and Team plans.';
  end if;
end;
$$;

-- Loads a channel the caller can read, or raises.
create or replace function public.chat_op__channel(p_channel_id uuid) returns public.chat_channels
language plpgsql stable security definer set search_path = public as $$
declare v_channel public.chat_channels;
begin
  select * into v_channel from public.chat_channels where id = p_channel_id;
  if v_channel.id is null then
    raise exception 'That conversation no longer exists.';
  end if;
  perform public.chat_op__guard(v_channel.workspace_id);
  if not public.chat_can_read_channel(p_channel_id) then
    raise exception 'You''re not a member of this conversation.';
  end if;
  return v_channel;
end;
$$;

-- Same normalization as features/chat/channel-name.ts — keep in lockstep.
create or replace function public.chat_normalize_channel_name(p_name text) returns text
language sql immutable as $$
  select left(
    trim(both '-' from regexp_replace(
      regexp_replace(lower(trim(coalesce(p_name, ''))), '\s+', '-', 'g'),
      '[^[:alnum:]_-]', '', 'g')),
    80)
$$;

-- ── Ops: channels ────────────────────────────────────────────────────────────

-- Idempotent: every chat-enabled workspace has a #general everyone can read.
create or replace function public.chat_op_bootstrap(p_workspace_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  perform public.chat_op__guard(p_workspace_id);
  if exists (select 1 from public.chat_channels where workspace_id = p_workspace_id and kind = 'channel') then
    return;
  end if;
  select owner_id into v_owner from public.workspaces where id = p_workspace_id;
  insert into public.chat_channels (workspace_id, kind, name, topic, created_by)
  values (p_workspace_id, 'channel', 'general', 'Everyone in the workspace', v_owner)
  on conflict do nothing;
end;
$$;

create or replace function public.chat_op_create_channel(
  p_workspace_id uuid,
  p_name text,
  p_topic text default '',
  p_is_private boolean default false,
  p_member_ids uuid[] default '{}'
) returns public.chat_channels
language plpgsql security definer set search_path = public as $$
declare
  v_name text := public.chat_normalize_channel_name(p_name);
  v_channel public.chat_channels;
  v_uid uuid;
begin
  perform public.chat_op__guard(p_workspace_id);
  if v_name = '' then
    raise exception 'Give the channel a name.';
  end if;
  if exists (select 1 from public.chat_channels
              where workspace_id = p_workspace_id and kind = 'channel' and lower(name) = v_name) then
    raise exception 'A channel named #% already exists.', v_name;
  end if;

  insert into public.chat_channels (workspace_id, kind, name, topic, is_private, created_by)
  values (p_workspace_id, 'channel', v_name, left(coalesce(p_topic, ''), 250), coalesce(p_is_private, false), auth.uid())
  returning * into v_channel;

  insert into public.chat_members (channel_id, user_id, workspace_id, notify_level)
  values (v_channel.id, auth.uid(), p_workspace_id, 'all');

  foreach v_uid in array coalesce(p_member_ids, '{}'::uuid[]) loop
    if v_uid <> auth.uid() and public.chat_is_workspace_member(p_workspace_id, v_uid) then
      insert into public.chat_members (channel_id, user_id, workspace_id)
      values (v_channel.id, v_uid, p_workspace_id) on conflict do nothing;
    end if;
  end loop;

  perform public.module_activity_log(p_workspace_id, 'chat', 'chat_channel', v_channel.id,
    'chat.channel_create', jsonb_build_object('name', v_name, 'is_private', v_channel.is_private));
  return v_channel;
end;
$$;

create or replace function public.chat_op_open_dm(p_workspace_id uuid, p_user_ids uuid[])
returns public.chat_channels
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_key text;
  v_channel public.chat_channels;
  v_uid uuid;
begin
  perform public.chat_op__guard(p_workspace_id);
  select array_agg(distinct u order by u) into v_ids
    from unnest(coalesce(p_user_ids, '{}'::uuid[]) || auth.uid()) u;
  if array_length(v_ids, 1) > 9 then
    raise exception 'A direct message can include up to 9 people.';
  end if;
  foreach v_uid in array v_ids loop
    if not public.chat_is_workspace_member(p_workspace_id, v_uid) then
      raise exception 'Everyone in a direct message must be in this workspace.';
    end if;
  end loop;
  v_key := array_to_string(v_ids, ',');

  select * into v_channel from public.chat_channels
   where workspace_id = p_workspace_id and kind = 'dm' and dm_key = v_key;
  if v_channel.id is null then
    insert into public.chat_channels (workspace_id, kind, is_private, dm_key, created_by)
    values (p_workspace_id, 'dm', true, v_key, auth.uid())
    on conflict do nothing
    returning * into v_channel;
    if v_channel.id is null then
      -- Lost a race with the other participant — read theirs.
      select * into v_channel from public.chat_channels
       where workspace_id = p_workspace_id and kind = 'dm' and dm_key = v_key;
    end if;
  end if;

  -- (Re-)add everyone: reopening a DM you left brings it back to your sidebar.
  foreach v_uid in array v_ids loop
    insert into public.chat_members (channel_id, user_id, workspace_id, notify_level)
    values (v_channel.id, v_uid, p_workspace_id, 'all') on conflict do nothing;
  end loop;
  return v_channel;
end;
$$;

create or replace function public.chat_op_update_channel(p_channel_id uuid, p_name text default null, p_topic text default null)
returns public.chat_channels
language plpgsql security definer set search_path = public as $$
declare
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_name text;
begin
  if v_channel.kind <> 'channel' then
    raise exception 'Direct messages don''t have a name or topic.';
  end if;
  if p_name is not null then
    v_name := public.chat_normalize_channel_name(p_name);
    if v_name = '' then raise exception 'Give the channel a name.'; end if;
    if v_name <> v_channel.name then
      if v_channel.created_by is distinct from auth.uid() and not public.chat_is_workspace_admin(v_channel.workspace_id) then
        raise exception 'Only the person who made this channel or a workspace admin can rename it.';
      end if;
      if exists (select 1 from public.chat_channels where workspace_id = v_channel.workspace_id
                   and kind = 'channel' and lower(name) = v_name and id <> p_channel_id) then
        raise exception 'A channel named #% already exists.', v_name;
      end if;
    end if;
  end if;

  update public.chat_channels
     set name = coalesce(v_name, name),
         topic = coalesce(left(p_topic, 250), topic),
         updated_at = now()
   where id = p_channel_id
  returning * into v_channel;
  return v_channel;
end;
$$;

create or replace function public.chat_op_archive_channel(p_channel_id uuid, p_archived boolean default true)
returns public.chat_channels
language plpgsql security definer set search_path = public as $$
declare v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
begin
  if v_channel.kind <> 'channel' then
    raise exception 'Direct messages can''t be archived.';
  end if;
  if v_channel.created_by is distinct from auth.uid() and not public.chat_is_workspace_admin(v_channel.workspace_id) then
    raise exception 'Only the person who made this channel or a workspace admin can archive it.';
  end if;
  update public.chat_channels
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         updated_at = now()
   where id = p_channel_id
  returning * into v_channel;
  perform public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_channel.id,
    case when p_archived then 'chat.channel_archive' else 'chat.channel_unarchive' end,
    jsonb_build_object('name', v_channel.name));
  return v_channel;
end;
$$;

create or replace function public.chat_op_join(p_channel_id uuid) returns public.chat_members
language plpgsql security definer set search_path = public as $$
declare
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_member public.chat_members;
begin
  insert into public.chat_members (channel_id, user_id, workspace_id)
  values (p_channel_id, auth.uid(), v_channel.workspace_id)
  on conflict (channel_id, user_id) do update set channel_id = excluded.channel_id
  returning * into v_member;
  return v_member;
end;
$$;

create or replace function public.chat_op_leave(p_channel_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
begin
  delete from public.chat_members where channel_id = v_channel.id and user_id = auth.uid();
end;
$$;

create or replace function public.chat_op_add_members(p_channel_id uuid, p_user_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_uid uuid;
  v_added int := 0;
begin
  if v_channel.kind <> 'channel' then
    raise exception 'Start a new direct message to add people.';
  end if;
  foreach v_uid in array coalesce(p_user_ids, '{}'::uuid[]) loop
    if public.chat_is_workspace_member(v_channel.workspace_id, v_uid) then
      insert into public.chat_members (channel_id, user_id, workspace_id)
      values (p_channel_id, v_uid, v_channel.workspace_id) on conflict do nothing;
      if found then v_added := v_added + 1; end if;
    end if;
  end loop;
  return v_added;
end;
$$;

create or replace function public.chat_op_remove_member(p_channel_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
begin
  if v_channel.kind <> 'channel' then
    raise exception 'People can''t be removed from a direct message.';
  end if;
  if p_user_id <> auth.uid()
     and v_channel.created_by is distinct from auth.uid()
     and not public.chat_is_workspace_admin(v_channel.workspace_id) then
    raise exception 'Only the person who made this channel or a workspace admin can remove people.';
  end if;
  delete from public.chat_members where channel_id = p_channel_id and user_id = p_user_id;
end;
$$;

-- ── Ops: messages ────────────────────────────────────────────────────────────

create or replace function public.chat_op_send(
  p_channel_id uuid,
  p_body text,
  p_parent_id uuid default null,
  p_mentioned_user_ids uuid[] default '{}',
  p_notify_channel boolean default false,
  p_client_id uuid default null,
  p_excerpt text default null
) returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_body text := coalesce(p_body, '');
  v_parent public.chat_messages;
  v_msg public.chat_messages;
  v_mentions uuid[];
  v_notify jsonb := '[]'::jsonb;
  v_op text;
begin
  if v_channel.archived_at is not null then
    raise exception 'This channel is archived.';
  end if;
  if btrim(v_body, E' \n\t') = '' then
    raise exception 'A message can''t be empty.';
  end if;
  if char_length(v_body) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;

  if p_client_id is not null then
    select * into v_msg from public.chat_messages where author_id = auth.uid() and client_id = p_client_id;
    if v_msg.id is not null then return v_msg; end if;
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.chat_messages where id = p_parent_id for update;
    if v_parent.id is null or v_parent.channel_id <> p_channel_id or v_parent.parent_id is not null then
      raise exception 'That thread no longer exists.';
    end if;
  end if;

  -- Posting in a public channel joins it (the Slack gesture).
  insert into public.chat_members (channel_id, user_id, workspace_id)
  values (p_channel_id, auth.uid(), v_channel.workspace_id) on conflict do nothing;

  -- Only people who can read this conversation can be mentioned.
  select coalesce(array_agg(distinct u), '{}') into v_mentions
    from unnest(coalesce(p_mentioned_user_ids, '{}'::uuid[])) u
   where public.chat_is_workspace_member(v_channel.workspace_id, u)
     and ((v_channel.kind = 'channel' and not v_channel.is_private)
          or exists (select 1 from public.chat_members m where m.channel_id = p_channel_id and m.user_id = u));

  insert into public.chat_messages (workspace_id, channel_id, parent_id, author_id, body, mentioned_user_ids, client_id)
  values (v_channel.workspace_id, p_channel_id, p_parent_id, auth.uid(), v_body, v_mentions, p_client_id)
  returning * into v_msg;

  if v_parent.id is not null then
    update public.chat_messages
       set reply_count = reply_count + 1,
           last_reply_at = v_msg.created_at,
           reply_user_ids = (
             select coalesce(array_agg(u), '{}') from (
               select u from unnest(array[auth.uid()] || array_remove(reply_user_ids, auth.uid())) with ordinality t(u, o)
                order by o limit 5) s)
     where id = v_parent.id;
  else
    update public.chat_channels set last_message_at = v_msg.created_at where id = p_channel_id;
    update public.chat_members set last_read_at = greatest(last_read_at, v_msg.created_at)
     where channel_id = p_channel_id and user_id = auth.uid();
  end if;

  -- Who hears about this (quiet bar): mentioned people; @channel → members not
  -- muted; a thread reply → the thread's author + earlier repliers. Never self.
  select coalesce(jsonb_agg(distinct s.uid::text), '[]'::jsonb) into v_notify from (
    select unnest(v_mentions) as uid
    union
    select m.user_id from public.chat_members m
     where p_notify_channel and m.channel_id = p_channel_id and m.notify_level <> 'none'
    union
    select v_parent.author_id where v_parent.id is not null
    union
    select r.author_id from public.chat_messages r
     where v_parent.id is not null and r.parent_id = v_parent.id and r.deleted_at is null
  ) s
  where s.uid is not null and s.uid is distinct from auth.uid();

  if v_notify <> '[]'::jsonb then
    v_op := case when cardinality(v_mentions) > 0 or p_notify_channel then 'chat.mention' else 'chat.reply' end;
    perform public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id, v_op,
      jsonb_build_object(
        'message_id', v_msg.id,
        'parent_id', p_parent_id,
        'channel_name', v_channel.name,
        'channel_kind', v_channel.kind,
        'excerpt', left(coalesce(nullif(p_excerpt, ''), v_body), 140),
        'notify_user_ids', v_notify));
  end if;
  return v_msg;
end;
$$;

create or replace function public.chat_op_edit(p_message_id uuid, p_body text, p_mentioned_user_ids uuid[] default '{}')
returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare v_msg public.chat_messages;
begin
  select * into v_msg from public.chat_messages where id = p_message_id for update;
  if v_msg.id is null or v_msg.deleted_at is not null then
    raise exception 'That message no longer exists.';
  end if;
  perform public.chat_op__channel(v_msg.channel_id);
  if v_msg.author_id is distinct from auth.uid() then
    raise exception 'You can only edit your own messages.';
  end if;
  if btrim(coalesce(p_body, ''), E' \n\t') = '' then
    raise exception 'A message can''t be empty.';
  end if;
  if char_length(p_body) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;
  update public.chat_messages
     set body = p_body,
         mentioned_user_ids = coalesce(p_mentioned_user_ids, '{}'),
         edited_at = now()
   where id = p_message_id
  returning * into v_msg;
  return v_msg;
end;
$$;

create or replace function public.chat_op_delete(p_message_id uuid) returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare v_msg public.chat_messages;
begin
  select * into v_msg from public.chat_messages where id = p_message_id for update;
  if v_msg.id is null then
    raise exception 'That message no longer exists.';
  end if;
  if v_msg.deleted_at is not null then return v_msg; end if;
  perform public.chat_op__channel(v_msg.channel_id);
  if v_msg.author_id is distinct from auth.uid() and not public.chat_is_workspace_admin(v_msg.workspace_id) then
    raise exception 'You can only delete your own messages.';
  end if;
  update public.chat_messages
     set deleted_at = now(), body = '', mentioned_user_ids = '{}', reactions = '{}'::jsonb,
         pinned_at = null, pinned_by = null
   where id = p_message_id
  returning * into v_msg;
  if v_msg.parent_id is not null then
    update public.chat_messages set reply_count = greatest(reply_count - 1, 0) where id = v_msg.parent_id;
  end if;
  return v_msg;
end;
$$;

create or replace function public.chat_op_react(p_message_id uuid, p_emoji text) returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare
  v_msg public.chat_messages;
  v_me text := auth.uid()::text;
  v_list jsonb;
begin
  if p_emoji is null or char_length(p_emoji) = 0 or char_length(p_emoji) > 32 then
    raise exception 'That reaction isn''t supported.';
  end if;
  select * into v_msg from public.chat_messages where id = p_message_id for update;
  if v_msg.id is null or v_msg.deleted_at is not null then
    raise exception 'That message no longer exists.';
  end if;
  perform public.chat_op__channel(v_msg.channel_id);

  v_list := coalesce(v_msg.reactions -> p_emoji, '[]'::jsonb);
  if v_list ? v_me then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_list
      from jsonb_array_elements_text(v_list) x where x <> v_me;
  else
    if not (v_msg.reactions ? p_emoji) and (select count(*) from jsonb_object_keys(v_msg.reactions)) >= 20 then
      raise exception 'This message has the most reactions it can hold.';
    end if;
    v_list := v_list || to_jsonb(v_me);
  end if;

  update public.chat_messages
     set reactions = case when jsonb_array_length(v_list) = 0 then reactions - p_emoji
                          else jsonb_set(reactions, array[p_emoji], v_list) end
   where id = p_message_id
  returning * into v_msg;
  return v_msg;
end;
$$;

create or replace function public.chat_op_pin(p_message_id uuid, p_pinned boolean default true)
returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare v_msg public.chat_messages;
begin
  select * into v_msg from public.chat_messages where id = p_message_id for update;
  if v_msg.id is null or v_msg.deleted_at is not null then
    raise exception 'That message no longer exists.';
  end if;
  perform public.chat_op__channel(v_msg.channel_id);
  update public.chat_messages
     set pinned_at = case when p_pinned then coalesce(pinned_at, now()) else null end,
         pinned_by = case when p_pinned then coalesce(pinned_by, auth.uid()) else null end
   where id = p_message_id
  returning * into v_msg;
  return v_msg;
end;
$$;

-- ── Ops: per-user state ──────────────────────────────────────────────────────

create or replace function public.chat_op_mark_read(p_channel_id uuid, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.chat_op__channel(p_channel_id);
  update public.chat_members
     set last_read_at = greatest(last_read_at, least(coalesce(p_at, now()), now()))
   where channel_id = p_channel_id and user_id = auth.uid();
end;
$$;

-- "Mark unread from here": moves the read mark BACK (mark_read only moves forward).
create or replace function public.chat_op_mark_unread(p_channel_id uuid, p_before timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.chat_op__channel(p_channel_id);
  update public.chat_members
     set last_read_at = p_before - interval '1 millisecond'
   where channel_id = p_channel_id and user_id = auth.uid();
end;
$$;

create or replace function public.chat_op_set_prefs(
  p_channel_id uuid,
  p_notify_level text default null,
  p_starred boolean default null
) returns public.chat_members
language plpgsql security definer set search_path = public as $$
declare v_member public.chat_members;
begin
  perform public.chat_op__channel(p_channel_id);
  if p_notify_level is not null and p_notify_level not in ('all', 'mentions', 'none') then
    raise exception 'Unknown notification level.';
  end if;
  update public.chat_members
     set notify_level = coalesce(p_notify_level, notify_level),
         starred = coalesce(p_starred, starred)
   where channel_id = p_channel_id and user_id = auth.uid()
  returning * into v_member;
  if v_member.channel_id is null then
    raise exception 'Join this channel first.';
  end if;
  return v_member;
end;
$$;

-- ── Reads ────────────────────────────────────────────────────────────────────

-- Unread top-level messages + mentions per channel I'm in (sidebar + nav badge).
create or replace function public.chat_unread_counts(p_workspace_id uuid)
returns table (channel_id uuid, unread int, mentions int)
language sql stable security definer set search_path = public as $$
  select m.channel_id,
         count(msg.id)::int as unread,
         count(msg.id) filter (where auth.uid() = any(msg.mentioned_user_ids))::int as mentions
    from public.chat_members m
    join public.chat_channels c on c.id = m.channel_id and c.archived_at is null
    left join public.chat_messages msg
      on msg.channel_id = m.channel_id
     and msg.parent_id is null
     and msg.deleted_at is null
     and msg.created_at > m.last_read_at
     and msg.author_id is distinct from auth.uid()
   where m.user_id = auth.uid()
     and m.workspace_id = p_workspace_id
     and public.chat_can_access_workspace(p_workspace_id)
   group by m.channel_id
$$;

-- ── Grants: authenticated only (anon never — see gotchas §Supabase) ──────────

do $$
declare fn text;
begin
  foreach fn in array array[
    'chat_workspace_enabled(uuid)',
    'chat_is_workspace_member(uuid, uuid)',
    'chat_can_access_workspace(uuid)',
    'chat_is_workspace_admin(uuid)',
    'chat_can_read_channel(uuid)',
    'chat_op__guard(uuid)',
    'chat_op__channel(uuid)',
    'chat_normalize_channel_name(text)',
    'chat_op_bootstrap(uuid)',
    'chat_op_create_channel(uuid, text, text, boolean, uuid[])',
    'chat_op_open_dm(uuid, uuid[])',
    'chat_op_update_channel(uuid, text, text)',
    'chat_op_archive_channel(uuid, boolean)',
    'chat_op_join(uuid)',
    'chat_op_leave(uuid)',
    'chat_op_add_members(uuid, uuid[])',
    'chat_op_remove_member(uuid, uuid)',
    'chat_op_send(uuid, text, uuid, uuid[], boolean, uuid, text)',
    'chat_op_edit(uuid, text, uuid[])',
    'chat_op_delete(uuid)',
    'chat_op_react(uuid, text)',
    'chat_op_pin(uuid, boolean)',
    'chat_op_mark_read(uuid, timestamptz)',
    'chat_op_mark_unread(uuid, timestamptz)',
    'chat_op_set_prefs(uuid, text, boolean)',
    'chat_unread_counts(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;

-- Internal guards are not client entry points.
revoke execute on function public.chat_op__guard(uuid), public.chat_op__channel(uuid) from authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_channels') then
    alter publication supabase_realtime add table public.chat_channels;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_members') then
    alter publication supabase_realtime add table public.chat_members;
  end if;
end $$;

-- Private broadcast/presence channel `chat:<workspace id>` (typing + online).
create or replace function public.chat_realtime_topic_allowed(p_topic text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and public.chat_can_access_workspace(substring(p_topic from 6)::uuid)
$$;
revoke all on function public.chat_realtime_topic_allowed(text) from public, anon;
grant execute on function public.chat_realtime_topic_allowed(text) to authenticated;

drop policy if exists chat_realtime_read on realtime.messages;
create policy chat_realtime_read on realtime.messages for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence')
         and public.chat_realtime_topic_allowed(realtime.topic()));

drop policy if exists chat_realtime_write on realtime.messages;
create policy chat_realtime_write on realtime.messages for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence')
              and public.chat_realtime_topic_allowed(realtime.topic()));
