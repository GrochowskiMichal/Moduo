# Agent tooling (Claude Code)

Moved out of AGENTS.md on 2026-11-26 so it loads only when a session needs it. Setup per machine: [agent-setup.md](../agent-setup.md).

## Context budget

What a session carries before it reads any code is budgeted, because a larger start costs steps and attention on every task (measured 2026-11-26: about 100k tokens at the first model call, 165k at the first edit).

- **The budget for a session's first model call is 45k tokens** (`bun run numbers` reports it weekly).
- **AGENTS.md stays under 6 KB** and every path rule under its recorded size (`lint:rules`; new rules get 2.5 KB). Put detail in a skill, a path rule or `docs/`.
- **Skill descriptions are capped at 300 characters** in the listing (`skillListingMaxDescChars` in `.claude/settings.json`). The first sentence of a skill's description must say when to use it.
- **Plugins that aren't used here are off for the project** (`enabledPlugins` in `.claude/settings.json`): `claude-security` (paused until beta) and `skill-creator`. Turn one on in your own `.claude/settings.local.json` for the session that needs it.
- **Personal plugins, skills and MCP servers from other work** cost every Moduo session too. Switch them off for this project in your gitignored `.claude/settings.local.json`: `skillOverrides` (`"off"` per skill) and `deniedMcpServers`.
- **Code Mode** (`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` in your user settings' `env`) roughly halves the start, because tool definitions stay out of context. It can't drive Claude in Chrome or computer use.
- **Knowledge is opened in slices:** `bun run docs:find <area> <words>` for decisions, the block's brief for a spec, `scout` for recon. Never read a whole area file or a whole spec.
- **`bun run verify` prints failures only**; `bun run verify:full` streams everything.
- The weekly numbers (`bun run numbers`) report the start, the first edit and the peak per session, from this machine's transcripts (token counts only).

- **Skills** (`.claude/skills/`): `/s1` plan · `/s2` build one block (inside `/goal`) · `/s3` wrap and land · `/release` release to prod (`/release vX.Y.Z` finishes a handed-off release) · `moduo-agent` (mirrors your block into Moduo: take the task, post status, hand off; `/s2` and `/s3` call it) · `variant-hunt` (one fix commit or `benchmarks/escapes/<id>` in, sibling bugs out, each proven by a parked failing test; never fixes). Removed on 2026-11-26, in git history: `moduo-design-quality`, `product-studio` with its engines `product-lab` and `product-jury` (and the lab's config under e2e), `libraries-dev`, `security-audit`. Plugins add the grilling, TDD and debugging skills `/s1`–`/s3` call, language servers (Rust diagnostics, TypeScript navigation), security guidance and Supabase rules; they are enabled for the project in `.claude/settings.json` (`claude-security`'s scan and `skill-creator` are off there: see §Context budget).
- **Subagents** (`.claude/agents/`): `validator`, the skeptical staff review that gates Tier 2 diffs; `scout`, read-only recon on Haiku (files, symbols, decisions, rules as `path:line`).
- **Routines** (`.claude/routines/`, `bun run routine list`): the nightly variant hunt, weekly retro and daily prod watch (Haiku, read-only, digest to Moduo chat) run as cloud routines; the weekly numbers as a scheduled task on Mike's Mac. Setup: [docs/agent-setup.md](../agent-setup.md) §Routines.
- **Hooks** (`.claude/hooks/`): session preflight + title, notifications, Entire capture, and the guards (`guard-git`, `guard-secrets`, `guard-design-tokens`, `guard-ast`, `guard-glob`, `guard-lane`, `guard-prod-db`, `guard-release`), which fail closed. From `scripts/agent/`: the lane router (`router.ts`) and the Haiku risk hook (`risk-hook.ts`, shadow only: it logs, never blocks; `--summary` reads the log).
- **Modes:** interactive sessions run in **auto mode** (`bun run agent:auto-mode` once per machine); bypass only in unattended lanes inside `srt` (`scripts/agent/lane.sh`).
- **MCP:** `supabase` in `.mcp.json` (`claude mcp login supabase` once per machine). `moduo`, our own connector and the **one Moduo connection** (`https://mcp.moduo.app`), mirrors `/s2`–`/s3` into the dogfood workspace with your agent's key from `MODUO_MCP_KEY` (skipped without it; setup in [docs/agent-setup.md](../agent-setup.md)); the local stack's connector under test is `moduo-local`. GitHub work goes through the `gh` CLI; Cloudflare through `wrangler` in the workflows ([docs/release.md](../release.md)).
- **Seeing the app:** `bun run agent:login` makes the agent's own local person (`agent@moduo.local`, its own workspace and an "Agent demo" project) and saves its session to the gitignored `.auth/agent.json`; `bun run agent:look <route>…` opens each route signed in (this worktree's dev port, started if needed), saves a screenshot to `.auth/shots/` and prints console errors and failed requests (a 4xx/5xx console line repeats the request line above it). Read the screenshot before reporting UI work done. Local stack only (`scripts/agent/look.ts`).
- **Parallel work:** one block per session, each in its own worktree, claimed with a draft PR. Run them as Claude Code desktop sessions (the normal way) or background lanes via `claude agents`. An orchestrating session merges its sessions' PRs only when the user says so.
- **Task stages in Moduo** (block tasks live in the milestone projects **Closed alpha** (2 Nov), **Open alpha** (16 Nov) and **Beta & later**, one section per theme; the `Moduo` project holds undated bugs and ideas; a block's task is found by its ID in the title): Backlog → To do → Building → In review → Awaiting release → Shipped (plus Won't do). GitHub events move each hop (`moduo-sync.yml`: draft PR → Building, ready → In review, merged → Awaiting release, release tag → Shipped), never an agent; dependencies are "blocks" edges. Rules and tool calls: the `moduo-agent` skill.
- **Cross-dev hand-offs** go as a comment on the relevant Moduo task, addressed to the person (agents read task comments via `moduo-mcp`; the `moduo-agent` skill). Never instruct another person's agent to act. Audits and migrations across many files run as dynamic workflows (`ultracode`). Agent teams stay off.

## Product north star (read before designing any module)

[docs/PRODUCT_BRIEF.md](../PRODUCT_BRIEF.md) (what Moduo is, the connective-tissue spine, non-goals: no Notion-style databases, no abstract graph UI, one-gesture links, MCP-only AI, quiet notifications) · [docs/data-layers.md](../data-layers.md) (runtimes, Supabase-first, the spine). Edit these **before** code when direction changes. Module briefs: `.design/<module>/BRIEF.md` + `DESIGN_BRIEF.md`. A module is done only when it wires into the spine, ships its MCP tools and its dashboard widget ([module contract](../moduo-module-contract.md)).

## Knowledge map

- **Architecture:** [docs/architecture.md](../architecture.md) (code layout) · [docs/data-layers.md](../data-layers.md) · [docs/moduo-module-contract.md](../moduo-module-contract.md) · vocabulary: [docs/moduo-architecture-vocabulary.md](../moduo-architecture-vocabulary.md).
- **Decisions:** index [docs/decisions.md](../decisions.md) (generated, current entries only), full entries in `docs/decisions/<area>.md`; `bun run docs:find <area> <words>` returns the current entries on a subject and `bun run docs:current <area>` prints an area without its superseded entries (large: prefer `--titles`). Add a decision at the top of its area file with a `status:` line (a replacement names what it `supersedes:`), then `bun run docs:index`.
- **Path rules:** `.claude/rules/<area>.md`, frontmatter `paths:` (globs), `incident:` (what went wrong) and `expires:` (review date; `lint:rules` warns once it passes). Short must-know lines for that area only; detail stays in gotchas and decisions. Audit the set with `/doctor prompt-audit` in a session.
- **Gotchas:** index [docs/gotchas.md](../gotchas.md); the area files are now maps, because the traps were compiled into checks: the ast-grep pack (`tools/ast-grep/rules/`, `bun run lint:ast`), `scripts/ci/config-traps.test.ts`, migration lint and path rules. A new trap goes into its area file; one that bites twice becomes a hook, lint rule or test (with the fix in its error message).
- **Learn loop:** escapes in `benchmarks/escapes/` feed `variant-hunt`; the A/B rig and its arms (`bun run ab`, `scripts/harness-ab/`), the MCP agent-experience eval (`bun run mcp-eval`) and the docs eval (`bun run eval:docs`) measure harness changes before they land; `bun run numbers` writes the weekly outcome note to Moduo.
- **The queue:** `bun run queue` (Moduo's block tasks and their "blocks" edges + the dependency tables of any spec in `specs/` + open PRs; claim a block with a draft PR before building it); new blocks go in with `bun run queue:import specs/<feature>.md`. What to build and in what order lives only there: the roadmap and the build-order file were removed on 2026-11-26 (in git history at commit 246138366, under docs and specs).
- **No old specs in the repository.** Every spec written before 2026-11-26 was removed, shipped or not; a comment, a doc or a Moduo task that names `specs/<name>.md` means the version at commit 467d41c34 (`git show 467d41c34:specs/<name>.md`). A new feature still gets a spec: `/s1` writes it from its template into `specs/`, with a brief per block, and it is deleted once its blocks have shipped.
- **Agent setup:** [docs/agent-setup.md](../agent-setup.md) · **Entire:** [docs/entire.md](../entire.md).

## Entire.io

Entire captures Claude Code sessions and links them to commits. Because the repo is public, checkpoints stay **local** (`push_sessions: false` in `.entire/settings.json`). Use it for your own work: `entire search "…"`, `entire why <file>:<line>`, `entire checkpoint explain`. Playbook: [docs/entire.md](../entire.md).

## Personal layer

`docs/local/` (gitignored) holds personal, project-specific notes. Read it if present, never fail if absent, never commit it. Machine-global personal rules go in `~/.claude/CLAUDE.md`.
