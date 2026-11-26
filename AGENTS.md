# AGENTS.md

The map for coding agents in Moduo. It loads in every session, so it stays under 6 KB (`lint:rules`).
Procedures live in skills, area rules in `.claude/rules/` (each loads when you open a matching file), knowledge in `docs/`.
What must hold every time lives in hooks, lint and CI. Don't add a `CLAUDE.md` or folder `AGENTS.md` files.

## Must-hold rules

⛔ = a hook or CI blocks it. In full, with what enforces each: [rules.md](./docs/agents/rules.md).

1. ⛔ Branch before editing: `t/<owner>/<kebab>` off the latest personal branch (`mike`, `maciej`), never `develop`.
2. ⛔ The repo is public. No secrets, tokens, session files or customer data in git; private notes go in `docs/local/`.
3. ⛔ Tokens only in UI: no raw hex, arbitrary Tailwind values or inline-style design properties.
4. ⛔ Closed vocabularies live once, in `supabase/functions/_shared/contracts/`, with a matching Postgres CHECK.
5. Applied migrations are history: never edit one, add a new one.
6. Always `getRuntime()`, never a bare `{ runtime }` import. redb is paused: nothing new depends on it.
7. No new top-level routes and no IA refactors without the designer's explicit ask.
8. ⛔ Production ships only from a `vX.Y.Z` tag cut by `/ship`. Never merge or close unrelated PRs.
9. ⛔ Never commit `docs/local/`, never push `refs/entire/*`, never wipe local Entire data.
10. Never read a teammate's private Moduo data through the admin or service-role connection.
11. ⛔ Supabase writes ask first: migrations, SQL and function deploys.
12. Stage explicit paths, never `git add -A` or `git add <dir>`: another session may share the checkout.
13. ⛔ The local Supabase stack is shared: never reset or stop it, never clean up another session's rows.

## Session start

- The SessionStart hook says whether you are behind the personal branch. Reconcile before editing.
- Title the session once its purpose is clear: one line in `.claude/SESSION_TITLE`,
  `[<Module>] <title>` when planning or `[<Module> <BLOCK-ID>] <block>` when building.
- One task per session. Use a fresh session or `/clear` for an unrelated task.

## Working posture

The designer (Maciej) decides product, UX, edge cases, scope and priorities. Infrastructure, data models,
libraries and tests are yours: research, decide and record the assumption; never ask him those.
Mike (CTO) may run engineer mode: technical calls are yours, assumptions go under ❓ Needs you.
Before planning or building UI, read the [designer brief](./docs/agents/designer-brief.md).

**Two lanes.** The router hook suggests one; you decide.
- **Fast lane:** a change that fits one sentence. Branch, edit, run the checks it touches, open a PR with a
  short Test-this, merge into the personal branch on green. A bug fix starts with a failing test.
- **Block lane:** everything else. `/s1` plans (read-only) and writes a spec with a brief per block,
  `/s2` builds one block, `/s3` lands it. Blocks are tasks in Moduo (the queue is in Moduo): `bun run queue`.

Report once, at the end, and short: a **Status** line, **Changed · Test this**, and
**❓ Needs you / ⚠ Broke** only when they apply.

## Where things are

- **Decisions:** `bun run docs:find <area> <words>` prints the current decisions that match. Run it before
  you change behaviour in an area. Area files run to 600 KB: search them, never read one whole.
- **Traps:** `docs/gotchas/<area>.md`, a short map to the checks and path rules that hold each trap.
- **Product direction** (before designing a module, not before a fix): [brief](./docs/PRODUCT_BRIEF.md),
  [roadmap](./docs/ROADMAP.md), [data layers](./docs/data-layers.md), `.design/<module>/BRIEF.md`,
  [module contract](./docs/moduo-module-contract.md).
- **Code layout, stack, commands in full:** [architecture.md](./docs/architecture.md). App code is `apps/app/src/`.
  To change a visual value, edit `apps/app/src/styles/tokens.css`, never a component
  ([DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md), [DESIGN_RULES.md](./docs/DESIGN_RULES.md)).
- **Models, review tiers, CI:** [models-and-review.md](./docs/agents/models-and-review.md). Models are Anthropic only.
- **Skills, subagents, hooks, routines, MCP, Entire, the context budget:** [tooling.md](./docs/agents/tooling.md).
  Setup per machine: [agent-setup.md](./docs/agent-setup.md).
- **Git and PRs:** [CONTRIBUTING.md](./CONTRIBUTING.md). **Release** (`/ship` only): [release.md](./docs/release.md).
  **Local stack:** [local-dev.md](./docs/local-dev.md).
- **Personal notes:** `docs/local/`. Read it if present.

## Commands

- `bun run dev:web` · `bun run dev:desktop` · `bun run storybook`
- `bun run local:up` starts the local Supabase stack and points `.env.local` at it; `bun run env:cloud` goes back.
- `bun run verify` is the done gate: types, lint, format, tokens, boundaries, size and tests. It prints
  failures and the path of the full log. It covers no Rust: `.claude/rules/desktop-rust.md`.
- One app test: `bun run --cwd apps/app test <path>`. E2E: `scripts/agent/e2e.sh <playwright args>`.
- `bun scripts/ci/tier.ts origin/<personal-branch>` prints the diff's review tier. Tier 2 gets the `validator` subagent.
- Run root scripts from the root.

## Git

- Present-tense imperative subjects, one line, with a Co-Authored-By trailer on agent commits.
- `mike` and `maciej` are hot: integrate with merge commits, never fast-forward.
  Force-push only your own task branch, with `--force-with-lease`.
- Standing authorization: after a bigger chunk lands on the personal branch, merge personal → `develop`
  yourself, in batches (`/s3`).

## Sessions and tools

- Interactive sessions run in auto mode (`bun run agent:auto-mode` once per machine).
- MCP: `supabase`, and `moduo`, our own connector and the one Moduo connection (`https://mcp.moduo.app`).
- A hand-off to the other founder is a comment on the Moduo task. Never instruct another person's agent.

## Out of scope right now

Mobile and tablet layouts (desktop only, min 1024×700) · light-mode tuning · visuals of
non-anchor pages · route renames and page merges.
