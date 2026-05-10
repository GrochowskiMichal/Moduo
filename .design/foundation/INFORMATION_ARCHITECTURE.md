# Information Architecture: Moduo (Descriptive)

> Output of `/information-architecture`. **Descriptive, not prescriptive.** Per the brief, IA refactoring is out of scope for the foundation redesign — this document records the current routing, shell, and navigation model so downstream skills have the picture they need.
>
> A future IA refactor (when the app converges from 23 exploratory routes to 5–7 main features) gets its own brief.

## Site Map (current state)

URL patterns from [src/router.tsx](src/router.tsx). Top-level slash is the authenticated app shell `AppGate`; `/auth` lives outside it.

- `/auth` — sign-in / sign-up (outside the app shell)
- `/` → redirects to `/grid` (default landing after auth)
- **Inside `AppGate`** (top-nav + 3-pane shell):
  - `/grid` — **Dashboard** (widget grid)
  - `/notes` — **Notes** *(redesign anchor)*
  - `/mindmap` — Mindmap (XYFlow node graph)
  - `/email` — Email (IMAP)
  - `/ground` — unified planning surface
    - `/tasks` → redirects to `/ground`
    - `/calendar` → redirects to `/ground`
  - `/crm` — CRM
  - `/forms` — Forms
  - `/templates` — Templates
  - `/activity` — Activity feed
  - `/feed` — Feed
  - `/files` — Files
  - `/brainstorm` — Brainstorm
  - `/expanses` — Expenses *(URL typo — kept for now; rename is an IA-refactor concern)*
  - `/revenue` — Revenue
  - `/kpi-okr` — KPI / OKR
  - `/stats` — Stats
  - `/analytics` — Analytics
  - `/recordings` — Recordings
  - `/timetracking` — Time tracking
  - `/roadmap` — Roadmap
  - `/settings` — **Settings** *(redesign anchor)*

24 routes; 23 distinct pages (two redirects). Most are exploratory and expected to be removed or merged as the app converges to 5–7 features.

## Navigation Model

The three-pane shell visible in the first-draft screenshot:

- **Top bar** ([src/components/app/app-chrome.tsx](src/components/app/app-chrome.tsx)):
  - **Primary navigation**: currently 6 visible items (Dashboard, Relations, Calendar, Notes, Email, Tasks) — a curated subset of the 24 routes, not an enumeration. Defined in `app-chrome-constants.ts`.
  - **Brand mark** (left): Pilat-Extended-style "M" logo + workspace switcher dropdown.
  - **Utility area** (right): hamburger / overflow trigger.
- **Left rail** (per-feature): each feature page renders its own left sidebar inside the shell — Notes shows the folder tree; Email shows folders; CRM shows lists; etc. The shell does not impose a single left-rail content model.
- **Right rail** (per-feature): the screenshot shows a Relation Graph + Tags + Close Relations panel on the Notes page. Other features render their own right-rail content (or none).
- **Bottom floating bar**: pink AI disc + global search + create. Visible across pages.
- **Utility navigation**: user menu, notification center, workspace settings — all triggered from the top bar.
- **Mobile navigation**: N/A — Tauri desktop only. Window resize behavior:
  - ≥ 1280 px: full 3-pane.
  - 1024–1280 px: right rail collapses to icon column.
  - 900–1024 px: left rail also collapses.
  - < 900 px: both rails closed by default, both reachable via `Sheet`.

## Content Hierarchy (anchor pages only)

The two redesign-anchor pages. Other pages keep their current hierarchies.

### Notes (`/notes`)
1. **Note body** — the writing surface itself. This is what the user opened the app to do. Pilat Extended demoted; body type goes to the chosen body font for readability.
2. **Note title + breadcrumb** — orient without consuming. Title large; breadcrumb small and quiet.
3. **Left rail: tree** (Pinned / Notes / Custom DB) — frequent navigation; collapsible.
4. **Right rail: Relation Graph + Tags + Close Relations** — secondary context; collapsible.
5. **Bottom global bar** — present but quiet. Doesn't compete with body content.

### Settings (`/settings`)
1. **Customization pickers** (theme / accent / density / radius / display font / body font / body size) — the primary reason the user opened settings. Front and center.
2. **Account & workspace** (profile, workspace settings, integrations).
3. **Preferences** (keyboard shortcuts, language, notifications).
4. **Advanced** (data, sync, developer / debug if exposed).
5. **About / version / sign-out** — bottom.

Settings layout: tabbed left rail (sections) + content pane on right. Single-pane (no right rail) on this page.

## User Flows (anchor flows for the foundation)

### Theme / accent / font customization
1. User opens Settings (`/settings`) — top bar avatar → Settings, or keyboard shortcut.
2. User lands on the **Customization** tab (default).
3. User toggles theme / accent / radius / density / display font / body font / body size.
   - Each change applies live to a small **Preview** panel on the same page, then to the whole app once committed.
   - `Reset to defaults` is a single action that restores all six axes.
4. Changes persist to local prefs (Tauri-backed). No save button — toggles commit on change.

### Navigate to a note
1. User is on any page; clicks **Notes** in top bar.
2. Notes page renders 3-pane: tree (left), note body (center), relation panel (right).
3. User clicks a note in the tree → center pane swaps to that note. URL updates with the note ID (TBD by future per-note routing — currently a single `/notes` route).
4. User right-clicks a note → `ContextMenu` opens with Pin / Copy Link / Duplicate / Rename / Move / Delete / Publish.

### Theme switch round-trip
1. User has dark theme; switches to light in Settings.
2. `:root` `data-theme` attribute changes from `dark` to `light`.
3. CSS transition (200 ms) on `background-color` and `color` properties of `:root` cascades through every surface.
4. No layout shift; focus state preserved; no scroll jump.
5. Preference persists; on next app launch, the saved theme is applied before first paint (Tauri can hint this).

## Naming Conventions

Consistency glossary for the interface. Pick one word, use it everywhere.

| Concept | Label in UI | Notes |
| --- | --- | --- |
| The main work area | **Workspace** | Already used in `workspace-switcher` / `workspace-settings`. Not "tenant", "account", "team". |
| A piece of writing | **Note** | Not "doc" or "page" in product copy. (The element is `<doc>` in code if needed.) |
| The graph view | **Mindmap** | Not "graph", not "canvas" in copy. |
| User configuration | **Settings** | Not "preferences" or "options". |
| The customization knobs in Settings | **Appearance** | Section heading inside Settings. |
| Theme choices | **Theme** (Dark / Light / System) | Not "mode" or "skin". |
| Accent color | **Accent** | Not "primary" in copy (it's `--primary` in tokens). |
| Density | **Density** (Comfortable / Compact) | Not "spacing" or "compactness". |
| Border radius | **Corners** (Sharp / Soft / Round) | Friendlier UI label than "border radius". |
| Body font size | **Text size** (Small / Normal / Large) | Not "font size" in copy. |
| User name | **Display name** | Not "username" (which is the handle). |
| Confirming an action | **Confirm** / **Cancel** | Not "OK" / "Dismiss". |
| Deleting | **Delete** for permanent, **Move to Trash** for soft delete | Match the screenshot's existing copy. |

## Component Reuse Map

Structural components shared across pages.

| Component | Used on | Behavior differences |
| --- | --- | --- |
| `AppChrome` (top bar) | All pages inside `AppGate` | Active route highlighted; otherwise identical. |
| `FeaturePanelsShell` (3-pane) | All pages inside `AppGate` | Each page provides its own left-rail, center, and right-rail content via slots. Settings overrides the right-rail to none. |
| Global bottom bar | All pages inside `AppGate` | Search affordance is global; AI button is global; create-action is contextual to current page. |
| `WorkspaceSwitcher` (dropdown) | Top bar | Global; identical everywhere. |
| `UserMenu` (dropdown) | Top bar | Global; identical everywhere. |
| `NotificationCenter` (sheet) | Triggered from top bar | Global; identical everywhere. |
| `Dialog` (shadcn) | Modals across the app | Same primitive; per-modal content. |
| `Sheet` (shadcn) | Notification center, collapsed rails, mobile-ish fallbacks | Same primitive; right-anchored is the default. |
| `ContextMenu` (shadcn) | Right-click on tree items, on cards, on table rows | Items vary; structure identical. |
| `Command` (shadcn) | ⌘K palette | Global; item set varies by page context. |
| `Tooltip` (shadcn) | All icon-only buttons | Identical primitive; copy per-button. |

## Content Growth Plan

What expands and how the IA handles it. (Foundation concerns only — per-feature growth handled in per-feature briefs.)

- **Notes tree** — grows unbounded. Handled by virtualization, infinite scroll, search at the top of the tree, and the existing pinned/notes/custom-DB sectioning. No IA change needed at the foundation level.
- **Accent palette** — fixed at 8 in v1; if user demand surfaces, expand within the curated palette (no arbitrary color picker — keeps every option pre-tuned).
- **Font picker** — fixed at 5 display + 5 body in v1. Adding a font is a content addition, not an IA change.
- **Top-nav items** — currently 6 explicit + overflow. As the app converges to 5–7 features, the overflow goes away. As exploratory features get cut, their routes are removed from `router.tsx` and the corresponding `pages/*.tsx` files are deleted; the shell doesn't need to change.

## URL Strategy (current)

- **Pattern**: flat top-level (`/<feature>`) — no nesting. TanStack Router routes all sit under `appGateRoute`.
- **Dynamic segments**: none in v1. Notes / mindmaps / etc. currently don't have per-item URLs. (Per-note routing is a per-feature concern, not foundation.)
- **Query parameters**: none used consistently today. Future per-feature designs may introduce `?filter=`, `?sort=`, `?view=` patterns — those decisions live in per-feature briefs.
- **Redirects in router**:
  - `/` → `/grid`
  - `/tasks` → `/ground`
  - `/calendar` → `/ground`
- **Auth gate**: `/auth` is outside `AppGate`. Authenticated users hitting `/auth` should redirect to `/` (verify in the auth provider — out of scope here).

## Notes for the future IA refactor (out of scope here)

When the app converges to 5–7 features, an IA brief should consider:

- Renaming `/expanses` → `/expenses` (current typo).
- Whether `/grid` should be renamed to `/dashboard` for consistency with the top-nav label "Dashboard".
- Whether `/ground` (the unified tasks + calendar surface) should be split or kept as one.
- Whether per-item URLs (`/notes/<id>`, `/mindmap/<id>`) are needed for deep linking + share-by-URL.
- Whether the analytics-flavored routes (`/stats`, `/analytics`, `/kpi-okr`, `/revenue`, `/expanses`) collapse into a single `/insights` surface.
- Whether the "Relations" top-nav item points to a dedicated `/relations` route or stays as a per-page right rail.

None of these are needed for the foundation redesign to succeed.
