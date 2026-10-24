---
name: s2
description: Stage 2 — Execute (build one block). Builds one approved execution block from a Moduo spec autonomously (auto-selecting and claiming the next ready block from specs/BUILD_ORDER.md when none is named) — quietly, with subagents for noisy work, test-first, ending with the verify gate (bun run verify), a spec review and, for Tier 2 paths only, one advisory validator pass, then reporting once, briefly. Also holds the fast-lane and bug-lane rules. Use after /s1 when the designer approves a block and presses play, ideally inside /goal. Not for planning (that is /s1) or wrap-up/commit/merge (that is /s3).
effort: high
---

# /s2 — execute: build one block, prove it, report once

## Rules that always hold
- **Stay silent between tool calls.** Report exactly once, at the end, in the format below. The designer reads only that report.
- **Don't ask the designer new questions.** Everything technical was settled in `/s1`. The only acceptable interruption is a hard blocker research can't resolve: report it under **❓ Needs you** / **⚠ Broke**.
- **Done means:** `bun run verify` passes after the last edit and every acceptance criterion is proven by a test or a live check. A Tier 2 diff (`bun scripts/ci/tier.ts origin/<personal>` prints `tier-2`) also gets the validator's one advisory pass, with each BLOCKER and MAJOR either fixed or answered in the report.
- **Tests are the spec's, code is yours.** While implementing, change code until the tests pass: if a test or the spec looks wrong, stop and report it; never edit a test to make it pass.
- **Tokens only, shadcn primitives, `docs/DESIGN_RULES.md`.** A missing value becomes a token in `apps/app/src/styles/tokens.css`, never an inline literal. The design hook will wake you if you slip.
- **Stay inside the block's scope.** Note anything else under **🔎 Found** instead of fixing it. Don't turn a finding into a task chip or a new session unless it's in the designer's current focus area (the **Focus** line at the top of `specs/BUILD_ORDER.md`; when that line is unset, no finding becomes a chip) or an unfixed security hole.
- **One block per session.** When the block is built, stop. Don't claim the next block in this session; `/s3` suggests it as a fresh session with its own title.
- **Never leave work only in the worktree.** A usage limit can end the session mid-turn, so commit and push the task branch after the claim, after the final green `bun run verify`, and before any stop you control (blocker, end of turn). Exception: an unfixed security hole stays a local commit, because the repo is public; say so under **Session**.
- **Stage explicit paths.** Another session may share the checkout: `git add <file>…`, never `git add -A` or a whole directory.
- **Use subagents for noisy work** (broad recon, long logs, big reads) so your own context stays lean.
- **Mirror the block in Moduo, never wait on it.** The [moduo-agent](../moduo-agent/SKILL.md) skill (`tools/claude-plugins/moduo-agent/skills/moduo-agent/SKILL.md`) takes the block's task in the dogfood workspace (found by the block ID in its title, in the milestone project Closed alpha, Open alpha or Beta & later) and posts status as you go. Without the `moduo` connector or its key every Moduo step is skipped, and the block is built exactly as before.

## Lanes
- **Fast lane:** a diff that fits one sentence needs no spec, block, ledger or Moduo task. Branch `t/<owner>/<kebab>` off the personal branch, make the change, run the checks it affects, then open a PR with a short Test-this and merge it into the personal branch on green (`/s3` steps 4–6). Skip the steps below.
- **Bug lane:** start with a failing test that reproduces the bug (`mattpocock-skills:diagnosing-bugs` finds the cause), and harden it so 3–5 plausible wrong fixes would still fail it: name those fixes and check the test catches each. Then build the fix through the steps below from step 4; a bug with a block ID takes steps 1–3 first.
- **Block lane:** everything else, through the steps below.

## Running unattended
For an overnight lane the designer starts the session with a goal, so the session keeps going until the block is really done:

```
/goal Use the s2 skill to build block <ID>. Done when: every acceptance criterion of <ID> in specs/<feature>.md is shown met in this conversation by a passing test or a live check; `bun run verify` exited 0 after the last edit; (Tier 2 only) the validator ran once and each BLOCKER or MAJOR is fixed or answered in the report. Edit nothing outside the block's scope. Stop after 40 turns, or as soon as a designer decision is needed.
```

On a Max plan, `/advisor fable` adds Fable 5.1 as an advisor at decision points.

## Steps
1. **Select.** Use the block the designer named. Otherwise (`/s2 next`, or no target) open `specs/BUILD_ORDER.md` and take the first `[ ]` block whose dependencies are all ticked **and** that no open PR already claims (`gh pr list --state open --search "<ID>"`). State which block you picked and why. If none is eligible, or the choice is ambiguous, stop and say so.
2. **Claim.** Set the session title `[<Module> <ID>] <name>` in `.claude/SESSION_TITLE`. On your `t/<owner>/<kebab>` branch, push an empty claim commit (`git commit --allow-empty -m "Claim <ID>"`) and open a **draft PR** into the personal branch titled `[<ID>] <name>`. The draft PR is the claim other sessions check; no ledger edit. Then mirror the claim in Moduo: moduo-agent §Pick up (find the block's task in Moduo by the ID in its title, in any project, or create it in its milestone project; take it with `tasks_assign me` or `tasks_claim` when it's team-routed, post `working` · step 2 of 7 with the draft PR link).
2b. **Checkpoints.** At the start of each step from 3 to 7, post one `working` report with its step number (moduo-agent §Checkpoint). A blocker you stop on is a `needs_you` report (§Needs you).
3. **Load context.** Re-read the block's spec section (behavior, acceptance criteria, tests), `docs/gotchas/<area>.md` for every area you'll touch, and the relevant `docs/decisions/<area>.md`. Keep a short task list only if the block has more than a few acceptance criteria.
4. **Build.** Reuse the patterns `/s1` found. Call `mattpocock-skills:tdd` and write the spec's tests first, red, then the code that turns them green. When something fails in a way you don't understand, call `mattpocock-skills:diagnosing-bugs` before changing more code.
   - **Three strikes.** On the third failure of the same check (one test, or one verify step), stop building and post a defect report: the check, the three attempts and what each changed, the failure output, and whether the spec or the test may be wrong, with your recommendation. Post it through moduo-agent §Needs you and under **⚠ Broke**, commit and push, and end the session there.
5. **Verify.** Run `bun run verify`; a non-zero exit means not done, so fix and re-run. If you touched `apps/desktop/src-tauri/`, also run `cargo check`, `cargo check --features lite` and `cargo test --lib` there. If the change is observable in the app, live-verify it with the preview tools and the hosted test account (see `docs/gotchas/ui.md`); a visual-snapshot diff means stop and ask, never auto-accept. On the local stack, a user created through the admin API can't sign in with a password: set it with SQL `extensions.crypt()` as `supabase/seed.sql` does (see `docs/local-dev.md` §Tests and the local stack).
   - **UI blocks: a lab pass.** When the block changes a screen `e2e/lab/lab.config.ts` declares, run `/product-lab` on it (`--screens <id>`, plus the journeys you touched) on the base commit and on yours, and put `delta.mjs`'s table in the PR body. A hard fail, a new serious axe rule or a lower `system` gate means not done; the other gates are advisory in lean mode. Add a state or journey to the config when the block creates one. `/product-jury` is for milestones, not blocks.
6. **Review.** Call `mattpocock-skills:code-review` on `origin/<personal>...HEAD` with the block's spec section as the spec; fix what it finds inside the block's scope and re-run verify.
   - **Tier 2 only:** spawn the `validator` subagent (`.claude/agents/validator.md`) once on the diff, and ask it to advise and to state each disagreement with the spec, a test or the diff explicitly. Fix the BLOCKER and MAJOR findings you agree with and re-run verify; for each one you disagree with, give the finding and your reason under **⚠ Broke**. The pass is advisory and runs once; the merging founder reads what is left.
7. **Record.** Tick the block `[x]` in `specs/BUILD_ORDER.md` (date + branch). Only if a decision is non-obvious, add it as an entry at the top of `docs/decisions/<area>.md` plus one line in `docs/decisions.md`; add a trap to `docs/gotchas/<area>.md` only if it cost more than a few minutes.

## Report (exactly once, short)
Open with one line: **Status: Built, not landed · Blocked · Not started**, plus the PR link. Then:
- **Changed**: what was built, tight.
- **Test this**: 3 to 5 concrete steps (step → expected → surface). Put the same text in the PR body; there is no separate checklist file.
- **❓ Needs you** *(only if applicable)*: numbered decisions only the designer can take, each with your recommendation.
- **🔎 Found** *(only if applicable)*: one line each, for anything outside the block; and say here when a commit exists only locally (an unfixed security hole).
- **⚠ Broke** *(only if applicable)*: what failed and the options; a defect report; validator findings you disagree with, each with your reason.
- **Session** *(only if applicable)*: "Moduo: off (<reason>)" when the connector was skipped.

Never suppress breakage, a blocker or a needed decision for brevity. Then stop; `/s3` lands the work.
