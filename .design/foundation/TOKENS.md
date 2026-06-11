# Tokens Reference: Moduo Foundation

> Companion to [src/styles/tokens.css](../../src/styles/tokens.css). Documents the rationale for every token category, naming convention, and how user customization composes.
>
> **Naming follows shadcn** (`--background`, `--foreground`, `--card`, `--primary`, etc.) because we adopted shadcn for primitives. Generic semantic names (`--color-bg-primary` etc.) are deliberately not used.

## How customization composes

Every customization axis is a single `data-*` attribute on `<html>`. They compose freely — accent + density + radius + fonts are orthogonal.

| Axis | Attribute | Values | Default | What it swaps |
| --- | --- | --- | --- | --- |
| Theme | `data-theme` | `dark`, `light` | `dark` | `--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--border`, all shadows |
| Accent | `data-accent` | `pink`, `violet`, `blue`, `green`, `amber`, `red`, `teal`, `mono` | `pink` | `--primary`, `--primary-hover`, `--primary-active`, `--ring` |
| Density | `data-density` | `comfortable`, `compact`, `dense` | `comfortable` | `--row-h`, `--ctrl-h`, `--pad-x`, `--pad-y` (and size variants) |
| Radius | `data-radius` | `sharp`, `soft`, `round` | `soft` | `--radius`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl` |
| Display font | `data-font-display` | `pilat`, `geist`, `cal`, `fraunces` | `pilat` | `--font-display` |
| Body font | `data-font-body` | `geist`, `inter`, `serif`, `mono` | `geist` | `--font-body` (Tailwind's `font-sans` resolves here) |
| Body text size | `data-text-size` | `small`, `normal`, `large` | `normal` | `--text-xs`, `--text-sm`, `--text-base`, `--text-md` (display sizes stay fixed) |

Single source of truth: the variant attribute. The cascade does the rest — no React re-render required to change appearance.

## Color system

### Two layers
1. **Raw palette** — `--neutral-50…975` and per-accent `--{color}-{base|hover|active}`. Stored in OKLCH for perceptually uniform lightness.
2. **Semantic tokens** — `--background`, `--foreground`, `--card`, `--popover`, `--primary`, etc. These are what components reference; never reach for the raw palette in component code.

### Surface model (Spotify-derived, shadcn 3-layer)
- `--background` (pure black, `oklch(0 0 0)`) → app canvas
- `--card` (neutral-900) → panels, sidebar rows, raised surfaces
- `--popover` (neutral-850) → dropdown menus, popovers, overlays
- `--muted` (neutral-850) → input wells (same as popover, intentionally)
- `--accent` (neutral-800) → row hover fill (yes, "accent" means "hover surface" in shadcn — NOT the user's accent color, which is `--primary`)
- `--border` (neutral-800) → 1px hairlines

This 3-layer ladder gives the eye structure that the first-draft screenshot was missing.

### Text colors
- `--foreground` (neutral-50) → primary text
- `--muted-foreground` (neutral-400) → secondary text, captions, labels

`--muted-foreground` at neutral-400 (oklch 0.72) is intentionally bright. The first-draft used neutral-500ish which is what produces the "body fades into bg" effect. We're paying for contrast.

### Accent (the user-customizable color)
The user's selection drives `--primary`, `--primary-hover`, `--primary-active`, `--ring`. Eight options pre-tuned at ~0.68 lightness, ~0.20 chroma so every option reads correctly against `--background`.

`--primary-foreground` is dark on every accent except `mono` (where it's also dark since mono is near-white).

### Status colors (fixed, not user-customizable)
`--success`, `--warning`, `--danger`, `--info`. Distinct from accents — if a user picks "green" as their accent, success states still read as success because they have their own swatches.

### What components reference
Component code may only use semantic tokens via Tailwind utilities:
- `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-accent`, `bg-primary`
- `text-foreground`, `text-muted-foreground`, `text-primary-foreground`
- `border-border`, `border-input`
- `ring-ring`

Never `bg-[#xxxxxx]`, never `text-zinc-400`, never `bg-neutral-900`. The Stylelint config will enforce this.

## Spacing — 4px base

Standard Tailwind v4 spacing scale. `--space-1` = 4px. Defined as variables so density variants can override if needed (currently density only changes row/control sizes, not spacing scale, but the door is open).

Use Tailwind utilities (`p-4`, `gap-2`, etc.) — they map to these tokens via the `@theme` block.

## Density — row/control sizing

Density doesn't change the spacing scale. It changes the **per-instance dimensions** of components. Three steps on an even 4px row ladder; the dense end matches Linear/Notion chrome (pair with text-size `small` for the full Linear feel).

| Token | Comfortable | Compact | Dense | Use for |
| --- | --- | --- | --- | --- |
| `--row-h` | 36px | 32px | 28px | Sidebar tree items, list rows |
| `--row-h-sm` | 28px | 26px | 24px | Nested rows |
| `--ctrl-h` | 32px | 30px | 26px | Buttons, inputs (default size) |
| `--ctrl-h-sm` | 26px | 24px | 22px | Small buttons |
| `--ctrl-h-lg` | 40px | 36px | 32px | Large buttons |
| `--pad-x` | 16px | 14px | 12px | Primary horizontal padding |
| `--pad-y` | 10px | 8px | 6px | Primary vertical padding |
| `--pad-x-sm` | 12px | 10px | 8px | Rail / nested horizontal padding |
| `--pad-y-sm` | 6px | 5px | 4px | Rail / nested vertical padding |

Rows consume `--row-h` as a `min-height` (with a small fixed `py` as a multiline guard) so single-line rows track density exactly and wrapped content can still grow.

Component primitives consume these via inline `height: var(--ctrl-h)` or CSS. Tailwind utility classes for size (`h-9`, etc.) bypass density — so primitives must reach for the variable, not the literal class.

## Radius — corner discipline

One root variable, four derived. The three user variants set all four derived values explicitly (not via `calc()`, because `calc()` with negative numbers behaves badly at 0).

| Token | Sharp | Soft (default) | Round |
| --- | --- | --- | --- |
| `--radius-sm` | 0 | 4px | 8px |
| `--radius` | 0 | 8px | 16px |
| `--radius-md` | 0 | 8px | 16px |
| `--radius-lg` | 0 | 12px | 20px |
| `--radius-xl` | 0 | 16px | 24px |
| `--radius-full` | 9999px | 9999px | 9999px |

`--radius-full` stays for pills regardless of the variant.

Default usage:
- Buttons, inputs → `rounded-md` (8px soft)
- Cards, panels → `rounded-lg` (12px soft)
- Dialogs → `rounded-xl` (16px soft)
- Avatars, status dots → `rounded-full`

## Typography

### Two roles
- **Display** — page titles, logo, hero numbers. Default Pilat Extended. User-customizable to Geist Sans, Cal Sans, or Fraunces.
- **Body** — paragraphs, labels, every UI surface. Default Geist Sans. User-customizable to Inter, Source Serif Pro, or Geist Mono.

Tailwind's `font-display` utility resolves to `--font-display`. Tailwind's `font-sans` resolves to `--font-body`. `font-mono` is always mono.

### Type scale (14px base)
| Token | Default size | Use for |
| --- | --- | --- |
| `--text-xs` | 12 | Captions, micro-labels |
| `--text-sm` | 13 | Secondary UI text |
| `--text-base` | 14 | **Body** — paragraphs, default UI |
| `--text-md` | 15 | Emphasised body |
| `--text-lg` | 18 | Small headings |
| `--text-xl` | 20 | Section headings |
| `--text-2xl` | 24 | Page headings (H1 on most pages) |
| `--text-3xl` | 30 | Display |
| `--text-4xl` | 36 | Hero |
| `--text-5xl` | 48 | Auth hero |

### Text-size variants
User-selectable. Only the **body tier** (xs/sm/base/md) shifts — display sizes (lg+) stay fixed so page titles don't change with this preference.

The base ladder is 13 / 14 / 16 — small ≈ Linear UI text, normal ≈ Notion
chrome, large stays generous.

| | Small | Normal | Large |
| --- | --- | --- | --- |
| `--text-xs` | 11 | 12 | 13 |
| `--text-sm` | 12 | 13 | 14 |
| `--text-base` | 13 | 14 | 16 |
| `--text-md` | 14 | 15 | 17 |

### Line height & tracking
- `--leading-tight` 1.2 — display
- `--leading-snug` 1.35 — headings
- `--leading-normal` 1.5 — body
- `--leading-relaxed` 1.65 — long-form prose

- `--tracking-tight` -0.015em — display
- `--tracking-normal` 0 — body
- `--tracking-wide` 0.04em — all-caps labels

## Shadows — theme-dependent

Dark mode shadows are subtle drop shadows with high opacity (since pure-black already absorbs light). Light mode shadows are stronger to create lift against bright surfaces.

| Token | Use for |
| --- | --- |
| `--shadow-xs` | Hairline depth on cards |
| `--shadow-sm` | Default raised surface |
| `--shadow-md` | Popovers, dropdowns |
| `--shadow-lg` | Sheets |
| `--shadow-overlay` | Dialogs |
| `--shadow-focus` | Composite focus ring (background spacer + ring color) |

## Motion

| Token | Value | Use for |
| --- | --- | --- |
| `--motion-instant` | 0ms | State changes that shouldn't animate |
| `--motion-fast` | 100ms | Hover, focus rings, tooltips |
| `--motion-base` | 180ms | Most transitions (default) |
| `--motion-slow` | 320ms | Theme switch, accent switch, panel open |
| `--motion-slower` | 500ms | Page transitions, sheet slide-in |

| Easing | Curve | Use for |
| --- | --- | --- |
| `--ease-out` | (0.16, 1, 0.3, 1) | Drift-in (default for opens) |
| `--ease-in-out` | (0.65, 0, 0.35, 1) | Symmetric (theme switch) |
| `--ease-in` | (0.7, 0, 0.84, 0) | Drift-out (closes) |
| `--ease-spring` | (0.34, 1.56, 0.64, 1) | Gentle overshoot — rare |

`prefers-reduced-motion: reduce` collapses every duration to 0ms. No JS opt-out needed; the cascade handles it.

## Z-index

Ten-step scale in increments of 10 — leaves room between layers without inflation.

| Token | Value | Layer |
| --- | --- | --- |
| `--z-base` | 0 | Content |
| `--z-sticky` | 10 | Sticky headers within content |
| `--z-rail` | 20 | Sidebars and right rails |
| `--z-header` | 30 | App top bar |
| `--z-dropdown` | 40 | Dropdowns from the top bar |
| `--z-overlay` | 50 | Modal backdrops |
| `--z-dialog` | 60 | Dialogs |
| `--z-popover` | 70 | Floating popovers |
| `--z-tooltip` | 80 | Tooltips |
| `--z-toast` | 90 | Toasts (always on top of normal flow) |
| `--z-debug` | 100 | Dev overlays |

## Layout dimensions

| Token | Value | Use for |
| --- | --- | --- |
| `--width-sidebar` | 256 | Default left rail |
| `--width-sidebar-icon` | 56 | Collapsed left rail |
| `--width-rail` | 320 | Default right rail |
| `--width-rail-icon` | 48 | Collapsed right rail |
| `--width-content-max` | 1040 | Center column cap on wide screens |
| `--width-prose-max` | 672 | Reading width for Notes body |

## Tailwind v4 mapping

The `@theme inline` block at the bottom of [tokens.css](../../src/styles/tokens.css) is what makes Tailwind utilities point at our tokens. After this is wired up:

- `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-primary`, `bg-secondary`, `bg-accent`, `bg-destructive`, `bg-success`, `bg-warning`, `bg-danger`, `bg-info` → work as expected
- `text-foreground`, `text-muted-foreground`, `text-primary-foreground`, etc. → work
- `border-border`, `border-input` → work
- `ring-ring` → focus ring color
- `rounded-sm`, `rounded`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-full` → respect the radius variant
- `font-display`, `font-sans`, `font-mono` → respect font variants
- `text-xs`…`text-5xl` → respect text-size variant for body sizes

## Open questions / deferred decisions

- Light mode swatches are structurally there but not visually tuned. Real light-mode design is its own brief.
- Per-accent `--primary-foreground` is dark on all 8. If amber proves problematic against dark text, dial up to mid-tone foreground (oklch 0.30 0 0). Verify in `/design-review`.
- Density variants currently don't shift line-height. If compact density feels cramped at full leading, add `--leading-normal` overrides per density.
- No label colors (for tags / event categories / status pills outside the four status tokens). Add a curated label palette in a follow-up if the apps's tag UX needs it.
