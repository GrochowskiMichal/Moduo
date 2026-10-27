# Gotchas: Git, branching and Claude Code

Read before working in git, branches, skills, hooks, lanes. Index of all areas: [docs/gotchas.md](../gotchas.md).

Compiled on 2026-10-27 (HV-14c, specs/harness-v3.md AC30): every entry became an ast-grep rule, a test, a comment at the trap, a path rule or a doc, or was deleted as stale. A path rule loads by itself when you open a file it covers.

## Where the traps live now

- **Hooks and tests already holding them:** `guard-git.sh` and the SessionStart base check (stale bases, pushes to personal branches), the `refs/entire/*` push block (AGENTS.md rule 9), the draft-PR claim in `/s2` (two sessions on one block); [scripts/ci/config-traps.test.ts](../../scripts/ci/config-traps.test.ts) (skills as committed files, no built-in command names).
- **Path rules:** [agent-tooling](../../.claude/rules/agent-tooling.md) (hooks, permission rules, plugins, skills, srt, the Moduo connector), [e2e](../../.claude/rules/e2e.md) (one product lab per Mac).
- **Docs:** [docs/agent-setup.md](../agent-setup.md) §Known quirks (`.env.local` per worktree, OrbStack's Docker context, the active `gh` account, the TypeScript language server, the Bash guard).
- **Comments at the trap:** `scripts/local/env.ts`, `scripts/agent/queue-import.ts`, `scripts/agent/lane.sh`, `scripts/harness-ab/srt-offline.mjs`, `.claude/skills/product-lab/scripts/lab.mjs`.
- **Deleted as stale:** the OpenCode/`CLAUDE.md` note, the Biome-era lint note, and the Subframe MCP entries (no Subframe connector is configured).

## Open entries

None. A new trap goes here (the trap, why, what to do instead) only until it has a better home; one that bites twice becomes a hook, a lint rule or a test.
