create or replace function public.notes_bootstrap(
  p_after_updated_at timestamptz default null,
  p_limit int default 500
)
returns table (
  id uuid,
  owner_id text,
  parent_id uuid,
  title text,
  icon text,
  "position" text,
  is_archived boolean,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select
    n.id,
    n.owner_id,
    n.parent_id,
    n.title,
    n.icon,
    n.position,
    n.is_archived,
    n.created_at,
    n.updated_at,
    n.deleted_at
  from public.notes n
  where n.owner_id = (select auth.jwt() ->> 'sub')
    and (p_after_updated_at is null or n.updated_at > p_after_updated_at)
  order by n.updated_at asc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

create or replace function public.note_pull_updates(
  p_note_id uuid,
  p_after_id bigint default 0,
  p_limit int default 500
)
returns table (
  id bigint,
  note_id uuid,
  client_id text,
  client_seq bigint,
  update_b64 text,
  created_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  select
    u.id,
    u.note_id,
    u.client_id,
    u.client_seq,
    u.update_b64,
    u.created_at
  from public.note_updates u
  where u.owner_id = (select auth.jwt() ->> 'sub')
    and u.note_id = p_note_id
    and u.id > coalesce(p_after_id, 0)
  order by u.id asc
  limit greatest(1, least(coalesce(p_limit, 500), 5000));
$$;

create or replace function public.note_push_updates(
  p_note_id uuid,
  p_client_id text,
  p_updates jsonb
)
returns table (
  inserted_count int,
  last_update_id bigint
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner text;
  v_inserted int := 0;
  v_last_id bigint := 0;
begin
  v_owner := (select auth.jwt() ->> 'sub');

  if v_owner is null then
    raise exception 'Unauthenticated';
  end if;

  if p_client_id is null or length(trim(p_client_id)) = 0 then
    raise exception 'p_client_id is required';
  end if;

  perform 1
  from public.notes n
  where n.id = p_note_id and n.owner_id = v_owner;

  if not found then
    raise exception 'Note not found';
  end if;

  insert into public.note_updates (note_id, owner_id, client_id, client_seq, update_b64)
  select
    p_note_id,
    v_owner,
    p_client_id,
    x.client_seq,
    x.update_b64
  from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as x(client_seq bigint, update_b64 text)
  where x.client_seq is not null
    and x.update_b64 is not null
    and length(x.update_b64) > 0
  on conflict (note_id, client_id, client_seq) do nothing;

  get diagnostics v_inserted = row_count;

  select coalesce(max(u.id), 0)
  into v_last_id
  from public.note_updates u
  where u.note_id = p_note_id
    and u.owner_id = v_owner;

  return query select v_inserted, v_last_id;
end;
$$;

create or replace function public.notes_move(
  p_note_id uuid,
  p_new_parent_id uuid,
  p_new_position text
)
returns public.notes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner text;
  v_has_cycle boolean := false;
  v_result public.notes;
begin
  v_owner := (select auth.jwt() ->> 'sub');

  if v_owner is null then
    raise exception 'Unauthenticated';
  end if;

  if p_new_position is null or length(trim(p_new_position)) = 0 then
    raise exception 'p_new_position is required';
  end if;

  if p_new_parent_id = p_note_id then
    raise exception 'A note cannot be its own parent';
  end if;

  if p_new_parent_id is not null then
    perform 1
    from public.notes n
    where n.id = p_new_parent_id
      and n.owner_id = v_owner
      and n.deleted_at is null;

    if not found then
      raise exception 'Parent note not found';
    end if;

    with recursive parent_chain as (
      select n.id, n.parent_id
      from public.notes n
      where n.id = p_new_parent_id
      union all
      select n.id, n.parent_id
      from public.notes n
      join parent_chain p on p.parent_id = n.id
    )
    select exists(select 1 from parent_chain where id = p_note_id)
    into v_has_cycle;

    if v_has_cycle then
      raise exception 'Cycle detected in notes tree';
    end if;
  end if;

  update public.notes n
  set
    parent_id = p_new_parent_id,
    position = p_new_position,
    updated_at = now()
  where n.id = p_note_id
    and n.owner_id = v_owner
  returning n.* into v_result;

  if v_result.id is null then
    raise exception 'Note not found';
  end if;

  return v_result;
end;
$$;

revoke all on function public.notes_bootstrap(timestamptz, int) from public;
revoke all on function public.note_pull_updates(uuid, bigint, int) from public;
revoke all on function public.note_push_updates(uuid, text, jsonb) from public;
revoke all on function public.notes_move(uuid, uuid, text) from public;

grant execute on function public.notes_bootstrap(timestamptz, int) to authenticated;
grant execute on function public.note_pull_updates(uuid, bigint, int) to authenticated;
grant execute on function public.note_push_updates(uuid, text, jsonb) to authenticated;
grant execute on function public.notes_move(uuid, uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes'
    ) then
      execute 'alter publication supabase_realtime add table public.notes';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_updates'
    ) then
      execute 'alter publication supabase_realtime add table public.note_updates';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_documents'
    ) then
      execute 'alter publication supabase_realtime add table public.note_documents';
    end if;
  end if;
end
$$;
