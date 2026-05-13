# Contributing to moduo

This document is the contract for how Mike and Maciej work in this repo —
human or AI. Read it before starting a new task; it covers branching, PR
direction, release cadence, testing gates, and how LLM agents should behave.

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

**Personal branches are long-lived.** They are not deleted after a sync into
`develop`. The owner keeps refreshing them — pulling `develop` into `maciej` /
`mike` whenever it helps you stay close to the other dev's work — and they
remain the canonical base for every new task branch.

## Task branches

- Name pattern: `<owner>/<short-kebab-case>`. Examples: `maciej/settings-modal`,
  `mike/calendar-sync-bug`, `maciej/m2-foundation-polish`.
- Always branch from your **personal branch**, not from `develop` or
  `production`. The personal branch is your latest known-working state.
- Keep them short-lived where possible. If a task grows beyond ~2 weeks,
  consider splitting it.

## Sync flow

```
task branch  →  personal branch  →  develop  →  production
                  (when ready)     (when ready)   (release)
```

- **Task → personal**: as soon as the task is complete and passes its own
  testing. Squash-merge or rebase-merge, your choice. Delete the task branch
  after merge.
- **Personal → develop**: **owner's call.** A 1-day fix can sync immediately;
  a 2-week feature can sync the moment it's testable. The rule is "when ready",
  not "on a clock." Open a PR; the other dev reviews. Use rebase-merge to keep
  `develop` history linear. The personal branch stays after the merge.
- **Develop → production**: only at a tagged release. Both devs sign off in
  the PR. Tag the merge commit per the release scheme below.

## Testing gates

Each merge tier has a stricter testing bar. The PR author is responsible for
running the gate; the reviewer verifies before approving.

### Task → personal (you alone)

- `bun run typecheck` clean.
- `bun run lint:tw` clean on files touched (and removed from `IGNORED_PATHS`
  in [scripts/check-arbitrary-tw.ts](scripts/check-arbitrary-tw.ts) if you
  rewrote a previously-legacy file).
- `bun run lint:css` clean on files touched.
- The task's own happy-path verified in `bun run dev:desktop`.

### Personal → develop (reviewed)

Everything above, plus:

- The feature exercised end-to-end on `bun run dev:desktop`, not just unit
  smoke-tested.
- Adjacent / regressed surfaces checked manually (e.g. touching shell code →
  walk Notes + Grid + Settings; touching tokens → toggle accent / radius /
  density / fonts).
- Storybook stories render without console errors for any new / changed
  primitives.
- Visual snapshot suite (`bunx playwright test --project=visual`) green, or
  intentionally regenerated and the new PNG committed.
- Either reviewer can request screenshots / a short Loom; if asked, attach.

### Develop → production (release)

Everything above, plus:

- A full release walkthrough on `bun run dev:desktop` against a **fresh
  vault**: sign-in, workspace create, the golden path for every feature
  touched in this release.
- A second walkthrough against an **existing vault** to catch migration /
  upgrade regressions.
- CHANGELOG entry written for the release.
- Both devs sign off in the `develop → production` PR before merging.

## Release tags

Tag format: `alpha-X.Y.Z`, `beta-X.Y.Z`, then plain `X.Y.Z` for 1.0+.

- `alpha-0.1.0`, `alpha-0.2.0` — alpha development. Bump `Y` per release;
  reserve `Z` for hotfix tags on a previously-shipped alpha.
- `beta-0.1.0`, `beta-0.2.0` — beta once the feature surface is stable and
  we're hunting bugs.
- `1.0.0`, `1.1.0`, `1.1.1` — regular SemVer once we're past beta.

Every release tag points at a commit on `production`. Keep
[`package.json`](./package.json) `version` field in sync with the tag.

## CHANGELOG

[CHANGELOG.md](./CHANGELOG.md) is updated on every `develop → production`
release. Section per release tag, dated, with subsections for **Added /
Changed / Fixed / Removed**. The release PR's description doubles as the
changelog draft if you keep both in sync.

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
6. **Run the testing gate for the merge you're targeting.** Don't open a PR
   into `develop` if you've only run the task-tier checks; either run the
   personal-tier walkthrough or flag in the PR description that the human
   still owes the walkthrough.
7. **Reference [CLAUDE.md](./CLAUDE.md) and [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)
   before touching UI.** They're the design contract.

## Pull request checklist

(Mirrored in [`.github/pull_request_template.md`](.github/pull_request_template.md)
so it pre-fills automatically.)

- [ ] Targets the correct base branch (`maciej` / `mike` for task PRs;
      `develop` for personal sync; `production` only for releases).
- [ ] Branch name follows `<owner>/<kebab>` for task branches.
- [ ] Testing gate for the target tier completed (see **Testing gates**).
- [ ] If UI was changed, screenshots or a short Loom of the affected surface.
- [ ] If a new primitive was added, Storybook story + entry in
      [tests/visual/primitives.spec.ts](tests/visual/primitives.spec.ts).
- [ ] CHANGELOG entry drafted if this PR will be in the next release.

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
5. Configure GitHub branch protection on `production` and `develop` (see
   below).
6. All new work starts under this contract.

## GitHub branch protection (set on activation)

Apply via repo Settings → Branches once `production` and `develop` exist:

- **`production`**: require PR, require both devs' approvals, require
  status checks to pass (`checks` workflow), require linear history,
  disallow force-push, disallow deletion.
- **`develop`**: require PR, require 1 approval (the other dev), require
  status checks to pass, disallow force-push, disallow deletion.
- **Personal branches**: no protection — the owner is free to push
  directly. (LLM agents are still constrained by the rules above.)
