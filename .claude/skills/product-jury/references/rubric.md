# The product rubric

A product app is judged over hours of repeated use, not minutes of first impression. Speed and
platform fit pay off with every use; delight wears off. So the rubric keeps /jury's shape
(weighted categories plus separate gate areas) and re-weights it for a tool people use daily.
The weights and anchors are a reasoned proposal: no product award publishes weights to fit them
to.

## Categories

The critic picks one level per category: below 6, 6, 7, 8 or 9. It starts at 6 and needs cited
evidence for every step above it. "Below 6" counts as 5 in the overall.

Overall = 0.30 Usability + 0.25 Craft + 0.20 Speed and feel + 0.15 Platform and keyboard +
0.10 Character.

| Key | Category | Weight | Evidence it reads |
|---|---|---|---|
| `usability` | Usability: clarity and flow | 30% | journey frames, state contact sheets, fault states, keystroke and click counts |
| `craft` | Craft: visual and interaction detail | 25% | contact sheets, hover and focus pairs, window sizes, token-drift crops |
| `speed` | Speed and feel | 20% | latency per class, frames per overlay and step, durations, easing, layout shift |
| `platform` | Platform and keyboard | 15% | keyboard-only journeys, focus walk, counts vs target, menu and undo checks |
| `character` | Character: point of view | 10% | contact sheets and frame strips, read last |

### Usability: clarity and flow (30%)

- **6:** Every journey can be finished, but at least one has a dead end, a hidden next action or
  a missing state. At least one severity-3 finding.
- **7:** No dead ends. Empty, loading and error states exist on the main views. The primary path
  is short. No severity-3 findings.
- **8:** Every step answers the four walkthrough questions (will the user try this, notice the
  control, connect it to the goal, see progress). Dense and long-content states are designed.
  Undo instead of confirm. Save, sync and offline status always visible. No lost input.
- **9:** The primary path sits near the minimum number of steps. Finishing a journey leads
  somewhere useful. Every essential journey reads as effortless.

### Craft: visual and interaction detail (25%)

- **6:** Clean but generic. Misaligned rows, mixed control heights, off-scale values, hovers that
  snap.
- **7:** A clear type and spacing system. Adjacent controls match. Designed hover, focus and
  active states.
- **8:** Aligned on both axes, concentric radii, tinted neutrals, deliberate density. Empty and
  error states drawn as carefully as full ones.
- **9:** Skillfully drawn, distinctive and cohesive. Recognisable from a crop.

### Speed and feel (20%)

- **6:** Some actions stay silent for more than 100 ms. A view switch or a save takes over 500 ms.
  Spinners flash. Motion runs over 300 ms, animates layout properties, or plays on the command
  menu.
- **7:** Every action is acknowledged within 100 ms. Saves finish under 500 ms or show the result
  before the server answers. Motion uses transform and opacity, under 300 ms. Reduced motion is
  honoured.
- **8:** Optimistic everywhere, with a visible rollback when a save fails. No animation on
  keyboard-triggered or very frequent actions. Motion can be interrupted. Drags drop no frames.
- **9:** Feels instant under CPU throttling. Motion only explains a change of place or state.

### Platform and keyboard (15%)

Judge against the platform in `critic.md` (the lab's `platform-brief.md`), not against web habits.

- **6:** A web page in a window. Journeys that need a pointer, focus lost or hidden, undo not
  wired to app actions, standard shortcuts missing or repurposed.
- **7:** Every core journey works keyboard-only with visible focus. Standard shortcuts work
  (settings, undo, escape cancels). App actions can be undone.
- **8:** Every platform check in the brief holds. Keystrokes sit close to the journey's shortest
  path. Shortcuts are discoverable in the UI.
- **9:** A power user can't tell it from a first-class native app.

When the run used the web proxy, native menus and window chrome are not in the evidence: score
what the frames show and list the rest under "cannot judge".

### Character: point of view (10%)

First question: could an unrelated product use this screen unchanged?

- **6:** Competent and anonymous.
- **7:** One identifiable idea, partly carried through. A consistent voice.
- **8:** The idea shapes layout, vocabulary and a few signature moments. Delight only in rare
  moments.
- **9:** An interaction others will copy.

## Gate areas (computed by code, never by the critic)

The lab computes six gate areas from measurements into `gates.json`. They stay out of the
weighted overall and cap categories after the critics finish. The critic never sees them.

| Gate area | An 8 needs | Cap when the area is below 6 |
|---|---|---|
| Accessibility | no serious or critical axe violations; every control named; visible focus at every stop; reduced motion complete; contrast passes | none (reported) |
| Performance | p95 acknowledgement ≤100 ms; saves under 500 ms or optimistic; no long frame over 50 ms during input; no dropped frames in scripted drags | `speed` max 6 |
| State coverage | designed empty, loading, error, dense and long-content states on every main view; no overflow; no shift from skeletons | `usability` max 7 |
| Reliability | no console errors, unhandled rejections or failed requests across journeys; no lost input under faults | `usability` max 6 |
| Platform conformance | menu, keyboard, undo, settings, context-menu and window checks pass | `platform` max 6 |
| System conformance | token conformance "Tight"; concentric radii; no `transition: all`; only transform and opacity animated | `craft` max 7 |

**Hard fails** (an ignored input, an action with no response, lost input, a crash or an error
that blocks a journey) and any confirmed **severity-4** finding cap the overall at **5.5**. All
cap values are untested proposals; record what they do in `calibration.md`.

## Finding severity (Nielsen 0 to 4)

| Severity | Meaning | Derived from evidence |
|---|---|---|
| 4 | catastrophe: fix before anyone uses it | blocks a journey, loses input, crashes |
| 3 | major: high priority | stops or misleads a main task, or recurs on several screens |
| 2 | minor: low priority | slows a task, has an obvious workaround |
| 1 | cosmetic | visible, harmless |
| 0 | not a problem | drop it |

## Fix moves

Every fix names one move, so the builder knows what kind of change it is. The words come from
Impeccable's command verbs; the definitions here stand alone, so nothing needs to be installed.

| Move | What the fix does |
|---|---|
| `harden` | makes a state survive reality: errors, empty, slow, offline, long text, many items |
| `onboard` | teaches on first use: empty states that explain and offer the first action |
| `polish` | fixes small inconsistencies: alignment, spacing, states, icons, copy details |
| `distill` | removes what doesn't serve the task: fewer elements, levels, options or steps |
| `quieter` | lowers visual volume: less color, weight, motion or decoration |
| `clarify` | rewrites labels, messages and microcopy so the next action is obvious |
| `typeset` | fixes the type system: sizes, weights, line height, line length, hierarchy |
| `layout` | fixes structure: grid, alignment, density, grouping, what sits where |
| `animate` | adds, shortens, removes or re-eases motion so it explains a change |
| `delight` | adds one considered moment of personality where it is rare and earned |
| `adapt` | fixes behaviour across window sizes, zoom, themes, input modes or platforms |
| `optimize` | makes it faster: latency, optimistic updates, rendering, dropped frames |
