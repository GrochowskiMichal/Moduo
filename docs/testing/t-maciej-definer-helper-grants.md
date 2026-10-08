# Manual test checklist — client-callable SECURITY DEFINER helpers + "Delete forever" with sub-notes (SEC-1)

> Generated 2026-10-08 · branch `t/maciej/definer-helper-grants` · **Live-verified:** on the database, not in the app UI. All three migrations are applied to production (designer's OK for each). Before each apply, a rehearsal ran the migration's exact SQL on production inside a transaction that always rolls back. It called the real RPCs as the disposable test account (owner of "Claude Test S2"), as a random signed-in outsider, and as anon. After each apply the same checks ran against the committed state, again rolled back. No probe rows were left behind; that was checked each time. The app itself was not driven: signing in as the test account would send its password to the hosted auth server, which agents don't do. Sections 1–3 are for you.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## 1. Notes: the trash and "Delete forever"
- [ ] **Do:** create a note "Parent" and a sub-note "Child" under it, then move Parent to the trash → **Expect:** Parent and Child leave the tree and show in Trash. _(both)_
- [ ] **Do:** restore Parent → **Expect:** Parent and Child are back where they were. _(both)_
- [ ] **Do:** trash Parent again, then **Delete forever** on it → **Expect:** both are gone for good, no error. Before 2026-10-08 this failed with "You don't have access to this note." _(both)_
- [ ] **Do:** build A › B › C plus a second child A › D, trash A, Delete forever → **Expect:** all four gone, no error. _(web)_
- [ ] **Do:** a single note with no sub-notes: create, trash, Delete forever → **Expect:** gone, no error (this always worked; regression check). _(both)_
- [ ] **Do:** reload the Notes page (the 30-day trash cleanup runs on load) → **Expect:** no error toast, nothing new in the console. _(web)_
- [ ] **Do:** rename a note, drag it under another note, duplicate it, archive and unarchive it, publish and unpublish it, @-mention it from another note → **Expect:** each works as before. These ops call `notes_op__guard_note`, which clients can no longer call directly. _(both)_

## 2. Sharing still works (needs a workspace with at least 2 members)
- [ ] **Do:** create a note → **Expect:** it gets the workspace's default sharing (the other member sees it per Settings → Members and access). The note's trigger calls `share_grant_workspace`. _(web)_
- [ ] **Do:** on that note's share menu, make it private, then share it with the workspace at "Can edit" → **Expect:** both stick, no error. _(web)_
- [ ] **Do:** create a bucket, a contact and a custom calendar → **Expect:** each is created and shared per the workspace defaults (contacts stay private by default). _(web)_
- [ ] **Do:** invite someone, or accept an invite into a workspace → **Expect:** the join completes and "share existing" behaves as before (`share_member_count`). _(web)_
- [ ] **Do:** in a Duo/Team workspace, post a chat message and create a channel → **Expect:** both work (`chat_has_cap`). _(web)_
- [ ] **Do:** open an item's activity and comments, and its links → **Expect:** they load as before (the policies behind them use `perm_can_see_entity`). _(both)_

## 3. Direct calls are refused (optional, terminal)
Uses the public key from `.env.local` (`PUBLIC_SUPABASE_PUBLISHABLE_KEY`). The ids are zeros, so nothing could change even if a call got through.
- [ ] **Do:** call the sharing helper signed out:
  ```bash
  curl -s -X POST "https://wtoonrvuqumihpkbvwvs.supabase.co/rest/v1/rpc/share_grant_workspace" -H "apikey: $PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H "Content-Type: application/json" -d '{"p_workspace_id":"00000000-0000-0000-0000-000000000000","p_type":"note","p_id":"00000000-0000-0000-0000-000000000000","p_level":"full"}'
  ```
  → **Expect:** `"code":"42501"`, `permission denied for function share_grant_workspace`. Before 2026-10-08 the call went through.
- The notes helpers were never open to anon, only to signed-in users, so this signed-out check can't show their fix; §4's first query and the rehearsals (as a signed-in owner and outsider) cover them.

## 4. Database (read-only; production queries need the designer's OK)
- [x] **Do:** check who can run the seven functions:
  ```sql
  select f.fn,
         has_function_privilege('anon', ('public.' || f.fn)::regprocedure, 'EXECUTE') as anon,
         has_function_privilege('authenticated', ('public.' || f.fn)::regprocedure, 'EXECUTE') as authenticated,
         has_function_privilege('service_role', ('public.' || f.fn)::regprocedure, 'EXECUTE') as service_role
  from (values ('notes__purge_ids(uuid,uuid[])'), ('notes__subtree_ids(uuid,uuid)'), ('notes_op__guard_note(uuid,uuid,boolean)'),
               ('share_grant_workspace(uuid,text,uuid,text)'), ('share_member_count(uuid)'),
               ('chat_has_cap(uuid,uuid,text)'), ('perm_can_see_entity(uuid,text,uuid)')) as f(fn);
  ```
  → **Expect:** anon `false` everywhere; authenticated `true` only for `chat_has_cap` and `perm_can_see_entity`; service_role `true` everywhere. **2026-10-08 result:** exactly that.
- [x] **Do:** `bun run db:reconcile`, paste query 4 into `execute_sql` → **Expect:** no rows. **2026-10-08 result:** no rows. Before the fixes it would have listed seven functions.
- [x] **Do:** `list_migrations` → **Expect:** `revoke_notes_internal_helpers` (20261007223443), `notes_purge_leaves_first` (20261007231900), `revoke_sharing_helper_grants` (20261008002050), matching the three files.
- [x] **Do:** compare the repo's newest bodies with prod (query 2 of `db:reconcile`, or just these four) → **Expect:** no drift for `notes__purge_ids`, `notes__subtree_ids`, `notes_op__guard_note`, `share_grant_workspace`. **2026-10-08 result:** all four match.

## Known gaps / not-yet-testable
- The app UI wasn't driven (see the note at the top). The rehearsals called the same RPCs the app calls, as a signed-in owner, outsider and anon. What they can't show is how the UI handles the results.
- The sharing insert path only runs in workspaces with 2+ members, and the test workspace has one. The rehearsal did run the trigger that calls `share_grant_workspace`, and that call works for a definer function whatever the member count. But the first real 2+ member insert after the change is §2's.
- Two legacy shapes only exist in the rehearsal, because the app can't make them: a live sub-note under a trashed parent (kept, moved to the top level) and a parent cycle (both purged). Prod had neither.
- `notes__purge_ids` was callable by any signed-in user from 2026-07-04 to 2026-10-06 and leaves no activity row. API logs only go back 7 days, so use in July–September can't be ruled out (it needed the workspace id and the trashed note ids).
- Found and **not** fixed (see `specs/BUILD_ORDER.md` SEC-1): OPS-2 group 3; `can_access` losing the workspace when an ancestor row is gone; `booking_host_respond` un-pausing a fully-accepted collective link by id; `chat_has_cap` answering any signed-in user about another member.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
