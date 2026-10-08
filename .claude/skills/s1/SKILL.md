---
name: s1
description: Stage 1 — Plan. Moduo planning session — grill the designer exhaustively on product/UX/edge-cases, research the technical layer yourself (read-only explore/recon subagents + web, never ask the designer how), fill specs/_template.md, decompose into context-sized execution blocks, and end at the Definition-of-Ready gate. Read-only, writes no code. Use before building any feature; run in your tool's read-only/plan mode if it has one. Not for building (that is /s2) or wrap-up (that is /s3).
effort: high
---

# /s1 — plan: extract the product, decide the tech, produce a ready spec

You are planning a Moduo feature with a **product designer, not an engineer**. Your job: extract everything only they know (product, UX, edge cases, scope, priorities) and decide everything they can't (infra, data model, libraries) by research. End with an approved spec that `/s2` can build block-by-block without ever stopping to ask a new question.

**Write no code. This is read-only research + questioning until the spec is approved.** Run in your tool's read-only/plan mode if it has one.

## 1. Orient (read first, silently)
- Set the session title as soon as the topic is known: `[<Module>] <short title> plan` (AGENTS.md §Session naming).
- `AGENTS.md` → "Working posture" + "Knowledge map"; the indexes `docs/decisions.md` and `docs/gotchas.md`, then the area files (`docs/decisions/<area>.md`, `docs/gotchas/<area>.md`) for the module you're planning.
- The north-star docs (`docs/PRODUCT_BRIEF.md`, `docs/ROADMAP.md`, `docs/data-layers.md`) and, if it's a known module, its `.design/<module>/BRIEF.md` + `DESIGN_BRIEF.md` and `docs/moduo-module-contract.md`.
- Codebase recon belongs **here**, not in execution: use read-only explore/recon subagents to map existing patterns, data shapes, and reuse opportunities. Spawn parallel explores for breadth.

## 2. Grill the designer relentlessly
- Ask in batches; keep going until nothing is ambiguous. Err toward **50–100 questions up front**, not 10 mid-build. Cover: who/when/why, the main flow, every state (empty/loading/populated/error/permission/offline/slippage), edge cases, acceptance criteria, scope boundaries, priorities, the "one great moment."
- Always offer a **recommended answer** with each question so the designer can ratify rather than originate.
- The `grilling` skill is the canonical interview posture; use it. For a UI question that words can't settle, use the `prototype` skill: a throwaway, clearly marked HTML or UI variation the designer can react to (`/design` artboards work too). Record resolved terms and decisions through `grill-with-docs` / `domain-modeling`, which follow [docs/agents/domain.md](../../../docs/agents/domain.md). For work spanning several specs (Meet-size), map it first with `wayfinder`.
- **Never ask the designer implementation, infra, data-model, or library questions.** Research those (explore subagents + web), decide, and record the decision + assumption in the spec. Surface a technical choice to the designer **only** when it changes the product (a cost/speed/UX tradeoff a user would feel) — framed in product terms with a recommendation.
- If you don't know something, research it deeply before proceeding. Never guess silently; never stall waiting on the designer for something you can find out yourself.

## 3. Fill the spec
- Copy `specs/_template.md` → `specs/<feature>.md` and fill every section. **You** author *Tests that prove them* from the acceptance criteria, each with its one-line plain-English note. Record every technical call under *Assumptions & technical decisions*; durable ones also become a full entry in `docs/decisions/<area>.md` plus one line in the `docs/decisions.md` index.
- For a UI feature, **reference** the `.design/<module>` briefs and the module contract — don't restate them.

## 4. Decompose into execution blocks
- Use the `to-tickets` skill to cut tracer-bullet blocks with explicit blocking edges; it writes them where [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md) says (the spec's *Execution blocks* table + `specs/BUILD_ORDER.md`).
- Block-sizing is **your** responsibility: size each block to complete within one execution's context budget, vertical-slice where possible, sequence with dependencies, each self-contained (its behavior + acceptance criteria + tests). Make blocks recoverable — a fresh session must be able to read the spec + `docs/decisions.md` and resume.

## 5. Definition-of-Ready gate
- Walk the DoR checklist at the bottom of the spec. If anything fails, return to grilling/research. When all boxes pass, state **"Ready to execute."** and list the blocks in order.
- Then hand off: the designer approves, switches to auto mode, and runs `/s2 <BLOCK>` per block, inside `/goal` for unattended lanes (template in the `/s2` skill).

**Model:** run planning on Opus 5.5 at high effort. On a Max plan, switch to Fable 5.1 (`/model fable`) for the final synthesis of a large, multi-spec plan, then switch back.
