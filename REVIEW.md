# Review instructions (Moduo)

Read by `/s3`'s review gate, the `validator` subagent's reviewers, and Claude's managed Code Review if the team moves to a plan that has it. Keep it short: every line here changes what a review reports.

## What Important means here
Anything that would break behavior, leak data or block a rollback:
- RLS or permission gaps, including service-role reads (MCP connector, Edge Functions) not scoped to the caller's workspace
- PII in logs, error messages or PostHog events
- migrations that break reads during deploy, reset function grants, or aren't backward compatible
- Zod contracts that drift from database CHECKs
- billing or entitlement mistakes
- secrets in code or config
- user-owned data that account erasure misses

## Nits
Naming, style and refactor suggestions are Nit at most. Report five Nits at most and give the rest as a count.

## Do not report
Anything Biome, `tsc`, `lint:tw` or `lint:css` already enforce. Skip `storybook-static/`, `bun.lock` and `.design-sync/ds-types/`.

## Always check
- New tables have RLS policies, and the PR says how owner, member and outsider access was checked.
- New closed values exist in `@contracts` and in a Postgres CHECK.
- Tauri commands validate their input.
- UI uses tokens and shadcn primitives only.
- A new module wires into the spine (links, activity, notifications) and ships its MCP tools and dashboard widget.

## Evidence
Every claim cites `file:line` in the source and was reproduced (a test run or a traced code path). Never infer behavior from names.
