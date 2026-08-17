# Agent setup — Cursor, OpenCode & Claude Code

How to run the agent workflow ([AGENTS.md](../AGENTS.md)) unsupervised. **One instruction file:** `AGENTS.md` is what Cursor, OpenCode, and Claude Code all load (Claude Code via the `CLAUDE.md` pointer). Cursor also has a short always-on rule in `.cursor/rules/moduo-always.mdc` that points here.

The workflow itself (skills, spec template, execution ledger) is committed and shared; this doc covers the per-machine setup each person does once.

## Cursor

Mike's IDE. Project instructions: `AGENTS.md` + `.cursor/rules/moduo-always.mdc`. Entire hooks live in `.cursor/hooks.json` (installed via `entire agent add cursor`). Do not treat Cursor-only rules as the source of truth — edit `AGENTS.md` first.

## OpenCode

**What the repo provides (committed):**

- `AGENTS.md` — auto-loaded project instructions.
- `.opencode/commands/` — the `/s1` `/s2` `/s3` slash-commands (thin wrappers over the shared skills in `.claude/skills/`, which OpenCode also discovers).
- `.opencode/agents/validator.md` — the skeptical-senior review subagent `/s2` runs before reporting done.
- `opencode.json` — the project's MCP servers: `supabase`, `subframe`, `notion`.

**One-time per machine:**

1. **MCP auth.** Each remote MCP server needs a browser OAuth once:
   ```sh
   opencode mcp auth supabase
   opencode mcp auth subframe
   opencode mcp auth notion
   opencode mcp list   # check status anytime
   ```
   Tokens are stored in `~/.local/share/opencode/mcp-auth.json`.
2. **Notifications (the at-desk signal).** Create/edit `~/.config/opencode/tui.json`:
   ```json
   { "$schema": "https://opencode.ai/tui.json", "attention": { "enabled": true, "notifications": true } }
   ```
   This fires a native desktop notification when a session goes idle or needs input — the OpenCode equivalent of the Claude Code Stop/Notification hooks.
3. **Permissions.** OpenCode's default allows routine operations without prompting, which is what `/s2` expects. To tighten (e.g. ask on edits/bash), set `permission` in `~/.config/opencode/opencode.json` — see the OpenCode permissions docs.
4. **Personal rules (optional).** `~/.config/opencode/AGENTS.md` for machine-global personal rules; `docs/local/` for project-personal notes (gitignored — see AGENTS.md §Personal layer).

## Claude Code

**What the repo sets up (committed):**

- `CLAUDE.md` → points at `AGENTS.md`.
- `.claude/skills/` — the `/s1` `/s2` `/s3` + `moduo-design-quality` skills (shared with OpenCode; edit them once, both tools get the change).
- **Lifecycle hooks** — `.claude/settings.json` + `.claude/hooks/`:
  - **SessionStart** → a preflight that warns when the branch is behind the personal base (stale specs/tokens risk).
  - **Stop hook** → a desktop notification when a block finishes ("ready for your review").
  - **Notification hook** → a desktop notification when Claude is blocked waiting on your input.
  - The notify script is cross-platform and always exits 0, so it can never block a session. Hooks **merge** with user-level hooks. First time they change, Claude Code asks you to approve them — expected.

**What only you can toggle (user-level / in-app):**

| Setting | What it does | Recommended |
| --- | --- | --- |
| **Auto mode** | Removes routine permission prompts but keeps the safety classifier. Toggle with the mode selector / `Shift+Tab`. A repo cannot enable it for itself — by design. | On, for `/s2` runs |
| **`agentPushNotifEnabled`** | Phone push when a long task finishes (needs Remote Control connected). | On |
| **`inputNeededNotifEnabled`** | Phone push when Claude is waiting on your input. | On |

These give the *away-from-desk* signal; the repo hooks give the *at-desk* desktop notification.

## The unsupervised flow (any of the three)

1. `/s1` → grill + spec + execution blocks → "Ready to execute." (read-only; use your tool's plan mode if it has one)
2. Approve → switch to the tool's autonomous mode.
3. `/s2` one block. It builds, runs `bun run verify`, runs the validator, and reports. Notifications tell you it's done.
4. You test, approve the next block. Task branches merge to the personal branch, then **bigger chunks to `develop`** (`/s3` step 5b). Nothing hits `main` until a release.
5. `/s3` at the end (personal merge + develop sync).

The only two things you ever manage: **the work plan** and **your subscription limits.**
