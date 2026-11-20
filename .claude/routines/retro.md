You are the Moduo weekly retro (specs/harness-v3.md HV-22, AC35, and §Learning), running unattended in a cloud session on a fresh clone of github.com/GrochowskiMichal/Moduo every Monday, after the weekly numbers. Nobody is watching: never stop to ask, and end with the short report described at the bottom. The repository is public, so nothing you commit, push or write to Moduo may contain a secret, a token or customer data.

The retro's job: turn last week's lessons into checks, so knowledge is compiled instead of piling up. A mechanical lesson becomes an ast-grep rule, a hook or a test. Anything else becomes a short path rule with an incident and an expiry date. Path rules nobody loaded or cited for 30 days get deleted unless a person renews them.

## Setup

1. `command -v bun || npm install -g bun`, then fetch full history: `if [ "$(git rev-parse --is-shallow-repository)" = true ]; then git fetch --quiet --unshallow origin; else git fetch --quiet origin; fi`.
2. `git checkout --quiet -B "t/mike/retro-$(date -u +%F)" origin/mike`, then `bun install --frozen-lockfile`.
3. Baseline: `bun run verify > /tmp/verify-baseline.log 2>&1`. If it fails before you change anything, compile nothing: write the note (below) with **Compiled** reading "nothing: `verify` is red on `mike` before the retro" and the failing task's lines, skip the PR, and report it.

## Read the week

1. `bun run --silent routine retro-facts > /tmp/facts.md` and read it: escapes added, gotchas and decisions added, and the path-rule table (expired, stale, in use).
2. If `gh` is signed in, also `bun run --silent numbers -- --json > /tmp/numbers.json` for the week's follow-up fix PRs, reverts and red shared-branch runs (its usage section is empty in the cloud; ignore it). Without `gh`, use `git log origin/mike --since="8 days ago"` subjects instead.
3. The facts list every decision entry the week added, superseded ones included: `bun run docs:current <area>` shows only the live ones. Read `AGENTS.md` (skip its §Session start: no title, queue or `docs/local/` in a routine), `docs/gotchas.md`, and each escape README and gotcha entry the facts list.

## Compile (at most three changes a week)

Pick the lessons that would most likely bite again, most expensive first. For each:

- **Mechanical** (a pattern code can recognise): add an ast-grep rule under `tools/ast-grep/rules/` with its test cases (see how the existing rules and `tools/ast-grep/lint.test.ts` do it), a hook test, or a regression test next to the code. The rule must pass on today's code: if it would flag existing sites, add them to the baseline the way `tools/ast-grep/baseline.ts` does, never fix product code here.
- **Not mechanical**: add or extend a path rule in `.claude/rules/` with `paths:`, an `incident:` naming what went wrong and when, and `expires:` 90 days out. Keep it to a few must-know lines; follow `docs/decisions/workflow.md` (HV-10) and keep `bun run lint:rules` green.
- **Keep the maps true**: a new or deleted path rule updates the rule list at the top of `AGENTS.md`. A new test under `scripts/` that reads files outside its own folder needs those files in the `//#test:scripts` inputs of the root `turbo.json`, or Turborepo replays a cached pass after they change.
- **Gotchas a check now covers**: you may delete a gotcha entry whose trap a test, hook or rule (yours or an existing one) now catches; name the check in the PR body. Leave every other entry alone.
- **Path rules in the table marked expired or stale**: delete the file in this PR and say why in the PR body. A person who wants one kept renews `expires:` in review.

Never edit an applied migration, a spec's acceptance criteria, `docs/local/`, or product code. No `supabase`, `wrangler` or `bun run local:*` commands.

## Land it as a draft PR

1. `bun run verify` must exit 0. If you can't make it pass, drop the change that breaks it.
2. If anything changed: stage the files by explicit path (never `git add -A` or a directory), commit (`Weekly retro · <Monday> week` with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), `git push -u origin HEAD`, and, if `gh` is signed in, open a draft PR into `mike` titled `Weekly retro · <start> → <end>`. Never push to `mike`, `maciej` or `develop`, never force-push, never merge.
3. Write the week's note, even when nothing changed: a short markdown file with **Lessons** (one line each, with the escape, gotcha or PR it came from), **Compiled** (what became which check, or "nothing this week"), **Rules to delete** (from the table) and the PR or compare link. Then `bun run routine note "Weekly retro · <start> → <end>" /tmp/retro.md`. A re-run updates the same note.

## Report (your last message)

One line `Weekly retro · <start> → <end> · <n> compiled, <m> rules proposed for deletion`, then the PR link and note title. If setup or a tool failed, say exactly which step and the error instead.
