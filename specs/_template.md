<!--
  SPEC TEMPLATE — copy to specs/<feature>.md and fill every section.
  Produced by /plan; consumed by /execute. The user is a product designer, not an
  engineer: this captures PRODUCT intent in plain language, and the agent fills the
  technical layer (Assumptions, Tests, Execution blocks) by research, not by asking.

  Relationship to the design briefs (don't duplicate them):
  - .design/<module>/BRIEF.md        = product intent (JTBD, depth ceiling, spine wiring, DoD)
  - .design/<module>/DESIGN_BRIEF.md = the design/interaction/visual build spec
  - docs/moduo-module-contract.md    = the 4-pillar "module is done when…" checklist
  This spec REFERENCES those for a module feature and adds the execution contract:
  acceptance criteria, the tests that prove them, the block decomposition, and the
  Definition-of-Ready gate. Delete the HTML comments as you fill each section.
-->

# Spec: <feature name>

> Status: **Draft** · Owner: <maciej|mike> · Related briefs: `.design/<module>/BRIEF.md`, `.design/<module>/DESIGN_BRIEF.md`

## Scope

<!-- One paragraph: what this delivers, for whom, and why now. If it's a module feature, link its BRIEF/DESIGN_BRIEF instead of restating them. -->

## Product behavior & UX

<!-- What happens, for whom, in what states. Walk the main flow step by step. Cover the happy path and each meaningful state: empty, loading, populated, error, permission-denied, offline. Be concrete enough that two people would build the same thing. -->

## Edge cases

<!-- Failure / empty / loading / permission / concurrency / slippage states and what the user sees in each. One bullet per case. These become tests below. -->

## Acceptance criteria

<!-- Plain product language, testable. Pattern: "When the user does X, Y happens; if Z fails, show …". Number them (AC1, AC2, …) so tests can cite them. No implementation detail here. -->

- **AC1** — …
- **AC2** — …

## Tests that prove them

<!--
  The AGENT authors these from the acceptance criteria — the user does not write tests.
  For each test: the test name/file + a one-line PLAIN-ENGLISH note of what it checks,
  so the user can sanity-check coverage without reading test code. Map each back to an AC.
  Pick the cheapest layer that proves the AC (see docs on the test layers):
    unit (Vitest, src/**/*.test.ts) · component/visual (Storybook + Playwright) ·
    e2e smoke (Playwright tests/) · billing e2e (manual/scheduled, never the default gate).
-->

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/features/<x>/<y>.test.ts` · "…" | AC1 | … |

## Assumptions & technical decisions

<!-- What the agent decided ON THE USER'S BEHALF and why: data model (Supabase-first), library choices, intent-op shapes, permission mapping, migration approach. Each = decision + one-clause rationale + the alternative rejected. Anything durable also gets a line in docs/decisions.md. -->

## Execution blocks

<!--
  Decompose the feature into blocks each sized to complete within a single execution's
  context budget (block-sizing is the agent's responsibility). Each block is self-contained:
  its slice of behavior, its acceptance criteria, and its tests. Sequence with dependencies.
  This is what the user "presses play" on, one block at a time. Vertical slices preferred
  (see the brief-to-tasks convention). Keep blocks recoverable: a fresh session must be able
  to read this spec + docs/decisions.md and resume a block from scratch.
-->

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | … | … | AC1 | — |
| 2 | … | … | AC2 | 1 |

## Out of scope

<!-- Explicit non-goals, so /execute doesn't gold-plate. Include the depth-ceiling line for the module if relevant. -->

---

## Definition-of-Ready gate

> **/execute must not start a block until this is all true.** This replaces the user's mental "is the spec complete?" checklist. If any item fails, go back to grilling/research — do not start building.

- [ ] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [ ] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [ ] **Open questions is empty** — every product question is answered, every technical unknown is researched and recorded under *Assumptions & technical decisions* (no "we'll figure it out during build").
- [ ] **Data model is named and Supabase-first** (or a deliberate exception is recorded). New tables/columns/migrations are identified.
- [ ] For a **module feature**: spine wiring is enumerated (links / attach / drag / @mention / notifications / activity / tags), MCP tools are listed, and the dashboard widget is defined — per `docs/moduo-module-contract.md`.
- [ ] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [ ] **Design constraints acknowledged**: tokens-only (no hardcoded visual values), shadcn-wrapped primitives, and the relevant `DESIGN_RULES.md` rules for any UI.
- [ ] **Manual-test surfaces identified** for the session wrap-up checklist (`docs/testing/<branch>.md`).

When all boxes are checked, state: **"Ready to execute."**

## Open questions

<!-- MUST be empty before execution. Anything here is a blocker. Product questions → ask the user. Technical questions → research and move to Assumptions; never leave them here. -->

- [ ] (none)
