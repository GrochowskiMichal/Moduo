# Manual test checklist — TX-2 sign-in codes on Resend

> Generated 2026-10-08 · branch `t/maciej/tx-2-sign-in-codes` · **Live-verified:** partial. Unit tests and a local migration round trip passed (below). With Maciej's OK the migration was applied and `auth-email-hook` deployed (v1) on 2026-10-08; sign-in emails don't use it until the dashboard steps run ([docs/email-runbook.md](../email-runbook.md) §TX-2, steps 4–7).
> Run top-to-bottom after the runbook's steps 1–7; check off as you go. Each item is a step → what you should see → where.

## Before anything: logos are real
- [ ] **Do:** run the runbook's step 1 `curl` loop → **Expect:** `content-type: image/png` four times. On 2026-10-08 (~16:30 UTC) all four still answered `text/html` (app.moduo.app last deployed 7 October), so step 1 fails until the web app is redeployed. Rechecked ~20:50 UTC: still `text/html` on app.moduo.app (`prod-app` is 398 commits behind `staging-app`), while Vercel's build of `staging-app`'s head (bf3b7d57) served all four as `image/png`, byte-identical to `public/email/` at 192 × 44 and 26 × 26. A "Promote to production → app" run fixes it. _(terminal)_
- [ ] **Do:** runbook step 1b `curl` → **Expect:** `1`: moduo.app/privacy shows "Emails we sent you" and says Resend sends sign-in codes (PR #319 into `prod-landing`). _(terminal or browser)_

## Sign-in on web (AC7, AC8, AC9)
- [ ] **Do:** app.moduo.app → type your address → Continue with email → **Expect:** "Check your email", subtitle "Enter the six-digit code we sent. It works for 10 minutes.", and under the button "Resend in 1:00" counting down, greyed out. _(web)_
- [ ] **Do:** open the email → **Expect:** from "Moduo &lt;hello@moduo.app&gt;", subject "&lt;code&gt; is your Moduo code", the lockup top-left, the code in a box, "It works once, for 10 minutes." In Apple Mail with dark mode on, the dark look with the light logo. _(inbox)_
- [ ] **Do:** type the code → **Expect:** signed in, as before. _(web)_
- [ ] **Do:** sign out, ask for a code, wait for the countdown to end → "Didn't receive it? Resend code" → **Expect:** a second email arrives and the countdown restarts at 1:00. Only the newest code works. _(web)_
- [ ] **Do:** ask for a code, press the back arrow, press Continue again with the same address within the minute → **Expect:** straight back to the code step with the countdown still running; no second email. _(web)_
- [ ] **Do:** ask for a code, reload the page, type the same address and press Continue within the minute → **Expect:** the code step, no error, "Resend in 0:5x" counting down; no second email, and the code from the first email signs you in. _(web; on desktop, quit and reopen the app instead of reloading)_
- [ ] **Do:** Supabase SQL editor: `select to_email, payload, status, provider_id from public.email_outbox order by created_at desc limit 5;` → **Expect:** one `sent` row per email, `payload` = `{"action": "email", "variant": "sign_in", "fallback": false}` (or `magiclink`), no code anywhere in the row. _(dashboard)_

## Sign-in on desktop (AC7)
- [ ] **Do:** the Mac app → sign out → sign in with a code → **Expect:** the same email and the same countdown; signs in. _(desktop)_

## Capacity (AC11)
- [ ] **Do:** within one hour, ask for codes for 31 or more different test addresses (aliases like `you+tx2-01@…`), one per minute per address → **Expect:** every one arrives; the 31st doesn't fail with "Too many code requests". _(web + inbox)_

## Rollback drill (AC13)
- [ ] **Do:** runbook §Rollback: switch the hook off → ask for a code → **Expect:** the old-style email arrives (Supabase's template through Hostinger). _(web + inbox)_
- [ ] **Do:** switch the hook back on → ask for a code → **Expect:** the new email again. _(web + inbox)_

## Edge cases
- [ ] **Do:** with the hook on, temporarily set a wrong `SEND_EMAIL_HOOK_SECRET` (or leave it unset) → ask for a code → **Expect:** the screen says "We couldn't send your code. Try again in a minute."; the function log shows `signature_rejected`. Put the right secret back. _(web + dashboard)_ Optional; the unit tests cover it.
- [ ] **Do:** Authentication → Users → "Send invitation" to a fresh test address → **Expect:** "You're invited to Moduo" with a "Confirm your address" button; clicking it opens app.moduo.app with the "Links don't sign you in here…" note; asking for a code then works and signs in. In `email_outbox`, a `sent` row with `payload.action = invite` for that address (it's written while Auth is still creating the user, so this proves the log works for new users). _(dashboard + inbox + web)_

## Migrations / data
- [x] **Local round trip (2026-10-08, agent).** Postgres 17 throwaway cluster mirroring what the migration touches in prod (catalog read the same day: `auth.users(id uuid pk)`, `cron.schedule(text,text,text)` / `cron.job` columns, the roles, and prod's default ACL that grants anon + authenticated everything on new public tables). Applied twice (re-runs cleanly). Results: a service-role insert works and a duplicate `dedupe_key` is ignored; CHECKs refuse an unknown kind, stream, status, an upper-case address and a non-object payload; anon and authenticated get "permission denied" for select/insert/delete; only postgres + service_role hold grants; RLS on; one `email-outbox-purge` job at `17 3 * * *`; running its command deletes a 31-day-old row and keeps today's, and deletes the rows of a deleted account while keeping everyone else's. Validator follow-up (same day): with a second connection holding a new `auth.users` row uncommitted (what Auth does around the hook), a log insert for that user succeeds (the first version had a foreign key and refused it), and the row survives the purge once the user commits. Second follow-up: the purge's deleted-account rule waits an hour (a row of a deleted account written 2 hours ago goes; an orphan row written seconds ago stays), and a failed send for an invite or sign-up is logged with `to_user_id` null so the purge keeps it for 30 days. Docker isn't installed, so `supabase db dump` couldn't produce a full schema copy; the mirror holds only the objects the migration references.
- [x] **Applied to prod 2026-10-08 (agent, Maciej's OK).** Recorded as version `20261008160000` in `supabase_migrations.schema_migrations`, in the same transaction as the DDL. Catalog after: 0 rows, RLS on, no grants to anon/authenticated/PUBLIC (only postgres + service_role), 8 CHECKs, no foreign keys, `email-outbox-purge 17 3 * * *` as postgres next to `stripe-sync-worker`.
- [x] **`auth-email-hook` deployed 2026-10-08 (v1, verify_jwt off, agent, Maciej's OK).** An unsigned POST answers `401 {"error":{"http_code":401,"message":"invalid_signature"}}` as `application/json` (the function boots; no secret is set yet, so it refuses everything). `bun run functions:reconcile`: OK, no orphans.

## Known gaps / not-yet-testable
- Nothing has run against Supabase Auth or Resend for real: the hook was exercised with signed fake requests and a fake Resend in `auth-email-hook/handler.test.ts`.
- The "Confirm your address" invite link and how GoTrue redirects after it are verified from GoTrue's documented behaviour, not live.
- The panel's reload case (Auth's "wait" opens the code step) is covered by unit tests that render the real panel, not by a live run: trying it live means sending real code emails through Hostinger's 30-an-hour cap. The reload item above covers it.
- With the hook on, the code lifetime is whatever the dashboard says; the email and the screen say 10 minutes, so step 4 (600 s) must run before step 6.
