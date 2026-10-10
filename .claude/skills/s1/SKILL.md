---
name: s1
description: Stage 1 — Plan. Moduo planning session — interview the operator on product/UX/edge-cases (exhaustively for a designer, 10–20 product-code questions for an engineer), research the technical layer yourself (read-only explore/recon subagents + web), fill specs/_template.md, decompose into context-sized execution blocks, and take the first two blocks to Definition-of-Ready. Read-only, writes no code. Use before building any feature; run in your tool's read-only/plan mode if it has one. Not for building (that is /s2) or wrap-up (that is /s3).
effort: high
---

# /s1 — plan: extract the product, decide the tech, make the first blocks ready

You are planning a Moduo feature. Your job: extract what only the operator knows (product, UX, edge cases, scope, priorities), decide what they don't want to decide (infra, data model, libraries) by research, and end with a spec whose **first two blocks** `/s2` can build without stopping to ask. Later blocks may still carry assumptions; they get their own DoR pass when their turn comes.

**Write no code. This is read-only research + questioning until the first blocks are approved.** Run in your tool's read-only/plan mode if it has one.

## 0. Who you are planning with
The session preflight prints the **operator mode** (`docs/local/OPERATOR`, default `designer`; see AGENTS.md §Working posture).
- **designer** (Maciej): authoritative on product, UX, scope; not on infrastructure. Grill exhaustively, never ask implementation questions, surface a technical choice only in product terms.
- **engineer** (Mike): wants to push through and decide product-code tradeoffs against something concrete. Ask **10–20 questions**, all of the kind "the code could go A or B and the user would feel it"; decide everything else yourself and record it as an assumption. Don't grill on states and edge cases they'd rather see in a build; list them as assumptions with the test that will prove them.

## 1. Orient (read first, silently)
- Set the session title as soon as the topic is known: `[<Module>] <short title> plan` (AGENTS.md §Session start).
- `AGENTS.md` → "Working posture" + "Knowledge map"; `docs/gotchas.md` and the area files (`docs/gotchas/<area>.md`); the **last five entries** of `docs/decisions/<area>.md` for the module you're planning (the index `docs/decisions.md` is generated and for people).
- The north-star docs (`docs/PRODUCT_BRIEF.md`, `docs/ROADMAP.md`, `docs/data-layers.md`) and, if it's a known module, its `.design/<module>/BRIEF.md` + `DESIGN_BRIEF.md` and `docs/moduo-module-contract.md`.
- Codebase recon belongs **here**, not in execution: use read-only explore/recon subagents to map existing patterns, data shapes, and reuse opportunities. Spawn parallel explores for breadth.

## 2. Interview
- Ask in batches with a **recommended answer** on every question, so the operator ratifies rather than originates. Designer mode: err toward 50–100 questions up front, covering who/when/why, the main flow, every state (empty/loading/populated/error/permission/offline/slippage), edge cases, acceptance criteria, scope boundaries, priorities, the "one great moment." Engineer mode: the 10–20 product-code questions above, then stop asking.
- The `grilling` skill is the canonical interview posture. For a UI question that words can't settle, use the `prototype` skill: a throwaway, clearly marked HTML or UI variation the operator can react to. Record resolved terms through `domain-modeling` ([docs/agents/domain.md](../../../docs/agents/domain.md)). For work spanning several specs (Meet-size), map it first with `wayfinder`.
- **Never ask the designer implementation, infra, data-model, or library questions.** Research those (explore subagents + web), decide, and record the decision + assumption in the spec. Surface a technical choice **only** when it changes the product (a cost/speed/UX tradeoff a user would feel), framed in product terms with a recommendation.
- If you don't know something, research it deeply before proceeding. Never guess silently; never stall waiting on the operator for something you can find out yourself.

## 3. Fill the spec
- Copy `specs/_template.md` → `specs/<feature>.md` and fill every section. **You** author *Tests that prove them* from the acceptance criteria: **one automated test per criterion** where the cheapest layer allows it (unit, component, or an e2e smoke under `e2e/`), each with its one-line plain-English note. That table is the block's oracle: `/s2` writes those tests first and is done when they pass.
- Record every technical call under *Assumptions & technical decisions*. Mark each **confident** or **low-confidence**; a low-confidence one names its verification step (a test, a live check, or a question `/s2` raises under ❓ Needs you once the code exists). Durable ones also become a full entry at the top of `docs/decisions/<area>.md` (the index regenerates itself; don't edit it).
- For a UI feature, **reference** the `.design/<module>` briefs and the module contract; don't restate them.

## 4. Decompose into execution blocks
- Use the `to-tickets` skill to cut tracer-bullet blocks with explicit blocking edges; it writes them where [docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md) says (the spec's *Execution blocks* table + `specs/BUILD_ORDER.md`, which is the dependency graph: `**<ID> — <name>** · deps: <IDs or —> · lane <name>`; block state is derived from PRs by `bun run next`, so no checkboxes to maintain).
- Block-sizing is **your** responsibility: size each block to complete within one execution's context budget, vertical-slice where possible, sequence with dependencies, each self-contained (its behavior + acceptance criteria + tests). A fresh session must be able to read the spec + the area's decisions and resume.

## 5. Definition-of-Ready gate, per block pair
- Walk the DoR checklist at the bottom of the spec **for blocks 1 and 2**. If anything fails for them, return to interview/research. Later blocks need only their row in the table and their acceptance criteria; an open question they carry is fine as long as it's written as a low-confidence assumption with a verification step, and it gets its own DoR pass when `/s2` picks it.
- When blocks 1 and 2 pass, state **"Ready to execute: <ID>, <ID>."** and list the rest in order with what each still needs.
- Then hand off: the operator approves and runs `/s2 <BLOCK>` per block, inside `/goal` for unattended lanes (template in the `/s2` skill). `/s2` lands the block itself; nothing waits for a checkpoint except the decisions it lists under ❓ Needs you.

**Model:** run planning on Opus 5.5 at high effort. On a Max plan, switch to Fable 5.1 (`/model fable`) for the final synthesis of a large, multi-spec plan, then switch back.
