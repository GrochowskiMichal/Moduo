---
paths: ["apps/app/src/app/**", "apps/app/src/components/app/**", "apps/app/src/routes/**", "apps/app/src/features/settings/**", "apps/app/src/features/layout/**", "apps/app/src/components/workspace-switcher.tsx", "apps/app/src/providers/workspace-provider.tsx"]
incident: "A hidden route was unreachable even by URL (DF-4), a missed routeToFeatureLayout entry rewrote another feature's panels (CAL-1), and a Settings section opened offline took the whole app down (2026-10-20)"
expires: 2027-01-31
---

# App shell, routes and settings

Compiled from the UI gotchas (HV-14b). No new top-level routes without the designer's ask (AGENTS.md rule 7).

- A top-level route needs six wirings the compiler checks none of: the route (`apps/app/src/app/router/route-tree.tsx`, with `withHotkeyScope`), the nav tab and permission filter (`apps/app/src/components/app/app-chrome-constants.ts`), `routeToFeatureLayout` (`apps/app/src/features/layout/panel-events.ts`; the fallthrough rewrites Notes' panels), the module-N shortcuts (`apps/app/src/lib/shortcuts.ts`), the palette's `navActions` (`apps/app/src/components/app/global-command-palette.tsx`), and, for a route without a tab, `hiddenReachableRoutes` (the chrome bounces any path not in the nav).
- While a navigation loads, `useRouterState`'s location already names the destination but the old layout is still mounted: a "not my route" redirect waits while `state.status === "pending"`.
- Sign-out: navigate first, then sign out (`AppGate` redirects to a plain `/auth` the moment the session ends); the destination tolerates being briefly signed in (`apps/app/src/features/settings/delete-account.ts` `finishAccountDeletion`).
- The default-landing redirect is a one-shot in `homeRoute.beforeLoad` (`consumeLandingRedirect`): never consumed for a signed-out visitor or when `/` carries a query.
- Everything inside AppChrome mounts and unmounts several times during boot and on a workspace switch: a boot-time event to it needs a sticky module-level buffer that only the deep-link path arms, re-applied on mount and disarmed by a user close (`dispatchOpenSettings` with `sticky`, `clearPendingOpenSettings`).
- The top bar's right column has about 180 px at the 1024 px minimum window and never grows: measure anything new there with the longest label, and shorten by `@container` variants.
- A lazy chunk never fetched can't load offline: what must work offline (Account, which holds Log out) stays in the main bundle; other sections go through `lazySection` (`apps/app/src/features/settings/section-loader.tsx`), which shows Retry in place.
- Workspace delete and leave refuse the last workspace in the provider (`softDeleteWorkspace`, `leaveWorkspace`); the switcher's gates are the first line, not the only one.
- Platform forks that open a URL detect the desktop shell (`"__TAURI_INTERNALS__" in window`), not `getRuntime()` (null before init); `lint:ast` fails a new `window.location.origin` (`webview-origin`).
- The undo grammar is one helper (`apps/app/src/lib/undo-toast.tsx` `undoToast`, `UNDO_TOAST_MS`): neutral voice, Undo in `action`, a destructive escalation as the body's `danger` link, never sonner's `cancel` slot. An escalation inside a toast deletes through the silent runtime layer, not a hook that toasts per item.
