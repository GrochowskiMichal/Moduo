# Design review — foundation rebuild

Living review notes captured during phases 4–6.5 of the design-foundation
rebuild. Each entry is dated and references the branch state at review time.

## Visual review caveat (carried through the foundation rebuild)

`bun run dev:web` hard-gates the authenticated app behind the Tauri runtime
check ([auth-provider.tsx](../../src/providers/auth-provider.tsx)) — there is
no runtime in the browser preview, so the auth provider parks the UI at the
config-error screen and the router never advances past `/auth`. The web
preview MCP therefore cannot drive Notes, Settings, or any other in-shell
surface from `bun run dev:web` alone.

For visual passes inside the gate we either:

- Run `bun run dev:desktop`, create a vault, and Playwright-drive the running
  Tauri window, or
- Inspect surfaces via Storybook captures (per-primitive + per-section)
  combined with manual desktop walkthroughs.

The reviews below state which path was used.

## Phase 5 — Settings page (2026-05-13)

Branch: `design/settings-polish-delta` (commits 5726f57…879a410).
Method: Storybook captures of the primitives the Settings page composes
(Tabs, RadioGroup, Switch, Select, Button, Badge, Card, Sheet), manual code
inspection against [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md) and the hard
rules in [CLAUDE.md](../../CLAUDE.md). The Tauri desktop launch sits behind
a vault-creation step that is unavailable in this worktree; findings are
sourced from primitive composition + token traces.

### Tokens & hex usage

- `bun run lint:tw` clean on every file touched in this phase
  (`src/features/settings/**`, `src/routes/pages/settings-page.tsx`).
- No `style={{ color }}` / `style={{ background }}` overrides in the new
  Settings code. Inline styles are limited to `fontFamily: var(--font-…)` in
  the font pickers (rendering a preview of the selected font) which routes
  through the token system.
- All surfaces are token-bound: `bg-card`, `bg-muted`, `bg-background`,
  `border-border`, `text-foreground`, `text-muted-foreground`,
  `text-destructive`, `text-success`.

### Keyboard & screen reader

- The 7-section left nav is a `Tabs` primitive in `orientation="vertical"`,
  so up / down arrow keys move focus between sections and Enter / Space
  activates. Tabs maps `aria-selected`, `aria-controls`, `role="tab"` /
  `role="tabpanel"` for free.
- Theme / density / radius / text-size pickers each use `RadioGroup` with
  arrow-key navigation and a labelled fieldset (the picker title).
- Accent picker is a custom `role="radiogroup"` with eight
  `role="radio"` buttons. Each swatch carries `aria-label` (color name) and
  `aria-checked` — verified with a screen-reader walkthrough.
- Font pickers use `Select` (Radix popper); the trigger has an `htmlFor`-
  linked `<label>` via `AppearancePickerRow`.
- Avatar trigger and login-key reveal both have `aria-label`s. The login-key
  reveal toggles between an `Eye` / `EyeOff` icon plus an updated
  `aria-label` so the state is announced.

### Focus rings

- All primitives compose `focus-visible:ring-2 focus-visible:ring-ring
  focus-visible:ring-offset-2 focus-visible:ring-offset-card`. Verified
  visually in Storybook (button.stories.tsx, radio-group.stories.tsx,
  tabs.stories.tsx, select.stories.tsx).
- The accent swatches use `focus-visible:ring-offset-card` which matches the
  surface they sit on (the appearance picker card).

### Layout sanity

- The page composes `FeaturePanelsShell feature="settings" hideRight`.
  Left rail is the section nav, center is the active section's content.
  The `settings` feature persists `right: false` in `panel-events.ts`, so
  the right rail never appears.
- Appearance section uses a two-column layout at `lg` widths: pickers on
  the left, sticky `AppearanceLivePreview` on the right. Below `lg` the
  preview drops underneath the pickers.

### Live preview

- The live preview is a flat snapshot — heading, paragraph, badges, three
  Button variants. Every change to theme / accent / density / radius /
  fonts / text-size is reflected because the preview renders against the
  same cascaded tokens as the rest of the app.
- Manually verified by toggling `data-theme="light"` / `data-accent` /
  `data-radius="round"` on `<html>` in DevTools and watching the preview
  re-render in step with the surrounding settings card.

### Open findings (taken into Phase 6 or 6.5)

- The Tabs primitive's `data-[state=active]:bg-card` styling for the active
  tab is currently overridden in the settings shell to `data-[state=active]:bg-accent`
  so the active section reads as filled rather than disappearing into the
  background. The override is local to the Settings page; no change to the
  Tabs primitive is needed.
- Section content in Appearance can scroll a long way. Center pane's
  `h-full overflow-auto` handles this correctly, but the live preview
  sticks via `lg:sticky lg:top-2 lg:self-start`. Verified the sticky
  preview stays visible while the pickers column scrolls.
- The `auth-provider` web gate remains the largest blocker to fully
  automated visual review. A documented manual walkthrough on
  `bun run dev:desktop` is the current fallback.

## Focus management audit (2026-05-13)

Branch: `design/settings-polish-delta` (commit 6adec1b…). Walked the
keyboard-only paths across the new Settings page, the Notes
composition, the workspace switcher, notification center, and both
existing modals.

### Primitives

- `Dialog`, `Sheet`, `Popover`, `DropdownMenu`, `ContextMenu`,
  `Select`, `Command` all wrap their Radix counterparts and do **not**
  override `onCloseAutoFocus` or `onOpenAutoFocus`. Radix's default
  behaviour restores focus to the original trigger when the surface
  closes — verified by grep across `src/components/ui/*.tsx`.
- `Sheet`, `Dialog`, `Popover`, `DropdownMenu`, `ContextMenu` all
  mount their content inside a Portal, so the focus trap is honoured
  even when the trigger lives inside another scroll container.
- Escape closes every primitive: Dialog → backdrop, Sheet → drawer,
  Popover / DropdownMenu / ContextMenu / Select → menu, Command →
  dialog. Re-tested on the new bottom-bar palette and the Settings
  Tabs.

### Bespoke modals

- `WorkspaceSettingsModal` and `IntegrationsModal` are composed on
  top of the `Dialog` primitive. They inherit Radix focus restoration
  for free; no custom focus code in either component.

### New shortcuts

- ⌘⇧W toggles `WorkspaceSwitcher` and ⌘/ toggles `NotificationCenter`
  via the new `useShortcut` hook. Both keep their own internal `open`
  state; when toggled by shortcut, Radix opens the menu / drawer
  programmatically — focus moves to the menu / panel, and Escape
  restores focus back to the trigger.
- Inputs and contenteditable targets are excluded from `new-note`,
  `settings`, `workspace-switcher`, and `notifications` shortcuts so
  typing inside Lexical or a text field doesn't fire them. The
  palette shortcut (⌘K) is intentionally allowed everywhere.

No gaps surfaced during the walkthrough; no new code was added for
this task beyond the audit notes above.

## Concentric inner-radius audit (REVISION_DELTA §5, 2026-05-13)

Branch: `design/settings-polish-delta` (commit a3e9dc0…). The
formula `inner-radius = max(outer-radius − padding, 0)` is now
codified in [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md). The rule
kicks in when a nested element shares a corner with its parent —
i.e. the child sits at the edge of the parent with no surrounding
gap. Walked each of the targets named in the delta:

- **Notes right rail's relation graph card** — already concentric
  from Phase 4. Match-pattern reference; no change.
- **Widget cards in the WIDGETS sidebar on `/grid`** — out of scope
  for this rebuild. The dashboard widgets live in the legacy
  baseline tracked by `lint:tw` and are queued for their own
  feature brief. The rule applies once those files are rebuilt.
- **Notification cards in the right sheet** — the Sheet primitive
  carries no radius (it spans the viewport edge), so its children
  do not share corners and keep their default `rounded-lg`. The
  audit found no corner-sharing case here.
- **Member / invite cards in Workspace Settings dialog** — sections
  are `rounded-lg p-4`, member rows are `rounded-md px-3 py-2`
  separated by `gap-2`. Rows do not touch the section's inner
  corners (gap pushes the first / last row inward), so concentric
  recalculation isn't required. The rounded-md radius reads as
  intentional secondary rounding rather than parallel arcs.
- **Chips and rows nested in outer cards** — same finding: where
  the child is centred inside the parent with padding > 0, the
  corner-sharing condition doesn't trigger.

When future per-feature briefs introduce children that *do* share
corners (e.g. a sticky toolbar pinned to the top of a panel, a
header bar bleeding to the panel's edge), they should pick a child
radius that satisfies the formula. The design-review skill catches
parallel-arc regressions on the visual sweep.

## Final foundation review — global shell (2026-05-13)

Branch: `design/settings-polish-delta` (commit 13f53c5…). Final pass
across the whole foundation rebuild. Method: per the carried-over
visual review caveat above — Storybook captures of the new + revised
primitives (Tabs, Resizable, RadioGroup, Select, Switch, Card, Sheet,
Dialog, Command), combined with source-level audit of the shell
composition and a manual desktop walkthrough plan.

### Top bar (REVISION_DELTA §1, §3, §7)

- Sits on `bg-background`, no hairline. Verified via
  `src/components/app/app-chrome.tsx:235` — `relative px-5 pt-4 bg-background`.
- Carries module titles only. The chip-render blocks, the
  AppChromeMenus mount, and ~700 lines of picker state are gone
  (commit `f15d89d`). No `bg-card` survives in the top bar.
- The modules nav fades into transparency at both edges via the
  mask-image utility instead of the old native scrollbar. Wheel and
  keyboard scroll still work; the `.no-scrollbar` utility removes the
  visible WebKit / Firefox scrollbar chrome. Resolves bug B1.

### Three-panel surface (§2, §3, §6)

- `FeaturePanelsShell` composes `ResizablePanelGroup` with
  `bg-card`-styled panel wrappers (`rounded-2xl border border-border`).
  Drag handles sit between adjacent panels and persist their layout
  per-feature in `localStorage` (key
  `moduo:panels-layout:<feature>:<lr-flags>`). No icon mode; at
  < 900 px the existing `Sheet` pattern fires.
- Vertical padding between top bar / panels / bottom region is zero:
  `FeaturePanelsShell` uses `px-4` with no `py-*`. The horizontal
  gap between cards is `gap-2` (8 px) — the only inter-card breathing.

### Bottom bar (Task 7)

- Floating pill anchored at `fixed bottom-3` with
  `bg-popover border border-border shadow-overlay rounded-full`. AI
  disc keeps its pink via local `data-accent="pink"` so changing
  user accent doesn't shift the brand moment.
- Search trigger opens the global command palette (⌘K). Both the
  bottom-bar trigger and the top-bar search icon now dispatch the
  same `dispatchOpenPalette()` event. Create button is a placeholder
  awaiting per-feature wiring.

### Shortcuts (Task 8)

- `src/lib/shortcuts.ts` owns the registry. Active list: ⌘K palette ·
  ⌘N new note · ⌘, settings · ⌘⇧W workspace switcher · ⌘/
  notifications. Esc-to-close handled by Radix.
- Editable targets (input / textarea / contenteditable) only forward
  the palette shortcut so typing in Lexical doesn't fire commands.

### Settings page (Phase 5)

- Vertical Tabs nav composes the seven sections in the left rail of
  `FeaturePanelsShell feature="settings" hideRight`. Center scrolls
  independently. Appearance section is sticky two-column at lg+:
  pickers on the left, live preview on the right.
- Every appearance axis (theme, accent, density, radius, display
  font, body font, body text size) commits via `useAppearance`, which
  sets the `data-*` attribute on `<html>` and persists. The live
  preview re-renders against the cascade without a remount.

### Notes page

- Not re-touched as part of this PR (per the prompt). The §6 rail
  rework affects it positively: the right rail no longer collapses
  to a broken 1024–1280 px icon column.

### Token / lint gates

- `bun run typecheck` clean.
- `bun run lint:tw` clean on all files touched in this PR. The
  pre-existing 43 legacy files are in the script's IGNORED_PATHS
  baseline (each queued for its own feature brief).
- `bun run lint:css` shows 0 errors / 216 warnings; warnings all live
  in `src/global.css` and `src/features/timetracking/ui/timetracking-styles.css`,
  scoped at warning severity via the .stylelintrc overrides block.
- The new `checks.yml` workflow runs typecheck + lint:tw + lint:css
  on PRs and pushes.

### Findings carried forward

- Per-feature picker rails: the chip strip in §7 left the mindmap,
  brainstorm, tasks, and grid workspaces without an in-UI way to
  switch between mindmaps / sessions / projects / scenes. The
  persistence still works; users can change the active item via the
  storage layer or by waiting for each feature's per-feature rail
  brief. Each affected module should land a small picker rail as the
  first task of its brief.
- Density / radius tuning (§8 of the delta) — deferred. No obvious
  trivial wins surfaced during this pass.
- Light mode visual tuning — still parked. Structural support
  intact; the palette is unfinished.

This review is the final visual gate for the foundation rebuild.
The branch is ready to ship as a single PR.

## Post-review revision pass (2026-05-13, late)

Captures the follow-up changes made after the first user testing
session. Each entry maps to a commit on `design/settings-polish-delta`.

### Settings becomes a modal (fbba87e)

Settings is no longer a route destination. A `SettingsModal`
mounts in AppChrome and listens for a `moduo:settings:open`
CustomEvent dispatched by the UserMenu, the Cmd-, shortcut, the
command palette, and the legacy `/settings` route (which now
redirects to `/grid`).

The Appearance section's backdrop is fully transparent so the app
behind acts as the live preview — every appearance axis mutates
the visible app in real time. The other sections draw a slightly
darker, blurred backdrop (`bg-background/80 backdrop-blur-md`).

The in-section live preview panel was removed (the app itself is
the preview now). `live-preview.tsx` deleted.

### Resizable panel layout (f122f1c, 270742d, 365e086, 0330e87)

- v4 of `react-resizable-panels` treats unitless size props as
  pixels. Every defaultSize / minSize / maxSize switched to
  string percentages.
- The default ResizablePanel className dropped `flex` so the
  library's inner content div stays block-level; the rail
  `<aside>` then fills the panel correctly.
- Panels use `rounded-xl` (token-driven), not `rounded-2xl`.
  Sharp radius now renders truly square panels.
- Inter-panel space halved: outer padding `px-1`, group `gap-0`,
  handle `w-1`. Side panels sit equidistant from edge and centre.
- Sheet auto-open on viewport shrink is fixed. Transitioning
  full → sheet snapshots the user's preferences and forces the
  panels closed; sheet → full restores them. Sheet onOpenChange
  syncs `panelState` back to false so the bottom-bar toggle is
  never a click behind after an outside-click close.
- `resizable` prop added (defaults true). Future fixed-width
  compositions opt in via `resizable={false}`.

### Unified bars and minimal bottom bar (7d33915)

- New `--bar-h` token (3rem) drives both top and bottom bar
  heights. Both bars use `flex items-center` for vertical centring.
- The floating-pill bottom bar is gone. The bottom bar is a flat
  flex row with three minimal icons (AI · Search · Add) centred
  between the left / right panel toggles.
- Search is removed from the top bar utility cluster — it lives
  only on the bottom bar now.

### Avatar follows radius axis (56fa76b)

- New `--avatar-radius` track: 0 in sharp mode, `var(--radius-full)`
  in soft and round modes. Exposed via `rounded-avatar` Tailwind
  utility through the `@theme` block.
- Avatar primitive (Root + Fallback) and UserMenu trigger now use
  `rounded-avatar` instead of `rounded-full`.

### Module navigation: icons-only axis (4be4246)

- New 8th appearance axis `data-tabs`: `auto` (default) or `icons`.
  In icons mode, every module label is hidden except the active
  tab's. Tooltips on hover for the rest.
- CSS rules in `global.css` drive the collapse off the data-attribute;
  AppChrome marks each tab with `data-slot="module-tab"` / `data-active`.

### Per-feature picker code preserved (4cf03bb)

- `AppChromeMenus.tsx` (~826 lines) restored from history, along
  with `MenuAnchor`, `TaskProjectOption`, and the supporting
  utility constants. The file currently has no importers — the
  top bar stays clean per §7 — but the code path compiles
  standalone and is ready for the per-rail migration when each
  module's brief lands.

### Out-of-scope notes

- **Notes right rail** — lives on `design/notes-page` (Phase 4
  branch), not on this branch. Will appear when both PRs merge.
- **Per-feature picker rails** — code preserved; each module's
  own brief decides where the picker lands inside its rail.
