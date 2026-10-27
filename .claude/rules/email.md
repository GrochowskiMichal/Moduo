---
paths: ["apps/app/src/features/email/**", "apps/desktop/src-tauri/src/commands/email/**", "supabase/functions/_shared/email/**", "supabase/functions/auth-email-hook/**", "supabase/functions/email-worker/**", "supabase/functions/resend-webhook/**", "supabase/migrations/*email*"]
incident: "A notify branch authored in a migration sat unapplied in prod for three weeks (EM-6/DF-21d, 2026-07), and an outbox purge would have deleted queued mail (TX-3, 2026-10-09)"
expires: 2027-01-31
---

# Email: engine, transactional kit, auth hooks

Most traps are commented at their code. Deploys and hook setup: [docs/email-runbook.md](../../docs/email-runbook.md). Rust also follows `.claude/rules/desktop-rust.md`.

- **The follow-up guard is half-patched.** `email_op_clear_follow_up` leaves `follow_up_notified_at` set, though `20260704180000`'s comment says both ops reset it. Harmless while the due-check reads `follow_up_cleared_at`; fix it with a forward migration if that changes.
- **A retention rule on a queue table must not count from `created_at`:** `email_outbox__purge()` keeps `queued`/`sending` rows and counts from `coalesce(sent_at, last_attempt_at, created_at)`.
- **`email_outbox__kick` posts to prod's `email-worker` URL** from any database the migration runs on; on a Supabase branch or restored copy, point it at that project or its queue never drains.
- **Auth hooks:** create the Send Email hook switched off, set its secret, then switch it on (else every sign-in fails). The dashboard's "Add user → Create new user" skips the before-user-created hook ("Send invitation" doesn't), so it can't test the invite gate. A hook can't tell a password sign-up from a code sign-up: assume any request can come from anyone who knows the address.
- **Test an auth hook without restarting the shared stack:** run a second Auth container on the stack's network with the hook env vars (`GOTRUE_HOOK_BEFORE_USER_CREATED_*`, the rest copied from `docker inspect supabase_auth_moduo`) on its own port, with a mailer template that prints `{{ .Token }}` for Mailpit.
- **An email's payload can name someone other than its recipient** (the inviter, the previous owner). Erasure matches only `to_email`/`to_user_id` today; clearing rows whose `payload ->> 'inviter_email'` or `payload ->> 'by_email'` is the erased address is open (TX-8).
- **The MCP connector (`moduo-mcp`) is Deno and not typechecked** (its tests run): check every RPC argument it sends against the migration signature by hand.
