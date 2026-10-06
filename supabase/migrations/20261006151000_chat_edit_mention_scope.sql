-- chat_op_edit: scope edited mentions exactly like chat_op_send — only people
-- who can read the conversation count as mentioned (the unread-mention badge
-- reads mentioned_user_ids). Edits still never notify (quiet bar).
-- CREATE OR REPLACE with the same signature keeps the grants from 20261006150000.

create or replace function public.chat_op_edit(p_message_id uuid, p_body text, p_mentioned_user_ids uuid[] default '{}')
returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare
  v_msg public.chat_messages;
  v_channel public.chat_channels;
  v_mentions uuid[];
begin
  select * into v_msg from public.chat_messages where id = p_message_id for update;
  if v_msg.id is null or v_msg.deleted_at is not null then
    raise exception 'That message no longer exists.';
  end if;
  v_channel := public.chat_op__channel(v_msg.channel_id);
  if v_msg.author_id is distinct from auth.uid() then
    raise exception 'You can only edit your own messages.';
  end if;
  if btrim(coalesce(p_body, ''), E' \n\t') = '' then
    raise exception 'A message can''t be empty.';
  end if;
  if char_length(p_body) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;

  select coalesce(array_agg(distinct u), '{}') into v_mentions
    from unnest(coalesce(p_mentioned_user_ids, '{}'::uuid[])) u
   where public.chat_is_workspace_member(v_channel.workspace_id, u)
     and ((v_channel.kind = 'channel' and not v_channel.is_private)
          or exists (select 1 from public.chat_members m where m.channel_id = v_channel.id and m.user_id = u));

  update public.chat_messages
     set body = p_body,
         mentioned_user_ids = v_mentions,
         edited_at = now()
   where id = p_message_id
  returning * into v_msg;
  return v_msg;
end;
$$;

-- Pin the search_path on the one chat helper that lacked it (security advisor
-- function_search_path_mutable). Pure function — behavior unchanged.
alter function public.chat_normalize_channel_name(text) set search_path = public;
