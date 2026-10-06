-- Fix: uploading a workspace logo failed with "new row violates row-level
-- security policy" for everyone, owner included (web + desktop).
--
-- Cause: inside `exists (select 1 from public.workspaces w ...)` the bare
-- `name` column resolved to `workspaces.name`, not `storage.objects.name`, so
-- the folder check compared the workspace's own name. Qualify it explicitly.
-- Same owner-only intent as 20261001140000_avatars_bucket_workspace_mark.sql.

drop policy if exists avatars_select_workspace_logo on storage.objects;
create policy avatars_select_workspace_logo
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(storage.objects.name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(storage.objects.name))[2]
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
  and (storage.foldername(storage.objects.name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(storage.objects.name))[2]
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
  and (storage.foldername(storage.objects.name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(storage.objects.name))[2]
      and w.owner_id = (select auth.uid())
      and w.deleted_at is null
  )
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(storage.objects.name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(storage.objects.name))[2]
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
  and (storage.foldername(storage.objects.name))[1] = 'workspaces'
  and exists (
    select 1
    from public.workspaces w
    where w.id::text = (storage.foldername(storage.objects.name))[2]
      and w.owner_id = (select auth.uid())
  )
);
