# AGENTS.md

Project context for coding agents. Always loaded. **Tool-agnostic** — written for OpenCode, Claude Code, or any agent that reads `AGENTS.md`. (`CLAUDE.md` is just a pointer here.)

## Session start (do this first, every session)

1. **Base check.** Your branch must be cut off the latest personal branch (`maciej` or `mike`) — never `main`/`develop`. If you're behind the personal branch, reconcile before editing: this file, `specs/`, and `src/styles/tokens.css` may be stale. Also `git fetch` and note whether `origin/develop` has moved (the other person may have synced).
2. **Read the three knowledge files:** `docs/decisions.md` · `docs/gotchas.md` · `specs/BUILD_ORDER.md` (the live execution ledger — what's next, dependencies, parallel-session lanes).
3. **If `docs/local/` exists, read it.** It's the gitignored personal layer (§Personal layer) — present for some people, absent for others. Never require it.
4. **Entire + contracts.** GitHub's **default branch is `develop`**. Entire.io repo Overview/Analytics only count work that has landed there — see [docs/entire.md](./docs/entire.md). Domain enums/unions live in the shared Zod layer — see §Domain contracts below.

## Stack

Tauri 2 + React 19 + Rspack/Rsbuild + TanStack Router + Tailwind CSS v4. Supabase is the source of truth (cloud-first): auth, workspaces and tasks go through the Supabase-backed runtime on **both** web and desktop. Redb persists the desktop-only modules that haven't migrated yet (notes, email, time-tracking, calendar) and is otherwise paused — kept for the future offline/lite version; never make it load-bearing for new features. Lexical for rich text. Yjs for collaboration. XYFlow for the mindmap. Storybook 8 for component dev. Vitest + Playwright for tests. Bun for the package manager.

## Working posture (planning & execution)

The user is a **product designer, not an engineer** — authoritative on product, UX, edge cases, scope, and priorities; not on infrastructure, data models, or testing. Build around that asymmetry: extract product knowledge relentlessly, and research/decide the technical layer yourself.

**Planning (`/s1`, read-only — write no code):**

- Grill exhaustively on product behavior, user goals, UX, states, edge cases, acceptance criteria, scope, and priorities until nothing is ambiguous — err toward 50–100 questions up front, not 10 mid-build.
- **Never ask the user implementation, infra, data-model, or library questions.** Research them yourself (read-only explore/recon subagents + web), decide, and record the decision + its assumption in the spec. Surface a technical choice only when it genuinely changes the product (a cost/speed/UX tradeoff a user would feel) — framed in product terms, with a recommendation.
- Resolve every technical unknown during planning so execution never has to stop and ask. End with the Definition-of-Ready gate in `specs/_template.md`.

**Execution (`/s2`, autonomous):**

- **Stay silent between tool calls.** When a block completes, output ONE summary — **Changed** · **Test this** · **Next** — plus, only when applicable: **⚠ Broke** (what failed + your options), **🔎 Found** (context that changes the plan/spec), **❓ Your call** (a decision you can't make alone). Never suppress breakage, a blocker, or a needed decision for brevity. The only acceptable mid-run interruption is a hard blocker you can't resolve by research.
- A block is done when **`bun run verify` passes** (typecheck + lint + tests) and the validator pass (`/s2` step 4) finds nothing blocking.

**Model policy:** use the **strongest reasoning model available to you, everywhere** — main session, subagents, and the validator. Quality over cost; never downgrade subagents or the validator to save tokens. Deliberately phrased model-agnostically: whatever the strongest model in your current tool is, that's the one.

## Active plan

The plan of record is [docs/ROADMAP.md](./docs/ROADMAP.md) (waves 0–5, the scored backlog, and the numbered open questions/risks that gate parts of the plan). At session start, read it plus the north-star docs it links, and build in wave order unless the user directs otherwise — don't start a module before its wave, and check `§Open Questions & Risks` before building anything marked ⚠. The **live, block-level execution ledger** is [specs/BUILD_ORDER.md](./specs/BUILD_ORDER.md) — the ordered list of ready execution blocks with status, dependencies, and parallel-session lanes; `/s2 next` builds the next ready block from it. [docs/improvement-plan.md](./docs/improvement-plan.md) is the **completed** Tasks-era execution log — history, not the live plan.

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
- **Conventions & glossary:** [docs/moduo-architecture-vocabulary.md](./docs/moduo-architecture-vocabulary.md) (terms, principles, decision rules, anti-patterns) · [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md) (UI).
- **Entire.io:** [docs/entire.md](./docs/entire.md) — capture, search, default branch.
- **Domain contracts:** `supabase/functions/_shared/contracts/` (import as `@contracts/*`) — Zod vocabularies + parse/normalize bridges.
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
- `bun run verify` — typecheck + lint:tw + lint:css + tests (the block-done gate)
- `bun test` / `bun run e2e`

## Design system (READ BEFORE TOUCHING UI)

The full reference — token quick-ref, type roles, elevation, accessibility, anti-patterns — is [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md); the terse, checkable **relational** rules (control rungs, radius-by-role, type roles, accent policy, motion) are in [docs/DESIGN_RULES.md](./docs/DESIGN_RULES.md). The token file is [src/styles/tokens.css](./src/styles/tokens.css). Rationale in [.design/foundation/](./.design/foundation/).

**Hard rules. The `lint:css` + `lint:tw` gates enforce these on PRs; the `moduo-design-quality` skill reviews the relational rules a regex can't (see [docs/DESIGN_RULES.md](./docs/DESIGN_RULES.md)):**

1. **No raw hex codes** in component code. Use the semantic tokens via Tailwind utilities (`bg-background`, `text-foreground`, `bg-primary`, `border-border`, etc.) or via CSS variables (`var(--card)`, `var(--primary)`). The only places hex is allowed: `src/styles/tokens.css` itself (the palette definition) and SVG/illustration assets.

2. **No arbitrary Tailwind values** for color, spacing, radius, or font: `bg-[#xxx]`, `p-[13px]`, `text-[15px]`, `rounded-[7px]`, `font-[Pilat]` — all forbidden in component code. Use scale utilities (`p-3`, `text-base`, `rounded-md`) or the semantic tokens. Arbitrary values are allowed for one-off geometry (`top-[12px]` for an absolutely-positioned label, etc.) but never for design-system properties.

3. **No `style={{ color: ... }}` inline overrides** of color, font, radius, spacing, or shadow. The component layer must go through tokens. Inline styles are fine for runtime-computed geometry (transforms, dynamic widths) but never for design-system properties.

4. **Primitives wrap shadcn** where shadcn has one. If you reach for a Dialog / Dropdown / Popover / Command / Tabs / Tooltip / Sheet / Toast / Switch / Select / RadioGroup / Separator / Card / ScrollArea / Avatar / Badge / ContextMenu — use the shadcn version in `src/components/ui/`. Add the component via the shadcn CLI if it doesn't exist yet. Do not roll your own.

5. **Storybook story required** for any new primitive in `src/components/ui/`. Pattern: `<name>.stories.tsx` next to the component.

6. **No new fonts** without adding them to the token system. There is **one font picker** (`data-font`, default Geist) — the chosen family drives the whole UI; display vs body are roles (`font-display` / `font-sans`) that differ by weight/size, not by a second typeface. Options: Geist, Inter, Pilat Extended, Cal Sans, Fraunces, Source Serif Pro, Geist Mono. The picker in Settings is the only way to expose alternates.

7. **No new top-level routes** without confirming with the user. The app is converging from 23 exploratory routes to 5–7 — don't add more without intent.

### Layout

Three-pane desktop shell. Min window 1024×700. See [.design/foundation/INFORMATION_ARCHITECTURE.md](./.design/foundation/INFORMATION_ARCHITECTURE.md) for the navigation model and per-page hierarchy.

## Repo layout (short)

- `AGENTS.md` — this file. `CLAUDE.md` points here. Personal layer: `docs/local/` (gitignored).
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
- `docs/` — the knowledge base: north-star docs, decisions, gotchas, design system, testing checklists, onboarding, reviews.
- `specs/` — feature specs + `BUILD_ORDER.md` (execution ledger) + `_template.md`.
- `.design/<feature-slug>/` — design briefs per feature. Foundation lives at `.design/foundation/`.
- `.claude/skills/` — the `/s1` `/s2` `/s3` + `moduo-design-quality` skills (shared by OpenCode and Claude Code). `.claude/hooks/` — Claude Code lifecycle hooks.
- `.cursor/rules/` — Cursor always-on pointers into AGENTS.md (do not fork policy here).
- `.opencode/` — OpenCode slash-commands (`commands/`) and subagents (`agents/`).
- `.storybook/` — Storybook config.

## Session naming (parallel-session identification)

The designer runs several sessions at once and identifies them by title. **The moment a session's purpose is clear, give the session a title.** Overwrite freely as focus sharpens.

- Planning / general work: `[<Module>] <short title>` — e.g. `[Tasks] Gantt view roadmap`.
- Executing a block: `[<Module> <BLOCK-ID>] <block name>` — e.g. `[Tasks TL-1] Static timeline`.

Mechanics per tool: in **Claude Code**, write the title (plain text, one line) to the worktree-local `.claude/SESSION_TITLE` file (gitignored; a SessionStart hook applies it on the next start/resume). In **OpenCode** (or any tool without that hook), state the title in your first message and keep it in your summary headers — the convention matters more than the mechanism.

## Git / commits / branching

Format follows the existing project style (concise present-tense imperative). Single-line subject preferred. Co-Authored-By trailer for agent-authored changes.

Branching model and PR direction live in [CONTRIBUTING.md](./CONTRIBUTING.md). Short version for LLM agents:

- **Cut the task branch before editing any files.** The moment a task is more than a one-off question, create `t/<owner>/<short-kebab-case>` off the personal branch *first* — do not start editing on `maciej`/`mike` and move the work later.
- Default base for new task branches is the user's personal branch (`maciej` or `mike`). Never branch from `main`. Never branch from `develop` unless explicitly told.
- Never push directly to `main`. Never merge to `main` without both-devs sign-off.
- **Standing authorization to land on `develop`:** after a **bigger** chunk is on the personal branch (`/s3` merge, or any multi-file / user-visible / schema change the designer would expect to "show up"), **you merge personal → `develop` yourself** — do not wait to be asked. Entire.io repo Analytics only sees `develop` (GitHub default). Procedure is in `/s3` and [CONTRIBUTING.md](./CONTRIBUTING.md). Skip only when the designer said to keep the work on a task branch, or when a duplication-guard conflict is unresolved.
- Never merge or close unrelated PRs. Force-push only on your own task branches, only with `--force-with-lease`.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contract.

## Entire.io (use it; don't only capture it)

Entire records agent sessions + checkpoints. **Use it for your own work**, not as a dashboard for the designer:

- `entire search "…"` / `entire why <file>:<line>` / `entire checkpoint explain` — find why code exists before re-deriving.
- `entire status` / `entire session list` — see what this repo is capturing.
- Repo Overview/Analytics on entire.io follow GitHub's **default branch = `develop`**. Home and Sessions list all branches; that is why work that never leaves `mike`/`maciej`/`t/*` looks missing on the repo charts.
- Playbook: [docs/entire.md](./docs/entire.md). Do not wipe Entire data or rewrite checkpoint refs unless the designer asks.

## Domain contracts (Zod + enums)

Closed vocabularies (plan tier, task status, roles, link origins, …) live **once** in `supabase/functions/_shared/contracts/` (`vocabularies.ts`, `primitives.ts`, `errors.ts`). App code imports `@contracts/*`; Deno Edge Functions import the same files relatively.

When you add or change a domain value (new feature, refactor, migration):

1. Add it to the const array + Zod schema + type in `vocabularies.ts` (or a new focused module if it is a new closed set).
2. Keep **parse\*** (strict, writes) vs **normalize\*** (lax, reads) vs **is\*** in lockstep.
3. If Postgres CHECKs / enums exist, add a migration so DB and TS cannot drift. Do not invent a parallel union in `src/features/*/model.ts`.
4. When a value dies: remove it from the vocabulary, tests, CHECK/enum, and call sites — don't leave a zombie union "for later."
5. Leave **open** strings alone: polymorphic entity types, user-renamable contact statuses, IMAP folders, Stripe event names, opaque prefs. Those are documented as out of this layer.

This layer is in use even while the broader enum/Zod foundation is unfinished. Extend it; don't bypass it with a fresh `type Foo = "a" | "b"` next to the table.

## Agent tooling

- **`/s1` `/s2` `/s3`** — the plan → execute → wrap workflow. The skills live in `.claude/skills/` (one shared home, discovered by both OpenCode and Claude Code); thin slash-commands for OpenCode live in `.opencode/commands/`.
- **`validator`** — skeptical-senior review subagent (`.opencode/agents/validator.md`), run by `/s2` step 4 before any block is reported done.
- **MCP servers** — `supabase`, `subframe`, `notion`. Configured in project `opencode.json` (OpenCode) and `.mcp.json` (Claude Code). Each needs a one-time browser OAuth: `opencode mcp auth <name>`.
- **Setup & notifications** — [docs/agent-setup.md](./docs/agent-setup.md) (Cursor + OpenCode + Claude Code, incl. the personal layer). All three load [AGENTS.md](./AGENTS.md); `CLAUDE.md` is only a pointer.

## Personal layer (gitignored, never committed)

`docs/local/` holds personal, project-specific notes — workflow preferences, test-account pointers, machine-specific paths. It is gitignored: agents must **read it if present and never fail if absent**, and must never commit it. Machine-global personal rules (all projects) can live in `~/.config/opencode/AGENTS.md` or `~/.claude/CLAUDE.md` instead.

## Things explicitly out of scope right now

- Mobile / tablet layouts. Desktop only.
- Light mode visual tuning (the tokens support it; the palette isn't finished).
- The 21 non-anchor pages' visuals. They'll migrate as features stabilise.
- IA refactoring (route renames, page merges). Don't touch routes without an explicit ask.
