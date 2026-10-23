# Agent setup — Claude Code

How to run the agent workflow ([AGENTS.md](../AGENTS.md)) unsupervised. Moduo is built with **Claude Code only**, on Anthropic models (Claude Max plan). `AGENTS.md` is the single instruction file: Claude Code reads it natively (v2.1.277+), and there is deliberately no `CLAUDE.md`. Folder-level `AGENTS.md` files load when work touches `supabase/`, `apps/desktop/src-tauri/`, `apps/app/src/components/ui/` or `.github/`.

## What the repo provides (committed)

- **Skills** (`.claude/skills/`): `/s1` plan, `/s2` build one block, `/s3` wrap and land, `moduo-design-quality`, `moduo-agent` (a link into `tools/claude-plugins/moduo-agent/`; see §Moduo connector).
  - `libraries-dev` (third-party, MIT, `LICENSE` inside): the free [Libraries.dev](https://libraries.dev) skill for seven React UI-effect packages (`border-beam`, `thinking-orbs`, `liquid-gooey`, `voice-glow`, `bot-avatars`, `metal-fx`, `img-fx`). Commands: `libraries reveal` (list), `libraries review` (read-only fit scan), `libraries apply` (install one; it asks before adding a package). Its package-manager check looks for `bun.lockb` and misses our `bun.lock`, so it would fall back to npm: install with `bun add` only. Colour comes mostly from named palettes (`colorVariant`, `preset`, `theme`), which are the libraries' own colours, not our tokens; the two props that take a colour (`Liquid` `fill`, `MetalText` `color`) must get a value from `tokens.css`, never hex in code. Copied verbatim from [Jakubantalik/Libraries.dev](https://github.com/Jakubantalik/Libraries.dev/tree/main/skills/libraries-dev) at commit `bfcb863` (2026-10-17). Don't edit it in place: to update, copy the folder again from upstream as plain files and bump the commit here. The Pro skill (`npx libraries-dev skill --pro`) is a paid swap the designer would run.
- **Subagent** (`.claude/agents/validator.md`): the skeptical staff review; runs on Tier 2 diffs only (see AGENTS.md §Review gates).
- **Plugins** (enabled in `.claude/settings.json`, installed for you on first trust):
  - `mattpocock-skills`: grilling, prototype, to-tickets, tdd, diagnosing-bugs, handoff, retro, improve-codebase-architecture. Configured through [docs/agents/](./agents/).
  - `supabase` + `postgres-best-practices`: Supabase and Postgres/RLS rules.
  - `claude-security`: a deep vulnerability scan of a diff or the repo (paused until beta).
  - `security-guidance`: reviews Claude's own edits for security issues.
  - `rust-analyzer-lsp`: Rust diagnostics after every edit.
  - `ts7-lsp` (ours, from `tools/claude-plugins/`, marketplace `moduo-local`): TypeScript 7's own language server (`tsc --lsp`) for go-to-definition, references, hover and symbols. It reports no type errors after edits; `bun run typecheck` does.
  - `skill-creator`: evals for our own skills.
- **Hooks** (`.claude/hooks/`, wired in `.claude/settings.json`):
  - `session-start.sh`: stale-base preflight, plus a warning when the session works in the shared main checkout or runs bypass outside the lane sandbox (no reading list). `session-title.sh` applies `.claude/SESSION_TITLE`.
  - `guard-git.sh`: blocks direct pushes to `develop`, deleting or force-pushing `develop`/`mike`/`maciej`, bare force-pushes, and branch switches in the main checkout while another Claude session works in it (tests: `guard-git.test.sh`).
  - `guard-glob.sh`: blocks a command with an unquoted glob that matches nothing (zsh would stop it with "no matches found", e.g. `--include=*.md`) and prints the quoted command.
  - `guard-lane.sh`: stops a session running bypass outside the lane sandbox, and in lanes denies production deploys and pushes to prod.
  - `guard-release.sh`: blocks release tag pushes and prod workflow runs without `/ship`'s one-time marker.
  - `guard-secrets.sh`: gitleaks scan of staged changes on every commit.
  - `guard-prod-db.sh`: asks before any Supabase MCP `apply_migration` / `execute_sql` / `deploy_edge_function`.
  - `guard-design-tokens.sh`: re-runs `lint:tw` + `lint:css` after UI edits, and wakes Claude only on a violation.
  - `notify.sh`: desktop notifications when a block finishes or Claude needs you.
  - `moduo-report.sh` (in `tools/claude-plugins/moduo-agent/hooks/`): Moduo presence, "online" at session start and "idle" at each stop, on the task this worktree claimed (see §Moduo connector).
  - Entire capture hooks.
  - Every guard fails closed (`onFailure: "block"` with a timeout): a guard that crashes, times out or can't find `jq` blocks the command it guards. All hook tests run in `verify` through `scripts/agent/hooks.test.ts`; the settings contract is `scripts/agent/settings.test.ts`.
- **Permission modes:** interactive sessions use **auto mode**. Claude Code ignores `defaultMode: "auto"` in project settings, so run `bun run agent:auto-mode` once per machine (writes it to `~/.claude/settings.json`) and pick Auto in the desktop app. Bypass runs only in unattended lanes inside the `srt` sandbox: `bash scripts/agent/lane.sh "<prompt>"` (needs `npm install -g @anthropic-ai/sandbox-runtime`; profile `.claude/sandbox/lane.srt.json`, lane rules `.claude/settings.lane.json`). A one-machine stopgap while you switch: `"env": {"MODUO_ALLOW_BYPASS": "1"}` in your own `.claude/settings.local.json`.
- **`/ship` is user-only** (`disable-model-invocation`): only a person typing it starts a release.
- **Permissions:** `.env` files can't be read, and production deploys and migrations (`supabase db push`, `supabase db query --linked`, `supabase functions deploy`, `az deployment … create`, Supabase MCP `apply_migration` / `execute_sql` / `deploy_edge_function`) always ask first.
- **MCP servers** (`.mcp.json`): `supabase` (scoped to the Moduo project) and `moduo`, our own connector (see §Moduo connector). Vercel's was removed with Vercel (PLAT-8); Cloudflare is driven by `wrangler` in CI. There is no GitHub MCP: GitHub's server rejects Claude Code's sign-in (no dynamic client registration), and agents use the `gh` CLI for everything GitHub.
- **Review rules** ([REVIEW.md](../REVIEW.md)) and the risk tiers in `/s3`.

## What GitHub and the cloud provide

- **Branch ruleset** "Protect main and develop": both change only through a pull request whose `static-checks` job (`checks.yml`: verify, `bun lint`, gitleaks) passed. Force-pushes and deletion are blocked, and nobody bypasses it. `/s3` waits for the check before merging into `develop`. Personal and task branches are unprotected.
- **Weekly knowledge gardener**, a Claude Code routine (Mondays 07:07 Warsaw, Sonnet 5.5, Anthropic cloud). It re-syncs the decisions and gotchas indexes, moves finished blocks to `BUILD_LOG.md`, lists possibly superseded decisions, duplicate gotchas and hook candidates, and opens one PR into `mike` for review. It never merges. Manage it at [claude.ai/code/routines](https://claude.ai/code/routines). It needs the [Claude GitHub App](https://github.com/apps/claude) installed on the repo to push.

## One-time setup per machine

1. **Claude Code ≥ 2.1.277** (`claude update`), signed in with your claude.ai account (Max).
2. **gitleaks** for the commit guard: `brew install gitleaks`.
3. **rust-analyzer** on PATH for Rust diagnostics: `rustup component add rust-analyzer`. The TypeScript server needs nothing extra: it runs from `node_modules` after `bun install`.
4. **MCP auth**, once per server: `claude mcp login supabase`. `gh auth login` for GitHub.
   - **If you already connected Supabase as a claude.ai connector** (it also works in cloud routines), turn off the project copy on your machine so Claude doesn't load the same tools twice: in `.claude/settings.local.json` set `"disabledMcpjsonServers": ["supabase"]`. The `guard-prod-db.sh` hook asks before production writes through either route. The Supabase plugins bring two more copies (`plugin:supabase:supabase`, `plugin:postgres-best-practices:supabase`); turn those off in `/mcp`. The plugins' skills keep working.
   - **Storybook MCP** (optional, for UI work): `claude mcp add --transport http storybook http://localhost:6006/mcp`. It works only while `bun run storybook` runs, and gives Claude component docs, props and story previews.
5. **Trust the project** when Claude Code asks; that installs the project plugins and the Supabase skills marketplace.
5b. **Moduo connector** (optional, recommended): your agent's key, see §Moduo connector.
6. **Max plan only:** `/advisor fable`, which lets Fable 5.1 advise Opus 5.5 at decision points (saved in your user settings). On Pro, skip it: Fable bills usage credits there.
7. **Auto mode** for `/s2` runs (the default for new sessions on Pro and Max). Phone pushes need `agentPushNotifEnabled` / `inputNeededNotifEnabled` plus Remote Control.
8. **Personal notes** (optional): `docs/local/` (gitignored), or machine-wide rules in `~/.claude/CLAUDE.md`.

## Moduo connector (agents phase 0: dogfood)

Our agents track their build work in Moduo through our own connector, `moduo-mcp`: Mike's agent is **MichaśAI**, Maciej's **MaciuśAI**. `/s2` takes the block's task in the dogfood workspace's **Build** project and posts "working · step n of 7" with the draft PR; `/s3` posts "ready" with the PR and a summary, and completes the task after the merge; hand-offs to the other founder are comments on that task, never instructions to their agent ([decision](decisions/workflow.md), 2026-10-20). Without the key, every Moduo step is skipped and nothing else changes.

**Once per person:**

1. In the dogfood workspace: **Workspace settings → API keys → New key**. Name it after your agent (**MichaśAI** or **MaciuśAI**, so the trail reads "Mike · via MichaśAI"). Scopes: **Tasks, Notes, Links and Chat at Edit**, everything else **None**. Expiry: **90 days**. Copy the `moduo_sk_…` key; it is shown once.
2. Export two variables where Claude Code starts (your shell profile, e.g. `~/.zshrc`, or `env` in `~/.claude/settings.json`), **never in the repo**:
   ```bash
   export MODUO_MCP_KEY=moduo_sk_…        # the key from step 1
   export MODUO_AGENT_NAME="MichaśAI"     # or "MaciuśAI": your name on the status line
   ```
   Then restart Claude Code (desktop: quit and reopen, so it picks up the profile).
3. Approve the project's `moduo` server when Claude Code asks (or in `/mcp`).
4. **Check:** ask Claude to call the `moduo` server's `tasks_list` with `assignee: "me"`. Your open tasks come back. A "Missing, invalid, revoked or expired API key" error means the variable didn't reach Claude Code.
5. When the key expires (90 days), make a new one with the same name and swap the variable.

**Without a key:** the `moduo` server shows as failed in `/mcp` and everything else works. To hide it, add `"disabledMcpjsonServers": ["moduo"]` to `.claude/settings.local.json`.

**Testing the connector itself** runs against the local stack, never the dogfood workspace. Register it only on your machine, named `moduo-local`, with a key made in the local app (`bun run local:up`):
```bash
claude mcp add --scope local --transport http moduo-local http://127.0.0.1:54321/functions/v1/moduo-mcp --header "Authorization: Bearer ${MODUO_LOCAL_MCP_KEY}"
```
(`--scope local` keeps it out of git: it lands in your user config for this project, key included, so use a local-stack key only.)

**How the pieces fit** (all in `tools/claude-plugins/moduo-agent/`, laid out as a Claude Code plugin):
- `.mcp.json`: the `moduo` server. The root `.mcp.json` carries the same entry for phase 0; keep them equal.
- `skills/moduo-agent/SKILL.md`: pick up, checkpoint, needs you, hand back, finish, hand off. `.claude/skills/moduo-agent` links to it; `/s2` and `/s3` follow it.
- `hooks/moduo-report.sh` (+ `hooks.json` in plugin form): presence. It reads `.claude/MODUO_TASK` (gitignored; written by the skill: `task=MOD-123`, `state=working`, `step`, `steps`) and posts only while the state is `working`, in the background, with the key on stdin. Tests: `hooks/moduo-report.test.sh`, run in verify.
- Phase 2 (decision A9, needs Maciej) turns the folder into a plugin: add `.claude-plugin/plugin.json` and an entry in `.claude-plugin/marketplace.json`, hold the key as a sensitive plugin setting, and drop the root copies.

**The Build project** holds one task per open block in `specs/BUILD_ORDER.md`, titled `<ID> — <block name>`. The file stays the source of truth for the first two weeks; Moduo mirrors it. `/s2` creates a missing task; a task assigned to someone else is left alone.

## The unsupervised flow

1. **Day:** `/s1 <topic>`, the grilling, spec, blocks and Definition-of-Ready gate (read-only; plan mode works).
2. **Night shift:** one Claude Code desktop session per block (or a `claude agents` lane), each in its own worktree. Start each with the `/goal` template from the `/s2` skill, so the session keeps working until the block's definition of done holds. `/s2` claims its block with a draft PR, so parallel sessions never take the same one.
3. **Morning:** read each report's **Status** line first (Built, not landed · Blocked · Not started), then **Changed** and **Test this**, plus **❓ Needs you** / **⚠ Broke** when present. There is no manual checklist file: `/s3` puts Test this in the PR body, runs the validator on Tier 2 diffs only, merges into the personal branch, and syncs bigger chunks to `develop`.
4. **Large audits and migrations** across many files run as dynamic workflows (put `ultracode` in the prompt). Watch long CI or release runs with `/loop`.

The only two things you manage: **the work plan** and **your plan limits**.
