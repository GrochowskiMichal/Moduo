# Design system: detect, adopt, fill or define

A product surface is only as consistent as the system it draws from. This file decides which
system that is. The answer is always one of three: the house system as it stands, the house
system with its gaps filled, or a new system you define. Never two systems side by side.

## Precedence

1. **House rules**: the project's tokens, design rules, component library, lint rules and design
   skills. They win every conflict.
2. **Brand guidelines**: voice, color, type and imagery the brand has fixed. They win over this
   skill, and lose to house rules where both speak (house rules already encode the brand for UI).
3. **This skill's defaults**: used only where the first two are silent.

When a default here contradicts the house, follow the house and list the conflict in your final
message. Never "improve" a house value on your own; a token change is a system edit the owner
makes.

## Detect: where systems hide

Search the whole repository, workspaces included. Record every hit with its path.

| Look for | Typical paths and names |
|---|---|
| Token files | `tokens.css`, `variables.css`, `theme.css`, `globals.css` with `:root { --… }`, `tailwind.config.*`, `@theme` blocks in Tailwind v4 CSS, `tokens.json`, Style Dictionary sources, `theme.ts` |
| System docs | `DESIGN.md`, `DESIGN_SYSTEM.md`, `DESIGN_RULES.md`, `docs/design*`, `STYLEGUIDE.md`, a design section in `AGENTS.md` or `CLAUDE.md` |
| Brand | `brand/`, `.design/brand/`, `BRAND*.md`, `brand-guidelines.pdf`, logo folders, voice and tone docs |
| Component library | `components/ui/` (shadcn), `components.json`, Radix, MUI, Chakra, Mantine, Ark, a local `packages/ui` |
| Catalogue | Storybook (`.storybook/`, `*.stories.tsx`), Ladle, Histoire |
| Enforcement | Stylelint value rules, Tailwind lint scripts, design-token lint, hooks that run after UI edits, visual tests |
| Agent rules | project skills or rules files about design (for example `<project>-design-quality`), `.cursor/rules`, `.impeccable/`, PRODUCT.md |
| Fonts | font files, `@font-face`, font loaders, a font picker setting |

Read in this order: agent rules and design docs first (they tell you how the rest relates), then
token files, then the component library, then three neighbouring screens to see the system in
use.

**Classify** what you found:

| Found | Verdict | Next |
|---|---|---|
| Tokens for color, type, space, radius and motion, plus rules or a design skill | Complete | Adopt |
| Tokens for some families, no rules | Partial | Adopt, then fill |
| Only a component library with its defaults | Partial | Adopt the library, define tokens around it |
| Nothing, or only scattered hard-coded values | None | Define |

## Adopt

- Read every token the surface will need and note its role. Use the role names the house uses.
- Follow the house's relational rules (control heights per rung, radius by role, accent usage,
  type roles, density). If a project design skill exists, run its audit mode on your diff before
  the lab.
- Use the house primitives. When one is missing, wrap the house component library the way its
  existing primitives do, and add it to the catalogue.
- Respect the house's themes and density axes. A surface that breaks a theme or a density step
  is not done.

## Fill

Fill only the families that are missing, inside the existing files, with the existing naming
pattern. Derive new values from existing ones (the same hue family, the same scale ratio, the
same grid). Write each new token with a one-line comment saying what it is for. List every added
token in your final message so the owner can review it.

## Define

With no system, write two files before any UI: `DESIGN.md` (from `templates/DESIGN.md`) and a
token file (from `templates/tokens.css`), placed where the stack expects global styles. Wire the
token file into the build, and if the project uses Tailwind, map tokens into its theme so
utilities resolve to variables.

Product-app defaults:

| Family | Default | Why |
|---|---|---|
| Color | oklch. A neutral ramp of 10 to 12 steps tinted 0.005 to 0.02 chroma toward the brand hue; semantic roles on top (background, surface, raised, border, text, muted text, accent, accent text, success, warning, danger, info); one accent | Perceptually even steps; tinted neutrals read as designed; one accent keeps meaning |
| Theme | Dark and light from the same roles; the primary theme chosen from PRODUCT.md | Roles, not raw values, so themes swap cleanly |
| Type | One sans family for the whole UI (system UI stack or one licensed family). A UI scale in 1 px steps through the dense range: 11, 12, 13, 14, 15, 16, then 18, 20, 24, 30 for headings. Weights 400, 500, 600. Tabular figures for numbers | Product UI lives between 12 and 15 px; small steps let density work; hierarchy from weight and size |
| Spacing | A 4 px grid: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64 | Fine control for dense rows, rhythm for panels |
| Radius | By role: 4 small chips, 6 controls and rows, 8 cards, 12 panels and dialogs, full for avatars and pills. Inner radius = outer minus padding, snapped to the scale | Radius grows with size; concentric curves read as crafted |
| Control heights | A rung of three: 24, 28 or 32, 36 or 40 px. A rung fixes height, font size, icon size and radius together | Controls on one row line up exactly |
| Density | Per instance: row height, control height and padding swap together by a `data-density` axis; the spacing scale does not change | Density without breaking the grid |
| Elevation | Two or three levels from layered soft shadows plus a hairline border; dialogs one level above menus | Depth by restraint |
| Motion | `--motion-fast` 100 ms (hover, press), `--motion-base` 180 ms (menus, popovers), `--motion-slow` 250 ms (dialogs, panels, view switches); one decelerating ease for entry, a slightly faster one for exit | Matches the product motion budgets in `motion.md` |
| Focus | A 2 px ring in the accent with a 2 px offset, on `:focus-visible` only | Visible, consistent, not shown on click |
| Icons | One icon set, one stroke weight, sized by the control rung | Icons match the type |

Then write the **relational rules** into DESIGN.md: accent usage, radius by role, the control
rung, type roles, density, motion by frequency. A token list without rules drifts within weeks.

## Done when

- every value the surface uses resolves to a named token in one file;
- DESIGN.md (house or new) states the rules that relate the tokens;
- your final message says which branch you took: adopted, filled (with the added tokens) or
  defined (with the new files).
