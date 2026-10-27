---
paths: ["apps/app/src/features/dashboard/**"]
incident: "Quick capture made duplicate Inbox tasks on a double Enter, and the Habits tick lost writes to its own re-seed (DB-5, validator BLOCKERs)"
expires: 2027-01-31
---

# Home dashboard

Compiled from the UI gotchas (HV-14b). Drag: `.claude/rules/ui-drag.md`.

- Widgets read through the mount-once data context (`apps/app/src/features/dashboard/context/dashboard-data-context.tsx` `useDashboardSource`), fetched per source only when a widget needs it; never a module hook (`useEmailModule`, `useCalendarModule`, …), whose side effects would run just by opening Home. A widget write calls `requestDashboardDataRefresh()`.
- Config changes go through `updateConfig` (position-preserving, applied to the latest layout), never `commitWidgets`. The engine copies `config` one level deep only: replace config immutably.
- The layout is cache-first last-writer-wins on the reused `dashboard_layouts` table (`layout_key = 'home'`, no migration of its own); a cache-wins load re-pushes up. Compare freshness in ms, never ISO strings. A layout injected into the local cache for a check reaches the cloud: clean up by deleting the row, then the cache.
- Edit/Done and the page dots live in the app chrome's bottom bar, bridged by window events (`apps/app/src/features/dashboard/edit-mode-events.ts`).
- The curated default fills the 8×4 grid, so "Add widget" usually takes the new-page path: not a bug.
- The pager's off-screen pages are `inert` and clipped (`apps/app/src/features/dashboard/ui/dashboard-pager.tsx`); a widget's inline placement serialises as `grid-area`, so read `el.style.gridColumnStart` in checks.
