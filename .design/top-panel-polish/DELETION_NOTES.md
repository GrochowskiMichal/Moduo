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

## Scope expansion during task 9 (authorised mid-flight)

The brief originally said the orphaned `src/features/{brainstorm,
templates, timetracking}/` directories would stay, with cleanup as a
follow-up ticket. That assumed the orphans didn't reference deleted
`FeatureLayoutKey` union members. They do — three workspace files broke
typecheck after the union was trimmed.

User authorised deleting the three feature directories outright. Doing
that also forced deletion of [src/components/app/app-chrome-menus.tsx](../../src/components/app/app-chrome-menus.tsx),
which imported a type from `features/brainstorm/storage`. That file was
already unused (no imports referencing it), so the deletion is a net
cleanup of dead code rather than a real surface change.

Files deleted in task 9 beyond the original plan:
- `src/features/brainstorm/` (entire directory)
- `src/features/templates/` (entire directory)
- `src/features/timetracking/` (entire directory)
- `src/components/app/app-chrome-menus.tsx`

`scripts/check-arbitrary-tw.ts` `IGNORED_PATHS` entries for files inside
those directories are now stale no-op lookups. The brief said do not edit
that file; harmless to leave the stale entries until a follow-up cleanup.

`src/components/app/app-chrome-types.ts` still exports `TaskProjectOption`
and `MenuAnchor`, and `app-chrome-constants.ts` still exports
`normalizeTaskProject`, `safeId`, `nowIso`, and the various style helpers.
These had only one consumer (`app-chrome-menus.tsx`) and are now truly
dead exports — they don't break typecheck and removing them is its own
follow-up cleanup, not part of this polish run's contract.
