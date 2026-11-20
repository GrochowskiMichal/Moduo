# Turn into spec

The artifact settles most of what a planning session would ask: behaviour, every state, copy,
keyboard, layout. So the hand-off writes a draft spec from it, and the planning skill grills only
what the artifact left open.

## 1. Draft the spec

Copy the project's spec template (in Moduo, `specs/_template.md`) to
`specs/<module>-<slug>.md`, on a task branch. Fill it from the workspace:

| Spec section | Comes from |
|---|---|
| Header | the artifact's link, the final score and the round it reached; "Draft from /product-studio" |
| Scope | the direction's changes; what stays out (holes left open, anything marked "needs the designer") |
| Product behavior & UX | the concept card, then per view: each state as the prototype shows it, the keyboard map, copy. Reference the artifact for visuals; don't redraw them in words. |
| Edge cases | the states inventory beyond the default (empty, error, offline, dense, long, permission) |
| Acceptance criteria | one per closed hole ("the error state shows a retry and keeps the sidebar"), one per state, the gate targets (no serious axe rule, token conformance Tight) |
| Tests that prove them | leave for the planning skill, which owns them |
| Assumptions & technical decisions | token additions proposed; data the prototype assumed exists (mark each "verify in code") |
| Execution blocks | a first cut: one block per view or per hole group, ordered by the holes' severity. The planning skill re-cuts them. |
| (in Execution blocks) | the screens, states and journeys the lab config must gain, so the built result can be measured against the prototype's bar |
| Open questions | everything marked "needs the designer", every assumption, every hole left open |

## 2. Hand it to planning

Run the planning skill (in Moduo, `/s1`) with the draft spec's path and the artifact link, and
say: "Draft from the product studio. Grill only the open questions and anything the artifact
can't answer (data, permissions, sync, migration of existing content), then cut the blocks and run
the Definition-of-Ready gate." The planning skill owns everything from there.

## 3. Close the loop later

When the blocks are built, run this skill again with `criticise` on the module. The new baseline
against the artifact's final score shows how much of the design made it into the product.
