---
name: wrap
description: End-of-session wrap-up for Moduo — commit with a clear message, push the task branch, open/update a PR into the personal branch, write the manual-test checklist (docs/testing/<branch>.md), append decisions/gotchas, and report what's left undone and whether it's safe to archive the session. Use at the end of almost every session. Respects the repo's git safety rules (never pushes to main/develop, never merges without explicit authorization).
---

# /wrap — finalize the session safely

Close out the session so nothing is lost and the next one can pick up cleanly. **The designer runs this at the end of almost every session — never make them retype the steps.**

## Steps
1. **Manual-test checklist (required).** Write or update `docs/testing/<branch-or-sprint>.md` from `docs/testing/TEMPLATE.md`: group by feature/surface, one checkbox per check, each = step → expected result → surface (web/desktop/both). Cover everything the session changed incl. edge cases, migrations, likely-regressed areas. **Live-verify first** where observable (preview tooling + hosted test account) so the designer's pass is confirmation, not first-discovery; list anything you couldn't verify under "Known gaps."
2. **Institutional memory.** Append key decisions/assumptions to `docs/decisions.md` and any footguns to `docs/gotchas.md`. Reconcile `specs/BUILD_ORDER.md` (tick any blocks completed this session — including work done outside `/execute`) and update the active plan / spec `Status:` if scope changed.
3. **Commit.** Stage the session's work and commit with a concise present-tense imperative subject + a short body (what built / decisions / deferred). Co-Authored-By trailer for Claude-authored changes.
4. **Push the task branch** (`t/<owner>/<kebab>`), force-push only your own branch and only with `--force-with-lease`.
5. **PR.** Open or update a PR **into the personal branch** (`maciej` or `mike`) — not `main`, not `develop`. Title + body summarize the change and link the spec + test checklist. Use `gh`.
6. **Report.** Tell the designer: what shipped, whether `bun run verify` is green, **what's left undone**, and **whether it's safe to archive the session**.

## Hard safety rules (from CONTRIBUTING.md — do not override)
- **Never push directly to `main` or `develop`. Never merge or close a PR without explicit authorization.** PRs target the personal branch.
- The brief's shorthand "merge to main" is **not** how this repo works — `/wrap` prepares the PR and stops; the designer (or an explicit "merge it" instruction) does the merge, into the personal branch.
- `maciej` is a hot branch: when it is eventually merged, use a merge commit, not fast-forward (see `docs/gotchas.md`).
