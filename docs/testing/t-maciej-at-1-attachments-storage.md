# Manual test checklist — AT-1 attachments storage, limits, trash

> Generated 2026-10-08 · branch `t/maciej/at-1-attachments-storage` · **Live-verified:** partial. The SQL ran end to end on a local Postgres 17 replica of production's tasks schema (`supabase/probes/attachments.probe.sql`, every check passes). AT-1 has no upload UI (that's AT-2), so the app-side checks below are the export, the notification toggle and the account deletion; the rest is SQL and the purge function.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server: the migration (`20261008210500_attachments_storage.sql`)
- [ ] **Do:** after it's applied, `select id, public, file_size_limit, type from storage.buckets where id = 'attachments';` → **Expect:** one row, `public = false`, `524288000`, `STANDARD` _(SQL editor)_
- [ ] **Do:** `select has_function_privilege('anon','public.attachments_op_begin(uuid, text, uuid, text, text, bigint, text, integer, integer)','EXECUTE'), has_function_privilege('authenticated','public.storage__limits_for_owner(uuid)','EXECUTE'), has_function_privilege('authenticated','public.tasks__purge_expired(integer)','EXECUTE');` → **Expect:** `f f f` _(SQL editor)_
- [ ] **Do:** `bun run db:reconcile` → **Expect:** no client-callable `*__*` helpers listed for the new functions _(terminal)_
- [ ] **Do:** `select tgname from pg_trigger where tgrelid = 'storage.objects'::regclass and not tgisinternal;` → **Expect:** `attachments_guard_object` next to Supabase's own two _(SQL editor)_
- [ ] **Do:** delete a task in the app, then `select deleted_at from tasks where id = '<its id>';` → **Expect:** the server's time of the delete _(web + SQL editor)_
- [ ] **Do:** replay the replica probe (command in the header of `supabase/probes/attachments.probe.sql`) → **Expect:** ends with `PASS: all` _(terminal, local Postgres 17)_

## The purge function (`purge-deleted`)
- [ ] **Do:** POST `{"dry_run": true}` to `/functions/v1/purge-deleted` with header `x-purge-deleted-secret` → **Expect:** 200 with `preview` counts; on 2026-10-08 production had 11 tasks trashed over 30 days, nothing else _(curl)_
- [ ] **Do:** the same without the header, and with a wrong one → **Expect:** 401 both times; nothing deleted _(curl)_
- [ ] **Do:** after the schedule migration (`20261008210600`): `select jobname, schedule from cron.job where jobname = 'purge-deleted';` → **Expect:** `23 4 * * *` _(SQL editor)_
- [ ] **Do:** the morning after the first run, check the function's logs → **Expect:** one `{"purge": …}` line with the counts; the 11 old tasks are gone from `tasks` _(Supabase dashboard → Edge Functions → logs)_

## Export (AT1-8)
- [ ] **Do:** Settings → Advanced → Export workspace, open the zip → **Expect:** `attachments.json` with `about`, `count`, `files` (empty until AT-2 adds uploads), and `_manifest.json` lists `attachments: "ok"` _(web + desktop)_
- [ ] **Do:** the same before the migration is applied → **Expect:** `attachments.json` with `count: 0` (no error file) _(web)_

## Notifications
- [ ] **Do:** Settings → Preferences → Notifications → **Expect:** a sixth toggle "Storage almost full" ("When files take your workspaces past 80% and 95% of your storage. Owners only."), on by default _(web + desktop)_

## Account deletion
- [ ] **Do:** with a disposable fixture account (docs/gotchas/spine.md §Live-verifying an Edge Function), delete it from the Danger zone → **Expect:** deletion succeeds; before AT-1's migration too (no attachments bucket yet) _(web, after `delete-account` is redeployed)_

## Edge cases (proven on the replica)
- [ ] Viewer can't add or delete files; an outsider gets "not found"; a task in the trash takes no files.
- [ ] Over the per-file limit, or past the pool (pending and unfinished uploads included), begin is refused before any bytes move.
- [ ] A size that differs from the declared one fails at finalize and still holds its stored bytes until the purge.
- [ ] Deleting a file or its task frees the space at once; restoring always works, even over the limit; a task restore brings back its own batch only.
- [ ] Ownership transfer moves the pool; 80% and 95% notify the owner once each and re-arm under 75%.
- [ ] Once finalized, a file's bytes can't be replaced or moved by any role (the `storage.objects` guard trigger); nothing lands on a path no pending row names.
- [ ] Deleting a task or bucket is stamped with the server's time, whatever the device sends; past 30 days nothing can be restored.

## Known gaps / not-yet-testable
- Uploads from the app (AT-2), the 📎 mark and Settings → Storage (AT-3): not built yet.
- The storage alert has no click-through yet (AT-3 adds Settings → Storage).
- Real uploads above 50 MB fail at Storage until the project's global upload limit is raised (needs Supabase Pro).
