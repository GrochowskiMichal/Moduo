# Motion in a product

Product motion is the reverse of award-site motion. A marketing site is rewarded for choreography
seen once. A product is used hundreds of times a day, so motion is rewarded for being rare, short
and useful. It explains where something came from or that a state changed. Everything else is
noise that turns into delay by the hundredth use.

## The frequency rule

How often a person sees an animation decides whether it should exist.

| Frequency | Examples | Motion |
|---|---|---|
| Keyboard-triggered or many times a minute | Command menu, list navigation, selection, tooltips after the first | None. Appears within 50 ms |
| Often | Menus, popovers, selects, hover and press | Short: hover 100 ms, menus 120 to 200 ms |
| Sometimes | Dialogs, sheets, side panels, view switches | 200 to 250 ms |
| Rarely | First run, a completed milestone | May delight, still under 500 ms |

## Budgets the lab measures

These are the bands the lab scores (p95, production build, warm app). Full marks first.

| Interaction | Full | Partial | Fails |
|---|---|---|---|
| Keystroke to glyph in inputs and editors | 16 ms or less | 33 ms | over 50 ms |
| Click or press to first visual response | 50 ms or less | 100 ms | over 200 ms |
| Local change with the server delayed 2 s | visible within 50 ms, before the server answers | 100 ms | waits for the network |
| Keyboard-triggered or frequent actions | no animation, 50 ms | 100 ms of motion | over 150 ms of motion |
| Menu or popover: first moving frame | 1 frame after input | 50 ms | over 100 ms |
| Menu or popover entry | 120 to 200 ms | 250 ms | over 300 ms |
| Dialog, sheet or panel entry | 200 to 250 ms | 300 ms | over 400 ms |
| Exit compared with entry | equal or shorter | 1.2 times | over 1.5 times |
| View switch: first response / content usable | 50 / 200 ms | 100 / 500 ms | over 200 ms / over 1 s |
| Dropped frames in a transition or drag | 0 | 1, none in a row | 2 in a row, or any frame of 50 ms |
| Drag, resize or scroll tracking | 1 frame behind the pointer | 2 frames | over 3 frames, or varying |
| Layout shift after an interaction | 0, anchors move 1 px at most | 4 px | anything later than 500 ms after input |
| Interrupt at 40% of the motion | reverses within 100 ms, last input wins | 200 ms | input ignored, or must wait |
| Slow work (search, import, AI) | feedback within 100 ms | result within 1 s | no feedback within 1 s |

No answer at all, and an ignored input, are hard fails whatever the numbers say.

## Rules

- **Animate `transform` and `opacity` only.** Never width, height, top, left, margin or padding.
  Name the properties in every transition; never `transition: all`.
- **Decelerate on entry, accelerate gently on exit.** No bounce, no elastic, no linear movement.
  Exits are equal to or shorter than entries.
- **Grow from the origin.** Menus and popovers scale from 0.95 or more (never from 0) at the
  edge that opened them, with opacity.
- **Interruptible always.** Use transitions or the Web Animations API, not one-shot keyframes,
  for anything a person can reverse. The last input wins.
- **One clock per surface.** No scroll listeners that set styles each event; no
  `requestAnimationFrame` loops left running at rest.
- **Hold the layout.** Reserve space for content that appears on hover; fade it in. Skeletons
  match the final size.
- **Use house motion tokens.** Durations and easings come from the system, never raw
  milliseconds or cubic-bezier in components.
- **Reduced motion keeps meaning.** Under `prefers-reduced-motion: reduce`, keep fades of 100 ms
  or less and drop translate and scale. Nothing keeps moving at rest.

## Where delight belongs

On rare moments only: finishing something, the first run, a milestone. One sanctioned delight
per surface is plenty, and it must still respect reduced motion and finish within 500 ms.

## Done when

Every animation on the surface has a one-sentence reason, uses house tokens, sits inside its
budget band, and none runs on a keyboard-triggered or high-frequency action.
