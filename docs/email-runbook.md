# Email runbook

How Moduo's own emails are switched on, checked and rolled back. The build plan is [specs/transactional-email.md](../specs/transactional-email.md); every TX block adds its section here. Never paste a secret into a chat or a doc: set it in your own terminal.

## Pieces

| Piece | Where | Notes |
| --- | --- | --- |
| Template kit | `supabase/functions/_shared/email/` | One renderer for HTML + plain text. Preview: Storybook → Email/Transactional emails. |
| Sender | Resend, domain `moduo.app` (eu-west-1) | From "Moduo &lt;hello@moduo.app&gt;". Open/click tracking stays off. |
| Sign-in emails | Supabase Auth → Send Email Hook → Edge Function `auth-email-hook` | Since TX-2. Signed requests (Standard Webhooks). |
| Log | `public.email_outbox` | One row per email: who, which kind, sent or failed, Resend's id. Never the code. Deleted after 30 days; rows tied to a deleted account go at the next daily run after an hour's grace, so within about 25 hours (pg_cron `email-outbox-purge`, 03:17 UTC). A failed send for an invite or first sign-in names no account, so it stays the full 30 days. |
| Logos | `https://app.moduo.app/email/{lockup,mark}-{light,dark}@2x.png` | From BRAND-1's export in `public/email/`. Served once the web app is deployed with them. |

### Secrets (Edge Functions)

| Secret | Used by | Set by |
| --- | --- | --- |
| `RESEND_API_KEY` | every sender | already set |
| `SEND_EMAIL_HOOK_SECRET` | `auth-email-hook` | Maciej, from the dashboard's hook dialog (TX-2 step 5) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` | `auth-email-hook` (invite link, log insert) | the platform |

## TX-2 · Sign-in codes through Resend: going live

Run in this order. Steps 2–3 are agent steps that need Maciej's OK in the session; steps 4–8 are Maciej's, in the Supabase dashboard (project `wtoonrvuqumihpkbvwvs`) and his own terminal.

1. **Logos are real files.** All four must answer `content-type: image/png` (a 200 alone proves nothing: a missing file returns the app's HTML). Expect `image/png` four times:
   ```bash
   for f in lockup-light lockup-dark mark-light mark-dark; do curl -sI "https://app.moduo.app/email/$f@2x.png" | grep -i '^content-type'; done
   ```
   If any says `text/html`, the web app hasn't been deployed since BRAND-1 merged. Deploy it first; don't switch the hook on, or every code email shows a broken logo. app.moduo.app deploys from `prod-app`, which only moves when someone runs Actions → "Promote to production" → `app` (Mike so far). The files reached `staging-app` on 2026-10-08, and Vercel's build of it served all four as PNGs at the contracted sizes, so one promotion is all step 1 needs. Steps 4 and 5 are safe before that (the hook stays off); 6 and 7 wait for it.
1b. **The privacy policy says it first.** Once the hook is on, Resend sends sign-in codes and `email_outbox` keeps a 30-day record, so moduo.app/privacy must already say both. The lines ship through PR #319 into `prod-landing` (Mike merges it with a merge commit). Check that the page shows the "Emails we sent you" entry:
   ```bash
   curl -s https://moduo.app/privacy | grep -c 'Emails we sent you'
   ```
   Expect `1`. Like step 1, this gates step 6.
2. ✅ (2026-10-08) **Migration** `20261008160000_email_outbox.sql` applied to prod (agent, with OK). Check: `select count(*) from public.email_outbox;` returns 0, and `select jobname from cron.job;` lists `email-outbox-purge`.
3. ✅ (2026-10-08, v1) **Function deployed** (agent, with OK):
   ```bash
   supabase functions deploy auth-email-hook --project-ref wtoonrvuqumihpkbvwvs --no-verify-jwt --import-map supabase/functions/deno.json --use-api
   ```
   then `bun run functions:reconcile`. Until the hook is switched on, nothing calls it.
4. **Code lifetime.** Authentication → Sign In / Providers → Email → "Email OTP Expiration": `600` seconds. Save. (Dashboard invite links follow the same lifetime.)
5. **Create the hook, switched off.** Authentication → Auth Hooks → Add hook → "Send Email hook" → type HTTPS → URL `https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/auth-email-hook` → "Generate secret". Leave **Enable** off and save. Copy the secret (`v1,whsec_…`), then in your own terminal:
   ```bash
   supabase secrets set --project-ref wtoonrvuqumihpkbvwvs SEND_EMAIL_HOOK_SECRET='<paste here>'
   ```
6. **Switch the hook on**, only once steps 1 and 1b pass. Same dialog → Enable → save. From now on Auth sends no email itself.
7. **Rate limit.** Authentication → Rate Limits → "Rate limit for sending emails": `300` per hour. Save.
8. **Test** with the checklist in `docs/testing/t-maciej-tx-2-sign-in-codes.md`: web sign-in, desktop sign-in, 31+ codes in an hour, the rollback drill below.

Nothing about the old sender changes: the custom SMTP settings (Hostinger) stay as they are, unused while the hook is on.

### Rollback (any time)

Authentication → Auth Hooks → Send Email hook → switch **Enable** off → save. Auth goes back to the custom SMTP at once (Hostinger, 30 emails an hour, the old template). Nothing to deploy. Switch it back on the same way.

### When codes don't arrive

- **The sign-in screen says "We couldn't send your code."** The hook answered with an error. Look at the function's logs (Dashboard → Edge Functions → auth-email-hook → Logs): `send_failed` (Resend refused: see `error`), `signature_rejected` (secret mismatch: redo step 5 and set the secret again), `log_failed` (the email went out; only the log row is missing).
- **Which emails went out:**
  ```sql
  select created_at, to_email, payload->>'action' as action, status, last_error, provider_id
  from public.email_outbox order by created_at desc limit 20;
  ```
  `provider_id` is Resend's email id: search it in the Resend dashboard (Emails) to see delivery.
- **Hook switched on but the function isn't deployed, or the secret isn't set:** every sign-in fails. Switch the hook off (rollback) first, then fix.

### Dashboard invites until TX-4

Authentication → Users → "Send invitation" still works: the hook sends "You're invited to Moduo" with a "Confirm your address" button. The link confirms the address and opens the app; the person then signs in with a code. It works for as long as a code does (10 minutes after step 4). If it has expired, send the invitation again (if the dashboard refuses because the user already exists, delete that unconfirmed user first). TX-4 replaces this with the waitlist invite.
