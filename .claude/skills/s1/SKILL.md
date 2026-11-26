---
name: s1
description: Stage 1 — Plan a Moduo feature. Use before building anything that needs a spec. Grill the designer on product, UX and edge cases, research the technical layer yourself, and write a ready spec cut into blocks. Read-only, writes no code. Not for building (that is /s2) or wrap-up (that is /s3). Fills the spec template with a brief per block, sizes each block to one execution's context, never asks the designer how, and ends at the Definition-of-Ready gate; run in your tool's read-only/plan mode if it has one.
effort: high
---

# /s1 — plan: extract the product, decide the tech, produce a ready spec

You are planning a Moduo feature with a **product designer, not an engineer**. Your job: extract everything only they know (product, UX, edge cases, scope, priorities) and decide everything they can't (infra, data model, libraries) by research. End with an approved spec that `/s2` can build block-by-block without ever stopping to ask a new question.

**Write no code. This is read-only research + questioning until the spec is approved.** Run in your tool's read-only/plan mode if it has one.

## 1. Orient (read first, silently)
- Set the session title as soon as the topic is known: `[<Module>] <short title> plan` (AGENTS.md §Session start).
- `AGENTS.md` → "Working posture" + "Where things are". For the module you're planning: `bun run docs:current <area> --titles` lists its current decisions in one line each, `bun run docs:find <area> <words>` returns the ones on a subject, and `docs/gotchas/<area>.md` maps its traps. Never read `docs/decisions.md` or an area file whole (some pass 500 KB): send a `scout` when you need a wide sweep.
- The north-star docs (`docs/PRODUCT_BRIEF.md`, `docs/data-layers.md`) and, if it's a known module, its `.design/<module>/BRIEF.md` + `DESIGN_BRIEF.md` and `docs/moduo-module-contract.md`.
- Codebase recon belongs **here**, not in execution: use read-only explore/recon subagents to map existing patterns, data shapes, and reuse opportunities. Spawn parallel explores for breadth.

## 2. Grill the designer relentlessly
- Ask in batches; keep going until nothing is ambiguous. Err toward **50–100 questions up front**, not 10 mid-build. Cover: who/when/why, the main flow, every state (empty/loading/populated/error/permission/offline/slippage), edge cases, acceptance criteria, scope boundaries, priorities, the "one great moment."
- Always offer a **recommended answer** with each question so the designer can ratify rather than originate.
- Run the interview with the `mattpocock-skills:grilling` skill. For a UI question that words can't settle, call `mattpocock-skills:prototype`: a throwaway, clearly marked HTML or UI variation the designer can react to (`/design` artboards work too). Record resolved terms and decisions with `mattpocock-skills:domain-modeling`, which follows [docs/agents/domain.md](../../../docs/agents/domain.md).
- For work spanning several specs (Meet-size), map the pieces and their order in the spec's *Scope* before grilling each one.
- **Never ask the designer implementation, infra, data-model, or library questions.** Research those (explore subagents + web), decide, and record the decision + assumption in the spec. Surface a technical choice to the designer **only** when it changes the product (a cost/speed/UX tradeoff a user would feel) — framed in product terms with a recommendation.
- If you don't know something, research it deeply before proceeding. Never guess silently; never stall waiting on the designer for something you can find out yourself.

## 3. Fill the spec
- Copy [spec-template.md](spec-template.md) (beside this file) → `specs/<feature>.md` and fill every section. **You** author *Tests that prove them* from the acceptance criteria, each with its one-line plain-English note. Record every technical call under *Assumptions & technical decisions*; durable ones also become a full entry in `docs/decisions/<area>.md` with its `status:` line (then `bun run docs:index` regenerates the index).
- **Write a brief for every block** under *Block briefs* (the template has the shape): the goal, the block's acceptance criteria and tests copied in full, where to start as `path:line` from your recon, the decisions that apply with their file and line, the traps, and what is not in the block. At most 3 KB each. `/s2` reads the brief and no other part of the spec, so whatever the builder needs has to be in it.
- For a UI feature, **reference** the `.design/<module>` briefs and the module contract — don't restate them.

## 4. Decompose into execution blocks
- Cut tracer-bullet blocks with explicit blocking edges and write them where [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md) says (the spec's *Execution blocks* table, with the dependencies in its last column), then put them in the Moduo queue with `bun run queue:import specs/<feature>.md`.
- Block-sizing is **your** responsibility: size each block to complete within one execution's context budget, vertical-slice where possible, sequence with dependencies, each self-contained (its behavior + acceptance criteria + tests). Make blocks recoverable — a fresh session must be able to read the block's brief and resume.

## 5. Definition-of-Ready gate
- Walk the DoR checklist at the bottom of the spec. If anything fails, return to grilling/research. When all boxes pass, state **"Ready to execute."** and list the blocks in order.
- Then hand off: the designer approves, switches to auto mode, and runs `/s2 <BLOCK>` per block, inside `/goal` for unattended lanes (template in the `/s2` skill).

## Engineer mode
When the person planning is an engineer (Mike) rather than the designer, they drive the flows themselves: the person types `/mattpocock-skills:grill-with-docs` to be grilled against the docs and `/mattpocock-skills:to-tickets` to cut the blocks. Those two are theirs to start; your part is the research, the spec and the Definition-of-Ready gate above.

**Model:** run planning on Opus 5.5 at high effort. On a Max plan, switch to Fable 5.1 (`/model fable`) for the final synthesis of a large, multi-spec plan, then switch back.
