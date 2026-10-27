---
paths: ["apps/app/src/**/*.tsx", "apps/app/src/**/use-*.ts", "apps/app/src/app/router/**"]
incident: "React Compiler violations needed a cleanup pass (TC-2), and an object `search` in navigate() wiped the open contact's selection (FX-1)"
expires: 2027-01-31
---

# App React code: the compiler and the router

- **The React Compiler is on** (`reactCompiler: true`); it warns, never fails. Don't write a ref at render scope (`xRef.current = x` goes inside an effect) and don't construct a stateful object in a `useState`/`useMemo` initializer that captures refs (construct it in a mount effect). Files whose only warnings are SWC port gaps (try/finally, throw in catch, dynamic import) are valid code: leave them. Probe a file with `reactCompiler: { panicThreshold: "all_errors" }`, temporarily.
- **An object `search` in `navigate()` replaces the whole query string.** On a route that carries other params (`/contacts`'s `?type&id`), add one with `search: (prev) => ({ ...prev, action: "new" })`.
- **Heavy routes load lazily** (`lazyRouteComponent` in `apps/app/src/app/router/route-tree.tsx`); a heavy dependency in an eager route lands in the entry chunk (`bun run size` checks it).
- **In the desktop webview, `window.confirm/alert/prompt` return Promises** and `@tauri-apps/api/*` other than `core` has no web stub: the ast-grep rules `webview-native-dialog` and `tauri-api-static-import` flag both.
