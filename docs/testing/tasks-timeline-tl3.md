# Manual test checklist — Tasks Timeline TL-3 (dependency layer)

> Generated 2026-07-03 · branch `claude/eloquent-engelbart-878286` · **Live-verified:** yes — connector create, duplicate no-op, arrow render, and panel removal were run on the hosted test workspace; see "Known gaps" for the rest.
> Arrow *rendering* + hover highlight shipped with TL-1 ([tasks-timeline-tl1.md](./tasks-timeline-tl1.md)); this block adds creation. Run top-to-bottom.

## Connector-dot creation (AC8)

- [ ] **Do:** hover any bar in Timeline → **Expect:** a small circle appears at the bar's right end, crosshair cursor _(both)_
- [ ] **Do:** drag the dot toward another bar → **Expect:** a dashed accent line follows the pointer; over a valid target the line goes solid and the target bar shows a quiet accent ring _(both)_
- [ ] **Do:** release on that bar → **Expect:** the dependency arrow appears (source's end → target's start); the target's title dims with the lock marker; its detail panel lists the source under "Blocked by" _(both)_
- [ ] **Do:** drag a dot back onto its own bar, or onto a task it already blocks → **Expect:** no ring while hovering, releasing does nothing — no error, no modal _(both)_
- [ ] **Do:** try to close a loop (A blocks B, then drag B's dot onto A) → **Expect:** same silent no-op (a cycle can't be created by drag) _(both)_
- [ ] **Do:** press Escape mid-drag → **Expect:** the line vanishes, nothing is created _(both)_
- [ ] **Do:** release the dot over empty canvas → **Expect:** nothing happens _(both)_

## Removal stays in the panel (v1)

- [ ] **Do:** open the blocked task's detail panel → Blocked by → the remove control → **Expect:** the arrow disappears from the timeline and the lock clears _(both)_

## Read-only

- [ ] **Do:** as a view-only member, hover bars → **Expect:** no connector dots; arrows still render _(web)_

## Known gaps / not-yet-testable

- **Cycle no-op + Escape cancel + self-drop** — proven by unit tests (`resolveConnectorDrop`) and by construction; not exercised live (kept the hosted demo data clean).
- **View-only** — verified via the `canEdit` gates + ReadOnly story, not live (owner account).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
