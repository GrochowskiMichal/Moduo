# Review instructions (Moduo)

> **Lean mode (pre-alpha):** every PR into `develop` gets one advisory AI review (`/code-review medium --comment`, [ai-review.yml](./.github/workflows/ai-review.yml)); it never blocks a merge. Task PRs into the personal branches get none, `/code-review ultra` and the security scan stay paused until beta, and only Tier 2 diffs get the `validator`. See [AGENTS.md §Review gates](./AGENTS.md#review-gates-lean-mode-pre-alpha-no-external-users).

Read by the AI review on PRs into `develop`, the `validator` subagent, and any `/code-review` run in a session. Keep it short: every line here changes what a review reports.

## What Important means here
Anything that would break behavior, leak data or block a rollback:
- RLS or permission gaps, including service-role reads (MCP connector, Edge Functions) not scoped to the caller's workspace
- PII in logs, error messages or PostHog events
- migrations that break reads during deploy, reset function grants, or aren't backward compatible
- Zod contracts that drift from database CHECKs
- billing or entitlement mistakes
- secrets in code or config
- user-owned data that account erasure misses

## Where to look hardest
The PR's `tier-2` label means it touches a risky path ([scripts/ci/tier.ts](./scripts/ci/tier.ts)): spend the effort there. A sync PR into `develop` batches several blocks; review the diff, not the block descriptions.

## Nits
Naming, style and refactor suggestions are Nit at most. Report five Nits at most and give the rest as a count.

## Do not report
Anything `bun lint`, `bun fmt`, `bun check`, `lint:tw` or `lint:css` already enforce. Skip `storybook-static/`, `bun.lock` and `.design-sync/ds-types/`.

## Always check
- New tables have RLS policies, and the PR says how owner, member and outsider access was checked.
- New closed values exist in `@contracts` and in a Postgres CHECK.
- Tauri commands validate their input.
- UI uses tokens and shadcn primitives only.
- A new module wires into the spine (links, activity, notifications) and ships its MCP tools and dashboard widget.

## Evidence
Every claim cites `file:line` in the source and was reproduced (a test run or a traced code path). Never infer behavior from names. An inline comment says the severity, the defect in one sentence, and the concrete input or state that breaks; a finding you could not verify is not posted.
