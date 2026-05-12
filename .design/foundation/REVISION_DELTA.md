# Revision Delta — captured during Phase 3 verification

> Source: live walkthrough of `bun run dev:desktop` on macOS, 2026-05-12, against the `design/foundation-build` branch.
> Author input during the walkthrough revealed design decisions in [DESIGN_BRIEF.md](./DESIGN_BRIEF.md) and [TASKS.md](./TASKS.md) that we want to revise. This doc captures those revisions in one place so we don't lose them. It is consumed by a dedicated revision session (Phase 6.5 — see TASKS.md), not by any of the existing phases.
>
> Nothing in here is implemented yet. This is a brief, not code.

## Direction changes (apply before Phase 4 starts)

These are visual/structural changes to the foundation. Each one likely touches multiple components.

### 1. Top bar sits on pure background, not a raised surface

Currently [AppChrome](../../src/components/app/app-chrome.tsx) wraps the top bar in `bg-card` with a `border-b border-border`. Author wants the chrome to sit on `bg-background` with no hairline divider. Visual implication: only the three content panels carry surface chrome (bg-card + border + radius); the top bar and bottom bar are flat against the canvas.

**Affected:** `app-chrome.tsx` (remove `bg-card border-b border-border` from the wrapper at line ~913).

### 2. Three-panel surfaces are the only `bg-card` regions

Logical follow-on from (1). The three rails / center panel (rendered by [FeaturePanelsShell](../../src/components/app/feature-panels-shell.tsx)) are the only thing that gets the dark-grey-on-black raised-surface treatment. Everything else — top bar, bottom bar, dialog backdrops, sheets — stays in `bg-background` unless explicitly a popover.

### 3. Zero padding between top / center / bottom regions

Because nothing visually separates the top bar from the canvas, the gap between top bar and the panel area can drop to 0. Same for the bottom-bar region. The current 8/12px gaps disappear; the visual rhythm comes from the panel `bg-card` boxes against the black canvas, not from gutters.

**Affected:** `app-chrome.tsx` outer flex column gap, `feature-panels-shell.tsx` `pt-2 pb-2` paddings (line ~109).

### 4. Modules nav: edge fade masks instead of native overflow

The horizontal modules row in the top bar currently uses `overflow-x-auto`, which paints a horizontal scrollbar that clips clickable area. Replace with:

- `overflow-x: hidden` on the wrapper (or `scrollbar-width: none` if keeping wheel/keyboard scroll)
- `mask-image: linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)` on the wrapper
- Tabs slide under the fade on each edge instead of clipping hard

Scroll mechanism preserved (wheel + keyboard); scrollbar visually gone, replaced with fade indicator.

**Affected:** `app-chrome.tsx` line ~922.

### 5. Inner element radius rule

When a child element is nested inside a card with rounded corners, the child's radius should equal **outer radius − distance from edge** (concentric formula). A widget card inside a `rounded-2xl` (16px) panel with `p-5` (20px) padding should be `rounded-none`, not `rounded-2xl`. Apply to:

- Widget cards in the WIDGETS sidebar on `/grid`
- Notification cards inside the right sheet
- Member / invite cards inside the Workspace Settings dialog
- Any chip / row nested inside an outer card

**Action:** add an explicit guideline section to [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md) and review every existing nested element against it. Token-side: no new tokens needed, just discipline in component code.

### 6. Rail system: drop icon mode, add user-resizable handles

Current [FeaturePanelsShell](../../src/components/app/feature-panels-shell.tsx) implements four rail modes: `full` / `icon` / `sheet` / `hidden`. Author wants:

- **Delete `icon` mode.** Each module's rails will be bespoke content (no shared icon column), so the collapsed icon variant has nothing to show.
- **New mode set: `full` / `sheet` / `hidden`.** Breakpoint at `<900px` keeps Sheet behavior. Between 900 and full there's no intermediate; rails stay full until they vanish into the Sheet at narrow widths. (We might end up wanting a single `medium` mode here later — TBD by feel during the rail rework.)
- **User-resizable rails.** Drag handles on the inside edge of each rail; widths persist per-feature in the same panels store. Likely use `react-resizable-panels` (the de-facto React lib for this) since shadcn doesn't have a resizable primitive yet. Add it as a new entry under `src/components/ui/`.

**Token cleanup:** `--width-sidebar-icon` and `--width-rail-icon` can be deleted from [tokens.css](../../src/styles/tokens.css).

**Affected:** `feature-panels-shell.tsx`, `tokens.css`, new `src/components/ui/resizable.tsx` (or similar).

### 7. Strip all per-route content from the top bar

Top bar (AppChrome) shows **only module titles** in the tab row — no per-route picker chips, no contextual menus, no inline settings. The current per-route chips (Scene picker on `/grid`, Mindmap picker on `/mindmap`, the would-be Brainstorm and Tasks pickers) are all removed. Module-specific selectors move into each module's left rail (or its body toolbar, where one already exists like `/ground`'s calendar filter).

**What stays in the top bar:**

- App logo
- Workspace switcher (app-wide, not module-specific)
- Module tab row (titles only, with the active tab's accent fill)
- Right-side utility icons (search, recent activity, notifications, user menu)

**What gets deleted:**

- All chip-render blocks in [app-chrome.tsx](../../src/components/app/app-chrome.tsx) tab loop (~lines 939–963): `isGridTab && isGridRoute`, `isMindmapTab && isMindmapRoute`, `isBrainstormTab && isBrainstormRoute`.
- All the picker-state hooks bound to those chips in `app-chrome.tsx` (~50% of the file is state for these pickers — `gridScenes`, `taskProjects`, `mindmaps`, `brainstorms` plus their `isCreating` / `deleteCandidate` / `deleteInput` / `deleteSubmitting` / `menuAnchor` siblings).
- The entire [AppChromeMenus](../../src/components/app/app-chrome-menus.tsx) component (~600+ lines).
- The grid/tasks/mindmap/brainstorm props on `AppChromeMenus`.

**Migration:** the data + actions (`createMindmap`, `deleteBrainstorm`, etc.) move to the module's own left rail (e.g. `src/features/mindmap/ui/mindmap-rail.tsx`). The hooks themselves are good — just relocated.

Resolves bug B1 in passing: the missing `/ground` project picker chip stays missing, and the dead `tasks` prop is deleted as part of this deletion sweep.

### 8. Density / radius tuning pass

Author flagged the current radii as "too rounded" and wants a content-density pass (paddings + gaps + control heights). Defer to the dedicated revision session; do not pick numbers yet. Open questions for that session:

- Reduce `--radius` from current 12/12/16 to something like 8/8/12 or 6/8/10?
- Tighten `--ctrl-h` for compact density? (Already exists; see if comfortable should also drop.)
- Audit every `p-*`/`gap-*` use in shell components against a stricter density scale.

## Future structural changes (out of Phase 6.5 scope but worth recording)

### F1. `/ground` route gets split

Ground is being rewritten — Calendar and Tasks will be separated into their own routes / modules. This is structural (an IA change), not a direction tweak to the foundation, so it's not part of Phase 6.5. Recorded here so we don't accidentally re-invest in `/ground` as-is during the foundation revision (which is why the missing project picker chip is *correct* to leave missing — see direction change #7).

## Real bugs found in walkthrough

### B1. Modules-nav scrollbar clips clickable area

See direction-change #4 above. The horizontal scrollbar that appears when modules overflow paints over the tabs. The fix in #4 resolves this.

## What is *not* changing

Recording these so we don't relitigate:

- **Shadcn primitives** stay as-is. Dialog, Sheet, DropdownMenu, Avatar, Badge, Card, Tooltip, Icon (sm/md/lg enum) all confirmed working and on tokens during walkthrough.
- **Token system** stays as-is structurally — `--background`, `--card`, `--popover`, `--accent`, `--border`, status colors, etc. We're tuning numeric values inside it, not restructuring it.
- **Theming axes** stay as-is. `data-theme` / `data-accent` / `data-density` / `data-radius` all wired and propagate live via [useAppearance](../../src/lib/appearance.ts). The Settings-page pickers in Phase 5 still target these. Verified in walkthrough: setting `dataset.accent = 'violet'` on `<html>` flips `--primary` from `lab(63.66 63.76 -12.36)` (pink) to `lab(57.52 40.92 -64.67)` (violet) without reload. CSS rule layer is healthy. (Visual change is only observable on elements that actually use `bg-primary` / `var(--primary)` — most prominent in dialog primary buttons, e.g. the Workspace Settings "Send invite" button or Integrations "Connect" buttons.)
- **Routes** stay as-is *for the foundation revision*. The `/ground` split (F1) is structural and runs separately, after the foundation rework lands.

## Walkthrough findings, condensed

- Tauri builds and launches on macOS cleanly (no LNK1318 equivalent).
- All 10 Phase 3 components compile, render, and use token-correct styles (verified via Storybook DOM probes + the live Tauri window).
- The pink "No mindmaps yet" disc on `/mindmap` is the deliberate AI brand moment per [CLAUDE.md](../../CLAUDE.md). Keep.
- Active-tab accent fill, popover hierarchy, workspace switcher, user menu, notification sheet, scene/mindmap pickers, workspace settings dialog all functionally correct.
- Responsive collapse fires at <900 (Sheet mode) as spec'd — but icon mode (1024–1280) is being deleted per direction change #6.
- A workspace was already created from a prior session; vault gate worked.

## Where this fits in TASKS.md

Add a new line at the bottom of TASKS.md:

```
## Phase 6.5 — apply REVISION_DELTA.md

This phase processes [REVISION_DELTA.md](./REVISION_DELTA.md). Read that doc and turn each
section into discrete tasks. Run before Phase 4 if any direction changes touch shell
components Notes will consume; defer to after Phase 5 otherwise. Density / radius tuning
can run after Phase 5 in a follow-up tuning pass.
```

(I will add this line to TASKS.md in the same commit as creating this file.)
