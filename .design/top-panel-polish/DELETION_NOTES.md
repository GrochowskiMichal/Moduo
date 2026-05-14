# Route Deletion Notes

Audit output for the 14 routes scheduled for deletion in task 9 of
[TASKS.md](./TASKS.md). Each finding below is a concrete edit or file
deletion that task 9 must execute.

## Slugs deleted

`templates`, `forms`, `activity`, `feed`, `files`, `brainstorm`,
`expanses`, `revenue`, `kpi-okr`, `stats`, `analytics`, `recordings`,
`timetracking`, `roadmap`.

## Files to delete (14)

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

## Files to edit

### [src/router.tsx](../../src/router.tsx)
For each of the 14 slugs:
- Remove the page import (lines 9, 13–25 in the audit; verify with current file at edit time — line numbers shift as you edit).
- Remove the `<slug>Route = createRoute({…})` declaration block (each is ~5 lines).
- Remove the entry from `appGateRoute.addChildren([...])` array (one identifier each).

The two redirect routes `/tasks` → `/ground` and `/calendar` → `/ground` are
unaffected — keep them. The `/` → `/grid` redirect is unaffected.

### [src/features/layout/panel-events.ts](../../src/features/layout/panel-events.ts)
For each of the 14 slugs:
- Remove from the `FeatureLayoutKey` union (one line each).
- Remove from `cloneDefaultMap()` object literal (one line each).
- Remove from `routeToFeatureLayout()` if-chain (one `if (pathname === ...)` each).

The fall-through default at the bottom of `routeToFeatureLayout()` stays
(`return "notes"`).

### [src/components/app/global-command-palette.tsx](../../src/components/app/global-command-palette.tsx)
- Remove the entry for `/brainstorm` from the `navActions` array (single
  line, currently line 72). The `PenTool` icon import becomes unused —
  remove it from the lucide-react import statement.

## Files that do NOT need edits

Confirmed by audit:
- [src/routes/pages/onboarding-page.tsx](../../src/routes/pages/onboarding-page.tsx) — no deep-links to any deleted slug.
- [src/components/notification-center.tsx](../../src/components/notification-center.tsx) — no deep-links to any deleted slug.

## Out of scope for task 9 (per brief)

Orphaned feature directories — keep, do not delete:
- `src/features/templates/`
- `src/features/brainstorm/`
- `src/features/timetracking/`

These directories' internals are unused after the route deletion but the
brief explicitly defers their cleanup to a follow-up ticket. Some entries
in `scripts/check-arbitrary-tw.ts` IGNORED_PATHS point into these
directories — leave them in place; removing the entries is also a
follow-up concern.
