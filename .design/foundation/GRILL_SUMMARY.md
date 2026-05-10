# Grill Summary — Moduo Design Rework

Output of the `/grill-me` skill. Captures every design-intent decision so the rest of the workflow (`/design-brief` → `/information-architecture` → `/design-tokens` → `/brief-to-tasks` → `/frontend-design` → `/design-review`) has a single source of truth to work from.

---

## Product context

- **App**: moduo2.0 — a Rust-first desktop productivity app (Tauri 2 + React 19 + Rsbuild + TanStack Router + Redb).
- **What it does today**: kitchen-sink productivity surface — notes (Lexical + Yjs), mindmaps (XYFlow), email (IMAP), calendar, CRM, OKR, analytics, files, forms, time tracking, etc. ~23 pages, 13 feature areas.
- **Where it's going**: most of those features are exploratory. The final app is expected to converge to **5–7 main features**, not 23. This is unconfirmed and shapes redesign priority (anchor pages first, others when features are pinned).
- **User's visual reference**: "shadcn-like in code structure, Spotify-like in surface treatment — near-black canvas with elevated gray panels." The user's first draft (screenshot reviewed) suffers from low body-text contrast on a flat near-black canvas with no surface hierarchy.

## Decisions locked

### Identity / aesthetic
- **Direction**: shadcn for code/primitives + custom visual style on top.
- **Surface model**: shadcn 3-layer (background / card / popover).
- **Theme**: **Dark-first**, tokens built semantically (`--background`, `--foreground`, `--card`, etc.) so a light mode is a swap, not a rebuild. Light mode is not shipping in v1.

### Component layer
- **Adopt shadcn/ui** for primitives (Button, Dialog, Dropdown, Popover, Command, Tabs, Tooltip, Sheet, Toast, etc.), restyled via tokens.
- Use shadcn CLI to drop primitives into `src/components/ui/` on demand.
- Keep `src/tw/` (React Native compatibility shim) — separate concern from primitives.
- Bespoke feature components (`features/*`) stay where they are; they will consume the new primitives.

### Customization (user-tunable in app settings)
Six axes, persisted via CSS variables on `:root`:
1. **Theme**: dark / light / system
2. **Accent color** (curated palette of 8)
3. **Density**: comfortable / compact
4. **Border radius**: sharp / soft / round (maps to `--radius: 0 / 0.5rem / 1rem`)
5. **Body font family** (curated picker — 5 options)
6. **Body font size**: small / normal / large

### Color
- **Default accent**: pink/magenta (matches the current pink disc in the user's first draft).
- **Accent palette (8 colors, user picks one)**: pink (default), violet, blue, green, amber, red, teal, mono (near-white).
- All accents pre-tuned to harmonize with the dark surfaces.
- **Distinct from accent**: a separate set of "label colors" for tags, statuses, calendar event categories (TBD during `/design-tokens` — not tied to user's accent selection).

### Typography
Two roles, both user-customizable:

**Display picker** (logo, page titles, hero numbers, brand moments)
- Pilat Extended *(default — keeps current brand)*
- Geist Sans
- Cal Sans
- Fraunces (variable serif)

**Body picker** (paragraphs, labels, all UI chrome)
- Geist Sans *(default)*
- Inter
- Source Serif Pro
- Geist Mono

Drop: Equity Sans, Nunito, Palatino Linotype. The `auth-*` and `priority-roman-numeral` class overrides in `global.css` go away.

### Defaults
- **Density**: comfortable (~36–40px row height, ~32px control height).
- **Radius**: soft / 8px (`--radius: 0.5rem`).
- **Display font**: Pilat Extended.
- **Body font**: Geist Sans.
- **Body size**: normal (~15–16px).

### Rollout strategy
- **Tokens + ruleset + primitives first, retrofit incrementally.**
- **Anchor pages** (full redesign as part of this initiative): **Notes** + **Settings**.
  - *Notes* exercises content-heavy decisions (sidebar tree, body type, right rail, context menus, breadcrumbs — covers the screenshot's pain points).
  - *Settings* forces designing the customization UI (theme/accent/density/radius/font pickers, switches, selects, dialogs) — which the rest of the app reuses.
- Other 21 pages migrate as features stabilize. No mass redesign push.

### Rules / enforcement (the "Claude ruleset")
- **CLAUDE.md** (repo root) — short rules, always loaded.
- **DESIGN_SYSTEM.md** (repo root, linked from CLAUDE.md) — full token reference, file layout, "how to add a new component" recipe.
- **Strong rules + Stylelint enforcement** on PRs:
  - No raw hex codes outside the token layer.
  - No arbitrary Tailwind values (`bg-[#xxx]`, `p-[13px]`, etc.) outside an explicit exceptions list.
  - No `style={{ color: ... }}` inline overrides.
  - Primitives must wrap shadcn equivalents where one exists.
- (Stylelint will be added — there's no linter today.)

### Testing
- **Storybook story required** for every primitive (existing 20+ stories stay; new primitives add theirs).
- **Playwright visual snapshot test** for every primitive, run in CI. Catches visual regressions automatically.
- Chromatic / Percy: not adopted (cost vs. value).

### Information architecture
- **Out of scope** for this redesign. Existing routes / navigation / feature boundaries stay.
- `/information-architecture` skill will produce a *descriptive* doc of the current IA so Claude has it as context, not a refactor plan.

## Open / explicitly TBD

1. **Which 5–7 features survive** (user said "probably" — they don't know yet). Doesn't block redesign of Notes + Settings; does affect which page is retrofitted third.
2. **Exact light-mode token values** — not designed in v1, only the structure to support it.
3. **Label colors** (the non-accent set used for tags / statuses / event categories) — exact swatches resolved during `/design-tokens`.
4. **Spacing, type, motion, shadow, z-index scales** — concrete values resolved during `/design-tokens` (Tailwind v4 defaults as starting point unless deviation is justified).

## What happens next

1. **`/design-brief`** — produce a brief that synthesizes this summary + a codebase scan of existing styling into a design direction doc.
2. **`/information-architecture`** — descriptive doc of current routes/navigation/feature surface (no refactor).
3. **`/design-tokens`** — generate the token file (CSS variables + Tailwind v4 `@theme` config) covering all decisions above.
4. **`/brief-to-tasks`** — task list for the redesign work, ordered by dependency.
5. **`/frontend-design`** — implement primitives + Notes + Settings.
6. **`/design-review`** — Playwright-driven visual review on the implemented surface.

CLAUDE.md + DESIGN_SYSTEM.md + Stylelint config get authored alongside step 3.
