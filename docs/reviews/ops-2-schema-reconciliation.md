# OPS-2 — prod-schema ↔ migration-file reconciliation

> Run 2026-07-29 · branch `claude/strange-ramanujan-f82364` · project `wtoonrvuqumihpkbvwvs` / org "Moduo" (verified before any write).
> Method: `bun run db:reconcile` ([scripts/db-reconcile.ts](../../scripts/db-reconcile.ts)) emits two read-only queries; each returns **only** mismatches. Re-run it any time — that is the "don't let this drift again" answer.

## Headline

**The schema is in sync. The repo is not a bootstrap.**

Structurally prod matches the migration files exactly — but the migration files describe only about half the database, so `supabase db reset` cannot rebuild it. That is a much larger hole than the timestamp collisions OPS-1 fixed, and it is the finding that should drive the next decision.

## 1. Objects declared in migrations vs prod — **clean**

193 declared objects across 42 migration files, all present in prod:

| Kind | Declared | Missing from prod |
| --- | --- | --- |
| functions | 110 | **0** |
| tables | 22 | **0** |
| columns (via `ADD COLUMN`) | 29 | **0** |
| triggers | 4 | **0** |
| policies | 27 | **0** |
| views | 1 | **0** |

## 2. Function body drift — **zero semantic drift**

This is the check that would have caught EM-6, where `spine_activity_targets_me` *existed* (so every existence check passed) while its body was the stale one-branch version for ~3 weeks.

A first pass flagged **19 of 110** functions. All 19 turned out to be **formatting**, not drift: prod stores `('edit','admin')` and `SET x=now()` where the repo files say `('edit', 'admin')` and `SET x = now()` — several modules (email, contacts v2, workspace roles) were applied from a compacted copy of their migration. After normalizing spaces around `( ) , ; =`, **0 functions differ semantically**.

Recorded because it is a trap for the next person: a naive text hash reports 19 false positives and buries the one that matters. `db-reconcile.ts` bakes the normalization in.

**12 functions exist in prod that no migration file creates** — `accept_workspace_invite`, `handle_new_user`, `handle_new_workspace`, `note_share_workspace_matches_note`, `notes_list_unmaterialized`, `notes_op_seed_doc`, `notes_share_fields_owner_only`, `sync_profile_from_stripe_subscription`, `trigger_send_workspace_invite`, `user_can_manage_workspace_members`, `user_is_workspace_member`, `user_is_workspace_owner`. All predate the migration-file era (see §4).

## 3. Grants audit

**15 SECURITY DEFINER functions in `public` were EXECUTE-able by `anon`.** Root cause for the module ops: their REVOKE blocks say `FROM PUBLIC` and `FROM authenticated` but **never `FROM anon`** — and Supabase's default privileges grant `anon` EXECUTE independently of `PUBLIC`, so revoking PUBLIC does not revoke anon. CT-5's grant loop gets this right; the per-module blocks in email/contacts/calendar do not.

**Fixed** by [`20260729140000_ops2_grants_hardening.sql`](../../supabase/migrations/20260729140000_ops2_grants_hardening.sql), applied to prod 2026-07-29:

- **6 internal op guards** — `calendar_op__guard`, `calendar_op__guard_event`, `contacts_op__guard`, `contacts_op__guard_contact`, `email_op__guard`, `email_op__guard_ref`. `authenticated` was already revoked, so no client path called them; internal callers are SECURITY DEFINER and run as the owner, unaffected. Not a live leak — an anon probe showed `email_op__guard_ref` raising "You don't have edit access to Email in this workspace." rather than returning a row — but a single `IF … RAISE` inside a definer function was the only thing between an anonymous caller and an `email_refs` row. Exactly the masking posture gotchas §Supabase warns about.
- **`accept_workspace_invite(uuid)`** — the real one, and it was **exploitable, not just untidy**. SECURITY DEFINER, owned by `postgres`, anon-EXECUTE-able, and it **never reads `auth.uid()`**: it looks the invite up by id, resolves the invitee by *email* against `auth.users`, and `INSERT`s into `workspace_members` with the invite's role and permissions — ignoring invite status and expiry — then returns `{user_id, workspace_id}`.

  **Demonstrated end-to-end** in a rolled-back transaction: with the caller unauthenticated (`{"role":"anon"}`, no `sub`) and the invite explicitly in **`status='revoked'`**, `workspace_members` for the target pair went **0 → 1** and the granted role was **`admin`**. So an unauthenticated request holding an invite UUID could add the invited account to a workspace at the invite's privilege level, using an invite the workspace owner had already revoked. Prod currently holds **7 non-revoked invites**, which were live targets. Mitigating factor: invite ids are v4 UUIDs, so this needs a leaked/forwarded id rather than guessing — but ids travel in invite emails and links, and nothing expired them.

  It predates the migration files and DF-24 replaced the flow with token-based `/join?invite=<token>`; nothing in `src/`, `supabase/functions/` or `src-tauri/` calls it (the only hit is generated types). Revoked from both client roles, and re-verified after: `has_function_privilege('anon', …) = false`. **Dropping it is the follow-up** once a release confirms nothing regressed.

**Deliberately NOT revoked — needs its own block:**

`tasks_module_can_access_workspace(uuid)`, `profile_plan_tier_text(uuid)`, `workspaces_owned_count_for_user(uuid)` are also anon-callable, and an anon probe returned **real values** (`'pro'`, `1`) for a supplied user uuid — a genuine, if minor, unauthenticated information disclosure. They are not revoked because **22 RLS policies call them** (every `*_workspace_read` / `*_workspace_access` policy plus the three billing gates) and **all 22 are defined for role `public`**, which includes `anon`. Revoking EXECUTE would turn an anonymous query against those tables into `permission denied for function` instead of an empty result. The fix is to scope those policies `TO authenticated` first, then revoke — a behavioural change to 22 policies.

**Clean:** every SECURITY DEFINER function pins `search_path` (0 exceptions). The 5 remaining anon-executable functions are trigger functions (`pronargs = 0`), which PostgREST cannot call — the grant is inert.

**RLS:** no table has RLS disabled. Two have RLS enabled with **zero policies** — `founders_interest`, `user_integrations` — i.e. fully locked to client roles. Intentional or dead; both are legacy (§4).

**Regression-checked after the revoke** (authed, rolled back): `email_op_follow_up`, `contacts_op_set_details` and `calendar_op_event_create` all still succeed, and a direct client call to `calendar_op__guard` is now correctly denied (42501). Prod left byte-clean.

## 4. The real gap — the repo cannot bootstrap a database

Prod has **73** applied migration versions (3 of them applied by this session); the repo has **42** files — and the mapping isn't 1:1 even where it exists (`contacts_v2` is one file but three applies). **No file exists** for anything applied before `create_tasks_module` (26 versions — the whole profiles/workspaces/notes/CRM/billing foundation), nor for `df24_workspace_remove_member_owner_id_guard`, `workspace_roles_transfer_hardening` or `notification_dismiss_grants` (later hardening applies that were never written back).

Consequence: **22 prod tables exist that no migration file creates**, including the foundations —

`profiles` · `workspaces` · `workspace_members` · `workspace_invites` · `notes` · `note_shares` · `calendar_events` · `dashboard_layouts` · `panel_layouts` · `subscription_events`

…plus legacy/likely-dead: `exposed_notes`, `exposed_slot_links`, `slot_bookings`, `slot_conflict_windows`, `tasks_items`, `tasks_projects`, `tasks_states`, `tasks_comments`, `workspace_notifications`, `user_integrations`, `waitlist`, `founders_interest`.

So a fresh `supabase db reset` does not merely apply migrations in an ambiguous order — **most of them would fail outright**, because policies and foreign keys reference `notes`, `workspaces`, `workspace_members` and `calendar_events` that were never created. There is no working local-database story today, and no staging environment can be stood up from this repo.

This reframes OPS-1's timestamp fix: determinism was worth having, but it was not what stood between the team and a fresh database.

**Recommended follow-up (needs a designer call, not smuggled into this block):** a `00000000000000_baseline.sql` captured from prod's current schema, with the existing files kept as the post-baseline history. That makes `db reset` work, gives local/staging/preview branches, and turns `db-reconcile` from a manual audit into something CI can run.

## 5. Dead-schema candidates (for a later CLEAN- block)

`exposed_notes`, `exposed_slot_links`, `slot_bookings`, `slot_conflict_windows` (CLEAN-1 already removed the slot-booking ingestion code — the tables outlived it), `tasks_items`, `tasks_projects`, `tasks_states`, `tasks_comments` (superseded by the `tasks` module), `waitlist`, `founders_interest`, `user_integrations`, `workspace_notifications`. Not touched here — dropping prod tables needs its own block and an explicit call.
