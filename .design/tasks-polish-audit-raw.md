# Session 11 — Tasks UI audit (raw consolidated findings)


## Plan-mode top controls bar (PlanViewHeader: group/columns control, tag-filter trigger, List/Board ViewSwitcher, New task button)

Maciej is right: the four controls read as four different design systems sharing a row. They split across three effective heights (Button sm = 26px via --ctrl-h-sm, SelectTrigger sm = 26px but visually taller from its bg-input well + chevron, ViewSwitcher ≈ 30px from p-0.5 + size-7), three surface treatments (Select bg-input well, ViewSwitcher bg-muted track, buttons border/transparent), and two font roles (Button/Select forced to font-display, Tabs primitive uses font-sans). The ViewSwitcher is a hand-rolled segmented control with hardcoded geometry (size-7, p-0.5) that ignores the density tokens every other control honours and doesn't even match the rail toggle it claims to mirror (p-0.5 vs p-1). The fix is a single tokenized control row at one shared height (--ctrl-h-sm), one radius (rounded-md), one type size, where group/columns and filter become shadcn primitives and the view switch becomes the existing shadcn Tabs primitive — eliminating the bespoke component entirely.

### Components used
- **Button (shadcn)** (shadcn-primitive, token-compliant: true) — Used for New task (size=sm default variant) and the filter trigger. Height routes through --ctrl-h-sm. The primitive itself is compliant; the misuse is at call sites (redundant font-display, height mismatch vs neighbours).
- **SelectTrigger (shadcn)** (shadcn-primitive, token-compliant: true) — Group (List) / Columns (Board) dropdown. size=sm routes height through --ctrl-h-sm, but renders a bg-input *well* with a chevron — a heavier visual than the borderless Button/ViewSwitcher beside it, so it reads as a form field dropped into a toolbar.
- **ViewSwitcher (bespoke segmented control)** (bespoke, token-compliant: false) — plan-view-header.tsx:65-103. Hand-rolled tablist with hardcoded size-7 (28px) buttons + p-0.5 track. Bypasses the density --ctrl-h-sm token, so it stays 28-30px while neighbours shrink/grow with density. A shadcn Tabs primitive already exists and is unused here.
- **TagFilterButton → Popover + Command (shadcn)** (shadcn-primitive, token-compliant: true) — task-tag-filter.tsx. Correctly uses Popover+Command (good call — multi-select with search). Trigger is a Button sm but carries a redundant className="font-display" (already in the Button base).
- **Tabs (shadcn, available but unused on this surface)** (shadcn-primitive, token-compliant: true) — src/components/ui/tabs.tsx exists with a default segmented variant (rounded-md bg-muted p-1) — the intended home for the List/Board switch, currently re-implemented by hand.

### Problems
- [high] **Three different control heights coexist in one row. Button size=sm and SelectTrigger size=sm both resolve to --ctrl-h-sm (26px comfortable), but the ViewSwitcher hardcodes size-7 (28px) buttons inside a p-0.5 track, making its outer box ~30px. The row never aligns on a single baseline at any density.**
  - quote: all of these feel like stitched together from different design systems
  - at: src/features/tasks/ui/plan-view-header.tsx:73-101 (ViewSwitcher size-7 + p-0.5); src/components/ui/button.tsx:57-61 (--ctrl-h-sm); src/components/ui/select.tsx:34 (--ctrl-h-sm)
  - cause: The ViewSwitcher predates / ignores the density control-height tokens (--ctrl-h-sm). It uses raw Tailwind sizing (size-7, p-0.5) instead of the shared height variable, so it can't track density changes and doesn't co-align with the token-driven Button/Select.
- [high] **Three different surface treatments side by side. The Select renders a filled input well (bg-input + border + chevron), the ViewSwitcher renders a bg-muted segmented track, and the New task / Filter buttons render as solid-primary / bordered-outline. Four controls, four fills — nothing signals they belong to one toolbar.**
  - quote: the button, filter, dropdown and view switch at the top should be better thought through
  - at: src/components/ui/select.tsx:40 (bg-input well); src/features/tasks/ui/plan-view-header.tsx:76 (bg-muted track); src/features/tasks/ui/task-tag-filter.tsx:46-47 (outline/secondary)
  - cause: Each control was styled in isolation against its own primitive default rather than against a shared toolbar spec. A Select trigger is a form-field primitive; dropping it unmodified into a toolbar imports form-field chrome (the well) that the other controls don't have.
- [med] **Mixed type roles across the row. Button base forces font-display at text-xs (12px); SelectTrigger is font-sans text-sm (13px) but the call sites override it to font-display; the shadcn Tabs primitive (the natural view-switch) is font-sans text-sm. So the labels are simultaneously 12px and 13px, and the font role is patched per-control with className.**
  - quote: if the design system was set up properly
  - at: src/components/ui/button.tsx:8-10 (font-display text-xs); src/features/tasks/ui/task-list-view.tsx:288 (Select className="w-28 font-display"); src/features/tasks/ui/task-board-view.tsx:151 (same)
  - cause: No single toolbar type token. font-display is being bolted onto Select via className at every call site to match the Button — a sign the harmonization is happening ad hoc in feature code instead of in the primitives.
- [med] **The 'Group' label (List) vs 'Columns' label (Board) are inline <span> text glued to the left of the Select, not part of any primitive. They use font-display text-xs text-muted-foreground hardcoded in two places, and the label text differs between views for what is conceptually the same grouping control.**
  - quote: group dropdown
  - at: src/features/tasks/ui/task-list-view.tsx:285-286 ('Group'); src/features/tasks/ui/task-board-view.tsx:148-149 ('Columns')
  - cause: The grouping affordance is assembled in two feature files (label span + Select) rather than encapsulated in one reusable control. Duplicated styling drifts (here: label wording) and there's no single source for the toolbar's secondary-label treatment.
- [med] **ViewSwitcher claims to 'mirror the rail's Plan/Execute mode toggle' but doesn't. The rail toggle uses bg-muted p-1 with flex-1 rounded-sm py-1 text buttons; the ViewSwitcher uses bg-muted p-0.5 with size-7 rounded-sm icon-square buttons. Two segmented controls, two different paddings and button models, both bespoke, neither using shadcn Tabs.**
  - quote: stitched together from different design systems
  - at: src/features/tasks/ui/plan-view-header.tsx:76 (p-0.5); src/features/tasks/ui/bucket-rail.tsx:262 (p-1)
  - cause: Both segmented controls are hand-rolled independently. There is no shared segmented-control primitive, so even the two toggles meant to look alike have diverged.
- [low] **Redundant font-display className on the filter trigger Button. Button already sets font-display in its base; the extra className is dead weight and signals call-site fiddling to force consistency the primitives should guarantee.**
  - quote: (found independently)
  - at: src/features/tasks/ui/task-tag-filter.tsx:48
  - cause: Defensive per-call-site styling rather than trusting the primitive — symptomatic of the same lack of a toolbar spec.
- [low] **ViewSwitcher uses size-7 icon-only buttons while every other control is text-bearing and px-3. At dense text-size the icon-only switch gives no label, breaking the row's scannability and making it the odd control out visually.**
  - quote: view switch at the top should be better thought through
  - at: src/features/tasks/ui/plan-view-header.tsx:81-96
  - cause: Icon-only segmented control was chosen for compactness but isn't reconciled with the labelled, text-sized rest of the row; it reads as a different component family (toolbar icon-toggles vs labelled controls).

### Recommendations
- (M) **Define one toolbar control spec and apply it to all four: shared height --ctrl-h-sm, rounded-md, one type size (text-sm), borderless/quiet fill by default (transparent → hover:bg-accent), reserving the solid bg-primary fill exclusively for the 'New task' primary action. Concretely: switch the New task button and Filter trigger to keep Button size=sm; make the group/columns Select trigger borderless (override its bg-input well to bg-transparent with hover:bg-accent so it stops reading as a form field); and replace the ViewSwitcher with shadcn Tabs at the same height. This collapses three heights/fills into one.**
  - why: Linear's toolbars are a single quiet row at one height where only the primary action carries fill. Unifying height + fill + radius is the single biggest lever on the 'stitched together' read.
  - DS ref: --ctrl-h-sm, rounded-md, bg-primary (primary action only), hover:bg-accent (quiet controls); Button + Select + Tabs shadcn primitives; Linear toolbar reference
  - files: src/features/tasks/ui/plan-view-header.tsx:40-57; src/features/tasks/ui/task-list-view.tsx:284-300; src/features/tasks/ui/task-board-view.tsx:146-160; src/components/ui/select.tsx:40
- (M) **Delete the bespoke ViewSwitcher (plan-view-header.tsx:65-103) and rebuild the List/Board switch with the existing shadcn Tabs primitive (default segmented variant). Drive `value={view}` / `onValueChange={onViewChange}`. Keep icons but add the text labels back (List / Board) — Tabs triggers are px-3 py-1.5 text-sm, which auto-aligns with the rest of the row. If an icon-only compact switch is genuinely wanted, add a shared `iconOnly` size to a real ToggleGroup primitive rather than hand-rolling, but the labelled Tabs is the recommended default.**
  - why: A shadcn Tabs primitive already exists and is the sanctioned home for this exact control (CLAUDE.md rule 4: use shadcn for Tabs). Hand-rolling a tablist with hardcoded size-7/p-0.5 is precisely the design-system violation Maciej is pointing at. Tabs inherits density/type tokens for free.
  - DS ref: src/components/ui/tabs.tsx (default variant: rounded-md bg-muted p-1); CLAUDE.md hard rule 4 (primitives wrap shadcn)
  - files: src/features/tasks/ui/plan-view-header.tsx:47; src/features/tasks/ui/plan-view-header.tsx:59-103
- (M) **Extract the group/columns affordance into one reusable component (e.g. ToolbarGroupSelect) that owns the secondary label + Select and is shared by List and Board. Unify the label to one word ('Group' for both, or drop the label and let the Select's own value read 'Group by status' etc.). Style the label once via a shared token treatment (text-2xs uppercase tracking-wide text-muted-foreground, matching the group-header eyebrow pattern already in task-list-view.tsx:323).**
  - why: Removes the List/Board label drift ('Group' vs 'Columns' for the same concept), kills duplicated inline span styling, and gives the toolbar a single source for its secondary-label look.
  - DS ref: text-2xs / tracking-wide / text-muted-foreground eyebrow pattern; Select shadcn primitive; Todoist/Linear 'Group by' label convention
  - files: src/features/tasks/ui/task-list-view.tsx:284-300; src/features/tasks/ui/task-board-view.tsx:146-160; src/features/tasks/ui/plan-view-header.tsx:44-52
- (M) **Reconsider the Select for grouping vs a shadcn DropdownMenu with radio items. The group control has 2-5 fixed options with no search — a DropdownMenuRadioGroup trigger (rendered as a quiet Button sm with a ChevronDown) would match the Filter trigger's button-shaped affordance exactly, giving the toolbar two identical button-shaped 'menu' triggers (Group ▾, Filter ▾) plus the segmented view switch plus the primary New task. That is a tighter, more Linear-like row than a form-Select sitting next to buttons.**
  - why: Select imports form-field chrome (the bg-input well) that fights the toolbar. A DropdownMenu trigger is just a Button, so it inherits the unified control spec automatically and visually pairs with Filter. This is the cleanest way to make group + filter read as siblings.
  - DS ref: src/components/ui/dropdown-menu.tsx (DropdownMenuRadioGroup/RadioItem); Button sm trigger; Linear 'Group by ▾' pattern
  - files: src/features/tasks/ui/task-list-view.tsx:287-298; src/features/tasks/ui/task-board-view.tsx:150-158; src/components/ui/dropdown-menu.tsx
- (S) **Remove the redundant className="font-display" from the TagFilterButton trigger and from the two Select triggers; instead set the toolbar type role once at the primitive level (or accept the primitive default). If font-display is the intended toolbar font, bake it into the shared toolbar control spec rather than re-stating it at every call site.**
  - why: Per-call-site font patching is the tell that harmonization is happening in feature code. Centralizing it removes drift risk and shrinks the diff when the toolbar font decision changes.
  - DS ref: Button base already sets font-display (button.tsx:8-10); DESIGN_SYSTEM.md §buttons-are-always-primary
  - files: src/features/tasks/ui/task-tag-filter.tsx:48; src/features/tasks/ui/task-list-view.tsx:288; src/features/tasks/ui/task-board-view.tsx:151
- (S) **Add a visual grouping container for the secondary controls (group + filter + view) distinct from the primary New task button — e.g. a subtle gap rule or a small fixed gap-1 cluster on the left of the right-group and the primary action pushed slightly apart (gap-2 → a wider separator). This signals 'these three shape the view, this one creates' the way Linear separates view-controls from the New button.**
  - why: Even at one height, all four controls in an undifferentiated gap-2 row read flat. A light separation between view-shaping controls and the create action gives the row intent and hierarchy.
  - DS ref: Separator shadcn primitive (or gap scale spacing); Linear toolbar grouping
  - files: src/features/tasks/ui/plan-view-header.tsx:44-52

### Open questions for Maciej
- View switch: shadcn Tabs (labelled 'List'/'Board', px-3 text — fully token-aligned and recommended) vs a compact icon-only segmented toggle (needs a new shared ToggleGroup primitive to be DS-compliant). Which fidelity does Maciej want — labelled-and-consistent, or compact-icon-and-bespoke-but-tokenized?
- Group/Columns control: keep shadcn Select (form-field look, but native typeahead) or switch to a shadcn DropdownMenu radio trigger (button-shaped, pairs with Filter, more Linear-like)? This decides whether the toolbar reads as 'two menu buttons + a switch' or 'a dropdown field + buttons'.
- Should the grouping label read 'Group' in both views (unifying the current 'Group' vs 'Columns' split), or is 'Columns' meaningfully different enough on the Board to keep? Recommend unifying to 'Group'.
- Should 'New task' keep the solid bg-primary fill in this row, or step down to a quieter secondary/outline so the whole toolbar is uniformly quiet (Linear keeps New issue subtle; Todoist keeps Add task accented)? This is the one deliberate hierarchy call for the row.
- Is icon-only acceptable for the view switch given the dense text-size setting, or must every toolbar control carry a text label for scannability at the Linear-dense end?


## Task row (list view) — src/features/tasks/ui/task-row.tsx + task-list-view.tsx

The row is built as a single flex line with no fixed column geometry, so every hover-revealed control inserts into the flow and shoves the title/meta sideways — this is the "content moving on hover" Maciej flags, and it is the single biggest gap vs. Linear. Subtasks are distinguished only by a 24px left margin (ml-6) with no indent guide, caret, or muted treatment, so nesting reads as accidental rather than structural. The "icons that do nothing" are partly real (the Schedule/Due chips DO open popovers, but they look like static icons and only appear on hover with no affordance) and partly a perception problem: priority/energy dots and the recurring/committed/blocked markers are display-only and indistinguishable from actionable controls. The fix is a stable CSS grid row with reserved lanes, in-place opacity reveal instead of display:hidden, and a proper subtask indent system.

### Components used
- **TaskRow row container** (raw-html, token-compliant: true) — div role=row, flex items-center gap-2 rounded-md px-2 py-0.5 (task-row.tsx:127-140). Uses tokens correctly (bg-accent, hover:bg-accent/60). minHeight via inline style var(--row-h) is allowed geometry. The flex (not grid) layout is the root cause of hover reflow.
- **CompleteToggle** (bespoke, token-compliant: true) — Bespoke circular checkbox (task-row.tsx:384-415). Correctly bespoke — checkbox is not an enumerated shadcn primitive. Token-clean (border-primary/bg-primary/border-muted-foreground/50). size-4, fixed width — good anchor for a grid column.
- **Title button** (raw-html, token-compliant: true) — button with font-display, truncate, flex-1 (task-row.tsx:188-205). font-display is correct per typography roles (titles = display). Has both onClick(onSelect) and the parent row onClick — redundant selection handler.
- **TagChipList / TagChip** (bespoke, token-compliant: true) — Imported from components/tag-chip.tsx, rendered inline in the title cluster (task-row.tsx:218). Color routed via data-label tokens; rounded, text-2xs, .tag-chip surface. Audited separately — but note it sits INSIDE the flex-1 title cluster (min-w-0 shrink), so chips compete with the title for width and shift when meta reveals.
- **LevelDots (priority/energy)** (bespoke, token-compliant: true) — task-row.tsx:453-481. Display-only dots (bg-foreground/70 solid = priority, border ring = energy) with Tooltips. No handler — purely informational. Reads as a clickable control though, contributing to 'icons that do nothing' perception.
- **MetaChip + SchedulePopover/DuePopover** (raw-html, token-compliant: true) — task-row.tsx:485-630. These DO have handlers (open a Popover to edit). But the trigger uses 'hidden group-hover:flex' (lines 537,596) so empty chips are display:none and inserted on hover — the direct cause of the horizontal shift. Visually they look like inert icons.
- **BucketPopover** (third-party, token-compliant: true) — task-row.tsx:632-691. Wraps shadcn Badge (variant secondary) in a Popover. Always visible when showBucket. Functional. Badge is a sanctioned shadcn primitive.
- **BlockedMarker / committed / recurring markers** (raw-html, token-compliant: true) — task-row.tsx:224-245,362-380. Display-only icon spans (CircleDashed/Sunrise/Repeat) with Tooltips. Informational, no handler — correct, but adds to the cluster of static-looking icons.
- **Expand caret (subtask chevron)** (raw-html, token-compliant: true) — task-row.tsx:145-171. ChevronRight/Down in a reserved size-4 slot, gated by expandSlot. This is the ONE place geometry is reserved correctly (empty span placeholder keeps checkboxes aligned). The pattern to extend to the whole row.
- **ContextMenu** (shadcn-primitive, token-compliant: true) — task-row.tsx:287-356. Full right-click menu with all actions (rename, schedule, due, bucket, priority, energy, delete, detach). Correct shadcn usage. Note: this is where most real actions live — the hover chips are secondary.

### Problems
- [high] **Content shifts horizontally on hover. The Schedule and Due triggers use `label ? "flex" : open ? "flex" : "hidden group-hover:flex"` — when a task has no scheduled/due value, the chip is display:none and is INSERTED into the flex row on hover. Because the whole row is one flex line (no reserved columns), inserting these chips on hover pushes the title cluster, tag chips, and other meta leftward/around. This is the 'task content moving on hover' Maciej calls out as 'very unintuitive'.**
  - quote: Task content moving on hover is very unintuitive, it shouldn't be there.
  - at: src/features/tasks/ui/task-row.tsx:537, 596 (the hidden group-hover:flex classes); root layout at :133 (flex, not grid)
  - cause: display:hidden→flex on hover changes the element from out-of-flow to in-flow, and the parent is a content-sized flex container with no reserved lane for the reveal. Layout reflows every hover.
- [high] **Hover reveals controls that read as 'icons that do nothing'. The Schedule (Clock) and Due (CalendarDays) chips that appear on hover actually DO open edit popovers, but with no label they render as a bare 12px icon with no border/affordance, look identical to the purely-informational icons (priority dot, energy dot, recurring, committed, blocked), and give no signal they are actionable. So a hover that surfaces icons which appear inert — matching the complaint exactly.**
  - quote: Hovering over them reveals icons that do nothing.
  - at: src/features/tasks/ui/task-row.tsx:485-509 (MetaChip), 539, 598 (empty-label icon-only render); LevelDots 453-481
  - cause: No visual distinction between actionable meta (schedule/due triggers) and informational meta (priority/energy/recurrence/blocked). Empty-state triggers collapse to a lone icon with no button chrome, so they appear decorative.
- [high] **Subtasks are distinguished from parents ONLY by a 24px left margin (`nested && "ml-6"`). There is no indent guide/rail, no connector, no caret on the child, and no muted/quieter type. A nested child looks like a slightly-misaligned top-level row, not a structurally-subordinate item. Linear/Todoist make hierarchy obvious with an indent guide or tree connector.**
  - quote: subtasks should be indented or marked otherwise.
  - at: src/features/tasks/ui/task-row.tsx:137 (nested && "ml-6"); list renders children at task-list-view.tsx:374-378 with prop `nested`
  - cause: The only nesting signal is a flat margin. ml-6 also fights the expandSlot gutter alignment — the child's checkbox sits at a different x than the parent's, but with no guide it reads as misalignment rather than indentation.
- [med] **Tag chips live INSIDE the flex-1 title cluster (min-w-0 shrink) rather than in a trailing meta lane. They compete with the title for horizontal space and, combined with the hover-revealed schedule/due chips, get re-squeezed on every hover. In Linear, labels sit in a stable trailing zone and never reflow the title.**
  - quote: overall this row doesn't look as good as the one in Linear.
  - at: src/features/tasks/ui/task-row.tsx:187-219 (title cluster contains title + progress + parentTitle + TagChipList)
  - cause: Title, n/m progress, parent-title caption, and tag chips are all packed into one shrinking flex cell with no fixed boundary between content and metadata.
- [med] **No fixed grid geometry. The row is `flex items-center gap-2` with everything content-sized. There are no column tracks, so the checkbox→title→meta alignment is not guaranteed across rows, and any conditional element (bucket badge, committed icon, progress count) changes where neighbors land. Rows don't line up vertically the way Linear's columnar rows do.**
  - quote: overall this row doesn't look as good as the one in Linear.
  - at: src/features/tasks/ui/task-row.tsx:127-140 (flex container), meta cluster 222-280
  - cause: flexbox content-sizing instead of a grid with reserved lanes (gutter / checkbox / title / meta-zone). Every optional control perturbs layout.
- [low] **Redundant selection handler on the title button. The row `div` has onClick={onSelect} (task-row.tsx:131) and the inner title `<button>` also calls onSelect on click (:195-198) with stopPropagation. Two code paths for the same action; the inner button's only differentiator is onDoubleClick to edit, which could be handled on the row.**
  - quote: (found independently)
  - at: src/features/tasks/ui/task-row.tsx:131 vs 188-205
  - cause: Title was made a focusable button for double-click-to-edit, but it duplicates the row's click-to-select; the nested interactive element inside a role=row clickable div is also an a11y smell.
- [low] **Hover fill uses bg-accent/60 for hover but bg-accent (full) for selected. The 60% hover is a subtle quiet fill (good, Linear-like), but selected and hover are very close in value, and the selected state already has a left accent bar (:142-144). The combination can read muddy. Minor, but worth tightening so the reveal-in-place change doesn't make hover ambiguous.**
  - quote: overall this row doesn't look as good as the one in Linear.
  - at: src/features/tasks/ui/task-row.tsx:135, 142-144
  - cause: Two near-identical accent fills for hover vs selected; the structural left-bar is the real selection signal but the fill delta is small.

### Recommendations
- (M) **Convert the row from a single flex line to a CSS grid with fixed lanes: `grid` with template columns roughly `[gutter 16px] [checkbox 16px] [title 1fr] [meta auto]`. Use the existing reserved-slot pattern (the expandSlot span at :169 already does this for the caret) and extend it to the whole row. Put gap via gap-2. This gives stable vertical alignment across rows like Linear and removes all hover reflow by construction.**
  - why: A grid with reserved tracks means revealing a control inside a track never moves siblings. This is the structural fix for both the hover-shift and the 'doesn't line up like Linear' complaints.
  - DS ref: No new tokens; use Tailwind grid utilities + existing --row-h for height. The empty-placeholder span pattern at task-row.tsx:169 is the precedent.
  - files: src/features/tasks/ui/task-row.tsx:127-281
- (S) **Replace `hidden group-hover:flex` on the Schedule/Due triggers with a reveal-in-place pattern: keep the element in the flow always (so it reserves its slot) and toggle visibility with opacity, e.g. `opacity-0 group-hover:opacity-100 focus-within:opacity-100` plus `pointer-events-none group-hover:pointer-events-auto` — never display:none for an empty optional chip. Combined with the grid meta-lane, the icon fades in IN PLACE with zero layout movement.**
  - why: Directly fixes 'task content moving on hover'. opacity/visibility transitions don't reflow; display does. This is exactly the Linear hover-reveal behavior.
  - DS ref: Use motion tokens for the fade (duration-[var(--motion-fast)]) per the no-hardcoded-duration rule; opacity utilities are token-free and allowed.
  - files: src/features/tasks/ui/task-row.tsx:537; src/features/tasks/ui/task-row.tsx:596
- (M) **Differentiate actionable vs informational meta so hover doesn't surface 'icons that do nothing'. Give the schedule/due TRIGGERS real button affordance even when empty — a faint hover:bg-muted pill (MetaChip already has hover:bg-muted, but the empty state collapses to a lone icon) and on empty state show a tiny '+date'/'+time' affordance label on hover instead of a bare icon. Keep purely-informational markers (priority/energy dots, recurring, committed, blocked) visually quieter and non-button (they already are), and consider only showing the empty actionable triggers on hover while keeping informational markers always-on. The signal: if it appears on hover, it must be clickable and look clickable.**
  - why: Resolves 'hovering reveals icons that do nothing' — the schedule/due icons are actionable but don't look it, and they sit next to inert dots. Making the actionable ones look like controls (and labeling them on hover) removes the dead-affordance feeling.
  - DS ref: MetaChip hover:bg-muted (task-row.tsx:499) is the right token; extend it. Use text-muted-foreground for the placeholder label. No new tokens.
  - files: src/features/tasks/ui/task-row.tsx:485-509; src/features/tasks/ui/task-row.tsx:529-543; src/features/tasks/ui/task-row.tsx:589-601
- (M) **Build a real subtask indent system instead of bare ml-6. Add a vertical indent guide (a 1px border-border rail at the indent boundary) per nesting level, align the child's checkbox to a consistent indented x, and quiet the child title one notch (text-muted-foreground or smaller leading is optional). At minimum: render an indent spacer column in the grid for nested rows plus a `border-l border-border` guide so the hierarchy reads as a tree. Optionally add a small CornerDownRight or connector at the child's left (the icon is already imported and used for parentTitle at :214).**
  - why: Directly answers 'subtasks should be indented or marked otherwise'. ml-6 alone reads as misalignment; an indent guide + aligned checkbox reads as structure, matching Linear/Todoist sub-issues.
  - DS ref: border-border for the guide (hairline token), --row-h-sm (tokens.css:413) already exists for nested-row height if you want children shorter. CornerDownRight icon already imported at task-row.tsx:9.
  - files: src/features/tasks/ui/task-row.tsx:137; src/features/tasks/ui/task-list-view.tsx:374-378
- (S) **Move tag chips out of the flex-1 title cell into the trailing meta lane (or a dedicated label lane between title and meta) so they never reflow the title. In the grid, give labels their own auto track that truncates with a +N overflow (TagChipList already supports max + overflow count). Keep the title cell purely title + progress + parent caption.**
  - why: Stops tag chips from competing with the title for width and being re-squeezed on hover; matches Linear where labels sit in a stable trailing zone. Tag-chip styling itself is audited separately — this is purely about WHERE the chip cluster sits in the row.
  - DS ref: TagChipList max/overflow already exists (components/tag-chip.tsx:77-106). No token change.
  - files: src/features/tasks/ui/task-row.tsx:212-219
- (S) **Collapse the redundant title-button selection handler. Let the row div own click-to-select and double-click-to-edit; make the title a span (not a button) unless keyboard focus on the title specifically is needed. Removes the nested-interactive-in-role=row a11y smell and one duplicate onSelect path.**
  - why: Simpler, avoids a button inside a clickable role=row, and removes the double onSelect. Low risk since the row already handles selection.
  - DS ref: n/a (structural cleanup). Keep font-display on the title per typography roles.
  - files: src/features/tasks/ui/task-row.tsx:131; src/features/tasks/ui/task-row.tsx:188-205
- (S) **After the grid lands, retune hover vs selected: keep the left accent bar as the primary selection signal and make the hover fill clearly lighter than selected (e.g. hover:bg-accent/50 vs selected bg-accent), so the now-stable hover-reveal reads cleanly against a distinct hover state.**
  - why: With reveal-in-place, hover becomes a more frequent state; it needs to be visually distinct from selected without being heavy. Keeps the quiet Linear feel.
  - DS ref: bg-accent + opacity composition is sanctioned (DESIGN_SYSTEM rule 2: compose with opacity). Left bar uses bg-primary (task-row.tsx:143).
  - files: src/features/tasks/ui/task-row.tsx:135

### Open questions for Maciej
- Subtask reveal model: should nested children always indent under an expanded parent with a vertical indent guide (tree style, like Linear sub-issues), or a lighter Todoist-style single-level indent with no guide? This decides whether to build a per-level guide system or just one indent step.
- On hover, should ALL meta (priority/energy/recurrence) stay always-visible while only the empty actionable schedule/due triggers reveal on hover — or should the whole meta cluster be quiet-until-hover except for set values? This affects how 'busy' the resting row looks vs. Linear's near-empty resting rows.
- Where should tag chips live in the new grid — a dedicated label lane between title and meta (Linear), or folded into the trailing meta zone? (Tag-chip visual styling is audited separately, but the lane placement is a row-layout decision needed here.)
- Should the title remain font-display (Pilat/Inter) per the typography-roles doc, or move to body font for denser Linear-like list text? The contract says titles = display, but Maciej's Linear reference uses a tighter body-weight title — worth confirming this isn't a place to deviate.


## Tag chips / pills (TagChip, TagChipList, TagPicker, ActiveTagFilters)

The chip encodes one piece of metadata (which tag) with three redundant color/shape signals stacked together: a colored dot (.tag-dot), a tinted surface fill (.tag-chip background = --label-surface), and an optional hued border (.tag-chip-outline). Maciej's instinct is right — the dot is the weakest of the three and the surface fill is what makes the pill bulky. The fix is mechanical and fully token-routed: drop the dot, recolor the "#" glyph by adding a .tag-hash class that consumes var(--label) (exactly how .tag-dot already does, just on `color` instead of `background-color`), and strip the surface fill so the chip becomes a borderless inline label. This shrinks every chip, removes a visual element, and keeps Tasks closer to the Linear/Todoist content-first target. The change touches one component (tag-chip.tsx), one CSS block (global.css), and should be mirrored in the three picker/filter list rows that hand-roll the same dot + "#name" markup.

### Components used
- **TagChip** (bespoke, token-compliant: true) — src/components/tag-chip.tsx. Token-clean today (color via data-label only). Carries the dot + tinted-pill treatment Maciej wants gone.
- **TagChipList** (bespoke, token-compliant: true) — Same file. Wraps TagChip for rows (max=3) and cards (max=4); +N overflow counter. No change needed beyond inheriting the new TagChip look.
- **TagPicker** (bespoke, token-compliant: true) — src/components/tag-picker.tsx. Popover wrapping shadcn Command. Hand-rolls the dot + '#name' row markup inline (lines 124-144) instead of reusing TagChip — must be updated in parallel or it will visually diverge from the new chip.
- **ActiveTagFilters / TagFilterButton** (bespoke, token-compliant: true) — src/features/tasks/ui/task-tag-filter.tsx. ActiveTagFilters renders TagChip with active (inherits new look). TagFilterButton's list rows hand-roll the same dot + '#name' markup (lines 66-74) — same divergence risk as TagPicker.
- **label tokens (data-label / --label / --label-surface)** (raw-html, token-compliant: true) — tokens.css §13b + global.css .tag-chip/.tag-dot/.tag-chip-outline. The color routing is correct and reusable. New .tag-hash class plugs into the exact same --label var.
- **shadcn Command / Popover** (shadcn-primitive, token-compliant: true) — Used by TagPicker and TagFilterButton. Correct primitive choice; out of scope for the chip restyle.

### Problems
- [high] **Triple-encoded color: the chip shows the tag's hue THREE ways at once — a colored dot (.tag-dot), a tinted surface fill (.tag-chip background = --label-surface), and an optional hued border (.tag-chip-outline when active). For a single piece of metadata this is redundant and is exactly the visual heaviness Maciej is reacting to.**
  - quote: why can't we color the hashtag instead of adding a dot? ... It doesn't look great overall.
  - at: src/components/tag-chip.tsx:25-44; src/global.css:179-189
  - cause: The chip was designed as a faint pill (dot + tint) before the hashtag-glyph idea existed; the '#' is deliberately de-emphasized (text-muted-foreground/70) so the dot has to carry the color, which forces the surrounding pill.
- [high] **The '#' glyph is rendered in text-muted-foreground/70 — a dead, grey decoration. Maciej wants it to BE the color signal. Right now it is the one element that could carry hue but is explicitly muted.**
  - quote: why can't we color the hashtag instead of adding a dot?
  - at: src/components/tag-chip.tsx:29 (<span className="text-muted-foreground/70">#</span>)
  - cause: Color responsibility was assigned to the dot, leaving '#' as inert decoration.
- [med] **Bulky pill: px-1.5 py-0.5 + the --label-surface fill + the dot + gap-1 make each chip wider and taller than the metadata warrants. On a dense task row (height rides --row-h) several chips crowd the title and meta cluster. Linear/Todoist render tags as near-bare inline text.**
  - quote: Each pill could be smaller then.
  - at: src/components/tag-chip.tsx:40 (px-1.5 py-0.5, gap-1, rounded border + tag-chip surface)
  - cause: Pill chrome (surface fill + horizontal padding + dot + gap) is load-bearing for legibility only because the label text itself is colorless; once the '#' is colored, the surface and dot become removable and padding can shrink.
- [med] **Markup duplication: the dot + '#name' pattern is hand-rolled in THREE places (TagPicker list rows, TagFilterButton list rows, and TagChip) rather than going through one component. Restyling the chip will silently leave the two picker lists on the old dot treatment unless they are edited too.**
  - quote: (found independently)
  - at: src/components/tag-picker.tsx:124-144; src/features/tasks/ui/task-tag-filter.tsx:66-74
  - cause: No shared 'tag label' atom; each consumer re-implements the dot + muted-# + name row.
- [low] **Contrast variance across hues for a colored glyph: the --label bases span oklch L 0.66 (red/blue/violet) to 0.80 (amber). A colored '#' at the dim end on bg-card is fine, but amber/green/teal at the bright end can feel slightly hot, and a fully-colored NAME (one of the design options) would push some hues below comfortable body-text contrast. This is a decision the dot sidestepped by keeping text neutral.**
  - quote: (found independently)
  - at: src/styles/tokens.css:658-665
  - cause: --label bases are tuned as dot/surface accents, not as text-on-surface foreground colors; reusing them for a glyph is safe, for full label text it is borderline.
- [low] **No Storybook story for the chip. CLAUDE.md rule 5 requires a story for primitives in src/components/ui/; TagChip lives in src/components/ (root, bespoke) so it is technically exempt, but a cross-module shared atom about to be restyled across rows/cards/picker/filter has no visual harness to verify the 8 hues x states (display / removable / active / button).**
  - quote: (found independently)
  - at: src/components/ (no tag-chip.stories.tsx)
  - cause: Chip predates the story convention and sits outside src/components/ui/ where the rule bites.

### Recommendations
- (S) **Add a .tag-hash class in global.css that colors the glyph from the label token: `.tag-hash { color: var(--label); }` — directly mirroring the existing `.tag-dot { background-color: var(--label); }`. Place it in the same §Tag-chips block (global.css ~line 187). This is the single load-bearing CSS addition; it keeps color token-routed (no hex, no inline style, no arbitrary Tailwind) because the element already carries data-label which sets --label.**
  - why: Maciej's core ask: color the hashtag, not a dot. Reusing the exact var the dot consumed means zero new color surface area and the recolor picker keeps working unchanged.
  - DS ref: tokens.css §13b --label via data-label; parallels existing .tag-dot in global.css. No hex / no inline color (CLAUDE.md rules 1 & 3).
  - files: src/global.css:187-189
- (S) **In TagChip (tag-chip.tsx) rebuild the label: delete the <span className="tag-dot ..."> dot (line 27), and change the '#' span from text-muted-foreground/70 to the new class: `<span className="tag-hash" aria-hidden>#</span>` followed by the plain name in text-foreground/80. Net markup: a colored # + neutral name, no dot.**
  - why: Drops the redundant dot and moves the hue onto the glyph exactly as requested; name stays neutral for legibility (the safer of the two color options — see open question).
  - DS ref: text-foreground/80 token; color via .tag-hash → var(--label).
  - files: src/components/tag-chip.tsx:25-33
- (S) **Strip the pill chrome on the outer span (tag-chip.tsx:40). Remove the .tag-chip surface fill and tighten padding: change `tag-chip inline-flex ... gap-1 rounded border border-transparent px-1.5 py-0.5 text-2xs` to `inline-flex ... gap-0.5 rounded px-1 py-0 text-2xs` (drop the `tag-chip` class entirely so --label-surface no longer paints a background; drop the border). Keep rounded for the hover/focus hit area on the clickable variant. This is what makes each chip 'smaller and lighter'.**
  - why: Removing the tinted surface + border + dot collapses the chip to inline text with a colored #, matching Linear/Todoist content-first density. gap-1→gap-0.5 and px-1.5→px-1 reclaim horizontal space on crowded rows.
  - DS ref: rounded-md control rounding kept for hit area; spacing on the standard scale (px-1/py-0/gap-0.5) — no arbitrary values (CLAUDE.md rule 2).
  - files: src/components/tag-chip.tsx:39-43; src/global.css:179-181
- (S) **Decide what to do with .tag-chip-outline (active filter emphasis). With the surface gone, the active state needs a new signal. Recommended: for active filter chips, color the WHOLE label (# and name) in var(--label) via a modifier, OR keep a faint surface ONLY for the active variant. Simplest token-clean option: add `.tag-active { color: var(--label); }` applied to the name span when active, so the active chip is fully hued while idle chips are colored-# + neutral-name. Keep .tag-chip-outline border or retire it.**
  - why: The active filter chip currently leans on a hued border that came with the pill; once the pill is gone the emphasis must be re-expressed. Full-hue label is the cleanest 'this filter is on' cue without reintroducing a background.
  - DS ref: var(--label) via data-label; mirrors .tag-hash. No new tokens.
  - files: src/components/tag-chip.tsx:40-41; src/global.css:183-185; src/features/tasks/ui/task-tag-filter.tsx:115
- (M) **Update the two hand-rolled list rows to match the new chip so the picker and filter dropdown don't keep the old dot. In TagPicker (tag-picker.tsx:124-144) the recolor swatch button legitimately needs to stay a dot (it's the color-edit affordance), but the '#name' label span at line 142 should adopt .tag-hash on the '#'. In TagFilterButton (task-tag-filter.tsx:66-74) the leading dot is pure decoration — replace with a colored '#' (.tag-hash) and drop the separate dot span.**
  - why: Prevents the surface from diverging: rows/cards/detail get the new colored-# chip while the dropdowns silently keep dots. The picker's recolor swatch is the one place a dot is still meaningful (it's the editable color target).
  - DS ref: .tag-hash → var(--label); reuse data-label already present on those rows.
  - files: src/components/tag-picker.tsx:141-144; src/features/tasks/ui/task-tag-filter.tsx:66-74
- (M) **Add src/components/tag-chip.stories.tsx covering: all 8 hues, display chip, removable chip (onRemove), button chip (onClick), active filter chip, and the TagChipList +N overflow — so the restyle is verifiable across hues/states in Storybook.**
  - why: A shared cross-module atom being restyled across four call sites needs a visual harness; catches the amber/teal brightness edge and the active-state redesign at a glance.
  - DS ref: CLAUDE.md rule 5 (story-required pattern); follow tag-picker.stories.tsx as the sibling example.
  - files: src/components/tag-chip.stories.tsx (new); pattern: src/components/tag-picker.stories.tsx

### Open questions for Maciej
- Colored '#' + neutral name, or fully-colored chip (# AND name in the hue)? Recommendation: colored '#' + neutral foreground/80 name as the default (keeps legibility uniform across all 8 hues, including the bright amber and the dim red/blue/violet), reserving the fully-colored treatment for the ACTIVE filter chip. Maciej may prefer fully-colored everywhere for more punch — but that risks low contrast on red/blue/violet at L 0.66 on bg-card.
- Keep any pill background at all, or go fully borderless inline text? Recommendation: fully borderless (drop --label-surface). But if chips need to stay visually 'chip-like' when crowded against meta icons on a row, a very faint surface could be retained only on hover. Maciej's wording ('Each pill could be smaller') leans borderless; confirm he wants the surface gone entirely vs. just slimmer.
- How should the ACTIVE filter chip read once the dot and tinted pill are gone? Options: (a) full-hue label, (b) a faint --label-surface retained only for active, (c) keep the hued border (.tag-chip-outline). Needs a one-line decision since the current active cue is tied to the pill being removed.
- Should the recolor swatch dot in TagPicker (the editable color target) stay a dot? Recommendation: yes — it's a color-EDIT affordance, not a display chip, so a dot/swatch is the right metaphor there even after display chips lose theirs. Confirm Maciej is OK with the picker's edit row looking different from the display chip.


## Tasks — Left bucket rail + section headers (src/features/tasks/ui/bucket-rail.tsx)

The section headers are NOT oversized at the token level — they're already at the correct Linear eyebrow size (text-2xs / 11px, uppercase, tracking-wide, muted). Maciej's "too large" read comes from the FONT, not the size: both section labels use font-display (Pilat Extended), a wide, heavy display face that makes an 11px uppercase label render visually chunky and oversized compared to a quiet Linear eyebrow (which would be body-font Geist). Dropping font-display → font-sans is the real fix, and it aligns with every shadcn primitive in this repo (dropdown/select/context-menu group headings all use body font, no font-display). Secondary issues: the section-header style is duplicated and divergent across the static "Buckets" header and the collapsible section header, and the two header types are structurally inconsistent. The file is otherwise token-clean — no raw hex, no arbitrary color/spacing/radius values, no inline DS style overrides. Rows already use --row-h and token-based active/hover states correctly.

### Components used
- **SECTION_LABEL constant (static "Buckets" header)** (raw-html, token-compliant: true) — bucket-rail.tsx:42-43 — span styled with font-display text-2xs font-medium uppercase tracking-wide text-muted-foreground/70. Token-compliant (no hex/arbitrary values) but uses font-display where body font is wanted for a quiet eyebrow.
- **Inline collapsible section header label** (raw-html, token-compliant: true) — bucket-rail.tsx:203-205 — second, separate copy of the eyebrow style: font-display text-2xs font-medium uppercase tracking-wide, but WITHOUT the /70 opacity the constant has. Diverges from SECTION_LABEL; should share one source of truth.
- **SelectionRow / BucketRow (row primitives)** (raw-html, token-compliant: true) — bucket-rail.tsx:357-378 / 459-542 — minHeight via var(--row-h), active=bg-accent text-foreground, hover=hover:bg-accent/60. Token-correct. Labels use font-display (debatable but consistent with rail intent).
- **DropdownMenu / Tooltip / Input** (shadcn-primitive, token-compliant: true) — Correctly imported from src/components/ui/. Bucket options menu, drift tooltip, rename/add inputs all wrap shadcn. No rolled-own primitives.
- **ModeToggle (plan/execute tabs)** (raw-html, token-compliant: true) — bucket-rail.tsx:251-285 — bespoke segmented control, not shadcn Tabs, but token-clean (bg-muted, rounded-md/rounded-sm, focus-visible:ring-ring). Out of the section-header scope; flagging only that it's a hand-rolled tablist where shadcn Tabs/ToggleGroup exists.

### Problems
- [med] **Section headers render visually too large/heavy because they use font-display (Pilat Extended) — a wide, bold display face — at uppercase 11px. The SIZE token (text-2xs/11) is already correct for a Linear eyebrow; the display font is what makes it read oversized and chunky. Every shadcn group-heading in this repo (dropdown-menu.tsx:169, select.tsx:114, context-menu.tsx:215, command.tsx:57) uses body font for the same role, so the rail is the outlier.**
  - quote: The section names are too large. Verify if ok to make smaller.
  - at: src/features/tasks/ui/bucket-rail.tsx:42-43 (static "Buckets") and 203-205 (collapsible section name)
  - cause: font-display in the eyebrow class. Pilat Extended is wide + heavy; at 11px uppercase it has far more visual mass than a body-font eyebrow. Compounded by the known global.css:130 `* { font-family: Pilat... }` bug — on web Pilat falls back to Inter, but the design INTENT here is still display font, which is wrong for a quiet section eyebrow.
- [med] **The section-header style is duplicated and the two copies have diverged: the SECTION_LABEL constant carries text-muted-foreground/70, but the inline collapsible header (line 203) omits the /70 and instead colors via the parent button's text-muted-foreground. Result: the static 'Buckets' eyebrow and the collapsible section eyebrows are not pixel-identical (different muted opacity, different padding context).**
  - quote: (found independently)
  - at: src/features/tasks/ui/bucket-rail.tsx:42-43 vs 203-205
  - cause: Two hand-written copies of the same eyebrow treatment instead of one shared constant. SECTION_LABEL exists but is only applied to the 'Buckets' header (line 140); the collapsible header re-implements the type styling inline.
- [low] **The two section-header types are structurally inconsistent. The 'Buckets' header (line 139-151) is a plain non-collapsible span with a hover '+' affordance. The user-created section headers (line 192-219) are collapsible buttons with a chevron and a count. So the first 'section' in the rail looks and behaves differently from every other section, weakening the type hierarchy Linear relies on.**
  - quote: (found independently)
  - at: src/features/tasks/ui/bucket-rail.tsx:139-151 vs 190-219
  - cause: 'Buckets' is a structural/static header while group sections are data-driven collapsibles; they were built separately and never unified. Acceptable functionally, but the visual mismatch contributes to the rail reading less tight/quiet than Linear.
- [low] **Static 'Buckets' header has no count and is not collapsible, while collapsible sections show an aggregate openCount (line 206-207). Minor hierarchy asymmetry — the top-level group reads as 'more important' than named sections purely from chrome differences, not intent.**
  - quote: (found independently)
  - at: src/features/tasks/ui/bucket-rail.tsx:139-151
  - cause: Same root as above — two header implementations. Listed separately because if the headers are unified, the count/collapse decision must be made deliberately.
- [low] **Collapsible section header uses tracking-wide (0.04em) at 11px uppercase, which is on the tight side for an uppercase eyebrow; Linear/Notion eyebrows typically sit at ~0.05–0.08em. The notes rail (notes-right-rail.tsx:16, NotesSplitView.tsx:119) uses tracking-wider for the same role, so the rail is slightly tighter than its sibling rails.**
  - quote: (found independently)
  - at: src/features/tasks/ui/bucket-rail.tsx:43, 203
  - cause: tracking-wide chosen over tracking-wider. Low impact, but worth aligning once the font changes (uppercase + body font wants slightly more tracking to stay legible).

### Recommendations
- (S) **Change the section-header font from font-display to body font (drop font-display so it resolves to font-sans / Geist). This is the actual fix for 'too large' — keep the size at text-2xs (11px). An 11px uppercase Geist eyebrow reads as the quiet Linear section label Maciej wants, where the same size in Pilat Extended reads chunky. Apply to BOTH the SECTION_LABEL constant and the inline collapsible header.**
  - why: The size token is already correct (text-2xs = 11 = the documented 'eyebrow / section labels' size in tokens.css:487). The perceived bulk is the display face. Switching to body font matches every shadcn group-heading in the repo and the notes rail, restoring consistency and quietness without shrinking below the established eyebrow size.
  - DS ref: --text-2xs (11, tokens.css:487, labelled 'eyebrow / section labels'); font-sans (body = Geist); matches dropdown-menu.tsx:169 / select.tsx:114 / context-menu.tsx:215 group-heading convention
  - files: src/features/tasks/ui/bucket-rail.tsx:42-43; src/features/tasks/ui/bucket-rail.tsx:203
- (S) **De-duplicate: make the collapsible section header (line 203) consume the same shared eyebrow class used for the 'Buckets' header. Extract the eyebrow type treatment to one constant (e.g. keep SECTION_LABEL but split the padding off it so it can be reused inside the flex button) and apply it in both places so muted opacity, size, font, and tracking are guaranteed identical.**
  - why: Two divergent copies (one with /70, one without) is exactly the kind of drift that makes a rail feel inconsistent. One source of truth means the font/size change above lands in one place and both header types stay pixel-identical.
  - DS ref: text-muted-foreground (pick one opacity for both — recommend the /70 the constant already uses, or full muted, but not both)
  - files: src/features/tasks/ui/bucket-rail.tsx:42-43; src/features/tasks/ui/bucket-rail.tsx:140; src/features/tasks/ui/bucket-rail.tsx:203-205
- (S) **Bump tracking from tracking-wide to tracking-wider on the section eyebrow once it switches to body font. Uppercase body-font labels need slightly more letter-spacing than the display face did to stay crisp at 11px.**
  - why: Aligns with the sibling notes rail (notes-right-rail.tsx:16, NotesSplitView.tsx:119 both use tracking-wider for the identical role) and reads more like a Linear eyebrow. Pure polish; bundle with rec 1.
  - DS ref: tracking-wider (Tailwind default 0.05em); sibling pattern in notes rail
  - files: src/features/tasks/ui/bucket-rail.tsx:43; src/features/tasks/ui/bucket-rail.tsx:203
- (M) **Optional structural unification: make the 'Buckets' header a collapsible section header of the same shape as the named sections (chevron + label + aggregate count), with the '+' affordance preserved. Gives every section in the rail one consistent header treatment and lets users collapse the default bucket group too.**
  - why: Linear's strength is that every list section looks and behaves identically. Today the first 'section' is a special-cased static header, which subtly breaks the hierarchy. This is a behavior change (collapsibility + count on 'Buckets'), so it needs Maciej's sign-off — hence the open question, not an automatic change.
  - DS ref: Reuse the same header markup as the section.map() branch (bucket-rail.tsx:192-219)
  - files: src/features/tasks/ui/bucket-rail.tsx:139-151

### Open questions for Maciej
- The section headers are already at the smallest eyebrow size (text-2xs = 11px). Going smaller (e.g. text-[10px]) is off-ladder and not recommended. Confirm the intended fix is the FONT (display→body), keeping 11px — that's what makes it read 'smaller'/quieter without leaving the type scale. (Recommended.)
- Should the static 'Buckets' header be unified into a real collapsible section (chevron + count + collapsible) so all rail sections look identical, or stay a distinct static header? This is a behavior change, not just visual.
- Eyebrow muted level: the two copies currently disagree (/70 vs full muted). Pick one for the whole rail — recommend text-muted-foreground/70 for the quiet Linear look, but confirm.
- Do the bucket/selection ROW labels (lines 373, 475) also want to drop font-display? They use Pilat for bucket names; if the goal is a Linear content-first rail, row labels in body font would read lighter too. Out of the literal section-header scope, so flagging rather than recommending.


## Tasks — Task detail panel (right rail inspector): src/features/tasks/ui/task-detail-panel.tsx, mounted at tasks-plan-view.tsx:417 inside FeaturePanelsShell right rail (bg-card panel, --pad-x-sm padding).

Maciej is right: the form controls are the core problem. Every property editor is a filled, bordered "input well" (border-border + bg-input) that reads as a dense enterprise form — the exact anti-pattern the DS calls out. The visual failure has two compounding causes: (1) bg-input (neutral-850) sits only ONE elevation step above the panel's bg-card (neutral-900), so the fields read as muddy gray boxes with weak edges rather than crisp wells OR quiet inline rows; and (2) ~9 stacked full-width bordered controls (Status, Bucket, Scheduled, Due, Priority, Energy, Duration, Repeat, plus title/description) create a wall of identical chrome with no hierarchy — nothing like Linear's quiet label+value rows. Font-size and states are also off: the title uses font-display (Pilat→Inter fallback on web) at text-base inside a 32px box, placeholders rely solely on muted-foreground, and the focus state is a 2px ring WITH a 2px offset that visually detaches from the field. The fix is a "property row" pattern (inline label + borderless value, hairline-on-focus) plus quieting the primitives. No raw-hex or arbitrary-value violations were found in the surface — the bypasses here are font-role and dead height classes, not token violations.

### Components used
- **Input (shadcn)** (shadcn-primitive, token-compliant: true) — src/components/ui/input.tsx. Used for title (line 214), Scheduled datetime-local (317), Due date (327), Duration number (357), new-subtask (633). Border border-border + bg-input + rounded-md, height via inline style var(--ctrl-h). Token-clean but the default chrome (always-bordered filled well) is what reads as 'enterprise form'. No py / no items-center — relies on native single-line vertical centering; date/number variants render the native picker UI which the primitive can't restyle.
- **Textarea (shadcn)** (shadcn-primitive, token-compliant: true) — src/components/ui/textarea.tsx. Description field (line 258). min-h-20 default, overridden to min-h-16 + text-sm. Same bordered filled-well treatment as Input; resize-y handle is visible chrome.
- **Select (shadcn/Radix)** (shadcn-primitive, token-compliant: true) — src/components/ui/select.tsx. Status, Bucket, Priority, Energy, Repeat triggers — all w-full + size='sm' + font-display. Trigger is bordered filled well identical to Input. SelectContent/Item are token-clean (bg-popover, focus:bg-accent).
- **Field (bespoke label wrapper)** (bespoke, token-compliant: true) — task-detail-panel.tsx:885. Renders a stacked eyebrow label (font-display text-2xs uppercase tracking-wide muted) ABOVE the control. This stacked label+control-in-a-box layout is the structural reason the panel reads as a tall form rather than Linear's inline label|value rows.
- **TagChip / TagPicker** (bespoke, token-compliant: true) — Imported from src/components/tag-chip + tag-picker; consume the §13b label tokens. Not the subject of the complaint and visually fine; leave as-is.
- **Button, Popover, Command, Tooltip, Separator** (shadcn-primitive, token-compliant: true) — Skip-occurrence button, Commit button, BlockerPicker popover+command, related-row tooltips, section separators. All token-clean and not part of the form-control complaint.
- **Native date/datetime-local inputs** (native-control, token-compliant: false) — Scheduled (type=datetime-local, line 318) and Due (type=date, line 329) are raw native inputs styled only by the Input wrapper. The native calendar/clock indicator, internal segment spacing, and placeholder text are browser-rendered and CANNOT be tokenized — they will never match the DS type ramp or the dark surfaces. This is the single biggest 'looks bad / inconsistent states' offender among the date fields and is exactly what Maciej means by 'date inputs look bad.'

### Problems
- [high] **bg-input (neutral-850) is only one elevation step above the panel's bg-card (neutral-900), so every field reads as a low-contrast muddy gray box. Fields neither pop as crisp wells nor recede as quiet inline rows — they sit in an uncomfortable middle that looks unfinished.**
  - quote: I don't like how input fields look like
  - at: src/components/ui/input.tsx:11; src/components/ui/select.tsx:40; src/components/ui/textarea.tsx:10 (bg-input) vs tokens.css:111,131 (card=neutral-900, input=neutral-850)
  - cause: The semantic ladder gives input wells only a ~4% lightness lift over card. On bg-background (pure black) the well reads fine; inside a bg-card right rail the contrast collapses. The primitive has no notion of 'on-card' vs 'on-background'.
- [high] **Nine-plus full-width, identically-styled bordered controls are stacked vertically (title, description, Status, Bucket, Scheduled, Due, Priority, Energy, Duration, Repeat, Tags). The result is a wall of repeating chrome with no visual hierarchy — the 'enterprise-SaaS dense bordered form' explicitly banned by the DS anti-patterns.**
  - quote: there's a lot of them
  - at: src/features/tasks/ui/task-detail-panel.tsx:271-442 (the properties stack)
  - cause: Each property is rendered as Field(stacked eyebrow label) + boxed control. There is no 'property row' abstraction (inline label | borderless value) like Linear/Todoist use, so density and chrome cannot be dialed down.
- [high] **Focus state uses a 2px ring WITH a 2px ring-offset (focus-visible:ring-2 + ring-offset-2). The offset paints a gap in the background color around the field, making the ring look detached/floating rather than hugging the control — reads as heavy and imprecise, not Linear's tight 1px focus border.**
  - quote: their states
  - at: src/components/ui/input.tsx:15; src/components/ui/textarea.tsx:14; src/components/ui/select.tsx:41
  - cause: shadcn default focus recipe (ring + offset) is tuned for buttons on a plain background, not for inline fields on a tinted card. On bg-card the offset gap is visible and ugly.
- [med] **No hover state on any input/select/textarea. The only state change is focus. Linear/Todoist fields subtly lift their border or background on hover to signal editability; here the field looks inert until clicked, and combined with the always-on border it reads as a static disabled-looking box.**
  - quote: their states
  - at: src/components/ui/input.tsx:10-18; src/components/ui/select.tsx:39-47; src/components/ui/textarea.tsx:9-17
  - cause: Primitives ship only focus-visible + disabled + aria-invalid states. No hover affordance was added.
- [high] **Native date/datetime-local inputs (Scheduled, Due) render browser-default internal UI — segment spacing, the calendar/clock picker glyph, and empty-state text — none of which can be tokenized. They visually clash with the DS type ramp and the dark surfaces, and their empty/filled/hover/focus states differ from every other field. This is the most jarring 'bad state' in the date row.**
  - quote: their states, font size or anything about them
  - at: src/features/tasks/ui/task-detail-panel.tsx:317-324 (datetime-local), 327-334 (date)
  - cause: Raw <input type=date/datetime-local> wrapped in the generic Input primitive; the native control internals are outside CSS reach. No date-field primitive (Popover + Calendar) exists in the surface.
- [med] **The title field forces font-display at text-base inside a 32px-tall transparent input. On web Pilat Extended only loads via local(), so it falls back to Inter — the title renders in a different family than intended, at a size (14px) that is small for a primary H1-equivalent in a detail panel. Title hierarchy is weak.**
  - quote: font size or anything about them
  - at: src/features/tasks/ui/task-detail-panel.tsx:229 (font-display text-base, border-transparent bg-transparent px-0)
  - cause: Title piggybacks on the Input primitive with overrides instead of being a purpose-built borderless title field; text-base is the body size, too small to anchor the panel.
- [med] **Dead/misleading height classes: h-8 is applied to Scheduled (321), Due (331), Duration (366), and the new-subtask Input (638), but the Input primitive sets height via inline style={{height: var(--ctrl-h)}}, which always overrides the class. The h-8 is silently ignored. A future editor will trust h-8 and be confused when it has no effect, and it implies an intent (fixed 32px) that diverges from the density-token system.**
  - quote: (found independently)
  - at: src/features/tasks/ui/task-detail-panel.tsx:321,331,366,638; overridden by src/components/ui/input.tsx:21
  - cause: Inline style on the primitive beats utility classes in the cascade. The h-8 overrides were likely added before the primitive moved to an inline density var and were never removed.
- [med] **Inconsistent control sizing intent: Select triggers use size='sm' (var(--ctrl-h-sm) = 26px comfortable) while the sibling Inputs (Scheduled/Due/Duration) render at var(--ctrl-h) = 32px. In the same two-column grid (Scheduled|Due are 32px Inputs; Priority|Energy are 26px Selects) adjacent rows have mismatched control heights, breaking the vertical rhythm.**
  - quote: font size or anything about them
  - at: src/features/tasks/ui/task-detail-panel.tsx:278,299,311(?),381,911 (SelectTrigger size='sm') vs 317-366 (Inputs at default ctrl-h)
  - cause: Selects opted into the small size; Inputs kept the default. No single source decides the property-row control height.
- [low] **Placeholder and empty-value affordances are weak and inconsistent. Description placeholder is muted-foreground only (line 261); Duration uses an em-dash '—' placeholder (363); Tags empty state is a 'No tags' text span (439); date fields show native empty UI. Four different empty-state treatments across the form.**
  - quote: their states
  - at: src/features/tasks/ui/task-detail-panel.tsx:261,363,439; native date empties at 317-334
  - cause: No shared 'empty property' convention. Each field improvises its empty representation.
- [low] **font-display is applied to every Select trigger value (Status/Bucket/Priority/Energy/Repeat) and the title. Per DS typography roles select triggers ARE primary (font-display is correct per the contract), but because Pilat falls back to Inter on web, the trigger VALUES (a status word, a bucket name) render in Inter while the surrounding body is Geist — a subtle but real family mismatch that contributes to the 'doesn't feel cohesive' read. Flagging as a consequence of the known Pilat fallback, scoped to whether select VALUES (content, not chrome) should be body.**
  - quote: anything about them
  - at: src/features/tasks/ui/task-detail-panel.tsx:278,299,381,911 (font-display on triggers)
  - cause: DS says select triggers are primary/font-display, but a bucket name / status word is arguably content. The Pilat→Inter fallback makes the family split visible. This is a genuine role ambiguity, not a clear violation.

### Recommendations
- (L) **Introduce a single 'property row' pattern to replace the Field(stacked-label) + boxed-control stack. Row = inline grid: a fixed-width muted label column (e.g. ~88-96px, text-xs, text-muted-foreground) on the left, and a borderless/transparent value control on the right that fills the row, shows NO border at rest, reveals a hairline border (border-border) + bg-muted/40 on hover, and a 1px focus border (no ring-offset) on focus. This is the Linear inline-edit field. Build it as a small local <PropertyRow label value> wrapper in the tasks feature (or promote to a shared primitive if reused). Apply to Status, Bucket, Priority, Energy, Duration, Repeat at minimum.**
  - why: Directly answers 'the components look bad and there's a lot of them' — collapses 9 boxed wells into quiet, scannable rows with a strong label|value hierarchy, matching the Linear/Todoist references Maciej wants. Removes the 'enterprise dense bordered form' anti-pattern.
  - DS ref: Linear inline property rows; tokens: text-muted-foreground, border-border, hover bg-muted, focus-visible:ring-1 ring-ring (no offset); Field() helper at task-detail-panel.tsx:885 is replaced.
  - files: src/features/tasks/ui/task-detail-panel.tsx:271-442; src/features/tasks/ui/task-detail-panel.tsx:885-894
- (M) **Add a quiet/borderless variant to the Input, Textarea, and Select primitives (e.g. a `variant='ghost'` or `unstyled` prop, or a data-attr) that drops the resting border and bg-input, applies border-transparent bg-transparent, and only paints border-border + bg-muted on hover and a 1px border on focus. Keep the current filled variant as default for forms elsewhere (capture modal, settings). The detail panel opts into ghost.**
  - why: The complaint is specifically about how the fields look at rest. A ghost variant lets the panel be quiet without forking the primitive or violating rule 4 (still wraps shadcn). Reusable across other inline-edit surfaces (notes properties, etc.).
  - DS ref: shadcn variant pattern; tokens bg-transparent/border-transparent at rest → bg-muted/border-border on hover → ring-1 ring-ring on focus.
  - files: src/components/ui/input.tsx:5-25; src/components/ui/textarea.tsx:5-22; src/components/ui/select.tsx:25-57
- (S) **Remove the ring-offset from the focus state on Input/Textarea/Select (drop focus-visible:ring-offset-2 + ring-offset-background), and reduce to a 1px ring or a border-color swap to ring. On a tinted bg-card the offset paints an ugly gap; a tight 1px focus border reads precise and Linear-like.**
  - why: Fixes the 'states' complaint directly. The offset is the single ugliest part of the current focus treatment on a card surface.
  - DS ref: focus-visible:ring-1 ring-ring (no offset), or border-ring. Aligns with Linear's hairline focus.
  - files: src/components/ui/input.tsx:15; src/components/ui/textarea.tsx:14; src/components/ui/select.tsx:41
- (S) **Add a hover state to all three form primitives: hover:border-border hover:bg-muted (in ghost variant) or hover:border-foreground/20 (in filled). Gives fields an editability affordance they currently lack.**
  - why: Closes the missing-hover-state gap; signals 'click to edit' which is essential for the inline-row pattern.
  - DS ref: hover:bg-muted / hover:border-border tokens.
  - files: src/components/ui/input.tsx:10-18; src/components/ui/textarea.tsx:9-17; src/components/ui/select.tsx:39-47
- (L) **Replace the two native date inputs (Scheduled datetime-local, Due date) with a tokenized date-field: a SelectTrigger-styled (or PropertyRow) button showing the formatted date in body type, opening a shadcn Popover + Calendar (add the shadcn Calendar primitive via CLI if absent). This removes the un-stylable native picker UI and makes the date fields visually consistent with the rest of the panel and with the DS type ramp.**
  - why: The native date controls are the most visually broken element and cannot be tokenized — Maciej's 'date inputs look bad' is literally unsolvable without replacing them. A Popover+Calendar is the standard shadcn answer and matches Linear/Todoist date pickers. NOTE: confirm the datetime-local needs a time component — if so pair Calendar with a time Select.
  - DS ref: shadcn Calendar + Popover; rounded-md trigger; bg-popover content; tokens throughout. Replaces raw <input type=date>.
  - files: src/features/tasks/ui/task-detail-panel.tsx:315-336; src/components/ui/calendar.tsx (new, via shadcn CLI)
- (S) **Remove the dead h-8 classes on the Scheduled, Due, Duration, and new-subtask Inputs — they are overridden by the primitive's inline height style and only mislead. Let the control height flow from the density token (var(--ctrl-h) / --ctrl-h-sm) consistently.**
  - why: Eliminates misleading dead code and keeps every control on the density-token ladder (supports the parked 'density is a customization axis' work).
  - DS ref: density tokens --ctrl-h / --ctrl-h-sm; remove arbitrary fixed height.
  - files: src/features/tasks/ui/task-detail-panel.tsx:321; src/features/tasks/ui/task-detail-panel.tsx:331; src/features/tasks/ui/task-detail-panel.tsx:366; src/features/tasks/ui/task-detail-panel.tsx:638
- (S) **Unify control height across the property grid: pick ONE size (recommend size='sm' / --ctrl-h-sm everywhere for the quiet Linear feel) so the Scheduled|Due row and the Priority|Energy row share a height and the column rhythm is even. Apply via the PropertyRow wrapper so it's set in one place.**
  - why: Fixes the mismatched-height grid rows that break vertical rhythm and make the panel feel un-tuned.
  - DS ref: single --ctrl-h-sm across the row pattern.
  - files: src/features/tasks/ui/task-detail-panel.tsx:315-353
- (M) **Promote the title to a purpose-built borderless title field at text-lg (18px) or text-md, distinct from the body inputs, with generous bottom spacing — and reconsider forcing font-display given the Pilat→Inter web fallback. Give the panel a clear H1-equivalent anchor instead of a 14px transparent input that looks like just another field.**
  - why: Strengthens the weak type hierarchy at the top of the panel; the title should read as the subject, not a form field.
  - DS ref: text-lg, font-display (per DS title role) — but verify the Pilat fallback; tokens only.
  - files: src/features/tasks/ui/task-detail-panel.tsx:214-230
- (M) **Standardize empty-property representation: a single muted 'Add …' / 'Empty' affordance convention across Description, Duration, Tags, dates (e.g. muted-foreground placeholder text that becomes an editable control on click), instead of the current four different treatments (placeholder, em-dash, 'No tags', native empty).**
  - why: Consistent empty states are a large part of feeling 'finished'; reduces the visual noise of mixed conventions.
  - DS ref: shared empty-affordance convention; text-muted-foreground; matches Todoist's quiet 'Add X' rows.
  - files: src/features/tasks/ui/task-detail-panel.tsx:258-266; src/features/tasks/ui/task-detail-panel.tsx:355-370; src/features/tasks/ui/task-detail-panel.tsx:418-442

### Open questions for Maciej
- Inline label|value rows (label column on the left, Linear-style) vs. keeping stacked eyebrow-label-above-control? Inline is denser and more Linear-like but constrains label length; stacked is more flexible. This decides the PropertyRow shape — needs Maciej's call before building.
- Ghost/borderless-at-rest fields vs. keeping a visible filled well but fixing its contrast (bump the input/card separation)? Both solve 'looks bad' but produce very different panels — one is quiet/Linear, one is crisper/Notion. Which direction?
- For the Scheduled field: is the time component actually used, or is date-only sufficient? Determines whether the replacement is Calendar-only or Calendar + time picker, and whether Scheduled and Due can share one date-field component.
- Should select trigger VALUES (status word, bucket name) stay font-display per the DS typography-role rule, or move to body? The Pilat→Inter web fallback makes the family split visible against Geist body text. This is a genuine role-ambiguity the contract doesn't cleanly resolve.
- Target density for this panel: adopt --ctrl-h-sm (26px) everywhere for the dense Linear feel now, or leave at comfortable and let the parked density-axis work drive it later? Affects the PropertyRow default.


## Input / Textarea / Select primitives (src/components/ui/input.tsx, textarea.tsx, select.tsx)

All three primitives are genuine shadcn (new-york) wrappers, token-routed, and free of raw hex/arbitrary DS values — the foundation is sound. But they have drifted from the CURRENT canonical shadcn in two consequential ways that fully explain Maciej's complaint about "states" and "font size." (1) The focus/invalid states use the OLD shadcn ring model — `ring-2 ring-ring ring-offset-2 ring-offset-background` — which on the pink accent renders as a thick, hard, full-opacity halo with a visible gap ring; canonical shadcn moved to a quieter `border-ring + ring-ring/50 ring-[3px]` (no offset) border-hugging glow that reads far more Linear-like. (2) The border uses `border-border` (hairline) instead of shadcn's `border-input`, and the fill omits shadcn's `dark:bg-input/30` translucency and `shadow-xs` — so the wells read flatter and lower-contrast than current shadcn. Font-size is 13px (`text-sm` token) vs shadcn's 14px and lacks the mobile-16px guard; the 13px is a defensible Linear-ward decision but is an undocumented deviation. Net: the primitives need a states + surface refresh to match current shadcn, keeping the deliberate density/type choices.

### Components used
- **Input** (shadcn-primitive, token-compliant: true) — src/components/ui/input.tsx. Real shadcn wrapper, no hex/arbitrary DS values. Drift from canonical: uses border-border (not border-input), old offset ring model, no shadow-xs, no dark:bg-input/30, text-sm=13px (not text-base md:text-sm=14px), and routes height via inline style={{height:'var(--ctrl-h)'}} instead of an h- utility.
- **Textarea** (shadcn-primitive, token-compliant: true) — src/components/ui/textarea.tsx. Same drift set as Input. Uses min-h-20 (canonical is min-h-16) and resize-y; missing field-sizing-content (canonical auto-grow). Same old offset ring + border-border + no shadow-xs.
- **Select (Trigger/Content/Item/etc.)** (shadcn-primitive, token-compliant: true) — src/components/ui/select.tsx. Real radix-ui wrapper. Trigger has same old-ring/border-border/no-shadow drift; size routed via inline style instead of data-[size]:h-* utilities. Content/Item/Separator are clean and well token-routed. Missing line-clamp/truncation on SelectValue.
- **Label** (shadcn-primitive, token-compliant: true) — src/components/ui/label.tsx. Consumed by all three stories. Clean; text-sm font-medium font-sans. Not in scope to change but informs the field group.

### Problems
- [high] **Focus and invalid states use the OLD shadcn ring model: ring-2 ring-ring ring-offset-2 ring-offset-background. With the pink default accent (--ring = --pink-base) this paints a full-opacity, hard-edged 2px pink halo separated from the control by a 2px background-colored gap ring. It reads loud and 'glowy' — the opposite of the quiet Linear hairline aesthetic — and is almost certainly the 'I don't like their states' part of the critique. Current canonical shadcn (Tailwind v4) replaced this with focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] and NO offset: a soft 50%-opacity glow hugging the border. The invalid state has the same problem: aria-invalid:ring-2 ring-destructive is a hard full-opacity red halo vs shadcn's aria-invalid:ring-destructive/20 dark:ring-destructive/40 aria-invalid:border-destructive.**
  - quote: I don't like how input fields look like, their states
  - at: input.tsx:15,17; textarea.tsx:14,16; select.tsx:41,43
  - cause: Primitives were generated from an older shadcn template (pre-Tailwind-v4 ring refactor) and never updated when shadcn moved to the ring/50 + ring-[3px] no-offset model.
- [high] **Border color is border-border (the --neutral-800 hairline) instead of shadcn's border-input. Combined with bg-input fill and NO shadow-xs and NO dark:bg-input/30 translucency, the input wells read as flat, low-separation rectangles against bg-card/bg-background. shadcn's current input intentionally layers a subtle shadow-xs + translucent fill so the field reads as a recessed well. The flatness is the visual core of 'I don't like how input fields look like.'**
  - quote: I don't like how input fields look like
  - at: input.tsx:11; textarea.tsx:10; select.tsx:40
  - cause: Token-mapping decision (border-border vs border-input) plus dropped shadow-xs during the shadcn->token port; never reconciled against current shadcn surface treatment.
- [med] **Font size is text-sm = 13px (0.8125rem at normal text-size; 12px at small). Canonical shadcn ships text-base md:text-sm (16px collapsing to 14px on desktop). So Moduo inputs run 1px smaller than shadcn AND lack the mobile-16px iOS-zoom guard. The 13px is a defensible Linear-ward density decision, but it is an undocumented deviation and is the literal 'font size' item in the critique — it needs to be a recorded, intentional choice, not silent drift.**
  - quote: font size or anything about them
  - at: input.tsx:11; textarea.tsx:10; select.tsx:40
  - cause: Deliberate density tuning toward Linear, but never justified as a 'better, not worse' deviation per Maciej's standard; also diverges from shadcn's responsive text-base/md:text-sm pattern.
- [med] **Height is applied via an inline style prop (style={{height:'var(--ctrl-h)'}} on Input, heightVar on SelectTrigger) rather than a Tailwind h- utility or data-[size] variant. This works, but: (a) it's an inline style override of a design-system property (height/sizing), which the CLAUDE.md hard-rule discourages for DS props; (b) it can't be overridden by a className h-* without !important; (c) it diverges from how shadcn (and the repo's own Button via data-size) express size. Canonical shadcn Select uses data-[size=default]:h-9 data-[size=sm]:h-8 utilities.**
  - quote: All components used here should be sourced from the shadcn-based design system
  - at: input.tsx:21; textarea.tsx (n/a — no height); select.tsx:34,48
  - cause: Density tokens (--ctrl-h / --ctrl-h-sm) don't have matching Tailwind h- utilities, so the author reached for inline style. A theme-mapped utility (e.g. --spacing/--height token exposed via @theme) doesn't exist for control heights.
- [low] **Textarea omits field-sizing-content (auto-grow) that current shadcn ships, and uses resize-y + min-h-20 instead of shadcn's min-h-16. The manual resize handle is a minor skeuomorphic affordance; current shadcn auto-grows to content which is the more modern, content-first behavior Maciej references (Todoist/TickTick).**
  - quote: anything about them
  - at: textarea.tsx:10,12
  - cause: Generated before field-sizing-content was adopted by shadcn; min-h chosen ad hoc.
- [low] **SelectValue has no truncation. Canonical shadcn Trigger applies *:data-[slot=select-value]:line-clamp-1 so a long selected value doesn't blow out the trigger width (the trigger is w-fit by default). In a dense task UI with assignee/label selects this will cause layout jitter.**
  - quote: (found independently)
  - at: select.tsx:40-46
  - cause: line-clamp utility dropped during port; SelectValue carries data-slot but trigger doesn't target it.
- [med] **Input/Textarea focus-visible style differs from the repo's own Button primitive, but BOTH use the old offset model (button.tsx:12 also has ring-2 ring-ring ring-offset-2). So the inconsistency is system-wide-consistent-but-outdated rather than internally divergent. Worth noting: whatever ring decision is made for inputs should be made for Button in the same pass so the whole control family matches.**
  - quote: we know they are better decisions and not worse
  - at: input.tsx:15; button.tsx:12
  - cause: All controls share the same outdated ring template; fixing inputs alone would create a new inconsistency with buttons.
- [low] **Input applies font-sans (body font) explicitly. Per DESIGN_SYSTEM.md typography roles, 'menu / select triggers' and 'control labels' are primary = font-display, while free-text fields (the value the user types) are arguably body. SelectTrigger correctly... also uses font-sans (select.tsx:40), which contradicts the doc's rule that select triggers are primary/font-display. This is a genuine ambiguity: typed input content reads better as body, but the SelectTrigger (which shows a chosen label, chrome) is spec'd as display. Currently both are font-sans, so the select trigger violates the stated role.**
  - quote: (found independently)
  - at: input.tsx:11; select.tsx:40
  - cause: font-sans was added to defend against the global.css line-130 Pilat-on-everything bug, but it was applied uniformly without honoring the display-vs-body role split for chrome controls.

### Recommendations
- (S) **Adopt the current shadcn (Tailwind v4) focus + invalid ring model across Input, Textarea, and SelectTrigger. Replace 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background' with 'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]' (no offset). Replace 'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive' with 'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40'. This is the single highest-leverage fix: it directly resolves the 'states' complaint, propagates to every input/select in the app, and is the better decision (matches current upstream, quieter, Linear-like). Note ring-[3px] is an arbitrary value but is the sanctioned shadcn focus token and is geometry not a color/spacing DS prop — acceptable; alternatively expose a --ring-width token. Mirror the same ring change in button.tsx:12 in the same PR so controls stay consistent.**
  - why: The hard offset halo is the loudest deviation and the most likely literal referent of 'I don't like their states.' ring-ring/50 + border-ring hugging the control is quieter and matches the Linear reference Maciej wants.
  - DS ref: shadcn new-york Input/Textarea/Select (current) focus model; --ring / --destructive tokens
  - files: src/components/ui/input.tsx:15,17; src/components/ui/textarea.tsx:14,16; src/components/ui/select.tsx:41,43; src/components/ui/button.tsx:12
- (S) **Bring the well surface back in line with current shadcn: switch the border from border-border to border-input on all three; add shadow-xs; and add the translucent dark fill 'dark:bg-input/30' (and for SelectTrigger, 'dark:hover:bg-input/50'). Keep bg-input as the base fill. This gives the recessed-well look shadcn ships and raises field separation against bg-card without adding chrome weight.**
  - why: Flatness + hairline-only border is why the fields 'look' wrong. border-input + shadow-xs + translucent fill is the shadcn-canonical recessed treatment and reads more intentional.
  - DS ref: shadcn new-york Input surface (border-input, shadow-xs, dark:bg-input/30); --input / --shadow-xs tokens
  - files: src/components/ui/input.tsx:11; src/components/ui/textarea.tsx:10; src/components/ui/select.tsx:40
- (S) **Decide and DOCUMENT the input font-size. Option A (recommended, Linear-ward): keep text-sm (13px) but add a one-line comment in each primitive stating this is a deliberate deviation from shadcn's text-base/md:text-sm toward Linear UI density, tied to the --text-sm token so it scales with data-text-size. Option B (shadcn-parity): switch value text to text-base (14px). Do NOT leave it as silent drift. Whichever is chosen, apply identically to Input value, Textarea value, and SelectTrigger value so the field family is uniform.**
  - why: Maciej explicitly lists 'font size' and explicitly demands deviations be known-better, not silent. The fix is as much documentation as code.
  - DS ref: --text-sm / --text-base tokens; shadcn text-base md:text-sm convention
  - files: src/components/ui/input.tsx:11; src/components/ui/textarea.tsx:10; src/components/ui/select.tsx:40
- (M) **Replace the inline height style with a proper data-size variant pattern matching the repo's Button. Expose control heights as a Tailwind utility (add --height-ctrl / --height-ctrl-sm under @theme in tokens.css mapping to --ctrl-h / --ctrl-h-sm, OR keep the data-size approach but apply height via a CSS rule keyed on data-size in a small @layer). Then Input/SelectTrigger set data-size and pick up height from a utility/CSS rather than style={{height}}. Removes the inline DS-prop override and lets className override sizing. Add a 'sm' size prop to Input for parity with SelectTrigger and Button.**
  - why: Inline style on a DS property is the one hard-rule the primitives technically bend; routing height through a token-backed utility makes the primitives composable and consistent with Button's data-size pattern. Also gives Input a small variant for dense rows (task-row/bucket-rail already force h-7 via className, which an sm size would standardize).
  - DS ref: button.tsx data-size pattern; --ctrl-h / --ctrl-h-sm density tokens; shadcn Select data-[size]:h-* 
  - files: src/components/ui/input.tsx:21; src/components/ui/select.tsx:34,48; src/styles/tokens.css:386-421,673-732
- (S) **Modernize Textarea sizing: adopt 'field-sizing-content' for auto-grow and set min-h-16 to match shadcn, keeping resize-y as an opt-out only if Maciej wants manual resize. Reassess whether resize-y should stay (content-first lists/Todoist lean toward auto-grow, no handle).**
  - why: Auto-grow is the current shadcn + content-first behavior; the manual resize grip is a minor skeuomorphic affordance out of step with the Linear/Todoist references.
  - DS ref: shadcn new-york Textarea (field-sizing-content, min-h-16)
  - files: src/components/ui/textarea.tsx:10,12
- (S) **Add SelectValue truncation: append "*:data-[slot=select-value]:line-clamp-1" to the SelectTrigger className so long selected values clamp instead of widening the w-fit trigger.**
  - why: Prevents layout jitter in dense task selects (assignee/label) and matches canonical shadcn.
  - DS ref: shadcn new-york SelectTrigger line-clamp on select-value slot
  - files: src/components/ui/select.tsx:40-46
- (S) **Resolve the font-role for SelectTrigger vs Input. Per DESIGN_SYSTEM.md, select triggers are chrome = primary/font-display, while a free-text Input value is body. Recommended: SelectTrigger -> font-display (chrome, shows a chosen label, matches Button/menu triggers); Input + Textarea value text -> keep font-sans (user-typed content is body). This makes the doc and the code agree and visually ties selects to the button/menu family.**
  - why: The doc explicitly classes select triggers as primary; current code uses font-sans on the trigger, contradicting it. Aligning removes ambiguity and visually groups selects with other chrome controls.
  - DS ref: DESIGN_SYSTEM.md Typography roles (primary = font-display for select triggers/buttons); --font-display / --font-body
  - files: src/components/ui/select.tsx:40; src/components/ui/input.tsx:11; src/components/ui/textarea.tsx:10
- (M) **Expand Storybook coverage so the spec captures the refreshed states. Add Focus and Hover stories (or play-function-driven focus) to input.stories.tsx, textarea.stories.tsx, and select.stories.tsx; add a small-size Input story; add a density-axis story (wrap in data-density='dense' + data-text-size='small') so the Linear-end is visually verifiable. The stories currently cover Default/WithLabel/Disabled/Invalid/Types but never show the focus ring — the exact state being changed.**
  - why: Per DESIGN_SYSTEM.md rule 4, Storybook is the spec and must cover focus/hover/active. The state being fixed is currently untested visually, so regressions would slip.
  - DS ref: DESIGN_SYSTEM.md rule 4 (Storybook covers hover/focus/active); data-density / data-text-size axes
  - files: src/components/ui/input.stories.tsx; src/components/ui/textarea.stories.tsx; src/components/ui/select.stories.tsx

### Open questions for Maciej
- Font size: lock inputs at 13px (text-sm, Linear-ward, your stated reference) or move to shadcn-parity 14px (text-base)? This is the literal 'font size' item in your critique — pick one and we document it as the intentional decision.
- Focus ring width: adopt shadcn's ring-[3px] glow as-is, or do you want a token-backed --ring-width so the focus geometry is system-controlled (and consistent with a future Button update)?
- Textarea behavior: auto-grow (field-sizing-content, no resize handle — more Todoist/Linear) vs keep the manual resize-y grip? Affects whether the resize affordance stays.
- Select trigger font role: confirm SelectTrigger should be font-display (chrome, per DESIGN_SYSTEM.md) while typed Input/Textarea values stay font-sans (body) — or keep everything font-sans for a flatter, more uniform field family?
- Scope: should this pass also update button.tsx's identical old offset ring in the same PR so all controls match, or keep Button out of scope for Session 11 inputs work?


## Date / calendar picker (Tasks module: capture modal, detail panel, and — discovered — the list-row inline editors)

Every due/scheduled field in the Tasks module is a raw native `<input type="date">` / `type="datetime-local"` rendered inside our Popover. The native control draws the OS calendar — wrong typeface, wrong radius, wrong palette, OS-blue accent, and a calendar popup we don't control — so it fully bypasses the design system exactly as Maciej says ("the calendar widget is the default one"). There is no Calendar primitive in `src/components/ui/`, and neither `react-day-picker` nor `date-fns` is installed; the shadcn config (new-york, lucide, cssVariables, ui→`@/src/components/ui`) is ready, so the standard fix is `bunx shadcn add calendar`, token-route it, wrap it in our Popover behind a Button trigger, and migrate all SIX call sites (the brief named four; I found two more in `task-row.tsx`). datetime-local also needs a time input alongside the calendar.

### Components used
- **Input type="datetime-local" (Scheduled)** (native-control, token-compliant: false) — capture-modal.tsx:257-265 and task-detail-panel.tsx:317-324 and task-row.tsx:546-555. Our Input primitive only styles the OUTER box (height var(--ctrl-h), bg-input, rounded-md). The picker popup, the up/down spinners, the AM/PM toggle, and the calendar grid are all OS-rendered chrome we cannot token-route. On web the value text also falls back to the OS UI font, not Geist.
- **Input type="date" (Due)** (native-control, token-compliant: false) — capture-modal.tsx:276-284, task-detail-panel.tsx:327-334, task-row.tsx:605-614. Same problem: clicking the field opens the browser/OS calendar with OS-blue selection, OS typography, square OS focus ring — none of it on our pink --ring / token palette.
- **Popover (shadcn)** (shadcn-primitive, token-compliant: true) — src/components/ui/popover.tsx is correct: bg-popover, border-border, rounded-md, var(--shadow-md), var(--z-popover). It's the right host for a token-routed Calendar — only the native input INSIDE it is the offender. The detail-panel fields (lines 315-336) sit inline in the form grid with no Popover, so migrating them means introducing a Button+Popover trigger there too.
- **Input primitive** (shadcn-primitive, token-compliant: true) — src/components/ui/input.tsx is token-clean; it's fine as the time sub-field of a datetime composite. The issue is using it with type=date/datetime-local, which hands rendering to the browser.
- **Button + buttonVariants** (shadcn-primitive, token-compliant: true) — src/components/ui/button.tsx exports buttonVariants — the recommended DateField trigger should be a variant="outline" Button showing the formatted date (via existing helpers formatDue/formatScheduled) so the closed state matches Select/other triggers.
- **Calendar primitive** (shadcn-primitive, token-compliant: false) — DOES NOT EXIST yet in src/components/ui/. This is the core deliverable: add via shadcn CLI (react-day-picker based), then token-route the generated classNames.

### Problems
- [high] **Scheduled field uses native `<input type="datetime-local">`, so clicking it opens the OS/browser datetime picker — OS-blue accent, OS font, square corners, spinner chrome — none of it on our tokens. This is the literal "default calendar widget" Maciej flagged.**
  - quote: The calendar widget is the default one. build one that will follow our styling rules.
  - at: src/features/tasks/ui/capture-modal.tsx:257-265; src/features/tasks/ui/task-detail-panel.tsx:317-324
  - cause: No Calendar primitive exists; the field delegates rendering to the browser's native datetime control which is unstyleable beyond the outer box.
- [high] **Due field uses native `<input type="date">` — same native-calendar bypass.**
  - quote: The calendar widget is the default one. build one that will follow our styling rules.
  - at: src/features/tasks/ui/capture-modal.tsx:276-284; src/features/tasks/ui/task-detail-panel.tsx:327-334
  - cause: Same: native date input delegates the popup calendar to the OS.
- [high] **Two MORE native date pickers the brief didn't list: the list-row inline Schedule and Due popovers. Any migration must include these or the app will have two different calendar UIs.**
  - quote: (found independently)
  - at: src/features/tasks/ui/task-row.tsx:546-555 (datetime-local, SchedulePopover); src/features/tasks/ui/task-row.tsx:605-614 (date, DuePopover)
  - cause: The same inline native-input pattern was copied into the row-level quick-edit popovers.
- [med] **datetime-local conflates date + time into one native control. A token-routed Calendar covers the date half only; without a paired time field the Scheduled fields lose time-of-day editing.**
  - quote: (found independently)
  - at: capture-modal.tsx:258, task-detail-panel.tsx:318, task-row.tsx:547
  - cause: Replacing a datetime-local with a date-only Calendar drops the time component unless a time input is added alongside.
- [med] **No `:focus-visible` ring on our terms and no token-routed selected/today/range states for the calendar — the native control shows the OS focus outline and OS-blue 'today' marker, violating the 'color is never the only signal / pink --ring everywhere' rules.**
  - quote: The calendar widget is the default one. build one that will follow our styling rules.
  - at: capture-modal.tsx:257-284; task-detail-panel.tsx:315-336; task-row.tsx:544-628
  - cause: Native control owns its own focus/selection styling; we can't route it through --ring / --primary.
- [med] **Inconsistent trigger surface: detail-panel date fields are bare inline inputs (in a 2-col grid) while capture-modal and task-row use Popover-wrapped pills/chips. Three visual treatments for the same data type.**
  - quote: (found independently)
  - at: task-detail-panel.tsx:315-336 vs capture-modal.tsx:250-285 vs task-row.tsx:530-629
  - cause: Each surface hand-rolled its own date affordance because there was no shared DateField/DateTimeField primitive to standardize on.
- [low] **Each native datetime-local keystroke/segment change fires patchTask (a network upsert) in capture-modal/task-row onChange (the detail panel correctly commits on blur). A Calendar 'select day' interaction is a single discrete event, which also fixes this incidental write-amplification.**
  - quote: (found independently)
  - at: capture-modal.tsx:262-264; task-row.tsx:551-554, 610-613
  - cause: onChange on a native datetime input fires per segment; a Calendar onSelect fires once per chosen day.

### Recommendations
- (M) **Add the shadcn Calendar primitive: run `bunx shadcn@latest add calendar` (installs react-day-picker + date-fns, scaffolds src/components/ui/calendar.tsx). Then token-route the generated classNames: month/caption text → text-foreground / text-sm; weekday + nav → text-muted-foreground; selected day → bg-primary text-primary-foreground rounded-md; today → ring-1 ring-ring (pink) NOT a chromatic fill; hover → hover:bg-accent; outside-month → text-muted-foreground/50; nav chevrons → lucide ChevronLeft/Right size-4. Strip any raw hex / arbitrary values the CLI emits. Card radius rounded-lg on the calendar container, controls rounded-md.**
  - why: This is the literal ask — replace the OS default with a calendar on our tokens. shadcn config is already present (new-york, lucide, cssVariables, ui→@/src/components/ui) so the CLI path works cleanly. react-day-picker + date-fns are currently ABSENT from package.json; the CLI adds them.
  - DS ref: shadcn Calendar (react-day-picker); tokens --primary/--primary-foreground (selected), --ring (today/focus), --accent (hover), --muted-foreground (chrome), --radius-md/--radius-lg, --text-sm
  - files: src/components/ui/calendar.tsx (new); package.json (react-day-picker, date-fns added by CLI)
- (M) **Add a thin composite `DateField` (date-only, for Due) and `DateTimeField` (Calendar + a small time Input, for Scheduled) — e.g. src/features/tasks/ui/date-field.tsx — each = Popover + outline Button trigger showing the formatted value via the existing helpers (formatDue/formatScheduled) and a Clear affordance. DateTimeField pairs the Calendar with one token-clean time `<Input>` (HH:mm) so datetime-local's time half is preserved. Keep the ISO<->local conversion logic that already lives in helpers.ts (toLocalInputValue/toDateInputValue and the `new Date(...).toISOString()` round-trips).**
  - why: Calendar alone is date-only; Scheduled needs time. A shared composite means all surfaces get one identical affordance and the conversion logic stays in one place instead of being re-implemented at six call sites.
  - DS ref: shadcn Popover + Button (variant=outline) trigger pattern, matching the Select trigger surface; Input primitive for the time sub-field; helpers.ts date formatters
  - files: src/features/tasks/ui/date-field.tsx (new); src/features/tasks/helpers.ts (reuse existing converters)
- (M) **Migrate all SIX call sites to the new fields. capture-modal.tsx: Scheduled InputPill 257-265 → DateTimeField, Due InputPill 276-284 → DateField. task-detail-panel.tsx: Scheduled 317-324 → DateTimeField, Due 327-334 → DateField (these become Button-triggered popovers in the form grid, replacing the bare inline inputs — keep commit-on-close semantics). task-row.tsx: SchedulePopover 546-555 → DateTimeField, DuePopover 605-614 → DateField (reuse their existing Popover open-state and MetaChip trigger).**
  - why: Brief named four sites; task-row.tsx has two more. Leaving any native input means the app ships two calendar UIs. Migrating all six is the only way to fully satisfy the critique.
  - DS ref: single DateField/DateTimeField primitive across all surfaces; bg-popover Popover host
  - files: src/features/tasks/ui/capture-modal.tsx:257-265,276-284; src/features/tasks/ui/task-detail-panel.tsx:315-336; src/features/tasks/ui/task-row.tsx:544-555,603-614
- (S) **Add the required Storybook story src/components/ui/calendar.stories.tsx (CLAUDE.md rule 5) with: a Default single-date story, a story with a preselected date, a disabled-days story, and one combined 'visual test' render showing default + selected + today + a date inside a Popover so the token surface is reviewable at a glance (matching the all-variants pattern in input.stories.tsx / select.stories.tsx).**
  - why: Rule 5 is hard-enforced: any new primitive in src/components/ui/ needs a co-located story. The visual-test render is how the reviewer confirms the token routing (no OS chrome) without running the full app.
  - DS ref: CLAUDE.md rule 5; existing *.stories.tsx visual-test convention (input/select/popover stories)
  - files: src/components/ui/calendar.stories.tsx (new)
- (S) **After migration, run `bun run typecheck` and the stylelint/lint pass to confirm no raw hex or arbitrary color/radius/spacing values leaked in from the CLI-generated calendar (react-day-picker default styles often ship arbitrary values), and delete now-dead helpers if any (toLocalInputValue/toDateInputValue stay — they're still used for ISO conversion).**
  - why: The shadcn calendar template historically emits some non-token classes; rule 1 & 2 are stylelint-enforced on PRs, so this must be clean before the work lands.
  - DS ref: CLAUDE.md hard rules 1 (no raw hex) & 2 (no arbitrary DS values), stylelint
  - files: src/components/ui/calendar.tsx; src/features/tasks/ui/*

### Open questions for Maciej
- Time-of-day input for Scheduled: pair the Calendar with a token-clean `<Input>` HH:mm field, or a small token-routed time dropdown (15-min steps), or keep a single native time spinner for the time half only? (Calendar handles the date; the time half still needs a decision.)
- Should the Calendar offer quick presets (Today / Tomorrow / Next week / This weekend) above the grid — Todoist/TickTick style — since the capture parser already understands those phrases, or keep it a bare grid to stay Linear-quiet?
- Week start + locale: hardcode Monday-start, or derive from the user's locale (the app currently uses `Intl.DateTimeFormat(undefined, …)` everywhere, i.e. system locale)?
- Should clearing a date stay a small text 'Clear' button (current task-row/capture pattern) or move to an X affordance on the trigger Button itself for consistency with the capture InputPill onClear?


## Tasks — Board view + cards (task-board-view.tsx, task-card.tsx)

Maciej is right on both counts. (1) Elevation is inverted: the center pane behind the columns is `bg-card` (neutral-900, oklch 0.14), the column body is `bg-muted/30` (≈oklch 0.15, barely above the pane), and each card is `bg-background` — pure black (oklch 0). The thing you pick up is the DARKEST surface in the stack, sitting on a lighter column on a lighter pane. That reads as a hole, not a raised card, which is exactly the "elevation reads weird / colors are off" complaint. It's also inconsistent with the sibling List view, whose rows are transparent-on-card. (2) The `GripVertical` dragger is genuinely useless: the entire card div already spreads the dnd-kit `listeners`, so the whole card is the drag source today. The grip is decorative (`aria-hidden`, no own listeners) — it doesn't gate the drag, it just adds noise and a wasted column slot. Removing it is safe: interactive children are already protected (the complete-toggle stops pointerdown, and the 8px PointerSensor activation distance preserves clicks).

### Components used
- **FeaturePanelsShell (center pane)** (bespoke, token-compliant: true) — feature-panels-shell.tsx:88 — CENTER_WRAPPER uses bg-card. This is the canvas the board columns sit on. Correct on its own, but it makes the board's bg-background cards read as cut-out holes since background (oklch 0) is darker than card (oklch 0.14).
- **BoardColumn body** (raw-html, token-compliant: false) — task-board-view.tsx:257 — bg-muted/30 idle, bg-accent/50 + ring-ring/40 on drop-over. The /30 opacity is an arbitrary alpha bypass of the token system, and muted-over-card barely separates from the pane (≈oklch 0.15 vs 0.14).
- **TaskCard** (raw-html, token-compliant: false) — task-card.tsx:84 — bg-background (pure black) on a bg-card pane is an inverted elevation step. Should be the lightest surface in the column stack, not the darkest. Also re-declares role=button (line 78) which dnd-kit attributes (line 76) already set.
- **DragOverlay card** (raw-html, token-compliant: false) — task-board-view.tsx:198 — the lifted card uses bg-background + shadow-lg, so the dragged clone is also pure-black-on-card. Must move in lockstep with whatever surface the resting card adopts.
- **GripVertical handle** (third-party, token-compliant: true) — task-card.tsx:90-94 — lucide icon, aria-hidden, opacity-0 group-hover:opacity-100. Decorative only; carries no listeners. This is the 'useless dragger' Maciej flagged. Delete it.
- **Badge (bucket tag)** (shadcn-primitive, token-compliant: true) — task-card.tsx:296 — variant=secondary, fine. Not part of the defect.
- **CompleteToggle / LevelDots / BlockedMarker** (bespoke, token-compliant: true) — Shared from task-row.tsx. CompleteToggle is wrapped in a span with onPointerDown stopPropagation (CardBody:235) — this is what keeps it clickable inside the draggable card, and is the pattern any other interactive child must follow.

### Problems
- [high] **Inverted elevation ladder: card (bg-background, oklch 0) is darker than its column (bg-muted/30, ≈oklch 0.15) which is darker-to-equal vs the center pane (bg-card, oklch 0.14). The element you pick up is the darkest surface in the stack, so cards read as punched-out holes instead of raised tiles. This is the core of 'the elevation reads weird' and 'something is wrong with the colors'.**
  - quote: something is wrong with the colors there. The elevation reads weird
  - at: src/features/tasks/ui/task-card.tsx:84 (bg-background) + src/features/tasks/ui/task-board-view.tsx:257 (bg-muted/30 column) + src/components/app/feature-panels-shell.tsx:88 (bg-card pane)
  - cause: The board was authored as if it sat on the app canvas (bg-background) like a standalone Trello board, but FeaturePanelsShell wraps the center in bg-card. Cards picked bg-background to contrast a background pane that isn't there — instead they contrast DOWNWARD against a card pane, inverting the ladder.
- [med] **Column fill uses an arbitrary opacity token (bg-muted/30) that both bypasses the design-system surface tokens and lands too close to the pane color to register as a distinct container. The drop-target column barely separates from the canvas behind it.**
  - quote: The center panel in taskboard mode looks off
  - at: src/features/tasks/ui/task-board-view.tsx:257
  - cause: bg-muted/30 is a guessed alpha rather than a named surface step. muted (oklch 0.18) at 30% over card (0.14) computes to ≈0.15 — a 1% lightness delta, effectively invisible as a column boundary.
- [med] **The drag handle (GripVertical) is non-functional decoration. The whole card already carries the dnd-kit listeners (task-card.tsx:77), so the grip neither initiates nor gates the drag. It consumes a fixed gutter on every card and adds visual noise for zero behavior.**
  - quote: The dragger on board view is useless, the whole task is draggable area
  - at: src/features/tasks/ui/task-card.tsx:89-94
  - cause: Listeners were spread on the card root, not on the grip, but the grip was kept as a visual affordance. It implies a handle-only drag that doesn't exist — misleading and wasteful.
- [low] **Attribute collision on the card root: dnd-kit's {...attributes} (line 76) sets role="button", tabIndex, and aria-roledescription, then line 78 re-declares role="button" and line 79 adds aria-pressed. The hard-coded role wins by JSX order, but aria-roledescription="draggable" + aria-pressed on the same node is a muddled a11y contract (a toggle-button that's also a draggable that's also the select target).**
  - quote: (found independently)
  - at: src/features/tasks/ui/task-card.tsx:76-80
  - cause: The card triple-duties as drag source, select target, and pressed-state toggle. The roles were layered without reconciling what the element actually announces.
- [low] **Card selected state (border-ring + bg-accent, line 84) collides with the column's drop-over state (bg-accent/50 + ring-ring/40, board-view:257). A selected card inside a column being dragged-over produces accent-on-accent with competing rings — the selection and the drop affordance become indistinguishable.**
  - quote: something is wrong with the colors there
  - at: src/features/tasks/ui/task-card.tsx:84 + src/features/tasks/ui/task-board-view.tsx:257
  - cause: Both selection and drop-over reach for accent + ring with no reserved channel to keep them separable.
- [med] **Board surfaces are inconsistent with the sibling List view. List rows are transparent-on-card with hover:bg-accent/60 (task-row.tsx:135); Board introduces opaque column fills and pure-black cards. Switching List↔Board (same data, same pane) visibly changes the whole color field, which reinforces the 'something is off' read.**
  - quote: The center panel in taskboard mode looks off
  - at: src/features/tasks/ui/task-board-view.tsx:257, task-card.tsx:84 vs src/features/tasks/ui/task-row.tsx:135
  - cause: The two views were styled against different mental models of the pane (canvas vs card) and never reconciled.

### Recommendations
- (M) **Fix the elevation ladder so it climbs canvas → column → card. Concretely: the center pane is already bg-card (the canvas for this view). Make columns the recessed well — bg-muted (no /30 alpha) — and make cards the raised surface — bg-card with a border-border hairline, or bg-popover if you want one more lightness step than the pane. Net ladder in oklch: pane 0.14 → column 0.18 (well) → card stays card-or-popover with a hairline that does the lifting. Critically: STOP using bg-background on cards; pure black on a card pane is the inversion. Update the DragOverlay clone (board-view:198) to the same new card surface so the lifted card matches.**
  - why: Restores a legible top-down read: the thing you grab is the brightest tile, the column is a quiet trough, the pane recedes. Kills the 'cards are holes' effect and the arbitrary /30 alpha bypass in one move.
  - DS ref: Token quick-ref: bg-muted = input well / recessed; bg-card / bg-popover = raised surface; border-border = the hairline that signals lift in dark mode (shadows are near-invisible at oklch 0.14). DESIGN_SYSTEM.md elevation note: dark-mode shadows are subtle, so separation comes from lightness steps + hairlines, not drop shadows.
  - files: src/features/tasks/ui/task-card.tsx:81-87; src/features/tasks/ui/task-board-view.tsx:253-258; src/features/tasks/ui/task-board-view.tsx:196-208
- (M) **Pick ONE elevation story and apply it consistently. Recommended (Linear-leaning, matches the List view): columns transparent or bg-muted/-trough, cards quiet — bg-card + border-border, no fill change on selection beyond the existing left accent-bar pattern the List uses (task-row.tsx:142-144). Avoid stacking bg-background-on-card anywhere. If Maciej prefers a more Trello-like board with visible card tiles, go bg-popover cards in bg-muted columns — but don't mix the two.**
  - why: The board currently reads heavier and more chromatic than the List for the same data, which is jarring on view-switch. One ladder makes Board feel like the same app as List.
  - DS ref: References: LINEAR (quiet, hairline structure) — the List view already embodies this; the Board should match. Reuse the selected-marker accent bar from task-row.tsx:142-144 instead of bg-accent flood to free up accent for the drop-over state.
  - files: src/features/tasks/ui/task-card.tsx:81-87; src/features/tasks/ui/task-board-view.tsx:253-258
- (S) **Delete the GripVertical handle (and its import). The whole card is already the drag source via the listeners spread on the root (task-card.tsx:77), so removing the grip changes no behavior — it only removes dead visual weight and the implied handle-only-drag affordance. Reclaim the freed gutter so the checkbox + title align flush with the card's left padding.**
  - why: Directly executes Maciej's ask: 'the whole task is draggable area' is already true, so the handle is pure noise. Removal is zero-risk because no listeners live on the grip.
  - DS ref: TODOIST/TICKTICK content-first cards: no chrome handles, the card itself drags. cursor-grab on the card (already present, task-card.tsx:85) is the only drag affordance needed.
  - files: src/features/tasks/ui/task-card.tsx:6 (remove GripVertical import); src/features/tasks/ui/task-card.tsx:89-94 (remove the handle block)
- (S) **After removing the grip, audit interactive children inside the card for the stopPropagation pattern so clicks survive the now-fully-draggable surface. The complete-toggle already does this (CardBody:235 wraps it in a span with onPointerDown stopPropagation). Apply the same to any clickable meta that should NOT start a drag — currently the TagChipList onTagClick (CardBody:301) and the bucket Badge are inside the card; with an 8px PointerSensor activation distance (board-view:118) a click still registers, but verify tag-filter clicks and the context-menu trigger after the change.**
  - why: Making the whole card the drag area is fine as long as taps on children still fire. The pattern is already established in the file; just confirm coverage so nothing regresses to 'drag swallows my click'.
  - DS ref: dnd-kit PointerSensor activationConstraint.distance (already 8px) is the standard click-vs-drag discriminator; pair it with onPointerDown stopPropagation on must-click children (existing CompleteToggle pattern).
  - files: src/features/tasks/ui/task-card.tsx:295-301; src/features/tasks/ui/task-card.tsx:232-237
- (S) **Reconcile the role attributes on the card root: don't re-declare role="button" (line 78) on top of dnd-kit's {...attributes}. Either spread attributes and let dnd-kit own the draggable role, or spread attributes then explicitly override aria-roledescription if 'draggable' is wrong for a tile that's primarily a select target. Keep aria-pressed only if the card genuinely toggles; otherwise use aria-selected to match the List row (task-row.tsx:130).**
  - why: A node announcing button + draggable + pressed + selected simultaneously is ambiguous for AT. Aligning to the List row's aria-selected model keeps Board and List consistent for screen readers.
  - DS ref: Accessibility rule (CLAUDE.md): interactive elements have clear roles; mirror the List view's role=row / aria-selected contract for parity.
  - files: src/features/tasks/ui/task-card.tsx:74-80
- (S) **Replace the drop-over treatment so it stays distinct from card selection. Suggest the column gets a brightened well + ring on drop-over (e.g. column → bg-accent + ring-ring) while selected cards keep the quiet left accent-bar (not bg-accent flood). That reserves the accent-flood channel for 'this column will receive the drop' and the accent-bar channel for 'this card is selected'.**
  - why: Today a selected card inside a hovered column is accent-on-accent with two rings; separating the channels keeps both signals readable mid-drag.
  - DS ref: hover:bg-accent is the row/drop-target fill in the token quick-ref; the selected-bar (bg-primary, task-row.tsx:143) is the orthogonal selection signal. Use one for each.
  - files: src/features/tasks/ui/task-board-view.tsx:255-258; src/features/tasks/ui/task-card.tsx:84

### Open questions for Maciej
- Board card aesthetic: Linear-quiet (cards transparent/bg-card with hairline, columns transparent — board reads almost like the List with columns) OR Trello-tiles (clearly raised bg-popover cards in bg-muted column wells)? Both are token-clean; they imply different ladders. The recommendations above default to the Linear-quiet read to match the sibling List view — confirm that's the direction.
- Should columns have any fill at all, or be transparent on the bg-card pane with only the count header + drop-over highlight marking them? Transparent columns are the most Linear/minimal-chrome answer but reduce the visual 'lanes' feeling some users expect from a board.
- Selection model parity: should a board card use the List view's left accent-bar + aria-selected (recommended for consistency), or keep its own bg-accent + border-ring flood? This affects whether Board and List feel like one system.
- With the grip gone and the whole card draggable, do you want a visible drag affordance on hover at all (e.g. cursor-grab is already there), or is hover-cursor-only sufficient? TickTick/Todoist use cursor-only; confirm no handle is wanted back in any reduced form.


## Tasks → Execute mode: current-task card ("Now card"), pomodoro/duration timer, time-tracking — src/features/tasks/ui/execute-view.tsx

The Execute "Now card" is a center-aligned focus card whose hierarchy is inverted for actually doing work: the timer is the loudest element (a 60px `text-6xl` clock plus a mode toggle and two transport buttons stacked vertically), while task title, meta and description sit above it and the queue context below. Maciej's core complaints all trace to that inversion plus three structural issues: (1) the timer dominates space that task details should own; (2) there is no real "time spent" tracker — only a countdown — and the "duration" estimate is conflated with elapsed time; (3) the always-on dashed "Linked" placeholder card consumes a full block even when nothing is attached; and (4) the x/y completed label was moved from the bottom up into the page header. There is also one hard token-scale bypass (`text-6xl` is not in the type scale) and the pomodoro is hardcoded to 25/5 with no settings. Time-spent persistence has no backing field today, so the actual tracker is a schema dependency to flag.

### Components used
- **Button** (shadcn-primitive, token-compliant: true) — Used for Done/Pause/Resume/Reset and EndSummary. Compliant. Reset is icon-only (line 181) with only aria-label and no Tooltip — CLAUDE.md a11y rule requires icon-only buttons to carry a Tooltip with copy. Same gap will apply to any new compact transport buttons.
- **ModeToggle (bespoke tablist)** (bespoke, token-compliant: false) — Hand-rolled role=tablist with bg-muted/bg-background pill (lines 210-229). Token-routed colors but it duplicates what the installed Tabs primitive (src/components/ui/tabs.tsx) provides. Rule 4/Primitives-wrap-shadcn: prefer Tabs, or keep bespoke but justify. Also uses `font-display text-xs` for a control label — acceptable per the typography role, but `rounded-sm` pill inside `rounded-md` muted track is fine.
- **RelationsPlaceholder (bespoke)** (bespoke, token-compliant: true) — Dashed-border card, token colors fine. The problem is behavioral not token: it renders unconditionally (line 75) even with zero linked items, taking a full block.
- **Queue (bespoke list)** (bespoke, token-compliant: true) — Row list with --row-h min-height via inline style (line 273) — allowed (runtime geometry, not a DS color/spacing override). Token-compliant.
- **Timer clock display** (raw-html, token-compliant: false) — `<span className="font-display text-6xl tabular-nums">` (line 170). `text-6xl` is NOT in the token type scale (tokens.css tops out at --text-5xl/48px); it resolves to Tailwind's default 60px and bypasses the data-text-size customization axis. Token-scale violation.
- **Tabs / Switch / Select / Popover / Input / RadioGroup / Tooltip / Separator** (shadcn-primitive, token-compliant: true) — All installed in src/components/ui/ and available for the recommended timer-settings popover, compact tracker, and duration field. Not currently used in this file.

### Problems
- [high] **Card hierarchy is inverted for doing the task: the timer block is the visual climax. The clock is `font-display text-6xl` (60px), stacked under a mode toggle and over two transport buttons — a 4-row vertical timer tower (lines 168-185) that out-weighs the 24px `text-2xl` title (line 153) and the muted meta/description above it. The eye lands on the countdown, not on what to do.**
  - quote: The current task card in execute mode is still chaotic. find the best way to display everything on that card best for the general user
  - at: src/features/tasks/ui/execute-view.tsx:151-185
  - cause: Layout is a single centered column that gives the timer the largest type token and the most vertical real estate (mt-8 gap above it, full sub-stack). Title/meta/description are compressed above; there is no zoning that separates 'what to do' from 'tooling'.
- [high] **The timer is oversized and steals space from task details. `text-6xl` clock + mode toggle + two-button transport row occupy roughly the middle third of the card, pushing description to a cramped `max-w-md` muted paragraph and leaving no room for richer task detail.**
  - quote: the overly large timer didn't feel right taking space from more important task details
  - at: src/features/tasks/ui/execute-view.tsx:168-185
  - cause: Clock uses the 60px display size and the whole timer is a centered hero block rather than a compact secondary control. `text-6xl` also bypasses the token scale (max is text-5xl/48px), so it doesn't even shrink under the dense/compact text-size settings.
- [high] **There is no real time-tracking of time SPENT. The card only offers a countdown (pomodoro phase clock, or a duration countdown from the estimate). Maciej explicitly wants to track elapsed time spent on the task — that capability is entirely absent. `useExecuteTimer` only ever counts down (lines 291-337).**
  - quote: There should be an option to track time spent on a task there
  - at: src/features/tasks/ui/execute-view.tsx:291-337
  - cause: The timer was designed as a focus countdown, not a stopwatch. No start/stop accumulation of elapsed seconds, no display of total time spent, no persistence.
- [high] **'Duration' is conflated with the live timer and behaves like a countdown, not an estimate. In 'duration' mode the card counts `task.durationMinutes` down to zero and stops (lines 321-323), so the estimate reads as a live ticking thing rather than a planning number. There is no place on the card to SET or even clearly SEE the duration estimate distinct from elapsed time.**
  - quote: duration feels more like what I described than what it is
  - at: src/features/tasks/ui/execute-view.tsx:14,132-133,291-323
  - cause: `TimerMode = 'pomodoro' | 'duration'` overloads one clock for two unrelated concepts. Duration (an estimate field on the Task model) is rendered as a countdown timer; time actually spent is never modeled. The two ideas need to be separated: estimate = a small editable field; spent = a stopwatch.
- [med] **Pomodoro is hardcoded and has no settings. `POMODORO_WORK = 25*60` and `POMODORO_BREAK = 5*60` are module constants (lines 16-17); there is no long-break interval, no auto-start toggle, no sound, no way to change work/break length. The work→break→work cycle is infinite with no notion of 'rounds' (lines 313-320).**
  - quote: the pomodoro timer should have more features or settings - it's very limited now
  - at: src/features/tasks/ui/execute-view.tsx:16-17,313-324
  - cause: MVP timer hardcodes the canonical 25/5. No settings surface, no persistence of preferences, no long-break-every-N logic, no completion signal.
- [med] **The x/y completed label was moved up into the page header. It now sits top-right next to the 'Focus' heading (lines 51-58) as `{doneCount} / {total} Done`. Maciej says it read better at the bottom of the card before this move.**
  - quote: The x/y completed label was better at the bottom before we moved it
  - at: src/features/tasks/ui/execute-view.tsx:51-58
  - cause: Progress was relocated to the header during a prior pass. It competes with the page title for the eyebrow slot and is far from the action it describes (Done, next). It belongs as a quiet footer under the card / queue.
- [med] **The 'Linked' relations section always renders, even when empty. `<RelationsPlaceholder />` is rendered unconditionally (line 75) as a full dashed-border card with an explanatory paragraph (lines 233-245), so a block of chrome with zero content sits between the task card and the queue at all times.**
  - quote: The linked section below main task shouldn't be there or should be much smaller when there is nothing actually attached
  - at: src/features/tasks/ui/execute-view.tsx:75,233-245
  - cause: It's a placeholder with no data wiring and no empty-state branch — it has nothing to conditionally hide on because relations aren't passed in yet. It defaults to a full-size 'coming soon' card instead of collapsing or disappearing.
- [low] **Token-scale bypass: `text-6xl` on the clock is not a defined size token.**
  - quote: (found independently)
  - at: src/features/tasks/ui/execute-view.tsx:170
  - cause: tokens.css defines --text-2xs … --text-5xl only. `text-6xl` falls through to Tailwind's built-in 3.75rem and is excluded from the data-text-size axis, so the densest setting won't shrink it. Violates 'no values outside the token scale' for typography.
- [low] **Icon-only Reset button lacks a Tooltip. Line 181 has aria-label but no Tooltip wrapper; CLAUDE.md a11y rule requires icon-only buttons to carry a Tooltip with copy.**
  - quote: (found independently)
  - at: src/features/tasks/ui/execute-view.tsx:181-183
  - cause: Tooltip primitive exists (src/components/ui/tooltip.tsx) but wasn't applied. Will compound as more compact icon controls are added to the timer.
- [med] **Meta is a flat dot-separated run that buries the load-bearing details. Up to 8 chips (parent, blocked-note, bucket, priority, energy, scheduled, due, ~duration) render in one wrapping muted `text-xs` line (lines 137-163). The estimate ('~25 min') sits at the end of the same undifferentiated run as priority/energy — no weighting toward what helps you DO the task.**
  - quote: find the best way to display everything on that card best for the general user
  - at: src/features/tasks/ui/execute-view.tsx:137-163
  - cause: All meta is flattened to equal-weight muted chips with no grouping (when/what-kind vs. context). Combined with center alignment it reads as a wall of small grey text rather than a scannable detail block.

### Recommendations
- (M) **Re-zone the Now card into a clear top-down 'doing' hierarchy and demote the timer to a compact secondary strip. Proposed order: (1) TITLE — keep font-display but left-align and use text-2xl/3xl as the single loudest element; (2) META — a tight grouped row directly under the title (when/where: scheduled · due · bucket on one line; what-kind: priority · energy as small chips, optionally only show non-null); (3) DESCRIPTION — full-width body text, not max-w-md center; (4) a thin TIMER STRIP (see next rec); (5) PRIMARY ACTION 'Done, next' + Skip/Do last. Switch the card from `text-center` to left-aligned content (center alignment is what makes it read as a 'hero' rather than a work surface; Linear/Todoist task surfaces are left-aligned content-first).**
  - why: Puts what-to-do first and tooling second, directly answering 'most optimized for task completion' and 'don't let the timer take space from task details'. Left-aligned, grouped meta reads as a scannable detail block instead of a centered wall of grey.
  - DS ref: font-display title (display role), text-foreground / text-muted-foreground, .tag-chip / data-label for priority+energy chips per tokens.css §13b, card stays rounded-lg border-border. References: Linear/Todoist content-first rows.
  - files: src/features/tasks/ui/execute-view.tsx:151-166 (card shell + title/meta/description); src/features/tasks/ui/execute-view.tsx:137-148 (meta assembly — split into when/what-kind groups)
- (M) **Compact the timer into a single horizontal strip. Replace the 4-row tower (mode toggle / 60px clock / phase label / button row) with one row: [mode segmented control] [clock at ~text-2xl, tabular-nums] [phase pill] [Play/Pause] [Reset] [settings gear]. Drop the clock from text-6xl to a token size (text-2xl or text-3xl). Give the strip a quiet bg-muted/30 or a hairline top border (border-t border-border) so it reads as a utility band, not the climax.**
  - why: Directly fixes 'overly large timer' and reclaims vertical space for task detail while keeping the timer one glance away. A horizontal utility strip is the Toggl/TickTick pattern and matches the 'quiet chrome' direction.
  - DS ref: Replace text-6xl with text-2xl/text-3xl (token scale); bg-muted or border-t border-border; Tabs primitive (src/components/ui/tabs.tsx) for the mode segmented control instead of the bespoke ModeToggle.
  - files: src/features/tasks/ui/execute-view.tsx:168-185 (timer block); src/features/tasks/ui/execute-view.tsx:210-229 (ModeToggle → Tabs or compact segmented)
- (L) **Separate 'duration' (estimate) from 'time spent' (actual). Make three distinct things on the card: (a) a small inline DURATION ESTIMATE field — show '~25 min' as an editable chip near the meta (click → small Input/Select in a Popover, or stepper) that writes task.durationMinutes via api.patchTask; (b) a TIME SPENT stopwatch in the timer strip — a start/stop control that ACCUMULATES elapsed seconds and shows total spent (e.g. 'Spent 0:42'); (c) keep POMODORO as a separate focus mode. Recast the mode control as Pomodoro | Stopwatch (spent) rather than pomodoro | duration. The estimate should never count down; only the stopwatch and pomodoro tick.**
  - why: This is the heart of the critique: Maciej wants real time-tracking and a duration that behaves like the estimate he described, not a countdown. An editable estimate field + a separate spent stopwatch makes both concepts legible and stops overloading one clock.
  - DS ref: Input (src/components/ui/input.tsx) or Select inside Popover (src/components/ui/popover.tsx) for the estimate; data-label / .tag-chip for the estimate chip; api.patchTask({durationMinutes}) as already used in task-detail-panel.tsx:174. Stopwatch accumulation lives in useExecuteTimer.
  - files: src/features/tasks/ui/execute-view.tsx:14 (TimerMode type); src/features/tasks/ui/execute-view.tsx:132-148 (mode + meta + estimate chip); src/features/tasks/ui/execute-view.tsx:291-337 (useExecuteTimer — add elapsed/stopwatch accumulator); src/features/tasks/ui/tasks-plan-view.tsx:367-376 (thread a patchTask + persist-time-spent callback into ExecuteView)
- (L) **Add a Pomodoro settings popover behind a gear icon in the timer strip. Settings: work length, short-break length, long-break length, long-break interval (every N pomodoros), auto-start breaks (Switch), auto-start next pomodoro (Switch), and completion sound on/off (Switch). Show a small 'round N of M' indicator next to the phase pill so the long-break cycle is legible. Persist these as appearance/timer prefs (same data-* / prefs pattern used for appearance) so they survive sessions; settings are per-user, not per-task.**
  - why: Answers 'pomodoro should have more features or settings — very limited now' with a concrete, conventional feature set, housed in a non-intrusive popover so it doesn't add chrome to the card.
  - DS ref: Popover (src/components/ui/popover.tsx) container; Input/Select for lengths; Switch (src/components/ui/switch.tsx) for auto-start + sound; Separator between groups; gear is an icon Button with a Tooltip (src/components/ui/tooltip.tsx). Replace hardcoded POMODORO_WORK/BREAK constants with prefs.
  - files: src/features/tasks/ui/execute-view.tsx:16-17 (constants → defaults); src/features/tasks/ui/execute-view.tsx:291-337 (useExecuteTimer reads settings + long-break interval + round count + onComplete sound); new: a small TimerSettingsPopover component (co-located in this file or src/features/tasks/ui/)
- (S) **Move the x/y completed label back to the bottom. Remove it from the page header (lines 53-57) and render it as a quiet footer under the card+queue (e.g. centered `text-xs text-muted-foreground tabular-nums` 'doneCount / total Done'), restoring the prior placement. Keep just 'Focus' in the header.**
  - why: Directly restores the placement Maciej preferred ('better at the bottom before we moved it') and frees the header eyebrow slot.
  - DS ref: text-xs text-muted-foreground tabular-nums; sentence/count casing 'n / m Done' per DESIGN_SYSTEM.md Casing section.
  - files: src/features/tasks/ui/execute-view.tsx:51-58 (remove from header); src/features/tasks/ui/execute-view.tsx:60-77 (add as a footer below Queue inside the max-w-2xl column)
- (S) **Make the 'Linked' section conditional and small when empty. When there are zero linked items, render nothing (or at most a single quiet inline affordance like a small 'Link items' ghost button / a one-line muted hint at text-2xs), not a full dashed card with a paragraph. When relations exist, render the compact list. Gate on a passed-in relations/links count; for this client-only pass, default to hidden since no data is wired yet.**
  - why: Directly fixes 'the linked section shouldn't be there or should be much smaller when there is nothing actually attached'. Removes a permanent empty block between the task and the queue.
  - DS ref: Conditional render; if a minimal affordance is kept, use a ghost Button (size sm) or text-2xs uppercase eyebrow per the section-label convention. No dashed full card.
  - files: src/features/tasks/ui/execute-view.tsx:75 (gate the render); src/features/tasks/ui/execute-view.tsx:233-245 (RelationsPlaceholder → empty returns null / minimal affordance)
- (S) **Replace text-6xl with a token size and wrap the icon-only Reset (and any new icon controls) in a Tooltip.**
  - why: Closes the only hard token-scale bypass on this surface and the icon-button-without-tooltip a11y gap, so the timer scales with the data-text-size axis and meets the a11y rule.
  - DS ref: text-2xl/text-3xl from the token scale (no text-6xl); Tooltip primitive (src/components/ui/tooltip.tsx) for icon-only Button per CLAUDE.md a11y.
  - files: src/features/tasks/ui/execute-view.tsx:170 (text-6xl → token size); src/features/tasks/ui/execute-view.tsx:181-183 (Reset → Tooltip)

### Open questions for Maciej
- Time-spent persistence is a schema dependency: the Task model and runtime have no time-spent / time-entries field (model.ts has durationMinutes only; runtime.web.ts maps duration_minutes only — no time_spent/tracked column). Should this session ship the stopwatch as client-only (elapsed lost on reload / mode switch), or do we add a timeSpentSeconds field (or a task_time_entries table) + a tasks.track_time intent-op? Recommend client-only display this pass and flag the field as follow-up work.
- Should time-spent be a single accumulated total per task, or a log of individual work sessions (start/stop entries with timestamps)? The latter is richer (and matches a real time-tracking module) but is meaningfully more schema + UI. Pick the model before building the tracker.
- Are Pomodoro timer preferences global (one setting for the user, in Settings → Appearance/Focus) or adjustable inline per focus session? Recommend global persisted prefs with an inline popover that edits those same prefs — confirm that's the intended scope.
- Mode naming/scope: should the timer offer three explicit modes (Pomodoro | Stopwatch/Time-spent | plain countdown-to-estimate), or just two (Pomodoro | Time-spent) with the duration estimate as a static editable chip rather than a runnable mode? The audit recommends the two-mode + static estimate model; confirm.
- When a pomodoro/duration completes, what is the completion signal given desktop context — sound only, an OS notification, both, and does it respect prefers-reduced-motion / a global mute? Needs a decision before wiring the 'sound' setting.


## Execute mode — "Today" labeling + queueing UX (Tasks module)

The "Today" framing is hardcoded across the whole commit/execute surface — the rail selection label, the Sunrise (sunrise/morning) icon, every "Commit to today"/"Remove from today"/"Committed for today" string, and the spec's committed_for(date) model. Maciej is right that the sunrise icon and "today" wording impose a once-a-day, morning-planning mental model that conflicts with the spec's own revised intent ("a reusable batch runner — run a committed batch whenever you sit down to focus, not just once each morning"). The good news: the underlying model is date-keyed (committed_for = a date), so this is a UI rename, not a model change — most directions keep committed_for intact. On friction: committing is reachable today ONLY via right-click context menu on rows/cards and a full-width button buried at the bottom of the detail panel; there is no hover quick-action or visible affordance on the row itself. A 't' keyboard shortcut exists but is undiscoverable. Notably the detail-panel subtask row already ships the exact hover quick-action pattern (a Sunrise button fading in on group-hover) that should be promoted to the main TaskRow/TaskCard as the primary low-friction path. No token/hardcoded-color violations were found in these files — the surface is clean on DS hard rules; the issues are semantics and interaction, not styling.

### Components used
- **BucketRail SelectionRow (Today)** (bespoke, token-compliant: true) — bucket-rail.tsx:117-124 — 'Today' label + Sunrise icon, count = committedCount. Token-clean (bg-accent/text-muted-foreground), but the label+icon are the primary naming offenders.
- **ModeToggle (Plan/Execute)** (bespoke, token-compliant: true) — bucket-rail.tsx:251-285 — segmented tab control. 'Execute' is the mode label; relevant to the naming question because Execute mode's heading is separately 'Focus' (execute-view.tsx:52), so the vocabulary is already inconsistent (Execute toggle vs Focus heading vs Today queue vs Up next).
- **ExecuteView NowCard / Queue** (bespoke, token-compliant: true) — execute-view.tsx — heading 'Focus' (l.52), 'Up next' queue label (l.264), 'Queue cleared.'/'That's the queue.' end states (l.102). Already avoids 'today' here — proves a non-daily vocabulary is viable; the rail/rows just haven't followed.
- **TaskRow committed marker + context menu** (bespoke, token-compliant: true) — task-row.tsx:225-234 Sunrise marker w/ 'Committed for today' tooltip; 294-296 context-menu 'Commit to today'/'Remove from today'. Commit is ONLY in the right-click menu on the row — the friction Maciej calls out.
- **TaskCard committed marker + context menu** (bespoke, token-compliant: true) — task-card.tsx:116-118 context-menu commit; 262-271 Sunrise marker. Same right-click-only friction on the board.
- **ContextMenu (shadcn)** (shadcn-primitive, token-compliant: true) — components/ui/context-menu — correctly used as the secondary action surface. Keep it as secondary; it should not be the only path to commit.
- **TaskDetailPanel commit button** (shadcn-primitive, token-compliant: true) — task-detail-panel.tsx:473-484 — full-width Button (outline/secondary) 'Commit to today' w/ Sunrise. Discoverable but slow (requires opening the panel); good as a tertiary path.
- **TaskDetailPanel SubtaskRow commit (hover quick-action)** (bespoke, token-compliant: true) — task-detail-panel.tsx:695-719 — KEY PRECEDENT: a Sunrise button that is opacity-0 and fades in on group-hover/focus-visible, toggles commit, tooltip-labeled. This is exactly the hover quick-action Maciej wants; it just needs promoting to TaskRow/TaskCard. Reuse, don't reinvent.
- **lucide Sunrise icon** (third-party, token-compliant: true) — Used in 5 files as the 'committed/today' glyph. The sunrise/dawn metaphor is the visual half of the 'forces a daily frame' problem — it literally depicts morning. Primary icon to reconsider.
- **Kbd hint** (bespoke, token-compliant: true) — task-detail-panel export, used in task-list-view EmptyState (l.409) to hint 'c' to capture. No equivalent hint exists for 't' = commit — the commit shortcut is invisible.

### Problems
- [high] **The commit queue is labeled 'Today' with a Sunrise (sunrise/dawn) icon in the rail, imposing a once-a-day, morning-planning frame that contradicts the spec's own revised Execute model ('a reusable batch runner — run a committed batch whenever you sit down to focus, not just once each morning').**
  - quote: I don't like how the execution feature was labeled as 'today'. It unnecessarily forces a way of working - maybe they want to add batches of work and plan their executions more frequently during a day or night.
  - at: bucket-rail.tsx:117-124 (label 'Today' + Sunrise icon); spec docs/moduo-tasks-feature-spec.md:59 (model intent)
  - cause: The rail selection label was authored as a literal calendar word and paired with a dawn glyph, while the model underneath (committed_for = a date) only means 'the active batch for the current day' — the UI over-specifies a morning ritual the model never required.
- [med] **The commit vocabulary is inconsistent across the surface and all of it is time-of-day-coded: rail says 'Today', Execute heading says 'Focus', the queue sub-header says 'Up next', context menus say 'Commit to today'/'Remove from today', markers say 'Committed for today'. Four different words for one concept, three of them daily.**
  - quote: the labeling and icons are what I want to explore other directions for
  - at: bucket-rail.tsx:118-119; execute-view.tsx:52,264; task-row.tsx:228-232,295; task-card.tsx:117,265-269; task-detail-panel.tsx:482,702,716
  - cause: Labels were written per-component without a single shared vocabulary constant, so each surface drifted to its own word. No central place to rename means a future rename touches 5+ files inconsistently.
- [high] **Adding a task to the queue requires right-click → context menu on rows and cards. There is no visible or hover affordance on the row itself; the only always-visible control is a full-width button at the bottom of the detail panel (requires opening the panel).**
  - quote: Having to use right click to queue a task for execution feels like too much. It would be easier to line them up in a different way.
  - at: task-row.tsx:294-296 (context menu only); task-card.tsx:116-118 (context menu only); task-detail-panel.tsx:473-484 (panel button)
  - cause: Commit was wired through the context menu and detail panel but never given a row-level quick action, so the cheapest discoverable path is a two-step right-click. The board card has the same gap.
- [med] **A keyboard commit shortcut ('t') exists in List view but is completely undiscoverable — no Kbd hint, no tooltip, no legend. The EmptyState hints 'c' to capture but nothing surfaces 't'.**
  - quote: It would be easier to line them up in a different way.
  - at: task-list-view.tsx:226-228 ('t' → toggleCommit); contrast task-list-view.tsx:408-410 (only 'c' is hinted)
  - cause: The shortcut was added to the keydown handler without any affordance teaching it, so the fastest queueing path in the app is invisible to the user.
- [med] **The hover-reveal commit quick-action already exists for subtasks in the detail panel but was never promoted to the primary TaskRow / TaskCard, so the main lists are stuck with right-click while a nested surface has the better pattern.**
  - quote: Having to use right click to queue a task for execution feels like too much.
  - at: task-detail-panel.tsx:695-719 (pattern exists) vs task-row.tsx:222-280 / task-card.tsx:248-302 (pattern absent)
  - cause: The quick-action was built bottom-up for the subtask list and not lifted into the shared row/card meta cluster, leaving the highest-traffic surfaces on the slower interaction.
- [low] **The Execute end-of-queue copy ('Queue cleared.' / 'That's the queue.' / 'Back to Plan') and the Now-card 'Done, next' all read as a single daily run, reinforcing the once-a-day frame even inside Execute where the spec explicitly wants repeated sessions.**
  - quote: maybe they want to add batches of work and plan their executions more frequently during a day or night
  - at: execute-view.tsx:102 (end states), 104 ('Back to Plan'), 188-191 ('Done, next')
  - cause: Copy was written assuming one queue per day; it never anticipates re-entering Execute later with a freshly assembled batch, so it implies finality ('cleared', 'back to Plan') rather than 'session done, queue another'.

### Recommendations
- (S) **Rename the rail selection from 'Today' to a non-daily, batch-friendly label. Recommended primary: 'Queue' (neutral, matches the spec's existing 'commit queue' language and the Execute 'Up next' / 'Queue cleared' copy — zero new vocabulary). Strong alternates to put in front of Maciej: 'Up Next' (continuous, no time frame), 'Focus' (matches the Execute heading, unifies vocab), 'Now' (action-oriented). Keep committed_for(date) intact — this is a pure UI rename; 'Queue' still means 'the active batch for the current day' under the hood. Centralize the word in one constant (e.g. COMMIT_LABEL in helpers.ts) so all 5 files read from it.**
  - why: Decouples the UI from the morning-ritual frame Maciej rejects while preserving the date-keyed model and the daily auto-reset behavior. 'Queue' is the lowest-risk choice because the codebase already calls it a queue everywhere except the rail label.
  - DS ref: Reuse SECTION_LABEL / SelectionRow styling in bucket-rail.tsx (no visual change); introduce a shared label constant alongside the existing PRIORITY_LABELS/ENERGY_LABELS pattern in helpers.
  - files: src/features/tasks/ui/bucket-rail.tsx:118-119; src/features/tasks/helpers.ts (new COMMIT_LABEL constant); src/features/tasks/ui/tasks-plan-view.tsx:182 (scopeTitle 'Today')
- (S) **Replace the Sunrise icon as the committed glyph everywhere (rail, row marker, card marker, detail buttons). Recommended: a neutral queue/stack glyph — lucide 'ListChecks', 'Layers', 'CircleArrowRight', or 'Bolt'/'Zap' (action) / 'Target' (focus). Pick one glyph and pair it with the chosen label per direction: Queue→ListChecks or Layers; Up Next→CircleArrowRight/ArrowRightToLine; Focus→Target; Now→Zap/Bolt. Avoid Sunrise/Sun/Moon (all time-of-day-coded).**
  - why: The sunrise glyph literally depicts dawn — it is the visual half of the 'forces a way of working' complaint. A time-neutral icon lets the same queue read as a 2pm or 11pm batch without implying morning.
  - DS ref: lucide icon swap only; keep size-3.5/size-4 and text-foreground tokens unchanged (no color/spacing edits).
  - files: src/features/tasks/ui/bucket-rail.tsx:9,118; src/features/tasks/ui/task-row.tsx:12,229; src/features/tasks/ui/task-card.tsx:9,266; src/features/tasks/ui/task-detail-panel.tsx:19,481,712; src/features/tasks/ui/frontier-offer-dialog.tsx:1,80
- (M) **Promote the detail-panel subtask hover quick-action to the primary TaskRow and TaskCard as the PRIMARY queueing path: a commit toggle button in the right-aligned meta cluster that is opacity-0 by default and fades in on group-hover / focus-visible (and stays solid when committed). Reuse the exact pattern at task-detail-panel.tsx:695-719 — same Tooltip, same focus ring, same group-hover opacity. On the row it replaces/augments the current passive Sunrise marker (committed state = solid icon + tooltip 'In queue — click to remove'; uncommitted = ghost icon revealed on hover, tooltip 'Add to queue'). Keep the context menu item as the SECONDARY path (and keyboard 't' as tertiary).**
  - why: Directly answers 'right click feels like too much' with a one-click, discoverable, content-first affordance that already exists and is DS-blessed in this codebase — no new primitive, no new pattern, just lifting it to the high-traffic surfaces. Hover-reveal keeps rows quiet until needed (design principle 1).
  - DS ref: Reuse the SubtaskRow quick-action (task-detail-panel.tsx:695-719): shadcn Tooltip + button with focus-visible:ring-2 ring-ring, text-muted-foreground opacity-0 group-hover:opacity-100. Sits in the existing meta cluster (task-row.tsx:222-280).
  - files: src/features/tasks/ui/task-row.tsx:222-234 (add quick-action to meta cluster); src/features/tasks/ui/task-card.tsx:248-271 (add to card meta row); src/features/tasks/ui/task-detail-panel.tsx:695-719 (reference pattern)
- (S) **Make the 't' commit shortcut discoverable: add a Kbd hint next to the commit quick-action's tooltip (e.g. tooltip 'Add to queue · T') and add 'press T to queue' to the List EmptyState alongside the existing 'press c to capture' hint. Optionally surface it in any future keyboard-legend.**
  - why: The fastest queueing path already exists but is invisible; teaching it converts Maciej's 'line them up a different way' wish into muscle memory without new UI.
  - DS ref: Reuse the Kbd primitive (exported from task-detail-panel, already used in task-list-view EmptyState l.409) inside the TooltipContent.
  - files: src/features/tasks/ui/task-list-view.tsx:408-410 (EmptyState hint); src/features/tasks/ui/task-row.tsx (quick-action TooltipContent with Kbd)
- (L) **Consider a drag-to-queue affordance on the Board as a secondary path: dragging a card onto the 'Today/Queue' rail selection (or a dedicated queue drop-zone) commits it. The board already uses @dnd-kit (task-card.tsx useDraggable) and the rail rows are stable targets, so a useDroppable on the queue SelectionRow is incremental. Treat as nice-to-have after the hover quick-action lands.**
  - why: Gives the board the same 'line them up' ergonomics as the list without a context menu, leveraging dnd infrastructure already present. Lower priority than the hover button because it only helps Board users.
  - DS ref: @dnd-kit (already in task-card.tsx); add useDroppable to bucket-rail SelectionRow for the queue selection; show a quiet bg-accent drop highlight (no new tokens).
  - files: src/features/tasks/ui/bucket-rail.tsx:117-124 (queue SelectionRow as drop target); src/features/tasks/ui/task-card.tsx:67-71 (drag data already carries taskId)
- (S) **Soften the Execute end-of-queue and Now-card copy so re-running a batch later in the day reads naturally: e.g. 'Queue cleared — add another batch in Plan' instead of 'Back to Plan', and keep 'Done, next'. Align the heading: either rename the Execute heading from 'Focus' to match the chosen queue label, or vice-versa, so the app uses ONE word for the concept.**
  - why: Removes the residual 'one run per day' tone inside Execute and fixes the four-word vocabulary drift (Today/Focus/Up next/Queue) the audit found.
  - DS ref: No DS change; copy + reuse of the centralized COMMIT_LABEL constant from rec #1.
  - files: src/features/tasks/ui/execute-view.tsx:52,102,104,264

### Open questions for Maciej
- Naming direction — pick one for the queue concept and apply it everywhere (rail label, Execute heading, context-menu verbs, tooltips): (A) 'Queue' — neutral, already the codebase's internal word, lowest risk; (B) 'Up Next' — continuous, no time frame; (C) 'Focus' — unifies with the existing Execute heading; (D) 'Now' — action-forward. All keep the committed_for(date) model intact (UI rename only). Which word, and should the Plan/Execute toggle's 'Execute' label change to match?
- Icon direction — which glyph replaces Sunrise for the committed/queued state? Options pair with the name: Queue→ListChecks/Layers, Up Next→CircleArrowRight, Focus→Target, Now→Zap/Bolt. Confirm we want a single shared glyph across rail + row + card + detail panel + frontier dialog.
- Primary queueing affordance confirmation — proposal is a hover quick-action button on each row/card (promoting the existing subtask pattern) as PRIMARY, context menu as secondary, keyboard 't' as tertiary. Is the always-present-on-hover button the right default, or does Maciej prefer it always-visible (less quiet, more discoverable) given ADHD users may not discover hover?
- Should the committed/queued state stay represented by the SAME icon used for the action button (one glyph, two states via opacity/fill), or keep a distinct passive marker? Unifying them is simpler but means a committed row's marker is also its remove button.
- Drag-to-queue on the Board — is this worth the L-effort dnd work for v1, or defer until the hover quick-action ships and we see whether board users still feel friction?


## Task entry / capture modal (src/features/tasks/ui/capture-modal.tsx)

The modal is structurally correct and spec-aligned (borderless NL title + description, always-visible property pills the parser pre-fills, footer with create-more + submit), and it is token-clean — no raw hex, no arbitrary color/spacing/radius. Maciej is right that it reads worse than Linear, and the cause is almost entirely the property-pill row: every pill is a hand-rolled bordered chip (`border px-2 py-1 text-xs`), so the row looks like a strip of boxed form controls rather than Linear's single quiet line of borderless ghost buttons. Secondary issues: the title is undersized for a capture surface (text-lg/18px vs Linear's ~21-24px), the InputPill composition wraps a non-interactive div in pill styling with the clear-X nested inside it, and the duration presets are bespoke mini-buttons instead of a DS primitive. Fixing the pill treatment (borderless ghost, hairline/fill only on hover or when active) plus bumping the title size gets ~80% of the Linear feel with low effort.

### Components used
- **Dialog / DialogContent / DialogHeader / DialogTitle / DialogClose** (shadcn-primitive, token-compliant: true) — Properly used. DialogContent overridden with p-0 gap-0 overflow-hidden and a bespoke header/footer band — fine for a chromeless capture surface. top-[12%] translate-y-0 is arbitrary geometry (allowed). Dialog radius inherited as rounded-xl from the primitive (correct).
- **Input (title line)** (shadcn-primitive, token-compliant: true) — Stripped to borderless via border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 — correct Linear treatment. But forced to font-display text-lg; text-lg (18px) is too small for the primary capture field.
- **Textarea (description)** (shadcn-primitive, token-compliant: true) — Borderless treatment matches title. font-display text-sm is per spec (DESIGN_SYSTEM.md lists 'the capture title + description' as display role). min-h-9 rows={2} is fine.
- **ListPill (bucket/priority/energy/recurrence)** (bespoke, token-compliant: true) — Wraps DropdownMenu correctly, but the trigger uses a bespoke pillCls with a permanent border — this is the main visual divergence from Linear. z-index lifted via style={{zIndex:'var(--z-popover)'}} which is redundant now that --z-dropdown is also 70 (tokens.css §13).
- **InputPill (schedule/due/duration)** (bespoke, token-compliant: true) — Applies pillCls to a plain <div> (non-interactive) that contains a PopoverTrigger plus a clear-<button>. The whole div looks like a button but only sub-regions are clickable; the bordered shell makes it read heavier than the ListPills. The popover body uses raw <label> + Input with hardcoded h-8.
- **Popover / PopoverContent** (shadcn-primitive, token-compliant: true) — Used for the date/time/duration editors. w-auto p-3 override is fine.
- **DropdownMenu / DropdownMenuItem / DropdownMenuSeparator** (shadcn-primitive, token-compliant: true) — Correct usage for the choice pills. Check marks via lucide Check ml-auto is consistent with the row pattern elsewhere.
- **Button (Create)** (shadcn-primitive, token-compliant: true) — size=sm default variant — correct primary. Contains a <kbd> with only a CornerDownLeft icon; no visible shortcut hint text (Linear shows the actual key combo).
- **Switch (Create more)** (shadcn-primitive, token-compliant: true) — Correct. Footer label uses font-sans text-xs per spec (footer is secondary/body role).
- **Duration preset chips** (raw-html, token-compliant: true) — Hand-rolled <button> with border border-border px-1.5 py-0.5 text-xs and bare `rounded` (no scale token). Should be a DS primitive (Button size=sm variant=outline) or a ToggleGroup.
- **Attachment / clear-X buttons** (raw-html, token-compliant: true) — Icon-only buttons. Attachment button (line 341) has title+aria-label but no Tooltip primitive — CLAUDE.md a11y rule says icon-only buttons require a Tooltip. The clear-X inside InputPill (line 430) is aria-labelled but tiny (size-3) and uses bare `rounded`.

### Problems
- [high] **Every property pill carries a permanent border (pillCls: 'border px-2 py-1 text-xs ... border-border'), so the pill row reads as a strip of boxed form controls instead of Linear's single quiet line of borderless ghost buttons. This is the dominant reason the modal looks 'subpar / much worse than Linear.' Linear's create-issue pills are borderless: no fill or border at rest, hairline/subtle fill only on hover, and an accent-tinted fill only when set.**
  - quote: It's much worse than the one on linear in terms of visuals
  - at: src/features/tasks/ui/capture-modal.tsx:368-376 (pillCls), applied at 392, 419
  - cause: pillCls hardcodes `border` on both active and inactive states; the inactive branch is 'border-border text-muted-foreground hover:bg-accent' — a visible box at rest rather than a ghost chip.
- [med] **InputPill applies the pill shell (pillCls) to a static <div>, not a button, and nests the PopoverTrigger + clear-X as children. The whole pill looks pressable but only the trigger sub-span and the X are interactive; the border-wrapped composition also makes InputPills read visually heavier and slightly different from the ListPills (which are real button triggers). Inconsistent affordance across the same row.**
  - quote: The task entry modal is subpar
  - at: src/features/tasks/ui/capture-modal.tsx:405-441
  - cause: To keep an inline clear-X alongside a Popover trigger, the author wrapped both in a bordered div instead of composing a single button + a separate ghost clear control. Mixed interactive/non-interactive surface inside one pill-shaped box.
- [med] **The title field is font-display text-lg (18px). For the primary capture affordance this is undersized — Linear's create-issue title is ~21-24px and clearly the visual anchor of the dialog. Here the 18px title barely outranks the description and competes with the pill row, weakening hierarchy.**
  - quote: much worse than the one on linear in terms of visuals
  - at: src/features/tasks/ui/capture-modal.tsx:196
  - cause: text-lg chosen as the largest 'small heading' token; no larger display step applied. The capture field should use text-xl (20px) or text-2xl (24px) to be the unambiguous focal point.
- [med] **The header band has a redundant title row: a 'New task' DialogTitle + bottom border + a close X, stacked above the actual title input. Linear has no separate 'New issue' label band over its title field — it goes straight to the borderless title. The extra labelled, bordered header adds chrome the reference deliberately omits and pushes the real title down.**
  - quote: It's much worse than the one on linear
  - at: src/features/tasks/ui/capture-modal.tsx:173-182
  - cause: Header treated as a conventional dialog header (title + close) rather than a chromeless capture surface; the border-b adds a hairline the rest of the modal then has to live under.
- [low] **The Create button's shortcut affordance is a bare CornerDownLeft icon in a <kbd> with no visible key hint, and Cmd/Ctrl+Enter (the actual cross-field submit, line 156-161) is undocumented in the UI. Linear shows the explicit shortcut ('Create issue  ⌘↵' or 'C'). Users can't discover the modifier-submit.**
  - quote: much worse than the one on linear in terms of visuals
  - at: src/features/tasks/ui/capture-modal.tsx:354-359
  - cause: kbd renders only an enter glyph; the ⌘ modifier and the description-field submit shortcut are not surfaced.
- [low] **Duration preset chips are hand-rolled <button>s with 'border border-border px-1.5 py-0.5 text-xs' and a bare `rounded` class (no radius scale token). They duplicate a DS pattern (toggle/segmented control) without using a primitive, and `rounded` resolves to the default radius rather than an explicit control radius.**
  - quote: (found independently)
  - at: src/features/tasks/ui/capture-modal.tsx:322-333
  - cause: Inline preset buttons authored ad hoc; no ToggleGroup primitive reached for. `rounded` (unsized) is technically allowed but inconsistent with rounded-md used for controls elsewhere.
- [low] **The icon-only attachment button (Paperclip) relies on title+aria-label but has no Tooltip primitive, violating the CLAUDE.md a11y rule 'Icon-only buttons require a Tooltip with copy.' It's also a dead 'coming soon' control taking footer space.**
  - quote: (found independently)
  - at: src/features/tasks/ui/capture-modal.tsx:341-348
  - cause: native title attribute used instead of the shadcn Tooltip; placeholder feature shipped visible.
- [low] **Popover field editors use a raw <label className='... text-xs font-medium text-muted-foreground'> plus an Input with hardcoded h-8, rather than the DS label role / ctrl-h token. h-8 (32px) overrides the density-aware --ctrl-h the Input primitive sets, breaking the dense/compact density axis inside the popovers.**
  - quote: (found independently)
  - at: src/features/tasks/ui/capture-modal.tsx:256-257, 275-276, 312-313, 319
  - cause: className='h-8' on Input hard-pins height, defeating the Input primitive's style={{height:'var(--ctrl-h)'}}; labels are bespoke spans not a shared Label/FieldLabel.
- [low] **Pill label truncation uses max-w-40 (160px); long bucket names truncate aggressively while the dialog (max-w-xl, ~576px) has room. Minor but contributes to a cramped pill row.**
  - quote: (found independently)
  - at: src/features/tasks/ui/capture-modal.tsx:394, 423
  - cause: fixed max-w-40 on the label span regardless of available row width.

### Recommendations
- (S) **Restyle pillCls to a borderless ghost chip. At rest: no border, no fill, text-muted-foreground, gap-1.5 rounded-md px-2 (use --ctrl-h-sm for height). On hover: hover:bg-accent hover:text-foreground (hairline optional). When set/active: bg-muted text-foreground (or an accent-tinted fill), still no hard border. Drop the `border` from both branches entirely — this single change is the biggest visual win and is what makes the row read like Linear's quiet property line.**
  - why: The permanent border is the primary reason the row looks like boxed form controls instead of Linear's quiet ghost pills. Borderless-at-rest + fill-on-hover/active is the exact Linear pattern and is already how task-row.tsx meta chips behave.
  - DS ref: hover:bg-accent for hover fill, bg-muted for active fill, rounded-md control radius, text-muted-foreground -> text-foreground; mirrors src/features/tasks/ui/task-row.tsx:499 ('rounded px-1 py-0.5 ... hover:bg-muted')
  - files: src/features/tasks/ui/capture-modal.tsx:368-376
- (M) **Make each pill a real shadcn Button (variant='ghost' size='sm') as the trigger, instead of the bespoke pillCls on DropdownMenuTrigger/divs. For ListPill: <DropdownMenuTrigger asChild><Button variant='ghost' size='sm'>…</Button></DropdownMenuTrigger>. For InputPill: wrap a single Button as PopoverTrigger asChild, and render the clear-X as a separate sibling ghost button OUTSIDE the trigger (not nested inside a pill-shaped div), or move clear into the popover. This unifies affordance and removes the non-interactive-div-styled-as-button problem.**
  - why: Linear's pills ARE small ghost buttons with icon+label. Using the Button primitive gives consistent height (--ctrl-h-sm), focus ring, font-display, and hover for free, and fixes the InputPill mixed-interactivity bug.
  - DS ref: Button variant='ghost' size='sm' (src/components/ui/button.tsx); DropdownMenuTrigger/PopoverTrigger asChild composition per CLAUDE.md rule 4 (primitives wrap shadcn)
  - files: src/features/tasks/ui/capture-modal.tsx:379-441
- (S) **Bump the title field from text-lg to text-xl (20px) or text-2xl (24px) so it is the clear focal point. Keep font-display, border-0, bg-transparent, focus-visible:ring-0. Optionally raise placeholder contrast slightly. Consider increasing min height to match the larger type.**
  - why: Linear's title is the visual anchor at ~21-24px; at 18px ours competes with the description and pill row, flattening hierarchy.
  - DS ref: --text-xl (20px) / --text-2xl (24px) tokens; font-display per DESIGN_SYSTEM.md 'capture title' = display role
  - files: src/features/tasks/ui/capture-modal.tsx:196
- (M) **Remove (or de-chrome) the labelled header band. Drop the 'New task' DialogTitle row + border-b and let the title input be the top of the modal (keep DialogTitle as sr-only for a11y, keep a small ghost close-X floated top-right). This matches Linear going straight to the borderless title.**
  - why: The separate titled, bordered header is chrome Linear deliberately omits; removing it lets the real title anchor the modal and removes a competing hairline.
  - DS ref: DialogTitle can be visually hidden (sr-only) while preserving Radix a11y; close affordance via DialogClose ghost button
  - files: src/features/tasks/ui/capture-modal.tsx:173-182
- (S) **Surface the submit shortcut explicitly in the footer: render the Create button label with a muted '⌘↵' hint (kbd with text, not just the corner-down glyph), and ensure the same shortcut works from the title field. Use font-mono text-2xs text-muted-foreground for the kbd per the DropdownMenuShortcut pattern.**
  - why: Keyboard-first discoverability is core to the Linear feel; a bare enter glyph hides the modifier and the description-field submit path.
  - DS ref: DropdownMenuShortcut styling (font-mono text-xs tracking-wide text-muted-foreground) in src/components/ui/dropdown-menu.tsx:191-204
  - files: src/features/tasks/ui/capture-modal.tsx:354-359
- (S) **Replace the duration preset <button>s with a shadcn ToggleGroup (single-select), or at minimum Button size='sm' variant='outline'/'ghost', and replace the bare `rounded` with rounded-md. Same for the clear-X: use rounded-md.**
  - why: Removes bespoke control markup, gives consistent radius/height/focus, and aligns to the primitives-wrap-shadcn rule.
  - DS ref: ToggleGroup primitive (add via shadcn CLI if missing) or Button size='sm'; rounded-md control radius
  - files: src/features/tasks/ui/capture-modal.tsx:322-333, 434
- (S) **Wrap the attachment (Paperclip) icon button in a shadcn Tooltip with the 'coming soon' copy instead of the native title attr; or hide the placeholder until the feature exists. If kept, give it the same ghost-button treatment as the pills.**
  - why: CLAUDE.md a11y rule requires a Tooltip for icon-only buttons; a dead placeholder also adds noise to a surface we're trying to quiet.
  - DS ref: Tooltip primitive (src/components/ui/tooltip.tsx) per CLAUDE.md Accessibility section
  - files: src/features/tasks/ui/capture-modal.tsx:341-348
- (S) **In the popover editors, drop the hardcoded h-8 on the Inputs so the Input primitive's --ctrl-h applies, and replace the bespoke <label> spans with a shared small label (font-display text-2xs text-muted-foreground or a FieldLabel) so density and the label role flow through.**
  - why: h-8 defeats the density axis the Input primitive respects; bespoke labels bypass the typography role tokens.
  - DS ref: --ctrl-h via Input primitive (src/components/ui/input.tsx:21); --text-2xs eyebrow/label token; DESIGN_SYSTEM.md typography roles
  - files: src/features/tasks/ui/capture-modal.tsx:256-257, 275-276, 312-313, 319
- (S) **Remove the redundant inline z-index style on ListPill's DropdownMenuContent (style={{zIndex:'var(--z-popover)'}}) now that --z-dropdown == --z-popover == 70 in tokens.css; the primitive already sets z-dropdown.**
  - why: Dead override — both tokens are 70 (tokens.css §13). Keeping it is a no-op that hints at an old layering workaround.
  - DS ref: --z-dropdown / --z-popover both 70 (src/styles/tokens.css:634-635)
  - files: src/features/tasks/ui/capture-modal.tsx:397
- (L) **Optionally extract the restyled ListPill/InputPill into a shared PropertyPill primitive (since task-row.tsx has a parallel inline-property pattern) so the capture modal and inline task editing share one quiet-pill component.**
  - why: Two surfaces (capture modal + task row) express the same 'icon + label + dropdown/popover' property pill; a shared primitive keeps them visually identical and gives a place for a Storybook story.
  - DS ref: src/features/tasks/ui/task-row.tsx:446-499 parallel pattern; Storybook story per CLAUDE.md rule 5 if it lands in components/ui
  - files: src/features/tasks/ui/capture-modal.tsx:379-441; src/features/tasks/ui/task-row.tsx:446-499

### Open questions for Maciej
- Active/set pill fill: should a set property pill use a neutral bg-muted fill, or an accent-tinted fill (e.g. the label-surface / primary-tint treatment)? Linear uses subtle neutral fills for most properties and color only for status/priority — decide whether priority/energy pills get their semantic color or stay neutral.
- Title size target: text-xl (20px) or text-2xl (24px)? Linear sits around 21-22px; 24px is bolder but may feel large at the dense text-size setting. Pick one or make it scale with data-text-size.
- Header treatment: fully remove the 'New task' labelled band (Linear-style, title is the top), or keep a minimal eyebrow? Removing it changes the dialog's read significantly — confirm the chromeless direction.
- Duration as ToggleGroup vs. free input + presets: keep the free numeric input alongside presets, or go preset-only chips? Affects whether we pull in a ToggleGroup primitive.
- Should the dead 'coming soon' attachment (cross-module link) button stay visible in this pass, or be hidden until the linking feature ships? It currently occupies footer space on the surface we're trying to quiet.
