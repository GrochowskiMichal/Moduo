# Build Tasks: Moduo Design Foundation

Generated from: [.design/foundation/DESIGN_BRIEF.md](./DESIGN_BRIEF.md)
Tokens: [src/styles/tokens.css](../../src/styles/tokens.css) (written, not wired)
Date: 2026-05-11

> Each task is a vertical slice — structure + styling + interactions + states + a Storybook story (where applicable). Each task is small enough for a single session. Mark tasks complete with `[x]` as they ship.

---

## Foundation (must come first)

- [ ] **Wire `tokens.css` into the build**. Import [src/styles/tokens.css](../../src/styles/tokens.css) from [src/global.css](../../src/global.css) at the top of the file. Remove all hardcoded color/size declarations from `global.css` that the tokens now cover (the `#111111` body background, the notes-* color rules, the scrollbar colors). Keep the Lexical-specific `notes-table-*` rules but replace their hardcoded hex values with `var(--card)`, `var(--border)`, etc. *New file imported; existing file pruned.*

- [ ] **Initialise shadcn/ui** in the repo. Run `bunx shadcn@latest init` choosing Tailwind v4 + React 19 + the existing `src/components/ui/` directory. Configure `components.json` to point at our `src/styles/tokens.css` for tokens. Confirm the generated alias paths match the project's tsconfig. *New: `components.json`; modifies: tsconfig if path aliases need a tweak.*

- [ ] **Install new font packages**. `bun add @fontsource/geist-sans @fontsource/geist-mono @fontsource/inter @fontsource/source-serif-pro @fontsource/cal-sans @fontsource-variable/fraunces`. Import their CSS in `src/global.css`. Verify each loads in DevTools Network. *Modifies: `package.json`, `bun.lock`, `src/global.css`.*

- [ ] **Build the `useAppearance` hook**. New file `src/lib/appearance.ts` exporting `useAppearance()` returning the current 7 axes + setters. On mount, hook reads persisted prefs from Tauri storage and applies them as `data-*` attributes on `document.documentElement`. Setters update the attribute and persist immediately. *New file; reuses Tauri's storage API.*

- [ ] **Pre-paint appearance application**. In `src/main.tsx` (before React mounts), read persisted appearance prefs synchronously (via `localStorage` mirror of the Tauri-backed prefs) and apply the `data-*` attributes to `<html>`. Prevents flash-of-default-theme on launch. *Modifies: `src/main.tsx`.*

- [ ] **Add Stylelint with our rules**. `bun add -D stylelint stylelint-config-standard stylelint-declaration-strict-value`. Create `.stylelintrc.json` enforcing: no raw hex in CSS files outside `tokens.css`, no `px` for sizing tokens (rem only). Add `bun run lint:css` script. Run on PR via the existing CI (or add a step). Enforcement starts at WARN level for week one, errors thereafter. *New files: `.stylelintrc.json`. Modifies: `package.json` scripts.*

- [ ] **Custom check for Tailwind arbitrary values**. Add a small script `scripts/check-arbitrary-tw.ts` that greps for `bg-\[#`, `p-\[\d+px\]`, `text-\[\d+px\]`, `rounded-\[\d+px\]`, `font-\[` in `src/**/*.{ts,tsx}` and exits non-zero on hits outside an allowed-paths list. Add `bun run lint:tw` script. Wire into CI alongside Stylelint. *New file; reuses existing Bun runtime.*

---

## Core primitives (`src/components/ui/`)

Each task: shadcn CLI add → strip default zinc classes → swap to our token classes → add `<name>.stories.tsx` with default + variant + interactive states → add Playwright visual snapshot.

- [ ] **Button** — variants: default, secondary, outline, ghost, destructive, link. Sizes: sm, md (default), lg, icon. Token classes only: `bg-primary text-primary-foreground hover:bg-primary-hover`, etc. Height from `var(--ctrl-h)` (density-driven). Focus ring composes `--shadow-focus`. *New.*

- [ ] **Input, Textarea, Label**. Single primitive task because they always travel together. Input uses `bg-input border-border focus-visible:ring-ring`. Textarea extends Input for multi-line. Label wraps native `<label>` with shadcn's pattern. *New.*

- [ ] **Dialog**. shadcn add. Restyle the backdrop to `bg-background/80 backdrop-blur-sm`; the panel to `bg-card border-border rounded-xl shadow-overlay`. *New.* Replaces ad-hoc modal patterns.

- [ ] **Sheet** (side drawer). shadcn add. Used by the responsive shell's collapsed-rail expansion and by NotificationCenter. *New.*

- [ ] **Dropdown Menu + Context Menu**. shadcn add both (they share styling). The first-draft screenshot's right-click menu becomes a ContextMenu. Items use `text-popover-foreground hover:bg-accent`, separators use `bg-border`, kbd shortcuts render in `font-mono text-muted-foreground`. *New.*

- [ ] **Popover**. shadcn add. Generic floating panel. Used by Workspace switcher previews and any per-page popovers. *New.*

- [ ] **Command** (⌘K palette). shadcn add. Wire to a global `cmd+k` / `ctrl+k` listener. Items list is a stub for now (returns sample entries); the catalogue is its own per-feature concern. *New.*

- [ ] **Tabs**. shadcn add. Used in Settings. Styling: `data-[state=active]:bg-card` for the active tab, `text-muted-foreground` for inactive. *New.*

- [ ] **Tooltip**. shadcn add. Every icon-only button across the app gets one. *New.*

- [ ] **Toast** (Sonner). `bun add sonner`. Add `<Toaster />` at the app root. Restyle to use `bg-popover text-popover-foreground border-border rounded-md`. *New.* Replaces the bespoke `.fadeSlideUp` rule in `global.css`.

- [ ] **Switch, Select, RadioGroup**. Used in Settings. Switch uses `bg-primary` for on-state and `bg-muted` for off. Select uses Popover under the hood. RadioGroup uses circular radio dots with `--primary` fill when selected. *New.*

- [ ] **Separator, Card, ScrollArea**. Separator → `bg-border h-px` or `w-px`. Card → `bg-card border border-border rounded-lg p-4`. ScrollArea → shadcn add; replaces `.scrollbar-thin` in `global.css`. *New.*

- [ ] **Avatar, Badge**. Avatar → `bg-muted text-foreground rounded-full` with optional image. Badge → variants: default, secondary, destructive, outline; small text in `bg-{variant} text-{variant}-foreground rounded-full px-2 py-0.5`. *New.*

---

## Migrate app shell + existing bespoke components

These already exist; the task is restyle to tokens + recompose on top of shadcn primitives where applicable. No behaviour change.

- [ ] **AppChrome** ([src/components/app/app-chrome.tsx](../../src/components/app/app-chrome.tsx)) — replace hex values with `bg-card`, `text-foreground`, `text-muted-foreground`; active route uses `bg-accent`; brand mark sized per tokens. *Modifies.*

- [ ] **AppChromeMenus** ([src/components/app/app-chrome-menus.tsx](../../src/components/app/app-chrome-menus.tsx)) — recompose on top of Dropdown Menu primitive. Items in the dropdown follow the standard popover pattern. *Modifies.*

- [ ] **FeaturePanelsShell** ([src/components/app/feature-panels-shell.tsx](../../src/components/app/feature-panels-shell.tsx)) — restyle with tokens + add responsive collapse: ≥1280px full tri-pane, 1024–1280px right-rail icon, 900–1024px both rails icon, <900px both rails closed by default. Use `var(--width-sidebar)` etc. for widths. *Modifies — biggest single component change.*

- [ ] **WorkspaceSwitcher** ([src/components/workspace-switcher.tsx](../../src/components/workspace-switcher.tsx)) — recompose on top of Dropdown Menu. Avatar primitive for the workspace mark. *Modifies.*

- [ ] **UserMenu** ([src/components/user-menu.tsx](../../src/components/user-menu.tsx)) — recompose on Dropdown Menu. *Modifies.*

- [ ] **NotificationCenter** ([src/components/notification-center.tsx](../../src/components/notification-center.tsx)) — recompose on Sheet (right-anchored). Notification items: Card primitives. *Modifies.*

- [ ] **IntegrationsModal** ([src/components/integrations-modal.tsx](../../src/components/integrations-modal.tsx)) — recompose on Dialog. *Modifies.*

- [ ] **WorkspaceSettingsModal** ([src/components/workspace-settings-modal.tsx](../../src/components/workspace-settings-modal.tsx)) — recompose on Dialog. *Modifies.*

- [ ] **TagInput** ([src/components/ui/tag-input.tsx](../../src/components/ui/tag-input.tsx)) — restyle with tokens (uses `bg-muted`, `text-foreground`, Badge for chips). Keep API. *Modifies.*

- [ ] **Icon** ([src/components/ui/icon.tsx](../../src/components/ui/icon.tsx)) — sizes from token enum: `sm` (16), `md` (20), `lg` (24). Strokes inherit `text-foreground`. *Modifies.*

---

## Anchor page: Notes (`/notes`)

- [ ] **Notes 3-pane layout** — compose FeaturePanelsShell with the three rail contents. URL stays `/notes`. *Modifies [src/routes/pages/notes-page.tsx](../../src/routes/pages/notes-page.tsx).*

- [ ] **Notes sidebar tree** — Pinned / Notes / Custom DB sections; tree rows use `var(--row-h)`, `hover:bg-accent`; folder icons via lucide; right-click opens ContextMenu (Pin / Copy Link / Duplicate / Rename / Move / Move to Trash / Publish — copy from the first-draft screenshot). *Modifies the existing tree component in [src/features/notes/](../../src/features/notes/).*

- [ ] **Notes content area + breadcrumb** — breadcrumb in `text-sm text-muted-foreground`; title in `font-display text-3xl`; body editor uses `font-sans text-base text-foreground` (the readability fix). Container max-width `var(--width-prose-max)`. *Modifies the Lexical-hosting component.*

- [ ] **Lexical theme alignment** — update the Lexical editor's theme classes in [src/features/notes/editor/](../../src/features/notes/editor/) so that headings, lists, quotes, code blocks, tables, links all use token-driven colors. Replace the `notes-*` rules in `global.css` with token references. *Modifies global.css + Lexical theme config.*

- [ ] **Notes right rail** — Relation Graph viewer (existing XYFlow component, restyled), Tags section (Badge primitives), Close Relations list (rows with count badges). Rail width `var(--width-rail)`, collapses to `var(--width-rail-icon)` on narrow viewports. *Modifies [src/features/notes/ui/](../../src/features/notes/ui/).*

---

## Anchor page: Settings (`/settings`)

- [ ] **Settings shell** — single-pane (no right rail) with a tabbed left nav: Appearance, Account, Workspace, Integrations, Preferences, Advanced, About. Tabs primitive on the left rail in vertical orientation. *Modifies [src/routes/pages/settings-page.tsx](../../src/routes/pages/settings-page.tsx).*

- [ ] **Appearance: theme + accent + density + radius pickers** — RadioGroup for theme (Dark / Light / System), 8 swatches in a grid for accent (use Primary color swatches), Switch for density (or RadioGroup with two options), RadioGroup with visual previews for radius (sharp / soft / round). All commit on change via `useAppearance`. *New components inside settings-page or extracted to `src/features/settings/appearance/`.*

- [ ] **Appearance: display font + body font + body text size pickers** — Select primitives, each showing a font preview line. Body text size: RadioGroup (Small / Normal / Large). All commit on change. *Same location as above.*

- [ ] **Live preview panel** — a small card showing a mini Notes page (heading + paragraph + button + tag) that re-renders instantly when any appearance axis changes. Confirms the cascade works without page reload. *New component within settings.*

- [ ] **Account / Workspace / Integrations sections** (stub) — placeholders that use Dialog-based existing modals (`workspace-settings-modal`, `integrations-modal`) when their items are clicked. Real content is feature-specific and out of scope for the foundation. *Modifies settings-page; reuses existing modals.*

---

## Cross-cutting

- [ ] **Global bottom bar** — the floating pill with AI disc, search trigger, create. Uses `bg-popover border border-border shadow-overlay rounded-full`. AI disc keeps its pink — `bg-primary` with `data-accent="pink"` semantics (it's a brand moment, not the accent system). Search trigger opens the Command palette. *Modifies the existing bottom-bar component.*

- [ ] **Keyboard shortcuts pass** — confirm every primary action surfaces a shortcut. Audit list: theme switch (none — manual), command palette (⌘K), new note (⌘N), settings (⌘,), workspace switcher (⌘⇧W), notification center (⌘/), close dialog (Esc). *New file `src/lib/shortcuts.ts` registering global listeners.*

- [ ] **Focus management audit** — every Dialog / Sheet / Popover / Dropdown restores focus on close. Verify with manual keyboard-only walkthrough across Notes + Settings. *No new code unless gaps are found.*

- [ ] **Playwright visual snapshot pattern** — add a `tests/visual/primitives.spec.ts` that loads each Storybook story page and takes a screenshot. Snapshots live under `tests/visual/__snapshots__/`. CI fails on visual diff. *New test file.*

- [ ] **Stylelint enforcement → error**. After a week at WARN, flip the CSS hex / arbitrary-value rules from `warning` to `error` in `.stylelintrc.json`. *Modifies config.*

- [ ] **Custom Tailwind arbitrary-value check → CI gate**. Add `lint:tw` to the CI workflow alongside typecheck. *Modifies CI config.*

---

## Review

- [ ] **Run `/design-review` on Notes** — Playwright-driven visual sweep. Check contrast, focus rings, hover states, dark mode rendering, responsive collapses. Address findings.

- [ ] **Run `/design-review` on Settings** — same. Specifically verify every appearance picker is reachable by keyboard and announces correctly to screen readers.

- [ ] **Run `/design-review` on the global shell** — top bar + bottom bar + collapsed-rail behaviour at 1280 / 1024 / 900 px window widths.

---

## Out of scope for this list (per the brief)

- Light mode visual tuning.
- The 21 non-anchor pages — they'll migrate as primitives propagate and as the app converges to 5–7 features.
- IA refactor (route renames, page merges).
- Mobile / tablet layouts.
- Lexical editor internals beyond the theme alignment task above.
- XYFlow mindmap node visuals (their own design problem).
- Marketing site, Tauri installer chrome, app icon.
