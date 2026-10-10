# AGENTS.md

The single source of truth for coding agents in Moduo. Claude Code loads it automatically (v2.1.277+; there is deliberately no `CLAUDE.md`). Folder-level `AGENTS.md` files in `supabase/`, `src-tauri/`, `src/components/ui/` and `.github/` load when work touches those folders. **Keep this file under 150 lines:** it is a table of contents. Procedures live in skills, area knowledge in `docs/decisions/` and `docs/gotchas/`, and anything that must hold every time lives in hooks, lint and CI.

## Must-hold rules

Marked rules are enforced in code; the rest you hold yourself.

1. **Branch before editing.** Work on `t/<owner>/<kebab>` cut off the latest personal branch (`mike` or `maciej`), never `main`/`develop`. *(Hook `guard-git.sh` blocks direct pushes to `main`, `develop`, `prod-app`, `staging-app` and bare force-pushes.)*
2. **The repo is public: everything committed is published.** No secrets, tokens, session files or customer data in git; keys go in env vars, private notes in `docs/local/`. *(Hook `guard-secrets.sh` runs gitleaks on every commit; CI scans each push.)*
3. **Tokens only in UI.** No raw hex, no arbitrary Tailwind values for color/spacing/radius/font, no inline-style design properties; primitives wrap shadcn. *(Hook `guard-design-tokens.sh` re-runs `lint:tw` + `lint:css` after UI edits; CI gates both.)* Full rules: [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md), relational rules R1–R10: [docs/DESIGN_RULES.md](./docs/DESIGN_RULES.md).
4. **Closed vocabularies live once** in `supabase/functions/_shared/contracts/` (`@contracts/*`), with a matching Postgres CHECK. *(Drift-gate tests.)* See §Domain contracts.
5. **Applied migrations are history.** Never edit one; add a new migration. See `supabase/AGENTS.md`.
6. **Always `getRuntime()`**, never a bare `{ runtime }` import. redb is paused: never make it load-bearing for a new feature.
7. **No new top-level routes and no IA refactors** without the designer's explicit ask (converging from 23 routes to 5–7).
8. **Never push or merge to `main`** without both devs. Never merge or close unrelated PRs. Force-push only your own task branch, with `--force-with-lease`.
9. **Never commit `docs/local/`. Never push `refs/entire/*`** (session transcripts stay local; the guard blocks it) and never wipe local Entire data.

## Session start

1. **Base check.** The SessionStart hook prints whether you are behind the personal branch; reconcile before editing. Note whether `origin/develop` moved.
2. **Read little, read the right thing:** [docs/gotchas.md](./docs/gotchas.md) (index of trap areas), then **`docs/gotchas/<area>.md` and the last five entries of `docs/decisions/<area>.md` for the area you touch**. What is ready to build is a query, `bun run next`, not a file. [docs/decisions.md](./docs/decisions.md) is a generated index for people; [specs/BUILD_LOG.md](./specs/BUILD_LOG.md) is finished history. For why code exists, `entire search` / `entire why` are faster.
3. **Read `docs/local/` if it exists** (the gitignored personal layer); never require it.
4. **Title the session** the moment its purpose is clear: write one line to `.claude/SESSION_TITLE` (gitignored; a SessionStart hook applies it). Planning: `[<Module>] <short title>`. Building: `[<Module> <BLOCK-ID>] <block name>`.

## Working posture

Two operators, one switch. `docs/local/OPERATOR` (gitignored; the preflight prints it) holds **`designer`** (the default: Maciej, authoritative on product, UX, edge cases, scope and priorities, not on infrastructure, data models or testing) or **`engineer`** (Mike: wants the agent to push through and raise product-code tradeoffs against working code). The machine gates are identical in both modes; only how much the agent asks, and when, changes.

- **Plan (`/s1`, read-only):** designer mode grills exhaustively on product behavior (50–100 questions up front, each with a recommended answer); engineer mode asks 10–20 product-code questions and records the rest as assumptions. **Never ask the designer implementation, infra, data-model or library questions**: research and decide them, and record decision + assumption in the spec. Surface a technical choice only when the user would feel it, in product terms, with a recommendation. Take the **first two blocks** to Definition-of-Ready ([specs/_template.md](./specs/_template.md)); later blocks may carry low-confidence assumptions with a named verification step.
- **Execute (`/s2`, autonomous):** stay silent between tool calls; build the block's oracle (one test per acceptance criterion) first; pass `bun run verify` and the `validator` (no BLOCKER/MAJOR); write the sitting checklist for a user-visible change (`docs/testing/<ISO-week>/<ID>.md`); then **land it on the personal branch yourself** (Tier 0/1 diffs; Tier 2 stops for the deep review; the `develop` sync belongs to `/s3`). Report once, as the PR body: a **Status** line, then **Changed · Test this · To finish this block** (+ **❓ Needs you / ⚠ Broke / 🔎 Found, not needed for this block** when they apply) and a **Session** line. Every low-confidence assumption you built on goes under ❓ Needs you with what you did and what a different answer changes. One block per session; never leave unlanded work only in the worktree. The only mid-run interruption is a hard blocker research can't resolve.
- **Wrap (`/s3`):** what `/s2` couldn't land (Tier 2 gates, work done outside `/s2`), **the `develop` sync once per batch**, the **sitting checklist** when `/s2` didn't write it (`docs/testing/<ISO-week>/<ID>.md`, [template](./docs/testing/TEMPLATE.md): questions with an expected observation, live-verified first), decisions + gotchas; then `bun run next` for what's ready. It edits the PR body instead of writing a second report.

## Models (Anthropic only, Claude Max plan, October 2026)

No other model providers. Pick by role, not "strongest everywhere"; raise effort only where a measured gain justifies it.

| Role | Model | Effort |
| --- | --- | --- |
| Main session, `/s1` planning, `/s2` building | Opus 5.5 (`opus`, the default) | `high` (set by the skills); `medium` for chat |
| Advisor during `/s2` (Max only) | Fable 5.1, via `/advisor fable` | n/a |
| The hardest plan syntheses (Max only) | Fable 5.1, via `/model fable` | `high` |
| `validator` subagent | Opus 5.5 | `high` |
| Read-only recon | built-in `Explore` subagent | default |
| `/goal` evaluator | Haiku 5.5 (automatic) | n/a |

On Max, Fable counts against at most half the weekly limit. On Pro it bills usage credits, so Pro users skip the advisor. `xhigh`/`max` only for long infra or migration work where you saw it help. Fast typed decision models (e.g. Jev) are not adopted: the product brief keeps AI MCP-only.

## Review gates

Pick the tier by what the diff touches; details and commands are in the `/s3` skill.

- **Tier 0, every block:** the block's oracle (its tests) + `bun run verify` + hooks + Rust LSP diagnostics, then the `validator` subagent and `/code-review high`. CI adds what a human used to check: the guard hooks' own tests (`bun run test:hooks`), the decisions-index check and `cargo check` when `src-tauri/` changed.
- **Tier 1, every PR into `develop`:** `/code-review high <PR>` on the PR plus the review checklist in [REVIEW.md](./REVIEW.md).
- **Tier 2, risky paths** (migrations, RLS/policies, contracts, `delete-account`, billing functions, `moduo-mcp`, `meet-*`, `src/lib/runtime*`, updater/signing, `.github/workflows`): add `/code-review ultra <PR>` and a `/claude-security` diff scan before merging.
- **Tier 3, promotion to `prod-app`:** the designer's manual checklist pass.

## Product north star (read before designing any module)

[docs/PRODUCT_BRIEF.md](./docs/PRODUCT_BRIEF.md) (what Moduo is, the connective-tissue spine, non-goals: no Notion-style databases, no abstract graph UI, one-gesture links, MCP-only AI, quiet notifications) · [docs/ROADMAP.md](./docs/ROADMAP.md) (waves, scored backlog, numbered open questions; check `§Open Questions & Risks` before anything marked ⚠) · [docs/data-layers.md](./docs/data-layers.md) (runtimes, Supabase-first, the spine). Edit these **before** code when direction changes. Module briefs: `.design/<module>/BRIEF.md` + `DESIGN_BRIEF.md`. A module is done only when it wires into the spine, ships its MCP tools and its dashboard widget ([module contract](./docs/moduo-module-contract.md)).

## Knowledge map

- **Architecture:** [docs/architecture.md](./docs/architecture.md) (code layout) · [docs/data-layers.md](./docs/data-layers.md) · [docs/moduo-module-contract.md](./docs/moduo-module-contract.md) · vocabulary: [docs/moduo-architecture-vocabulary.md](./docs/moduo-architecture-vocabulary.md).
- **Decisions:** full entries in `docs/decisions/<area>.md`; the index [docs/decisions.md](./docs/decisions.md) is generated. Add a decision as a full entry at the top of its area file, then `bun run gen:decisions-index` (CI fails on a stale index).
- **Gotchas:** index [docs/gotchas.md](./docs/gotchas.md), entries in `docs/gotchas/<area>.md`. Append when something costs you more than a few minutes; a trap that bites twice becomes a hook, lint rule or test (with the fix in its error message).
- **Execution ledger:** [specs/BUILD_ORDER.md](./specs/BUILD_ORDER.md) is the dependency graph (IDs, deps, lanes, focus); block **state** comes from PRs: a draft PR titled `[<ID>] …` claims a block, its merge finishes it, `bun run next` reads both. Nothing to tick. [specs/BUILD_LOG.md](./specs/BUILD_LOG.md) is finished history, regenerated by the gardener.
- **Agent setup:** [docs/agent-setup.md](./docs/agent-setup.md) · **Entire:** [docs/entire.md](./docs/entire.md).

## Stack

Tauri 2 + React 19 + Rsbuild + TanStack Router + Tailwind CSS v4, TypeScript 7, Bun. Supabase is the source of truth (cloud-first) on web and desktop; redb persists only the not-yet-migrated desktop modules. Lexical for rich text, Yjs for collaboration, XYFlow for the mindmap, Storybook 10 for components (with its MCP server), Rstest + Playwright for tests, Biome for JS lint/format.

## Build / dev

- `bun run dev:web` (http://127.0.0.1:8081) · `bun run dev:desktop` · `bun run build:web` / `build:desktop` · `bun run storybook` (port 6006)
- `bun run verify` = typecheck + Biome + lint:tw + lint:css + tests: **the block-done gate**. It covers no Rust: see `src-tauri/AGENTS.md`.
- `bun run next` (ready blocks, from the ledger graph + PR state) · `bun run test:hooks` (the guard hooks against fixtures) · `bun run gen:decisions-index`
- `bun test` / `bun run e2e`

## Repo layout (short)

`src/app/` composition and router · `src/routes/pages/` thin page adapters · `src/features/<feature>/` vertical slices (`ui`, `model`, `hooks`, `storage`/`sync`, `utils`) · `src/components/ui/` shadcn primitives (story required) · `src/components/app/` shell · `src/lib/` runtimes and platform services · `src/styles/tokens.css` tokens (**edit the token, never a component, to change a value**) · `src/tw/` React Native shim being phased out (new and edited chrome uses raw HTML; no repo-wide migration without an ask) · `src-tauri/` Rust · `supabase/` migrations + Edge Functions · `docs/` knowledge · `specs/` specs + ledger · `.design/` design briefs · `.claude/` skills, agents, hooks, settings.

## Git

Concise present-tense imperative subjects, single line preferred, Co-Authored-By trailer for agent-authored commits. Full contract: [CONTRIBUTING.md](./CONTRIBUTING.md).

- GitHub's default branch is `develop`. **Standing authorization:** after a bigger chunk lands on the personal branch, merge personal → `develop` yourself (`/s3` step 5b), unless the designer said to keep it on the task branch or the duplication guard finds overlap.
- `maciej` and `mike` are hot: integrate with merge commits, never fast-forward.

## Entire.io

Entire captures Claude Code sessions and links them to commits. Because the repo is public, checkpoints stay **local** (`push_sessions: false` in `.entire/settings.json`). Use it for your own work: `entire search "…"`, `entire why <file>:<line>`, `entire checkpoint explain`. Playbook: [docs/entire.md](./docs/entire.md).

## Domain contracts (Zod + enums)

Closed vocabularies (plan tier, task status, roles, link origins, …) live in `supabase/functions/_shared/contracts/` (`vocabularies.ts`, `primitives.ts`, `errors.ts`); app code imports `@contracts/*`, Edge Functions import relatively. To add or change a value: (1) const array + Zod schema + type in `vocabularies.ts`; (2) keep `parse*` (strict, writes), `normalize*` (lax, reads) and `is*` in lockstep; (3) migrate the Postgres CHECK/enum in the same change; (4) when a value dies, remove it everywhere, no zombie unions. Leave **open** strings alone (polymorphic entity types, renamable contact statuses, IMAP folders, Stripe events, opaque prefs). Never invent a parallel union in `src/features/*/model.ts`.

## Agent tooling (Claude Code)

- **Skills** (`.claude/skills/`): `/s1` plan · `/s2` build and land one block (inside `/goal`) · `/s3` wrap what didn't land · `moduo-design-quality` (design audit/polish/build). Plugins add the grilling, TDD and debugging skills `/s1`–`/s3` call, language servers (Rust diagnostics, TypeScript navigation), security scanning and Supabase rules; they are enabled for the project in `.claude/settings.json`.
- **Subagents** (`.claude/agents/`): `validator`, the skeptical staff review that gates every block.
- **Hooks** (`.claude/hooks/`): session preflight + title, notifications, Entire capture, and the three guards above.
- **MCP:** `supabase`, `vercel` in `.mcp.json` (`claude mcp login <name>` once per machine). GitHub work goes through the `gh` CLI.
- **Parallel work:** one block per session, each session in its own worktree; dispatch background lanes with `claude agents`. Audits and migrations across many files run as dynamic workflows (`ultracode`). Agent teams stay off.

## Personal layer

`docs/local/` (gitignored) holds personal, project-specific notes and the `OPERATOR` switch (`designer` | `engineer`). Read it if present, never fail if absent, never commit it. Machine-global personal rules go in `~/.claude/CLAUDE.md`.

## Out of scope right now

Mobile/tablet layouts (desktop only, min window 1024×700) · light-mode visual tuning · visuals of the non-anchor pages · route renames and page merges.
