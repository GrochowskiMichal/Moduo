# Gotchas: Spine, MCP contract, contacts and tasks data

Compiled away by HV-14a (2026-10-27). The 73 entries this file held now live where they bite:

- **Comments at the trap** in `apps/app/src/features/spine/`, `apps/app/src/features/contacts/`, `apps/app/src/features/tasks/`, `apps/app/src/features/tasks/commands/shared.ts`, `supabase/functions/moduo-mcp/` and `infra/mcp-proxy/wrangler.jsonc`. Grep the code for the symbol you're touching.
- **Path rules:** [supabase-functions.md](../../.claude/rules/supabase-functions.md) (running a worktree's `moduo-mcp`, connector tests, deploys), [supabase-access.md](../../.claude/rules/supabase-access.md) (connector reads under an API key, pointer grants), [supabase-sql.md](../../.claude/rules/supabase-sql.md) (`tasks_notify_spine`, project statuses, legacy mirrors) and [supabase-tests.md](../../.claude/rules/supabase-tests.md).
- **Checks in verify:** the `tasks_notify_spine` test in [migration-lint.test.ts](../../apps/app/src/lib/migration-lint.test.ts).
- **The connector's contract:** [docs/moduo-mcp-connector.md](../moduo-mcp-connector.md) and [docs/decisions/mcp.md](../decisions/mcp.md).

Stale, duplicated or already documented entries were deleted (`git log -p -- docs/gotchas/spine.md` has the old text). A new trap goes to the rule, test or comment nearest the code, not back into this file.
