# Manual test checklist — DF-14 selection + accent unification

> Generated 2026-07-10 · branch `t/maciej/df-14-selection-unify` · **Live-verified:** partial — Contacts, Notes, and all five Settings pickers verified on the hosted account (web); Email thread rows and the two Calendar hover-dims could not be rendered on web (see Known gaps).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

The recipe (same as Tasks): **selected row = accent-tinted fill (`--selected-bg`) + a thin accent bar at the row's left edge**; **hover = a dimmer neutral fill (60%)**, clearly weaker than selection.

## Contacts
- [ ] **Do:** open Contacts, click a person row → **Expect:** the row gets the accent-tinted fill + a small vertical accent bar at its left edge (same look as a selected task row in Tasks) _(both)_
- [ ] **Do:** with one row selected, hover a different row → **Expect:** the hovered row's fill is clearly dimmer than the selected row — you can always tell them apart _(both)_
- [ ] **Do:** switch to the Companies tab and select a company → **Expect:** same recipe (companies share the row component) _(both)_
- [ ] **Do:** arrow-key through rows (keyboard highlight) → **Expect:** the keyboard highlight is a mid-strength fill without the accent bar — distinct from both hover and selection _(both)_

## Notes
- [ ] **Do:** select a note in the sidebar, then hover a sibling note → **Expect:** selected = tint + accent bar; hovered = dimmer fill. Previously they were identical _(both)_
- [ ] **Do:** select a **nested** note (child of an expanded parent) → **Expect:** the accent bar sits at the sidebar's left edge (a consistent rail), the tint spans the full row _(both)_
- [ ] **Do:** drag a note over the **selected** note → **Expect:** the selection tint + bar disappear while the drop indicators (top/bottom line or ring) are showing, so there's never two primary marks on one row; they return when the drag leaves _(both)_
- [ ] **Do:** type in the sidebar search and click a result → **Expect:** the selected search-result row uses the same tint + accent bar (live-verified); hover on other results is dimmed _(both)_
- [ ] **Do:** hover a row under PUBLISHED → **Expect:** the same dimmed hover as tree rows above it _(both)_

## Email (desktop only)
- [ ] **Do:** open Email with a synced account, select a thread, hover another → **Expect:** selected = tint + accent bar at the row's left; hover = dimmer fill. Previously identical _(desktop)_
- [ ] **Do:** hover a selected thread → **Expect:** the quick-triage buttons still overlay readably (they sit on a small card chip) _(desktop)_

## Calendar
- [ ] **Do:** with an external calendar account connected, hover its row under CALENDARS in the left rail → **Expect:** a subtle (dimmed) hover fill _(both)_
- [ ] **Do:** with unscheduled tasks in the right Tasks panel, hover a task row → **Expect:** same dimmed hover _(both)_

## Settings → Appearance (the five de-tinted pickers)
- [ ] **Do:** open Settings → Appearance and look at Theme / Font / Density / Corner radius / Module navigation → **Expect:** the selected option card has a **neutral** (grey) border + fill — no accent-colored border. The only accent in each card is the small radio dot _(both)_
- [ ] **Do:** check the Accent row → **Expect:** unchanged — the selected accent swatch still shows a check (it's the legitimate exception) _(both)_
- [ ] **Do:** hover an unselected option card → **Expect:** a dim hover fill, weaker than the selected card's fill _(both)_
- [ ] **Do:** switch accent color (e.g. pink → blue) → **Expect:** selected rows in Tasks/Contacts/Notes re-tint to the new accent; the picker cards stay neutral _(both)_

## Edge cases
- [ ] **Do:** in light mode, select a contact and a note → **Expect:** tint + bar still visible (the tint mixes the accent into the card color, so it adapts) _(both)_
- [ ] **Do:** set accent = Mono → **Expect:** selection tint/bar render neutral-white — still distinguishable from hover (bar + stronger fill) _(both)_

## Migrations / data
- None — pure UI class changes, no schema or data changes.

## Known gaps / not-yet-testable
- **Email thread rows**: web shows the desktop-first placeholder and Storybook doesn't render in this worktree (known gotcha), so the email rows were verified by code review + lint/tests only — the recipe is byte-identical to the verified Contacts/Notes rows. Please run the Email checks on desktop.
- **Calendar hover-dims**: the hosted test account has no external calendar account and no unscheduled panel tasks, so neither row type rendered; one-class changes (`hover:bg-accent` → `hover:bg-accent/60`), covered by lint + typecheck.
- The hosted test account's accent was switched **mono → pink** during verification (left at pink) and a throwaway second note was created and deleted again.
