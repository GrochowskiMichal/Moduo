---
name: s3
description: Stage 3 — Wrap. Lands whatever /s2 couldn't — the review gate the diff's risk calls for, commit, push the task branch, PR + merge into the personal branch, then for bigger chunks PR + merge personal → develop (standing authorization) — plus the sitting checklist for user-visible changes and the institutional memory (decisions, gotchas). Never main. Also the wrap for work done outside /s2. Ends with `bun run next` for what's ready.
effort: medium
---

# /s3 — wrap: land it, remember it, say what's next

Close out a session so nothing is lost. `/s2` now runs steps 1–6 itself for a Tier 0/1 block (including the block's sitting checklist), so on a normal block `/s3` is short: the Tier 2 gate if one was deferred, memory, **the `develop` sync (owned here, once per batch, never by `/s2`)** and the next-blocks query. For work done outside `/s2` (a chat session, a fix on the fly), run every step. **Never make the operator retype the steps.**

## Rules that always hold
- **Never push or merge to `main`.** Never push directly to `develop`; it changes only through PRs. The `guard-git.sh` hook blocks direct pushes.
- **Merging into the personal branch (`mike`/`maciej`) is pre-authorized** (standing, 2026-06-27), with a merge commit, never a fast-forward.
- **Merging personal → `develop` is pre-authorized for bigger chunks** (standing, 2026-08-17).
- **The duplication guard gates every auto-merge.** If a competing open PR touches the same block, files or migrations, stop and surface it.
- **A Tier 2 diff never merges without its deep review** (step 3).
- Force-push only your own task branch, only with `--force-with-lease`.

## Steps
1. **Sitting checklist (user-visible changes only, when `/s2` didn't write it).** If the session changed something a person can see or do in the app, write `docs/testing/<ISO-week>/<ID-or-kebab>.md` (e.g. `docs/testing/2026-W41/TV-U5.md`, from `docs/testing/TEMPLATE.md`; one file per PR, so parallel lanes never edit the same file; the week folder is what the operator runs in one sitting). Items are **questions with an expected observation and a blank for what was seen**, not assertions to tick. **Live-verify first** where you can observe the change, and list what you couldn't under "Not verified by the agent". Backend, tooling and docs changes that the tests prove need no checklist.
2. **Institutional memory.**
   - Add decisions as full entries at the top of `docs/decisions/<area>.md`, then `bun run gen:decisions-index` (CI fails on a stale index). Add traps to `docs/gotchas/<area>.md`.
   - Update the spec's `Status:` line if scope changed. Block state needs no edit: `bun run next` derives it from the PRs.
   - Optionally run the `retro` skill. When it proposes a harness change, note it under **🔎 Found** instead of applying it silently.
3. **Review gate by risk.** List the changed files with `git diff --name-only origin/<personal>...HEAD`.
   - **Tier 1 (every PR):** if `/s2` didn't already review the final diff, run `/code-review high` on it and check it against `REVIEW.md`. Fix Important findings and log the rest in the PR body.
   - **Tier 2 (risky paths):** the diff touches `supabase/migrations/`, `supabase/functions/_shared/contracts/`, `delete-account`, `create-checkout-session`, `create-portal-session`, `moduo-mcp`, `meet-*`, `src/lib/runtime*`, updater or signing code in `src-tauri/`, or `.github/workflows/`. Run the `claude-security` skill on the branch diff. Then ask the operator to start `/code-review ultra <PR-number>` themselves: it runs in the cloud and bills usage credits after the free runs, so it needs their go-ahead. Merge only after its verified findings are fixed or explicitly accepted.
4. **Commit.** Stage the session's work and commit with a concise present-tense imperative subject, a short body (what was built, decisions, what's deferred), and the Co-Authored-By trailer. The `guard-secrets.sh` hook scans the staged changes.
5. **Push the task branch** (`t/<owner>/<kebab>`).
6. **PR + merge into the personal branch.** If `/s2` opened a draft PR, mark it ready (`gh pr ready <n>`). Otherwise open one into `maciej` or `mike`, never `main`, titled `[<ID>] <name>` when it finishes a block (that title is how `bun run next` knows the block is done), linking the spec.
   - **Duplication guard, before merging:** run `gh pr list --base <personal> --state open` and check whether another open PR touches the same new files, migrations or DB objects, or the same block. If so, don't merge: surface the overlap and get the operator's call.
   - Merge only a conflict-free (`mergeable: MERGEABLE`), non-overlapping PR, with `gh pr merge <n> --merge`. If it conflicts with the advanced base, merge the latest personal branch in, resolve, re-run `bun run verify`, then merge.
   - **Label the outcome** so merge rate can be read later: `gh pr edit <n> --add-label <label>` with one of `outcome:clean` (landed as built), `outcome:reworked` (a review gate or the operator changed the code), `outcome:workflow` (held up by process: conflicts, a stale base, a missing go-ahead), `outcome:scope` (the block changed shape). Create the label once per repo if it's missing (`gh label create`).
6b. **Sync personal → `develop`** for a bigger chunk: a finished block, a multi-file change, user-visible UI, a schema change, or anything the other person should build on.
   - Run `bun run verify`, then open `<personal> → develop`. A ruleset requires the `static-checks` job on `develop`, so wait for it (`gh pr checks <n> --watch --required`) and merge with `gh pr merge <n> --merge` once it passes. If it fails, fix it on the personal branch; never try to bypass the ruleset.
   - Afterwards `git fetch` and merge `origin/develop` back into the personal branch, so the two stay aligned.
   - Skip this step if the operator said to keep the work on the task branch, if the chunk is a one-line typo or doc nit, or if the duplication guard against open PRs into `develop` shows overlap.
7. **Report: edit the PR body, don't write a second one.** The PR body already holds `/s2`'s report. Update its **Status** line (Landed · Built, not landed · Blocked), its **To finish this block** list and **Session** line, and add what merged where (`gh pr edit <n> --body-file`). Then paste the same **Status** line and anything under **❓ Needs you** into the chat; nothing else needs repeating.
8. **What's next: one command.** Run `bun run next` on the updated personal branch and paste its output. If the operator wants a session started, the prompt is `/s2 <ID>` with an explicit ID (never `next`), optionally inside the `/goal` template from the `/s2` skill. If nothing is ready, say which block is waiting on what, or suggest a `/s1 <topic>`.
