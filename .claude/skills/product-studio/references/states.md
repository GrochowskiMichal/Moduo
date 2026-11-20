# States: the inventory and what "designed" means

A view is a set of states, and the happy path is one of them. The jury's critic reads the state
contact sheets before anything else, and the lab's state-coverage gate fails a view whose states
render blank, identical to the default, or overflowing. Build every state before any motion.

## The view states

| State | Designed means | Seed or fault in `lab.config.mjs` |
|---|---|---|
| Default | Realistic data: real-looking names, mixed lengths, a few items in each status | `default` |
| Empty | Says what this place is for and offers the next action in one click or key; no blank panel, no "No data" alone | `empty` seed: a workspace with nothing in it |
| First run | The empty state plus one sentence of orientation; no tour that blocks the work | `firstRun` seed: a new person |
| Loading | Skeletons at the final size, so nothing moves when data arrives; spinners only after 150 to 300 ms and for at least 300 ms | `loading` with a request delay and `capture: "early"` |
| Error | Says what failed and what to do; keeps the person's input; offers retry; never a stack trace | `error` with a failed request |
| Offline | Shows that changes are queued and will sync; the work stays usable where possible | `offline: true` |
| Dense | Hundreds of rows stay readable and fast; virtualized lists; nothing truncates without a way to see it | `dense` seed: hundreds of items |
| Long content | A 200-character title, a long name, a long email; wraps or truncates with a tooltip; layout holds | `long` seed |
| No permission | Explains who can grant access; no dead control that looks enabled | a seed for a member without the right |
| Partial | Some data failed while the rest loaded: show what loaded and mark what did not | a failed request on one endpoint only |

Mark a state as "cannot occur" only with a reason, in the inventory.

## The control states

Every interactive element has: **default, hover, focus-visible, active (pressed), disabled**.
Elements that do work add **loading** and **error**. Selectable elements add **selected**.

- Hover answers within one frame and changes more than nothing; primary targets change more than
  color alone when the house allows.
- Focus-visible is a clear ring or edge, never removed, never shown on mouse click.
- Disabled explains itself on hover or nearby when the reason is not obvious.
- Loading keeps the control's size and label width so the row does not jump.

## Overlay and transition states

Menus, popovers, dialogs, sheets and panels each have: opening, open, closing, closed, and
interrupted (opened again while closing). The interrupted state must end where the last input
says. The lab sends the opposite input at about 40% of the motion and records the result.

## What the lab checks

The state-coverage gate is computed by code from `states/index.json`:

- each declared state was captured, is not blank, and differs from the default frame;
- no horizontal overflow at any window size in the matrix;
- no layout shift from skeletons when data arrives;
- no console error or failed request other than the injected fault.

An 8 needs designed empty, loading, error, dense and long-content states on every main view, no
overflow and no shift. Anything the code cannot judge (does the empty state teach?) is left to the
critic, who reads the same frames.

## Done when

The inventory lists every view with every state marked built or "cannot occur" with a reason,
each built state is declared in `lab.config.mjs`, and each renders without motion as an
intentional still frame.
