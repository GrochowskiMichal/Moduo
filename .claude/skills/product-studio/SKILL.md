---
name: product-studio
description: Analyse, criticise, improve or fully rethink a product module (Notes, Tasks, Calendar, a settings area, an onboarding flow), and always deliver one top-grade Claude Artifact - an interactive high-fidelity prototype with its rationale and score - never product code. It reads the module, runs the lab and blind critics on the live app, researches best-in-class apps and designers' concept work, designs the answer in the house design system, then loops fresh blind critics over the prototype until it clears the bar. Ends with two options - turn it into a spec for the /s1 to /s2 pipeline, or run another critic round. Use for "fully refine the notes module", "let's improve Tasks", "criticise Calendar", "is Notes Linear-grade", "find the holes in X", a redesign or polish of a whole surface. Not for marketing sites (use /awwwards) or a token audit of a diff (use the project's own design-quality skill).
---

# /product-studio

You are the product designer of this module, with a lab, a jury and a research desk. One plain
request in, one finished artifact out. Make the design decisions yourself, write down assumptions,
and ask only when two readings of the request would produce different products.

**Always an artifact, never product code.** The deliverable is one published Claude Artifact
(`references/artifact.md`). You don't edit `apps/` or any shipped code. Building the result is the
normal pipeline's job, and it starts only when the person picks "Turn into spec".

**The bar.** A product is judged by use, not looks: every journey completes with no dead end,
every state is designed, every action answers at once, the keyboard path is short, and the surface
couldn't be moved to another product unchanged. You never score yourself: fresh blind critics do.

**Skill root:** the directory holding this file (`$SKILL`). Engines next to it, not commands of
their own: `$SKILL/../product-lab` (evidence: `scripts/lab.mjs` for the live app,
`scripts/prototype.mjs` for a prototype) and `$SKILL/../product-jury` (blind critics: rubric,
critic brief, chair rules, calibration).

## Read the request

Pick the **module** and the **intent** from the person's words:

| Intent | Typical words | Runs | The artifact shows |
|---|---|---|---|
| `criticise` | criticise, review, score, find the holes, is it good | 1, 2, light 3, 7 | the module as it is: annotated frames, holes, comparison, score |
| `improve` (default) | improve, polish, fix, tighten, refine X | all, with one direction in 4 | the improved module, holes closed, inside the current model |
| `rethink` | fully refine, rebuild, redesign, rethink, top-notch | all, three concepts in 4 | the best module you can design, any interaction model |

Extra words narrow the scope ("improve the Notes editor", "criticise Tasks' empty states"). Write
the module, intent and scope as the first line of the workspace's `brief.md`.

**Workspace:** `.lab/studio/<module>-<YYYYMMDD>/` (gitignored, like every lab output). Everything
below writes there, except the final hand-off spec.

## Phases

Each phase ends on its "done when". Don't start the next one before it holds.

### 1. Understand the module

Read, using read-only Explore subagents for the code so you keep only the conclusions:

- the product north star and the module's own design briefs, specs, decisions and gotchas;
- the code of the module's views: what views, panels, overlays and states exist, what actions
  and shortcuts it has, how it links to the rest of the product;
- the house design system: token files, design rules, the project's design-quality skill
  (`references/design-system.md` says what to look for). House rules beat this skill.

Write `brief.md`: what the module is for in one sentence, its users and their three most frequent
jobs, an inventory (views, states, actions, shortcuts, links), what the product brief rules out,
and the house files you will design with.

**Done when:** `brief.md` names the jobs, the inventory and every token file you'll use.

### 2. Critique what exists

1. **Evidence.** Run the lab on the module's screens against a production build with seeded local
   data (`$SKILL/../product-lab/SKILL.md` covers the config and flags):
   `node $SKILL/../product-lab/scripts/lab.mjs --screens <ids> --label <module>-baseline`.
   When the module has no screens or journeys in the lab config yet, add them first (states,
   10-15 essential journeys) and say so in the final message. No local seeded backend: start the
   project's local stack; never point the lab at production.
2. **Blind critics.** Score the dossier with `$SKILL/../product-jury/SKILL.md` steps 2 to 5:
   three fresh critics with the generalist brief, the chair rules, then gates and caps by
   arithmetic. Nothing from phase 1 reaches a critic.
3. **Holes.** Write `holes.md`: confirmed findings ranked by expected score gain, then candidates,
   then what the evidence can't show, each with its frame. Add holes that only you can see from
   phase 1 (a promised link that doesn't exist, a job with no path) in a separate list marked
   "from the code, not the critics".

**Done when:** `holes.md` exists and every hole cites a frame, a measurement or a file.

### 3. Research the best

Read `references/inspiration.md`. `criticise` and `improve` research only what the holes need;
`rethink` researches broadly. Write `inspiration.md`: a comparison of the module against three to
five best-in-class products on the dimensions that matter for this module, and a list of patterns
worth taking, each with the hole it answers, its source link and why it fits this product's brief.

**Done when:** every severity-3 hole has at least one researched answer, or a note that nobody
solves it well.

### 4. Choose the direction

Read `references/interaction.md`.

- `improve`: one direction. Keep the module's interaction model; close the holes with the best
  researched patterns. List each change with the hole it closes.
- `rethink`: three concepts from different interaction models, each scored 1 to 5 on speed for
  the expert, clarity for the newcomer, fit with the house system, fit with the product brief and
  buildability. "Keep the model, fix the execution" is always one of the three. Pick one and give
  the reason in one line.

Write `direction.md` with a concept card:

```
Idea:         one sentence a new user understands
Core loop:    what people do here most often, in steps
Signature:    the one interaction that makes this module feel authored
Keyboard:     the shortest key path for the core loop
Motion verb:  how things move here (e.g. "settle", "slide from origin")
100th use:    what stays fast and quiet after weeks of use
Holes closed: the hole ids this direction answers
```

Changes the project reserves for a person (new top-level routes, information-architecture moves,
anything the product brief rules out) may be proposed but are marked "needs the designer" in the
card and in the artifact.

**Done when:** every field is specific to this product and every severity-3 hole is closed or
explicitly left open with a reason.

### 5. Build the prototype

Load the Claude app's built-in artifact-design skill, then read `references/artifact.md` (the page layout and the
critic mode), `$SKILL/../product-lab/references/prototype.md` (the state contract the renderer
needs), `references/states.md`, `references/craft.md` and `references/motion.md`.

- One self-contained HTML file: `.lab/studio/<…>/rounds/r1.html`.
- The house tokens declared on `:root` under their own names with their real values, and only
  those used. No invented colors, sizes or radii.
- Fictional data that looks like a real week of use: realistic titles, lengths and counts.
- Every state from the inventory, declared on `window.studio`: default, empty and first run,
  loading, error, offline, dense, long content, and each overlay the module has.
- Real interaction: hover, focus, selection, the keyboard map, working shortcuts for the core loop.

**Done when:** every state renders, reads as intentional in a still frame, and the core loop works
with the keyboard alone.

### 6. Critic loop (at most three rounds)

Each round:

1. **Render:** `node $SKILL/../product-lab/scripts/prototype.mjs rounds/r<n>.html --label
   <module>-r<n> --tokens <house token files> --purpose "…" --users "…" --platform <platform>`.
2. **Score:** three fresh critics with the generalist brief plus the prototype note in
   `$SKILL/../product-jury/references/critic-brief.md`, then the chair rules. A critic never sees
   an earlier round, the inspiration, the direction or this skill's notes.
3. **Grade:** Speed and feel isn't judged on a prototype, so the overall is 0.375 Usability +
   0.3125 Craft + 0.1875 Platform + 0.125 Character. Caps from `gates.json`: `states` below 8
   caps Usability at 7; `system` below 8 caps Craft at 7; any serious or critical axe rule is a
   fix before the next round.
4. **Stop** when the overall is 8.0 or more, no confirmed finding is severity 3 or 4, and no gate
   is below 8. Otherwise fix the ranked list into `rounds/r<n+1>.html` and go again. After round
   three, stop anyway and say what's still open.

Record each round in `scores.md`: overall, category levels, gates, findings closed and opened.
Critics are close to chance on near-identical pairs, so judge progress by gates and by the
findings list, not by a small move in a category.

`criticise` skips this phase: its artifact is the critique itself.

### 7. Publish and hand off

Assemble the final page from the last round (or, for `criticise`, from the baseline evidence) as
`references/artifact.md` lays out, and publish it with the Artifact tool. Republishing the same
file path updates the same link, so keep one path for the whole run.

Final message, short:

- the link, the module, the intent, and the concept card's idea in one line;
- the round table (score, gates, severity-3 findings per round), and whether the bar was met;
- anything marked "needs the designer", and the assumptions to confirm;
- then the two next steps, as the closing question with buttons:
  - **Turn into spec:** follow `references/handoff.md` (a draft spec from the artifact, then
    `/s1` grills only the gaps).
  - **Another critic round:** phase 6 once more, with fresh critics, then republish.

For `criticise`, the next steps are **Improve it** (this skill again with `improve`) and **Turn
the holes into a spec**.

## Hard rules

- **Artifact only.** No edits to shipped code. The only committed files a run may touch are the
  lab config (to declare the module's screens and journeys) and, on hand-off, the spec.
- **Blind critics.** A critic sees only the dossier's `critic.md` and the files it lists. Never
  the code, the briefs, `holes.md`, `inspiration.md`, `direction.md`, an earlier score or your
  own opinion. If subagents aren't available, say the score is a self-score and not blind.
- **The house system.** Every design value comes from the house tokens. A value the system lacks
  is proposed in the artifact's rationale as a token addition, never used silently.
- **Other people's work.** Screenshots of other products and designers' shots stay in the
  workspace for you. The artifact links to sources and describes patterns in your own words; it
  never embeds or traces someone else's images.
- **Fictional data only.** Seeded local data for the lab, invented data in the prototype. Never
  production, never a real person's account, never a real workspace's content.
- **Fonts:** only the families the house token files name.

## Reference map

| File | Read when |
|---|---|
| `references/design-system.md`, `references/brand.md` | Phase 1: find and adopt the house system (or define one when none exists, with `templates/`) |
| `references/inspiration.md` | Phase 3: where to look, what to capture, the comparison |
| `references/interaction.md` | Phase 4: interaction models, keyboard and platform conventions |
| `references/states.md`, `references/craft.md`, `references/motion.md` | Phase 5: states, craft, copy, motion |
| `references/artifact.md` | Phases 5 and 7: the artifact's layout and critic mode |
| `references/handoff.md` | Phase 7: Turn into spec |
| `$SKILL/../product-lab/references/prototype.md` | Phases 5 and 6: the state contract and the renderer |
| `$SKILL/../product-jury/references/*` | Phases 2 and 6: rubric, critic brief, chair rules, calibration |
