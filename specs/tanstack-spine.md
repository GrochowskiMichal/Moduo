# Spec: TanStack spine — TanStack DB under the module stores, Hotkeys for the command layer

> Status: **ready from TS-1; in-memory plan after TS-0** · Owner: Mike · Written 2026-10-20 from the stack audit
> (`docs/local/perf-stack-audit-2026-10.md`, personal) and its round-2 addendum.
> Relation to the Sync kernel (SK-C1…C4, `specs/BUILD_ORDER.md`): **this spec builds on the kernel, it does not
> race it.** The kernel's stamps / delta / landing / outbox become the sync function of a TanStack DB collection;
> the kernel's own IndexedDB record store and the stores' overlay + snapshot plumbing are what TanStack DB replaces.
> Nothing here starts until SK-C2 (Tasks on the kernel) is merged into `mike`.

## Scope

Replace the hand-rolled client store layer (`apps/app/src/lib/sync/store.ts` 2,305 lines, `features/chat/store/store.ts`
2,392 lines, the per-module `use-*-module` hooks that reload whole on mount) with TanStack DB collections fed by a
Supabase sync adapter we own, kept in memory and seeded from the existing IndexedDB device copy,
with the kernel's outbox kept for offline writes, live queries instead of the hand-written selectors, Pacer for debounce and
batching, the unified Devtools in dev builds, and TanStack Hotkeys for the global shortcut layer. Also the pending
Virtual upgrade (`anchorTo: 'end'` in Chat).

No user-visible behaviour changes except: faster view switches and edits on big workspaces, Contacts / Calendar /
Notes-metadata opening from the device copy instead of refetching whole, and shortcuts gaining a conflict check.

## Product behavior & UX

Unchanged by design. The four perf budgets that already exist stay the contract:
`e2e/tests/perf/tasks-10k.spec.ts` (open, switch, search medians < 200 ms; < 80 rows / 120 cards drawn),
`chat-10k.spec.ts` (warm open ≤ 100 ms, own message ≤ 50 ms, ≤ 3,000 elements, no frame > 50 ms),
`tasks-timeline-2k.spec.ts` (median frame < 16.7 + 4 ms). New budgets added here: first paint from the device copy
≤ 150 ms at 10k tasks; a single-field edit visible in ≤ 1 frame and confirmed by the server without a redraw of
unrelated rows.

## Edge cases

- **Concurrent edits to different fields of one task** from two devices: TanStack DB's optimistic overlay is per row
  (RFC TanStack/db#1625 is open). Mutations therefore PATCH only the changed fields and the server row wins on
  settle; a stale full-row write must never be sent. Test pins it.
- **Realtime event arriving during the initial read** (the window `@supabase-labs/tanstack-db` documents as a
  missed write): the adapter opens the channel first, buffers, reads, then flushes the buffer with dedupe
  (kernel landing rule: strictly newer by server stamp).
- **Soft deletes and hard deletes**: `deleted_at` tables land as removals; tag links and relations (no stamps,
  hard deletes) are read whole as today.
- **Access lost** (project unshared): the kernel's access check keeps running; rows you can no longer see are
  removed from the collection, not left stale.
- **Sign-out / user switch**: per-person persistence files (`user:ws` key, as SK-C4); the outbox survives sign-out,
  rows do not (as Tasks since #509).
- **Persistence unavailable** (private window, OPFS missing, Tauri plugin failing): the collection runs in memory
  and opens from the server; no feature depends on persistence being there.
- **Schema change**: `schemaVersion` bump drops the local SQLite tables and re-syncs; the outbox is kept.
- **Desktop update**: verify (TS-0) that OPFS / the Tauri SQLite file survive an updater install; if OPFS does not,
  desktop uses the Tauri adapter only.
- **Offline write that the server refuses** (`NonRetriableError`): rolled back and shown once, as today's "Offline"
  / refused-op toasts.
- **Two tabs**: `offline-transactions` elects a leader with Web Locks; the kernel's cross-tab outbox rule stays
  the reference behaviour (one send per op id).

## Acceptance criteria

- **AC1** Opening `/tasks` on the 10k fixture paints the Inbox from the device copy in ≤ 150 ms (median of 5) and the
  server delta completes without a visible redraw of rows already shown.
- **AC2** View switch, task open and search medians stay < 200 ms (existing budget), measured before and after.
- **AC3** Editing one field redraws only that task's row (the existing `task-list-view.redraw.test.tsx` guard stays
  green) and sends a PATCH containing only the changed columns.
- **AC4** Every existing Tasks, Chat, Focus, Calendar-tasks-panel, Home-widget and capture test passes unchanged
  through TS-3a (facade) and after TS-3b (consumers on live queries).
- **AC5** Offline: a capture and a check-off made offline are sent once each when the network returns, in order,
  across a reload (existing `tests/offline.spec.ts`).
- **AC6** Chat's stream uses `anchorTo: 'end'` + `followOnAppend` and `chat-10k.spec.ts` passes.
- **AC7** Contacts, Calendar and Notes metadata open from the device copy and update by delta; `use-calendar-module`
  and `use-contacts-directory` lose their whole-reload-on-mount.
- **AC8** Hotkeys: every shortcut in `useGlobalShortcuts` and the page-level capture-phase overrides moves to typed
  Hotkeys scopes; a duplicate binding fails a unit test; the behaviours in `docs/gotchas/ui.md:30` are preserved.
- **AC9** Bundle: first-load gzip does not grow by more than 60 KB net (DB core + d2ts + Pacer, minus the removed
  store code); Devtools are dev-only.
- **AC10** `bun run verify` green; the three perf specs pass on the local stack; `validator` passes on TS-2, TS-3c
  (Tier 2: `lib/runtime*`, sync paths).

## Tests that prove them

| AC | Test | Plain English |
| --- | --- | --- |
| AC1, AC2 | `e2e/tests/perf/tasks-10k.spec.ts` (+ a "paint from device" case) | the four medians, before and after |
| AC3 | `task-list-view.redraw.test.tsx`; new `lib/sync/tanstack/mutations.test.ts` | one row redraws; the PATCH body has only the changed keys |
| AC4 | the whole existing suite | the facade keeps the public API |
| AC5 | `tests/offline.spec.ts`; new `offline-transactions` characterization test | one send per op across a reload |
| AC6 | `e2e/tests/perf/chat-10k.spec.ts` | the chat budgets |
| AC7 | new store tests per module (delta applied, whole reload gone) | open from copy, then delta |
| AC8 | `lib/hotkeys/registry.test.ts` (duplicate binding fails), existing shortcut e2e | shortcuts unchanged, conflicts caught |
| AC9 | bundle-size check in `verify` (added by the bundle-diet task or here) | the budget line |
| AC10 | `bun run verify`, `validator` | the gates |

## Assumptions & technical decisions

- **TanStack DB 0.15.x is beta** (0.7 → 0.15 between Aug and Oct 2026; RC pending TanStack/db#1319). Pin exact
  versions of `@tanstack/db`, `react-db`, `offline-transactions`, `db-sqlite-persistence-core` and the two adapters;
  upgrade deliberately per block, never through a range.
- **We write the Supabase adapter**, not `@supabase-labs/tanstack-db` (0.1.0, full-row PATCH, hard-coded
  on-demand mode, count-per-read, may drop its query-collection base). It stays our reference implementation.
- **The adapter is the kernel.** `createSyncedCollection` (SK-C1) is re-shaped to the collection-options-creator
  contract: `sync({ begin, write, commit, markReady, markError })`; delta reader = kernel delta (keyset, lookback,
  page cap); landing = kernel's strictly-newer rule; Realtime = `features/tasks/realtime.ts` channel, opened before
  the first read and buffered. Watermarks live in persistence metadata.
- **Per-transaction optimistic rollback** is the base (RFC #1625); per-field rollback is kept for bulk and drop edits. Mutations send `transaction.mutations[].changes`
  only. The per-field rollback the current store does is approximated by `tx.when('settled')` + re-landing the
  server row; the redraw test keeps the user-visible contract.
- **Persistence stays the kernel's IndexedDB copy (decided after TS-0).** Collections are in memory and seeded
  from it. The spike measured OPFS SQLite at 676 ms to first rows on a warm open at 10k vs 514 ms today, plus a
  705 KB gzip worker, and its adapter protocol is `@internal`. SQLite is TS-8, optional, behind a second spike.
- **Realtime stays `postgres_changes`** (single-threaded per project, ~30 changes/s at 500 clients with RLS on);
  Broadcast is a later switch if throughput bites; the adapter isolates it.
- **Supabase JS stays v2** (every bridge pins it; v3 is `3.0.0-next`).
- **Pacer** powers `usePacedMutations` for typed edits (debounce) and the outbox batcher; its React adapter is
  compiler-safe (standard hooks).
- **Devtools**: `@tanstack/react-devtools` + `devtools-rspack` plugin, stripped from production.
- **Hotkeys**: `@tanstack/react-hotkeys` 0.17; scopes per route and panel; the capture-phase override pattern from
  `docs/gotchas/ui.md:30` is reproduced with scope priority, not with listener order.
- **Boundaries**: only `lib/runtime*` and `lib/sync/**` import `@supabase/*`; collections are created inside
  `getRuntime()`-owned factories; `lint:boundaries` is extended to forbid `@tanstack/db` imports in `features/**`
  except through `lib/sync/tanstack/`.
- **Virtual**: resolve `@tanstack/virtual-core` ≥ 3.19 (3.18 is what the chat spike used), `anchorTo: 'end'`.
- **TanStack Query and Store are not adopted on purpose**; they arrive as dependencies of DB and are not imported
  by app code (a lint rule).

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| TS-0 | **Spike** ✅ done 2026-10-20 ([#529](https://github.com/GrochowskiMichal/Moduo/pull/529), note `docs/local/spike-tanstack-db-tasks.md`) | switch 200 → 32 ms, search 67 → 37 ms, rows redrawn on an edit 130 → 2; OPFS SQLite warm open 514 → 676 ms (slower) and +152 KB gz + 705 KB worker. Verdict: in-memory collections yes, SQLite persistence not yet | evidence | — |
| TS-1 | **Dependencies, Virtual upgrade, Devtools** | pinned `@tanstack/db` + `react-db` + Pacer + Devtools (dev-only, Rspack plugin); `virtual-core` ≥ 3.19; Chat stream on `anchorTo: 'end'`; bundle budget line in `verify` (DB adds ~97 KB gz); lint rule against `@tanstack/db` outside `lib/sync/tanstack/` | AC6, AC9 | TS-0 |
| TS-2 | **In-memory Supabase collection adapter on the kernel** (`lib/sync/tanstack/`) | `supabaseCollectionOptions()` with no persistence plugin: seeds from the kernel's existing IndexedDB copy, then runs the kernel's delta (keyset, lookback), buffered Realtime, newer-only landing, soft deletes, access-loss truncate, writing through `begin/write/commit/markReady`; the copy is still written by the kernel; characterization tests mirroring SK-C1's | AC1, AC10 | TS-1, SK-C1 |
| TS-3a | **Tasks collections behind the existing `WorkspaceStore` facade** | the 16 Tasks tables as in-memory collections with phase ordering (open before closed); `getSnapshot`/`subscribe` served from live queries; `StoreSnapshot` unchanged; device copy and outbox stay where they are | AC1, AC4 | TS-2, SK-C2 |
| TS-3b | **Tasks consumers on live queries** | list, board, timeline, focus, panel, Home widgets, bell, capture read `useLiveQuery` (sidebar counts as groupBy, `includes` for subtasks / comment counts, search coverage with server fallback); `features/tasks/selectors.ts` retired; `DashboardDataContext` split per source; target: an edit redraws ≤ 2 rows | AC2, AC3, AC4 | TS-3a |
| TS-3c | **Tasks writes as collection transactions** | op RPCs as mutation handlers patching only `changes`, the kernel's outbox kept (not `offline-transactions`); `usePacedMutations` for typed fields; per-field rollback kept for bulk and drop edits; overlay and echo-skip code removed from `store.ts`; Tier 2 validator | AC3, AC5, AC10 | TS-3b |
| TS-4 | **Chat on in-memory collections** | messages per conversation with `loadSubset` paging from the kernel's per-row IDB copy, meta/sidebar collection, hold-failed-for-retry outbox kept, typing/presence untouched | AC6, AC4 | TS-3c, SK-C3 |
| TS-5 | **Contacts, Calendar, Notes metadata collections** | the three whole-reload hooks become collections with delta, seeded from a kernel IDB copy; Calendar's busy overlay stays separate; Notes docs stay on Yjs | AC7 | TS-2, SK-C4 |
| TS-6 | **Hotkeys** (`lib/hotkeys/`) | `@tanstack/react-hotkeys` registry with route and panel scopes, conflict test, migration of `useGlobalShortcuts` and page overrides, devtools panel | AC8 | TS-1 (independent of TS-2…5) |
| TS-7 | **Cleanup and knowledge** | remove the stores' snapshot / overlay plumbing and selectors; decisions at the top of `docs/decisions/data.md` and `toolchain.md`; gotchas; `docs/data-layers.md` and `architecture.md` updated | AC10 | TS-3c, TS-4, TS-5, TS-6 |
| TS-8 | **Optional, later: SQLite persistence** | only if a second spike (on-demand `loadSubset` or an IDB-backed persistence adapter) beats today's 514 ms warm open at 10k; then web OPFS + coordinator, desktop `tauri-plugin-sql` + capabilities, `offline-transactions` outbox, one-time wipe of the old IDB copies | — | TS-7, a passing spike |

Sizing: about 9–10 working days for TS-2 + TS-3a–c on Tasks (spike estimate). TS-3a and TS-3c are the heavy ones (one session each, Tier 2). TS-6 can run in parallel with TS-2…5 (disjoint
files). TS-4 and TS-5 can run in parallel after TS-3c.

## Out of scope

Replacing Yjs or Lexical · Electric, PowerSync or Zero (each needs infrastructure we do not run) · Legend State (see the
audit addendum §B/§D) · TanStack Query or Store as app-facing APIs · Table, Charts, Form, Start · Broadcast-based
Realtime (a later switch inside the adapter) · any new route or IA change · the Mindmap (its own later move to
Supabase, where Loro's movable tree is the candidate).

## Definition-of-Ready gate

- [x] Scope, behaviour, edge cases, ACs filled.
- [x] Every AC has a test.
- [x] **Open questions empty** — TS-0 answered it (see Execution blocks).
- [x] Data model: no new tables or migrations; persistence is client-side SQLite; Supabase-first unchanged.
- [x] Not a module feature; no spine wiring, MCP tools or widget changes.
- [x] Blocks decomposed and sequenced; TS-3 split in three.
- [x] Design constraints: no UI changes except Devtools (dev-only) and shortcut hints; tokens-only applies.
- [x] Manual-test surfaces: Tasks views on the 10k fixture, Chat stream, Contacts / Calendar cold open, offline
      capture, every shortcut on `/tasks`, `/chat`, `/notes`.

**Ready to execute** from TS-1 (TS-2 and TS-3a also wait on SK-C1 / SK-C2 merging into `mike`).

## Open questions

None. TS-0 (2026-10-20) answered the persistence question: in-memory collections now, SQLite only behind TS-8.
