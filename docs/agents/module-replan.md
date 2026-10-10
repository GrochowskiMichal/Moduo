# Module re-plan: the reusable prompt

The process that produced Tasks v3 (2026-10-09 → 2026-10-10: `.design/tasks-v3/REPLAN.md` → `specs/tasks-v3.md`), written as a prompt Maciej can paste for any module. Copy the block below, fill the `<…>`, send it as the first message of a fresh session on **Opus 5.5 at high effort**. Switch to **Fable 5.1** only for the final spec step, when the session asks.

---

```
Re-plan the <MODULE> module before any code or sessions on it resume. Run the process from docs/agents/module-replan.md exactly; the Tasks v3 re-plan (.design/tasks-v3/REPLAN.md, specs/tasks-v3.md) is the reference for depth and format.

Context you must read first: AGENTS.md, docs/PRODUCT_BRIEF.md, docs/ROADMAP.md, docs/data-layers.md, docs/moduo-module-contract.md, .design/<module>/BRIEF.md and DESIGN_BRIEF.md, the module's spec(s) in specs/, docs/decisions/<area>.md and docs/gotchas/<area>.md, and specs/tasks-v3.md (the UI north star every module copies; never contradict its rules 38–46a, 48a, 48b, its References primitive, its panel/capture registries or its key map).

Goal: make <MODULE> complete and pleasant for <ROLES: e.g. students, developers, PMs, founders and ≤5 teams, freelancers/agencies, creators>, so each can run a normal week without <THE TOOLS IT REPLACES>. Not 1-to-1 copies. Don't be bound by earlier decisions if you can show evidence they were poor. The module is done only when it wires into the spine, ships its MCP tools and its dashboard widgets.

Known inputs: <PASTE: dogfood notes, review lists, prior research, Mike's notes, links>.
Open constraints: <e.g. "no new routes", "desktop only", "keep X as is">.

Rules of the conversation:
- I'm the product designer. Ask me product, UX, scope and priority questions only — never implementation, infra, data-model or library questions; research and decide those yourself and record the decision + the rejected alternative.
- Number every call once, starting at 1; never renumber; ask each under its number with a recommendation; record my answer under the call in my words. Re-ask what I questioned with fuller reasoning, never re-argue what I decided.
- When words can't settle a UI question, build a throwaway HTML prototype (keys 1–9 switch frames, V cycles variants) and send it; it must show the full 3×3 layout with the bottom bar, use the real tokens, and never use rotated text.
- Keep the plan in one file, .design/<module>-v<N>/REPLAN.md, with a status block at the top listing what's open; write every answer into it before replying, so a compaction loses nothing. Research lanes write their own files under research/.
- When I defer a choice ("you decide", "I trust you"), record it as "agent's choice, deferred to by Maciej — confirmed for building, may be reconsidered", with a one-line why and the rejected alternative.
- Every proposal states whether someone outside its target group would still want it (principle 48a), and respects the layout principle 48b.
- Reply format: Status line first; decided calls; then the open calls with ★ on the load-bearing ones; new topics get one opening call each; end with a Session line (safe to archive or not, what's uncommitted).
```

---

## The rounds the session runs

1. **Orient and diagnose** (read-only): the root cause (who the module was first specified for; which reversals share one shape), what is genuinely strong, what's broken in kinds (structure, trust bugs, capability gaps, visual seams, no way in).
2. **Research lanes in parallel** (background agents, each writing a file, returning ≤300 words): current state from code and the live app in a seeded workspace with a second member; a visual audit with measurements; an early-decisions audit (keep / adjust / reverse); structure across competitors; role journeys (a normal week per role, with the gap map); then per-view competitor comparisons as the rounds go.
3. **Round 1: the shape.** Calls on structure, vocabulary, principles; a consistency pass across calls; a prototype for the structure.
4. **Rounds 2a/2b: every surface**, view by view and state by state (empty · loading · error · read-only · offline · very large), the shared pieces (references, panel, capture), and a gap audit by a separate agent that walks every role's week and every view × state, reporting only what's unaddressed, contradictory or too thin. Fold the audit into calls; fix contradictions in place.
5. **Round 3: reconcile in-flight PRs** — keep / re-scope / close-and-salvage / superseded, with effort and order.
6. **The spec** (switch to Fable 5.1, high): `specs/<module>-v<N>.md` from `specs/_template.md`, written section by section into the file (never in one message), with role-week acceptance criteria, a test per AC sub-item, a notification table and a key map inside the spec, blocks continuing the module's existing id lanes, migrations named per block, the DoR gate; then the decision entries (4 lines each: who · what · why · rejected) in `docs/decisions/<area>.md` and the index, the BUILD_ORDER re-sequence, a supersession banner on the old spec, a `validator` pass, fixes, "Ready to execute".
7. **Memory:** keep a project memory note with the re-entry point (the REPLAN status block) and update it every round.

## What the Tasks re-plan taught (keep these)

- Prototypes decide more than paragraphs; Maciej answers fastest to frames with variants.
- One name per concept, app-wide (section vs column; Focus vs Queue); check the grammar `@ # /` before proposing any token.
- Avoid jargon ("scale bar"); say it in product terms.
- No label clutter in sidebars, no user-picked icons, no rotated text, no red, no AI badge or colour, pink is not an accent.
- The 3×3 layout is a founding rule; edge strips and rails are off the table.
- Security findings never go into repo files; report them privately and fix them in their own session.
- The modules will all be rebuilt after Tasks: design shared pieces as contracts the next module adopts, not against today's code.
