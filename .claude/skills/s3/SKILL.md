---
name: s3
description: Stage 3 — Wrap. End-of-session wrap-up for Moduo — commit, push the task branch, open a PR into the personal branch AND merge it (the designer has standing authorization to auto-merge into maciej/mike; never main/develop), after a duplication guard. Also write the manual-test checklist (docs/testing/<branch>.md), append decisions/gotchas, reconcile BUILD_ORDER, and report what's left undone. Use at the end of almost every session.
---

# /s3 — wrap: finalize the session safely

Close out the session so nothing is lost and the next one can pick up cleanly. **The designer runs this at the end of almost every session — never make them retype the steps.**

## Steps
1. **Manual-test checklist (required).** Write or update `docs/testing/<branch-or-sprint>.md` from `docs/testing/TEMPLATE.md`: group by feature/surface, one checkbox per check, each = step → expected result → surface (web/desktop/both). Cover everything the session changed incl. edge cases, migrations, likely-regressed areas. **Live-verify first** where observable (preview tooling + hosted test account) so the designer's pass is confirmation, not first-discovery; list anything you couldn't verify under "Known gaps."
2. **Institutional memory.** Append key decisions/assumptions to `docs/decisions.md` and any footguns to `docs/gotchas.md`. Reconcile `specs/BUILD_ORDER.md` (tick any blocks completed this session — including work done outside `/s2`) and update the active plan / spec `Status:` if scope changed.
3. **Commit.** Stage the session's work and commit with a concise present-tense imperative subject + a short body (what built / decisions / deferred). Co-Authored-By trailer for Claude-authored changes.
4. **Push the task branch** (`t/<owner>/<kebab>`), force-push only your own branch and only with `--force-with-lease`.
5. **PR + merge into the personal branch.** Open or update a PR **into the personal branch** (`maciej` or `mike`) — never `main`/`develop`. Title + body summarize the change and link the spec + test checklist (use `gh`). **Then merge it yourself** — the designer does not review PRs and has granted standing authorization (2026-06-27) to auto-merge into the personal branch as part of `/s3`. Use a **merge commit, not fast-forward** (`gh pr merge <n> --merge`), since the personal branch is hot. Merging promptly is the point: it advances `specs/BUILD_ORDER.md` on the personal branch so the **next** session doesn't re-pick a block already in flight.
   - **Duplication guard — run BEFORE merging.** `gh pr list --base <personal> --state open` and check whether any other open PR touches the **same new files, the same migration / DB objects, or the same `BUILD_ORDER` block** as yours. If so, **do not merge** — surface the overlap and get the designer's call on which line wins (parallel sessions off the same base can each `/s2 next` the same block — this duplication bit us 2026-06-27; see `docs/gotchas.md`). Only auto-merge a PR that is conflict-free (`mergeable: MERGEABLE`) and non-overlapping. If yours conflicts with the advanced base, rebase onto the latest personal branch, resolve, re-run `bun run verify`, then merge.
6. **Report.** Tell the designer: what shipped, whether `bun run verify` is green, **what merged** (PR links), **what's left undone**, and **whether it's safe to archive the session**.

## Hard safety rules (from CONTRIBUTING.md — do not override)
- **Never push to or merge into `main` or `develop`** — ever, without a specific per-instance instruction.
- **Merging into the personal branch (`maciej`/`mike`) is pre-authorized** (standing, granted 2026-06-27): `/s3` opens the PR **and merges it**, with a merge commit. This supersedes the old "prepare the PR and stop" rule — *for the personal branch only*.
- **The duplication guard gates the auto-merge.** If a competing open PR touches the same blocks/files/migrations, STOP and surface — never merge over it.
- `maciej` is a hot branch: always a merge commit, never fast-forward (see `docs/gotchas.md`).
- Force-push only your **own** task branch, only with `--force-with-lease`.
