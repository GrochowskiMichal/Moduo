# Build Tasks: Top Panel Polish

Generated from: [.design/top-panel-polish/DESIGN_BRIEF.md](./DESIGN_BRIEF.md)
Date: 2026-05-14
Branch contract (from CLAUDE.md + CONTRIBUTING.md): `t/<owner>/top-panel-polish` off the personal branch.

> Vertical slices. Each task = one commit you can pull and see something working. Tasks ship in order; do not skip dependencies. After every task, run the lint commands listed in `[Lint]` before committing.
>
> The PR bundles all of these. Each individual task is also reviewable in isolation if we end up splitting later.

## Ordering principles applied

1. **Risk-first**: shortcut registry extension lands first (typed change, zero UI impact — flushes any compile-level surprises).
2. **Dependencies before consumers**: the Settings "Add workspace" entry lands before the workspace-switcher trigger-hide, so single-workspace users never lose the ability to create a second workspace.
3. **Visual feedback early**: top-bar layout rewrite + module-tab polish land before the route-deletion work, so the user sees the chrome polish on screen before the destructive cleanup begins.
4. **Destructive work last**: route deletion + panel-events pruning sits at the end of the chain. Anything that grep finds during preparation can adjust the deletion plan without unwinding earlier visual work.
5. **Docs / Storybook last**: the stories cover the final shape; updating them mid-stream wastes effort.

## Heads-up before you start

- `src/components/app/app-chrome.tsx` is **not** in [IGNORED_PATHS](../../scripts/check-arbitrary-tw.ts) today — it's already lint-enforced. There's nothing to remove from the list; the "lint discipline" line in the brief is satisfied by *not introducing* new violations.
- `src/features/layout/panel-events.ts` carries a `FeatureLayoutKey` union of all 23 routes. Pruning it must happen in lockstep with route deletion or typecheck fails.
- Browser `⌘1..⌘9` collides with browser tab switching on the `dev:web` build. We accept this — moduo is Tauri-first. Document it in code, don't try to `preventDefault` it.

---

## 1. Extend the shortcut registry

- **Files**: [src/lib/shortcuts.ts](../../src/lib/shortcuts.ts)
- **Change**: Add six entries to `SHORTCUTS` and extend the `ShortcutId` union: `module-1` through `module-6`, each with mac `⌘1`..`⌘6` and other `Ctrl 1`..`Ctrl 6`. The `match` predicate fires only when the metakey/ctrl is held without shift/alt and the key is `"1"`..`"6"`. Skip on editable targets (the existing `useGlobalShortcuts` already enforces this for non-palette entries — verify nothing changes). Add a short comment above the new block noting the browser tab-switch collision on web.
- **Verify**: `bun run typecheck` clean. Manually press `⌘1` in the running Tauri dev build (it won't navigate yet — no handler) and confirm no console error. In the browser dev build, `⌘1` will switch the browser tab; that's expected.
- **Lint**: `bun run typecheck`
- **Depends on**: nothing

## 2. Settings → Workspace: "Add workspace" affordance

- **Files**: [src/features/settings/sections/workspace-section.tsx](../../src/features/settings/sections/workspace-section.tsx), possibly [src/components/workspace-settings-modal.tsx](../../src/components/workspace-settings-modal.tsx)
- **Change**: Add an "Add workspace" button to the Workspace section in Settings. Reuse the existing create flow inside `WorkspaceSwitcher` (factor out a `useCreateWorkspaceFlow()` hook from the switcher, or duplicate the inline form into the section — favour extraction). The button is `<Button variant="outline" size="sm">+ Add workspace</Button>`, placed next to the existing "Open workspace settings" button. Clicking it opens an inline name input + save/cancel (matching the switcher's create UI) or a small Dialog — pick whichever is closer to the existing create UX. Respect the `unlimited_workspaces` entitlement (an existing `useEntitlement` call is in the switcher; copy the gate).
- **Verify**: Open Settings → Workspace. Click "Add workspace". Type a name. Save. Confirm the new workspace appears in the workspace switcher dropdown and is selectable. Confirm the entitlement-gated path opens the `UpgradeModal` for users without the entitlement.
- **Lint**: `bun run typecheck`, `bun run lint:tw`, `bun run lint:css`
- **Depends on**: nothing (independent of shortcut work)

## 3. Workspace switcher trigger refresh

- **Files**: [src/components/workspace-switcher.tsx](../../src/components/workspace-switcher.tsx)
- **Change**:
  - Add an early return `if (workspaces.length <= 1) return null;` (preserves the `useShortcut("workspace-switcher", …)` registration as a no-op — the hook still mounts when the component renders, but the component doesn't render when ≤ 1 workspace, so the shortcut becomes inert in that case; acceptable).
  - Replace the chevron-only `DropdownMenuTrigger` with a labelled trigger: `[h-7 w-7 Avatar (rounded-avatar, AvatarFallback = first char of workspace name)] [name truncated to 14ch with text-ellipsis] [ChevronDown h-4 w-4]`, all inside a single button. Container: `flex flex-row items-center gap-1.5 px-2 h-8 rounded-md bg-transparent hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors`.
  - Keep the Tooltip wrapper. Update tooltip copy to `Switch workspace · ⌘⇧W`.
  - The dropdown content (list, create, join, delete) is **unchanged**.
- **Verify**: In Storybook (or a dev session with multiple workspaces): trigger renders the workspace name + avatar + chevron. In a single-workspace context: nothing renders where the trigger used to be — the Moduo Mark sits alone on the left.
- **Lint**: `bun run typecheck`, `bun run lint:tw`, `bun run lint:css`
- **Depends on**: task 2 (the trigger-hide change strands single-workspace users without it)

## 4. Module nav source trim

- **Files**: [src/components/app/app-chrome-constants.ts](../../src/components/app/app-chrome-constants.ts), [src/components/app/app-chrome-types.ts](../../src/components/app/app-chrome-types.ts), [src/components/app/app-chrome.tsx](../../src/components/app/app-chrome.tsx)
- **Change**:
  - In `app-chrome-types.ts`: remove `desktopOnly?: boolean` from `ModuleNavItem`.
  - In `app-chrome-constants.ts`: trim `baseModulesNavItems` to exactly six entries in this order:
    1. Grid (`/`, `grid` icon)
    2. Notes (`/notes`, `file-text` icon, `module: "notes"`)
    3. Ground (`/ground`, `ground-roots` icon)
    4. Mindmap (`/mindmap`, `git-branch` icon, `module: "mindmap"`)
    5. Email (`/email`, `mail` icon, `module: "email"`) — **drop** `desktopOnly: true`
    6. CRM (`/crm`, `folder` icon)
  - In `app-chrome.tsx`: in the `modulesNavItems = useMemo(…)` block, remove the `if (tab.desktopOnly && isWebRuntime) return false;` branch. Remove the now-unused `isWebRuntime` variable. Module-permission filtering (Notes, Tasks) stays.
- **Verify**: Dev server still renders. The top bar shows six tabs only. Routes for the 14 deleted modules **still work** if you navigate to them by URL (e.g. `/forms`) — they're just no longer in the top nav. This is the intended intermediate state.
- **Lint**: `bun run typecheck`, `bun run lint:tw`, `bun run lint:css`
- **Depends on**: nothing — but if task 5 (layout rewrite) ships first, you'd ship the layout rewrite with 20 tabs in it temporarily. Better to trim first so task 5 already operates on six tabs.

## 5. Top-bar layout rewrite + shim removal

- **Files**: [src/components/app/app-chrome.tsx](../../src/components/app/app-chrome.tsx)
- **Change**:
  - Replace `<View>` with `<div>`, `<Text>` with `<span>`, throughout this file. Same classNames. Remove the `import { Pressable, Text, View } from "../../tw";` line.
  - Rewrite the top-bar markup to a CSS grid: outer wrapper `grid w-full items-center` with inline style `gridTemplateColumns: "1fr auto 1fr"`. Three direct children:
    - Left: `flex flex-row items-center justify-start gap-1` — hosts `<ModuoMark />` + `<WorkspaceSwitcher />`.
    - Centre: `flex flex-row items-center justify-center gap-1` — hosts the module tabs (inline JSX for now; extracted in task 6). Remove the mask-image overflow scroll wrapper.
    - Right: `flex flex-row items-center justify-end gap-2` — hosts `<NotificationCenter />` + `<UserMenu />`.
  - Mount `<NotificationCenter />` in the right zone (it currently lives inside `<GlobalBottomBar />`; import path is [src/components/notification-center.tsx](../../src/components/notification-center.tsx)). Note: do **not** remove it from the bottom bar yet — that lands in task 7. Until then it renders in both places; verify that's tolerated (the Sheet is keyed on a unique id; if it isn't, scope one). If duplication causes issues, ship task 7 in the same commit as this one.
  - Pin element geometry: Moduo Mark stays `h-8 w-8`; workspace trigger button `h-8`; NotificationCenter trigger `h-8 w-8`; UserMenu avatar trigger `h-8 w-8` (the avatar trigger is `h-9 w-9` today — bump down to `h-8 w-8` for consistency).
  - Add the landmark: outer top-bar `View` (now `div`) becomes `<nav aria-label="Workspace navigation">`.
- **Verify**: Top bar renders with three zones. Module nav is *viewport-centred* (drag the workspace switcher trigger's name length in DevTools by editing the workspace name — tabs do not drift). NotificationCenter bell sits left of the avatar. All bar elements visually ≈ 32 px tall. Tauri dev session: full-screen toggle and avatar still work (the existing effects are untouched).
- **Lint**: `bun run typecheck`, `bun run lint:tw`, `bun run lint:css`
- **Depends on**: task 4 (trimmed list means the centre zone fits without scroll); task 3 (switcher trigger uses the new shape)

## 6. Module tab polish

- **Files**: [src/components/app/app-chrome.tsx](../../src/components/app/app-chrome.tsx), [src/global.css](../../src/global.css)
- **Change**:
  - Extract a `ModuleTab` component inside `app-chrome.tsx` (file-local, not exported). Props: `{ item: ModuleNavItem; active: boolean; index: number; }`. Renders a `<Tooltip>` wrapping a `<TooltipTrigger>` with:
    - `data-slot="module-tab"`, `data-active={active}`, `aria-current={active ? "page" : undefined}`, `aria-label={\`${item.label} (${shortcutHint})\`}`.
    - In `auto` mode (default layout): `flex flex-row items-center gap-2 rounded-md px-3 h-8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${active ? "bg-accent text-foreground" : "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"}`.
    - Icon at `size={14}`. Label inside `<span data-slot="module-tab-label" className="text-sm">`.
    - The `h-8 w-8` square-in-icons-mode geometry is delegated to CSS — in `data-tabs="icons"` mode the existing CSS hides the label; with the label hidden the pill collapses naturally. Add a CSS rule next to the existing icons-mode rule in `global.css`: `[data-tabs="icons"] [data-slot="module-tab"] { width: 2rem; padding-left: 0; padding-right: 0; justify-content: center; }`.
  - In `global.css`: **delete** the rule `[data-tabs="icons"] [data-slot="module-tab"][data-active="true"] [data-slot="module-tab-label"] { display: inline; }`. The active tab in icons-only mode no longer keeps its label — it's signaled by color only.
  - Wire `⌘1..⌘6`: in `app-chrome.tsx`, add `useShortcut("module-1", () => navigateToIndex(0))` … `useShortcut("module-6", () => navigateToIndex(5))`. `navigateToIndex(i)` looks up `modulesNavItems[i]` and calls `navigate({ to: item.href })`; no-op if `i` is out of range.
  - Tooltip content: `<span>{item.label}</span><kbd className="ml-2 text-xs text-muted-foreground">{shortcutHint}</kbd>`. Resolve `shortcutHint` via `formatShortcut(SHORTCUTS.find(s => s.id === \`module-${index + 1}\`)!)` from [shortcuts.ts](../../src/lib/shortcuts.ts).
- **Verify**:
  - Default mode: tabs show icon + label. Hover any inactive tab → `bg-accent text-foreground` (matches workspace-chevron hover). Active tab persistently `bg-accent text-foreground`. Tooltip hover shows `Notes · ⌘2` style hint.
  - Icons-only mode (toggle via Settings → Appearance): every tab is a square 32×32 icon hit area, equal width. The active tab is signaled only by background colour. Tooltip on hover still shows the label.
  - Press `⌘1` in Tauri dev → navigates to `/`. `⌘6` → `/crm`. `⌘7` → no-op.
  - Browser dev session: `⌘1` switches the browser tab. Expected.
- **Lint**: `bun run typecheck`, `bun run lint:tw`, `bun run lint:css`
- **Depends on**: task 1 (shortcut registry), task 5 (layout rewrite — module tab geometry depends on the grid centre zone existing)

## 7. Bottom bar update

- **Files**: [src/components/app/global-bottom-bar.tsx](../../src/components/app/global-bottom-bar.tsx)
- **Change**:
  - Remove the `<NotificationCenter />` import + element.
  - Add a leading `<BarButton>` containing `<SlidersHorizontal className="size-4" aria-hidden />` from `lucide-react`. Label: `Feature settings`. `onClick`: no-op (`() => {}`) — write as `() => { /* placeholder for per-feature settings; wired by per-feature polish */ }` so the comment survives.
  - Final order: settings · search · create.
  - Update Create button's tooltip from `Create new` to `Create new · ⌘N` (resolved via `formatShortcut` for consistency with the top-bar tooltips).
- **Verify**: Bottom bar renders three buttons centred: sliders, magnifier, plus. Sliders click is silent. Magnifier opens the command palette. Plus dispatches `dispatchCreateNew`.
- **Lint**: `bun run typecheck`, `bun run lint:tw`, `bun run lint:css`
- **Depends on**: task 5 (NotificationCenter must already exist in the top bar before it's removed from the bottom, or the user loses access mid-PR)

## 8. Route-deletion grep & plan

- **Files**: scratchpad — no code change. Write findings to `.design/top-panel-polish/DELETION_NOTES.md` (new file in this directory, not the repo root).
- **Change**:
  - For each of the 14 deleted slugs (`templates`, `forms`, `activity`, `feed`, `files`, `brainstorm`, `expanses`, `revenue`, `kpi-okr`, `stats`, `analytics`, `recordings`, `timetracking`, `roadmap`), grep `src/` for:
    - String literals containing the slug (`/templates`, `"templates"`, `'templates'`).
    - Imports from `src/routes/pages/<slug>-page.tsx`.
    - References in `src/features/<slug>/` directories.
    - Storybook stories importing the page component.
    - Onboarding flows or notification deep links pointing at the route.
  - Specifically check: [src/features/layout/panel-events.ts](../../src/features/layout/panel-events.ts) (the `FeatureLayoutKey` union and the `routeToFeatureLayout` function), [src/routes/pages/onboarding-page.tsx](../../src/routes/pages/onboarding-page.tsx), notification-center handlers, command-palette item catalogue (if it references routes).
  - Write a checklist in DELETION_NOTES.md: per slug, list every file that needs editing or deletion. This becomes the input to task 9.
- **Verify**: DELETION_NOTES.md exists and lists at least the obvious references (panel-events.ts union/map/function, router.tsx registrations, the page files themselves). Spot-check 2–3 slugs by grepping yourself.
- **Lint**: none (no source changes)
- **Depends on**: nothing — can run in parallel with the earlier tasks, but execution (task 9) is gated on completion.

## 9. Route deletion execution

- **Files**:
  - [src/router.tsx](../../src/router.tsx) — remove 14 route registrations.
  - [src/features/layout/panel-events.ts](../../src/features/layout/panel-events.ts) — prune `FeatureLayoutKey` union, the `cloneDefaultMap` entries, and the `routeToFeatureLayout` switch (`/templates`, `/forms`, `/activity`, `/feed`, `/files`, `/brainstorm`, `/expanses`, `/revenue`, `/kpi-okr`, `/stats`, `/analytics`, `/recordings`, `/timetracking`, `/roadmap` cases all go). Keep `/tasks` and `/calendar` cases — they redirect to `/ground` and that stays.
  - Delete (one commit each, or batched — your call):
    - [src/routes/pages/templates-page.tsx](../../src/routes/pages/templates-page.tsx)
    - [src/routes/pages/forms-page.tsx](../../src/routes/pages/forms-page.tsx)
    - [src/routes/pages/activity-page.tsx](../../src/routes/pages/activity-page.tsx)
    - [src/routes/pages/feed-page.tsx](../../src/routes/pages/feed-page.tsx)
    - [src/routes/pages/files-page.tsx](../../src/routes/pages/files-page.tsx)
    - [src/routes/pages/brainstorm-page.tsx](../../src/routes/pages/brainstorm-page.tsx)
    - [src/routes/pages/expanses-page.tsx](../../src/routes/pages/expanses-page.tsx)
    - [src/routes/pages/revenue-page.tsx](../../src/routes/pages/revenue-page.tsx)
    - [src/routes/pages/kpi-okr-page.tsx](../../src/routes/pages/kpi-okr-page.tsx)
    - [src/routes/pages/stats-page.tsx](../../src/routes/pages/stats-page.tsx)
    - [src/routes/pages/analytics-page.tsx](../../src/routes/pages/analytics-page.tsx)
    - [src/routes/pages/recordings-page.tsx](../../src/routes/pages/recordings-page.tsx)
    - [src/routes/pages/timetracking-page.tsx](../../src/routes/pages/timetracking-page.tsx)
    - [src/routes/pages/roadmap-page.tsx](../../src/routes/pages/roadmap-page.tsx)
  - Any additional refs surfaced by task 8 (stories, onboarding entries, dead imports).
  - **Do not** delete `src/features/<slug>/` directories or their unused components. Orphans are accepted per the brief; cleanup is a follow-up ticket.
- **Verify**:
  - `bun run typecheck` clean.
  - Dev server boots without router errors.
  - Navigating directly to `/forms`, `/templates`, etc. now falls through to the default redirect (typically `/grid`).
  - Top bar shows 6 tabs; clicking each navigates correctly.
  - `⌘1..⌘6` still navigate.
- **Lint**: `bun run typecheck`, `bun run lint:tw`, `bun run lint:css`
- **Depends on**: tasks 4, 5, 6 (the top-bar polish must already be live so that the user gets visual benefit at the moment we cut access), task 8 (grep findings).

## 10. Storybook + CLAUDE.md note

- **Files**: [src/components/app/app-chrome.stories.tsx](../../src/components/app/app-chrome.stories.tsx), [CLAUDE.md](../../CLAUDE.md)
- **Change**:
  - Replace the stub story with five `StoryObj` definitions:
    1. `Default` — `data-tabs="auto"`, multi-workspace fixture, active route `/notes`.
    2. `IconsOnly` — `data-tabs="icons"`, multi-workspace, active route `/grid`.
    3. `SingleWorkspace` — `data-tabs="auto"`, fixture with one workspace; the switcher trigger does not render.
    4. `NarrowViewport` — `data-tabs="auto"`, viewport pinned to 1024 px via Storybook `parameters.viewport` config.
    5. `TrialBannerActive` — `data-tabs="auto"`, `TrialBanner` rendered above the bar. Confirms z-index and height math hold.
  - Use a Storybook decorator to mount fake providers (`AuthProvider`, `WorkspaceProvider`) with fixture data. If the existing stub doesn't already do this, factor a `withChromeProviders` decorator file alongside the story file.
  - In `CLAUDE.md`, add one short paragraph under the "Repo layout" section (or near the existing `src/tw/` note): "The `src/tw/` shim is being phased out from files we actively touch. New chrome code uses raw HTML elements. Pre-existing usages stay until each file has a reason to be edited."
- **Verify**: `bun run storybook` → all five stories render without errors. The `IconsOnly` story shows six equal-width square icon tabs with no labels. The `SingleWorkspace` story shows only the Moduo Mark in the left zone.
- **Lint**: `bun run typecheck`, `bun run lint:tw`, `bun run lint:css`
- **Depends on**: tasks 3, 5, 6, 7 (all the visual changes that the stories need to reflect)

## 11. Design review

- **Files**: none (skill output)
- **Change**: Run `/design-review` against [.design/top-panel-polish/DESIGN_BRIEF.md](./DESIGN_BRIEF.md). Address findings in follow-up commits on the same branch before opening the PR for review.
- **Verify**: review notes file produced by the skill is clean (or its findings are filed as follow-up tickets if explicitly out of scope).
- **Lint**: re-run all three (`typecheck`, `lint:tw`, `lint:css`) before the final commit.
- **Depends on**: all preceding tasks.

---

## Out of scope (do not let scope creep eat these into this PR)

- "Add workspace" entry's visual polish beyond a serviceable affordance — Settings page itself gets its own polish run.
- Per-feature behaviour behind the bottom-bar `SlidersHorizontal` icon (placeholder only).
- Cleanup of orphaned `src/features/<deleted-slug>/` directories.
- Removing `IGNORED_PATHS` entries unrelated to this PR.
- Mobile / tablet adjustments.
- Light-mode visual tuning.
- TrialBanner internals.
- NotificationCenter internals.
- `src/tw/` shim removal in files other than `src/components/app/app-chrome.tsx`.
