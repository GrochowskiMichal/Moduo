begin;

create temp table _user_id_map on commit drop as
select id as old_id, supabase_auth_user_id::text as new_id
from public.users
where supabase_auth_user_id is not null
  and id is distinct from supabase_auth_user_id::text;

do $$
begin
  if exists (
    select 1
    from _user_id_map m
    join public.users u on u.id = m.new_id
  ) then
    raise exception 'Cannot migrate users.id: target id already exists';
  end if;
end
$$;

update public.notes n
set owner_id = m.new_id
from _user_id_map m
where n.owner_id = m.old_id;

update public.note_documents d
set owner_id = m.new_id
from _user_id_map m
where d.owner_id = m.old_id;

update public.note_updates u
set owner_id = m.new_id
from _user_id_map m
where u.owner_id = m.old_id;

update public.users u
set id = m.new_id,
    updated_at = now()
from _user_id_map m
where u.id = m.old_id;

drop function if exists public.sync_clerk_user(text, text, text, text, boolean);
drop function if exists public.delete_clerk_user(text);

alter table public.users drop constraint if exists users_supabase_auth_user_id_fkey;
drop index if exists public.users_supabase_auth_user_id_key;
alter table public.users drop column if exists supabase_auth_user_id;

commit;
