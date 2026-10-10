# Tasks v3 — PR reconcile checklist (AC13)

> The six open PRs the Tasks v3 re-plan gave a verdict ([`.design/tasks-v3/research/`](../.design/tasks-v3/research/), [`specs/tasks-v3.md`](../specs/tasks-v3.md) AC13). Each block that carries a PR ticks its row when it lands; `/s3` checks the list at the release. Local build mode: "landed" means on `t/maciej/tasks-v3-build`; the PR on GitHub closes at the release.

| PR | Verdict | Block | Landed | Check |
| --- | --- | --- | --- | --- |
| #315 Live updates | merge as is + the window-focus guard | TV-D5 (block 1) | [x] 2026-10-10 · `t/maciej/tv-d5-live-updates` | Both migrations in `supabase/migrations` (`20261008223000`, `20261008224500`); `use-tasks-module.ts` bumps the catch-up stamp only on a full load or the first read that works; test "coming back to the window refetches without reopening a repeat checked off elsewhere" |
| #327 Attachments | finish: drop-highlight fix, reviews, Tier 2, merge | AT-2 (block 2) | [ ] | |
| #330 Toolbar, Filter, Display | re-scope | TV-U2 (block 6) | [x] 2026-10-10 · `t/maciej/tv-u2-toolbar` (ticked by TV-U4) | Group by without Tag/Energy; one Date grouping; Rows Standard · Detailed; `TaskOrder` lives in `src/features/tasks/display.ts` only |
| #329 Drag and drop | re-scope | TV-U4 (block 7) | [x] 2026-10-10 · `t/maciej/tv-u4-dnd` | Merged with a merge commit; `dnd/drop-mode.ts` + `dnd/rail-drop.ts` kept with their tests; no second `TaskOrder` (`grep -rn "type TaskOrder" src` → `display.ts` only); the validator's MAJOR (`drop-mode.test.ts` "MAJOR (#329)") and MINORs fixed; manual order only in a project or the Inbox (`order.test.ts`); Undo on every drop (`use-tasks-module.drop.test.tsx`); the Inbox row takes no drop (`rail-drop.test.ts`); e2e `tests/tasks-dnd.spec.ts` |
| #328 Sidebar | re-scope | TV-U6 (block 13) | [ ] | |
| #323 Queue run | close and salvage | TV-P0 records the salvage list; TV-F6 (block 22) | [ ] | `supabase/migrations/20261009120000_focus_runs.sql` is absent (never applied as written) |
