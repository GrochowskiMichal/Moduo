# Manual test checklist — PRIV-2a: what a deleted account leaves in other people's workspaces

> Generated 2026-10-08 · branch `t/maciej/priv-2a-erase-workspace-data` · spec [specs/privacy-account-erasure.md](../../specs/privacy-account-erasure.md) block 1 · **Live-verified:** §1 done on production on 2026-10-08 with the designer's OK (results inline). §2 still needs a person in the app. **Verified locally:** the probe passes on Postgres 17 (§0). Each of 30 deliberate breaks of the migration makes it fail. A validator pass found one MAJOR issue (a NULL preview flag deleted) and three MINOR ones; all are fixed and covered by the probe. `bun run typecheck`, `lint:tw`, `lint:css` and every test pass; `lint:js` fails only on errors already in landing HTML.
> Nothing calls `account_erase_workspace_data` yet; PRIV-2b wires it into `delete-account`. Applying the migration changes only three existing behaviours:
> - a removed member's tasks become unassigned;
> - tasks still assigned to people removed earlier are unassigned, once (they couldn't be saved);
> - an owner can remove a member who has private notes (that removal fails on production today).
> Run top to bottom and tick as you go. Each item is a step → what you should see → where.

## 0. Local probe (any time, no production)
- [x] **Do:** on a throwaway Postgres 17 (Homebrew `postgresql@17`), make an empty database and run the stub, the migration and the probe:
  ```bash
  createdb -h /tmp -p 54329 -U postgres erasure_probe
  psql -h /tmp -p 54329 -U postgres -d erasure_probe -v ON_ERROR_STOP=1 -q \
    -f supabase/probes/account-erasure.stub.sql \
    -f supabase/migrations/20261008013000_account_erase_workspace_data.sql \
    -f supabase/probes/account-erasure.probe.sql
  ```
  → **Expect:** one `PASS` line each for the one-time fix (AC9), grants, AC12, AC1, AC2, AC3 (twice), AC4, AC5, AC6, the retry, the ownership guard, AC9 (twice) and the account cascade, then `PASS: all`. **2026-10-08:** all pass.

## 1. Production (designer's OK first)
- [x] **Do (read-only, before applying):** list what fires when an invitation row is deleted, since the function deletes accepted ones:
  ```sql
  select tgname, pg_get_triggerdef(oid) from pg_trigger
  where tgrelid = 'public.workspace_invites'::regclass and not tgisinternal;
  ```
  → **Expect:** nothing that runs on DELETE (an insert-time invite email trigger is fine). **2026-10-08:** `on_workspace_invite_inserted` (AFTER INSERT) and `perm_invites_validate` (BEFORE INSERT OR UPDATE) only.
- [x] **Do (read-only):** count the tasks the one-time fix will unassign (assigned to someone who is neither a member nor the owner of that workspace):
  ```sql
  select count(*) from public.tasks t
  where t.owner_id is not null
    and not exists (select 1 from public.workspace_members m
                    where m.workspace_id = t.workspace_id and m.user_id = t.owner_id)
    and not exists (select 1 from public.workspaces w
                    where w.id = t.workspace_id and w.owner_id = t.owner_id);
  ```
  → **Expect:** a small number (only removals since roles shipped on 2026-10-06 can cause it). After applying, the same query returns 0. **2026-10-08:** 0 before, 0 after.
- [x] **Do:** apply the migration file in one transaction, adding its `supabase_migrations.schema_migrations` row (version `20261008013000`, name `account_erase_workspace_data`) in the same transaction. → **Expect:** no error; the row is there. **2026-10-08:** applied with `supabase db query --linked --project-ref wtoonrvuqumihpkbvwvs -f <file>`, where the file is the migration wrapped in `BEGIN; … COMMIT;` plus the row insert (statements = the file). Dry-run first on a local copy of the stub. Row present.
- [x] **Do:** check the catalog:
  ```sql
  select p.proname, p.prosecdef,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
         has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
         position('share.bypass' in p.prosrc) > 0 as honours_bypass,
         position('FROM public.profiles WHERE id = OLD.user_id' in p.prosrc) > 0 as checks_profile
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('account_erasure_rank', 'account_erasure_new_owner', 'account_erasure_inbox',
                      'account_erase_workspace_data', 'share_member_removed', 'notes_share_fields_owner_only');
  ```
  → **Expect:**
  - The four `account_eras*` functions are `prosecdef` true, with anon false, authenticated false and service_role true.
  - `notes_share_fields_owner_only` honours the bypass.
  - `share_member_removed` checks the profile.
  - **2026-10-08:** as expected; both triggers still attached; every function has `search_path=public`.
- [x] **Do:** preview the erasure for a real account. Preview is the default and writes nothing:
  ```sql
  select public.account_erase_workspace_data('<user id>');
  ```
  → **Expect:** a JSON object with `"preview": true` and plausible counts for that person's items in workspaces they don't own. Run it twice and the result is the same. Passing `NULL` as the second argument previews too; only `false` deletes. **2026-10-08, the designer's account:** `"preview": true`, every count 0 except `notification_state_deleted: 1`, identical on both runs. Expected: the account owns both its workspaces and is a member of no one else's. A teammate's account would show real counts; PRIV-2b's throwaway account covers that.

## 2. In the app, after §1
- [ ] **Do:** as a workspace owner, remove a member who has a private note there and a task assigned to them. → **Expect:**
  - The removal succeeds. Before this change it failed with "only the note owner can change sharing or ownership".
  - The task is unassigned.
  - The owner sees the note as "From <name> (archived) …".
  - **Where:** Settings → Members and access; Tasks; Notes.
- [ ] Deleting an account end to end is PRIV-2b's checklist. It runs once this function is wired into `delete-account`.
