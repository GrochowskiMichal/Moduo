# Contributing to moduo

This document is the contract for how Mike and Maciej work in this repo —
human or AI. Read it before starting a new task; it covers branching, PR
direction, release cadence, and how LLM agents should behave.

> **Effective date:** after the in-flight wild branches are reconciled and
> merged. Until then the existing ad-hoc branches stand; new task branches
> should already follow this model.

## Branch hierarchy

```
production          ← release-quality. Alpha / beta tags live here.
   ↑                   Only develop merges in.
develop             ← integration. Sync target for personal branches.
   ↑    ↑              Only personal branches merge in.
maciej  mike        ← personal long-running branches (one per dev).
   ↑      ↑            Only task branches merge in.
maciej/* mike/*     ← task / milestone branches. Short-lived.
                      Always merge into your own personal branch first.
```

## Branch ownership

| Branch | Owner | Who can merge into it |
| --- | --- | --- |
| `production` | shared | `develop` only, at release time, both devs sign off |
| `develop` | shared | `mike` and `maciej`, via PR, the other dev reviews |
| `maciej` | Maciej | `maciej/*` task branches, via PR or fast-forward |
| `mike` | Mike | `mike/*` task branches, via PR or fast-forward |

Nobody pushes directly to `production` or `develop`. Personal branches can be
pushed to directly by their owner; PRs are preferred when an LLM did the work
so there's a diff to review.

## Task branches

- Name pattern: `<owner>/<short-kebab-case>`. Examples: `maciej/settings-modal`,
  `mike/calendar-sync-bug`, `maciej/m2-foundation-polish`.
- Always branch from your **personal branch**, not from `develop` or
  `production`. The personal branch is your latest known-working state.
- Keep them short-lived. Merge back to the personal branch within ~3 working
  days or rebase to stay current.

## Sync flow

```
task branch  →  personal branch  →  develop  →  production
                   (continuous)        (weekly)     (release)
```

- **Task → personal**: as soon as the task is complete. Squash-merge or
  rebase-merge, your choice. Delete the task branch after merge.
- **Personal → develop**: at least weekly, more often if changes are small or
  unblock the other dev. Open a PR; the other dev reviews. Use rebase-merge
  to keep `develop` history linear.
- **Develop → production**: only at a tagged release. Both devs sign off in
  the PR. Tag the merge commit (`alpha-1`, `alpha-2`, `beta-1`, `1.0.0`, …).

## Release tags

- Alpha: `alpha-N` while we're still iterating on core surfaces.
- Beta: `beta-N` once the feature surface is stable and we're hunting bugs.
- 1.0+: regular SemVer once we're past beta.

Every release tag points at a commit on `production`. The `develop → production`
PR description lists what's in the release and any breaking changes.

## Conflict policy

If a personal-branch PR into `develop` conflicts with the other dev's recent
merge, the PR author resolves. If `develop → production` conflicts arise (rare),
the dev whose work caused the conflict resolves and re-requests review.

## Commit style

- Concise present-tense imperative subject line. Single line preferred.
- One logical change per commit when feasible.
- LLM-authored commits include the `Co-Authored-By` trailer for the model
  that wrote them.

## Rules for LLM agents (Claude Code, Cursor, Codex, …)

These apply to every AI session in this repo regardless of tool:

1. **Default base branch is the user's personal branch.** Unless told otherwise,
   `git checkout -b <owner>/<task> <owner>` is the right starting point. Never
   branch from `production`. Never branch from `develop` unless explicitly
   instructed.
2. **Never push to `production` or `develop` directly.** Always go through a PR.
3. **Never merge or close PRs without explicit authorization.** Even when auto
   mode is active. Merging is a shared-state action that needs the human's
   "yes."
4. **Never delete branches without explicit authorization.** Especially personal
   or long-running ones.
5. **`--force-push` only with `--force-with-lease`** and only on task branches
   you own. Never force-push personal branches, `develop`, or `production`.
6. **Run typecheck and lint gates after each commit.** `bun run typecheck` +
   `bun run lint:tw` + `bun run lint:css` should be clean before a PR opens.
7. **Reference [CLAUDE.md](./CLAUDE.md) and [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)
   before touching UI.** They're the design contract.

## Pull request checklist

- [ ] Targets the correct base branch (`maciej` / `mike` for task PRs;
      `develop` for personal sync; `production` only for releases).
- [ ] Branch name follows `<owner>/<kebab>` for task branches.
- [ ] `bun run typecheck` clean.
- [ ] `bun run lint:tw` clean on files you touched.
- [ ] `bun run lint:css` clean on files you touched.
- [ ] If UI was changed, screenshots or a short Loom of the affected surface.
- [ ] If a new primitive was added, Storybook story + entry in the visual
      snapshot list ([tests/visual/primitives.spec.ts](tests/visual/primitives.spec.ts)).
- [ ] CHANGELOG / DESIGN_REVIEW updated if the change is user-visible.

## Reconciling the in-flight branches (one-time)

Before this convention goes live, we still need to land:

- `design/notes-page` (PR #1) — **merged 2026-05-13.**
- `design/settings-polish-delta` (PR #2) — open, awaiting Mike + sign-off.
- Mike's in-flight batch — TBD; will merge once Mike is done.

Once those are on `main`, we'll:

1. Rename `main` → `production`.
2. Create `develop` from `production`.
3. Create `maciej` and `mike` from `develop`.
4. Delete or archive the stale `design/*` and `claude/*` branches.
5. All new work starts under this contract.
