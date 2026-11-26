# Reference: product, knowledge, stack, commands, contracts

From the AGENTS.md this commit had, moved out so the map stays short (A/B rig, `diet` arm).

## Product north star (read before designing any module)

[docs/PRODUCT_BRIEF.md](../PRODUCT_BRIEF.md) (what Moduo is, the connective-tissue spine, non-goals: no Notion-style databases, no abstract graph UI, one-gesture links, MCP-only AI, quiet notifications) · [docs/ROADMAP.md](../ROADMAP.md) (waves, scored backlog, numbered open questions; check `§Open Questions & Risks` before anything marked ⚠) · [docs/data-layers.md](../data-layers.md) (runtimes, Supabase-first, the spine). Edit these **before** code when direction changes. Module briefs: `.design/<module>/BRIEF.md` + `DESIGN_BRIEF.md`. A module is done only when it wires into the spine, ships its MCP tools and its dashboard widget ([module contract](../moduo-module-contract.md)).

## Knowledge map

- **Architecture:** [docs/architecture.md](../architecture.md) (code layout) · [docs/data-layers.md](../data-layers.md) · [docs/moduo-module-contract.md](../moduo-module-contract.md) · vocabulary: [docs/moduo-architecture-vocabulary.md](../moduo-architecture-vocabulary.md).
- **Decisions:** index [docs/decisions.md](../decisions.md) (generated, current entries only), full entries in `docs/decisions/<area>.md`; `bun run docs:current <area>` prints an area without its superseded entries. Add a decision at the top of its area file with a `status:` line (a replacement names what it `supersedes:`), then `bun run docs:index`.
- **Path rules:** `.claude/rules/<area>.md`, frontmatter `paths:` (globs), `incident:` (what went wrong) and `expires:` (review date; `lint:rules` warns once it passes). Short must-know lines for that area only; detail stays in gotchas and decisions. Audit the set with `/doctor prompt-audit` in a session.
- **Gotchas:** index [docs/gotchas.md](../gotchas.md); the area files are now maps, because the traps were compiled into checks: the ast-grep pack (`tools/ast-grep/rules/`, `bun run lint:ast`), `scripts/ci/config-traps.test.ts`, migration lint and path rules. A new trap goes into its area file; one that bites twice becomes a hook, lint rule or test (with the fix in its error message).
- **Learn loop:** escapes in `benchmarks/escapes/` feed `variant-hunt`; the A/B rig and its arms (`bun run ab`, `scripts/harness-ab/`), the MCP agent-experience eval (`bun run mcp-eval`) and the docs eval (`bun run eval:docs`) measure harness changes before they land; `bun run numbers` writes the weekly outcome note to Moduo.
- **The queue:** `bun run queue` (Moduo's block tasks + spec dependency tables + open PRs; claim a block with a draft PR before building it); new blocks go in with `bun run queue:import specs/<feature>.md`; [specs/BUILD_ORDER.md](../../specs/BUILD_ORDER.md) is only a pointer.
- **Agent setup:** [docs/agent-setup.md](../agent-setup.md) · **Entire:** [docs/entire.md](../entire.md).

## Stack

Tauri 2 + React 19 + Rsbuild + TanStack Router + Tailwind CSS v4, TypeScript 7, Bun. Supabase is the source of truth (cloud-first) on web and desktop; redb persists only the not-yet-migrated desktop modules. Lexical for rich text, Yjs for collaboration, Storybook 10 for components (with its MCP server), Rstest + Playwright for tests, `bun check` for types, `bun fmt` for formatting, `bun lint` for JS lint (a pinned canary build).

## Build / dev

- `bun run dev:web` (http://127.0.0.1:8081) · `bun run dev:desktop` · `bun run build:web` / `build:desktop` · `bun run storybook` (port 6006)
- **Local stack first:** `bun run local:up` (Supabase + functions + Mailpit on this Mac, `.env.local` switched to it), test a migration by applying it on top (`psql … -1 -f <file>`, rule 13; `bun run local:reset` only with the user's OK), `bun run env:cloud` to go back. **Releasing to prod is `/ship` only** (release PR + `vX.Y.Z` tag; `guard-release.sh` blocks tags and prod workflows started any other way; the app Worker rolls out as a canary with automatic rollback, `scripts/release/canary.ts`); migrations and Edge Functions stay manual and `/ship` stops until they are applied: [docs/release.md](../release.md). See [docs/local-dev.md](../local-dev.md).
- `bun run verify` = typecheck (`bun check`) + `bun lint` + `bun fmt --check` + lint:tw + lint:boundaries (only `lib/runtime*` talks to Supabase; `lib` never imports `features`) + lint:ast + lint:css + lint:notes + lint:ratchets + lint:decisions + lint:rules (rule frontmatter, dead file/script references, this file ≤150 lines) + size + tests (the `verify` script in `package.json` is the list), run through Turborepo across every workspace: **the block-done gate**. It covers no Rust: see `.claude/rules/desktop-rust.md`.
- `bun run test` (all suites) · `bun run --cwd apps/app test <path>` (one app test) · `bun run e2e`
- **Workspaces** (Bun + Turborepo; run every root script from the root): `apps/app` (`@moduo/app`, the Rsbuild SPA) · `apps/desktop` (`@moduo/desktop`, Tauri: `src-tauri/` inside, the CLI runs from `apps/desktop`) · `apps/landing` · `apps/storybook` · `supabase/` (`@moduo/backend`, function and contract tests) · `e2e/` (`@moduo/e2e`, Playwright). `scripts/` and `tools/` are root tooling.

## Repo layout (short)

App code lives in `apps/app/src/` (paths before 2026-10-17 say `src/`): `apps/app/src/app/` composition and router · `apps/app/src/routes/pages/` thin page adapters · `apps/app/src/features/<feature>/` vertical slices (`ui`, `model`, `hooks`, `storage`/`sync`, `utils`) · `apps/app/src/components/ui/` shadcn primitives (story required) · `apps/app/src/components/app/` shell · `apps/app/src/lib/` runtimes and platform services · `apps/app/src/lib/sync/` the offline-sync kernel and stores (Tasks reads go through `features/tasks/tasks-context.tsx` hooks, writes through `features/tasks/commands/`: [docs/architecture.md](../architecture.md) §Tasks data and commands) · `apps/app/src/styles/tokens.css` tokens (**edit the token, never a component, to change a value**) · `apps/desktop/src-tauri/` Rust · `supabase/` migrations + Edge Functions · `docs/` knowledge · `specs/` specs (blocks and dependencies; the queue itself is in Moduo) · `.design/` design briefs · `.claude/` skills, agents, hooks, settings.

## Domain contracts (Zod + enums)

Closed vocabularies (plan tier, task status, roles, link origins, …) live in `supabase/functions/_shared/contracts/` (`vocabularies.ts`, `primitives.ts`, `errors.ts`); app code imports `@contracts/*`, Edge Functions import relatively. To add or change a value: (1) const array + Zod schema + type in `vocabularies.ts`; (2) keep `parse*` (strict, writes), `normalize*` (lax, reads) and `is*` in lockstep; (3) migrate the Postgres CHECK/enum in the same change; (4) when a value dies, remove it everywhere, no zombie unions. Leave **open** strings alone (polymorphic entity types, renamable contact statuses, IMAP folders, Stripe events, opaque prefs). Never invent a parallel union in `apps/app/src/features/*/model.ts`.
