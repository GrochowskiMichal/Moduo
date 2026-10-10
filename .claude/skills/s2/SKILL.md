---
name: s2
description: Stage 2 — Execute (build one block and land it). Builds one approved execution block from a Moduo spec autonomously (auto-selecting the next ready block via `bun run next` when none is named, claiming it with a draft PR), quietly, with subagents for noisy work, through the verify gate (bun run verify), the validator subagent and a local code review, then lands it on the personal branch itself (Tier 0/1 diffs) and reports once in the Status/Changed/Test this/To finish format, with product-code decisions under ❓ Needs you. Use after /s1 when a block is approved, ideally inside /goal. Not for planning (that is /s1); /s3 only for what didn't land here (Tier 2 reviews, develop sync, the sitting checklist).
effort: high
---

# /s2 — execute: build one block, prove it, land it, report once

## Rules that always hold
- **Stay silent between tool calls.** Report exactly once, at the end, in the format below. The operator reads only that report.
- **Don't stop to ask.** Everything the spec settled is settled; what it left as a low-confidence assumption you build on the assumption and raise **at the end**, under **❓ Needs you**, with what you did and what changes on a different answer. The only mid-run interruption is a hard blocker research can't resolve: report it under **❓ Needs you** / **⚠ Broke**.
- **Done means:** the block's oracle passes (every acceptance criterion has its automated test from the spec's *Tests that prove them* table, or a recorded live check where no layer can automate it), `bun run verify` passes after the last edit, and the `validator` subagent reports no BLOCKER or MAJOR.
- **Tokens only, shadcn primitives, `docs/DESIGN_RULES.md`.** A missing value becomes a token in `src/styles/tokens.css`, never an inline literal. The design hook will wake you if you slip.
- **Stay inside the block's scope.** Note anything else under **🔎 Found** instead of fixing it. Don't turn a finding into a task chip or a new session unless it's in the current focus area (the **Focus** line at the top of `specs/BUILD_ORDER.md`; when that line is unset, no finding becomes a chip) or an unfixed security hole.
- **One block per session.** When the block has landed, stop. Don't claim the next block in this session; `bun run next` tells the next session what's ready.
- **Never leave work only in the worktree.** A usage limit can end the session mid-turn, so push as you go: commit and push the task branch after the claim and after every green `bun run verify`, and again before any stop you control. Exception: an unfixed security hole stays a local commit, because the repo is public; say so under **Session**.
- **Use subagents for noisy work** (broad recon, long logs, big reads) so your own context stays lean.

## Running unattended
For an overnight lane the operator starts the session with a goal, so the session keeps going until the block is really done and landed:

```
/goal Use the s2 skill to build block <ID>. Done when: every acceptance criterion of <ID> in specs/<feature>.md is proven by its test in this conversation or a recorded live check; `bun run verify` exited 0 after the last edit; the validator subagent reported no BLOCKER or MAJOR; the PR is merged into the personal branch, or the report says why it isn't. Edit nothing outside the block's scope. Stop after 40 turns, or on a hard blocker.
```

Add "Don't land it; stop at Built, not landed" to the goal when you want to review before it merges. On a Max plan, `/advisor fable` adds Fable 5.1 as an advisor at decision points.

## Steps
1. **Select.** Use the block the operator named. Otherwise (`/s2 next`, or no target) run `bun run next` and take the first `ready` block in this session's lane. State which block you picked and why. If none is ready, or the choice is ambiguous, stop and say so. Run `bun run next <ID>` on a named block too: `claimed` means another session has it, so stop.
2. **Claim.** Set the session title `[<Module> <ID>] <name>` in `.claude/SESSION_TITLE`. On your `t/<owner>/<kebab>` branch, make a claim commit (`git commit --allow-empty -m "Claim <ID>"`), push, and open a **draft PR** into the personal branch titled `[<ID>] <name>`. The draft PR *is* the claim: `bun run next` reads it, so nothing in `BUILD_ORDER.md` changes.
3. **Load context.** Re-read the block's spec section (behavior, acceptance criteria, tests, assumptions), `docs/gotchas/<area>.md` for every area you'll touch, and the **last five entries** of `docs/decisions/<area>.md`. If the block isn't DoR yet (it was after the first pair `/s1` readied), walk the spec's DoR list for it now, deciding what you can and recording the rest as low-confidence assumptions. Write a task list (TaskCreate) with one item per acceptance criterion plus "verify", "validator", "record" and "land". Before ending your turn, every item is done or named as blocked.
4. **Build, oracle first.** Write the block's tests from the spec's table before or alongside the code (the `tdd` skill for logic; `diagnosing-bugs` when something fails in a way you don't understand). Reuse the patterns `/s1` found.
5. **Verify.** Run `bun run verify`; a non-zero exit means not done, so fix and re-run. If you touched `src-tauri/`, also run `cargo check`, `cargo check --features lite` and `cargo test --lib` there. If the change is observable in the app, live-verify it with the preview tools and the hosted test account (see `docs/gotchas/ui.md`); a visual-snapshot diff means stop and ask, never auto-accept. On the **first** green verify, push and comment on the PR: `gh pr comment <n> --body "verify green"` (this timestamps the build-to-green interval; the merge timestamps the rest).
6. **Review.** Spawn the `validator` subagent (`.claude/agents/validator.md`) on the diff and run `/code-review high` on it. Fix every BLOCKER and MAJOR, re-run verify, and run the validator once more. If BLOCKER or MAJOR findings remain after two rounds, report them under **⚠ Broke** and don't land.
7. **Record.** Add any decision as a full entry at the top of `docs/decisions/<area>.md` and run `bun run gen:decisions-index`; add any new trap to `docs/gotchas/<area>.md`. A trap that bit twice becomes a hook, lint rule or test instead. Nothing to tick: block state is derived from the PR.
8. **Land.** Follow the `/s3` skill's steps 3 to 6 now, in this session: the review gate by risk, commit, push, mark the PR ready, duplication guard, merge into the personal branch with a merge commit, and the `develop` sync for a bigger chunk. Two cases don't land here and end at **Built, not landed**: a **Tier 2** diff (it needs the designer-launched `/code-review ultra`; list it under ❓ Needs you), or the goal said not to. Then write the PR body as the report below (`gh pr edit <n> --body-file`): the PR body is the one report, and `/s3` edits it rather than writing another.

## Report (exactly once, this shape)
The operator often has many sessions open and reads only this report, so it must answer at a glance: is this block done, what does it still need, and what needs them.

Open with one line: **Status: Landed · Built, not landed · Blocked · Not started**, plus the PR link. The four statuses, used by `/s2` and `/s3` alike: **Landed** (merged into the personal branch), **Built, not landed** (done here, something in *To finish this block* still stands), **Blocked** (stopped on something under ❓ Needs you or ⚠ Broke), **Not started** (claimed, but blocked before any building).
- **Changed**: what was built (files and behavior), tight. Say whether `bun run verify` is green and which gates ran.
- **Test this**: for a user-visible change, the questions for the sitting checklist (`docs/testing/<ISO-week>.md`, template in `docs/testing/TEMPLATE.md`): "what happens when … ?" with the expected observation. Skip for pure backend or tooling work that the tests prove.
- **To finish this block**: only the steps still required for this block to count as Landed, numbered, or "Nothing". Never list anything outside the block here.
- **❓ Needs you** *(only if applicable)*: numbered decisions only the operator can take, including every **low-confidence assumption you built on**: what you did, what you recommend, what changes on a different answer. Also product calls, validator findings that need one, prod go-aheads, `/code-review ultra`.
- **⚠ Broke** *(only if applicable)*: what failed, plus the operator's options.
- **🔎 Found, not needed for this block** *(only if applicable)*: one line each, with where you logged it (gotchas, BUILD_ORDER). Context only: nothing here blocks the block.
- **Session**: "Safe to archive", or "Keep: <why>" (uncommitted work, a commit that only exists locally, waiting on Needs you #n).

Never suppress breakage, a blocker or a needed decision for brevity.
