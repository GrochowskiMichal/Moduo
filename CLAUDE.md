# CLAUDE.md

Project context for Claude Code. Always loaded.

## Stack

Tauri 2 + React 19 + Rspack/Rsbuild + TanStack Router + Tailwind CSS v4. Redb for local-first persistence. Lexical for rich text. Yjs for collaboration. XYFlow for the mindmap. Storybook 8 for component dev. Vitest + Playwright for tests. Bun for the package manager.

## Build / dev

- `bun run dev:web` — web dev server, http://127.0.0.1:8081
- `bun run dev:desktop` — Tauri dev (Rust + web)
- `bun run build:web` / `bun run build:desktop`
- `bun run storybook` — Storybook, port 6006
- `bun run typecheck` — `tsc --noEmit`
- `bun test` / `bun run e2e`

## Design system (READ BEFORE TOUCHING UI)

The full reference is [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md). The token file is [src/styles/tokens.css](./src/styles/tokens.css). Rationale in [.design/foundation/](./.design/foundation/).

**Hard rules. Stylelint enforces these on PRs:**

1. **No raw hex codes** in component code. Use the semantic tokens via Tailwind utilities (`bg-background`, `text-foreground`, `bg-primary`, `border-border`, etc.) or via CSS variables (`var(--card)`, `var(--primary)`). The only places hex is allowed: `src/styles/tokens.css` itself (the palette definition) and SVG/illustration assets.

2. **No arbitrary Tailwind values** for color, spacing, radius, or font: `bg-[#xxx]`, `p-[13px]`, `text-[15px]`, `rounded-[7px]`, `font-[Pilat]` — all forbidden in component code. Use scale utilities (`p-3`, `text-base`, `rounded-md`) or the semantic tokens. Arbitrary values are allowed for one-off geometry (`top-[12px]` for an absolutely-positioned label, etc.) but never for design-system properties.

3. **No `style={{ color: ... }}` inline overrides** of color, font, radius, spacing, or shadow. The component layer must go through tokens. Inline styles are fine for runtime-computed geometry (transforms, dynamic widths) but never for design-system properties.

4. **Primitives wrap shadcn** where shadcn has one. If you reach for a Dialog / Dropdown / Popover / Command / Tabs / Tooltip / Sheet / Toast / Switch / Select / RadioGroup / Separator / Card / ScrollArea / Avatar / Badge / ContextMenu — use the shadcn version in `src/components/ui/`. Add the component via the shadcn CLI if it doesn't exist yet. Do not roll your own.

5. **Storybook story required** for any new primitive in `src/components/ui/`. Pattern: `<name>.stories.tsx` next to the component.

6. **No new fonts** without adding them to the token system. The font roles are display (default Pilat Extended, alternates Geist / Cal Sans / Fraunces) and body (default Geist, alternates Inter / Source Serif Pro / Geist Mono). The picker in Settings is the only way to expose alternates.

7. **No new top-level routes** without confirming with the user. The app is converging from 23 exploratory routes to 5–7 — don't add more without intent.

### Token quick-ref

When you need to pick a class for…

| Need | Use |
| --- | --- |
| App background | `bg-background` |
| Panel / sidebar / raised card | `bg-card` |
| Dropdown / popover surface | `bg-popover` |
| Input well | `bg-muted` |
| Row hover fill | `hover:bg-accent` |
| Primary button | `bg-primary text-primary-foreground` |
| Secondary button | `bg-secondary text-secondary-foreground` |
| Destructive button | `bg-destructive text-destructive-foreground` |
| Default text | `text-foreground` |
| Secondary text, captions | `text-muted-foreground` |
| Hairline border | `border border-border` |
| Focus ring | `focus-visible:ring-2 focus-visible:ring-ring` |
| Display heading | `font-display` |
| Body | (default — Tailwind's `font-sans` resolves to the body font) |
| Code | `font-mono` |
| Card rounding | `rounded-lg` |
| Control rounding | `rounded-md` |
| Dialog rounding | `rounded-xl` |
| Status colors | `text-success`, `bg-warning`, etc. |

### Layout

Three-pane desktop shell. Min window 1024×700. See [.design/foundation/INFORMATION_ARCHITECTURE.md](./.design/foundation/INFORMATION_ARCHITECTURE.md) for the navigation model and per-page hierarchy.

### Accessibility

- Every interactive element has a `:focus-visible` ring (shadcn handles this).
- Color is never the only signal — pair status colors with icons or labels.
- Icon-only buttons require a `Tooltip` with copy.
- `prefers-reduced-motion` is honoured globally via the motion tokens — don't bypass with hardcoded durations.

### Anti-patterns to avoid

- Material Design FABs / chromatic semantic colors / Roboto.
- Enterprise-SaaS dense bordered forms.
- Skeuomorphic textures, paper-and-shadow effects.
- AI-everywhere gradient/sparkle treatments. The pink "AI" disc is a single deliberate moment; do not repeat the styling for non-AI features.

## Repo layout (short)

- `src/router.tsx` — TanStack Router setup.
- `src/routes/pages/` — page components (23 today, converging to ~7).
- `src/routes/layouts/` — top-level layouts (`app-gate.tsx`).
- `src/features/<feature>/` — feature components, organised per feature.
- `src/components/ui/` — shadcn primitives.
- `src/components/app/` — app shell (top bar, 3-pane shell, menus).
- `src/components/` (root) — shared bespoke components (modals, switchers, menus).
- `src/styles/tokens.css` — design tokens. **Never edit a component to change a token. Edit the token.**
- `src/tw/` — React Native compatibility shim. Leave alone unless explicitly touched.
- `src/global.css` — global resets, font @font-face declarations. Will be cleaned up as the redesign lands.
- `src-tauri/` — Rust backend.
- `.design/<feature-slug>/` — design briefs per feature. Foundation lives at `.design/foundation/`.
- `.storybook/` — Storybook config.

## Git / commits

Format follows the existing project style (concise present-tense imperative). Single-line subject preferred. Co-Authored-By trailer if Claude wrote the change.

## Things explicitly out of scope right now

- Mobile / tablet layouts. Desktop only.
- Light mode visual tuning (the tokens support it; the palette isn't finished).
- The 21 non-anchor pages' visuals. They'll migrate as features stabilise.
- IA refactoring (route renames, page merges). Don't touch routes without an explicit ask.
