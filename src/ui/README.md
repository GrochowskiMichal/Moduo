# src/ui — Subframe-synced code

This directory is owned by **Subframe** (project `7ca01b82733e`). Files here are
generated/synced by the Subframe CLI (`npx @subframe/cli sync`) — don't hand-edit
them; edit the design in Subframe and re-sync. It's exempt from the design-system
linters (`lint:css` ignores `src/ui/**`; `lint:tw` ignores `src/ui`) because it
carries Subframe's own idioms.

## theme.css is NOT imported into the app — on purpose

`theme.css` is Subframe's mirror of our design system, emitted as **rgb** with the
**same** `@theme` token names as [`src/styles/tokens.css`](../styles/tokens.css)
(`--color-background`, `--color-primary`, …). If it were imported **after**
`tokens.css` in `global.css`, it would **override** our authoritative **oklch**
tokens with Subframe's rgb approximations and shift the whole app's colors.

`tokens.css` is the single source of truth (see DESIGN_SYSTEM rule 1). So
`theme.css` is currently **not imported anywhere**. There are no synced Subframe
components yet, so nothing needs it.

## When you sync the first component (`/subframe:develop`)

Subframe components use Tailwind utilities (`bg-primary`, `text-muted-foreground`,
`rounded-md`, …) whose **names already exist** in `tokens.css`, so they pick up our
tokens automatically. If a component needs a palette utility `tokens.css` doesn't
expose (e.g. `bg-neutral-800`, `bg-label-blue`), import `theme.css` **before**
`tokens.css` in `src/global.css`:

```css
@import "tailwindcss/utilities.css";
@import "./ui/theme.css";      /* Subframe palette utilities (rgb) */
@import "./styles/tokens.css"; /* AUTHORITATIVE — oklch wins shared names */
```

Order matters: `tokens.css` must come **last** so its oklch values win for shared
token names. Keep `tokens.css` as the source of truth — never let Subframe author
new design values; mirror from `tokens.css` into the Subframe theme instead.

- Import alias: `@/ui/*` → `src/ui/*` (via tsconfig `@/*`).
- Re-sync: `npx @subframe/cli sync`.
