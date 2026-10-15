# Agent setup — Claude Code

How to run the agent workflow ([AGENTS.md](../AGENTS.md)) unsupervised. Moduo is built with **Claude Code only**, on Anthropic models (Claude Max plan). `AGENTS.md` is the single instruction file: Claude Code reads it natively (v2.1.277+), and there is deliberately no `CLAUDE.md`. Folder-level `AGENTS.md` files load when work touches `supabase/`, `src-tauri/`, `src/components/ui/` or `.github/`.

## What the repo provides (committed)

- **Skills** (`.claude/skills/`): `/s1` plan, `/s2` build and land one block, `/s3` wrap what didn't land, `moduo-design-quality`.
- **Scripts the workflow runs:** `bun run next` (what is ready to build: the dependency graph in `specs/BUILD_ORDER.md` plus PR state, so a block is claimed by its draft PR and done by its merge), `bun run test:hooks` (the guard hooks against fixtures; CI runs it), `bun run gen:decisions-index` (regenerates `docs/decisions.md`; CI fails when it is stale).
- **Subagent** (`.claude/agents/validator.md`): the skeptical staff review `/s2` runs before a block counts as done.
- **Plugins** (enabled in `.claude/settings.json`, installed for you on first trust):
  - `mattpocock-skills`: grilling, prototype, to-tickets, tdd, diagnosing-bugs, handoff, retro, improve-codebase-architecture. Configured through [docs/agents/](./agents/).
  - `supabase` + `postgres-best-practices`: Supabase and Postgres/RLS rules.
  - `claude-security`: a deep vulnerability scan of a diff or the repo.
  - `security-guidance`: reviews Claude's own edits for security issues.
  - `rust-analyzer-lsp`: Rust diagnostics after every edit.
  - `ts7-lsp` (ours, from `tools/claude-plugins/`, marketplace `moduo-local`): TypeScript 7's own language server (`tsc --lsp`) for go-to-definition, references, hover and symbols. It reports no type errors after edits; `bun run typecheck` does.
  - `skill-creator`: evals for our own skills.
- **Hooks** (`.claude/hooks/`, wired in `.claude/settings.json`):
  - `session-start.sh`: stale-base preflight, the operator mode and the reading list. `session-title.sh` applies `.claude/SESSION_TITLE`.
  - `guard-git.sh`: blocks direct pushes to `main`/`develop`/`prod-app`/`staging-app` and bare force-pushes.
  - `guard-secrets.sh`: gitleaks scan of staged changes on every commit.
  - `guard-design-tokens.sh`: re-runs `lint:tw` + `lint:css` after UI edits, and wakes Claude only on a violation.
  - `notify.sh`: desktop notifications when a block finishes or Claude needs you.
  - Entire capture hooks.
- **Permissions:** `.env` files can't be read, and production deploys and migrations (`supabase db push`, `supabase functions deploy`, `az deployment … create`, Supabase MCP `apply_migration` / `execute_sql` / `deploy_edge_function`) always ask first.
- **MCP servers** (`.mcp.json`): `supabase` (scoped to the Moduo project), `vercel`. There is no GitHub MCP: GitHub's server rejects Claude Code's sign-in (no dynamic client registration), and agents use the `gh` CLI for everything GitHub.
- **Review rules** ([REVIEW.md](../REVIEW.md)) and the risk tiers in `/s3`.

## What GitHub and the cloud provide

- **Branch ruleset** "Protect main and develop": both change only through a pull request whose `static-checks` job (`checks.yml`: verify, Biome, gitleaks, hook tests, decisions-index check) passed. A second job, `rust-check`, runs `cargo check`, `cargo check --features lite` and `cargo test --lib` whenever `src-tauri/` changes. Force-pushes and deletion are blocked, and nobody bypasses it. `/s3` waits for the check before merging into `develop`. Personal and task branches are unprotected.
- **Weekly knowledge gardener**, a Claude Code routine (Mondays 07:07 Warsaw, Sonnet 5.5, Anthropic cloud). Its steps, since 2026-10-10: (1) `bun run gen:decisions-index` and re-sync the gotchas index counts; (2) move every block whose `[<ID>]` PR merged (`bun run next --all --json` lists what is still open) from `specs/BUILD_ORDER.md` to the same section of `specs/BUILD_LOG.md`, collapsing sections with nothing left; (3) archive week folders and loose files under `docs/testing/` untouched for two weeks into `docs/testing/archive/`; (4) list possibly superseded decisions, duplicate gotchas and hook candidates; (5) tally PR `outcome:*` labels for the week. It opens one PR into `mike` for review and never merges. Manage it at [claude.ai/code/routines](https://claude.ai/code/routines); **its prompt there still has to be updated to these steps.** It needs the [Claude GitHub App](https://github.com/apps/claude) installed on the repo to push.

## One-time setup per machine

1. **Claude Code ≥ 2.1.277** (`claude update`), signed in with your claude.ai account (Max).
2. **gitleaks** for the commit guard: `brew install gitleaks`.
3. **rust-analyzer** on PATH for Rust diagnostics: `rustup component add rust-analyzer`. The TypeScript server needs nothing extra: it runs from `node_modules` after `bun install`.
4. **MCP auth**, once per server: `claude mcp login supabase`, then `vercel`. `gh auth login` for GitHub.
   - **If you already connected Supabase or Vercel as claude.ai connectors** (they also work in cloud routines), turn off the project copies on your machine so Claude doesn't load the same tools twice: in `.claude/settings.local.json` set `"disabledMcpjsonServers": ["supabase", "vercel"]`. The `guard-prod-db.sh` hook asks before production writes through either route. The Supabase plugins bring two more copies (`plugin:supabase:supabase`, `plugin:postgres-best-practices:supabase`); turn those off in `/mcp`. The plugins' skills keep working.
   - **Storybook MCP** (optional, for UI work): `claude mcp add --transport http storybook http://localhost:6006/mcp`. It works only while `bun run storybook` runs, and gives Claude component docs, props and story previews.
5. **Trust the project** when Claude Code asks; that installs the project plugins and the Supabase skills marketplace.
6. **Max plan only:** `/advisor fable`, which lets Fable 5.1 advise Opus 5.5 at decision points (saved in your user settings). On Pro, skip it: Fable bills usage credits there.
7. **Auto mode** for `/s2` runs (the default for new sessions on Pro and Max). Phone pushes need `agentPushNotifEnabled` / `inputNeededNotifEnabled` plus Remote Control.
8. **Operator mode:** write `designer` or `engineer` to `docs/local/OPERATOR` (gitignored; the default is `designer`). It changes how much the agent asks and when, never the gates: see AGENTS.md §Working posture. `MODUO_OPERATOR=engineer` overrides it for one shell.
9. **Personal notes** (optional): elsewhere in `docs/local/` (gitignored), or machine-wide rules in `~/.claude/CLAUDE.md`.
10. **Verify the harness itself** on a new machine: `bun run test:hooks` (needs gitleaks), then the short human list in [docs/testing/harness-v2.md](./testing/harness-v2.md).

Once-only chores still open from the 2026-10-07 harness move: revoke the old Modal key at Modal (it remains in git history); install the Claude GitHub App so the gardener can push.

## The unsupervised flow

1. **Day:** `/s1 <topic>`, the grilling, spec, blocks and Definition-of-Ready gate (read-only; plan mode works).
2. **Night shift:** one session per block, each in its own worktree (dispatch from `claude agents` or the desktop app). `bun run next` says what is ready. Start each with the `/goal` template from the `/s2` skill, so the session keeps working until the block is done **and landed** on the personal branch. `/s2` claims its block with a draft PR, so parallel sessions never take the same one, and merges it itself unless the diff is Tier 2.
3. **Morning, one sitting:** read each PR body's **Status** line first (Landed · Built, not landed · Blocked), then **❓ Needs you** (the product-code decisions the agent built on an assumption) and **To finish this block**. Run the week's sitting checklists (`docs/testing/<ISO-week>/*.md`, one per landed PR, written by `/s2`) at the surfaces. `/s3` once for the batch: the `develop` sync, any Tier 2 review, and checklist/memory for work done outside `/s2`.
4. **Large audits and migrations** across many files run as dynamic workflows (put `ultracode` in the prompt). Watch long CI or release runs with `/loop`.

The only two things you manage: **the work plan** and **your plan limits**.
