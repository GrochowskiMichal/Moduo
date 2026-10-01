-- Profile pictures and workspace logos.
-- One public bucket so <img> can load the URL without a signed token.
-- Writes stay folder-scoped:
--   profiles/{user id}/avatar.{ext}     — that user only
--   workspaces/{workspace id}/logo.{ext} — the workspace owner only
-- Upsert from the JS client needs SELECT + INSERT + UPDATE on the object.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, type)
values (
  'avatars',
  'avatars',
  true,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[],
  'STANDARD'
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.workspaces
  add column if not exists icon text,
  add column if not exists logo_url text;

alter table public.workspaces
  drop constraint if exists workspaces_icon_len;

alter table public.workspaces
  add constraint workspaces_icon_len
  check (icon is null or char_length(icon) between 1 and 16);

comment on column public.workspaces.icon is
  'Optional emoji mark. Null when a logo image is used instead.';
comment on column public.workspaces.logo_url is
  'Public URL of the workspace logo in the avatars storage bucket.';

-- Profile pictures -----------------------------------------------------------

drop policy if exists avatars_select_profile on storage.objects;
create policy avatars_select_profile
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'profiles'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

drop policy if exists avatars_insert_profile on storage.objects;
create policy avatars_insert_profile
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'profiles'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

drop policy if exists avatars_update_profile on storage.objects;
create policy avatars_update_profile
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'profiles'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'profiles'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

drop policy if exists avatars_delete_profile on storage.objects;
create policy avatars_delete_profile
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'profiles'
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);

-- Workspace logos (owner of a live workspace) --------------------------------

drop policy if exists avatars_select_workspace_logo on storage.objects;
create policy avatars_select_workspace_logo
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(name))[2]
      and w.owner_id = (select auth.uid())
      and w.deleted_at is null
  )
);

drop policy if exists avatars_insert_workspace_logo on storage.objects;
create policy avatars_insert_workspace_logo
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(name))[2]
      and w.owner_id = (select auth.uid())
      and w.deleted_at is null
  )
);

drop policy if exists avatars_update_workspace_logo on storage.objects;
create policy avatars_update_workspace_logo
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(name))[2]
      and w.owner_id = (select auth.uid())
      and w.deleted_at is null
  )
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(name))[2]
      and w.owner_id = (select auth.uid())
      and w.deleted_at is null
  )
);

drop policy if exists avatars_delete_workspace_logo on storage.objects;
create policy avatars_delete_workspace_logo
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(name))[2]
      and w.owner_id = (select auth.uid())
  )
);
