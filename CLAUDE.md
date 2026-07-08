# CLAUDE.md

Project context for Claude Code. Always loaded.

## Stack

Tauri 2 + React 19 + Rspack/Rsbuild + TanStack Router + Tailwind CSS v4. Supabase is the source of truth (cloud-first): auth, workspaces and tasks go through the Supabase-backed runtime on **both** web and desktop. Redb persists the desktop-only modules that haven't migrated yet (notes, email, time-tracking, calendar) and is otherwise paused — kept for the future offline/lite version; never make it load-bearing for new features. Lexical for rich text. Yjs for collaboration. XYFlow for the mindmap. Storybook 8 for component dev. Vitest + Playwright for tests. Bun for the package manager.

## Working posture (planning & execution)

The user is a **product designer, not an engineer** — authoritative on product, UX, edge cases, scope, and priorities; not on infrastructure, data models, or testing. Build around that asymmetry: extract product knowledge relentlessly, and research/decide the technical layer yourself.

**Planning (`/plan`, read-only — write no code):**

- Grill exhaustively on product behavior, user goals, UX, states, edge cases, acceptance criteria, scope, and priorities until nothing is ambiguous — err toward 50–100 questions up front, not 10 mid-build.
- **Never ask the user implementation, infra, data-model, or library questions.** Research them yourself (Explore subagent + web), decide, and record the decision + its assumption in the spec. Surface a technical choice only when it genuinely changes the product (a cost/speed/UX tradeoff a user would feel) — framed in product terms, with a recommendation.
- Resolve every technical unknown during planning so execution never has to stop and ask. End with the Definition-of-Ready gate in `specs/_template.md`.

**Execution (`/execute`, auto mode):**

- **Stay silent between tool calls.** When a block completes, output ONE summary — **Changed** · **Test this** · **Next** — plus, only when applicable: **⚠ Broke** (what failed + your options), **🔎 Found** (context that changes the plan/spec), **❓ Your call** (a decision you can't make alone). Never suppress breakage, a blocker, or a needed decision for brevity. The only acceptable mid-run interruption is a hard blocker you can't resolve by research.
- A block is done when **`bun run verify` passes** (typecheck + lint + tests) and the validator (`/review`) finds nothing blocking.

**Model:** use **Opus everywhere** — planning, execution, subagents, validator. Quality over cost; never downgrade subagents or the validator to save tokens.

## Active plan

The plan of record is [docs/ROADMAP.md](./docs/ROADMAP.md) (waves 0–5, the scored backlog, and the numbered open questions/risks that gate parts of the plan). At session start, read it plus the north-star docs it links, and build in wave order unless the user directs otherwise — don't start a module before its wave, and check `§Open Questions & Risks` before building anything marked ⚠. The **live, block-level execution ledger** is [specs/BUILD_ORDER.md](./specs/BUILD_ORDER.md) — the ordered list of ready execution blocks with status, dependencies, and parallel-session lanes; `/execute next` builds the next ready block from it. [docs/improvement-plan.md](./docs/improvement-plan.md) is the **completed** Tasks-era execution log — history, not the live plan.

## Product north star (READ BEFORE DESIGNING ANY MODULE)

The product direction is captured in three always-relevant docs — read them before planning or building a module, and edit them *before* code when direction changes:

- [docs/PRODUCT_BRIEF.md](./docs/PRODUCT_BRIEF.md) — what Moduo is, who it's for, the **connective-tissue "spine" that is the moat**, module depth ceilings, design principles, and the non-goals/anti-patterns (no Notion-style databases, no abstract graph UI, links are one-gesture, AI is MCP-only, graceful slippage, quiet notifications).
- [docs/ROADMAP.md](./docs/ROADMAP.md) — the build sequence (waves), the scored idea backlog, and the **numbered open questions + risks** that gate parts of the plan (items marked ⚠).
- [docs/data-layers.md](./docs/data-layers.md) — the data-layer architecture (two runtimes, Supabase-first, the spine's target shape, email's desktop-first hybrid).

Per-module briefs live in `.design/<module>/BRIEF.md` (product) and `.design/<module>/DESIGN_BRIEF.md` (design/interaction/data — the build spec). **A module is not "done" until it wires into the spine (links/attach/drag/@mention/notifications/activity/tags), ships its MCP tools, and ships its dashboard widget** — not just CRUD.

## Knowledge map (read these instead of re-deriving)

The architecture, data model, and conventions are already documented — find them here rather than re-deriving from code. Append to the two logs at the end of each block; read both at session start so knowledge compounds.

- **Architecture:** [docs/architecture.md](./docs/architecture.md) (code layout) · [docs/data-layers.md](./docs/data-layers.md) (runtimes, spine, data flow) · [docs/moduo-module-contract.md](./docs/moduo-module-contract.md) (the 4-pillar module pattern + "done" checklist).
- **Data model:** [docs/data-layers.md](./docs/data-layers.md) §2–3 · per-module `.design/<module>/BRIEF.md` data sketches · `supabase/migrations/`.
- **Conventions & glossary:** [docs/moduo-architecture-vocabulary.md](./docs/moduo-architecture-vocabulary.md) (terms, principles, decision rules, anti-patterns) · [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) (UI).
- **Decisions log:** [docs/decisions.md](./docs/decisions.md) — newest-first index of locked decisions; **append new ones here** so they stop scattering.
- **Gotchas / footguns:** [docs/gotchas.md](./docs/gotchas.md) — read before debugging; **append when something bites.**

## Session wrap-up: manual test checklist (REQUIRED at the end of every build session)

Before reporting a session/sprint done, write or update `docs/testing/<branch-or-sprint>.md` — a **manual test checklist** the user runs to verify the session's work in one pass (see [docs/testing/TEMPLATE.md](./docs/testing/TEMPLATE.md)):

- **Group by feature/surface**; one checkbox per check.
- Each check = a concrete **step → expected result → surface** (web / desktop / both).
- Cover everything the session changed: new flows, edge cases, migrations, and likely-regressed areas you touched.
- **Live-verify first** where the change is observable (preview tooling + the hosted test account) so the user's pass is *confirmation*, not first-discovery; list anything you could not verify under "Known gaps."

Keep it copy-pasteable and self-contained — the user should never have to re-derive what the session touched.

## Build / dev

- `bun run dev:web` — web dev server, http://127.0.0.1:8081
- `bun run dev:desktop` — Tauri dev (Rust + web)
- `bun run build:web` / `bun run build:desktop`
- `bun run storybook` — Storybook, port 6006
- `bun run typecheck` — `tsc --noEmit`
- `bun test` / `bun run e2e`

## Design system (READ BEFORE TOUCHING UI)

The full reference is [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md); the terse, checkable **relational** rules (control rungs, radius-by-role, type roles, accent policy, motion) are in [DESIGN_RULES.md](./DESIGN_RULES.md). The token file is [src/styles/tokens.css](./src/styles/tokens.css). Rationale in [.design/foundation/](./.design/foundation/).

**Hard rules. The `lint:css` + `lint:tw` gates enforce these on PRs; the `moduo-design-quality` skill reviews the relational rules a regex can't (see [DESIGN_RULES.md](./DESIGN_RULES.md)):**

1. **No raw hex codes** in component code. Use the semantic tokens via Tailwind utilities (`bg-background`, `text-foreground`, `bg-primary`, `border-border`, etc.) or via CSS variables (`var(--card)`, `var(--primary)`). The only places hex is allowed: `src/styles/tokens.css` itself (the palette definition) and SVG/illustration assets.

2. **No arbitrary Tailwind values** for color, spacing, radius, or font: `bg-[#xxx]`, `p-[13px]`, `text-[15px]`, `rounded-[7px]`, `font-[Pilat]` — all forbidden in component code. Use scale utilities (`p-3`, `text-base`, `rounded-md`) or the semantic tokens. Arbitrary values are allowed for one-off geometry (`top-[12px]` for an absolutely-positioned label, etc.) but never for design-system properties.

3. **No `style={{ color: ... }}` inline overrides** of color, font, radius, spacing, or shadow. The component layer must go through tokens. Inline styles are fine for runtime-computed geometry (transforms, dynamic widths) but never for design-system properties.

4. **Primitives wrap shadcn** where shadcn has one. If you reach for a Dialog / Dropdown / Popover / Command / Tabs / Tooltip / Sheet / Toast / Switch / Select / RadioGroup / Separator / Card / ScrollArea / Avatar / Badge / ContextMenu — use the shadcn version in `src/components/ui/`. Add the component via the shadcn CLI if it doesn't exist yet. Do not roll your own.

5. **Storybook story required** for any new primitive in `src/components/ui/`. Pattern: `<name>.stories.tsx` next to the component.

6. **No new fonts** without adding them to the token system. There is **one font picker** (`data-font`, default Geist) — the chosen family drives the whole UI; display vs body are roles (`font-display` / `font-sans`) that differ by weight/size, not by a second typeface. Options: Geist, Inter, Pilat Extended, Cal Sans, Fraunces, Source Serif Pro, Geist Mono. The picker in Settings is the only way to expose alternates.

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
- `src/tw/` — React Native compatibility shim. Being phased out from files we actively touch: new and edited chrome code uses raw HTML (`<div>`, `<span>`, `<button>`) rather than `<View>` / `<Text>` / `<Pressable>`. Pre-existing usages elsewhere stay until each file has a reason to be edited. Do not undertake a codebase-wide migration without an explicit ask.
- `src/global.css` — global resets, font @font-face declarations. Will be cleaned up as the redesign lands.
- `src-tauri/` — Rust backend.
- `.design/<feature-slug>/` — design briefs per feature. Foundation lives at `.design/foundation/`.
- `.storybook/` — Storybook config.

## Session naming (parallel-session identification)

The designer runs several sessions at once and identifies them by title. **The moment a session's purpose is clear, write it to the worktree-local `.claude/SESSION_TITLE` file** (plain text, one line, gitignored; a SessionStart hook picks it up and sets the session title on the next start/resume). Overwrite freely as focus sharpens.

- Planning / general work: `[<Module>] <short title>` — e.g. `[Tasks] Gantt view roadmap`.
- Executing a block: `[<Module> <BLOCK-ID>] <block name>` — e.g. `[Tasks TL-1] Static timeline`.

The file is the source of truth; a manual rename in the session picker is overwritten on the next resume unless the file is updated too.

## Git / commits / branching

Format follows the existing project style (concise present-tense imperative). Single-line subject preferred. Co-Authored-By trailer if Claude wrote the change.

Branching model and PR direction live in [CONTRIBUTING.md](./CONTRIBUTING.md). Short version for LLM agents:

- **Cut the task branch before editing any files.** The moment a task is more than a one-off question, create `t/<owner>/<short-kebab-case>` off the personal branch *first* — do not start editing on `maciej`/`mike` and move the work later.
- Default base for new task branches is the user's personal branch (`maciej` or `mike`). Never branch from `main`. Never branch from `develop` unless explicitly told.
- Never push directly to `main` or `develop`. Never merge or close PRs without explicit authorization.
- Force-push only on your own task branches, only with `--force-with-lease`.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contract.

## Things explicitly out of scope right now

- Mobile / tablet layouts. Desktop only.
- Light mode visual tuning (the tokens support it; the palette isn't finished).
- The 21 non-anchor pages' visuals. They'll migrate as features stabilise.
- IA refactoring (route renames, page merges). Don't touch routes without an explicit ask.
