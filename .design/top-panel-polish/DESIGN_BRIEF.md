# Design Brief: Top Panel Polish

> Output of `/design-brief` for the moduo polish run on the **top bar + global bottom bar**. These are the two persistent chrome surfaces of the app shell. The foundation (tokens, primitives, shell, settings modal, top + bottom bars at structural level) is already shipped to `main`. This brief polishes the surfaces themselves, not the system underneath them.
>
> Reading order for downstream skills (`/brief-to-tasks`, `/frontend-design`, `/design-review`): this brief → [DESIGN_SYSTEM.md](../../docs/DESIGN_SYSTEM.md) → [src/styles/tokens.css](../../src/styles/tokens.css) → [.design/foundation/INFORMATION_ARCHITECTURE.md](../foundation/INFORMATION_ARCHITECTURE.md).
>
> **No new tokens.** Every value below resolves to an existing token in `src/styles/tokens.css`. If a downstream skill thinks it needs a new token, that's a flag to stop and consult — not a license to add one.

## Problem

The top bar today is doing two contradictory jobs at once. It tries to be an enumeration of every route the app has (20 module tabs, horizontally scrolling behind a mask gradient) *and* the calm, persistent identity surface that frames every feature. The result reads as neither — the eye can't settle on six core features because they're buried among fourteen exploratory ones, and the workspace identity (a bare chevron with no name) is too quiet to anchor anything.

Three smaller frictions compound this:

- **Active vs hover module tab styling is barely distinguishable.** Active = `bg-accent`. Hover = `bg-accent/60`. They sit one step apart on the same axis. The workspace-switcher chevron has a cleaner hover pattern that the tabs ought to inherit.
- **Icons-only mode is inconsistent.** When `data-tabs="icons"` is on, inactive tabs collapse to a square icon hit area while the active tab *keeps* its label, becoming a wider pill. The active tab visibly mismatches every other tab in the row.
- **Bottom bar carries a global affordance (NotificationCenter) that doesn't fit its identity.** The bottom bar's role in moduo is *feature-contextual* — Search and Create are scoped to the currently viewed feature (with global fallbacks). Notifications are globally scoped and conceptually belong with the user identity in the top-right.

Underneath the surface issues: the React Native compat shim (`src/tw/`) is still used in [src/components/app/app-chrome.tsx](../../src/components/app/app-chrome.tsx) even though no other chrome file uses it. Since we're rewriting this file, this is the moment to drop it on this surface and document the phase-out.

## Solution

Polish both chrome surfaces with the smallest defensible set of changes:

- Cut the module nav from 20 to 6 — **Grid · Notes · Ground · Mindmap · Email · CRM** — by deleting the other 14 routes and page files (not just the nav entries). The hor-scrolling masked overflow row goes away because there's nothing to overflow.
- Hide the workspace switcher entirely when the user has one workspace; show `[avatar] [name] [chevron]` when they have two or more. Workspace creation moves out of the switcher into Settings → Workspace.
- Strengthen module-tab states: active uses `text-foreground` (not muted); hover uses the workspace-chevron pattern (`hover:bg-accent hover:text-foreground`); icons-only mode hides labels on every tab including active so the row is uniform.
- Wire `⌘1..⌘6` to the six visible tabs; surface the hint in each tab's Tooltip.
- Move `NotificationCenter` from the bottom bar to the top-right, adjacent to the user avatar.
- Fill the freed bottom-bar slot with a `SlidersHorizontal` placeholder for future feature-specific settings (no behaviour wired in this PR — the slot exists so per-feature polish runs have somewhere to plug their settings popover).
- Migrate this file off the `src/tw/` shim (`<View>` → `<div>`, `<Text>` → `<span>`, same classNames). Document the shim phase-out direction in [CLAUDE.md](../../CLAUDE.md).

Visually, the bar continues to sit flat on `bg-background` with no hairline, matching the foundation rule. Identity reads in this order across the top: Moduo Mark · Workspace (when relevant) — Module nav — Notifications · Avatar.

## Experience Principles

1. **Calm chrome, loud content** — The bars never compete with the work area. Every interactive element is `~32px`, every state change resolves within a single motion token. Nothing on the bar should ever pull the eye away from the centre panel.
2. **One identity, persistent** — The Moduo Mark is *always* visible, the same mark in every workspace. Workspace identity layers on top and only when there is more than one workspace to distinguish. The bar tells the user where they are, never decoratively.
3. **Conventional but not borrowed** — Where convention helps (NotificationCenter near the avatar, `⌘1..⌘N` for module switching, Tooltip-with-shortcut), use it. Where convention breaks the model (e.g. global Search in the top bar), defy it deliberately: in moduo, Search is feature-contextual and lives at the bottom.

## Aesthetic Direction

- **Philosophy**: Inherited from the foundation. Refined, content-first, dark-canvas operator's tool. The chrome is the picture frame, not the picture.
- **Tone**: Calm, confident, intentional. No celebratory hover states on the module nav, no decorative accents on the workspace trigger. The accent stays on `--primary` interactions only, where the foundation put it. *(Updated 2026-10-08: the accent is mono by default and there is no AI disc; pink is just one optional accent. See brand decision 40 in `.design/brand/DECISIONS.md`.)*
- **Reference points**: Linear's top-left identity stack; Notion's compact module switcher; Cursor's persistent mark + workspace; Things 3's restraint in chrome.
- **Anti-references**: VS Code's busy activity bar; Slack's tinted workspace identity (we keep the Mark monochrome); Discord's gradient hover stacks; any pattern that treats chrome as a feature.

## Constraints

These are hard constraints, not preferences.

1. **No new tokens.** Every value resolves to an existing token in [src/styles/tokens.css](../../src/styles/tokens.css). If a target value doesn't exist, reach for the adjacent token, not a new one.
2. **No new top-level routes.** This PR *deletes* routes; it must not add any.
3. **No breadcrumb or page title in the top bar.** Per-feature orientation belongs in the centre panel.
4. **No real settings UI behind the bottom-bar `SlidersHorizontal` icon.** It's a placeholder click target with a no-op handler; per-feature polish decides what attaches to it.
5. **No mobile / tablet design.** Desktop only, ≥ 1024 px window.
6. **No light-mode visual tuning.** Tokens carry both modes; this brief doesn't audit light mode beyond "doesn't visibly break".
7. **`src/components/app/app-chrome-menus.tsx` is untouched.** Different concern (per-route pickers), explicitly out of scope.
8. **Workspace-specific Moduo Mark customization is parked.** No accent-per-workspace, no Mark variants, no settings entry for it in this PR.
9. **No `tw` shim removal outside [src/components/app/app-chrome.tsx](../../src/components/app/app-chrome.tsx).**

## Existing Patterns

What this brief inherits from the foundation. Nothing here should be redesigned.

### Tokens (used as-is)
- **Surfaces**: `--background` (canvas), `--accent` (row-hover / active-tab fill).
- **Text**: `--foreground` (active + identity), `--muted-foreground` (idle module-tab label).
- **Borders**: `--border` (avatar trigger hairline).
- **Focus**: `--ring` via `focus-visible:ring-2 focus-visible:ring-ring`.
- **Radius**: `rounded-md` for module tabs and bar buttons; `rounded-avatar` for the user avatar and workspace avatar inside the switcher trigger.
- **Geometry**: `--bar-h` (3rem / 48px shared bar height — unchanged); element hit areas `h-8 w-8` (32px) for icon buttons, `h-8` with horizontal padding for labelled tabs.
- **Z-index**: `--z-header` for the bar layer (existing).
- **Motion**: `--motion-base` for state transitions on hover/active.

### Primitives (composed, not extended)
- `Tooltip` ([src/components/ui/tooltip.tsx](../../src/components/ui/tooltip.tsx)) — every icon-only element on both bars.
- `DropdownMenu` ([src/components/ui/dropdown-menu.tsx](../../src/components/ui/dropdown-menu.tsx)) — the workspace switcher popover (already in use).
- `Avatar` ([src/components/ui/avatar.tsx](../../src/components/ui/avatar.tsx)) — user avatar and workspace-list avatars.
- `Sheet` — `NotificationCenter` continues to compose Sheet; only its trigger moves.

### Code-level patterns inherited
- The `data-slot="module-tab"` / `data-slot="module-tab-label"` selectors are load-bearing for the icons-only CSS in [src/global.css](../../src/global.css). The DOM contract survives the refactor.
- The `data-active` attribute on a module tab continues to drive `aria-current` semantics.
- `dispatchCreateNew()` from [src/components/app/create-events.ts](../../src/components/app/create-events.ts) stays the API for the `+` button.
- `dispatchOpenPalette()` from [src/components/app/global-command-palette.tsx](../../src/components/app/global-command-palette.tsx) stays the API for the bottom-bar Search button.
- `dispatchOpenSettings()` from [src/features/settings/settings-events.ts](../../src/features/settings/settings-events.ts) stays the API for the avatar trigger.
- `useShortcut(id, handler)` from [src/lib/shortcuts.ts](../../src/lib/shortcuts.ts) is extended (not replaced) — six new shortcut entries.

## Surface Map

### Top bar

Single 48px row (`var(--bar-h)`) on `bg-background`, horizontal `px-5`. **Three-column CSS grid** with `grid-template-columns: 1fr auto 1fr` so the module nav is **viewport-centred** — the left and right zones each absorb equal leftover space on either side. The tabs do not drift when the workspace-switcher trigger appears or when the workspace name varies in length.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Mark] [Workspace?]      [Module tabs · max 6]      [Notifications] [Avatar] │
└──────────────────────────────────────────────────────────────────────────────┘
   left zone (1fr)            centre zone (auto)         right zone (1fr)
   justify-self: start         justify-self: center      justify-self: end
```

- **Left zone**: Moduo Mark (32×32) + optional Workspace trigger (visible only when `workspaces.length > 1`). Content anchored to the start of the column.
- **Centre zone**: 6 module tabs in a `flex flex-row items-center gap-1` row. Auto-sized — only as wide as the tabs themselves. Sits exactly in the viewport centre regardless of left/right zone widths.
- **Right zone**: NotificationCenter trigger (32×32) + UserMenu avatar (32×32). Content anchored to the end of the column.

**Collision behaviour at narrow viewports**: with 6 labelled tabs at `data-tabs="auto"`, the centre column's intrinsic width fits inside 1024 px alongside a typical left/right pair. If a workspace name pushes the left column wider than its share of `1fr`, the grid lets the centre column hold its position; the left column truncates the workspace name (existing 14ch limit) before the centre is displaced. If a user runs `data-tabs="icons"` they buy more breathing room automatically. No overflow-scroll fallback is reintroduced.

The `TrialBanner` continues to render *above* the top bar when active. The bar's z-index, height calc, and background do not depend on the banner's presence. (Banner internals stay out of scope.)

### Global bottom bar

Centred trio of 32×32 buttons on `bg-background`, `var(--bar-h)` row height:

```
                  ┌───────────────────┐
                  │ [⚙] [🔍] [＋]      │
                  └───────────────────┘
            placeholder  search    create
```

- **Settings (sliders)**: `SlidersHorizontal` from lucide-react. Tooltip `Feature settings`. No-op `onClick` in this PR (logs to console with a `TODO` marker is acceptable; preferred behaviour is silent no-op).
- **Search**: existing `dispatchOpenPalette()` — unchanged.
- **Create**: existing `dispatchCreateNew()` — unchanged.

The NotificationCenter button is removed from this surface.

## Component Inventory

| Component | Status | Notes |
| --- | --- | --- |
| [AppChrome](../../src/components/app/app-chrome.tsx) | **Modify** | Major rewrite of the top-bar markup. Drop the `<View>/<Text>` shim usage. Reduce `modulesNavItems` source list. Add `NotificationCenter` to the right zone. Add `⌘1..⌘6` shortcut wiring. Keep all effects (avatar/profile sync, fullscreen toggle, activity publisher, panels persistence) untouched. |
| [GlobalBottomBar](../../src/components/app/global-bottom-bar.tsx) | **Modify** | Remove `<NotificationCenter />`. Add `SlidersHorizontal` placeholder as the leading icon. Order: settings · search · create. |
| [WorkspaceSwitcher](../../src/components/workspace-switcher.tsx) | **Modify** | Trigger renders `[avatar] [name] [chevron]` when 2+ workspaces; component returns `null` when ≤ 1 workspace. Dropdown content unchanged. The "Create workspace" + "Join workspace" affordances inside the dropdown stay (a user with 2+ workspaces can still create/join from there); the *only* user-visible change is the trigger redesign and the hidden state. |
| [UserMenu](../../src/components/user-menu.tsx) | **Modify (light)** | Size pinned to 32×32 to match notification button. No internal changes beyond verifying focus-ring and tooltip copy. |
| [NotificationCenter](../../src/components/notification-center.tsx) | **Modify (trigger only)** | Internals untouched. Trigger needs to size to 32×32 and read well next to the avatar — verify visual weight; no Sheet/content changes. |
| `ModuleTab` (new sub-component, file colocated in app-chrome) | **New** | Extracted from the inline JSX in app-chrome. Exports a single `ModuleTab` component with the `data-slot`, `data-active`, tooltip + shortcut, and icon-mode-aware geometry. Not a shadcn primitive — it's chrome-internal, no Storybook story of its own (covered by `app-chrome.stories.tsx`). |
| [baseModulesNavItems](../../src/components/app/app-chrome-constants.ts) | **Modify** | Trim from 20 to 6. Remove the `desktopOnly` field from each entry. The `ModuleNavItem` type in [app-chrome-types.ts](../../src/components/app/app-chrome-types.ts) loses `desktopOnly?: boolean`. |
| [router.tsx](../../src/router.tsx) | **Modify** | Remove route registrations for the 14 deleted features. Keep redirects (`/` → `/grid`, `/tasks` → `/ground`, `/calendar` → `/ground`). |
| [shortcuts.ts](../../src/lib/shortcuts.ts) | **Modify** | Add six new shortcut entries (`module-1` … `module-6`) with mac `⌘1`…`⌘6` and Ctrl equivalents. Extend `ShortcutId` union. |
| [app-chrome.stories.tsx](../../src/components/app/app-chrome.stories.tsx) | **Modify** | Add states (see "States to ship" below). |
| [CLAUDE.md](../../CLAUDE.md) | **Modify** | Add one short note: the `src/tw/` shim is being phased out from files we actively touch; new chrome code uses raw HTML elements. Does not retract the broader "leave alone unless explicitly touched" stance for other files. |

### Files to delete

Route + page deletions (the routing source of truth and the corresponding page files):

| Route to remove from [router.tsx](../../src/router.tsx) | Page file to delete |
| --- | --- |
| `/templates` | [src/routes/pages/templates-page.tsx](../../src/routes/pages/templates-page.tsx) |
| `/forms` | [src/routes/pages/forms-page.tsx](../../src/routes/pages/forms-page.tsx) |
| `/activity` | [src/routes/pages/activity-page.tsx](../../src/routes/pages/activity-page.tsx) |
| `/feed` | [src/routes/pages/feed-page.tsx](../../src/routes/pages/feed-page.tsx) |
| `/files` | [src/routes/pages/files-page.tsx](../../src/routes/pages/files-page.tsx) |
| `/brainstorm` | [src/routes/pages/brainstorm-page.tsx](../../src/routes/pages/brainstorm-page.tsx) |
| `/expanses` | [src/routes/pages/expanses-page.tsx](../../src/routes/pages/expanses-page.tsx) |
| `/revenue` | [src/routes/pages/revenue-page.tsx](../../src/routes/pages/revenue-page.tsx) |
| `/kpi-okr` | [src/routes/pages/kpi-okr-page.tsx](../../src/routes/pages/kpi-okr-page.tsx) |
| `/stats` | [src/routes/pages/stats-page.tsx](../../src/routes/pages/stats-page.tsx) |
| `/analytics` | [src/routes/pages/analytics-page.tsx](../../src/routes/pages/analytics-page.tsx) |
| `/recordings` | [src/routes/pages/recordings-page.tsx](../../src/routes/pages/recordings-page.tsx) |
| `/timetracking` | [src/routes/pages/timetracking-page.tsx](../../src/routes/pages/timetracking-page.tsx) |
| `/roadmap` | [src/routes/pages/roadmap-page.tsx](../../src/routes/pages/roadmap-page.tsx) |

For each deleted route, also remove its slug from any feature-layout map that references it (search `routeToFeatureLayout` in [src/features/layout/panel-events.ts](../../src/features/layout/panel-events.ts) and prune dead entries). Storybook stories that import deleted page components must also be removed. Component-level files that *only* serve deleted features (e.g. `brainstorm-workspace.tsx`, `roadmap-*.tsx` if any exist) are out of scope for this PR — they become orphaned but unimported; cleanup ticket follows.

If a deleted route is reachable by a stale URL (bookmark, deep link), TanStack Router's catch-all behaviour redirects through the existing `/` → `/grid` flow. No new redirect rules are added.

## Per-Element Specification

### Moduo Mark
- **Render**: [src/components/ui/moduo-mark.tsx](../../src/components/ui/moduo-mark.tsx), `h-8 w-8` (32×32), `text-foreground`. No background, no border, no interaction.
- **Edge case**: always visible. The Mark does not respond to workspace count, to data-tabs mode, or to the loading state. It is the single persistent identity glyph.
- **A11y**: `aria-hidden="true"` on the SVG; the Mark conveys brand identity, not navigation.

### Workspace Switcher trigger
- **Visible when**: `workspaces.length > 1`. The component returns `null` otherwise. The dropdown content (create / join / list / delete) is unchanged and remains fully functional when the trigger is rendered.
- **Trigger layout**: `[h-7 w-7 Avatar (rounded-avatar)] [name truncated to 14ch] [chevron h-4 w-4]`, all inside a single button. Gap `gap-1.5`. Padding `px-2 h-8`. Background `bg-transparent`, hover `bg-accent text-foreground` (matches the foundation chevron pattern that's already there). Focus ring on `focus-visible`.
- **Avatar source**: the workspace's first character on `AvatarFallback` (same as today's dropdown list). Workspace image, if any, takes precedence — same pattern as `UserMenu`.
- **Name truncation**: 14 characters max, `text-ellipsis`, full name still announced via `aria-label` and Tooltip.
- **Decoupled from `data-tabs`**: the trigger appearance does not change between `auto` and `icons` modes. Only the module tabs respond to `data-tabs`. (Decided in grilling — workspace switcher visibility is data-driven, not preference-driven.)
- **Keyboard**: `⌘⇧W` (existing shortcut, already wired) toggles the dropdown. The shortcut works even when the trigger is hidden (single-workspace case): if a user has one workspace and presses `⌘⇧W`, nothing happens silently. Acceptable — they have nothing to switch to.
- **Edge case (single workspace, no trigger visible)**: a user who wants to add a second workspace reaches it via **Settings → Workspace**, where a "Add workspace" button opens the same create-flow. This is a one-time UI affordance for the first transition from 1 → 2 workspaces. Out of scope to ship the Settings entry in this PR; explicitly noted as a follow-up so we don't leave users stranded.

> **Risk flag for `/brief-to-tasks`**: the "Add workspace" entry in Settings is a real dependency, not just a follow-up wish. If we ship the trigger-hide behaviour without it, single-workspace users have no in-app path to create a second workspace until the Settings entry lands. The brief recommends landing both in the same PR — file an explicit task in the next skill.

### Module Tabs (the centre zone)
- **Source**: `baseModulesNavItems` trimmed to 6. Active determined by `pathname === tab.href || (tab.href !== "/" && pathname.startsWith(tab.href))` (unchanged).
- **Container**: `flex flex-row items-center gap-1`. No overflow scroll, no mask gradient — both removed.
- **`auto` mode (`data-tabs="auto"`)** — each tab renders `[icon size=14] [label]`:
  - Idle: `bg-transparent text-muted-foreground`, padding `px-3 h-8 gap-2 rounded-md`.
  - Hover: `bg-accent text-foreground` (ported from the workspace-chevron pattern).
  - Active: `bg-accent text-foreground`, `data-active="true"`, `aria-current="page"`.
  - Focus-visible: `ring-2 ring-ring ring-offset-2 ring-offset-background`.
- **`icons` mode (`data-tabs="icons"`)** — every tab collapses to `[icon size=14]` only:
  - Hit area: `h-8 w-8 rounded-md` — square, equal for every tab.
  - Idle: `text-muted-foreground`.
  - Hover: `bg-accent text-foreground`.
  - Active: `bg-accent text-foreground` only — no label shown (this is the fix to the size-mismatch issue). The icon glyph itself stays `size={14}`; the *active* signal is purely the bg + color shift.
  - The CSS rule in [src/global.css](../../src/global.css) that re-shows the active label gets **deleted**.
- **Tooltip content**: `<label> · <shortcut>`. Shortcut hint right-aligned inside the Tooltip using a small `<kbd>` element. Example: `Notes · ⌘2`. The shortcut text is derived per-platform via `formatShortcut` from [shortcuts.ts](../../src/lib/shortcuts.ts).
- **DOM contract preserved**: each tab still carries `data-slot="module-tab"` and (when labelled) `data-slot="module-tab-label"` for the icons-mode CSS that hides labels.
- **A11y**: button role, `aria-label` = `${tab.label} (${shortcut})`, `aria-current="page"` when active, focus ring on `focus-visible`.

### NotificationCenter trigger
- **Placement**: top-right zone, immediately left of the user avatar with `gap-2`.
- **Geometry**: `h-8 w-8` button matching the avatar's footprint. No badge implementation in this PR (existing unread-count behaviour, if any, is preserved verbatim).
- **Trigger styling**: matches module-tab idle/hover styles in icons-only mode — `text-muted-foreground` idle, `bg-accent text-foreground` hover, focus ring on `focus-visible`. Active/open state inherited from the existing Sheet trigger.
- **Tooltip**: `Notifications · ⌘/` (the existing `notifications` shortcut already lives in the registry).
- **Internals untouched**: the Sheet, the notification list, the empty state — all out of scope.

### User Menu avatar
- **Placement**: top-right zone, far right.
- **Geometry**: 32×32 with `rounded-avatar` and `border-border` (existing). Pinned to match NotificationCenter size.
- **Tooltip**: `Account & settings` (existing copy). No shortcut hint — `⌘,` opens the modal directly via the existing `settings` shortcut.
- **Internals untouched** beyond size confirmation.

### GlobalBottomBar trio
- **Container**: `flex flex-row items-center justify-center gap-2`, height `var(--bar-h)`, role `toolbar`, `aria-label="Global actions"` (existing).
- **Buttons**: all three reuse the local `BarButton` helper or are extracted into a shared variant if it doesn't already exist.
  - **Settings (sliders)**: `SlidersHorizontal` from lucide-react at `size-4`. Tooltip `Feature settings`. `onClick` is a no-op (`() => {}`) — no dispatch wired in this PR. Once feature-specific settings exist, the handler resolves per current feature; that's a future polish run's problem.
  - **Search**: existing `Search` icon, existing `dispatchOpenPalette()` handler, existing `Search` tooltip. No change beyond the geometry pin.
  - **Create**: existing `Plus` icon, existing `dispatchCreateNew()` handler, existing `Create new` tooltip. Tooltip copy gains a `· ⌘N` shortcut hint to match the top-bar pattern.

## Keyboard Contract

All shortcuts route through [src/lib/shortcuts.ts](../../src/lib/shortcuts.ts) — no inline event listeners in app-chrome for module switching.

| Shortcut (mac) | Shortcut (other) | Action | Source |
| --- | --- | --- | --- |
| `⌘K` | `Ctrl K` | Open command palette | Existing — `palette` |
| `⌘N` | `Ctrl N` | Create new in current feature | Existing — `new-item` |
| `⌘,` | `Ctrl ,` | Open Settings modal | Existing — `settings` |
| `⌘⇧W` | `Ctrl Shift W` | Toggle workspace switcher (no-op when single-workspace) | Existing — `workspace-switcher` |
| `⌘/` | `Ctrl /` | Open NotificationCenter sheet | Existing — `notifications` |
| `⌘1` | `Ctrl 1` | Navigate to module 1 (Grid) | **New** — `module-1` |
| `⌘2` | `Ctrl 2` | Navigate to module 2 (Notes) | **New** — `module-2` |
| `⌘3` | `Ctrl 3` | Navigate to module 3 (Ground) | **New** — `module-3` |
| `⌘4` | `Ctrl 4` | Navigate to module 4 (Mindmap) | **New** — `module-4` |
| `⌘5` | `Ctrl 5` | Navigate to module 5 (Email) | **New** — `module-5` |
| `⌘6` | `Ctrl 6` | Navigate to module 6 (CRM) | **New** — `module-6` |

Implementation note: the shortcut registry resolves the *index* to the current ordered `modulesNavItems` list. If a module is permission-filtered out (Notes/Tasks) in the future, the shortcut still maps to index N — meaning `⌘2` always means "second visible module", not literally "Notes". This is consistent with how the visible row reads top-to-bottom. (Today, only Notes/Tasks are permission-filtered; both are kept.)

When the user is typing in an editable target (input, textarea, contenteditable), only the palette shortcut fires. Module-switch shortcuts skip — same rule as `new-item` today. This is enforced in the existing `useGlobalShortcuts` hook; the new entries inherit it for free.

## Interactions and Motion

- **Active-tab state change**: no animated transition. The `bg-accent` paint applies instantly when `data-active` flips. This is deliberate — animating active-tab moves draws attention to chrome at the expense of content.
- **Hover state**: `transition-colors` with `duration` mapped to `var(--motion-fast)` (100 ms). Colour fades only; no size or position change.
- **Workspace switcher dropdown open/close**: inherits `DropdownMenu` default Radix animation (already token-driven via the foundation tokens).
- **NotificationCenter sheet open**: inherits `Sheet` default Radix animation.
- **No layout shift on workspace count flipping 1 → 2**: when a user creates their second workspace via Settings, the switcher appears in the left zone. The Mark stays anchored; the workspace trigger slides in to its right. Animation: opacity-only fade-in at `var(--motion-base)`. No translate, no width animation. This avoids the centre module-nav reflowing visibly.
- **`prefers-reduced-motion`**: respected automatically by the existing motion tokens. No additional handling needed.

## States to ship (Storybook)

Updated in [src/components/app/app-chrome.stories.tsx](../../src/components/app/app-chrome.stories.tsx). Each story snapshot covers a meaningful axis of variation:

1. **Default** — `data-tabs="auto"`, multi-workspace context, all 6 module tabs visible with labels, the user on `/notes` (active = Notes).
2. **Icons-only mode** — `data-tabs="icons"`, multi-workspace context, all 6 tabs as equal-width icon squares, active highlighted by colour alone.
3. **Single workspace** — `data-tabs="auto"`, `workspaces.length === 1`, workspace switcher trigger hidden, only Moduo Mark in left zone.
4. **Narrow viewport** — window at 1024px (the minimum). The 6 tabs fit without scroll; verify spacing doesn't crowd. No layout change vs. default story other than viewport.
5. **Trial banner active** — confirms the bar respects the banner above without z-index bleed.

The bottom bar appears in every story (it's part of the shell). Standalone bottom-bar stories are out of scope — the chrome stories cover it.

A primitive-test row in [tests/visual/primitives.spec.ts](../../tests/visual/primitives.spec.ts) is *not* required because no new shadcn primitives are added.

## Responsive Behavior

This is a Tauri desktop app. Min window 1024×700. With 6 module tabs at `auto` density, fit is comfortable across the supported range.

- **≥ 1280 px**: default. All bar zones at their natural widths.
- **1024–1280 px**: no change. 6 tabs with labels still fit. If a user prefers `data-tabs="icons"`, they've already chosen tighter chrome via Settings — that mode handles narrower windows trivially.
- **< 1024 px**: not supported (Tauri-enforced minimum).
- **Window-width listener**: none added. The bar layout is static; only `data-tabs` user preference drives mode changes.

## Accessibility

- **Contrast**: `text-foreground` on `bg-accent` is verified ≥ 4.5:1 in both themes via the foundation token audit. No change here.
- **Focus**: every interactive element shows a `focus-visible:ring-2 focus-visible:ring-ring ring-offset-2 ring-offset-background` ring. Mouse focus stays quiet.
- **Tooltips**: every icon-only or icon-dominant element (Mark is non-interactive; all others) has a Tooltip with full label + shortcut where applicable. Tooltip composes `aria-label` via shadcn's Radix wrapper.
- **`aria-current="page"`** on the active module tab.
- **`aria-label`** on the workspace-switcher trigger announces the current workspace name even when truncated visually.
- **Reduced motion**: respected via the existing token override.
- **Tab order**: Mark (non-tabbable) → Workspace trigger (if visible) → module tabs (in declared order) → NotificationCenter → Avatar → bottom-bar trio (Settings → Search → Create). Verify in narrow-viewport story.
- **Screen reader semantics**: top bar is a `<nav>` landmark with `aria-label="Workspace navigation"` (new — clarifies the landmark name; this is a label addition, not a token addition). Bottom bar already has `role="toolbar" aria-label="Global actions"` (unchanged).

## File Manifest

### Modified
- [src/components/app/app-chrome.tsx](../../src/components/app/app-chrome.tsx)
- [src/components/app/app-chrome-constants.ts](../../src/components/app/app-chrome-constants.ts)
- [src/components/app/app-chrome-types.ts](../../src/components/app/app-chrome-types.ts)
- [src/components/app/app-chrome.stories.tsx](../../src/components/app/app-chrome.stories.tsx)
- [src/components/app/global-bottom-bar.tsx](../../src/components/app/global-bottom-bar.tsx)
- [src/components/workspace-switcher.tsx](../../src/components/workspace-switcher.tsx)
- [src/components/user-menu.tsx](../../src/components/user-menu.tsx) (light pass — geometry pin only)
- [src/components/notification-center.tsx](../../src/components/notification-center.tsx) (trigger geometry only; Sheet untouched)
- [src/lib/shortcuts.ts](../../src/lib/shortcuts.ts) (add six entries; extend the union)
- [src/router.tsx](../../src/router.tsx) (remove 14 route registrations)
- [src/features/layout/panel-events.ts](../../src/features/layout/panel-events.ts) (prune dead feature-layout entries for removed routes)
- [src/global.css](../../src/global.css) (delete the `[data-tabs="icons"] ... [data-active="true"] ... label { display: inline }` rule)
- [CLAUDE.md](../../CLAUDE.md) (one paragraph: shim phase-out note)
- [scripts/check-arbitrary-tw.ts](../../scripts/check-arbitrary-tw.ts) — remove `app-chrome.tsx` from `IGNORED_PATHS` once it's fully on tokens (verify nothing slips through)

### Deleted
- 14 page files in [src/routes/pages/](../../src/routes/pages/) — listed in the "Files to delete" table above.
- Any storybook stories that import only the deleted page components.

### New
- *No new files.* The `ModuleTab` sub-component lives inside [app-chrome.tsx](../../src/components/app/app-chrome.tsx); the brief does not introduce a new chrome file because nothing else in the codebase consumes `ModuleTab`.

## Risks

1. **Route deletion side-effects.** Some deleted routes may be referenced from non-obvious places (notification deep links, onboarding flows, share URLs). `/brief-to-tasks` should produce an explicit "grep for each deleted slug across the entire codebase" task before deleting the page file.
2. **The Settings → Workspace "Add workspace" affordance.** If we ship the trigger-hide change without it, a user with 1 workspace can't create a second. This brief flags it as a follow-up; the next skill must decide whether to bundle it into this PR or commit to landing the Settings change in the same release.
3. **Shortcut conflict on web.** Browsers reserve `⌘1..⌘9` for tab switching (most browsers). When moduo runs in a browser tab (the `dev:web` build), `⌘1` will switch the browser's tab, not moduo's module. This is acceptable — moduo's primary surface is Tauri desktop; web is a dev convenience. We do not preventDefault on browser tab shortcuts. Note in the implementation comment so future contributors don't try to "fix" it.
4. **Shim removal scope drift.** The change in [CLAUDE.md](../../CLAUDE.md) explicitly says "files we actively touch" — not "always remove the shim". `/frontend-design` and `/design-review` should both enforce this. If reviewers see shim removal in files outside `app-chrome.tsx`, fail the review.
5. **`data-tabs` migration semantics.** Removing the `[data-tabs="icons"] [data-active="true"] label { display: inline }` CSS rule changes the active-tab visual in icons mode for *every existing user* with icons mode on. We're banking on the fix being a genuine improvement (per the grilling). If a user has muscle memory tied to "the labelled tab is active", they'll hit a small adjustment period.
6. **Workspace trigger visibility flip.** A user transitioning from 1 → 2 workspaces sees the trigger materialise in the left zone. The opacity-only fade prevents a startling reflow. Verify in the multi-workspace story.

## Out of Scope

- Real settings UI behind the bottom-bar `SlidersHorizontal` icon.
- The "Add workspace" entry in Settings → Workspace (recommended follow-up, but not part of this PR).
- Per-workspace Moduo Mark customization (colors, textures, variants).
- Breadcrumb / page title in the top bar.
- Bottom-bar redesign beyond the three-icon trio.
- NotificationCenter internals (the Sheet, the list, the empty state, the unread badge).
- TrialBanner internals.
- Loading-state skeleton for the workspace boot.
- Light-mode visual tuning.
- Mobile / tablet layouts.
- `src/tw/` shim removal outside [src/components/app/app-chrome.tsx](../../src/components/app/app-chrome.tsx).
- Cleanup of orphaned feature components whose routes are deleted (`brainstorm-workspace.tsx`, etc.) — follow-up ticket.
- Linear-style command-palette enhancements; the palette itself is unchanged here.
- New shadcn primitives.
- New design tokens. (The brief enforces this as a hard constraint; downstream skills repeat it.)
