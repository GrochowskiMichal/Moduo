# Gotchas: Email engine and import

Read before working in `apps/app/src/features/email/`, `apps/desktop/src-tauri/src/commands/email/`, `supabase/functions/_shared/email/` and the auth hooks. Index of all areas: [docs/gotchas.md](../gotchas.md).

Compiled on 2026-10-27 (HV-14c, specs/harness-v3.md AC30): every entry became an ast-grep rule, a test, a comment at the trap, a path rule or a doc, or was deleted as stale. A path rule loads by itself when you open a file it covers.

## Where the traps live now

- **Path rules:** [email](../../.claude/rules/email.md) (the half-patched follow-up guard, outbox retention and kick, auth hook setup and testing, payloads naming other people, the Deno connector), [migrations-practice](../../.claude/rules/migrations-practice.md) (self-reminders, checking a deployed definition, `now()` in a transaction).
- **Comments at the trap:** the Rust engine in `apps/desktop/src-tauri/src/commands/email/` (`smtp.rs`, `secrets.rs`, `storage.rs`, `account_config.rs`, `sync.rs`, `account_commands.rs`, `model.rs`, `search.rs`); the app in `apps/app/src/features/email/` (`use-email-module.ts`, `use-email-convert.ts`, `compose.ts`, `use-email-snooze-restore.ts`, `utils/email-html.ts`, `prefs.ts`, `history-depth.ts`, `email-history-depth-select.tsx`), `apps/app/src/lib/prefs-columns.ts`, `apps/app/src/lib/entity-open.ts`, `apps/app/src/components/auth/otp-send-error.ts`, `apps/app/src/components/ui/select.tsx`; the kit in `supabase/functions/_shared/email/` (`render.ts`, `assets.ts`, `resend-webhook.ts`, `templates/`), `supabase/functions/auth-email-hook/handler.ts`, `supabase/functions/_shared/standard-webhooks.ts`, `supabase/functions/moduo-mcp/modules/email.ts`.
- **Tests and the compiler:** `classify.test.ts` pins the smart-inbox order; lettre's private header fields and the typed `.select()` literal fail to compile.
- **Docs:** [docs/email-runbook.md](../email-runbook.md) (deploys and hook setup).

## Open entries

None. A new trap goes here (the trap, why, what to do instead) only until it has a better home; one that bites twice becomes a hook, a lint rule or a test.
