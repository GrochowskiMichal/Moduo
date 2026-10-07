---
name: s2
description: Stage 2 — Execute (build one block). Builds one approved execution block from a Moduo spec autonomously (auto-selecting and claiming the next ready block from specs/BUILD_ORDER.md when none is named) — quietly, with subagents for noisy work, ending with the verify gate (bun run verify), the validator subagent and a local code review, then reporting once in the Changed/Test this/Next format. Use after /s1 when the designer approves a block and presses play, ideally inside /goal. Not for planning (that is /s1) or wrap-up/commit/merge (that is /s3).
effort: high
---

# /s2 — execute: build one block, prove it, report once

## Rules that always hold
- **Stay silent between tool calls.** Report exactly once, at the end, in the format below. The designer reads only that report.
- **Don't ask the designer new questions.** Everything technical was settled in `/s1`. The only acceptable interruption is a hard blocker research can't resolve: report it under **❓ Your call** / **⚠ Broke**.
- **Done means:** `bun run verify` passes after the last edit, every acceptance criterion is proven by a test or a live check, and the `validator` subagent reports no BLOCKER or MAJOR.
- **Tokens only, shadcn primitives, `docs/DESIGN_RULES.md`.** A missing value becomes a token in `src/styles/tokens.css`, never an inline literal. The design hook will wake you if you slip.
- **Stay inside the block's scope.** Note anything else under **🔎 Found** instead of fixing it.
- **Use subagents for noisy work** (broad recon, long logs, big reads) so your own context stays lean.

## Running unattended
For an overnight lane the designer starts the session with a goal, so the session keeps going until the block is really done:

```
/goal Use the s2 skill to build block <ID>. Done when: every acceptance criterion of <ID> in specs/<feature>.md is shown met in this conversation by a passing test or a live check; `bun run verify` exited 0 after the last edit; the validator subagent reported no BLOCKER or MAJOR. Edit nothing outside the block's scope. Stop after 40 turns, or as soon as a designer decision is needed.
```

On a Max plan, `/advisor fable` adds Fable 5.1 as an advisor at decision points.

## Steps
1. **Select.** Use the block the designer named. Otherwise (`/s2 next`, or no target) open `specs/BUILD_ORDER.md` and take the first `[ ]` block whose dependencies are all ticked **and** that no open PR already claims (`gh pr list --state open --search "<ID>"`). State which block you picked and why. If none is eligible, or the choice is ambiguous, stop and say so.
2. **Claim.** Set the session title `[<Module> <ID>] <name>` in `.claude/SESSION_TITLE`. On your `t/<owner>/<kebab>` branch, flip the block to `[~]` in `BUILD_ORDER.md`, commit, push, and open a **draft PR** into the personal branch titled `[<ID>] <name>`. The draft PR is the claim other sessions check.
3. **Load context.** Re-read the block's spec section (behavior, acceptance criteria, tests), `docs/gotchas/<area>.md` for every area you'll touch, and the relevant `docs/decisions/<area>.md`. Write a task list (TaskCreate) with one item per acceptance criterion plus "verify", "validator" and "record". Before ending your turn, every item is done or named as blocked.
4. **Build.** Reuse the patterns `/s1` found. Write the spec's tests alongside the code: use the `tdd` skill for logic and the `diagnosing-bugs` skill when something fails in a way you don't understand.
5. **Verify.** Run `bun run verify`; a non-zero exit means not done, so fix and re-run. If you touched `src-tauri/`, also run `cargo check`, `cargo check --features lite` and `cargo test --lib` there. If the change is observable in the app, live-verify it with the preview tools and the hosted test account (see `docs/gotchas/ui.md`); a visual-snapshot diff means stop and ask, never auto-accept.
6. **Review.** Spawn the `validator` subagent (`.claude/agents/validator.md`) on the diff and run `/code-review high` on it. Fix every BLOCKER and MAJOR, re-run verify, and run the validator once more. If BLOCKER or MAJOR findings remain after two rounds, report them under **⚠ Broke**.
7. **Record.** Tick the block `[x]` in `specs/BUILD_ORDER.md` (date + branch). Add any decision as a full entry at the top of `docs/decisions/<area>.md` plus one line in `docs/decisions.md`, and any new trap to `docs/gotchas/<area>.md`. A trap that bit twice becomes a hook, lint rule or test instead.

## Report (exactly once, this shape)
- **Changed**: what landed (files and behavior), tight.
- **Test this**: concrete steps the designer runs (step → expected → surface).
- **Next**: the next block, or what remains.
- **⚠ Broke** *(only if applicable)*: what failed, plus the designer's options.
- **🔎 Found** *(only if applicable)*: context that changes the plan or spec.
- **❓ Your call** *(only if applicable)*: a decision you couldn't make alone, including validator findings that need a product call.

Never suppress breakage, a blocker or a needed decision for brevity. Then stop for the designer's checkpoint; `/s3` lands the work.
