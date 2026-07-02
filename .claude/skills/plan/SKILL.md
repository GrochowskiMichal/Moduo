---
name: plan
description: Moduo planning session — grill the designer exhaustively on product/UX/edge-cases, research the technical layer yourself (Explore + web, never ask the designer how), fill specs/_template.md, decompose into context-sized execution blocks, and end at the Definition-of-Ready gate. Read-only, writes no code. Use before building any feature; run in Plan Mode. Not for the design-specific phase sequence (that is design-flow) or for building (that is /execute).
---

# /plan — extract the product, decide the tech, produce a ready spec

You are planning a Moduo feature with a **product designer, not an engineer**. Your job: extract everything only they know (product, UX, edge cases, scope, priorities) and decide everything they can't (infra, data model, libraries) by research. End with an approved spec that `/execute` can build block-by-block without ever stopping to ask a new question.

**Write no code. This is read-only research + questioning until the spec is approved.** Run in Plan Mode.

## 1. Orient (read first, silently)
- Write the session title file as soon as the topic is known: `[<Module>] <short title> plan` → `.claude/SESSION_TITLE` (CLAUDE.md §Session naming).
- `CLAUDE.md` → "Working posture" + "Knowledge map"; `docs/decisions.md`; `docs/gotchas.md`.
- The north-star docs (`docs/PRODUCT_BRIEF.md`, `docs/ROADMAP.md`, `docs/data-layers.md`) and, if it's a known module, its `.design/<module>/BRIEF.md` + `DESIGN_BRIEF.md` and `docs/moduo-module-contract.md`.
- Codebase recon belongs **here**, not in execution: use the **Explore** subagent (read-only) to map existing patterns, data shapes, and reuse opportunities. Spawn parallel Explores for breadth.

## 2. Grill the designer relentlessly
- Ask in batches; keep going until nothing is ambiguous. Err toward **50–100 questions up front**, not 10 mid-build. Cover: who/when/why, the main flow, every state (empty/loading/populated/error/permission/offline/slippage), edge cases, acceptance criteria, scope boundaries, priorities, the "one great moment."
- Always offer a **recommended answer** with each question so the designer can ratify rather than originate.
- The `grill-me` skill is the canonical posture; reuse it. For a UI feature you may also lean on `design-brief` / `information-architecture` to structure the interview — read them from the global skills, don't copy them.
- **Never ask the designer implementation, infra, data-model, or library questions.** Research those (Explore + web), decide, and record the decision + assumption in the spec. Surface a technical choice to the designer **only** when it changes the product (a cost/speed/UX tradeoff a user would feel) — framed in product terms with a recommendation.
- If you don't know something, research it deeply before proceeding. Never guess silently; never stall waiting on the designer for something you can find out yourself.

## 3. Fill the spec
- Copy `specs/_template.md` → `specs/<feature>.md` and fill every section. **You** author *Tests that prove them* from the acceptance criteria, each with its one-line plain-English note. Record every technical call under *Assumptions & technical decisions*; durable ones also get a line appended to `docs/decisions.md`.
- For a UI feature, **reference** the `.design/<module>` briefs and the module contract — don't restate them.

## 4. Decompose into execution blocks
- Block-sizing is **your** responsibility: size each block to complete within one execution's context budget, vertical-slice where possible, sequence with dependencies, each self-contained (its behavior + acceptance criteria + tests). Make blocks recoverable — a fresh session must be able to read the spec + `docs/decisions.md` and resume.

## 5. Definition-of-Ready gate
- Walk the DoR checklist at the bottom of the spec. If anything fails, return to grilling/research. When all boxes pass, state **"Ready to execute."** and list the blocks in order.
- Then hand off: the designer approves, switches to **auto mode**, and runs `/execute` per block.
