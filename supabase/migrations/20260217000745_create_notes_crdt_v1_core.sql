create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  parent_id uuid references public.notes(id) on delete cascade,
  title text not null default 'Untitled',
  icon text,
  position text not null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.note_documents (
  note_id uuid primary key references public.notes(id) on delete cascade,
  owner_id text not null,
  snapshot_b64 text not null default '',
  last_compacted_update_id bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.note_updates (
  id bigint generated always as identity primary key,
  note_id uuid not null references public.notes(id) on delete cascade,
  owner_id text not null,
  client_id text not null,
  client_seq bigint not null,
  update_b64 text not null,
  created_at timestamptz not null default now(),
  unique (note_id, client_id, client_seq)
);

create index if not exists notes_owner_parent_position_active_idx
  on public.notes (owner_id, parent_id, position)
  where deleted_at is null;

create index if not exists notes_owner_updated_active_idx
  on public.notes (owner_id, updated_at desc)
  where deleted_at is null;

create index if not exists note_updates_note_id_id_idx
  on public.note_updates (note_id, id);

create index if not exists note_updates_owner_id_id_idx
  on public.note_updates (owner_id, id);

create index if not exists note_documents_owner_updated_idx
  on public.note_documents (owner_id, updated_at desc);

create or replace function public.prevent_notes_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_has_cycle boolean;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A note cannot be its own parent';
  end if;

  with recursive parent_chain as (
    select n.id, n.parent_id
    from public.notes n
    where n.id = new.parent_id
    union all
    select n.id, n.parent_id
    from public.notes n
    join parent_chain p on p.parent_id = n.id
  )
  select exists(select 1 from parent_chain where id = new.id)
  into v_has_cycle;

  if v_has_cycle then
    raise exception 'Cycle detected in notes tree';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notes_prevent_cycle on public.notes;
create trigger trg_notes_prevent_cycle
before insert or update of parent_id on public.notes
for each row
execute function public.prevent_notes_cycle();

drop trigger if exists trg_notes_updated_at on public.notes;
create trigger trg_notes_updated_at
before update on public.notes
for each row
execute function public.set_updated_at();

drop trigger if exists trg_note_documents_updated_at on public.note_documents;
create trigger trg_note_documents_updated_at
before update on public.note_documents
for each row
execute function public.set_updated_at();

alter table public.notes enable row level security;
alter table public.notes force row level security;
alter table public.note_documents enable row level security;
alter table public.note_documents force row level security;
alter table public.note_updates enable row level security;
alter table public.note_updates force row level security;

drop policy if exists notes_select_own on public.notes;
create policy notes_select_own on public.notes
for select to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists notes_insert_own on public.notes;
create policy notes_insert_own on public.notes
for insert to authenticated
with check (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists notes_update_own on public.notes;
create policy notes_update_own on public.notes
for update to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'))
with check (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists notes_delete_own on public.notes;
create policy notes_delete_own on public.notes
for delete to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists note_documents_select_own on public.note_documents;
create policy note_documents_select_own on public.note_documents
for select to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists note_documents_insert_own on public.note_documents;
create policy note_documents_insert_own on public.note_documents
for insert to authenticated
with check (
  owner_id = (select auth.jwt() ->> 'sub')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id and n.owner_id = owner_id
  )
);

drop policy if exists note_documents_update_own on public.note_documents;
create policy note_documents_update_own on public.note_documents
for update to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'))
with check (
  owner_id = (select auth.jwt() ->> 'sub')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id and n.owner_id = owner_id
  )
);

drop policy if exists note_documents_delete_own on public.note_documents;
create policy note_documents_delete_own on public.note_documents
for delete to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists note_updates_select_own on public.note_updates;
create policy note_updates_select_own on public.note_updates
for select to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists note_updates_insert_own on public.note_updates;
create policy note_updates_insert_own on public.note_updates
for insert to authenticated
with check (
  owner_id = (select auth.jwt() ->> 'sub')
  and exists (
    select 1
    from public.notes n
    where n.id = note_id and n.owner_id = owner_id
  )
);

drop policy if exists note_updates_delete_own on public.note_updates;
create policy note_updates_delete_own on public.note_updates
for delete to authenticated
using (owner_id = (select auth.jwt() ->> 'sub'));

