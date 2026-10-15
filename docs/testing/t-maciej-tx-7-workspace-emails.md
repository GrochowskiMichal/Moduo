# Manual test checklist — TX-7 workspace emails

> Generated 2026-10-15 · branch `t/maciej/tx-7-workspace-emails` (PR #385) · **Live-verified:** partial. On the local stack: `bun run db:test workspace_emails` (74 checks, also run with the migration owned by the non-superuser `postgres` role), a throwaway Auth server (GoTrue v2.197.0) with the invite-only hook on, PostgREST with real tokens, and the web app in the browser. Not on prod: the release steps are docs/email-runbook.md §TX-7.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Done in the session (agent)

- [x] **Do:** `bun run verify` → **Expect:** green. _(B3/B4/B5 copy, payload parsing, name screening, the worker's kind list; join page mismatch + Sign out; pending join; invite-join helpers)_
- [x] **Do:** `bun run local:reset`, then `bun run db:test workspace_emails` → **Expect:** 74 checks pass. _(old trigger gone; B3 queued once per invite with the caller as inviter; revoke/delete cancel it; the server sets address, token, dates, expiry; no re-pointing, moving or reviving an invite; 20/24 h cap incl. deletes, back-dating, many-row inserts, server inserts; mismatch with masked hint; B4 on transfer both ways; B5 on removal; nothing on leave; grants)_
- [x] **Real Auth, hook on:** uninvited address → `403 invite_only`; invited address → code sign-up `200`; that person accepting someone else's invite through PostgREST → `400 {"message":"invite_email_mismatch","hint":"s•••@…"}`; accepting their own → joined.
- [x] **Browser (local stack):** signed out, open an invite link → "Sign in to accept" → code → lands on `/join` (not onboarding) → Accept → in the workspace. Then open another address's invite → Accept → "This invite is for s•••@probe-tx7.test. Sign in with that address to join." + Sign out → `/auth`, invite kept.

## After the release (runbook §TX-7, each step with Maciej's OK)

- [ ] **Do:** step 1, deploy `email-worker` from `maciej` → **Expect:** a new version; `bun run functions:reconcile` clean.
- [ ] **Do:** step 2, apply `20261015153935_tx7_workspace_emails.sql`, run its three checks → **Expect:** triggers `perm_invites_validate` + `workspace_invites_enqueue_email`, `null`, `true`.
- [ ] **Do:** step 3, `supabase functions delete send-workspace-invite`, then the curl → **Expect:** `404`; reconcile clean. (AC39)
- [ ] **Do:** in Settings → Members and access, invite a throwaway inbox you can read → **Expect:** toast "Invite sent to …", the copy link still shows; within a minute "<you> invited you to <workspace>" from "<you> via Moduo", Reply goes to you, role and "Works until" rows, "Accept invite" opens `app.moduo.app/join?invite=…`. _(web; Gmail + Apple Mail, light/dark)_ (AC34)
- [ ] **Do:** open that link in a private window, sign in with the throwaway address and its code → **Expect:** straight to the join card, Accept → in the workspace, no onboarding. _(web, then the Mac app)_ (AC36)
- [ ] **Do:** open the same kind of link while signed in as yourself → **Expect:** "This invite is for t•••@…. Sign in with that address to join." with Sign out. _(web)_ (AC35)
- [ ] **Do:** transfer ownership of a test workspace to the throwaway account → **Expect:** "You're now the owner of <workspace>" to them, with "Its seats now come from your plan." (AC38)
- [ ] **Do:** remove a member → **Expect:** "You no longer have access to <workspace>" to them; a member who leaves by themselves gets nothing. (AC38)

## Edge cases

- [ ] **Do:** send a 21st invite from one workspace within 24 h → **Expect:** "You've sent 20 invites today. You can send more tomorrow." (AC37)
- [ ] **Do:** revoke a pending invite right after sending → **Expect:** if the email hadn't gone yet, `email_outbox` shows it `cancelled`.
- [ ] **Do:** invite with a display name like "Account Security" or a workspace named like a link → **Expect:** From "Moduo", the inviter's address in the text, "a workspace" instead of the name.

## Migrations / data

- [ ] **Do:** `select kind, status, last_error from public.email_outbox where kind like 'workspace_%' order by created_at desc limit 20;` → **Expect:** `sent` rows, no `failed`.

## Known gaps / not-yet-testable

- No real email has been sent: B3/B4/B5 only reach an inbox after the release.
- The Mac app's pending-join path wasn't run (same code as web).
- The app must ship in the same train as the migration or after it; earlier, "Invite sent" shows while nothing is sent.
- Dates are in UTC; B4's settings link opens the currently selected workspace.
