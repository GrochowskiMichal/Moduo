# Entire.io — agent playbook

> **Since 2026-10-07 the repo is public, so checkpoints are local-only.** `.entire/settings.json` sets `push_sessions: false`, the 79 checkpoint refs that had been pushed were deleted from GitHub (all kept locally), and `guard-git.sh` blocks any push of `refs/entire/*`. `entire search`, `entire why` and `entire checkpoint explain` still work on each machine. To share checkpoints again, point Entire at a **private** repo: `entire configure --project --checkpoint-remote github:<owner>/<private-repo>`, then re-enable pushing.

Entire captures agent sessions and links them to git commits (checkpoints). The CLI is local; [entire.io](https://entire.io) is the browser. This repo is enabled (`entire status`).

## Why it matters here

GitHub's **default branch is `develop`**. Entire's **repo** Overview, Analytics, and Commits pages follow that branch. Home and Sessions list all branches, which is why work that never leaves `mike` / `maciej` / `t/*` looks "missing" on the repo charts even though it was captured.

So: land bigger chunks on `develop` (AGENTS.md + `/s3` step 5b). Do not change GitHub's default branch without an explicit ask.

## Use it while you work

Prefer Entire over re-deriving history:

| Need | Command |
| --- | --- |
| Why does this line exist? | `entire why path/to/file.ts:42` |
| Search past agent work | `entire search "plan_tier"` |
| What is this commit's session? | `entire checkpoint explain <sha-or-id>` |
| What is capturing right now? | `entire status` / `entire session list` |
| Machine-readable CLI help | `entire agent-help` |

`entire activity` is the personal (Home) view. It is not the repo Analytics page.

## Capture rules

- Hooks are installed for Claude Code (`.claude/settings.json`). A session starts when Claude Code starts; a checkpoint attaches on commit/push.
- Checkpoint blobs live in git as `refs/entire/checkpoints/…` (not on `main`/`develop` history). Do not delete those refs or `entire repo delete` unless the designer asked for a wipe.
- Do not put secrets in prompts if you can avoid it; redaction is best-effort.
- Both Maciej and Mike use Claude Code with the same `AGENTS.md`; capture is per machine.

## What Entire is not

It does not replace `docs/decisions.md` / `docs/gotchas.md`. It does not apply migrations. Repo Analytics empty ≠ capture broken — check whether the work is on `develop`.
