# Spec: Design-system state layer + shared list primitives (cross-module)

> Status: **DS-1 built 2026-10-08** (`t/maciej/ds-1-state-tokens`, PR #254) · DS-2 onward follow in order · Owner: maciej · Source: [`.design/tasks-dogfood/REVIEW.md`](../.design/tasks-dogfood/REVIEW.md) §UI review U1–U5, the comp [`.design/tasks-dogfood/ui-proposal.html`](../.design/tasks-dogfood/ui-proposal.html) · Rules: [`docs/DESIGN_RULES.md`](../docs/DESIGN_RULES.md) (R5 changes here), [`docs/DESIGN_SYSTEM.md`](../docs/DESIGN_SYSTEM.md) · First consumer: [`tasks-v2.md`](./tasks-v2.md)

## Scope

The Tasks UI review exposed system-level problems that every module shares:

- **Hover, active, selected and borders collapse into one grey on dark.** `--accent` = `--secondary` = `--border` on all 6 shades. The result: the secondary button's hover is a no-op, hover looks like active, and badges melt into hovered rows.
- **The segmented control's "raised" plate renders darker than its track.** The active view icon is invisible.
- **Most panes show thick native scrollbars.**
- **Selection is drawn with a detached left bar.**
- **No shared primitives** for sidebar rows, count indicators, filter chips, display menus or drag visuals — four modules each roll their own.

This spec adds a state layer of tokens, fixes the primitives that inherit the problem, makes selection tint-only, and adds the shared primitives Tasks v2 needs. Tasks adopts first. Other modules follow in DS-5.

**Landing rule:** `maciej` only — no pushes or merges to `develop` until Maciej says so (2026-10-07).

## Product behavior & UX

- **State ladder** — every interactive surface uses three distinct states, derived from the surface it sits on:
  - **hover** (faint neutral);
  - **active / current** (stronger neutral — the page you're on, a pressed toggle);
  - **selected** (the accent-tinted item you're working on).

  Distinct on all 6 shades, all 8 accents, light theme (structural), and every density, radius and font.
- **Raised controls** — the active segment of a segmented control or tab list is *lighter* than its track on dark (white + shadow on light). It reads at a glance in the icon-only view switcher.
- **Scrollbars** — thin and token-coloured everywhere by default, no opt-in needed. `.no-scrollbar` hides them where a design wants none. Old WebKit gets the same look.
- **Selection** — a tint, optionally with a 1 px inset hairline in the accent (designer picks in DS-2; the comp has both). **No bars anywhere.** The chat "attention" bar and the calendar focus edge are not selection and stay.
- **NavRow** (sidebar row for every module):
  - **anatomy:** icon/dot slot · label · trailing slot;
  - **count ⇄ ⋯ swap:** the count sits flush right; on hover / keyboard focus / open menu it fades out and **⋯** fades in *in the same slot*, so nothing reflows (R6). ⋯ is also reachable by right-click and keyboard;
  - **states:** active (aria-current), hover, drop-target (tint + ring while a drag hovers it), dragging (dimmed);
  - **optional:** inline rename, indent level, collapsible section header with aggregate count and a hover "+".
- **MetaCount** — icon + number, muted, 12 px, hidden at 0. One indicator language for tags/attachments/comments/subtasks on rows and cards.
- **FilterBar + FilterChip:**
  - **chips** read as sentences ("Assignee · is · Me ×"); each segment is clickable to change operator/value;
  - **"+ Filter"** opens dimension → value with type-to-jump;
  - **"N of M · Clear";**
  - **generic** over a dimension registry the module provides.
- **DisplayMenu** — one popover:
  - layout segmented;
  - group / order selects;
  - completed segmented;
  - subtasks segmented;
  - property toggles;
  - Reset.

  Generic over a module-provided config.
- **Drag visuals** (one language):
  - **insertion line** (2 px accent + ring dot);
  - **drop-target tint** (state-active + inset ring);
  - **drag overlay** (popover surface + shadow);
  - **drag source** at one dimmed opacity;
  - **nest preview** (indented ghost, dashed accent outline).
- **Persisted view prefs helper** — one pure helper for "remember this view setting per workspace+scope", replacing three copies (tasks, calendar, email).

## Edge cases

- **Scoped `data-accent` routes** (auth, onboarding, paywall, join, book, public note — `preWorkspace()`): derived tokens must re-resolve there. Today `--selected-bg` declared on `:root` does not.
- **Translucent tints on surfaces that aren't cards** (`--background`, popover, muted): chat pills, booking chips and the book page must still read. All 23 current `--selected-*` usages are audited.
- **The 26 existing `bg-accent/60`-style hovers** stay correct until migrated (no in-place redefinition of `--accent`).
- **Scrollbars:**
  - **Chromium vs WebKit:** setting `scrollbar-width` makes Chromium ignore `::-webkit-*`, while pre-18.2 WKWebView reads only `::-webkit-*`. Both paths are kept.
  - **Layout width:** styled scrollbars take layout width, so main panes use `scrollbar-gutter: stable` to avoid reflow.
  - **Radix ScrollArea** gets the same thumb token.
- **Reduced motion** — the swap and tint fades keep ~80 ms opacity (R6).
- **Light theme** — tokens defined structurally (overlays from foreground); visual tuning is out of scope.

## Acceptance criteria

- **DS-AC1** — Hover, active and selected are visibly different from each other on every shade × accent combination, in every module that adopts the layer.
- **DS-AC2** — The active segment of every segmented control / tab list is lighter than its track on dark and stands out in the icon-only view switcher.
- **DS-AC3** — Every scroll container shows the thin themed scrollbar without opting in. `.no-scrollbar` hides it. Main panes don't jump when a scrollbar appears.
- **DS-AC4** — No selection bar exists anywhere. Selected rows/cards use the tint (+ optional hairline).
- **DS-AC5** — Secondary, outline and ghost buttons and menu items have a visible hover on dark (no no-op hovers).
- **DS-AC6** — Hover ≠ active in module tabs, the workspace switcher, the email rail and the settings nav.
- **DS-AC7** — NavRow: count and ⋯ share one slot and the label never re-truncates on hover. ⋯ works by right-click and keyboard and stays visible while its menu is open. The active row exposes `aria-current`.
- **DS-AC8** — MetaCount, FilterBar/FilterChip and DisplayMenu exist as generic primitives with stories, and the persisted view-prefs helper is unit-tested.
- **DS-AC9** — The drag visuals exist as shared pieces with stories.
- **DS-AC10** — Storybook can switch accent, theme, radius and font as well as density and shade.
- **DS-AC11** — Derived tokens resolve correctly on scoped-accent routes.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `src/styles/tokens.test.ts` · "state layer defined for every theme scope" | DS-AC1, DS-AC11 | The new tokens exist and are mapped via `@theme inline` (so they resolve on the element, scoped accents included). |
| visual `tests/visual/state-ladder.spec.ts` (story "Foundations/StateLadder") | DS-AC1, DS-AC2 | One baseline per shade × 3 accents: hover/active/selected rows and a segmented control. |
| `src/components/ui/segmented-control.test.tsx` · "plate lighter than track" | DS-AC2 | Computed lightness of the active plate > the track on dark. |
| `src/global-css.test.ts` · "global thin scrollbar + webkit fallback + opt-out" | DS-AC3 | The base-layer rule, both mechanisms, `.no-scrollbar`, gutter on panes. |
| `src/components/selection-guard.test.ts` · "no selection bars" | DS-AC4 | A drift guard (eyebrow.test pattern): fails on the bar recipe / raw `--selected-*` outside the allowlist. |
| `src/components/ui/button.test.tsx` · "hover differs from rest" | DS-AC5 | The secondary/outline/ghost hover class resolves to a state token ≠ the rest fill. |
| manual · module tabs, workspace switcher, email rail, settings nav | DS-AC6 | Hover vs current page look different. |
| `src/components/ui/nav-row.test.tsx` + story | DS-AC7 | Slot swap without width change; keyboard/right-click menu; aria-current. |
| `src/components/ui/filter-bar.test.tsx`, `display-menu.test.tsx`, `src/lib/view-prefs.test.ts` | DS-AC8 | Generic APIs render from a config; prefs read/write per scope; corrupt storage falls back. |
| stories · DragVisuals | DS-AC9 | Line, tint, overlay, nest preview. |
| manual · Storybook toolbar | DS-AC10 | The accent/theme/radius/font globals switch the preview. |

## Assumptions & technical decisions

1. **New tokens added beside the old ones** in `tokens.css`, mapped through `@theme inline` so utilities (`bg-state-hover`, `bg-state-active`, `bg-state-selected`, `ring-state-selected`, `border-hairline`, `bg-control-raised`) emit the `color-mix()` on the element. That makes it scoped-accent safe:
   - `--state-hover`: fg 5% over transparent
   - `--state-active`: fg 9%
   - `--state-selected`: primary 13%
   - `--state-selected-ring`: primary 32%
   - `--hairline`: fg 10%
   - `--control-raised`: fg 14% over `--muted` on dark; card + shadow on light

   *Rejected: redefining `--accent` in place — it backs ~300 button/icon-button hovers, ~118 menu items and 86 hand-written hovers, and `/60` variants would vanish.*

   *As built (DS-1):* each formula is declared once on `:where(:root, [data-theme], [data-shade], [data-accent])` (zero specificity, so theme overrides win regardless of order) and `@theme inline` maps the utilities to `var(--state-…)`, rather than inlining the `color-mix()` into each utility. Same scoped-accent result, one formula per token, and plain `var()` consumers scope too. `--control-raised` gained `--shadow-control-raised` for the light lift, and `--scroll-thumb` / `--scroll-thumb-hover` carry the scrollbar thumb. See [decisions/design-system.md](../docs/decisions/design-system.md) 2026-10-08.
2. **`--selected-bg` / `--selected-border` stay as aliases** during migration. Each of the 23 consumers is moved explicitly in DS-2 (opaque → translucent is checked per surface).
3. **Global scrollbar** — a low-specificity base-layer rule (`@layer base { * { scrollbar-width: thin; scrollbar-color: … } }` + `::-webkit-scrollbar*` rules) with a thumb at fg 16% / hover 32%:
   - `.scrollbar-thin` stays as an alias (46 refs);
   - `.no-scrollbar` is revived as the opt-out;
   - `scrollbar-gutter: stable` on the main pane scrollers;
   - Radix ScrollArea thumb → same token.

   Tailwind 4.3's built-in scrollbar utilities are not used (2026-10-07 toolchain decision). The `moduo-design-quality` skill's "custom scrollbars = slop" line is amended to "token scrollbars are the system default".
4. **R5 is rewritten:** "selection = `--state-selected` tint (+ optional `--state-selected-ring`), never a bar". DESIGN_SYSTEM §selection and the DF-14 notes are updated. Chat attention and calendar focus edges are reclassified as *status*, not selection.
5. **NavRow / MetaCount / FilterBar / FilterChip / DisplayMenu / drag visuals** live in `src/components/ui/` with stories (CLAUDE/AGENTS rule 5). They wrap shadcn DropdownMenu / Popover / Command / Tooltip.
6. **Guards:** a drift test for selection bars and raw `--selected-*`. `lint:tw` is extended for `bg-[color-mix(`, raw `h-7`/`h-8` on controls, and bare `transition-colors` without a motion token, each with a probe in `design-lint.test.ts`. Adding `lint:js` to CI is out of scope (separate call).
7. **Storybook preview** gains accent / theme / radius / font globals, and resets attributes between stories.

## Execution blocks

| # | Block | Delivers | Covers | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **DS-1** State tokens + global scrollbars + Storybook appearance *(start now)* | new tokens + `@theme` utilities, global scrollbar default + aliases + ScrollArea thumb + pane gutters, Storybook globals, token/CSS tests, docs (DESIGN_RULES token surface, gotchas, skill line) — no component restyling yet | DS-AC3, DS-AC10, DS-AC11 (+ token half of AC1) | — |
| 2 | **DS-2** Primitives on the state layer + tint-only selection | SegmentedControl/Tabs/email-connect raised plate; Button/IconButton/menu/select/command/Badge states; remove the 5 bars + task-card ring; hover≠active fixes; R5/DESIGN_SYSTEM/DF-14 docs; selection drift guard; visual baselines regenerated deliberately | DS-AC1, AC2, AC4, AC5, AC6 | DS-1 |
| 3 | **DS-3** NavRow + MetaCount (+ Tasks rail adoption) | primitives + stories; Tasks bucket rail rebuilt on NavRow (swap, dots, aria-current, collapse persisted, drop-target state API) | DS-AC7, AC8 (MetaCount) | DS-2, TV-Q1 |
| 4 | **DS-4** FilterBar/FilterChip, DisplayMenu, drag visuals, view-prefs helper | primitives + stories + helper (adoption in Tasks TV-U2/TV-U4) | DS-AC8, AC9 | DS-2 |
| 5 | **DS-5** Sweep (follow-up) | NavRow in email rail → access → chat → calendar → notes tree → settings nav; remaining hand-written hovers → state utilities; lint:tw extensions | DS-AC1 everywhere | DS-3, DS-4 |

## Out of scope

- Light-mode palette tuning.
- Redesigning other modules' layouts — DS-5 swaps primitives only.
- Adding `lint:js` to CI.
- Visual baselines in CI — they stay human-captured.

---

## Definition-of-Ready gate

- [x] Scope, behavior, edge cases, ACs filled.
- [x] Every AC has a test with a plain-English note.
- [x] Open questions empty (selection hairline vs tint-only is decided visually in DS-2 from the comp; both are implemented behind one token).
- [x] Data model: n/a (CSS tokens + components).
- [x] Module feature: n/a (foundation).
- [x] Blocks sequenced and context-sized.
- [x] Design constraints: this spec *is* the token/primitive change; R5 rewritten, R6 respected.
- [x] Manual-test surfaces: every module's rows/rails/toggles on dark across 2–3 shades; desktop scrollbars on old and new macOS.

**Ready to execute** (DS-1 now; DS-2+ in order).

## Open questions

- [ ] (none)
