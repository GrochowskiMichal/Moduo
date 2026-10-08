# Manual test checklist — DS-4 FilterBar, DisplayMenu, drag visuals, view-prefs helper

> Generated 2026-10-08 · branch `t/maciej/ds-4-filterbar-displaymenu` · **Live-verified:** yes, in Storybook. Nothing in the app uses these yet (Tasks adopts them in TV-U2/TV-U4), so all checks are in Storybook (`bun run storybook`, sidebar **Components/ui**).
> - **Checked by the agent in Storybook (dark, mono and blue accent, and light):**
>   - Chips read as sentences, and the value picker ticks and adds a value, so "UI, fix" becomes "UI, fix +1".
>   - "+ Filter" with "ola@" jumps to Assignee › Ola, and Enter adds it ("is" → "is any of", 2 → 3 of 5). "me" lists only Me, Mike and Medium.
>   - In DisplayMenu, the Group by select changes without closing the popover, Completed and the property toggles change, and Reset turns on once something differs.
>   - The drag visuals show the line, the tint, the dimmed source, the overlay with its count, and the nest preview.
> - **Review pass:** the validator ran twice (round 1 found one MAJOR: search matched internal item ids; fixed and tested). `/code-review` and claude-security were skipped on Maciej's instruction, relayed 2026-10-08.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## FilterBar (Components/ui/filter-bar → Default)
- [ ] **Do:** open the story → **Expect:** "Assignee · is · Me ×" and "Tag · is any of · UI, fix ×" chips, then "+ Filter" and "2 of 5 · Clear" on the right; the list shows 2 rows _(Storybook)_
- [ ] **Do:** click "is" on the Assignee chip, pick "is not" → **Expect:** the chip reads "is not" and the list flips to the rows not assigned to you _(Storybook)_
- [ ] **Do:** click "UI, fix", tick "docs" → **Expect:** the chip reads "UI, fix +1" and the popover stays open for more picks _(Storybook)_
- [ ] **Do:** untick values down to one → **Expect:** "is any of" turns back into "is" _(Storybook)_
- [ ] **Do:** click × on a chip → **Expect:** it disappears, the count updates, and keyboard focus lands on "+ Filter" _(Storybook)_
- [ ] **Do:** click "Clear" → **Expect:** the whole chip row disappears and the toolbar "Filter" loses its badge _(Storybook)_
- [ ] **Do:** toolbar "Filter" → pick Status → tick two → **Expect:** a new chip appears, and the badge on "Filter" counts the chips _(Storybook)_
- [ ] **Do:** "+ Filter", type "ola@", press Enter → **Expect:** Assignee gains Ola, found through her email keyword _(Storybook)_
- [ ] **Do:** "+ Filter", type "up" → **Expect:** "No matches." (nothing matches on hidden ids) _(Storybook)_
- [ ] **Do:** "+ Filter" → Tag, then Backspace in the empty search → **Expect:** back to the dimension list _(Storybook)_

## FilterBar (Operators + MenuOpen stories)
- [ ] **Do:** open **Operators** → **Expect:** "Blocked · is · Yes" shows "is" as plain text (yes/no has one operator); "Status · is not · Done, Archived" reads naturally _(Storybook)_
- [ ] **Do:** open **MenuOpen** → **Expect:** the add-filter menu is open on the dimension list with icons and chevrons _(Storybook)_

## DisplayMenu (Components/ui/display-menu)
- [ ] **Do:** open **Default** → **Expect:** a popover with Layout (icon-only switch), Group by, Order by, Completed, Subtasks, a divider, "Show on rows" toggles, and a greyed "Reset to default"; no tooltip pops up on open _(Storybook)_
- [ ] **Do:** change Group by → **Expect:** the select closes, the popover stays open, and the value shows the new choice _(Storybook)_
- [ ] **Do:** switch Completed to "7 days", toggle Energy on → **Expect:** the current segment is a raised plate, Energy fills, and "Reset to default" turns on _(Storybook)_
- [ ] **Do:** click "Reset to default" → **Expect:** everything returns to the defaults and Reset greys out again _(Storybook)_
- [ ] **Do:** open **WithFooter** → **Expect:** "Save as view…" on the left of the footer, Reset on the right _(Storybook)_
- [ ] **Do:** Tab through the open popover → **Expect:** focus goes Layout → Group by → Order by → Completed → Subtasks → each toggle → Reset, with visible focus rings _(Storybook)_

## Drag visuals (Components/ui/drag-visuals → AllPieces)
- [ ] **Do:** open the story on the mono accent, then blue and amber → **Expect:** the insertion line is a 2px accent line with a hollow dot at the indent; the nest target is filled with an accent ring and the dashed accent ghost below it says "Make subtask"; the drag source is dimmed; the rail drop target has the same fill and ring as the nest target; the overlay looks like a popover card, and the second one has a "3" badge _(Storybook)_
- [ ] **Do:** switch Density to dense and comfortable → **Expect:** the rows, the nest preview and the overlay follow the row height _(Storybook)_
- [ ] **Do:** open **InsertionLineEdges** → **Expect:** a line at the bottom edge of the last row _(Storybook)_

## Appearance
- [ ] **Do:** run the three stories on two other shades and on light → **Expect:** chips, popover fills and toggles stay readable, and hover is lighter than the active fills _(Storybook)_

## Edge cases
- [ ] **Do:** (covered by tests) a stored filter on a removed dimension → **Expect:** no chip, but the row and Clear still show, so it can't hide rows unseen _(tests: filter-bar.test.tsx)_
- [ ] **Do:** (covered by tests) corrupt or wrong-shaped saved view settings → **Expect:** the defaults, field by field; storage that throws never breaks the view _(tests: view-prefs.test.ts)_

## Migrations / data
- None. View prefs are local to the device (`moduo:<module>:view:…` in localStorage), and nothing writes them until Tasks adopts the helper.

## Known gaps / not-yet-testable
- Nothing in the app uses these primitives yet. Real drags (dnd-kit), filtering real tasks and remembering per scope arrive with TV-U2 (Filter/Display) and TV-U4 (drag).
- No visual-snapshot baselines were added. `tests/visual/primitives.spec.ts` lists stories by hand and a human captures the baselines; add the three new stories there when you next capture.
- The calendar, email, notes and mindmap copies of "remember this view setting" are untouched. Adoption is later work (see the decision entry).

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
