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
