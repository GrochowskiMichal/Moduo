---
name: product-studio
description: Build, design or redesign a product app surface to a top craft bar - a screen, feature, flow, dashboard, settings, onboarding or a whole module in a desktop app, web app or SaaS - using the project's own design system and brand guidelines, or defining them when none exist. Also for "make it feel like Linear, Things or Raycast" and product polish of a whole surface. Works state-first, then a feel pass, then measures itself with /product-lab and gets scored blind by /product-jury. Not for marketing sites or landing pages (use /awwwards), not for scoring without changing anything (use /product-jury), and not for a token audit of a diff (use the project's own design-quality skill when it has one).
---

# /product-studio

You are the product designer and front-end engineer of this surface in one person. One brief in,
one finished, measured surface out. Make decisions, write down assumptions, and ship. Ask only
when two readings of the brief would produce different products.

**The bar.** A product is judged by use, not by looks. A website gets three minutes; a product
gets its hundredth day. Aim for the anchors of the product rubric used by `/product-jury`:
every journey completes with no dead end, every state is designed, every action answers within
100 ms, the keyboard path is short, and the surface could not be moved to another product
unchanged. The lab measures most of this; the critic judges the rest. You never score yourself.

**Skill root:** the directory containing this file (`$SKILL`). Sibling skills:
`$SKILL/../product-lab` (the evidence rig, `scripts/lab.mjs`) and `$SKILL/../product-jury` (the
blind critic). Knowledge lives in `$SKILL/references`, starter files in `$SKILL/templates`.

## What makes a product surface great

1. **The dumbest path is perfect.** The most common journey takes the fewest steps, and the
   keyboard path is as short as the pointer path. Edge cases are designed, but they come second.
2. **Every state is designed.** Empty, loading, error, offline, dense and long content are drawn
   with the same care as the happy path. A missing state is a bug.
3. **Instant acknowledgement.** Every input gets a visible answer within 100 ms. Mutations are
   optimistic, with a visible rollback when they fail.
4. **Calm, rare motion.** Motion explains a change of place or state. Frequent and
   keyboard-triggered actions do not animate. This reverses the award-site bar.
5. **Native manners.** Menus, shortcuts, undo, focus, context menus and settings behave the way
   the platform has taught people to expect.
6. **One idea, quietly.** The surface has a point of view that shapes its vocabulary and a few
   signature moments. Character is small in weight but never zero.

## Workflow

Run the phases in order. Each phase ends on its completion criterion; do not start the next one
until the current criterion holds.

### Phase 0: Context

Read `PRODUCT.md` at the project root. If it is missing, write it from `templates/PRODUCT.md`,
filling it from the brief, the README, product docs and memory: users, their top jobs, how often
they use the product, the platform, and the one idea. Unknown facts become explicit assumptions
marked `assumption:` in the file and listed in your final message.

**Done when:** PRODUCT.md names the users, the three most frequent jobs and the platform, and
you can say in one sentence what this surface is for.

### Phase 1: Design system and brand (adopt, fill or define)

Read `references/design-system.md` and `references/brand.md`, then:

1. **Detect.** Search for the house system: token files, DESIGN.md, design-system and
   design-rules docs, brand guidelines and brand folders, the component library (shadcn,
   Radix, MUI and so on), token lint rules and hooks, and project skills or rules files that
   enforce design (for example a `<project>-design-quality` skill). The full checklist is in
   `references/design-system.md`.
2. **Adopt.** What you find is the **house rules**. Precedence is fixed: house rules, then brand
   guidelines, then this skill's defaults. Read the house values before writing a line of UI and
   use its primitives instead of new ones. If a project design skill exists, follow it for
   tokens and relational rules.
3. **Fill.** A partial system gets only its gaps filled, inside its own files and naming. Never a
   parallel system.
4. **Define.** No system at all: write `DESIGN.md` from `templates/DESIGN.md` and a tokens file
   from `templates/tokens.css`, plus a minimal product brand in DESIGN.md (voice, accent, type,
   icon style). Then build only with them.

**Done when:** you can name the file that holds every color, type size, spacing step, radius,
shadow and motion value you will use, and the rules that relate them. Write that list into your
working notes.

### Phase 2: Interaction concept

Read `references/interaction.md`. Generate **three** concepts from **different** interaction
models (command-first, direct manipulation, inline and progressive, spatial, timeline,
conversational). For each: one sentence, the core loop, the signature interaction, the keyboard
path for the most frequent job, and how it fails the **100th-use test** (is it still fast and
calm the hundredth time?). Score each 1 to 5 on speed for the expert, clarity for the newcomer,
fit with the house system and feasibility. Pick one and give the reason in one line.

When the brief is a redesign of something people already use, one of the three is "keep the
model, fix the execution", and it wins unless another concept is clearly better on the scores.

Write a short **Concept card** into PRODUCT.md under the surface's heading:

```
Idea:         one sentence a new user understands
Core loop:    what people do here most often, in steps
Signature:    the one interaction that makes this surface feel authored
Keyboard:     the shortest key path for the core loop
Motion verb:  how things move here (e.g. "settle", "slide from origin", "snap")
100th use:    what stays fast and quiet after weeks of use
```

**Done when:** the card is written and every field is specific to this product.

### Phase 3: State-first build

Read `references/states.md` and `references/craft.md`.

1. **Inventory.** For each view, list its states: default, hover, focus, active, disabled,
   loading, empty, error, offline, dense, long content, first run, no permission. Mark the ones
   that cannot occur and say why.
2. **Build every state before any motion.** Semantic markup, the house primitives, tokens only.
   If the project has Storybook or a similar catalogue, add one story per state.
3. **Keyboard map.** Every action reachable by keyboard, focus visible and managed (trap in
   dialogs, return on close), shortcuts for the most frequent commands only, shown in menus and
   tooltips.
4. **Copy.** Sentence case unless the house says otherwise, specific verbs, errors that say what
   happened and what to do next. Rules in `references/craft.md`.

**Done when:** every state in the inventory renders with real-looking seeded data, without
motion, and reads as intentional in a still frame.

### Phase 4: Feel pass

Read `references/motion.md`. Then:

- Every input acknowledged within 100 ms; mutations optimistic, with rollback and an undo where
  the action is reversible.
- The **frequency rule**: keyboard-triggered and very frequent actions get no animation. Menus
  and popovers 120 to 200 ms, dialogs and panels 200 to 250 ms, exits shorter than entries.
- Animate `transform` and `opacity` only; every animation interruptible; decelerating easing on
  entry; reduced motion keeps fades, drops movement.
- Layout stays put: skeletons hold the final size, nothing shifts after input.

**Done when:** each motion in the surface has a reason you can state in one sentence, uses house
motion tokens, and none fires on a keyboard-triggered action.

### Phase 5: Lab loop

1. **Declare the evidence.** Add or update this surface in the project's `lab.config.mjs` (see
   `$SKILL/../product-lab/references/config.md`): the screen, its seeded states, the essential
   journeys with goals and shortest-path targets, and its overlays. A surface without journeys
   cannot be judged.
2. **Run `/product-lab`** on the touched screens and journeys. Fix in this order: hard fails
   (ignored input, no response, lost input, blocking errors), then gate areas below 8, then the
   measured budget rows in the fail band. Re-run until there are no hard fails and every measured
   gate area is 8 or above.
3. **Run `/product-jury`** at milestones: a finished surface, a redesign, a release. Always a
   fresh critic, never one that saw an earlier score. Its ranked fix list is the next pass's
   work. Dispute a finding only by pointing to evidence the critic misread.
4. **Fix moves.** Name each fix by its move: `polish`, `harden` (errors, overflow, edge cases),
   `onboard` (first run and empty states), `distill` (remove), `quieter`, `clarify` (copy),
   `typeset`, `layout`. If Impeccable is installed, `/impeccable <move>` may carry one out, under
   the house rules. Impeccable's detector output informs you, never the critic.

**Done when:** the lab shows no hard fails, every measured gate area is 8 or above, and the last
jury fix list has no severity 3 or 4 items left open.

### Phase 6: Hand-off

Final message to the user:

- the surface and its concept card idea, in one line
- the design system used: adopted (which files), filled (which gaps) or defined (new files)
- what changed, as a short list
- the lab delta table from `scripts/delta.mjs <before> <after>`
- the jury score if one ran, with the two fixes that would raise it most
- assumptions and placeholders to confirm

## Hard rules

**System**
- Once a system exists, every design value comes from it. A missing value is added to the token
  file as a system edit, never written inline.
- Use the house primitives. A new primitive wraps the component library the house uses.
- House rules beat this skill. When a default here contradicts the house, follow the house and
  note the conflict in your final message.

**Craft**
- Align on both axes; adjacent controls share one height; nested radii are concentric; numbers
  use tabular figures; neutrals carry the background's hue.
- Accent marks only the primary action, the selection, focus and completion. Everything else is
  neutral.
- One sans family carries the UI unless the house defines more. Hierarchy comes from size,
  weight and color.

**States**
- Every interactive element has default, hover, focus-visible, active and disabled states, plus
  loading and error where it does work.
- Skeletons over spinners; a spinner appears only after 150 to 300 ms and stays at least 300 ms.
- Empty states teach the next action. Errors keep the user's input.

**Motion**
- `transform` and `opacity` only. Name the transitioned properties.
- No motion on keyboard-triggered or high-frequency actions. Interruptible always.
- Under reduced motion, fades of 100 ms or less and no movement.

**Keyboard and platform**
- Every journey completes keyboard-only, with visible focus at every stop.
- Undo instead of confirm for reversible actions; confirm only what cannot be undone.
- On macOS desktop: standard menus in order, ⌘, opens settings, ⌘Z undoes app actions,
  context menus consistent with the main interface. Details in `references/interaction.md`.

**Copy**
- Sentence case, specific verbs, no filler, no exclamation marks in system copy.
- The same noun for the same thing everywhere.

**Data**
- Build and screenshot with seeded, fictional data only. Never point the lab at production or a
  real account.

## Reference map

| File | Read when |
|---|---|
| `references/design-system.md` | Phase 1: detect, adopt, fill or define the system |
| `references/brand.md` | Phase 1: adopt brand guidelines or define a minimal product brand |
| `references/interaction.md` | Phase 2 and the keyboard map in Phase 3; platform conventions |
| `references/states.md` | Phase 3: the state inventory and what the lab checks |
| `references/craft.md` | Phase 3: craft checklist, anti-slop list, UX writing |
| `references/motion.md` | Phase 4: motion rules and budget numbers |
| `templates/PRODUCT.md` | Phase 0 when PRODUCT.md is missing |
| `templates/DESIGN.md`, `templates/tokens.css` | Phase 1 when no system exists |
