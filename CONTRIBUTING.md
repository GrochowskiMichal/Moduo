# Contributing to moduo

This document is the contract for how Mike and Maciej work in this repo —
human or AI. Read it before starting a new task; it covers branching, PR
direction, release cadence, testing gates, and how LLM agents should behave.

> **Effective date:** 2026-05-14; releases from tags since 2026-10-19
> (Release v2). The mirror branches `main`, `prod-app`, `staging-app`,
> `prod-landing` and `staging-landing` were retired in REL-6 (no workflow uses them): production ships only from
> `vX.Y.Z` tags on `develop`, through `/ship` ([docs/release.md](./docs/release.md)).

## Branch hierarchy

```
vX.Y.Z tags         ← releases. /ship tags a merge commit on develop.
develop             ← integration. Sync target for personal branches.
   ↑    ↑              Only personal branches merge in.
maciej  mike        ← personal long-running branches (one per dev).
   ↑      ↑            Only task branches merge in.
t/maciej/* t/mike/* ← task / milestone branches. Short-lived.
                      Always merge into your own personal branch first.
```

## Branch ownership

| Branch | Owner | Who can merge into it |
| --- | --- | --- |
| `develop` | shared | `mike` and `maciej`, via PR, self-merge OK (review optional) |
| `maciej` | Maciej | `t/maciej/*` task branches, via PR with a merge commit (never fast-forward) |
| `mike` | Mike | `t/mike/*` task branches, via PR with a merge commit (never fast-forward) |

Nobody pushes directly to `develop`. Agents **do** merge into `develop` via PR
as part of `/s3` when the chunk should show on Entire (standing
authorization, 2026-08-17). Releases are tags, cut only by `/ship`. Personal branches can be
pushed to directly by their owner; PRs are preferred when an LLM did the work
so there's a diff to review.

**Personal branches are long-lived.** They are not deleted after a sync into
`develop`. The owner keeps refreshing them — pulling `develop` into `maciej` /
`mike` whenever it helps you stay close to the other dev's work — and they
remain the canonical base for every new task branch.

## Task branches

- Name pattern: `t/<owner>/<short-kebab-case>`. Examples:
  `t/maciej/settings-modal`, `t/mike/calendar-sync-bug`,
  `t/maciej/m2-foundation-polish`. The `t/` prefix is required because
  Git refs can't be both a file (`maciej`) and a directory (`maciej/x`)
  at the same path.
- Always branch from your **personal branch**, not from `develop`. The personal branch is your latest known-working state.
- Keep them short-lived where possible. If a task grows beyond ~2 weeks,
  consider splitting it.

## Sync flow

```
task branch  →  personal branch  →  develop  →  vX.Y.Z tag
                  (when ready)     (when ready)   (/ship)
```

- **Task → personal**: as soon as the task is complete and passes its own
  testing. Open a PR and merge it with a **merge commit — never fast-forward**
  (personal branches are hot; parallel sessions need the merge boundary). GitHub
  deletes the task branch on merge.
- **Personal → develop**: **do this often.** GitHub's default branch is
  `develop`. Entire.io repo Overview/Analytics only count checkpoints that
  have landed there, so bigger chunks (a finished `/s2` block, any
  user-visible or schema change) should reach `develop` in the same wrap
  that lands them on the personal branch — agents have standing
  authorization to open the PR and self-merge (2026-08-17). A 1-day fix can
  sync immediately; do not wait for a "big bang" personal-branch dump.
  Open a PR so there's a diff record, run `bun run verify`, then self-merge.
  Peer review is welcome but never blocking. Prefer a merge commit when the
  personal branch is hot. The personal branch stays; refresh it from
  `develop` after so the two don't drift. Skip the develop sync only when
  the designer said to keep the work on a task branch, or a duplication-guard
  conflict is unresolved.
- **Develop → production**: `/ship` opens the release PR
  (`release/vX.Y.Z → develop`), merges it and tags the merge commit; the tag
  deploys web, landing and desktop. It asks one question: ship now, or hand it
  to the other founder.

## Testing gates

Each merge tier has a stricter testing bar. The PR author is responsible for
running the gate; the reviewer verifies before approving.

> **Lean mode (pre-alpha):** the gates below are the target for beta. Today a block lands on `bun run verify` plus the `validator` on Tier 2 diffs; see [AGENTS.md §Review gates](./AGENTS.md#review-gates-lean-mode-pre-alpha-no-external-users).

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
- Visual snapshot suite (`bun run e2e --project=visual`) green, or
  intentionally regenerated and the new PNG committed.
- Either reviewer can request screenshots / a short Loom; if asked, attach.

### Release (`/ship`)

Everything above, plus what `/ship` checks: the release notes pass the leak
check, migrations and Edge Functions in the release are applied to prod first,
and the release PR's checks pass. Higher-risk releases (migrations, RLS, auth,
billing, the updater) are recommended for a hand-off to the other founder.

## Release tags

`vX.Y.Z`, SemVer on 1.x (`VERSION` is the single source). `/ship` picks the
version from the release notes: any new feature → minor, otherwise patch, major
only when asked. Every tag points at a release-PR merge commit on `develop`.

### Hotfix flow

A fix ships like any release: land it on `develop`, then `/ship` a patch. A fix
a real user is blocked by goes out the same day, on its own.

## CHANGELOG

[CHANGELOG.md](./CHANGELOG.md) is generated by `/ship` from the `.changes/`
notes `/s3` writes; never edit it by hand.

## Conflict policy

If a personal-branch PR into `develop` conflicts with the other dev's recent
merge, the PR author resolves. A release PR
conflicts only if `develop` moved; `/ship` re-prepares it.

## Commit style

- Concise present-tense imperative subject line. Single line preferred.
- One logical change per commit when feasible.
- LLM-authored commits include the `Co-Authored-By` trailer for the model
  that wrote them.

## Rules for agents (Claude Code, Anthropic models only)

These apply to every AI session in this repo regardless of tool:

1. **Default base branch is the user's personal branch.** Unless told otherwise,
   `git checkout -b t/<owner>/<task> <owner>` is the right starting point. Never
   branch from `develop` unless explicitly instructed.
2. **Never push to `develop` directly.** Always go through a PR. Never push a
   release tag or run a prod workflow outside `/ship`.
3. **Merging:** `/s3` has standing authorization to merge into the **personal**
   branch and, for bigger chunks, **personal → `develop`** (see AGENTS.md and
   `/s3`). Never merge or
   close *someone else's* PRs.
4. **Never delete branches without explicit authorization.** Especially personal
   or long-running ones.
5. **`--force-push` only with `--force-with-lease`** and only on task branches
   you own. Never force-push personal branches or `develop`.
6. **Run `bun run verify` before any develop PR.**
7. **Reference [AGENTS.md](./AGENTS.md) and [DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md)
   before touching UI.** They're the design contract.

### Session start checklist

Follow [AGENTS.md §Session start](./AGENTS.md#session-start).

## Pull request checklist

(Mirrored in [`.github/pull_request_template.md`](.github/pull_request_template.md)
so it pre-fills automatically.)

- [ ] Targets the correct base branch (`maciej` / `mike` for task PRs;
      `develop` for personal sync; `release/vX.Y.Z` only from `/ship`).
- [ ] A short "Test this" (step → expected → surface) in the PR body.

## Branch model activation

Activated 2026-05-14:

- `develop`, `maciej`, and `mike` created off `main`.
- `mike-backend`, `mike-ui-upgrade-modal`, and `design/settings-polish-delta`
  merged into `main` and deleted.
- Mike's pre-split branch preserved as `archive/mike-original`.
- `main` stayed the release branch until Release v2; REL-6 (2026-10-19)
  retired it with `prod-app`, `staging-app` and `prod-landing`.

## GitHub branch protection

- **`develop`**: a ruleset (with `main` until it is deleted): PR required, `static-checks`
  required, no force-push, no deletion. No approvals required: self-merge is
  intentional so neither dev stalls.
- **`mike`, `maciej`**: ruleset "Keep personal branches": no deletion, no
  force-push (it also stops GitHub's delete-on-merge from removing them after a
  sync PR). The owner may push directly (the develop merge-back).
- **Everything else**: GitHub deletes a PR's head branch on merge.
- **Agents** are also held by `.claude/hooks/guard-git.sh` and
  `guard-release.sh`.
