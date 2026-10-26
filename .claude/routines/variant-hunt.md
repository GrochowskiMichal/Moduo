You are the Moduo nightly variant hunt (specs/harness-v3.md HV-22, AC35), running unattended in a cloud session on a fresh clone of github.com/GrochowskiMichal/Moduo. Nobody is watching: never stop to ask, and end with the short report described at the bottom. The repository is public, so nothing you commit, push or post may contain a secret, a token or customer data.

## Setup

1. `command -v bun || npm install -g bun`, then `git fetch --quiet --unshallow origin || git fetch --quiet origin`.
2. Work on the latest personal branch: `git checkout --quiet -B "t/mike/hunt-$(date -u +%F)" origin/mike`.
3. `bun install --frozen-lockfile`.
4. Pick tonight's seed: `SEED=$(bun run --silent routine seed)`. It is a folder under `benchmarks/escapes/`.

## The hunt

Read `AGENTS.md`, then follow `.claude/skills/variant-hunt/SKILL.md` exactly for `benchmarks/escapes/$SEED/`, as the session that runs the hunt (do it yourself; no subagents needed for one seed). Its rules hold in full: never fix anything, never edit an existing test or product file, only add parked proof tests, and report a candidate only when its proof test fails on the current HEAD for the bug's reason. In this cloud session:

- Prove TypeScript candidates with `MODUO_HUNT=1 bun run --cwd apps/app test <file>`. Prove a Rust candidate only if `cargo` is on PATH; otherwise drop it with the reason "needs the desktop toolchain".
- Never touch the shared local Supabase stack or production: no `supabase` commands, no `bun run local:*`, no `db:test`, no Supabase MCP, no `wrangler`.
- Before you finish, check the parked tests stay skipped: `bun run --cwd apps/app test variant.test` must report no failures.

## If at least one candidate is confirmed

1. Stage only the new proof-test files by explicit path (never `git add -A` or a directory), commit with the subject `Park variant proofs of $SEED` and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and push the branch (`git push -u origin HEAD`). Never push to `mike`, `maciej` or `develop`, never force-push, never merge.
2. Open a draft PR into `mike` titled `Variant hunt · $SEED · <today>` with the step-6 report table as its body, if `gh` is signed in (`gh pr create --draft --base mike …`). If it isn't, put the branch's compare URL (`https://github.com/GrochowskiMichal/Moduo/compare/mike...<branch>`) in the task descriptions instead. The title has no `[ID]`, on purpose: it is not a block.
3. File one Moduo task per confirmed bug: write the skill's three-line task draft (user-visible damage, the proof test path and its run command, the seed, the PR or compare link) to a file under `/tmp`, then `bun run routine bug "$SEED" "<what loses data> (variant of $SEED)" /tmp/<file>.md`. A re-run with the same title updates the same task, so don't worry about duplicates.

## If nothing is confirmed

Push nothing and file nothing. Quiet nights are the normal case.

## Report (your last message)

One line `Variant hunt · <seed> · <n> confirmed, <m> dropped`, then the report table (confirmed rows only) and the task handles and PR link, if any. If setup or a tool failed, say exactly which step and the error instead.
