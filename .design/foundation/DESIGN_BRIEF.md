# Design Brief: Moduo Design Foundation

> Output of `/design-brief`. Synthesizes [GRILL_SUMMARY.md](./GRILL_SUMMARY.md) with a codebase scan into a directional document the rest of the skills (`/information-architecture`, `/design-tokens`, `/brief-to-tasks`, `/frontend-design`, `/design-review`) read from.

> Scope: this brief covers the **design foundation** — tokens, primitives, ruleset, and two anchor pages (Notes + Settings). It is not a brief for a single feature. Per-feature briefs go in their own `.design/<feature-slug>/` folder as those features get redesigned.

## Problem

When users open moduo today, the body text disappears into the background. The canvas is one flat near-black plane with no surface hierarchy, so the eye has nothing to grab onto. Every page they open looks slightly different — the same kind of button has a different color in Notes than it does in Email; a sidebar item in the calendar uses different padding than a sidebar item in the mindmap. The app's identity (the Pilat Extended wordmark, the pink AI disc; *both since retired, see `.design/brand/`*) gets diluted by 5 other accidental fonts and 545 hand-coded hex values spread across 53 files. The user doesn't perceive these problems as "inconsistency." They perceive it as "this app feels rough."

For the maintainer, the problem is downstream: every new feature requires re-deciding the color of a hover state, the radius of a card, the size of a heading — because there's no system to defer to. The same is true for Claude when it writes code in this repo: with no tokens to reach for, it improvises, and the improvisation compounds.

## Solution

A token-first foundation that gives the eye a clear ladder of surfaces (canvas → card → popover), a single accent color that the user controls, and one display font + one body font with five sensible alternates each. Two anchor pages — **Notes** and **Settings** — get a complete redesign as the proof point. Everywhere else in the app inherits the visual improvement as components migrate; pages don't have to be touched all at once.

The chrome itself stays flat against the canvas: only the three content panels (left rail · centre · right rail) carry `bg-card` + border + radius. The top bar and bottom bar sit on `bg-background` with no hairline, and the gaps between the top bar, panel area, and bottom bar drop to zero — the visual rhythm comes from the panel boxes against the canvas, not from gutters. The top bar carries module titles only; per-route picker chips moved into each module's own left rail (or away entirely, per its feature brief). A floating bottom pill ([global-bottom-bar.tsx](../../src/components/app/global-bottom-bar.tsx)) anchors AI · Search (Cmd-K palette) · Create across every page.

For Claude (and humans), a short `CLAUDE.md` design section + a longer `DESIGN_SYSTEM.md` reference document plus a Stylelint check on PRs make "use a token, not a hex" enforceable instead of aspirational.

## Experience Principles

1. **Clarity over decoration** — Surface hierarchy comes from elevation and contrast, never ornament. Body text is always readable; the canvas yields to the user's content (notes, mindmap, email).
2. **Tokens or nothing** — Every color, distance, radius, font, and motion value goes through a named token. The theme / accent / font / radius / density / size pickers only work because nothing bypasses the system.
3. **Consistent skeleton, customizable skin** — Layout rhythm, density, and component behavior stay constant across every page and every user customization. What changes per user is theme, accent, font, radius, density, and font size — never interaction patterns.

## Aesthetic Direction

- **Philosophy**: Refined, content-first, dark-canvas operator's tool. Think of moduo as a quiet instrument the user plays for hours — not a brochure, not an enterprise dashboard, not an AI showroom.
- **Tone**: Calm, confident, intentional. A single confident accent on a black/gray architecture *(mono by default since 2026-07-27; "pink" here was a misread of the first draft, see brand decision 40 in `.design/brand/DECISIONS.md`)*. Never aggressive, never busy, never cute.
- **Reference points**:
  - **Spotify's surface model** — near-black canvas with elevated gray panels that give the eye structure.
  - **Linear** — the discipline of monochrome + one accent, the design-system rigor.
  - **shadcn/ui** — the code-level pattern: copy the source into the repo, restyle via tokens, full ownership.
  - **Notion** — the customization surface (theme, density, font choices in settings).
  - **Things 3** (dark) — the calm, intentional restraint at a content level.
- **Anti-references** (these are taste guards, not personal opinions):
  - **Not Material Design / Google** — no FABs, no thick elevation shadows, no Roboto, no overly chromatic semantic colors.
  - **Not enterprise B2B SaaS** (Salesforce / ServiceNow / Workday) — no dense bordered forms, no "every action is a button" patterning.
  - **Not skeuomorphic or playful** (Apple Stocks textures, Bear's tabby cat, Things' decorative icons) — flat-with-elevation, never paper-and-shadow.
  - **Not corporate AI app** (Copilot, ChatGPT Enterprise) — no gradient borders everywhere, no sparkles on every button, no purple-on-purple AI wash. ~~The pink AI disc stays a single deliberate moment.~~ *(Superseded 2026-10-08: there is no AI disc or AI colour, brand decision 40.)*

## Existing Patterns

What's in the repo right now — the brief extends, not replaces, this.

### Typography (today)
- **Fonts loaded**: Pilat Extended (4 weight range via local), Equity Sans Regular/Medium/Semibold/Bold + Alt Bold (5 OTF files), Nunito (`@fontsource/nunito`), Palatino Linotype (system fallback).
- **Class overrides**: `auth-hero-title` (Equity Sans Alt), `.auth-right *` (Nunito), `.priority-roman-numeral` (Palatino).
- **Body default**: Pilat Extended via `*` selector — extended-geometric font used for paragraphs, which is the readability problem visible in the first-draft screenshot.
- **Sizes**: hardcoded throughout (`32px`, `26px`, `21px`, `14px`, `13px`, `12px`) with no scale.

### Colors (today)
- **No tokens.** No `:root` custom properties, no Tailwind theme extension, no `@theme` declarations.
- **545 occurrences** of `bg-[#xxxxxx]` arbitrary Tailwind values across **53 files**. Same neighborhoods (`#141414`, `#1a1a1a`, `#151515`, `#252525`, `#2a2a2a`, `#3a3a3a`) appear with slight differences across files — the inconsistency is mostly drift, not intent.
- Body background hardcoded in `global.css`: `background: #111111`.
- Accent: a pink/magenta only present in one floating disc in the first-draft screenshot. No corresponding hex defined anywhere.

### Spacing (today)
- Tailwind v4 default scale, but freely mixed with arbitrary px values (`p-[13px]`, `gap-[10px]`, etc.) — no enforced rhythm.

### Radius (today)
- Mixed: `4px`, `8px`, `10px`, `12px` appear in different components for similar UI roles.

### Components (today)
**Layout / shell**:
- [src/components/app/app-chrome.tsx](src/components/app/app-chrome.tsx) — top nav, app frame
- ~~[src/components/app/app-chrome-menus.tsx](src/components/app/app-chrome-menus.tsx)~~ — deleted as part of REVISION_DELTA §7 (per-route chips and pickers moved out of the chrome)
- [src/components/app/feature-panels-shell.tsx](src/components/app/feature-panels-shell.tsx) — the 3-pane shell (sidebar / center / right rail)
- [src/components/app/root-error-boundary.tsx](src/components/app/root-error-boundary.tsx)

**Modals / drawers / menus**:
- [src/components/integrations-modal.tsx](src/components/integrations-modal.tsx)
- [src/components/workspace-settings-modal.tsx](src/components/workspace-settings-modal.tsx)
- [src/components/notification-center.tsx](src/components/notification-center.tsx)
- [src/components/user-menu.tsx](src/components/user-menu.tsx)
- [src/components/workspace-switcher.tsx](src/components/workspace-switcher.tsx)

**Primitives (almost nothing)**:
- [src/components/ui/icon.tsx](src/components/ui/icon.tsx) — icon wrapper (uses lucide-react)
- [src/components/ui/tag-input.tsx](src/components/ui/tag-input.tsx) — chip input

**RN compatibility shim** (kept, not migrated):
- [src/tw/index.tsx](src/tw/index.tsx) — `View`, `Text`, `Pressable`, `TextInput`, `ScrollView`, `Image`, `Modal`, `ActivityIndicator`. Used by ported screens. Stays.

**Storybook**: 8.6.14 installed, 20+ stories across `app-chrome`, `tag-input`, modals, notification center, workspace switcher, brainstorm workspace, visual templates, etc.

**Routes / pages**: 23 page files in [src/routes/pages](src/routes/pages/) — many exploratory; the app is expected to converge to 5–7 main features.

## Component Inventory

The foundation work needs the following. shadcn names noted where applicable.

| Component | Status | Notes |
| --------- | ------ | ----- |
| Button | New (shadcn) | Variants: default (accent fill), secondary (panel fill), ghost (transparent + hover), outline, destructive, link. Sizes: sm / md / lg / icon. |
| Input | New (shadcn) | Single-line text. Variant for search (with leading icon). |
| Textarea | New (shadcn) | Multi-line, auto-grow capable. |
| Label | New (shadcn) | Form label tied to inputs. |
| Dialog | New (shadcn) | Replaces ad-hoc modals (`integrations-modal`, `workspace-settings-modal`). |
| Sheet | New (shadcn) | Side-anchored drawer; useful for the right rail when collapsed. |
| Dropdown Menu | New (shadcn) | Replaces the context menu in the first-draft screenshot. |
| Popover | New (shadcn) | Generic floating panel. |
| Command | New (shadcn) | Cmd-K palette. The bottom search icon points to a future use. |
| Tabs | New (shadcn) | Used in Settings. |
| Tooltip | New (shadcn) | All icon-only buttons need one. |
| Toast (Sonner) | New (shadcn) | Replaces the bespoke `fadeSlideUp` toast in `global.css`. |
| Switch | New (shadcn) | Used in Settings. |
| Select | New (shadcn) | Used in Settings (font picker, radius picker, density picker). |
| RadioGroup | New (shadcn) | Used in Settings (theme picker, accent swatches). |
| Separator | New (shadcn) | Replaces 545 `bg-[#xxx]` 1px dividers. |
| Card | New (shadcn) | Generic raised surface. |
| Scroll Area | New (shadcn) | Replaces the bespoke `.scrollbar-thin` in `global.css`. |
| Avatar | New (shadcn) | Used in user-menu, mail, comments. |
| Badge | New (shadcn) | Tags, statuses. |
| ContextMenu | New (shadcn) | Right-click menu in the Notes sidebar (visible in first-draft screenshot). |
| Icon | Exists | [src/components/ui/icon.tsx](src/components/ui/icon.tsx) — keep, restyle with token sizes (16 / 20 / 24). |
| Tag Input | Exists, modify | Restyle to consume tokens. |
| App Chrome | Exists, modify | Adopt new tokens; structure stays. |
| Feature Panels Shell | Exists, modify | Adopt new tokens; add responsive collapse logic (see below). |
| Workspace Switcher | Exists, modify | Restyle on top of Dropdown Menu primitive. |
| User Menu | Exists, modify | Restyle on top of Dropdown Menu primitive. |
| Notification Center | Exists, modify | Restyle on top of Sheet primitive. |
| Integrations Modal | Exists, modify | Restyle on top of Dialog primitive. |
| Workspace Settings Modal | Exists, modify | Restyle on top of Dialog primitive. |
| Notes page (full) | Redesign | Anchor page 1. |
| Settings page (full) | Redesign | Anchor page 2 — hosts the customization pickers. |

## Key Interactions

These are the interactions the foundation must support cleanly. Per-feature interaction design is each feature's own brief, later.

- **Surface elevation on hover**: rows in the sidebar tree raise from `--card` → `--accent` (a "row-hover" mix token) on hover with no border change. No outline flash. 150 ms ease-out.
- **Focus rings**: every interactive primitive gets a 2 px ring at `--ring` with a 2 px offset against the surface beneath. Always visible on `:focus-visible`. Never on `:focus` (mouse focus stays quiet).
- **Theme switch**: changing theme in Settings triggers a `transition: background-color 200ms, color 200ms` on `:root`. No flash, no layout shift.
- **Accent switch**: identical mechanism — only `--primary` and derived tokens change. All component states update via the cascade.
- **Density switch**: a single `data-density="compact"` attribute on `<html>` flips `--row-h`, `--ctrl-h`, `--pad-x`, `--pad-y` variables. No re-mount, no JS thrashing.
- **Right-click context menu** (visible in first-draft screenshot): replaced by `ContextMenu` primitive; opens at the cursor; closes on outside click / Escape; keyboard navigable.
- **Command palette (⌘K / Ctrl+K)**: `Command` primitive opens an overlay popover at the center of the window; filters items as user types; supports nested categories.
- **Toast feedback**: actions that succeed silently emit nothing; actions that succeed visibly (deleted, archived, moved) emit a Sonner toast in the bottom-right with an Undo affordance and a 4 s default duration.

## Responsive Behavior

This is a Tauri desktop app — no mobile breakpoint, but window resize matters.

- **Minimum size**: enforce 1024 × 700 at the Tauri level.
- **Three-pane layout** (sidebar + main + right rail) at ≥ 900 px wide. Rails are user-resizable via drag handles ([src/components/ui/resizable.tsx](../../src/components/ui/resizable.tsx)); widths persist per-feature in `localStorage`.
- **At < 900 px** (rare on desktop, e.g. split-screen): a single-pane layout with both sidebars accessible via `Sheet`. Not a "mobile design" — it's the same desktop design with both rails closed by default.
- **No collapsed icon-mode**. The legacy 1024–1280 px icon column was retired; each module's rails are bespoke content, so there's no shared icon column to fall back to.
- **No layout transforms above 1920 px** — content stays in a generous max-width center column; sidebars and rails take resizable widths bounded by `min: 12%`, `max: 40%`.

## Accessibility Requirements

- **WCAG 2.1 AA contrast** for all body text and UI text on every surface (`--background`, `--card`, `--popover`). Verified via design-tokens skill; spot-checked per primitive.
- **`:focus-visible` ring on every interactive element** at `--ring`, 2 px, 2 px offset. Mouse focus stays quiet; keyboard focus is always obvious.
- **Full keyboard navigation** through every primitive (shadcn / Radix gives this for free; the brief's job is not to break it).
- **`prefers-reduced-motion`** respected in CSS — all motion tokens have a `@media (prefers-reduced-motion: reduce)` override that collapses durations to 0 ms. The existing `auth-hero-float` already does this; the pattern extends.
- **Color is never the only signal** — every status (success / warning / danger) has an icon or label in addition to color.
- **Screen reader labels** on every icon-only button via `Tooltip` (which composes `aria-label` correctly).
- **No keyboard traps** — `Dialog`, `Sheet`, `Popover` all restore focus on close (shadcn / Radix default).

## Out of Scope

Explicit non-goals to prevent scope creep.

- **Light mode visuals**. Tokens are structured to support it; the swatches are not designed.
- **The 21 non-anchor pages**. They keep their current ad-hoc styling until they get a per-feature brief. They'll partially improve as primitives migrate, but no page-level redesign work happens here.
- **Information architecture changes**. Routes, navigation, feature boundaries all stay. `/information-architecture` will produce a descriptive doc, not a refactor plan.
- **Mobile / tablet layouts**. Desktop window only.
- **The React Native compatibility shim** (`src/tw/`). Stays as-is.
- **Email rendering** (Lexical / Yjs / XYFlow internals). Their interaction surfaces follow the same tokens, but their canvas internals (the mindmap nodes' own visual language, the Lexical editor's own theme) are their own design problem.
- **Marketing site, app icon, Tauri installer chrome**. Out.
- **Localization (text expansion / RTL)**. Out for v1; tokens don't preclude it.
- **Custom CSS by end users** (Obsidian-style theming). Out — customization stays within the curated axes.
