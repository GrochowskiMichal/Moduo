# Gotchas: Supabase, migrations, Realtime, sync

Compiled away by HV-14a (2026-10-27). The 269 entries this file held now live where they bite, so they load or fail at the moment someone makes the mistake:

- **Path rules** (load when a session views a matching file): [supabase-sql.md](../../.claude/rules/supabase-sql.md) and [supabase-access.md](../../.claude/rules/supabase-access.md) for `supabase/migrations/`, [supabase-chat-sql.md](../../.claude/rules/supabase-chat-sql.md), [supabase-tests.md](../../.claude/rules/supabase-tests.md) (SQL tests, probes, e2e), [supabase-functions.md](../../.claude/rules/supabase-functions.md), and the area rule [supabase.md](../../.claude/rules/supabase.md).
- **Checks in verify:** [migration-lint.test.ts](../../apps/app/src/lib/migration-lint.test.ts) (SQL-authoring traps over new migrations) and the ast-grep rules `postgrest-limit-over-cap`, `auth-getuser-uncached` and `async-iife-finally-reset` in [tools/ast-grep/rules](../../tools/ast-grep/rules).
- **Comments at the trap:** for example the header of [prefs-sync.ts](../../apps/app/src/lib/prefs-sync.ts) (the eight touchpoints of a new synced preferences domain), [supabase/tests/_setup.sql](../../supabase/tests/_setup.sql) (SQL harness traps), `apps/app/src/features/chat/realtime.ts` and `apps/app/src/lib/runtime.chat.supabase.ts`. Grep the code for the symbol you're touching.
- **Release push:** [docs/release.md](../release.md) §2. Local stack: [docs/local-dev.md](../local-dev.md).

Entries that were stale, duplicated, or already said by a decision, test or comment were deleted (`git log -p -- docs/gotchas/supabase.md` has the old text). A new trap goes to the rule, test or comment nearest the code, not back into this file.
