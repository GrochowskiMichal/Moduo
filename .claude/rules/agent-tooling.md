---
paths: [".claude/settings.json", ".claude/hooks/**", ".claude/skills/**", ".claude/sandbox/**", "scripts/agent/**", "tools/claude-plugins/**"]
incident: "REL-3 pushed v1.2.0 before the guard hook it had just added was loaded (2026-10-19), and a `claude plugin install` dropped a marketplace from the project settings (2026-10-08)"
expires: 2027-01-31
---

# Agent tooling: settings, hooks, skills, lanes

Setup and machine quirks: [docs/agent-setup.md](../../docs/agent-setup.md).

- **A hook runs only from the next session.** Claude Code reads hooks at session start, so a hook added in this session doesn't guard this session. Test it with its own test script.
- **`/plugin` and `claude plugin …` rewrite `.claude/settings.json`** (reorder keys, and can delete an `extraKnownMarketplaces` entry also declared in user settings). Add project plugins by editing the JSON; after any plugin command, `git diff .claude/settings.json` and revert what you didn't mean.
- **Permission rules: only `Edit(<glob>)` matches file tools** (it covers Edit, Write and NotebookEdit); a `Write(<glob>)` rule is ignored. srt's `denyWrite` globs hold on macOS only (Linux srt skips write patterns), and its `allowLocalBinding` opens every localhost port (`scripts/harness-ab/srt-offline.mjs` closes them).
- **An `mcp_tool` hook can't carry state:** it never reaches the server on SessionStart or SessionEnd, `${SOME_ENV}` comes out empty and nothing reads a file; only `${cwd}`, `${session_id}` and `${hook_event_name}` fill in. Per-session data must resolve server-side from those.
- **Skills are plain files in `.claude/skills/<name>/`.** Copy a third-party skill in with its `LICENSE` and record the upstream commit in `docs/agent-setup.md`; never commit the `npx skills add` symlinks. Never name a skill after a built-in command (`/plan`, `/review`, `/verify`, …): the built-in wins. `scripts/ci/config-traps.test.ts` checks both.
- **Global skills (`~/.agents/skills/`, `~/.claude/skills/`) are shared with other projects.** Moduo-specific skills live in the repo only.
- **The Moduo connector slows to 7–20 s a call under bursts** and `connectorRpc` gives up at 20 s: keep bursts to about four calls and retry reads and idempotent writes (`retryingReads` in `scripts/agent/queue-import.ts`).
