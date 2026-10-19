---
name: s3
description: Stage 3 — Wrap. End-of-session wrap-up for Moduo, in lean mode: a short Test-this in the PR body, only worthwhile decisions/gotchas, the validator on Tier 2 diffs, commit, push the task branch, PR + merge into the personal branch, and a develop sync in batches (standing authorization). Never main. Names the next ready block IDs.
effort: medium
---

# /s3 — wrap: finalize the session safely

Close out the session so nothing is lost and the next one picks up cleanly. **The designer runs this at the end of almost every session; never make them retype the steps.**

## Rules that always hold
- **Never push or merge to `main`.** Never push directly to `develop`; it changes only through PRs. The `guard-git.sh` hook blocks direct pushes.
- **Merging into the personal branch (`mike`/`maciej`) is pre-authorized** (standing, 2026-06-27), with a merge commit, never a fast-forward.
- **Merging personal → `develop` is pre-authorized, in batches** (standing, 2026-08-17): a finished feature, end of day, or when the other person needs it. Not after every block.
- **The duplication guard gates every auto-merge.** If a competing open PR touches the same migration, DB object or block, stop and surface it.
- **Lean mode (pre-alpha):** a Tier 2 diff needs the `validator` subagent, nothing more. `/code-review ultra`, the `claude-security` scan and per-PR `/code-review` are paused until the live beta (designer's call, 2026-10-15 and 2026-10-16): don't run, ask for or block on them.
- Force-push only your own task branch, only with `--force-with-lease`.

Shipping to prod is not part of `/s3`: that is `/ship` ([docs/release.md](../../../docs/release.md)).

## Steps
1. **Test this.** Put 3 to 5 steps (step → expected → surface) in the PR body, live-verified where you can. No `docs/testing/` file unless the designer asks.
1b. **Release note.** For each block landing in this PR, write `.changes/<block-id-lowercase>.md` following [docs/release-notes.md](../../../docs/release-notes.md): front matter `type: new|improved|fixed|security`, `internal: true|false`, optional `highlight: true`, then one or two plain sentences (at most 200 characters) about what people can now do. A block people can't notice (refactor, tests, tooling, CI, docs, infra) gets the same file with `internal: true`. Never name code, files, block IDs, database objects or infrastructure; a security fix is `type: security` with exactly "Security and reliability improvements." `bun run verify` runs the leak check (`lint:notes`); rewrite the note until it passes. Notes publish with no human review.
2. **Memory (only what's worth it).** A non-obvious decision goes at the top of `docs/decisions/<area>.md` plus one line in `docs/decisions.md`; a trap that cost more than a few minutes goes in `docs/gotchas/<area>.md`. Tick finished blocks in `specs/BUILD_ORDER.md`; moving `[x]` lines to `specs/BUILD_LOG.md` is batch housekeeping, not per session.
3. **Review gate.** Tier 2 only (see `AGENTS.md` §Review gates: migrations, contracts, RLS, `moduo-mcp`, billing, `apps/app/src/lib/runtime*`, updater/signing, workflows): run the `validator` subagent on `git diff origin/<personal>...HEAD` and fix BLOCKER/MAJOR. Everything else relies on a green `bun run verify`.
4. **Commit** explicit paths (`git add <file>…`, never `-A` or a whole directory: another session may share the checkout) with a concise present-tense imperative subject, a short body and the Co-Authored-By trailer. `guard-secrets.sh` scans the staged changes.
5. **Push the task branch** (`t/<owner>/<kebab>`).
6. **PR + merge into the personal branch.** Mark the `/s2` draft PR ready (`gh pr ready <n>`) or open one into `maciej`/`mike`, never `main`. Before merging, run `gh pr list --base <personal> --state open` and stop only if another PR touches the same migration, DB object or block. Merge a conflict-free PR with `gh pr merge <n> --merge`; if it conflicts, merge the personal branch in, resolve, re-run `bun run verify`, then merge. Only the fast secret scan runs on this PR.
6b. **Sync personal → `develop`, in batches** (a finished feature, end of day, or when the other person needs it; skip for a lone doc nit). Open `<personal> → develop`; the required `static-checks` job runs once there (`gh pr checks <n> --watch --required`); merge with `gh pr merge <n> --merge` once it passes, then merge `origin/develop` back into the personal branch. If it fails, fix it on the personal branch and never bypass the ruleset.
7. **Report**, short: **Status: Landed · Built, not landed · Blocked** with PR links; **Changed**; **❓ Needs you** and **⚠ Broke** only if applicable; **Session** ("Safe to archive" or "Keep: <why>"). End with one line naming the next ready block IDs from `specs/BUILD_ORDER.md` (no ready-to-paste prompts).
