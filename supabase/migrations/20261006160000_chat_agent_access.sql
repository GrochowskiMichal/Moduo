-- Chat on the Moduo MCP connector (specs/chat.md §Agents).
--
-- • Chat gets its OWN key scope (`scopes->>'chat'`, none by default). Agents
--   only ever see PUBLIC, non-archived channels — never DMs or private
--   channels, whatever the scope.
-- • An agent's post is attributed to the API key, not a person:
--   author_id NULL, author_kind 'api_key', author_label = the key's name
--   (snapshot). The app renders it with an "App" badge — agents never post
--   silently or impersonate anyone (module contract, Pillar 2).
-- • Reads for the connector run as service_role with explicit filters (see
--   supabase/functions/moduo-mcp/modules/chat.ts); the only new RPC is the
--   write, callable by service_role alone.

alter table public.chat_messages
  add column if not exists author_kind text not null default 'user',
  add column if not exists author_label text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_author_kind_check') then
    alter table public.chat_messages
      add constraint chat_messages_author_kind_check check (author_kind in ('user', 'api_key'));
  end if;
end $$;

-- The calling key's chat scope in this workspace ('none' | 'view' | 'edit').
create or replace function public.chat_key_scope(p_workspace_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case lower(coalesce(k.scopes ->> 'chat', 'none'))
              when 'edit' then 'edit' when 'view' then 'view' else 'none' end
       from public.workspace_api_keys k
      where k.id = public.module_api_key_id()
        and k.workspace_id = p_workspace_id
        and k.revoked_at is null),
    'none')
$$;
revoke all on function public.chat_key_scope(uuid) from public, anon, authenticated;
grant execute on function public.chat_key_scope(uuid) to service_role;

create or replace function public.chat_op_agent_post(
  p_workspace_id uuid,
  p_channel_id uuid,
  p_body text,
  p_parent_id uuid default null
) returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare
  v_key uuid := public.module_api_key_id();
  v_label text;
  v_channel public.chat_channels;
  v_parent public.chat_messages;
  v_msg public.chat_messages;
  v_body text := coalesce(p_body, '');
  v_mentions uuid[];
  v_notify jsonb;
begin
  if v_key is null then
    raise exception 'Only an API key can post as an app.';
  end if;
  if public.chat_key_scope(p_workspace_id) <> 'edit' then
    raise exception 'This API key can''t post to chat — give it Chat: Edit in Workspace settings → API keys.';
  end if;
  if not public.chat_workspace_enabled(p_workspace_id) then
    raise exception 'Chat is available on the Duo and Team plans.';
  end if;

  select * into v_channel from public.chat_channels
   where id = p_channel_id and workspace_id = p_workspace_id;
  if v_channel.id is null or v_channel.kind <> 'channel' or v_channel.is_private then
    raise exception 'Apps can only post in public channels.';
  end if;
  if v_channel.archived_at is not null then
    raise exception 'This channel is archived.';
  end if;
  if btrim(v_body, E' \n\t') = '' then
    raise exception 'A message can''t be empty.';
  end if;
  if char_length(v_body) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.chat_messages where id = p_parent_id for update;
    if v_parent.id is null or v_parent.channel_id <> p_channel_id or v_parent.parent_id is not null
       or v_parent.deleted_at is not null then
      raise exception 'That thread no longer exists.';
    end if;
  end if;

  select k.name into v_label from public.workspace_api_keys k where k.id = v_key;

  -- Mentions come from the body's <@uuid> tokens, scoped to workspace members.
  select coalesce(array_agg(distinct m[1]::uuid), '{}') into v_mentions
    from regexp_matches(v_body, '<@([0-9a-fA-F-]{36})>', 'g') m
   where public.chat_is_workspace_member(p_workspace_id, m[1]::uuid);

  insert into public.chat_messages
    (workspace_id, channel_id, parent_id, author_id, author_kind, author_label, body, mentioned_user_ids)
  values
    (p_workspace_id, p_channel_id, p_parent_id, null, 'api_key', coalesce(v_label, 'App'), v_body, v_mentions)
  returning * into v_msg;

  if v_parent.id is not null then
    update public.chat_messages
       set reply_count = reply_count + 1, last_reply_at = v_msg.created_at
     where id = v_parent.id;
  else
    update public.chat_channels set last_message_at = v_msg.created_at where id = p_channel_id;
  end if;

  select coalesce(jsonb_agg(distinct s.uid::text), '[]'::jsonb) into v_notify
    from (select unnest(v_mentions) as uid
          union select v_parent.author_id where v_parent.id is not null) s
   where s.uid is not null;

  if v_notify <> '[]'::jsonb then
    perform public.module_activity_log(p_workspace_id, 'chat', 'chat_channel', p_channel_id,
      case when cardinality(v_mentions) > 0 then 'chat.mention' else 'chat.reply' end,
      jsonb_build_object(
        'message_id', v_msg.id,
        'parent_id', p_parent_id,
        'channel_name', v_channel.name,
        'channel_kind', v_channel.kind,
        'excerpt', left(regexp_replace(v_body, '<@[0-9a-fA-F-]{36}>', '@someone', 'g'), 140),
        'notify_user_ids', v_notify));
  end if;
  return v_msg;
end;
$$;
revoke all on function public.chat_op_agent_post(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.chat_op_agent_post(uuid, uuid, text, uuid) to service_role;
