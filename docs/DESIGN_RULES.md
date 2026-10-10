# Design rules

> **Status: Ratified 2026-06-25.** These are product/design decisions, confirmed by the designer and distilled from the live `src/styles/tokens.css` + `DESIGN_SYSTEM.md`. The `moduo-design-quality` skill enforces this file; change a rule here before changing component behaviour.

`tokens.css` holds the **values**; this file holds the **relationships between them** — the "these scale together / this is reserved for that / this never pairs with that" rules a flat token list can't express. Each rule is tagged **[lint]** (a script can catch violations), **[review]** (only a human/skill reading the diff can), or **[lint+review]**.

---

## R1 — Control rung bundle  [review]
A control "rung" (sm / md / lg) is a **fixed bundle**, so any two controls on the same row stack pixel-perfect:
- **height** — `--ctrl-h-sm` (26) / `--ctrl-h` (32) / `--ctrl-h-lg` (40), density-scaled;
- **font** — `font-display`, **`text-base` (14px) held constant across all rungs** — size changes height/padding only, *never* the font size;
- **icon** — `size-icon-sm` (14);
- **radius** — `rounded-md`.

Put control rows in `Toolbar`; keep every child on one rung. Bind a control's SVG default to the rung — don't hardcode `size-4`.

## R2 — Radius scales with size/role  [lint+review]
Radius grows with element size: `--radius-sm` < `--radius`/`--radius-md` < `--radius-lg` < `--radius-xl` (the `sharp`/`soft`/`round` variant sets all of them; `soft` = 4 / 8 / 12 / 16). **Role map:** buttons & inputs → `rounded-md`; cards & panels → `rounded-lg`; dialogs → `rounded-xl`; avatars, pills, status dots → `rounded-full`. Never `rounded-[Npx]`. *(lint catches arbitrary radius; the role map is review.)*

## R3 — Concentric inner radius  [review]
A rounded child nested in a rounded parent uses `inner = max(outer − padding, 0)`, snapped to the nearest scale step, so the curves read as concentric, not parallel. Applies to widget cards in panels, notification cards in sheets, chip rows in cards, graph nodes in rail cards.

## R4 — Type roles  [review]
- **Chrome** (headings, control labels, button text, section eyebrows) → `font-display`.
- **Content** (task/note titles, select *values*, descriptions, metadata, numerics) → `font-sans` (body). Numerics add `tabular-nums`.
- **Eyebrows / section labels** → body at **`text-2xs`** (the display face reads too large at 11px).
- **Buttons are always `font-display`** (set in the `Button` base). `font-mono` is **code only**.

Today both roles resolve to the single `data-font` family (default Geist), so the split is by **weight / size / `tabular-nums`** and future-proofing — not by typeface (see R9).

## R5 — Accent usage  [review]
The accent (`--primary` / `--ring`) appears **only** on: (1) **one** primary action per surface (`bg-primary` — never two competing); (2) the current **selection**; (3) the **focus ring**; (4) the quiet **done-check**; (5) a few **status** marks that aren't selection: the chat attention bar and mention tint, the unread dot and divider, the calendar focus edge, "today" and "now" markers, drag/drop targets. Segmented toggles, priority/energy, and all other chrome stay **neutral**. (Verified AA on all 8 accents — keep it that way when adding one.)

**Selection is tint-only, never a bar** (DS-2, 2026-10-08):
- **A selected item in a list** (task row, note in the tree, email thread, contact, a picker row) gets `SELECTED_ROW` from `src/components/ui/selection.ts` (`bg-state-selected ring-1 ring-inset ring-state-selected-edge`). That's the accent tint plus the row hairline switch: `--state-selected-edge` in tokens.css ships as the 32% ring and becomes `transparent` for tint-only.
- **Cards and bordered options** (board cards, booking chips, option cards) use `SELECTED_OPTION`: the tint plus `ring-state-selected`, always, on a transparent border.
- **The current destination in a rail or nav** (the module tab, the open channel, the settings section, the current workspace, the email scope) is not "selected": it takes the neutral `bg-state-active`, and hover is `bg-state-hover`.
- **Status marks** compose `--primary` directly (`bg-primary`, `bg-primary/14`), never the selection utilities.
- `src/components/selection-guard.test.ts` fails on an accent bar or a retired `--selected-*` use outside its status allowlist.

## R6 — Motion foundations  [lint+review]
Quiet and quick, **no blur** (tasks-v3 call 81, SH-1, 2026-10-10; blur may return later only on small hovers, never on slide-ins, and only if it costs no performance). Motion tokens are load-bearing — **never** raw `ms`/`cubic-bezier` in components; use `--motion-*` / `--ease-*` via CSS, or `duration-[var(--motion-base)]`.
- **Three durations:** `--motion-fast` (100 ms) for hover and press; `--motion-base` (180 ms) for menus and popovers; `--motion-slow` (280 ms) for panels and view switches. **One easing family:** `--ease-out` when something arrives, the quicker `--ease-in` when it leaves.
- **Four patterns, as shared classes in `global.css`** (never per-component keyframes): `.motion-panel` (a panel slides and fades), `.motion-pop` (a popover, menu, select or dialog grows from where it was opened; built into the primitives), `.motion-row` (a row's height and opacity on add/remove), `.motion-view` (views crossfade).
- **Reduced motion = opacity only.** Opacity runs on `--motion-fade` (~80 ms under reduce); movement runs on fast/base/slow (zeroed) and travels `--motion-shift` / `--motion-grow` (neutral). Both the OS setting and `data-motion` (Settings → Preferences) drive it.
- **No `backdrop-filter`** anywhere. **One** sanctioned delight: the check-off `.check-pop`; signature moments come after every module is rebuilt. Reveal-on-hover **reserves space + fades opacity** — never `hidden → flex` (it reflows). No spring-heavy / sparkle / glow motion. *(`src/styles/motion.test.ts` guards the tokens, the patterns and the blur ban; lint flags `duration-200` / `duration-[…ms]`; the rest is review.)*

## R7 — Density is per-instance dimensions, not the spacing scale  [review]
`data-density` (comfortable / compact / dense) swaps `--row-h`, `--ctrl-h`, `--pad-*`, and the icon ladder — three steps; the dense end ≈ Linear/Notion chrome. Primitives consume these via `height: var(--ctrl-h)` etc., **not** a literal `h-9` (which bypasses density). Density is also the **type-size axis** (`data-text-size` retired). Spacing utilities (`p-4`, `gap-2`) do **not** change with density.

## R8 — Casing  [review]
**Sentence case** everywhere ("New task", "Mark done", "Add description"). Standalone status words and proper nouns stay capitalized (Done, Today, Inbox, Skip, CRM). Counts read like "2 / 2 Done".

## R9 — One font, one picker  [review]
A single `data-font` axis (default **Geist**) drives the whole UI — `--font-ui` feeds **both** `--font-display` and `--font-body`. No second family axis, no per-component font. Hierarchy comes from weight and size. The display/body *role* split (R4) is kept so a distinct display face can return later without touching component code.

## R10 — Tokens only; token edits are system edits  [lint+review]
Never hardcode color / size / radius / shadow / font / duration in components, and never invent a per-component CSS variable. If the right value is missing, **add it to `tokens.css`** (a reviewed, system-wide change) — don't inline it. Compose variants with opacity/mix (`bg-primary/80`, `bg-foreground/10`). *(lint catches the catchable shapes — see Token surface; the rest is review.)*

---

## R11 — Three readable text levels  [review]
Every module uses three readable levels (tasks-v3 call 38, DS-6): **primary** `text-foreground` (titles, content) · **secondary** `text-muted-foreground` (meta, labels, ~8.5:1) · **tertiary** `text-subtle-foreground` (timestamps, hints, counts, ≥ 4.5:1). One **decorative** level below them, only for things that carry no information (a priority glyph's ghost bars, placeholders, disabled controls). Done, past and disabled are **states** (a row fade, a strikethrough), not text colours. A new one-off fade (`/40`, `/50`, `/60`) is not a level.

## R12 — People's words: never capitalised, never turned  [lint]
- **Sentence case as typed** (call 40): a group, column, lane, rail section or day header uses `GroupHeader`, which shows the name exactly as a person wrote it. Small caps (`Eyebrow`, the menu labels on its recipe) are for **fixed chrome only**. `lint:tw` (scripts/check-text-rules.ts) fails an `Eyebrow` / menu label whose children hold an expression that isn't on its reviewed allowlist, `eyebrowVariants()` outside `src/components/ui`, the `capitalize` utility and `font-variant` small caps; `lint:css` fails `text-transform: uppercase | capitalize` and `font-variant` small caps.
- **Text is never rotated** (call 46a): no sideways labels on folded columns, lanes or axes. Both linters fail `writing-mode` / `text-orientation` and a 90° / 270° turn; `lint:tw` lets an icon turn (an `<svg>`, a lucide import, `…Icon` / `Chevron…` / `Arrow…` / `Caret…`).

## R13 — One floating surface, 24 px targets  [lint+review]
- Every popover, menu, context menu, select list and tooltip is `FLOATING_SURFACE` (`src/components/ui/surface.ts`): the popover fill, a 1 px hairline, `rounded-md`, the `motion-pop` arrival. `surface.test.ts` fails a caller that re-skins one (`rounded-lg`, `border-border`, a card fill) or a tw-animate entrance on the primitives.
- A pointer target is at least **24 × 24 px** (WCAG 2.2 "Target size"): a smaller control keeps its glyph and takes `.hit-min`, which pads the hit area with an invisible `::before` (`--hit-min`).

## Token surface — Tailwind utility vs `var()`-only

Knowing which scale is a first-class utility tells you when an arbitrary value is *drift* vs *necessary*.

- **Tailwind utilities (via `@theme` in tokens.css):** color (`bg-/text-/border-/ring-` semantic), radius (`rounded-*`), font-family (`font-display/-sans/-mono`), icon size (`size-icon-*`), type scale (`text-2xs`…`text-5xl`), shadow (`shadow-*`). → Use the utility. An arbitrary value here is almost always drift.
- **State layer (tokens.css §5b, DS-1/DS-2):** `bg-state-hover` (hover) · `bg-state-active` (current page, pressed toggle, the highlighted menu/select/command option) · `bg-state-active-hover` (hovering a control that is already filled: a secondary button, an "on" toggle) · `bg-state-selected-hover` (hovering a selected row or card, DS-6) · `text-subtle-foreground` (the tertiary text level, R11) · `bg-state-selected` (the selected item; `ring-1 ring-inset ring-state-selected-edge` on list rows, `ring-state-selected` on cards — see R5) · `border-hairline` / `bg-hairline` / `ring-hairline` (quiet dividers and edges) · `bg-control-raised shadow-control-raised` (the current segment of a segmented control or tab list). Translucent, so they read on any surface on every shade, accent and theme; they re-resolve inside scoped `data-accent` / `data-shade` / `data-theme` wrappers. Every primitive is on them since DS-2; new UI uses them instead of `bg-accent` / `bg-secondary` / `border-border` for interaction states, which are one grey on dark (the old tokens still back un-migrated hovers and are never redefined in place). A translucent state fill REPLACES an opaque rest fill, so a control that already has a fill hovers one step up (`bg-state-active` → `bg-state-active-hover`), never to `bg-state-hover`.
- **`var()`-only (no utility):** spacing (use Tailwind's built-in `p-`/`gap-`/`m-`), z-index (`--z-*`), motion/ease (`--motion-*`/`--ease-*`), layout widths (`--width-*`, `--bar-h`), density dims (`--row-h`/`--ctrl-h`/`--pad-*`), leading/tracking/weight, the retired selection recipe (`--selected-*`: no consumers since DS-2, guarded, deleted in DS-5), scrollbar thumb (`--scroll-thumb` / `--scroll-thumb-hover`), label hues (`--label*`). → Reach for `var(--…)` (in CSS or, sparingly, `[var(--…)]`), never a magic number.

## Scrollbars
Thin, token-coloured scrollbars are the **global default** (global.css, base layer): no container opts in, and no component restyles its own bar. `.no-scrollbar` hides one where a design wants none (chip rows, carousels) and covers old WebKit too; a bare `[scrollbar-width:none]` does not. `.pane-scroll` reserves the gutter on a pane's main scroller (center list or document, rail, inspector) so content doesn't jump when the bar appears; put it on the element that scrolls, never on a wrapper whose child scrolls. `.scrollbar-thin` is a no-op alias kept for old call sites. Tailwind's own `scrollbar-*` utilities are not used.

## Spacing source
Spacing uses **Tailwind v4's built-in 4px scale** (`p-4`, `gap-2`, `mx-3`). The former `--space-*` mirror tokens were **removed 2026-06-25** (0 refs, never in `@theme`). If a density-driven spacing axis is ever needed, re-introduce a scale in tokens.css and wire it into `@theme`.
