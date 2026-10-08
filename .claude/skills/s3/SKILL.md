---
name: s3
description: Stage 3 — Wrap. End-of-session wrap-up for Moduo — manual-test checklist, institutional memory, the review gate the diff's risk calls for, commit, push the task branch, PR + merge into the personal branch, then for bigger chunks PR + merge personal → develop (Entire analytics; standing authorization). Never main. Reconciles BUILD_ORDER/BUILD_LOG, reports leftovers and suggests next-session prompts.
effort: medium
---

# /s3 — wrap: finalize the session safely

Close out the session so nothing is lost and the next one picks up cleanly. **The designer runs this at the end of almost every session; never make them retype the steps.**

## Rules that always hold
- **Never push or merge to `main`.** Never push directly to `develop`; it changes only through PRs. The `guard-git.sh` hook blocks direct pushes.
- **Merging into the personal branch (`mike`/`maciej`) is pre-authorized** (standing, 2026-06-27), with a merge commit, never a fast-forward.
- **Merging personal → `develop` is pre-authorized for bigger chunks** (standing, 2026-08-17).
- **The duplication guard gates every auto-merge.** If a competing open PR touches the same block, files or migrations, stop and surface it.
- **A Tier 2 diff never merges without its deep review** (step 3).
- Force-push only your own task branch, only with `--force-with-lease`.

## Steps
1. **Manual-test checklist (required).** Write or update `docs/testing/<branch-or-sprint>.md` from `docs/testing/TEMPLATE.md`: grouped by feature or surface, one checkbox per check, each check as step → expected result → surface (web, desktop or both). Cover everything the session changed, including edge cases, migrations and likely-regressed areas. **Live-verify first** where you can observe the change, so the designer's pass confirms rather than discovers; list anything you couldn't verify under "Known gaps".
2. **Institutional memory.**
   - Add decisions as full entries at the top of `docs/decisions/<area>.md` plus one line each in `docs/decisions.md`; add traps to `docs/gotchas/<area>.md`.
   - Reconcile the ledger: tick blocks completed this session (including work done outside `/s2`), then move finished `[x]` lines from `specs/BUILD_ORDER.md` to the same section of `specs/BUILD_LOG.md`.
   - Update the spec's `Status:` line if scope changed.
   - Optionally run the `retro` skill. When it proposes a harness change, note it under **🔎 Found** instead of applying it silently.
3. **Review gate by risk.** List the changed files with `git diff --name-only origin/<personal>...HEAD`.
   - **Tier 1 (every PR):** if `/s2` didn't already review the final diff, run `/code-review high` on it and check it against `REVIEW.md`. Fix Important findings and log the rest in the PR body.
   - **Tier 2 (risky paths):** the diff touches `supabase/migrations/`, `supabase/functions/_shared/contracts/`, `delete-account`, `create-checkout-session`, `create-portal-session`, `moduo-mcp`, `meet-*`, `src/lib/runtime*`, updater or signing code in `src-tauri/`, or `.github/workflows/`. Run the `claude-security` skill on the branch diff. Then ask the designer to start `/code-review ultra <PR-number>` themselves: it runs in the cloud and bills usage credits after the free runs, so it needs their go-ahead. Merge only after its verified findings are fixed or explicitly accepted.
4. **Commit.** Stage the session's work and commit with a concise present-tense imperative subject, a short body (what was built, decisions, what's deferred), and the Co-Authored-By trailer. The `guard-secrets.sh` hook scans the staged changes.
5. **Push the task branch** (`t/<owner>/<kebab>`).
6. **PR + merge into the personal branch.** If `/s2` opened a draft PR, mark it ready (`gh pr ready <n>`). Otherwise open one into `maciej` or `mike`, never `main`, linking the spec and the test checklist.
   - **Duplication guard, before merging:** run `gh pr list --base <personal> --state open` and check whether another open PR touches the same new files, migrations or DB objects, or the same `BUILD_ORDER` block. If so, don't merge: surface the overlap and get the designer's call.
   - Merge only a conflict-free (`mergeable: MERGEABLE`), non-overlapping PR, with `gh pr merge <n> --merge`. If it conflicts with the advanced base, merge the latest personal branch in, resolve, re-run `bun run verify`, then merge.
6b. **Sync personal → `develop`** for a bigger chunk: a finished block, a multi-file change, user-visible UI, a schema change, or anything the other person should build on.
   - Run `bun run verify`, then open `<personal> → develop`. A ruleset requires the `static-checks` job on `develop`, so wait for it (`gh pr checks <n> --watch --required`) and merge with `gh pr merge <n> --merge` once it passes. If it fails, fix it on the personal branch; never try to bypass the ruleset.
   - Afterwards `git fetch` and merge `origin/develop` back into the personal branch, so the two stay aligned.
   - Skip this step if the designer said to keep the work on the task branch, if the chunk is a one-line typo or doc nit, or if the duplication guard against open PRs into `develop` shows overlap.
7. **Report**, in the same shape as `/s2`'s, so every session ends the same way:
   - Open with **Status: Landed · Built, not landed · Blocked** (as defined in `/s2`'s report), plus the PR links and what merged where.
   - **Changed**: what shipped, whether `bun run verify` is green, which gates ran and what they found.
   - **To finish this block**: what still stands between this block and Landed, numbered, or "Nothing".
   - **❓ Needs you**: numbered decisions or actions only the designer can take (`/code-review ultra`, a prod go-ahead, a product call), each with your recommendation.
   - **🔎 Found, not needed for this block**: one line each, with where it's logged.
   - **Session**: "Safe to archive", or "Keep: <why>" (an open PR waiting on Needs you, work not yet pushed).
   - Then the next-session suggestions from step 8.
8. **Suggest at most 2 next sessions as ready-to-paste prompts.** First re-read `specs/BUILD_ORDER.md` on the **updated** personal branch.
   - **What qualifies:** the next `[ ]` block in this session's lane, or a block whose last unmet dependency this merge just satisfied. Never another lane's queue, never a block an open PR already claims, and never a 🔎 Found item outside the designer's current focus area (the **Focus** line at the top of `specs/BUILD_ORDER.md`; unset means none qualifies).
   - **Format:** a title (`/s2 <BLOCK> — <short name>`), one plain sentence on why it's ready now, and a fenced prompt.
   - **The prompt's first instruction is always** to verify the block is still `[ ]` and unclaimed on the fresh personal branch. Then it gives the scope, the spec and gotcha pointers, any lane contention, and the done gate.
   - Use explicit block IDs, never `next`. If nothing is DoR-ready, suggest a `/s1 <topic>` prompt instead. If nothing is ready at all, suggest nothing.
