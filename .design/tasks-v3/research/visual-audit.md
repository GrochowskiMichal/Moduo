# Lane 2 — Element-by-element visual & interaction audit of Tasks (north-star role)

> Raw research report from the Tasks re-plan, 2026-10-09 (`maciej` @ 95d988b0), kept for its evidence. The synthesis and the open calls are in [../REPLAN.md](../REPLAN.md). Nothing here is decided.

Base: `maciej` @ 95d988b0, Storybook 10.6 on :6107, Playwright/Chromium 1228, 1440×900 @2×, dark + `theme:light` spot checks, densities comfortable/compact/dense, accents blue/amber, shade slate, radius sharp/round. Read-only; nothing in the repo was touched. Screenshots and measurement dumps: `scratchpad/shots/` (index at the end). Sizes below are **measured computed styles** (px, comfortable density) unless marked "code".

**Audited from stories (rendered):** TaskListView, TaskBoardView, TaskDetailPanel, TaskTimelineView, TaskBlockChip, EntityHub, EntityRefChip, LinkSuggestionStrip, StateLadder, feature-panels-shell, and every primitive on the list. **Audited from code only** (no story): capture modal, Focus/execute view, drift triage, frontier offer, delete-bucket dialog, the rail's `BucketRail` composition (its parts have stories). **Story crashed:** `Components/app/app-chrome` — all four captured variants (Default, Single Workspace, Trial Banner Active, Icons Only) render "Something went wrong — items is not iterable"; Narrow Viewport was not captured. A finding in itself: the shell's story is dead. **No story:** tag-picker. Caveats: the List/Board stories don't pass `filterControl`/`displayControl`, so the toolbar in the shots lacks Filter and Display; the live app passes the old `TagFilterButton` (outline) and the DS-4 `DisplayMenu`, not the DS-4 `FilterBar`. Contrast = WCAG 2.x, oklch → sRGB, opacity composited in gamma space.

## 0. Headline

Tasks is already most of the way to a north star: the state layer, selection recipe, control rung, eyebrow, PropertyRow, NavRow, MetaCount and the row anatomy all exist and mostly hold. What would propagate if copied today is **not** the big shapes but the seams: six muted-opacity steps used as hierarchy (four below 4.5:1), seven chip languages and three count languages, three drop-target recipes and four drag overlays, two hover languages (fill vs border), three focus-ring recipes, native date/time/number inputs still in rows, capture and Focus, `hidden→flex` reveals, and controls that ignore density (board cards, menus, tabs). Every one of those is a thing a Notes or Email session would copy verbatim.

## A. Element-by-element audit

### A1 · List row (`task-row.tsx`)

| Part | Measured | Tokens / code | States | Verdict |
|---|---|---|---|---|
| Row box | 36 / 32 / 28 px by density (`min-height: var(--row-h)`), pad 2·10·2·8, `gap-3` = 12, radius 8, 1 px transparent border | `hover:bg-state-hover`, `SELECTED_ROW` (13 % tint + 1 px inset 32 % ring), `data-done` | rest · hover (5 %) · selected (tint+edge) · selected+hover (no extra step: hover is dropped on selected) · drop-target `bg-accent/50 ring-ring/50` (:163, **not** `DROP_TARGET`) · done (`opacity-40` on title + columns, toggle excluded) · dragging `opacity-60` (`task-dnd.tsx:278`) vs `DRAG_SOURCE` = 40 | Anatomy is right (comp §2). Three defects: drop recipe and drag opacity bypass DS-4; selected rows lose hover feedback. |
| Complete toggle | 16 × 16, 1 px `border-muted-foreground/50` (2.70:1), done = `bg-primary` + 10 px check `.check-pop` | `complete-toggle.tsx:38` | rest · hover (`border-foreground`) · focus `ring-2 ring-ring/50` · done · disabled 50 % | Hit target 16 px (< 24). Rest border is the faintest control on the row; comp uses 1.5 px at 32 %→60 %. |
| Expand chevron | 16 px button, 14 px glyph (`size-3.5` hardcoded, :196) | slot reserved only when the scope nests | hover text only, focus `ring-ring` (full-strength ring, not `/50`) | Off the icon ladder; 16 px target. |
| Title | 15 / 400 body, lh 21.4, truncate | `font-sans text-md` (:236) | blocked → `text-muted-foreground`; done → strike + cell opacity | Correct per R4. **Inline edit swaps face and size**: `TitleEditor` is `h-7 font-display text-sm` (:472) — 15→13 px, body→display, filled well. Shot `__inline-edit`. |
| Quiet counts (`TaskCounts`) | 12 px icon + 12 px tabular number, `gap-0.5` inside, `gap-2.5` (10 px) between; order `#` · subtasks n/m · blocked · repeat | `MetaCount` ✓ | hidden at 0 ✓, tooltip names | Matches comp. 📎 and 💬 slots pending AT-3/TV-U3. |
| Bucket label | 12 px muted, 6 px `NavRowDot`, Inbox icon 12 px | `BucketPopover` wrapper `showLabel \|\| open ? "flex" : "hidden"` (:683) | appears only when not implied | **R6 violation**: opening the `b` popover mounts the label mid-row and shifts the counts (shot `__bucket-popover`). |
| Priority / energy | 14 px glyph (`size-icon-sm`), three bars, ghost bars at 25 % (1.45:1, decorative) | `level-icons.tsx` | tooltip only | Fixed footprint ✓ (comp §1 item 7). Column collapses when empty ✓ (`row-layout.ts`). |
| Date cell | `w-19` = 76 px, right-aligned, 12 px tabular muted; clock icon for scheduled; drifted → `text-foreground` | `DateCell` | hover `bg-state-hover`, focus `/50` ring, empty cell holds place but is inert ✓ | Editors are **native** `<input type="datetime-local">` / `type="date"` at `h-8` (:592, :622), inside a popover with a 12 px label (shot `__schedule-popover`), while the panel uses `DateField` with presets + Calendar. Two date UIs in one module. |
| Assignee | `w-icon` 16 px cell; avatar 16 px, 1-letter 11/500 muted on `bg-muted` (7.6:1) | `AssigneeAvatar size="icon"` | tooltip | One initial can't tell Maciej from Mike: every avatar in the stories reads "M"; only the claim ring differs. Comp uses two letters (7.5 px, illegible) — neither is right; see C. |
| Queue mark | 16 px cell (36 px when a claim shares it); icon 14 px; `opacity-0` → 100 on row hover/selected/focus, `--motion-fade` | `queue-toggle.tsx:131` | queued = `text-primary`; claimed = ringed avatar; both = avatar + toggle | Reveal reserves space + fades ✓ (R6). Rest colour `muted-foreground/40` on hover is 2.15:1 (non-text, needs 3:1). 16 px target. |
| Context menu | 13 px items, `[&_svg]:size-4` | `ContextMenu` ✓ | — | Item set differs from the card's (A3). |
| Keyboard | `j/k`, space, `e`, `s/d/b`, `q`, `x`, `←/→` | `list-keys.ts` | grid container `focus-visible:ring-2 ring-ring` | **Verify in the running app**: every list shot shows a 2 px full-accent ring around the whole pane after the mount-time `containerRef.current?.focus()` (:355, :678). If it shows on page load it is the loudest element on screen. |

### A2 · Group header, completed line, nesting, marks

| Element | Measured | Notes |
|---|---|---|
| Group header | 24.5 px button, eyebrow 11/500 uppercase, count 11 px `muted-foreground/70` (4.4:1), chevron `size-3.5` (:768) | Not sticky (comp `.ghead` is sticky, 30 px). Chevron hardcoded; rail's `NavSectionHeader` uses `size-icon-xs` and is 28 px — two header heights for one idea. |
| "N completed · show" | `min-h-(--row-h-sm)` 28 px, 12 px muted, `ListChecks` 12 px | ✓ comp (comp draws a plain check). Board column reuses it ✓. |
| Nested subtask | `ml-10` (40 px) + 1 px guide `bg-border/60` at `-left-4` (≈1.1:1, invisible on black) | Net visual indent is only ~16 px because the parent carries the 16 px expand slot + 12 px gap; the guide line is not perceivable. Linear uses 24–28 px with a visible guide. |
| Blocked / recurring | `CircleDashed` / `Repeat` 12 px muted in the counts group | ✓ quiet. "Waiting on…" has no mark yet — the counts group is the right slot (comp §6 pattern). |
| Done rows | whole row `opacity-40` except toggle: title 3.55:1, meta 2.08:1 | Acceptable as de-emphasis, but meta at 2:1 is below "readable when shown"; comp uses 42 %. |

### A3 · Board columns and cards (`task-board-view.tsx`, `task-card.tsx`)

| Part | Measured | Verdict |
|---|---|---|
| Column | flex 280–400 px, `gap-3`, `p-1`, transparent; header eyebrow + count `/70` with `mb-2` (no fixed height) | Linear-quiet ✓. Drop state `bg-accent/40 ring-ring/40` (:392) ≠ `DROP_TARGET`. Empty text 12 px `muted-foreground/50` = **2.70:1** (:400). |
| Card | `bg-card` + 1 px `border-border` (1.15:1 against the card — the border is a rumour on black), radius 12, pad 12·10, 64.9 px single-line, `gap-1.5` between cards | **Ignores density**: 64.9 px at comfortable *and* dense (`py-2.5`, `text-base`, `leading-snug` are not density-bound). Rows and panel rows scale; cards don't. |
| Title | 14/400 body, wraps | Rows are 15 px — a 1 px size split between List and Board for the same content role. |
| Meta line | 12 px muted, `pl-6`, `gap-2.5`: priority · date · counts · bucket · parent ▸ queue · avatar | Order matches comp ✓. **Queue icon is always visible at 40 %** on every card (`CardBody` passes no `revealOnHover`), while rows hide it until hover — and the comp shows no idle queue icon on cards. One ghost icon per card = noise. |
| Hover | `hover:border-foreground/30` (:111) | Rows hover by **fill**, cards by **border**: two hover languages in one module. |
| Selected / done / drag | `SELECTED_OPTION` ✓ · `opacity-50` ✓ (5.2:1) · source `opacity-0`; overlay `rounded-lg border-border bg-background shadow-lg` (:323) | Overlay is `bg-background` (black on black — the inverted elevation DECISIONS §Board look fixed on columns survives in the overlay). `DragOverlaySurface` exists and is unused. |
| Context menu | Mark done · Add to queue · Move to bucket › · Assign › · Priority › · Energy › · Delete | Row menu: Rename · Mark done · Add to queue · Skip · Schedule… · Set due date… · Move to bucket… (popover) · Detach · Assign · Priority › · Energy › · Delete. Same entity, two menus. |

### A4 · Timeline (`task-timeline-view.tsx`)

Header: month eyebrow 11 px, day numbers 11 px `/70`, **Today pill** `bg-primary` 11/500 (allowed status mark), today line 1 px `primary/70` (7.4:1), grid lines `border/40` (**1.06:1**, effectively invisible — the week shot shows columns only by luck of the bars). Lane header = collapsible eyebrow + count, own height constant. Bars: 1 px hairline + `bg-card`, checkbox + 14 px title inside, open-ended bars fade with a gradient ✓, dependency arrows ✓, resize handles on hover ✓. Tray chips: `rounded-md border-border bg-card px-2 py-1 text-xs` with `GripVertical` 12 px (:799) — the grip was removed from rows and cards ("whole thing is the handle"), the tray kept it. Raw z-indices `z-20` (:481), `z-[1]` (:529), `z-[5]` (:568), `z-[3]` (:601), `z-10` (:652) instead of `--z-*`; `scrollbar-thin` alias instead of `pane-scroll` (:477); drag chip `bg-background` (:702); drop region `bg-accent/40` (:536). The toolbar is on one rung ("Today" ghost `sm`, Week/Month/Quarter `SegmentedControl size="sm"` :447, view switcher, New) but its grammar differs from List/Board (no Group/Filter/Display slot — the Timeline "keeps its own rules"), so the three views present three toolbars. Empty state is a hand-rolled pill (:653), not `EmptyState`.

### A5 · Detail panel (`task-detail-panel.tsx`, `-header.tsx`, `-properties.tsx`, `task-feed.tsx`)

| Part | Measured | Verdict |
|---|---|---|
| Header | 32 px row (`h-(--ctrl-h)`): breadcrumb 26 px button, 12 px muted, 8 px dot/Inbox 12 px; Queue button `secondary sm` 26 px 14/500 ("In queue") or ghost ("Queue"); `IconButton` 26 px link + ⋯ | ✓ comp §1. Hand-rolled breadcrumb button (:89–100) re-implements ghost-button states instead of `Button variant="ghost" size="sm"`. |
| Title | textarea 18/600 lh 24 `tracking-tight`, `DetailTitle lead` ✓, grows | Focus ring `/50` ✓; done → muted. |
| Description | 14 px `text-foreground/85` (14:1), placeholder "Add a description… @ or / to link", `pl-6` aligns to title ✓ | No reserved box ✓ (comp). |
| Property rows | label `w-24` = 96 px 13 px muted, 26 px tall (`--ctrl-h-sm`, 22 px dense), rows `gap-px`; value 14 px in a 26 px ghost button, 14 px icon slot, `-ml-1.5 px-1.5` so text starts at x = 115 for every row ✓ | Hover `state-hover`, open `state-active`, focus `/50` ✓, disabled inert ✓. Picker menus: 13 px items, 16 px icons (menus don't scale with density). |
| Energy · Scheduled · Time · Repeat | shown once set; otherwise one 26 px quiet line "+ Energy · Scheduled · Time · Repeat" 13 px muted (:184) | = comp §5 option C ✓. |
| Time row | "1h 20m" 14 px + "of ~4h" muted + 2 px × 32 px hairline bar `bg-muted-foreground` + "you 50m" 12 px | ✓ comp. But `Progress` primitive is 6 px `bg-primary`: two progress languages, and the primitive's accent fill is outside R5's allowlist. |
| Tags | `TagChip md` 13 px, coloured `#`, `×` 14 px, `+` ghost `PropertyValue` | ✓. The picker uses **colour dots** (`task-tag-filter.tsx:62`, tag-picker) while chips use the coloured `#` — two colour carriers for one concept. |
| Collections | header 26 px, 13/500 display label + 13 px muted count + 26 px `IconButton` | ✓ comp. Subtask/related rows 26 px, 14 px, hover `state-hover`, remove `×` and queue buttons `size-5` (20 px) revealed by opacity ✓. |
| Separator | `bg-hairline` ✓ | — |
| Feed | events 12 px muted lh 1.65, 16 px avatars; comment card `rounded-lg border-hairline px-3 py-2.5` 13 px; composer `rounded-lg border-hairline`, 13 px textarea, two 26 px `IconButton`s; meta line 11 px tabular | ✓ comp. "Show N earlier" fold ✓. |
| Empty | hand-rolled centred text (:671) with `Kbd` | Not `EmptyState`. |
| Density | dense: header controls 22 px, rows 22 px, title unchanged ✓ | — |
| Light | structure holds (tint, rings, borders visible); `text-foreground/85` fine | no breakage |

### A6 · Toolbar (`plan-view-header.tsx` + `Toolbar`)

Measured: h1 18/400 display lh 28 (comp: 18/600 + muted count "76"); `Toolbar` row `gap-2`, group `gap-1.5`; Group = 12 px muted word + ghost `SelectTrigger size="sm"` 26 px `w-28`; view switcher track 26 px (`p-0.5`), segments 22 × 22, radius `calc(8−2)` = 6 (concentric ✓), raised plate `control-raised` ✓; New = primary `sm` 26 px, 14/500, `px-2.5`. In the live app the row also carries `TagFilterButton` (`Button outline|secondary sm`, `font-display` override, `size-4` icon, `Filter · N`) and `DisplayMenu`'s ghost trigger. Comp: Search · Filter · Display as **three ghost icon+label buttons**, Group inside Display, title with count. Missing vs comp: Search, title count, Group → Display, one control language (the live Filter is outlined, Display is ghost, Group is a naked select). The `Toolbar` story itself still demonstrates the old language (outline Filter, labelled List/Board, "New task"), so a copier gets the wrong example.

### A7 · Filter chips and Display menu (DS-4 primitives, not yet wired for filters)

FilterBar: chip 26 px (comp 24), segments `bg-state-active` with 1 px `hairline` dividers, 14 px (comp 13), `×` 12 px; "+ Filter" ghost; "N of M · Clear" 12 px; popover `rounded-lg border-hairline` 256 px with search; count pip 16 px `bg-foreground` 11/600 ✓ matches comp `.pip`. DisplayMenu (shot `components-ui-display-menu--default.png` *is* the open state): 320 px, `rounded-lg border-hairline p-1.5`, rows on the default control rung with 13 px muted labels, selects as `secondary` buttons, segmented Completed/Subtasks, "Show on rows" toggles 24 px pills (`state-active` on / hairline off), Reset ✓ = comp. Deviation: `rounded-lg border-hairline` here vs `rounded-md border-border` on every Radix dropdown/context/popover/tooltip — two floating-surface recipes.

### A8 · Rail (`NavRow`, `NavSectionHeader`, `bucket-rail.tsx`)

NavRow 36 px (`--row-h`), `pl-2 pr-1.5 gap-2.5`, 16 px icon slot, label 14/500 **display**, count 12/500 tabular muted flush right; current = `state-active` 9 % + `aria-current`; hover `state-hover`; count ⇄ ⋯ swap in one 20 px slot ✓ (R6), keyboard focus ring on the row ✓ (shot `nav-row--states__focus`); drop target = `DROP_TARGET` ✓, dragging 40 % ✓. Section header 28 px eyebrow + hover "+" swap ✓. Bucket dot 8 px (`NavRowDot`, coloured in stories). `DriftMark` = 6 px dot in a 16 px button (`:322`, 16 px target). Mode toggle = `SegmentedControl` default 32 px full width — the only 32 px control in the rail; the comp removes it (Focus starts from Queue). Contrast: labels muted 8.5:1, counts 8.5:1 ✓.

### A9 · Capture modal (`capture-modal.tsx`, code only)

Dialog `sm:max-w-xl` at `top-[12%]`, `p-0`; close = hand-rolled 24 px button with `hover:bg-accent` (:198). Title `Input` `h-9 border-0 px-0 font-display text-xl` (20 px display — ratified in DECISIONS §Remaining; **but** DESIGN_SYSTEM §Typography roles still files titles under display while R4/§Session 11 file them under body: the doc contradicts itself). Description `Textarea min-h-9 text-base`. **Eight pills** (Bucket, Assignee, Priority, Energy, Schedule, Due, Repeat, Duration) all `rounded-md border border-border px-2 py-1 text-xs` (:446) — 12 px text, opaque `border-border`, "set" = `bg-muted` (neutral-850 fill inside a neutral-800 border — one step apart on the same grey ladder, so set vs unset reads as the faintest possible difference), hover `bg-accent` (legacy). `size-3.5`/`size-4`/`size-3` icons hardcoded ×20. Duration presets are raw bordered 12 px buttons (:412); Schedule time is a native `type="time"` input (:328); Duration a native `type="number"` (:400). Footer `border-border`, Switch + "Create more" 12 px, Create `sm` with a hand-rolled `<kbd>` (:434) instead of `Kbd`. vs comp §3: no parsed-token highlighting, no 4–5 pills + More, no "Add to my queue" switch, no paste-to-attach; pill rung should be `--ctrl-h-sm` 14/500 with hairline ring, set = `state-active`.

### A10 · Focus / run surfaces (`execute-view.tsx`, code only)

"Focus" h1 18 px display; NowCard `rounded-lg border-border bg-popover px-6 py-5`: eyebrow bucket, 11 px due, `TagChipList`, h2 24 px display (allowed hero), 12 px subline, 13 px description, subtask checklist rows `hover:bg-accent` (:474, legacy), footer `border-border`: "Track time" ghost sm / clock 18 px + two 26 px IconButtons + 12 px totals; **Skip** = raw text button (:436); **Done** = `size="md"` 32 px (:443) next to 26 px controls (rung mix). Queue list: eyebrow, rows with 6 px dot + title in `font-display` (:644 — R4 says body) + 12 px estimate. EndSummary still renders "0 / 0 Done" with a 48 px check disc (:209–214; U14). Comp §4 replaces all of this with the run model (Queue header with ▶ Start run, Now card with Done ⏎ / Skip / Hand off W, Up next with estimates, In flight right panel, break bar, run summary, "Nothing lined up"). Treat A10 as the pre-TV-F2 state; the visual contract for the north star should come from comp §4, not from this file.

### A11 · Empty states, toasts, dialogs, menus, tooltips, kbd

`EmptyState`: icon 20 px `opacity-60`, title 13 px, description 12 px `/80`, action, hint 11 px `/70` ✓ (list uses it; detail, board column, timeline, Focus don't). Sonner: popover surface, stacked bottom-right, tokens via CSS vars ✓; row/card/⋯-menu Delete fires immediately with an Undo toast (`undoToast("Task deleted")`, `use-tasks-module.ts:1175`), which matches DESIGN_BRIEF's "silent success + Undo" rule — but the toast is the only confirmation, and the capture modal's own `toast(title, {description})` on create is a second toast voice in the same flow. Dialog: `rounded-xl border-border bg-card p-6`, title 18 px display, description 13 px muted, close 28 px with `ring-offset-card` ring; destructive variant uses the red fill ✓. Menus: `rounded-md border-border bg-popover p-1`, items 13 px `py-1.5 px-2`, icons `size-4` fixed, highlighted = `state-active` ✓, shortcuts mono 12 px, destructive red text; entrance = `fx-overlay` (tokenised fade) on dropdown/popover but tw-animate `zoom-in-95 slide-in-*` (untokenised) on context-menu and tooltip (R6). Tooltip: 12 px, arrow, 6 px offset ✓. `Kbd`: 11 px mono on `bg-muted` + border ✓ (capture and app-chrome hand-roll their own `<kbd>`). Command palette dialog headings use the eyebrow ✓, but the inline `Command` story renders group headings at ~18 px — the heading recipe lives on the dialog wrapper, not on `CommandGroup`.

### A12 · Avatars, chips, date chips, drag visuals

Avatar sizes 32/24/40/16; `AvatarGroup` clips two-letter initials at 24 px (`-space-x-2`). Chip languages in the module: `TagChip` (bare `#name`, 12/13 px), filter-chip (segmented 26 px `state-active`), capture pill (bordered 12 px), `EntityRefChip` (filled `rounded-full` pill), `Badge` tag-list (filled pill), timeline tray chip (bordered + grip), DisplayMenu toggles (24 px hairline/`state-active`). Count languages: plain tabular number (NavRow, MetaCount, group header), `Badge secondary` pill (EntityHub sections), inverted `bg-foreground` pip (FilterButton). Drag visuals: `InsertionLine`, `NestPreview`, `DragOverlaySurface`, `DROP_TARGET`, `DRAG_SOURCE` all exist with a story ✓ — and the List, Board and Timeline each use their own copies instead. `Calendar`: month nav chevrons are `absolute left-1/right-1` against the nearest positioned ancestor, so inside `DateField`'s popover they sit on their own row at the popover's edges above the centred caption (shots `date-field--with-time__open`, `detail__due-open`), and in the bare story they fly to the viewport edges.

## B. Top issues that would propagate (ranked by north-star risk)

1. **Muted-opacity ramp used as hierarchy.** `/70 /60 /50 /40 /25` + `opacity-40/50` = six grey steps; `/70` 4.4:1, `/60` 3.5:1, `/50` 2.7:1 (board empty text :400), `/40` 2.2:1 (card queue icon), done-row meta 2.1:1. Every module will mint its own step. Define two: `muted-foreground` (8.5:1) and one "tertiary" ≥ 4.5:1 (≈ `/75`); decorative ghosts (priority bars, hairlines) are the only things allowed below.
2. **Three drop-target recipes, four drag overlays, two drag-source opacities** — `task-row.tsx:163`, `task-board-view.tsx:392`, `task-timeline-view.tsx:536`; overlays `task-list-view.tsx:745`, `task-board-view.tsx:323` (`bg-background`), `task-timeline-view.tsx:702` (`bg-background`); `task-dnd.tsx:278/345` (60/50 vs `DRAG_SOURCE` 40). DS-4 shipped the pieces; nothing in Tasks consumes them.
3. **Native form controls inside token UI**: `datetime-local`/`date` (`task-row.tsx:592, :622`), `time` (`capture-modal.tsx:328`), `number` ×4 (capture :400, execute :542/:571/:583). The panel's `DateField` is the only correct date UI.
4. **Reveal-by-mount (R6)**: `BucketPopover` `hidden→flex` (`task-row.tsx:683`) reflows the row; the context-menu/tooltip entrance uses untokenised tw-animate motion.
5. **Hover is fill on rows but border on cards** (`task-card.tsx:111`); **selection on hover has no hover step** (rows drop `hover:` when selected, :164–168). Copiers will pick one at random.
6. **Density is a contract only rows and the panel honour**: board cards fixed 64.9 px; menu/select items `text-sm` + `[&_svg]:size-4` (`dropdown-menu.tsx:12–18`, `select.tsx:116`); `Tabs` triggers `text-sm` with `rounded-md` inside a `p-1 rounded-md` list (R3: inner should be 4 px); app-chrome module tab `h-8 text-sm` (`app-chrome.tsx:82`).
7. **Three focus-ring recipes**: offset-less `ring-2 ring-ring/50` (Button, FieldShell, PropertyValue, NavRow) vs `ring-ring ring-offset-2 ring-offset-background` (Checkbox, Badge, Tabs, app-chrome) vs full-strength `ring-2 ring-ring` (list grid, TagChip, expand chevron) vs `ring-offset-card` (DialogClose).
8. **Hardcoded icon sizes (52 in Tasks UI; 20 in capture alone)** and raw heights (`h-7/h-8/h-9`: `task-row.tsx:472/595/625`, `capture-modal.tsx:215/223/405`, timeline :671) — the icon ladder and `--ctrl-h*` exist, the module bypasses them.
9. **Five chip languages / three count languages** (A12). Tags alone appear as bare `#`, coloured dot (picker, filter popover), and `Badge` pill (tag-list story).
10. **Inline editors change type role**: `TitleEditor` display/13 px in a 15 px body row (`task-row.tsx:472`); drift-triage titles `font-display text-sm` (:154); Focus queue titles `font-display` (:644). The DESIGN_SYSTEM §Typography-roles paragraph still says titles are display — fix the doc or every new module inherits the contradiction.
11. **Hand-rolled controls where a primitive exists**: breadcrumb buttons (`task-detail-header.tsx:89, :121`), Skip (`execute-view.tsx:436`), capture close/duration presets/`<kbd>` (:198, :412, :434), `BucketPopover` list (`task-row.tsx:697` — no arrow-key nav, no typeahead; the card uses a radio submenu), group header button (`task-list-view.tsx:759`), timeline lane header (:853), empty states ×4. 29 raw `<button>` elements in Tasks UI, roughly a third of them where a primitive already exists.
12. **Two floating-surface recipes**: `rounded-md border-border` (Radix menus/popover/tooltip) vs `rounded-lg border-hairline` (FilterBar, DisplayMenu, CommentCard, composer).
13. **Accent budget stacking**: on the blue-accent shot the selected row, queued marks, done toggles and the Today pill are the same blue on one screen. R5 permits each; nothing ranks them. Rank: selection > today/now > done-check > queued, and drop queued to a neutral "on" state.
14. **Hit targets under 24 px** on the primitives most likely to be copied: CompleteToggle 16, QueueToggle 16, expand chevron 16, DriftMark 16, subtask `×`/queue 20. Pad the hit area (`before:absolute -inset-1`) without growing glyphs.
15. **Stories out of date / broken**: app-chrome crashes; `Toolbar` story shows the pre-DS-4 language; list/board stories omit Filter/Display; no story for tag-picker, capture, Focus, drift triage.

## C. North-star kit

**Cross-module primitives (standardise; one-line contract each):**

- **Row** — `min-h var(--row-h)` (36/32/28) · `pl-2 pr-2.5 gap-3 rounded-md` · leading 16 px control slot · title 15/400 body truncating · quiet counts (`MetaCounts`) · fixed right columns (14/76/16/16 px, collapse when empty view-wide) · states: hover `state-hover`, selected `SELECTED_ROW` (+ hover one step up), focus-visible `/50` ring, done `opacity-40` except control, drop `DROP_TARGET`, dragging `DRAG_SOURCE`. Generalises to notes, email threads, contacts.
- **Card** — `bg-card rounded-lg ring-1 ring-inset ring-hairline` (not opaque `border-border`) · pad `var(--pad-x-sm)`/`var(--pad-y-sm)` so density applies · title 14/400 · one meta line 12 px `pl-6` · hover = `state-hover` **fill** (same language as rows) · selected `SELECTED_OPTION` · done `opacity-50` · overlay `DragOverlaySurface`.
- **PropertyRow / PropertyValue** — as built: 96 px 13 px muted label, 26 px ghost value with 14 px icon slot, `-ml-1.5`; empty = muted placeholder; `align="start"` for wrapping values. Keep.
- **CollectionHeader** — 26 px: 13/500 display label · 13 px muted count · optional `IconButton sm` flush right. Promote from `task-detail-panel.tsx:371` to `ui/`.
- **GroupHeader** — one header for list groups, board columns, timeline lanes, rail sections: 28 px (`--row-h-sm`), eyebrow + plain count, optional chevron (`size-icon-xs`) and hover-swap action; sticky in scrollers.
- **MetaCount / MetaCounts** — as built (12 px icon + tabular number, hidden at 0, order fixed: tags · 📎 · 💬 · subtasks · blocked · waiting · repeat).
- **NavRow / NavSectionHeader** — as built; adopt in every rail (DS-5).
- **Toolbar** — one rung (`sm` 26 px), `gap-2` between groups; grammar = `[title + count] … [Search] [Filter] [Display] | [view switcher] | [Primary]`; every control a ghost `Button sm` except the one primary; update the story.
- **FilterBar / FilterChip / DisplayMenu** — as built; wire into Tasks (TV-U2) and freeze the chip at `--ctrl-h-sm`, 14 px, `state-active` segments.
- **Chip** (new) — height `--ctrl-h-sm` (or 24 px `xs`), 14 px (13 at xs), rest `ring-1 ring-inset ring-hairline`, set/active `bg-state-active`, optional leading 14 px icon, trailing `×` 14 px, `shape: md | full`. Replaces capture pills, EntityRefChip surface, tray chips, Badge tag-lists.
- **Picker pill menu** — `Chip` as trigger + `DropdownMenu`/`Popover` content; one set/unset rule (fill, not border).
- **EmptyState** — as built; make detail/board/timeline/Focus use it.
- **Activity item** — 16 px avatar · 12 px muted line with `font-medium` actor · tabular time; **CommentCard** `rounded-lg ring-hairline px-3 py-2.5` 13 px; **Composer** same surface, `IconButton`s. Promote from spine to `ui/` as `FeedItem`, `FeedCard`, `FeedComposer`.
- **DateField** (+ Calendar) — the only date UI; fix Calendar nav positioning (react-day-picker v9+ renders `Nav` as a sibling of `MonthCaption`, so the `absolute left-1/right-1` chevrons resolve against the popover — give the nav its own positioned wrapper or overlay it on the caption row); add `withTime` time input as `Input size="sm"` not native.
- **Progress** — neutral fill (`bg-muted-foreground`) at 2 px/6 px; reserve accent for status.
- **Selection/Focus** — `SELECTED_ROW`/`SELECTED_OPTION` as built; one focus recipe `focus-visible:ring-2 ring-ring/50`, offset-less, everywhere (migrate Checkbox, Badge, Tabs, chrome).
- **Avatar** — `icon` 16 px with **two-letter** initials at 9 px/600 *or* 1 letter + deterministic label-hue background (`data-label`) so Maciej ≠ Mike; claim ring stays.

**Tasks-specific (keep in `features/tasks/ui`):** priority/energy glyphs, QueueToggle + ClaimAvatar, "N completed · show" (could generalise later), subtask nesting + guide, Timeline bars/axis/tray, NowCard/run surfaces, capture parser pills, drift mark.

## D. Gaps vs the comp and vs "complete but calm"

Close to the comp (keep): row anatomy and columns, selection tint + hairline, group/completed lines, detail header/title/description/properties/option C quiet line/Time row/tags/collections/feed, rail rows and swap, raised segmented plate, scrollbars, state ladder.

Gaps vs comp: (1) toolbar language and contents (Search, title count, Group inside Display, ghost Filter/Display); (2) capture (token highlighting, 4–5 pills + More, "Add to my queue", paste-to-attach, pill rung/weight); (3) Focus/run model entirely (comp §4); (4) attachments as thumbnails in the panel and 📎 in counts (AT-2/AT-3); (5) sticky group headers; (6) card hover (comp: fill); (7) avatar identity; (8) queue toggle hidden at rest on cards; (9) "Nothing lined up"/"Run complete" empty states; (10) Plan/Focus toggle still in the rail.

Vs "complete but calm": calm is mostly achieved (no reds, no bars, neutral priority). "Complete" is where the current build under-delivers: the quiet steps hide facts rather than quieten them — `/40–/50` text is unreadable, not calm; the toolbar title has no count; rows show nothing for waiting-on, attachments, comments; group headers hide their counts behind collapse; the board's idle queue icon is noise rather than information; and the Standard preset today cannot show tag names, bucket, or estimate at all (no Detailed yet). The principle's rule "nothing hidden without a count" is met on rows (counts) and sections (counts), broken in the rail only for Someday-style zero counts (hidden at 0 — fine) and in Display (no count of hidden properties).

## E. Standard vs Detailed — what each shows, element by element

Neither preset changes row height (density does). Both keep: checkbox · title · quiet counts (tags · 📎 · 💬 · subtasks · blocked · waiting · repeat) · fixed right columns · selection/hover/done states · the "N completed · show" line. Column widths in the Detailed column are **proposed**, not measured (the only measured ones are today's 14/76/16/16).

| Element | Standard (default = today's TV-U1 + waiting mark) | Detailed |
|---|---|---|
| Handle `MOD-142` | off (header, ⌘K, deep links only) | on, 12 px muted tabular before the title, fixed 64 px column, click = copy |
| Title | 15 px truncating | 15 px truncating (never wraps in list) |
| Counts after title | counts only; tag names in tooltip | counts + **tag names** as `TagChip sm` after the title, capped at 3 + "+N" (`TagChipList`) |
| Bucket | only where not implied (dot + name) | always, dot + name, own 120 px column |
| Priority | 14 px glyph column, collapses if empty | same + word in tooltip; column always reserved |
| Energy | off (Display can enable) | on |
| Date | one date, 76 px column | scheduled **and** due, two columns (76 px each) |
| Estimate / time | — | "1h 20m / ~4h" 12 px tabular, 88 px column |
| Assignee | 16 px avatar | avatar + first name, 96 px |
| Waiting on | quiet mark in counts ("on Anna · 2d" in tooltip) | mark + "on Anna · 2d" text, 110 px column |
| Created / updated | — | relative, 12 px muted, 72 px, sortable |
| Queue mark | hover-reveal | always visible as a neutral 14 px glyph (queued = accent) |
| Header row | none (group eyebrows only) | 28 px eyebrow header row with column titles; click = sort, arrow glyph 12 px; sticky |
| Group headers | eyebrow + count, sticky | same |
| Display override | property toggles beneath the preset | same; preset is the Appearance default, Display overrides per scope |
| Board card | one meta line | adds tag names + estimate line (second 12 px line) |

## F. Quick wins vs structural fixes (ranked by impact on the north-star role)

**Quick wins (hours each, no API change):**
1. Replace the three drop recipes and three overlays with `DROP_TARGET`/`DragOverlaySurface`/`DRAG_SOURCE` (B2).
2. Cap the muted ramp: delete `/40 /50 /60`; `/70` → `/75`; done-row meta to a readable step (B1).
3. `TitleEditor` → `Input variant="bare"` at `text-md font-sans`, `--ctrl-h-sm`; `BucketPopover` label reserve-and-fade instead of `hidden` (B4, B10).
4. Card hover → `hover:bg-state-hover`; card queue toggle `revealOnHover`; card overlay → popover surface (A3).
5. Row date editors → `DateField` (B3); capture time/number → `Input size="sm"`.
6. One focus recipe; pad 16 px targets to 24 px hit areas (B7, B14).
7. Replace hand-rolled buttons with `Button`/`IconButton`/`Kbd`/`EmptyState` (B11); fix `Calendar` nav positioning.
8. Timeline: `--z-*`, `pane-scroll`, drop the tray grip, grid lines from `border/40` to `hairline`.
9. Fix the app-chrome story and the Toolbar story; add Filter/Display args to the List/Board stories.

**Structural (a block each):**
1. **Chip primitive + Picker pill** and migrate capture, EntityRefChip, tray, Badge tags (B9).
2. **Density-bound Card, menus, Tabs** (`--pad-*`, `size-icon-sm`, concentric radius) (B6).
3. **GroupHeader + sticky** across list/board/timeline/rail (A2).
4. **Toolbar grammar** per comp (Search · Filter · Display ghost, Group → Display, title count) + wire `FilterBar` (TV-U2).
5. **Capture v2** per comp §3 (TV-U7).
6. **Focus/run surfaces** per comp §4 (TV-F2/F3) — build on Row/Card/Chip, not on `execute-view.tsx`.
7. **Avatar identity** (two letters or label-hue fallback) — a workspace-wide change.
8. **Detailed preset** (E) with the header row and new columns; `RowColumns` grows.
9. **Doc fix**: reconcile DESIGN_SYSTEM §Typography roles with R4; add the muted ramp, focus recipe, floating-surface recipe and accent ranking to DESIGN_RULES.

## Screenshot index (`scratchpad/shots/` — ephemeral, not in the repo; re-capture with `visual-audit-scripts/` against `bun run storybook -- -p 6107`)

- List: `tasks-tasklistview--{single-bucket,all-by-bucket,all-flat,completed-all,with-energy,read-only}.png`; states `…all-by-bucket__{hover,focus-tab2,selected,selected-nohover,subtasks-expanded,completed-shown,inline-edit,schedule-popover,bucket-popover}.png`; variants `__density-{compact,dense}`, `__accent-{blue,amber}`, `__shade-slate`, `__radius-{sharp,round}`, `__light`. (No `__contextmenu` — that capture failed.)
- Board: `tasks-taskboardview--{by-bucket,by-status,recent-completed}.png`, `…by-status__{hover,selected,selected-nohover,card-hover,contextmenu,density-compact,density-dense,light}.png`.
- Detail: `tasks-taskdetailpanel--{populated,core-properties-only,nothing-selected,read-only}.png`, `…populated__{focus-tab3,status-open,due-open,tagpicker-open,more-open,time-open,priority-hover,density-compact,density-dense,accent-blue,accent-amber,shade-slate,radius-sharp,radius-round,light}.png`.
- Timeline: `tasks-tasktimelineview--{populated,week-zoom,quarter-zoom,empty,read-only}.png`, `…populated__bar-hover.png`.
- Calendar chip / spine: `calendar-taskblockchip--*.png`, `spine-entityhub--*.png`, `spine-entityrefchip--*.png`, `spine-linksuggestionstrip--*.png`.
- Foundations / shell: `foundations-stateladder--default.png` (+`__light`), `components-app-feature-panels-shell--primary.png`, `components-app-app-chrome--*.png` (all show the crash).
- Primitives: `components-ui-<name>--<story>.png` for nav-row (+`--states__focus`), meta-count, filter-bar (+`__open`), display-menu (`--default.png` is the open state), property-row, complete-toggle, checkbox, button, icon-button (+`__hover-tooltip`), avatar, badge, tag-chip (none — no story), segmented-control (+`--icon-only__hover-tooltip`), toolbar, empty-state, popover (+`__open`), dropdown-menu (+`__open` ×2), context-menu (+`__open`), dialog (+`__open` ×2), sheet (+`--right-side__open`), tooltip (+`__hover-tooltip`), kbd, input, textarea, date-field (+`--with-time__open`, `--property__open`), calendar, progress, tabs, sonner (+`__toasts`), command (+`--palette-dialog__open`), eyebrow, detail-title, drag-visuals.
- Comp: `comp__full.png`, `comp__sec1.png` … `comp__sec6.png`, `comp__row-hover.png`.
- Measurements: `*.measure.json` beside the Tasks/primitive shots; contrast table `scratchpad/contrast.txt`.
