# Design Review: Top Panel Polish

Reviewed against: [DESIGN_BRIEF.md](./DESIGN_BRIEF.md) and [TASKS.md](./TASKS.md).
Philosophy inherited from foundation: refined, content-first, dark-canvas operator's tool.
Date: 2026-05-14
Reviewer: Claude (code + Storybook visual pass)

## Method

- Read the brief, tasks file, and DELETION_NOTES.md.
- Read every touched source file end-to-end.
- Started Storybook locally on port 6006 via `mcp__Claude_Preview__preview_start`.
- Navigated to each of the 5 app-chrome stories (Default, IconsOnly, SingleWorkspace, NarrowViewport, TrialBannerActive) at 1440×900 and 1024×768 viewports in dark mode.
- Inspected the rendered DOM via `preview_eval` for tab geometry, `data-tabs` state, `data-active` flags, `aria-current` semantics, switcher visibility, and computed styles on labels.
- Took screenshots inline for visual sanity-check. Compressed JPEGs aren't suitable for archiving; the Claude Preview screenshot tool returns base64-encoded images without a save-to-disk parameter, so no files persisted in `screenshots/`. Live verification was done against the running Storybook.

## Working as specified

**Top bar layout.** `<nav aria-label="Workspace navigation">` renders as CSS grid `1fr auto 1fr` at full width. Verified at 1440 px:
- Left zone: Moduo Mark (32×32) + Workspace trigger (visible when workspaces.length > 1).
- Centre zone: 6 module tabs, viewport-centred (`tabRects` confirmed centred at x=250..774 inside a 1024 px viewport).
- Right zone: NotificationCenter (32×32) + Avatar (32×32). All elements visually ~32 px tall.

**Module tab states.** [app-chrome.tsx:51-77](src/components/app/app-chrome.tsx#L51).
- Active: `bg-accent text-foreground`, `data-active="true"`, `aria-current="page"`.
- Idle: `bg-transparent text-muted-foreground`.
- Hover: `bg-accent text-foreground` — same as active, ported from the workspace-chevron pattern as the brief requires. Hover-over-active = active (no extra contrast) is intentional per grilling decision.
- Focus ring: `focus-visible:ring-2 ring-ring ring-offset-2` — present and styled consistently.
- Tooltip carries `<span>{label}</span><kbd>{hint}</kbd>` with the shortcut hint resolved via `formatShortcut`.
- `aria-label` includes the shortcut hint: e.g. "Grid (⌘1)", verified via DOM inspection on every tab.

**Icons-only mode.** [global.css:653-668](src/global.css#L653).
- All labels hidden, including the active one — verified `getComputedStyle(label).display === "none"` for every tab including `data-active="true"`.
- All tabs render at 32×32 (`width: 2rem`, `padding-left: 0`, `padding-right: 0`). Verified via DOM rect inspection.
- Active state communicated by `bg-accent` + foreground colour only.

**Workspace switcher.** [workspace-switcher.tsx:123](src/components/workspace-switcher.tsx#L123).
- Returns `null` when workspaces.length ≤ 1 (verified in SingleWorkspace story — `switcherPresent: false`, only the Moduo Mark renders in the left zone).
- When visible: `[h-7 w-7 Avatar] [name truncated to 14ch] [ChevronDown]` inside a single button at `h-8 px-2`, hover styling matches the rest of the chrome.
- Tooltip copy is `Switch workspace · ⌘⇧W` via `formatShortcut`.
- `useShortcut("workspace-switcher", …)` mounts above the early return, so hook order is stable across renders. The shortcut is a silent no-op when the trigger is hidden — acceptable per brief.

**⌘1..⌘6.** Six fixed `useShortcut` calls in [app-chrome.tsx:151-156](src/components/app/app-chrome.tsx#L151), each wrapping `navigateToIndex(N)` in a stable `useCallback`. Handlers silently no-op when the index exceeds the visible list. Browser tab-switch collision on the dev:web build is documented inline in [shortcuts.ts](src/lib/shortcuts.ts).

**NotificationCenter relocation.** Mounted in the right zone of the top bar adjacent to the avatar. Removed from `GlobalBottomBar` in the same commit (task 5) so the duplicate `useShortcut("notifications", …)` doesn't fire two Sheets simultaneously.

**Bottom bar.** [global-bottom-bar.tsx:37-66](src/components/app/global-bottom-bar.tsx#L37).
- 3 centred buttons: `SlidersHorizontal` (placeholder, silent click) · Search · Create.
- Tooltip shortcut hints added: Search shows `⌘K`, Create shows `⌘N`, all derived through `formatShortcut`.
- Settings placeholder onClick: `() => { /* placeholder for per-feature settings; wired by per-feature polish */ }` — comment preserved.

**Shim removal.** `<View>` and `<Text>` removed from [app-chrome.tsx](src/components/app/app-chrome.tsx); replaced by `<div>` / `<span>`. The `tw` shim is still imported by other files in the repo — the brief restricted shim removal to app-chrome.tsx only.

**Route deletion.** [router.tsx](src/router.tsx) trimmed from 24 to 10 routes (the redirect routes `/tasks` → `/ground` and `/calendar` → `/ground` survive). [panel-events.ts](src/features/layout/panel-events.ts) pruned: `FeatureLayoutKey`, `cloneDefaultMap`, `routeToFeatureLayout` all aligned to 9 keys. The `Open Brainstorm` palette entry and unused `PenTool` import dropped from `global-command-palette.tsx`.

**Settings → Workspace.** "Add workspace" Dialog ships in [workspace-section.tsx:71-101](src/features/settings/sections/workspace-section.tsx#L71) alongside the existing "Open workspace settings" button. Wired to `createWorkspace` + `selectWorkspace`, gated by the `unlimited_workspaces` entitlement (opens `UpgradeModal` for over-cap users). Single-workspace users now have an in-app path to create a second workspace, satisfying the dependency the brief flagged.

**CLAUDE.md.** Shim phase-out note added at [CLAUDE.md:92](CLAUDE.md#L92) — narrows the "leave alone" stance to files we don't actively touch.

**Token discipline.** `bun run lint:tw` passes. No raw hex in any touched file. No `bg-[#...]`, `p-[Npx]`, `text-[Npx]`, `rounded-[Npx]`, `font-[...]` anywhere in the chrome surface. Arbitrary value `max-w-[14ch]` in workspace-switcher trigger is allowed (one-off geometry, not a design-system property).

**Storybook.** 5 stories registered. Confirmed rendering for Default (multi-workspace, all 6 tabs labelled, Grid active), IconsOnly (six 32×32 squares, labels hidden, Grid active by colour), SingleWorkspace (switcher hidden), NarrowViewport (1024 px, no overflow). TooltipProvider added to the global preview decorator (was previously missing; broke the very first story render until added).

## Concerns to address before PR

1. **Storybook preview decorator change is out-of-spec but necessary.** [.storybook/preview.tsx](.storybook/preview.tsx) gained a `TooltipProvider` wrapper. Without it, any story using `Tooltip` throws `\`Tooltip\` must be used within \`TooltipProvider\``. The brief didn't authorise editing `.storybook/preview.tsx`; this was forced by the new AppChrome stories. Worth a line in the PR description acknowledging it. *Severity: low — the change is correct in isolation and benefits every Tooltip-using story in the codebase.*

2. **`WorkspaceFixture` uses a type cast.** [app-chrome.stories.tsx:43](src/components/app/app-chrome.stories.tsx#L43) casts the spread context to `WorkspaceContextValue` because the parent context type makes everything optional after the spread. Acceptable for a story fixture, but if `WorkspaceContextValue` gains a new required field, the cast won't catch it. Add a brief comment explaining why the cast exists, or replace with an explicit object construction. *Severity: low.*

3. **TrialBannerActive is a layout stub, not a real TrialBanner render.** [app-chrome.stories.tsx:127-143](src/components/app/app-chrome.stories.tsx#L127) renders a 40 px `bg-warning` div above the chrome instead of mounting the real component, because TrialBanner fetches from Supabase on mount. Reviewers should be aware they're looking at a vertical-stack sanity check, not the real banner. The docstring already explains this. *Severity: noted, not blocking.*

4. **No screenshots persisted to `.design/top-panel-polish/screenshots/`.** The Claude Preview MCP returns base64 JPEGs without a `filename` save parameter. Playwright MCP wasn't available in this session. Visual verification was live against running Storybook. If the design-flow checklist requires archived screenshots, those need to be captured manually before merging. *Severity: process — content is verified, the archive is missing.*

## Out-of-scope follow-ups (deferred per brief, do not touch this PR)

- **Dead exports in `app-chrome-types.ts`.** `TaskProjectOption` and `MenuAnchor` were only consumed by the deleted `app-chrome-menus.tsx`. No active reference now.
- **Dead helpers in `app-chrome-constants.ts`.** `normalizeTaskProject`, `safeId`, `nowIso`, `rowStyle`, `itemRowStyle`, `itemNameWrapStyle`, `itemActionsStyle`, `iconButtonStyle`, `plusButtonStyle`, `deleteRevealBaseStyle` are all orphaned.
- **Stale entries in `scripts/check-arbitrary-tw.ts` `IGNORED_PATHS`.** Entries for `src/features/brainstorm/…`, `src/features/templates/…` (and likely some `src/features/dashboard/…` ones too — those were never in scope but live in the same list) now point at deleted files. Harmless no-op lookups; the brief said not to edit `IGNORED_PATHS`.
- **`src/tw/` shim removal in files other than `app-chrome.tsx`.** Brief explicitly scopes the migration. Codebase-wide phase-out is a separate sweep.
- **Real "Add workspace" entry visual polish.** Settings page itself gets its own polish run; the Dialog is functional, not visually opinionated.
- **TrialBanner real story.** Needs a Supabase mock — separate Storybook fixtures task.

## Verification still owed (live-only, can't be done from code or Storybook)

1. **⌘1..⌘6 in Tauri.** Verified the wiring in code and the keydown predicates in shortcuts.ts. In Tauri there's no browser tab-switch competition. Should work; needs a live Tauri dev session to confirm.
2. **Workspace count 1 → 2 transition.** When a user creates their second workspace via Settings → Workspace, the switcher trigger appears in the top-left zone. The brief specified an `opacity-only fade-in` to avoid a visible reflow of the centre nav. Currently no fade animation is wired — the trigger pops in on the next render. *This is a real spec gap worth flagging.*
3. **Active-tab visual contrast in live dark mode.** Storybook color-scheme emulation was set to dark and the active state read distinctly. Worth a sanity pass in the real `bun run dev:desktop` session to confirm contrast holds on the actual `--background` / `--accent` token values.
4. **TrialBanner real rendering above the new chrome.** Requires a trialing-subscription test account.
5. **NotificationCenter Sheet open/close** from the new top-right position. Verify the Sheet's right-anchored placement still feels correct now that the trigger lives at the right edge of the top bar instead of the centre-bottom.
6. **`prefers-reduced-motion`** respect. The motion tokens already handle this globally; manual check still owed.

## What works well

- The CSS grid `1fr auto 1fr` layout choice was the right call. At 1024 px and 1440 px, the module nav stays anchored to the viewport centre regardless of left-zone content width. The earlier proposal of `flex-1` columns would have drifted noticeably with the new workspace switcher label.
- `aria-label` on each ModuleTab encodes the shortcut redundantly with the visible `<kbd>` element — screen-reader users get the keyboard hint without depending on the visual tooltip.
- The single `useShortcut("workspace-switcher")` call placement (before the early return) is the textbook fix to React's hook-order rule; the inline comment makes the intent obvious to future readers.
- DELETION_NOTES.md grew honestly during execution — the original "keep orphan dirs" plan met reality, the user authorised the expansion, and the doc now records what actually happened. This is what the design-flow folder should look like after a real polish run.
- The shim removal is contained. Reading [app-chrome.tsx](src/components/app/app-chrome.tsx) after the migration, you'd never know the `tw` shim existed in this file — and you can read every other file in the chrome surface (`workspace-switcher.tsx`, `user-menu.tsx`, `global-bottom-bar.tsx`) and see they were already on raw HTML, so the new code matches its siblings cleanly.

## Recommended changes before merging

| # | Issue | Action |
| --- | --- | --- |
| 1 | TooltipProvider added to preview decorator | Mention in PR description; no code change needed. |
| 2 | WorkspaceFixture type cast | Add a one-line comment, or accept as story-only ergonomic. |
| 3 | 1 → 2 workspace transition has no opacity fade | Either implement the fade (small CSS transition on the trigger's first mount) or update the brief to drop that requirement. Recommend the latter for scope. |
| 4 | Screenshot archive empty | Capture the four working stories with a different tool (Playwright MCP if available, or manual macOS screencapture) before opening the PR. |

Everything else is brief-aligned and ready.
