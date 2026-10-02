# Entire.io — agent playbook

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

- Hooks are installed for Cursor, OpenCode, and Claude Code. A session starts when the agent starts; a checkpoint attaches on commit/push.
- Checkpoint blobs live in git as `refs/entire/checkpoints/…` (not on `main`/`develop` history). Do not delete those refs or `entire repo delete` unless the designer asked for a wipe.
- Do not put secrets in prompts if you can avoid it; redaction is best-effort.
- Maciej uses Claude Code; Mike uses Cursor + OpenCode. Same `AGENTS.md`; capture is per machine.

## What Entire is not

It does not replace `docs/decisions.md` / `docs/gotchas.md`. It does not apply migrations. Repo Analytics empty ≠ capture broken — check whether the work is on `develop`.
