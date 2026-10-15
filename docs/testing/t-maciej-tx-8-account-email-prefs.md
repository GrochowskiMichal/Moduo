# Manual test checklist — TX-8 · Account deleted email + Settings → Email

> Generated 2026-10-15 · branch `t/maciej/tx-8-account-email-prefs` · **Live-verified:** partial. The database side passed `supabase/probes/email-prefs.probe.sql` on the local stack; the UI and `delete-account` are covered by unit tests only (see Known gaps).
> Run top-to-bottom after the release steps in docs/email-runbook.md §TX-8, on a throwaway account. Each item is a step → what you should see → where.

## Settings → Preferences → Email
- [ ] **Do:** open Settings → Preferences → **Expect:** an "Email" group between Notifications and Reminders, with the line "Sign-in codes and other emails about your account always arrive." and three switches: Bookings (on), Trial and billing reminders (on), Build updates (off) _(both)_
- [ ] **Do:** turn Bookings off, reload, then open Settings on a second device or browser → **Expect:** Bookings is off on both; the other two are unchanged _(both)_
- [ ] **Do:** turn Trial and billing reminders off, then Bookings back on → **Expect:** each switch keeps its own value; changing one never resets the other _(web)_
- [ ] **Do:** turn Build updates on → **Expect:** it stays on, and no confirmation email arrives _(web)_
- [ ] **Do:** turn Build updates off → **Expect:** it stays off after a reload _(web)_

## Email switches take effect
- [ ] **Do:** with Bookings off, book one of the account's links from another browser → **Expect:** no "New booking" email; the bell still shows the booking; the guest still gets their confirmation _(web)_
- [ ] **Do:** guest cancels that booking → **Expect:** no "Guest canceled" email to the host; the guest still gets theirs _(web)_
- [ ] **Do:** turn Bookings back on and book again → **Expect:** the host's "New booking" email arrives _(web)_

## Deleting the account (A2)
- [ ] **Do:** Settings → Account → delete the account → **Expect:** one email, "Your Moduo account is deleted", dated today in your own time zone, with the Moduo logo at the top _(web)_
- [ ] **Do:** read it on an account that had a trial or plan → **Expect:** it includes "Your plan is canceled, and you won't be charged again." _(web)_
- [ ] **Do:** after the deletion, run the runbook's §TX-8 step-6 queries → **Expect:** no outbox, subscription or do-not-email rows for that address _(SQL editor)_

## Edge cases
- [ ] **Do:** turn off the network, then open Settings → Preferences → **Expect:** the Email group is hidden, never shown with the wrong values _(web)_
- [ ] **Do:** with the network back but the server refusing a change → **Expect:** the switch flips back and a toast says "Couldn't change your email settings — try again." _(web)_
- [ ] **Do:** delete an account whose address is on the do-not-email list → **Expect:** the deletion finishes, no A2 is sent, and the address is gone from the list afterwards _(SQL editor)_
- [ ] **Do:** delete an account whose address is `bounced@resend.dev` (once the Resend webhook is connected) → **Expect:** no `email_suppressions` row for it afterwards (runbook §TX-8 step 7) _(SQL editor)_

## Migrations / data
- [ ] **Do:** after applying `20261015153000_tx8_email_preferences.sql`, run the runbook's step-1 check → **Expect:** `true, false, true, false, true` _(SQL editor)_
- [ ] **Do:** look at the `delete-account` logs after a deletion → **Expect:** no `suppression_not_erased` or `farewell_failed` warnings (if one appears, follow runbook step 8) _(Supabase logs)_

## Likely-regressed areas
- [ ] **Do:** sign in with a code → **Expect:** the code arrives as before (codes ignore every switch) _(both)_
- [ ] **Do:** invite someone from the waitlist → **Expect:** B1 arrives as before _(SQL editor + inbox)_
- [ ] **Do:** delete an account that solely owns a workspace with other members → **Expect:** still blocked with the same message, and no email is sent _(web)_

## Known gaps / not-yet-testable
- The Settings group wasn't live-checked in the browser: the shared local stack was reset by another session mid-run, which dropped this migration, so the UI is covered by `preferences-section.test.tsx` only.
- `delete-account` wasn't run end to end: the A2 send, the erasure order and the retry behaviour are covered by `account-erasure.test.ts` and `account-deleted-send.test.ts`, not by a real Resend send.
- Whether Resend's bounce and complaint webhooks carry our `kind` tag is unverified until the webhook is connected (the bounce check above).
- The probe (AC41, AC42) runs by hand on the local stack; it isn't part of `bun run verify` or CI.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
