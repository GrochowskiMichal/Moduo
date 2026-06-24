# Moduo — Dashboard (Command Center) Brief

> **Status:** Planned — replaces the throwaway `/grid` prototype (`src/features/dashboard/`, currently a redb-backed widget board). Supabase-first rebuild.
> **Pairs with:** every module (consumes their widgets), [PRODUCT_BRIEF.md](../../docs/PRODUCT_BRIEF.md), [ROADMAP.md](../../docs/ROADMAP.md), [data-layers.md](../../docs/data-layers.md), [moduo-module-contract.md](../../docs/moduo-module-contract.md).

## 1. What it is & job-to-be-done

The Dashboard is the home surface — the screen Moduo opens to. It is a **per-user grid of live, interactive, cross-module tiles**: an iPadOS-style command center, not a settings page and not an analytics report.

Job-to-be-done, in the user's words:

- *"When I open the app, show me where things stand and let me knock out the small stuff without leaving home."*
- *"One place that pulls my contact / project / week together so I'm not hopping between five tabs to reconstruct it."*
- *"Tell me what my partner touched since yesterday — quietly, not a chat firehose."*

It is the spine made visible: a roll-up surface where the connective tissue (links, activity, entity hubs) is rendered as glanceable, actionable tiles. The current `/grid` prototype already proves the interaction model (drag widgets, resize, a panel of widget types including weather/clock/crypto) but is local-only, single-layout, and module-unaware — it knows nothing about tasks, contacts, finance, or the spine.

## 2. Depth ceiling & explicit non-goals

**Ceiling:** iPadOS home-screen parity — fixed tile sizes where size carries information density, fluid column count, auto-pack reflow, and tiles that are *live and interactive* (act from the tile, not just read it). Genuinely great at being the fastest path to "what's up + do the small thing."

| Non-goal | Why |
| --- | --- |
| BI / charts builder, pivot tables, custom-query widgets | This is a glance surface, not Metabase. Finance gets *one* curated money-flow tile, not a chart studio. |
| Free-form canvas / arbitrary pixel placement | The blank-canvas maintenance tax is a top churn driver. Tiles snap to a grid; reflow is automatic. |
| Multiple dashboards / dashboard-per-project (v1) | One per-user dashboard. Entity hubs already give the "everything about X" view; don't fragment into N boards yet. |
| Manual drag-pin layout | **v1.1.** v1 ships auto-pack masonry that preserves insertion order. |
| Real-time collab cursors / chat tile | Multiplayer is async. The shared-state tile shows *who's on what / what changed*, never a chat stream. |
| Widget SDK for third parties | Widgets are first-party only; each module ships its own. |

## 3. The "one great moment"

**It is pre-populated and genuinely useful the first time you open it — never an empty canvas.** Onboarding seeds the workspace with real objects (a couple of tasks, a contact, a project, sample finance), so the first dashboard render already shows *your* week, *your* money-flow, *your* recent activity — not "Add your first widget." The user's first action is *completing* something on a tile, not *configuring* one. This is the single highest-leverage decision in the module: the blank-canvas/maintenance-tax trap is a documented churn driver, and the all-in-one only earns its keep if the home screen looks lived-in on second zero.

## 4. Must-have features

Each: what it is · the insight · how it wires into the spine.

| Feature | One-liner | Evidence / insight | Spine wiring |
| --- | --- | --- | --- |
| **Pre-populated default layout** | First open renders a useful set of tiles bound to seeded real data. | Blank-canvas onboarding is a top churn driver; competitors lose users at "configure your workspace." | Default tiles are spine roll-ups (My Day, Activity, Money-flow), so the spine is the first thing seen. |
| **Fixed tile sizes (S 1×1 / M 2×1–2×2 / L 4×2 / XL 4×4)** | Size is a semantic choice — bigger tile = more density, not just bigger. | iPadOS model: users grasp size-as-information instantly; avoids per-tile config sprawl. | A tile's size picks which roll-up depth it renders (count vs. list vs. grouped-by-relationship). |
| **Fluid column count by window width** | Columns derive from width: base at the 1024px floor, +1 column per ~320px. | Desktop-only, min 1024×700; a fixed column count wastes ultrawide and crushes laptops. | Layout is responsive presentation only; tile *order* is the persisted user intent. |
| **Auto-pack reflow (masonry, preserve order)** | On resize/add/remove, tiles repack to fill gaps while keeping user order. | Eliminates the manual-tetris tax; order is the only thing the user must own. | Order persists per-user; reflow is pure client geometry, no server round-trip. |
| **Live interactive tiles** | Complete a task, log a payment, check a to-do — from the tile. | A read-only dashboard is a poster; the "great" bar requires acting in place. | Tile actions call the owning module's **intent-op RPCs** (`tasks.commit`, `finance.log_payment`) with full actor attribution + activity — never raw writes. |
| **Cross-module ENTITY widget** | "Everything about this contact / project" — the highest-value tile type. | This is the spine rendered as a tile; it is the reason the dashboard beats five browser tabs. | Pins an entity; renders its hub roll-up grouped by relationship (linked tasks, notes, threads, payments) with inline snippets. |
| **Finance money-flow tile** | In / out / runway at a glance, with one curated drill action. | Solo/partner businesses live or die by cash visibility; this is finance's dashboard moment. | Reads finance roll-up; "log payment" action is an intent op; amounts deep-link to linked entities. |
| **Ambient shared-state tile** | "Who's on what / what changed since you were away" for the workspace. | Async multiplayer needs *presence-of-progress*, not chat; partners want a quiet pulse. | Renders grouped `module_activity` filtered to other actors; quiet/digest-default, never a stream. |
| **Module-unrelated widgets (weather, clock, countdown, etc.)** | Personal tiles so anyone can shape their own space. | The `/grid` prototype already ships these and they make the home feel *yours*; ownership drives return visits. | No spine binding required; coexist in the same grid and per-user layout. |
| **Add-widget gallery** | Pick from a categorized panel (Spine · Module · Personal). | Discoverability of what the dashboard can pull in; mirrors the existing widgets panel. | Module widgets are registered via each module's **manifest** (`dashboard.widget` entry) — additive, not hardcoded. |

## 5. Key flows / interactions

- **First run:** user finishes onboarding → lands on a pre-populated dashboard → first gesture is completing a seeded task on the My Day tile (instant optimistic check-off, <200ms).
- **Add a tile:** open gallery → choose widget → pick size (S/M/L/XL) → tile auto-packs into the grid at the end of order → configure inline if needed (e.g. weather city, which entity to pin).
- **Act from a tile:** check a to-do / commit a task / log a payment directly on the face; write is optimistic, attributed, and emits activity. Failure rolls back the single tile, never the board.
- **Pin an entity:** from any contact/project, "Add to dashboard" → spawns an Entity widget pre-bound to that entity → renders its hub roll-up.
- **Resize:** change a tile's size class → grid reflows (masonry) → the tile renders deeper/shallower roll-up to match new density.
- **Reorder (v1):** add/remove changes order; **drag-pin manual placement is v1.1.**
- **Glance at shared state:** ambient tile shows grouped "Mike committed 3 tasks, edited Acme note" since last visit; click → activity detail, not a chat.

## 6. Spine wiring

| Spine surface | Dashboard role |
| --- | --- |
| **Links / attachments** | The Entity tile *is* a rendered link roll-up. Drag a tile's subject onto another entity to link (drag-anything-onto-anything reaches into tiles). |
| **@mentions** | Not authored here; mentions targeting the user surface in the My Day / Activity tiles as actionable items. |
| **/refs** | N/A for authoring; refs inside tile snippets are clickable deep-links to the referenced object. |
| **Notifications** | Dashboard is a *quiet* notification surface: the Activity and shared-state tiles are the grouped/digest view; no red walls, graceful slippage (overdue shown calmly, not in alarm red). |
| **Activity** | Reads `module_activity` directly for the shared-state and per-entity tiles, filtered by actor / entity / recency. |
| **Tags** | Tiles can scope to a tag (e.g. "everything tagged #launch"); tag chips in snippets are filter deep-links. |
| **MCP tools** | `dashboard.list_widgets`, `dashboard.add_widget(type,size,config)`, `dashboard.remove_widget(id)`, `dashboard.reorder(ids)`, `dashboard.set_layout`. Tile *actions* delegate to the owning module's MCP ops — the dashboard exposes layout intent, modules expose data/action intent. All ops attributed + activity-logged per the module contract. |
| **Dashboard widget (self)** | The dashboard *is* the widget host; its definition-of-done is "every other module's widget renders here." It ships no widget of its own into other hosts. |

## 7. Data model sketch (Supabase-first)

Server owns layout and widget instances per user; tile *content* is read live from the owning modules (see §8 — live, not snapshot). Polymorphic entity binding reuses the spine's existing link/entity convention (`entity_type` + `entity_id`).

```
dashboard_layout
  user_id        uuid  fk auth.users     -- per-USER (see open Q)
  workspace_id   uuid  fk workspaces     -- scope; (user_id, workspace_id) unique
  column_hint    int   null              -- last-known col count (presentation only)
  updated_at     timestamptz
  -- no is_locked global flag; lock is a v1.1 manual-pin concern

dashboard_widget
  id             uuid pk
  layout_id      uuid  fk dashboard_layout
  type           text                    -- 'entity' | 'money_flow' | 'my_day'
                                          -- | 'activity' | 'shared_state'
                                          -- | 'weather' | 'clock' | ... (manifest-registered)
  size           text                    -- 's' | 'm_2x1' | 'm_2x2' | 'l' | 'xl'
  position       int                     -- user-owned order; reflow derives x/y
  config         jsonb                    -- per-type: weatherCity, pinned entity, tag filter…
  -- polymorphic bind for entity/roll-up tiles:
  bound_entity_type text null            -- 'contact' | 'project' | 'task' | …
  bound_entity_id   uuid null
  created_at / updated_at / created_by   -- actor attribution
```

Notes:
- **No content tables.** A money-flow or entity tile stores only its binding + config; the actual numbers/lists are fetched live from finance/tasks/etc. via their read APIs. This is the live-vs-snapshot decision (§8) made concrete.
- `position` is the single persisted layout intent; `x/y/w/h` from the legacy `WidgetInstance` (`src/features/dashboard/types.ts`) collapse to `size` + `position` + client-side reflow.
- Migrating the prototype's local `DashboardLayout`/`WidgetInstance` shape: personal widgets (weather/clock/crypto/pomodoro/todolist) carry over via `config`; their per-user nature now has a real `user_id` instead of redb local state.
- RLS: a user reads/writes only their own `dashboard_layout` rows within workspaces they belong to. Layout mutations with no cross-row invariant can stay raw RLS-covered writes; `reorder` is an intent op (ordering invariant).

## 8. Module-specific open questions

| Question | Recommendation |
| --- | --- |
| **Widget data: live view vs. snapshot?** | **Live** (confirmed). Tiles subscribe to the owning module's live query; a snapshot dashboard would feel stale and re-introduce a refresh tax. Snapshot only as a deliberate per-tile opt-in later (e.g. "month-end money-flow frozen"). Mitigate cost with shared subscriptions + per-tile debounce; honor the <200ms P0 bar via optimistic local cache. |
| **Per-workspace vs. per-user defaults?** | **Per-user layout, per-workspace default template.** Each user owns their arrangement (matches "anyone can shape their space"); a new member inherits a sensible workspace default on first open, then diverges. Avoids partners fighting over one shared board. |
| Manual drag-pin in v1 or v1.1? | **v1.1**, as scoped. v1 = auto-pack only; ship the simpler reflow first and learn whether users even want manual placement. |
| Does the Entity tile allow editing the entity inline, or read + deep-link only? | **Read + inline quick-actions only** (complete linked task, log payment); full edits open the entity. Keeps the tile a glance surface, not a mini-editor. |
| Cap on tiles / heavy-tile throttling? | Soft cap (~30 tiles) + lazy-render offscreen tiles; revisit if real layouts exceed it. Low confidence — needs a perf pass once the live subscription model is in. |

## 9. Dependencies & sequencing notes

- **Hard dependency on the spine + each module's read APIs and intent ops.** A tile can only be live and actionable once its module ships (a) a live read query and (b) MCP/intent ops per [moduo-module-contract.md](../../docs/moduo-module-contract.md). The dashboard's own definition-of-done is *"every module's widget renders here,"* so it is the natural **last** integrator in each module's build — each module ships its dashboard widget at completion, the dashboard hosts it.
- **Manifest-driven registration:** dashboard reads each module's manifest `dashboard.widget` entry; adding a module's tile must be additive (a manifest entry + a widget component), never a dashboard-side hardcode.
- **Onboarding coupling:** the "pre-populated on first open" great moment depends on onboarding seeding real objects across modules. Sequence the seed data contract *before* the dashboard's first-run layout, or the home screen falls back to the blank-canvas trap.
- **Reuse the prototype:** `src/features/dashboard/ui/` (grid-workspace, widget-container/shell, widgets-panel, dashboard-grid) is a sound base for grid mechanics and the personal widgets; rebuild storage (`storage/dashboard-view-storage.ts`, `hooks/use-dashboard.ts`) onto Supabase, and replace `x/y/w/h` with `size`+`position`+reflow.
- **Suggested order:** (1) Supabase layout/widget tables + per-user RLS + `reorder` op; (2) port personal widgets + auto-pack reflow + fluid columns; (3) live module tiles (My Day, Activity) as the first module integrations; (4) Entity tile + money-flow tile once contacts/finance read APIs land; (5) shared-state tile once async multiplayer activity is flowing; (6) v1.1 manual drag-pin.

Relevant files: `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/src/features/dashboard/` (prototype), `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/src/features/dashboard/types.ts` (legacy `WidgetInstance` shape to migrate), `/Users/maciej/Documents/Coding/moduohyb/.claude/worktrees/quizzical-faraday-86739c/src/routes/pages/grid-page.tsx` (route to replace).
