# Agent tooling (Claude Code)

Moved out of AGENTS.md on 2026-11-26 so it loads only when a session needs it. Setup per machine: [agent-setup.md](../agent-setup.md).

## Context budget

What a session carries before it reads any code is budgeted, because a larger start costs steps and attention on every task (measured 2026-11-26: about 100k tokens at the first model call, 165k at the first edit).

- **AGENTS.md stays under 6 KB** and every path rule under its recorded size (`lint:rules`; new rules get 2.5 KB). Put detail in a skill, a path rule or `docs/`.
- **Skill descriptions are capped at 300 characters** in the listing (`skillListingMaxDescChars` in `.claude/settings.json`). The first sentence of a skill's description must say when to use it.
- **Plugins that aren't used here are off for the project** (`enabledPlugins` in `.claude/settings.json`): `claude-security` (paused until beta) and `skill-creator`. Turn one on in your own `.claude/settings.local.json` for the session that needs it.
- **Personal plugins, skills and MCP servers from other work** cost every Moduo session too. Switch them off for this project in your gitignored `.claude/settings.local.json`: `skillOverrides` (`"off"` per skill) and `deniedMcpServers`.
- **Code Mode** (`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` in your user settings' `env`) roughly halves the start, because tool definitions stay out of context. It can't drive Claude in Chrome or computer use.
- **Knowledge is opened in slices:** `bun run docs:find <area> <words>` for decisions, the block's brief for a spec, `scout` for recon. Never read a whole area file or a whole spec.
- **`bun run verify` prints failures only**; `bun run verify:full` streams everything.
- The weekly numbers (`bun run numbers`) report the start, the first edit and the peak per session, from this machine's transcripts (token counts only).

- **Skills** (`.claude/skills/`): `/s1` plan · `/s2` build one block (inside `/goal`) · `/s3` wrap and land · `/ship` release to prod (`/ship vX.Y.Z` finishes a handed-off release) · `moduo-design-quality` (design audit/polish/build; the house rules the next three read) · `/product-studio` (criticise, improve or rethink a module; the output is always one Claude Artifact, an interactive prototype with its rationale and blind-critic score, never code; "Turn into spec" hands it to `/s1`; its engines `product-lab` (evidence in gitignored `.lab/`, `e2e/lab/lab.config.ts`, `delta.mjs` for PR deltas) and `product-jury` (blind critics) are not commands of their own) · `moduo-agent` (mirrors your block into Moduo: take the task, post status, hand off; `/s2` and `/s3` call it) · `libraries-dev` (third-party Libraries.dev UI effects: `libraries review`/`apply`; new packages need the designer's OK, token rules still win) · `variant-hunt` (one fix commit or `benchmarks/escapes/<id>` in, sibling bugs out, each proven by a parked failing test; never fixes). Plugins add the grilling, TDD and debugging skills `/s1`–`/s3` call, language servers (Rust diagnostics, TypeScript navigation), security scanning and Supabase rules; they are enabled for the project in `.claude/settings.json`.
- **Subagents** (`.claude/agents/`): `validator`, the skeptical staff review that gates Tier 2 diffs; `scout`, read-only recon on Haiku (files, symbols, decisions, rules as `path:line`).
- **Routines** (`.claude/routines/`, `bun run routine list`): the nightly variant hunt, weekly retro and daily prod watch (Haiku, read-only, digest to Moduo chat) run as cloud routines; the weekly numbers as a scheduled task on Mike's Mac. Setup: [docs/agent-setup.md](../agent-setup.md) §Routines.
- **Hooks** (`.claude/hooks/`): session preflight + title, notifications, Entire capture, and the guards (`guard-git`, `guard-secrets`, `guard-design-tokens`, `guard-ast`, `guard-glob`, `guard-lane`, `guard-prod-db`, `guard-release`), which fail closed. From `scripts/agent/`: the lane router (`router.ts`) and the Haiku risk hook (`risk-hook.ts`, shadow only: it logs, never blocks; `--summary` reads the log).
- **Modes:** interactive sessions run in **auto mode** (`bun run agent:auto-mode` once per machine); bypass only in unattended lanes inside `srt` (`scripts/agent/lane.sh`).
- **MCP:** `supabase` in `.mcp.json` (`claude mcp login supabase` once per machine). `moduo`, our own connector and the **one Moduo connection** (`https://mcp.moduo.app`), mirrors `/s2`–`/s3` into the dogfood workspace with your agent's key from `MODUO_MCP_KEY` (skipped without it; setup in [docs/agent-setup.md](../agent-setup.md)); the local stack's connector under test is `moduo-local`. GitHub work goes through the `gh` CLI; Cloudflare through `wrangler` in the workflows ([docs/release.md](../release.md)).
- **Parallel work:** one block per session, each in its own worktree, claimed with a draft PR. Run them as Claude Code desktop sessions (the normal way) or background lanes via `claude agents`. An orchestrating session merges its sessions' PRs only when the user says so.
- **Task stages in Moduo** (block tasks live in the milestone projects **Closed alpha** (2 Nov), **Open alpha** (16 Nov) and **Beta & later**, one section per theme; the `Moduo` project holds undated bugs and ideas; a block's task is found by its ID in the title): Backlog → To do → Building → In review → Awaiting release → Shipped (plus Won't do). GitHub events move each hop (`moduo-sync.yml`: draft PR → Building, ready → In review, merged → Awaiting release, release tag → Shipped), never an agent; dependencies are "blocks" edges. Rules and tool calls: the `moduo-agent` skill.
- **Cross-dev hand-offs** go as a comment on the relevant Moduo task, addressed to the person (agents read task comments via `moduo-mcp`; the `moduo-agent` skill). Never instruct another person's agent to act. Audits and migrations across many files run as dynamic workflows (`ultracode`). Agent teams stay off.

## Entire.io

Entire captures Claude Code sessions and links them to commits. Because the repo is public, checkpoints stay **local** (`push_sessions: false` in `.entire/settings.json`). Use it for your own work: `entire search "…"`, `entire why <file>:<line>`, `entire checkpoint explain`. Playbook: [docs/entire.md](../entire.md).

## Personal layer

`docs/local/` (gitignored) holds personal, project-specific notes. Read it if present, never fail if absent, never commit it. Machine-global personal rules go in `~/.claude/CLAUDE.md`.
