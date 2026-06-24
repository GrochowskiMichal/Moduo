# Design rules

> **Status: DRAFT — pending ratification.** These are product/design decisions; only the designer can ratify them. Drafted from the live `src/styles/tokens.css` + `DESIGN_SYSTEM.md`. Once confirmed, the `[DRAFT]` markers come off and the `moduo-design-quality` skill enforces this file.

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
The accent (`--primary` / `--ring`) appears **only** on: (1) **one** primary action per surface (`bg-primary` — never two competing); (2) the current **selection** (`--selected-bg` tint + bar/border recipe); (3) the **focus ring**; (4) the quiet **done-check**. Segmented toggles, priority/energy, and all other chrome stay **neutral**. (Verified AA on all 8 accents — keep it that way when adding one.)

## R6 — Motion signature  [lint+review]
Restrained, with a **fade + micro-blur** signature. Motion tokens are load-bearing — **never** raw `ms`/`cubic-bezier` in components; use `--motion-*` / `--ease-*` via CSS, or `duration-[var(--motion-base)]`. `--motion-fade` for opacity/color (survives reduced-motion at ~80ms); movement durations zero out under reduced-motion. `--blur-veil` for overlay/popover/mode-shift fade-in. **One** sanctioned delight: the check-off `.check-pop`. Reveal-on-hover **reserves space + fades opacity** — never `hidden → flex` (it reflows). No spring-heavy / sparkle / glow motion. *(lint should flag `duration-200` / `duration-[…ms]`; the rest is review.)*

## R7 — Density is per-instance dimensions, not the spacing scale  [review]
`data-density` (comfortable / compact / dense) swaps `--row-h`, `--ctrl-h`, `--pad-*`, and the icon ladder — three steps; the dense end ≈ Linear/Notion chrome. Primitives consume these via `height: var(--ctrl-h)` etc., **not** a literal `h-9` (which bypasses density). Density is also the **type-size axis** (`data-text-size` retired). Spacing utilities (`p-4`, `gap-2`) do **not** change with density.

## R8 — Casing  [review]
**Sentence case** everywhere ("New task", "Mark done", "Add description"). Standalone status words and proper nouns stay capitalized (Done, Today, Inbox, Skip, CRM). Counts read like "2 / 2 Done".

## R9 — One font, one picker  [review]
A single `data-font` axis (default **Geist**) drives the whole UI — `--font-ui` feeds **both** `--font-display` and `--font-body`. No second family axis, no per-component font. Hierarchy comes from weight and size. The display/body *role* split (R4) is kept so a distinct display face can return later without touching component code.

## R10 — Tokens only; token edits are system edits  [lint+review]
Never hardcode color / size / radius / shadow / font / duration in components, and never invent a per-component CSS variable. If the right value is missing, **add it to `tokens.css`** (a reviewed, system-wide change) — don't inline it. Compose variants with opacity/mix (`bg-primary/80`, `bg-foreground/10`). *(lint catches the catchable shapes — see Token surface; the rest is review.)*

---

## Token surface — Tailwind utility vs `var()`-only

Knowing which scale is a first-class utility tells you when an arbitrary value is *drift* vs *necessary*.

- **Tailwind utilities (via `@theme` in tokens.css):** color (`bg-/text-/border-/ring-` semantic), radius (`rounded-*`), font-family (`font-display/-sans/-mono`), icon size (`size-icon-*`), type scale (`text-2xs`…`text-5xl`), shadow (`shadow-*`). → Use the utility. An arbitrary value here is almost always drift.
- **`var()`-only (no utility):** spacing (use Tailwind's built-in `p-`/`gap-`/`m-`), z-index (`--z-*`), motion/ease (`--motion-*`/`--ease-*`), layout widths (`--width-*`, `--bar-h`), density dims (`--row-h`/`--ctrl-h`/`--pad-*`), leading/tracking/weight, `--blur-veil`, selection (`--selected-*`), label hues (`--label*`). → Reach for `var(--…)` (in CSS or, sparingly, `[var(--…)]`), never a magic number.

## `--space-*` tokens are currently inert
`--space-0`…`--space-24` exist in tokens.css but are **not** in `@theme` and have **0 references** in `src/`. `p-4` resolves to Tailwind's built-in 4px scale, **not** these vars. They're a reserved hook for a possible future density-driven spacing axis. Until that ships, treat **Tailwind's built-in spacing** as the spacing source of truth. *(Open: keep as a reserved hook, or delete? — designer's call.)*
