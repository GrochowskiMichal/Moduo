# Manual test checklist — TX-4 invite-only gate + waitlist invites

> Generated 2026-10-10 · branch `t/maciej/tx-4-invite-only-gate` · **Live-verified:** partial. The migration ran on the local stack (56 database checks, `supabase/probes/invite-gate.probe.sql`, also run with every new function owned by the non-superuser `postgres` role, as on prod), and a real Auth server (GoTrue v2.197.0, a throwaway container beside the local stack with the hook switched on) was driven through every allow source and the full code sign-in. Nothing is on prod yet: the worker deploy, the migration and the dashboard steps wait for Maciej's OK (docs/email-runbook.md §TX-4).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Done in the session (agent)

- [x] **Do:** `bun run verify` → **Expect:** green. _(B1 template copy, payload parsing, same email twice, worker can send the kind; invite-only error mapping; contract vocabularies + drift gates for the new CHECKs)_
- [x] **Do:** the probe on the local stack (one transaction, rolled back):
  ```bash
  psql "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -q -f supabase/probes/invite-gate.probe.sql
  ```
  → **Expect:** 56 PASS lines and `ALL PASSED`. _(AC20 hook cases incl. case/space, expired/revoked/accepted invites, founders, grants; AC21 B1 once per invite, invite_next oldest-first with skips and the 50 cap, invite_email/resend outcomes; AC22 row deleted at sign-up, build-updates request kept as pending, gone with the account; AC23 12-month purge + job)_
- [x] **Real Auth, hook on** (throwaway GoTrue on port 59999, same database; `POST /otp` with `create_user: true`, as the new client sends):
  - uninvited address → `403 {"error_code":"unknown","msg":"invite_only"}`, no user created
  - pending (not invited) waitlist row → the same refusal
  - invited waitlist row → `200`, user created, its waitlist row deleted, its build-updates request in `email_subscriptions` (`pending`, `waitlist`)
  - invited row → code from the email → `POST /verify type=email` → `200`, address confirmed (the app's `verifyOtp` path)
  - existing user → `200` (the hook isn't involved)
  - pending unexpired workspace invite → `200`; expired one → `403 invite_only`
  - founder address → `200`
  - admin `POST /invite` for an uninvited address → `403 invite_only`; admin `POST /admin/users` (the dashboard's "Add user → Create new user") → created: **that path skips the hook**
  - after the validator's review: a sign-up through Auth's password endpoint for an invited address → `200`, but the stored password is empty; the owner then signs in with their code → confirmed; a password login with the sign-up's password → `400 invalid_credentials`. The seeded local password account still signs in with its password (existing accounts untouched).
  - All probe users, rows and the throwaway container were removed afterwards. The migration stays applied on the local stack (`bun run local:reset` rebuilds it).

## Prod, after Maciej's OK (runbook §TX-4)

- [ ] **Do:** step 1, deploy `email-worker` → **Expect:** `bun run functions:reconcile` clean; the function's version goes up by one.
- [ ] **Do:** step 2, apply the migration, run its two checks → **Expect:** `invite_only` for `nobody@example.com`; the `waitlist-purge` job at `29 3 * * *`.
- [ ] **Do:** step 2's checks → **Expect:** `true` for Auth's schema access; triggers `auth_users_no_password` and `on_auth_user_created` on `auth.users`.
- [ ] **Do:** before step 6, Authentication → Sign In / Providers → Email → "Confirm email" → **Expect:** on. _(dashboard)_
- [ ] **Do:** step 4, hook on; step 5, dashboard "Send invitation" to an uninvited throwaway → **Expect:** refused with `invite_only`; no new user. _(dashboard)_
- [ ] **Do:** step 6 (after TX-2 is live), sign-ups on; ask for a code with an uninvited throwaway on app.moduo.app → **Expect:** "Moduo is invite-only right now. Join the waitlist at moduo.app, or ask the person who invited you to use this address."; no email; no user in Authentication → Users. _(web)_
- [ ] **Do:** step 7, `select public.waitlist_invite_email('<throwaway>');` → **Expect:** `invited`; within a minute B1 ("Your Moduo invite is ready") from Moduo &lt;hello@moduo.app&gt;, "Open Moduo" goes to app.moduo.app, footer "the Moduo team invited …" (manual). _(Gmail web + Apple Mail light/dark)_
- [ ] **Do:** sign in with that throwaway on the **Mac app** → **Expect:** the code arrives, you land in onboarding; `select count(*) from public.waitlist where email = '<throwaway>'` → 0. _(desktop)_ (AC20: invited address signs up on desktop)
- [ ] **Do:** sign in with your own existing account on web and desktop → **Expect:** exactly as before. _(both)_ (AC24)
- [ ] **Do:** set one real waitlist row to `invited` in the Table Editor → **Expect:** one B1, footer "you joined the Moduo waitlist on <date>"; saving the row again sends nothing. _(dashboard + inbox)_

## Edge cases

- [ ] **Do:** `select public.waitlist_resend_invite('<throwaway>')` right after inviting → **Expect:** `already_queued` (or `queued` once the first has gone out, and a second email).
- [ ] **Do:** `select public.waitlist_invite_email('bounced@resend.dev')` after it has bounced once → **Expect:** `suppressed`, nothing queued. (Needs the Resend webhook, TX-3 step 4.)
- [ ] **Do:** sign in on an **older** web or Mac build with an invited address → **Expect:** the invite-only line (the old build never asks to create an account); updating the app fixes it.

## Known gaps / not-yet-testable

- Founder access grants (`plan_grants`) are not an allow source yet: that table arrives in TX-9b, which adds the branch to the hook.
- The Mac download line in B1 stays hidden until the notarized download has a public link (`MAC_DOWNLOAD_URL` in `waitlist-invite.ts`).
- B1 rows are logged with no account id, so after an account deletion the invite's log row (with the address) stays until the 30-day purge; erasing by address is TX-8 (AC43).
- The footer's join date is the UTC day, so someone who joined just after midnight in Europe reads the day before.
- The local Auth server's code email used a stub template; on prod the code email for a first sign-in is A1 from `auth-email-hook` (TX-2's `signup` action).
