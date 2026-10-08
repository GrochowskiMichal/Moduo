# Spec: Account deletion, part 2 (PRIV-2)

> Status: **Ready to execute** (planned 2026-10-07) · Owner: maciej · Builds on PRIV-1 (`delete-account` v15, [decisions/permissions.md](../docs/decisions/permissions.md) 2026-10-07) · Sharing model: [specs/permissions.md](./permissions.md) · PRIV-1 checklist: [docs/testing/t-maciej-delete-account-erasure.md](../docs/testing/t-maciej-delete-account-erasure.md)

## Scope

PRIV-1 made account deletion remove what the database cascade can't reach: the Stripe customer, profile picture and logos, booking links, integration tokens and waitlist rows. PRIV-2 finishes the job. It covers four things:

- **What the user leaves in other people's workspaces.** Today the account-deletion cascade hands the user's private buckets (and maybe notes) to those workspaces' owners. It also leaves private contacts, calendars, email records and more behind, invisible but stored.
- **Our own copy of their Stripe data.** The Stripe sync on production (1.0.32) keeps a deleted customer's full profile in `stripe.customers`.
- **A safe way to handle a privacy@ deletion request** for someone who can't sign in.
- **The words users read** in the app and in the privacy policy.

Every product call below was made by the designer on 2026-10-07.

## Product behavior & UX

### What deleting an account does in workspaces the user doesn't own
Workspaces the user owns are already deleted whole (PRIV-1 and the cascade). In everyone else's workspaces:

1. **Private items are deleted.** "Private" means no other current member of that workspace can see the item. They go with everything attached: links, comments, tags, activity entries and search labels. This covers:
   - notes, including notes published to the web that no teammate could see (their public link stops working);
   - buckets, including the user's Inbox, and the tasks in them;
   - contacts, contact groups and companies;
   - calendars and calendar sets;
   - connected calendar accounts, email accounts and email records;
   - chat DMs and private channels with nobody else in them;
   - their notification read-state;
   - API keys they created.
2. **Shared items stay** for the people they were shared with, whether shared with the whole workspace or with specific teammates. Someone has to be able to manage them, so each gets a new owner:
   - the **workspace owner**, if the owner could already see it;
   - otherwise the **teammate with the most access** to it. On a tie, whoever got access first (earliest grant, then earliest to join).
   - **Nobody gains access to anything they couldn't see before.**
   - Shared tasks that sit in the user's private Inbox or a private bucket move to the Inbox of the person who now owns them.
   - A channel the user managed alone gets a new manager by the same rule, so an announcement channel never locks.
3. **Tasks assigned to the user are unassigned.** The tasks stay.
4. **Their messages, comments and activity stay, without their name** (shown as "Deleted user"). A DM with a teammate stays with that teammate.
5. **No notifications** go to anyone, including the teammate who becomes an owner.

### Billing
- **Our copy of their Stripe customer profile and saved cards is wiped right away**, in the same run that deletes the customer at Stripe.
- **Invoices and payment records are kept** at Stripe and in our copy for the legal period (usually 5 years, Polish accounting and VAT law). The privacy policy says so (appendix). During the beta these are only free-trial records.

### In the app (Settings → Account → Danger zone)
- The copy becomes: "Permanently delete your account and your personal data. This also cancels your Moduo plan. Things you shared with others stay with them, without your name. This can't be undone."
- After a successful delete, the user is signed out and the sign-in page shows one line: **"Your account and your data were deleted."**

### Removing a member (not deleting an account)
- Their tasks in that workspace become **unassigned**. This fixes tasks freezing for everyone after a member leaves.
- Their private notes and buckets still move to the workspace owner as "From <name> (archived)". That is the existing decision for removals and is unchanged.

### Admin command for privacy@ requests (no UI)
A founder runs one command in Terminal, with the admin secret from their password manager. The exact commands are in a runbook.
- **Preview:** given an email, it prints what would be deleted (workspaces, items, files, booking links, Stripe customer…). It changes nothing.
- **Confirm:** the same command with a confirm flag runs exactly the in-app deletion for that person.
- **Sole owner of a shared workspace:** it stops, deletes nothing, and lists those workspaces with their members' emails. The founder re-runs it naming who takes over each workspace. That teammate becomes the owner, then the deletion runs.
- **Errors:**
  - a missing or wrong secret is refused;
  - an unknown email answers "No account with that email";
  - naming someone who isn't a member of that workspace is refused.

### Public wording
- The landing card ("Delete your account and everything goes with it.") **stays as is** (designer's call).
- The **privacy policy carries the details**. Approved wording is in the appendix.

## Edge cases

- **The user is in no other workspace.** The new step does nothing; the PRIV-1 behavior is unchanged.
- **Shared only with specific teammates, and the workspace owner can't see it.** Ownership goes to the teammate with the most access. The owner still can't see it.
- **Every teammate who can see an item is a Viewer.** The Viewer with the earliest access becomes the owner. Their role still caps them at view, so nobody can delete it until someone's role is raised. Rare; accepted.
- **A private note has a teammate's sub-note under it.** The sub-note belongs to its author. It moves to the top level instead of being deleted.
- **A private note has a shared sub-note the user wrote.** The sub-note stays, moved to the top level, with a new owner by the rule.
- **The user's Inbox holds a task assigned to a teammate.** The task moves to that teammate's Inbox, which is created if missing, the same way the app creates it.
- **A shared bucket holds the user's own tasks.** The bucket stays with its new owner, and those tasks are unassigned.
- **Calendars.** Every calendar the user owned is deleted. Their events already disappear with the account, so a kept calendar would only show an empty name. Integration calendars are often named after an email address.
- **Booking-created contacts** (guests) in someone else's workspace are private by default, so they are deleted.
- **Companies.** One that only deleted contacts pointed at is deleted. One still pointed at by a kept contact stays, with a new owner by the rule.
- **Chat.**
  - A DM with a teammate stays; a DM with themselves is deleted.
  - A private channel with nobody else is deleted; a private channel with others stays.
  - A channel they managed alone gets a new manager.
- **A published note.** If only the user could see it, it is deleted and its public link stops within about 30 seconds (cache). A shared, published note stays published under its new owner.
- **API keys the user created in someone else's workspace** are deleted. They already stop working when the creator is gone.
- **The database step fails halfway.** It runs in one transaction, so nothing from that step is half-done. The account remains, and a retry finishes the job (as PRIV-1).
- **Retry after a partial run** is safe: everything already handled is a no-op.
- **Stripe webhooks arriving after the wipe** can't restore the profile. Our wipe stamps the row newer than the event, and the sync rejects older events.
- **The weekly Stripe re-sync** may re-import invoices and payment records. That is accepted: they are kept for the legal period anyway.
- **A user deleted from the Supabase dashboard** (bypassing the app) still never has their private items handed to a workspace owner. Stripe, files and the rest are only erased through the app or the admin command, so the runbook says never to use the dashboard delete.
- **Admin command, the person solely owns several shared workspaces.** Every one needs a new owner named before anything happens. A partial list is refused.

## Acceptance criteria

- **AC1.** When a user deletes their account, every item of theirs in someone else's workspace that no other member could see is deleted. That covers notes, buckets and their tasks, contacts, contact groups, companies, calendars, calendar sets, connected calendar and email accounts, email records, chat DMs and private channels with nobody else in them, their notification read-state, and API keys they created.
- **AC2.** Nothing deleted under AC1 leaves a trace. No link, comment, tag, activity entry, sharing grant or search label points at it, and a published note's public link stops working.
- **AC3.** Items they shared stay for the people they were shared with. The new owner is the workspace owner if the owner could already see the item, otherwise the teammate with the most access (ties: earliest grant, then earliest to join). No member can see anything after the deletion that they couldn't see before.
- **AC4.** Shared tasks in the user's private Inbox or private buckets move to the new owner's Inbox. Tasks assigned to the user anywhere in other people's workspaces become unassigned.
- **AC5.** A channel the user managed alone gets a new manager by the AC3 rule.
- **AC6.** Their messages, comments and activity entries in other people's workspaces remain and show no name.
- **AC7.** Our copy of their Stripe customer profile and saved cards is wiped in the same deletion run and stays wiped when later Stripe events arrive. Invoices and payment records are not removed.
- **AC8.** If any step fails, the account still exists, the user sees the PRIV-1 error message, and retrying completes the deletion.
- **AC9.** When a member is removed from a workspace (not deleted), their tasks there become unassigned. If an account is deleted outside the app, its private items are never handed to a workspace owner.
- **AC10.** The Danger zone reads exactly: "Permanently delete your account and your personal data. This also cancels your Moduo plan. Things you shared with others stay with them, without your name. This can't be undone."
- **AC11.** After a successful self-service deletion, the sign-in page shows "Your account and your data were deleted."
- **AC12.** The admin command's preview, given an email, reports what would be deleted and changes nothing.
- **AC13.** The admin command with confirm runs the same deletion as the in-app button for that person (AC1–AC8).
- **AC14.** If the person solely owns a workspace with other members, the admin command stops without deleting and lists those workspaces with their members' emails. Re-run with a new owner for each, it transfers ownership and then deletes.
- **AC15.** The admin command is refused without the right secret, says "No account with that email" for an unknown email, and refuses a new owner who isn't a member of that workspace.
- **AC16.** The privacy policy on moduo.app states what is deleted and what stays (appendix wording).
- **AC17.** The two Stripe customers left by earlier deletions are deleted at Stripe, and our copy of them is wiped.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `supabase/probes/account-erasure.probe.sql` · "private items deleted" | AC1 | On a throwaway Postgres with a stub schema, a user's private note, Inbox, bucket, contact, group, company, calendar, set, accounts, email records, self-DM, notification state and API key in a teammate's workspace are all gone after the function runs. |
| same · "no traces left" | AC2 | Grants, tag links, declines, activity rows and entities (with their links and comments) for the deleted items are gone; teammates' own rows are untouched. |
| same · "shared items get the right owner" | AC3 | A workspace-shared note goes to the workspace owner. A note shared with one teammate goes to that teammate, never to the owner. On a tie, the earlier grant wins. A before/after check of `can_access` for every member shows no new access. |
| same · "tasks move or get unassigned" | AC4 | An Inbox task assigned to a teammate moves to that teammate's Inbox (created if missing); the user's tasks in a shared bucket are unassigned. |
| same · "sole-manager channel gets a manager" | AC5 | A managers-only channel managed only by the user gets the right new manager. |
| same · "messages and comments stay" | AC6 | The user's chat messages and comments on shared items still exist after the run. |
| same · "member removal unassigns, deletion never hands over" | AC9 | Removing a member unassigns their tasks there. Deleting a profile directly (dashboard path) leaves the owner without any "From … (archived)" items. |
| same · "preview changes nothing" | AC12 | Preview mode returns counts and the database is byte-for-byte unchanged. |
| same · "stripe mirror wiped and stays wiped" | AC7 | The user's `stripe.customers` and `stripe.payment_methods` rows lose all personal fields. A simulated late webhook upsert with an older timestamp doesn't restore them. Invoices are untouched. |
| `supabase/functions/_shared/account-erasure.test.ts` · new cases | AC7, AC8 | The new steps run in order (Stripe, mirror wipe, …, workspace data, …, auth last) and call the database in delete mode. A failure in either stops before the auth delete and maps to the "partly deleted" message. Retries are no-ops. |
| `supabase/functions/_shared/account-admin.test.ts` · "preview" | AC12 | A preview returns the counts and performs no writes, not even a Stripe call that changes anything. |
| same · "confirm runs the same deletion" | AC13 | Confirm calls the same `deleteAccount` flow with the resolved user. |
| same · "blocked, then transfer" | AC14 | A sole owner of shared workspaces gets 409 with workspaces and member emails. A full transfer map transfers first and then deletes; a partial map is refused. |
| same · "refusals" | AC15 | No secret gives 503 when unset and 401 when wrong; an unknown email gives 404 "No account with that email"; a non-member as new owner gives 400. |
| `src/features/settings/delete-account.test.ts` · "Danger zone copy" | AC10 | The exported Danger zone sentence equals the approved wording. |
| `src/routes/pages/auth-page.test.tsx` · "deleted notice" | AC11 | With the `deleted` flag in the URL the sign-in page shows the line; without it, it doesn't. |
| Production preview (manual, read-only) | AC1–AC7 | After the migration is applied, the preview for a real account returns sensible counts and changes nothing. |
| Manual pass · `docs/testing/<branch>.md` | AC1–AC17 | A throwaway account with shared and private items in a teammate's workspace is deleted. The teammate's view is checked before and after, along with the policy page and both Stripe customers. |

## Assumptions & technical decisions

- **The database side runs as SQL functions, not as PostgREST calls from the Edge Function.** `account_erase_workspace_data(p_user uuid, p_preview boolean DEFAULT true) RETURNS jsonb` does all of it in one transaction, which makes it atomic and fast. It sits next to the access functions it needs, and its preview mode gives the admin command a free dry run. It is SECURITY DEFINER, with EXECUTE only for `service_role`. *Rejected:* dozens of round trips from TypeScript with no atomicity.
- **Preview is the default** (`p_preview` defaults to true). Deleting needs an explicit `false`, so a mistaken call can't delete.
- **"Private" is computed with the real access function.** An item is private when no other current member `M` of the workspace has `can_access(type, id, 'view', M)`. That is the same function RLS and every op use (`20261006210000_perm_sharing.sql:105`, branches for note, bucket, task, calendar, contact_group, contact, company and event). Chat uses `chat_members`. *Rejected:* `share_member_removed`'s "no workspace grant" test and `noteIsPrivate` (`src/features/sharing/rules.ts`). Both ignore member grants and inheritance, and they already disagree with each other.
- **The new-owner rule is a helper, `account_erasure_new_owner(type, id, user)`.**
  - It returns the workspace owner if `can_access(…, 'view', owner)`.
  - Otherwise it returns the member with the highest effective level, probing `full`, `edit`, `view`, then `freebusy` through `can_access`. Ties go to the earliest `resource_grants.created_at` for that member, then the earliest `workspace_members.joined_at`.
  - The helper ensures nobody gains access, because only people who could already see the item are candidates.
  - It is used for notes (`created_by`), buckets, contacts, groups and companies (`owner_id`), and channel managers.
- **Hard delete, not soft delete.** Soft-deleted rows still hold the data, and the privacy promise is deletion. The cleanup is explicit, in this order:
  1. Remove grants on the item, then its `tag_links`, then `link_suggestion_declines`, matched on `pair_key`.
  2. Remove its `module_activity`, by entity and by links-module `payload->>'target_id'`. `notification_state` cascades.
  3. Remove its `entities`, which cascades its `entity_links` and comments.
  4. Remove `note_shares` and the legacy `exposed_notes`. Re-root children written by someone else.
  5. Delete the rows themselves: notes; then tasks before buckets (`tasks.bucket_id` is RESTRICT), and bucket ids out of `task_time_blocks`; then events before calendar accounts (`source_account_id` is SET NULL); then sets, calendars and accounts; then email refs before email accounts.

  This follows the dependency map of 2026-10-07 (FK rules taken from migrations and `src/types/supabase.ts`). The existing `*_op_*` deletes can't be reused: they need `auth.uid()` and only soft-delete.
- **Runs as the service role.** `perm_enforce_write` passes when `perm_actor_id()` is NULL (`20261006230000_perm_sharing_write_hotfix.sql:41-48`). The function also sets `share.bypass` locally, as `share_member_removed` does.
- **`share_member_removed` gets two changes in the same migration.**
  - It skips the hand-over when the departing user's profile row no longer exists. That is the account-deletion cascade, which already happened. This closes the dashboard-delete leak.
  - It unassigns the departing member's tasks in that workspace, which fixes frozen tasks after a removal.

  It is redefined with `CREATE OR REPLACE`, which keeps its grants.
- **Order inside `deleteAccount`:**
  1. check
  2. posthog (added by PRIV-3, 2026-10-08)
  3. stripe
  4. **stripe_mirror** (new)
  5. storage
  6. booking
  7. integrations
  8. contact_notes
  9. **workspace_data** (new)
  10. waitlist
  11. auth

  `workspace_data` must run before the auth delete: afterwards the user's rows can't be identified (`notes.created_by` goes NULL). It runs after PRIV-1's own deletes, so nothing it counts is double-handled.
- **The Stripe mirror wipe is a second function, `account_scrub_stripe_mirror(p_user uuid, p_preview boolean DEFAULT true)`.**
  - It finds the user's customers by `metadata->>'supabase_user_id'` or by `profiles.stripe_customer_id`.
  - It replaces `_raw_data` with a stub (`{id, object, deleted:true}` for customers; `{id, object, type}` for payment methods) and sets `_last_synced_at = now()`. On 1.0.32 every typed column is generated from `_raw_data`.
  - The sync rejects any update older than `_last_synced_at`, so the later `customer.deleted` webhook (full snapshot) can't restore the data.
  - Invoices, charges, payment intents, checkout sessions and subscriptions are kept (billing records, designer's call). The weekly re-list would re-import them anyway.
  - **Unverified:** whether Stripe's list endpoints skip deleted customers and their detached cards. Check the mirror rows after the first real deletion.
- **The admin command is a separate Edge Function, `admin-delete-account`.** It has `verify_jwt=false` and authenticates in code with an `x-moduo-admin-secret` header, compared in constant time to the `ACCOUNT_ADMIN_SECRET` function secret. It returns 503 when the secret is unset, so it is disabled by default.
  - Its logic lives in `_shared/account-admin.ts`, a plain module with injected clients, so Rstest can run it, as PRIV-1 does.
  - It finds the user by email with `admin_account_lookup(p_email text)`.
  - It transfers ownership with `admin_transfer_workspace_owner(p_workspace uuid, p_new_owner uuid)`. That mirrors `workspace_op_transfer_ownership` (`20261006200000_perm1_roles_overrides.sql:1124`) without the caller check, which can't work without a signed-in owner.
  - Both functions are `service_role` only.
  - *Rejected:* the project secret key as the credential (too much power to paste into Terminal). Also rejected: a founder JWT (hard for a non-engineer to obtain).
- **The deleted notice** is driven by a `deleted` search flag on `/auth`, validated with `validateSearch`. The Danger zone sends `navigate({ to: "/auth", search: { deleted: 1 } })` after sign-out. The copy strings live in pure modules so they can be unit-tested.
- **How SQL is verified.**
  - Locally: a throwaway Postgres 17 (Homebrew `postgresql@17` if missing) with a stub schema of only the touched tables and functions. The probe `supabase/probes/account-erasure.probe.sql` is committed so it can be re-run (`supabase/AGENTS.md`).
  - Then on production, with the designer's OK: apply, check the catalog and grants (`has_function_privilege` false for anon and authenticated), then run a read-only preview for a real account.
- **No data migration is needed.** Live counts on 2026-10-07 found no leftovers from past deletions, except the two Stripe customers (AC17) and their copy (1 invoice, 1 checkout session, kept as billing records). Nobody uses member-only sharing yet (0 member grants), across 7 users and 4 shared workspaces.
- **Review gates.** Every PRIV-2 PR touches migrations or `delete-account`, so it is Tier 2. The designer runs `/code-review ultra <PR>` and `/claude-security` before merging (AGENTS.md §Review gates).
- **Production access.** Applying migrations, deploying functions and every production query happen only with the designer's explicit OK at the time, per this work's standing instruction.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **PRIV-2a · Erase what's left in other workspaces (SQL)** | Migration with `account_erase_workspace_data` + `account_erasure_new_owner` + the `share_member_removed` changes + grants; local probe for AC1–AC6, AC9, AC12; applied to prod with OK; read-only prod preview. No caller yet, so applying it is safe on its own. | AC1–AC6, AC9, AC12 (SQL side) | PRIV-1 ✓ |
| 2 | **PRIV-2b · Wire it in, wipe the Stripe copy, in-app copy** | Migration with `account_scrub_stripe_mirror`; two new steps in `account-erasure.ts` + tests; Danger zone sentence; `/auth` deleted notice + tests; `delete-account` redeployed with OK; AC17 one-off: designer deletes the two customers in the Stripe dashboard, then the mirror is wiped with OK. | AC7, AC8, AC10, AC11, AC17 | 1 |
| 3 | **PRIV-2c · Admin command for privacy@** | Migration with `admin_account_lookup` + `admin_transfer_workspace_owner`; `admin-delete-account` + `_shared/account-admin.ts` + tests (passes `posthog: postHogEraserFromEnv(…)` to `deleteAccount`; needs the PRIV-3 PostHog secrets); runbook `docs/privacy-requests.md`; designer creates `ACCOUNT_ADMIN_SECRET`; deployed with OK; one preview run on a real account. | AC12–AC15 | 1, 2 |
| 4 | **PRIV-2d · Privacy policy wording** | `landing/privacy.html` updated with the appendix wording on the landing branch flow (Mike redeploys Vercel), plus the "Last updated" date. | AC16 | — |

## Out of scope

- Making the Supabase dashboard's delete erase Stripe, files and the rest. The admin command is the supported path, and the runbook forbids the dashboard delete.
- Stripe Redaction Jobs (designer: keep billing records for the legal period).
- Founder coupons. None were ever issued, and the Early Founders program is retired (`founders_interest` was empty).
- Notifying anyone, a grace period, or an undo.
- Changing the landing card wording (designer's call).
- Rewriting entity tokens inside other people's chat messages and note bodies, or dashboard widget settings that point at deleted buckets. They already render as a missing or "Private item" chip.
- What removing a member does with private items (the owner archive stays as decided).
- Erasing the person's PostHog analytics when the account is deleted: that is **PRIV-3** in BUILD_ORDER (built 2026-10-08). It added the `posthog` step to `deleteAccount`, right after the check, so every caller passes `posthog` (the admin command uses `postHogEraserFromEnv` and the same PostHog secrets).

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty.** Every product question was answered by the designer on 2026-10-07; every technical unknown is researched and recorded above (one unverified Stripe behavior is named, with a check after the first real deletion).
- [x] **Data model is named and Supabase-first.** New SQL functions in 3 migrations; no new tables.
- [x] **Module feature: N/A** (platform/privacy). The spine is covered through cleanup (AC2), not new wiring.
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [x] **Design constraints acknowledged.** Two copy changes inside existing components; tokens only, no new primitives.
- [x] **Manual-test surfaces identified.** Danger zone, sign-in page, a teammate's view of shared and private items before and after, the policy page, and Stripe.

**Ready to execute.** Blocks in order: PRIV-2a → PRIV-2b → PRIV-2c, and PRIV-2d any time.

## Open questions

- [ ] (none)

---

## Appendix: privacy policy wording (approved with this spec)

In `landing/privacy.html`, "09 How long we keep it":

- **Your account and workspaces**, replacing the current text:
  > As long as you have an account. When you delete it, we delete your account, your workspaces and everything only you could see, and we close your billing record at Stripe. Things you shared with people in their workspaces stay with them, and your messages and comments there stay without your name. Copies in backups expire within 30 days.
- **Invoices and payments**, a new row:
  > Stripe keeps invoices and payment records, and so do we, for as long as tax law requires, usually 5 years. During the beta these are only free-trial records.
- **Booking details**, replacing the current text:
  > As long as the host keeps them in Moduo, and never longer than the host's account.

Also bump "Last updated" to the publish date.
