# Manual test checklist — OPS-2 (prod-schema reconciliation + grants hardening)

> Generated 2026-07-29 · branch `claude/strange-ramanujan-f82364` · **Live-verified: yes, on prod** — every DB claim below was proven with authed, rolled-back probes against `wtoonrvuqumihpkbvwvs` (org "Moduo", ref verified before any write). Prod was left byte-clean each time.
> Findings + full inventory: [docs/reviews/ops-2-schema-reconciliation.md](../reviews/ops-2-schema-reconciliation.md).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Already verified in-session — do NOT re-do

- _(verified)_ **Reconciliation is clean.** All 193 objects declared across the 42 migration files exist in prod (110 functions · 22 tables · 29 columns · 4 triggers · 27 policies · 1 view), and **0 of 110 function bodies drift**. A new query 3 for overload ambiguity also returns none.
- _(verified)_ **The grants migration is applied and correct.** `has_function_privilege('anon', …)` is now **false** for the six `*_op__guard*` helpers and for `accept_workspace_invite`.
- _(verified)_ **No regression from the revoke** (authed, rolled back): `email_op_follow_up`, `contacts_op_set_details` and `calendar_op_event_create` all still succeed; a direct client call to `calendar_op__guard` is correctly denied `42501`.
- _(verified)_ **The invite hole is closed.** Before the fix, an *unauthenticated* caller using an invite already marked `revoked` drove `workspace_members` 0 → 1 at role `admin`. After the fix, `anon` cannot execute the function at all.
- _(verified)_ Prod byte-clean after every probe: `workspace_members` back to 15, no probe events/contacts/refs, no membership added.

## Email · Contacts · Calendar — the revoke must not have broken writes

The grants migration revoked `anon` **and** `authenticated` on each module's internal guard. Every op calls its guard internally, so a mistake here breaks *all* writes in that module. Probed at the DB level; this is the UI confirmation.

- [ ] **Do:** In Email, set a follow-up on a thread, then clear it. → **Expect:** both succeed, no error toast. _(desktop)_
- [ ] **Do:** In Email, snooze a thread and unsnooze it. → **Expect:** both succeed. _(desktop)_
- [ ] **Do:** In Contacts, edit a contact's title/company and save; change its status. → **Expect:** saves, no error. _(both)_
- [ ] **Do:** In Calendar, draw-to-create an event, move it, then delete it. → **Expect:** all three succeed. _(both)_
- [ ] **Do:** Convert an email to a task, then Undo. → **Expect:** task, links **and** the email ref all disappear (this is OPS-1's `email_op_ref_remove`, now live). _(desktop)_

## Workspace invites — unchanged behaviour, minus the hole

- [ ] **Do:** Invite someone to a workspace, then accept via the `/join?invite=<token>` link. → **Expect:** the invite loop still works end-to-end. This is DF-24's **token** flow and does not touch the revoked function. _(web)_
- [ ] **Do:** Revoke a pending invite, then try the old link. → **Expect:** rejected. _(web)_

## The reconciliation tool

- [ ] **Do:** `bun run db:reconcile` → **Expect:** a header listing what is **not** checked, then three SQL queries. _(terminal)_
- [ ] **Do:** Paste each query into the Supabase MCP `execute_sql`. → **Expect:** all three return **empty**. Read-only — safe against prod. _(terminal)_
- [ ] **Do:** `bun run test -- src/lib/db-reconcile-core.test.ts` → **Expect:** 11 passed. _(terminal)_

## Edge cases

- [ ] **Do:** Sign out completely, then load the app / a public note page `/p/<token>`. → **Expect:** normal behaviour, no "permission denied for function" anywhere. _(web)_ — the three anon-callable RLS policy helpers were **deliberately left alone** precisely so this keeps working; if it breaks, that decision was wrong.
- [ ] **Do:** As a workspace member with view-only Email permission, try to snooze a thread. → **Expect:** the same permission error as before (the guard still raises; only *who may call it directly* changed). _(desktop)_

## Migrations / data

- [ ] **Do:** Confirm `20260729140000_ops2_grants_hardening` is applied — `select * from supabase_migrations.schema_migrations where name = 'ops2_grants_hardening'`. → **Expect:** one row. _(cloud)_
- [ ] **Do:** Re-assert the fix — `select has_function_privilege('anon','public.accept_workspace_invite(uuid)','EXECUTE')`. → **Expect:** `false`. _(cloud)_
- [ ] **Do:** `ls supabase/migrations | cut -d_ -f1 | sort | uniq -d` → **Expect:** no output (OPS-1's guarantee still holds with the new file). _(terminal)_

## Known gaps / not-yet-testable

- **The repo still cannot bootstrap a database.** 73 applied migration versions vs 42 files; 22 of prod's 44 tables are created by no migration. `supabase db reset` fails outright — untestable by design until a baseline migration is captured. **Needs your call** ([inventory §4](../reviews/ops-2-schema-reconciliation.md)).
- **The reconciliation does not check grants, indexes, function signatures, base-table columns or policy definitions** — see [§1.1](../reviews/ops-2-schema-reconciliation.md). The grants hole this block found is exactly the class a re-run will *not* catch; those were audited with standalone queries kept in the inventory.
- **Three functions remain anon-callable on purpose** — `tasks_module_can_access_workspace`, `profile_plan_tier_text`, `workspaces_owned_count_for_user`. An anon probe read real values (`'pro'`, `1`) for a supplied user uuid: a minor unauthenticated info disclosure. Not revoked because 22 RLS policies for role `public` call them; scoping those `TO authenticated` first is its own block.
- **`accept_workspace_invite` is revoked, not dropped.** Dropping it is the follow-up once a release confirms nothing regressed.
- **12 dead-schema candidates** listed in the inventory §5 are untouched — dropping prod tables needs its own block. `founders_interest` was on that list and is **live**; grep before dropping anything.
