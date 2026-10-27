---
paths: ["apps/app/src/**/*.tsx", "apps/app/src/**/use-*.ts", "apps/app/src/providers/**", "apps/app/src/lib/sync/react.ts"]
incident: "useSyncExternalStore and React Compiler traps shipped twice (RF-1 references stuck on Loading, CV-9 file chips never showed) and a React #185 loop crashed Chat and a Tasks project in prod (2026-10-06, MOD-122)"
expires: 2027-01-31
---

# React, the React Compiler and effects (app code)

Compiled from the UI and build-ci gotchas (HV-14b, HV-14c). `bun run lint:ast` already fails the mechanical forms (`sync-snapshot-*`, `state-shadows-window`).

## The React Compiler is on in the app build, never in rstest
- A hook returns what `useSyncExternalStore` hands it; never subscribe and then read the store beside it (the compiler memoises the read). A reader built from a version depends on it (`version >= 0 ? store.read(ref) : null`). `apps/app/src/lib/sync/react.ts` is the pattern.
- `getSnapshot` returns the same value until the store changes: module-level constants and getters, never `() => []`.
- A component that reads or writes a ref during render, or hand-memoizes with `useMemo` over a props ref, is silently left uncompiled (`preserve-manual-memoization`). Pass plain objects; keep "latest value" refs in effects. Compare `bun lint` warnings with the base branch: they don't fail verify.
- A file that reads TanStack Virtual's mutable virtualizer starts with `"use no memo"` (`apps/app/src/features/tasks/ui/virtual-stack.tsx`); rows stay compiled.
- Don't construct a stateful object in a `useState`/`useMemo` initializer that captures refs (construct it in a mount effect). Files whose only warnings are SWC port gaps (try/finally, throw in catch, dynamic import) are valid code: leave them. Probe a file with `reactCompiler: { panicThreshold: "all_errors" }`, temporarily.
- Unit tests can't see any of this: live-verify in the dev build.

## Effects and state
- Stop work in the effect's cleanup, not on "`userId` is null": `AppGate` unmounts the shell on sign-out without a last render (the upload queue kept retrying signed out).
- An effect that owns a debounce timer must not list an inline callback prop in its deps (every parent render restarts the timer); ride the callback in a ref.
- A `useCallback` that sets a state and lists it in its deps, run from its own effect, re-runs itself; read that state from a ref. This one cascade was most of DF-12's boot fetch storm (`apps/app/src/providers/workspace-provider.tsx`).
- A `reqRef` counter drops stale replies but not replies after unmount: bump it in the cleanup, and make an exposed `reload()` refuse once unmounted. Tag state with the workspace it was read for, reset it during render when the scope changes, have late writes name their scope, and expose `reload` through a ref to the current loader (`apps/app/src/features/calendar/hooks/use-calendar-module.ts`).
- Never decide whether to send a write from a value captured inside a `setState` updater: it may run at the next render, after your code moved on. Snapshot from the rendered list or a ref.
- A double-submit guard is a ref set synchronously, not `busy` state.
- An optimistic surface over shared data keeps a pending override (`pending[id] ?? server`) cleared only once the server reflects it; never re-seed it from a blanket `useEffect(seed, [source])`.
- `setState` with the value it already has, from a layout effect, still costs an extra draw: compare against a ref first.
- A provider value or bridge that reads live data through refs must still change identity when that data changes, or consumers never redraw.
- Reading computed style in a no-deps layout effect forces a style recalc after every DOM change; cache it until a MutationObserver says otherwise (`apps/app/src/components/ui/toolbar.tsx`).

## Long lists
- Rows and cards never take the module API or the project list as props (both are new objects on every change, so every row redraws). Rows take their facts, id-taking callbacks and `useRowActions`; `task-list-view.redraw.test.tsx` fails otherwise. Hoist dnd-kit sensor options to constants.
- A memoised row doesn't redraw when a module-level setting changes; subscribe inside it (`useTimeRegion()` for anything formatted through `apps/app/src/lib/time-format.ts`).
- A long `NavRow` list: rows are `memo` and take one stable actions object plus their own facts (`apps/app/src/features/tasks/ui/bucket-rail.tsx` `ProjectRow`).
- On the dev server, React 19.2's render tracking diffs the props of every re-rendered component: a project-list change froze a busy Tasks for 5 s in dev only. Profile before blaming the store.

## Router and the desktop webview
- An object `search` in `navigate()` replaces the whole query string. On a route that carries other params (`/contacts`'s `?type&id`), add one with `search: (prev) => ({ ...prev, action: "new" })`.
- Heavy routes load lazily (`lazyRouteComponent` in `apps/app/src/app/router/route-tree.tsx`); a heavy dependency in an eager route lands in the entry chunk (`bun run size` checks it).
- In the desktop webview `window.confirm/alert/prompt` return Promises, and `@tauri-apps/api/*` other than `core` has no web stub: the ast-grep rules `webview-native-dialog` and `tauri-api-static-import` flag both.
