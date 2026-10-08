# Manual test checklist — DS-2 primitives on the state layer, tint-only selection

> Generated 2026-10-08 · branch `t/maciej/ds-2-state-layer-primitives` · **Live-verified:** partial.
> - **Checked by the agent in Storybook:** the raised plates are lighter than their track on all six dark shades (text and icon-only segmented controls and Tabs, ΔL ≈ +0.11) and white with a shadow on light. The secondary button goes 9% → 14% on hover, the outline button 0 → 5% with its hairline kept, and a highlighted dropdown item sits on 9% over the warm popover.
> - **Not opened live:** the signed-in modules (no session in the preview browser).
> - **Review pass (validator + `/code-review high`, 2026-10-08):** one MAJOR fixed. On the booking surfaces, an unselected option hovered to a full-strength edge that outshone the chosen one, so it now hovers to a 30% edge. The new class was checked by compiling it against tokens.css; the public page was not opened live.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Selection: tint, never a bar (DS-AC4)
- [ ] **Do:** Tasks list, click a row → **Expect:** an accent tint with a 1px accent hairline and no left bar; hovering other rows shows a lighter neutral fill _(web + desktop)_
- [ ] **Do:** Tasks board, click a card → **Expect:** tint plus a soft accent ring instead of the bright white border _(web)_
- [ ] **Do:** select a note in the notes tree and in notes search, a contact, an email thread → **Expect:** the same tint + hairline everywhere, no bars _(web; email on desktop)_
- [ ] **Do:** switch Accent (mono, blue, amber) and Shade in Settings → **Expect:** selection stays clearly different from hover and from the current-page fill _(web)_

## Raised plates (DS-AC2)
- [ ] **Do:** Tasks header view switcher in icon-only mode, then the right-panel switcher → **Expect:** the current icon sits on a plate that is LIGHTER than the track, on every shade _(web)_
- [ ] **Do:** switch to light theme → **Expect:** a white plate with a soft shadow _(web)_
- [ ] **Do:** Email → Connect account (desktop) → **Expect:** the chosen provider tab is raised the same way _(desktop)_

## Buttons, menus, select, command (DS-AC5)
- [ ] **Do:** hover a secondary button (Home → Edit → "Done", dialog secondary actions) → **Expect:** it visibly lightens; before, nothing changed on dark _(web)_
- [ ] **Do:** hover outline and ghost buttons and icon buttons → **Expect:** a light fill; the outline keeps its edge _(web)_
- [ ] **Do:** open a ⋯ menu, a Select and ⌘K, then move with the mouse and the arrow keys → **Expect:** the highlighted option has a clear neutral fill _(web)_

## Hover ≠ current (DS-AC6)
- [ ] **Do:** hover the top-bar module tabs next to the current one → **Expect:** hover is lighter than the current tab's fill _(web + desktop)_
- [ ] **Do:** open the workspace switcher and hover the rows → **Expect:** the current workspace has a stronger fill than a hovered one; the switcher button stays filled while its menu is open _(web)_
- [ ] **Do:** Email rail (desktop): hover All inboxes / an account / Snoozed next to the current one → **Expect:** hover lighter than current _(desktop)_
- [ ] **Do:** Settings (⌘,): hover the section list → **Expect:** hover lighter than the current section; hovering the current one keeps it current _(web)_
- [ ] **Do:** Chat sidebar and Settings → Members & access rail → **Expect:** the open channel or section has a neutral fill, not the accent _(web)_

## Edge cases
- [ ] **Do:** drag a task onto another row to nest it, and drag a note over another note → **Expect:** the drop highlight still wins over selection while dragging _(web)_
- [ ] **Do:** public booking page with a hue accent stored → **Expect:** the chosen day, time and meeting option are tinted with a ring, in mono (pre-workspace pages are monochrome) _(web)_
- [ ] **Do:** on the public booking page, pick a day, then hover a different day, time chip and meeting option → **Expect:** the hovered one shows a quiet edge, clearly weaker than the chosen one's tint + ring _(web)_
- [ ] **Do:** Notes → toggle the right panel from the header icon, and Chat → Browse channels → the "show archived" toggle → **Expect:** while on, the button keeps a neutral fill and hovers one step lighter (pressed toggles now fill on their own) _(web)_
- [ ] **Do:** chat message that mentions you, the "New" divider, an @mention, a search hit → **Expect:** they keep their accent marks (status, not selection) _(web)_

## Migrations / data
- None.

## Known gaps / not-yet-testable
- Signed-in module surfaces were not opened live by the agent; the tokens, primitives and class changes are covered by tests and Storybook checks.
- **Decided (Maciej, 2026-10-08): keep tint + hairline.** `--state-selected-edge` stays ON, shipped as is.
- Visual baselines: run `bunx playwright test --project=visual tests/visual/state-ladder.spec.ts --update-snapshots` with Storybook up, review the 18 PNGs, and commit them. That's a human step by design.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
