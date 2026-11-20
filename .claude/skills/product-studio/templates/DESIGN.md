# Design

The visual system of this product and the rules that relate its values. Sections follow the order
of the DESIGN.md format (Overview, Colors, Typography, Layout, Elevation & Depth, Shapes,
Components, Do's and Don'ts). **Values live in the token file** (`<path to tokens.css>`), which is
the single source of truth; this file names roles and rules. Add the format's optional YAML token
frontmatter only if a tool needs it, generated from the token file.

## Overview

The character of the interface in two or three sentences, traced to PRODUCT.md's one idea.
Register: a working product surface (scanability, consistency and native manners outrank
expression).

### Brand in the product

```
Voice:   plain, calm, specific
Reader:  "you"; sentence case
Accent:  <oklch value>, used for the primary action, selection, focus and completion only
Type:    <UI family>; <display face or "none">
Icons:   <set>, <stroke> stroke, <corner style>
```

Translations from marketing brand guidelines, if any, and why.

## Colors

| Role | Token | Use |
|---|---|---|
| Background | `--color-bg` | The window |
| Surface | `--color-surface` | Panels and cards |
| Raised | `--color-raised` | Menus, popovers, dialogs |
| Border | `--color-border` | Hairlines and separators |
| Text | `--color-text` | Primary text |
| Muted text | `--color-text-muted` | Secondary text, meta |
| Accent | `--color-accent` | Primary action, selection, focus, completion |
| Status | `--color-success`, `--color-warning`, `--color-danger`, `--color-info` | Status only, always with a shape or word |

Neutrals are tinted toward the background hue. Every text role passes AA in every theme.

## Typography

| Role | Token | Size / weight | Use |
|---|---|---|---|
| Body | `--text-base` | 14 / 400 | Content, values |
| Small | `--text-sm` | 13 / 400 | Meta, secondary |
| Caption | `--text-xs` | 12 / 500 | Labels, badges |
| Heading | `--text-lg` | 18 / 600 | Section titles |
| Title | `--text-xl` | 20 to 24 / 600 | View titles |

One family for the UI. Numbers that line up use tabular figures. Hierarchy comes from size,
weight and color.

## Layout

- Spacing grid: 4 px (`--space-*`).
- Control rung: small, medium, large (`--control-h-sm`, `--control-h`, `--control-h-lg`); a rung
  fixes height, font size, icon size and radius together.
- Density: `data-density` swaps row height, control height and padding; the spacing scale stays.
- Minimum window: <width x height>. Layout changes structurally (a panel collapses), never by
  fluid type.

## Elevation & Depth

| Level | Token | Use |
|---|---|---|
| 0 | none | The window and inline content |
| 1 | `--shadow-1` | Cards that lift on drag |
| 2 | `--shadow-2` | Menus and popovers |
| 3 | `--shadow-3` | Dialogs |

Focus: a 2 px ring in the accent with a 2 px offset (`--focus-ring`), on `:focus-visible` only.

## Shapes

| Role | Token |
|---|---|
| Chips, badges | `--radius-sm` |
| Controls, rows | `--radius-md` |
| Cards | `--radius-lg` |
| Panels, dialogs | `--radius-xl` |
| Avatars, pills | `--radius-full` |

Nested radius = outer radius minus padding, snapped to the scale.

## Components

The primitives live in `<path>` and wrap `<component library>`. Each interactive primitive has
default, hover, focus-visible, active and disabled states, plus loading and error where it does
work. One story per state in `<catalogue>`.

### Motion

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | 100 ms | Hover, press |
| `--motion-base` | 180 ms | Menus, popovers |
| `--motion-slow` | 250 ms | Dialogs, panels, view switches |
| `--ease-out` | decelerating | Entry |
| `--ease-in` | gentle acceleration | Exit |

## Do's and Don'ts

- Do use the accent only for the primary action, the selection, focus and completion.
- Do keep adjacent controls on one rung.
- Do animate only `transform` and `opacity`, and nothing triggered by the keyboard.
- Do design empty, loading, error, dense and long-content states for every view.
- Don't write a value that is not a token; add the token first.
- Don't nest cards; separate with space and hairlines.
- Don't use a display face in labels, buttons or data.
