# Must-hold rules, in full

The short list is in [AGENTS.md](../../AGENTS.md); the numbers match. Rules marked there with ⛔ are enforced in code, as each entry says; the rest you hold yourself.

1. **Branch before editing.** Work on `t/<owner>/<kebab>` cut off the latest personal branch (`mike` or `maciej`), never `develop`. *(Hook `guard-git.sh` blocks direct pushes to `develop`, deleting or force-pushing `develop`/`mike`/`maciej`, and bare force-pushes; GitHub rulesets hold the same server-side.)*
2. **The repo is public: everything committed is published.** No secrets, tokens, session files or customer data in git; keys go in env vars, private notes in `docs/local/`. *(Hook `guard-secrets.sh` runs gitleaks on every commit; CI scans each push.)*
3. **Tokens only in UI.** No raw hex, no arbitrary Tailwind values for color/spacing/radius/font, no inline-style design properties; primitives wrap shadcn. *(Hook `guard-design-tokens.sh` re-runs `lint:tw` + `lint:css` after UI edits; CI gates both.)* Full rules: [docs/DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md), relational rules R1–R10: [docs/DESIGN_RULES.md](../DESIGN_RULES.md).
4. **Closed vocabularies live once** in `supabase/functions/_shared/contracts/` (`@contracts/*`), with a matching Postgres CHECK. *(Drift-gate tests.)* See `.claude/rules/contracts.md`.
5. **Applied migrations are history.** Never edit one; add a new migration. See `.claude/rules/supabase.md`.
6. **Always `getRuntime()`**, never a bare `{ runtime }` import. redb is paused: never make it load-bearing for a new feature.
7. **No new top-level routes and no IA refactors** without the designer's explicit ask (converging from 23 routes to 5–7).
8. **Production ships only from a `vX.Y.Z` tag cut by `/release`** (there is no `main` or mirror branch). Never merge or close unrelated PRs. Force-push only your own task branch, with `--force-with-lease`. *(Hook `guard-release.sh` blocks tag pushes and prod workflow runs without `/release`'s marker.)*
9. **Never commit `docs/local/`. Never push `refs/entire/*`** (session transcripts stay local; the guard blocks it) and never wipe local Entire data.
10. **Never read a teammate's private Moduo data** (private tasks, queue, focus runs, agent sessions, notes) through the admin/service-role Supabase connection. Read through your own permissions, or ask them.
11. **Supabase writes ask first.** *(Hook `guard-prod-db.sh` asks before any Supabase MCP `apply_migration`, `execute_sql` or `deploy_edge_function` and before `supabase db push`, `db query --linked` and `functions deploy`. A developer may lift that for their own sessions with `MODUO_SUPABASE_NO_PROMPT=1` in their gitignored `.claude/settings.local.json`; their own allow rules then decide, and teammates are still asked.)*
12. **Stage explicit paths.** Another session may share the checkout: never `git add -A` or `git add <dir>`.
13. **The local Supabase stack is shared** by every session and agent on this Mac. Never wipe or stop it (`local:reset`, `local:down`, `supabase db reset`, `supabase stop --no-backup`) unless the user confirms no other session needs it, and never clean up rows or migrations another session left there. Test a migration by applying it on top with `psql … -1 -f <file>`. *(`scripts/local/stack.sh` refuses reset/down without `MODUO_SHARED_STACK_OK=1`; `.claude/settings.json` denies the raw commands.)*
