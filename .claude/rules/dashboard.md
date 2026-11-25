---
paths: ["apps/app/src/features/dashboard/**"]
incident: "Quick capture made duplicate Inbox tasks on a double Enter, and the Habits tick lost writes to its own re-seed (DB-5, validator BLOCKERs)"
expires: 2027-01-31
---

# Home dashboard

Compiled from the UI gotchas (HV-14b). Drag: `.claude/rules/ui-drag.md`.

- Widgets read through the mount-once data context (`apps/app/src/features/dashboard/context/dashboard-data-context.tsx` `useDashboardSource`), fetched per source only when a widget needs it; never a module hook (`useCalendarModule`, the mail engine store, …), whose side effects would run just by opening Home. A widget write calls `requestDashboardDataRefresh()`.
- Config changes go through `updateConfig` (position-preserving, applied to the latest layout), never `commitWidgets`. The engine copies `config` one level deep only: replace config immutably.
- The layout is cache-first last-writer-wins on the reused `dashboard_layouts` table (`layout_key = 'home'`, no migration of its own); a load never writes to the cloud (DF-12). The hook paints the session copy or the device cache first and reads the cloud behind it; take the repo from `layoutRepoFor(runtime, userId)`, never `createLayoutRepo` per mount. The grid is editable during the cloud read: a load never overwrites a save made meanwhile.
- Home's data outlives the page: layout and widget sources live in `sessionResources` (`apps/app/src/lib/resource-cache.ts`, memory only, cleared only when the person changes: SIGNED_IN also fires on every tab refocus). A source's `loading` means "no value yet"; a new source passes a unique `name` to `useSource`. Compare freshness in ms, never ISO strings. A layout injected into the local cache for a check reaches the cloud: clean up by deleting the row, then the cache.
- Edit/Done and the page dots live in the app chrome's bottom bar, bridged by window events (`apps/app/src/features/dashboard/edit-mode-events.ts`).
- The curated default fills the 8×4 grid, so "Add widget" usually takes the new-page path: not a bug.
- The pager's off-screen pages are `inert` and clipped (`apps/app/src/features/dashboard/ui/dashboard-pager.tsx`); a widget's inline placement serialises as `grid-area`, so read `el.style.gridColumnStart` in checks.
