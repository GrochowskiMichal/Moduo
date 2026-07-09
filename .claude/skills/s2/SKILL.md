---
name: s2
description: Stage 2 — Execute (build one block). Build one approved execution block from a Moduo spec autonomously under auto mode (auto-selecting the next ready block from specs/BUILD_ORDER.md when none is named) — quietly, using subagents internally for noisy work, ending with the verify gate (bun run verify) and a skeptical-senior validator pass, then reporting in the Changed/Test this/Next format. Use after /s1 when the designer approves a block and presses play. Not for planning (that is /s1) or session wrap-up/commit (that is /s3).
---

# /s2 — execute: build one block, prove it, report once

You are building **one approved execution block** from `specs/<feature>.md` under **auto mode**. The designer pressed play and is not watching keystrokes — they read only your final summary. Own the block end to end.

## Posture
- **Stay silent between tool calls.** No narration, no progress chatter.
- **Use subagents internally for any noisy work** — large file reads, test runs, broad recon — so your own main context stays lean for the whole block. The designer never sees or manages subagents, sessions, or context; that's yours to handle.
- **Opus everywhere**, including subagents and the validator. Never downgrade to save tokens.
- **Never hardcode visual values.** Tokens only; shadcn-wrapped primitives; obey `DESIGN_RULES.md`. If a needed value isn't a token, add it to `src/styles/tokens.css` — don't inline it.
- **Don't stop to ask the designer a new question.** Everything technical was resolved in `/s1`. The only acceptable interruption is a hard blocker you cannot resolve by research — surface it under **❓ Your call** / **⚠ Broke**.

## Steps
1. **Select + re-read.** If the designer named a block, use it. Otherwise (e.g. `/s2 next`, or no target) open `specs/BUILD_ORDER.md` and take the **first unchecked block whose dependencies are all ticked** — state which block you picked and why before building, and ask if none is eligible or the choice is ambiguous. Then re-read that block's spec section + its acceptance criteria + tests, plus `docs/decisions.md` and `docs/gotchas.md`, and confirm the block is recoverable from the spec alone. Once the block is chosen, write the session title file: `[<Module> <BLOCK-ID>] <block name>` → `.claude/SESSION_TITLE` (CLAUDE.md §Session naming).
2. **Build** the block. Reuse existing patterns found in `/s1`. Write the tests authored in the spec alongside the code.
3. **Verify** — run `bun run verify` (typecheck + lint:tw + lint:css + tests). A non-zero exit means **not done** — fix and re-run. If the change is observable in the browser, live-verify with the preview tooling + the hosted test account (see `docs/gotchas.md`); a visual-snapshot diff means *stop and ask*, never auto-accept.
4. **Validator pass** — before reporting, run a critical review of the diff as a skeptical senior/staff engineer: invoke the `code-review` skill (or spawn a review subagent with that framing). Look for logic errors, broken acceptance criteria, regressions, hardcoded values that should be tokens, and anything that wouldn't pass a real review. Fix what you can; fold the rest into the summary.
5. **Record** — tick the block's box in `specs/BUILD_ORDER.md` (with date + branch); append any decision/assumption made during the block to `docs/decisions.md`, and any new footgun to `docs/gotchas.md`.

## Report (exactly once, this shape)
- **Changed** — what landed (files/behavior), tight.
- **Test this** — concrete steps the designer runs to confirm (step → expected → surface).
- **Next** — the next block, or what remains.
- **⚠ Broke** *(only if applicable)* — what failed + the designer's options.
- **🔎 Found** *(only if applicable)* — context that changes the plan/spec.
- **❓ Your call** *(only if applicable)* — a decision you couldn't make alone (incl. validator findings that need a product call).

Never suppress breakage, a blocker, or a needed decision for brevity. Then stop for the designer's checkpoint before the next block.
