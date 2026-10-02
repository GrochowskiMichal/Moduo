# Spec: React 19.2.8 + Rsbuild 2.1 + React Compiler enablement

> Status: **Draft** · Owner: mike · Type: toolchain upgrade (no product/UX changes)

## Scope

Upgrade the frontend build toolchain to unlock automatic memoization via React Compiler v1.0 — the single biggest performance win identified in the state-management analysis. Three changes in one block:

1. React 19.2.0 → 19.2.8 (hygiene bump — all patches are RSC-only, zero client-side delta)
2. Rsbuild 1.7.5 → 2.1.8 + @rsbuild/plugin-react 1.4.6 → 2.1.0 (unlocks native Rust-based React Compiler)
3. Enable `reactCompiler: true` in the Rsbuild React plugin config

No product/UX changes. No new routes, no new components, no data-model changes.

## Product behavior & UX

None. This is a build-time optimization. The user-visible effect is faster renders and fewer unnecessary rerenders — measurable via react-scan (added separately) and React DevTools Profiler, not via new UI.

## Edge cases

- React Compiler validates the Rules of React at build time. If any component violates them (setState in render, unstable refs as deps, etc.), the compiler emits **warnings** (not errors by default). These surface in the terminal during `rsbuild dev` and `rsbuild build`. Each must be triaged: either fix the violation or suppress with `// eslint-disable-next-line` (the compiler respects standard suppression comments).
- The compiler auto-memoizes `useMemo`/`useCallback` chains. If any effect depends on a memoized value that the compiler now memoizes differently, the effect could fire differently. The React team recommends: leave existing `useMemo`/`useCallback` in place during initial adoption (they become no-ops under the compiler but don't break); remove selectively after validation.
- Rsbuild 2.0 is a breaking major. The migration guide must be read before upgrading. Our config is simple (one plugin + aliases + defines), so surface area is small, but the 2.0 breaking changes list must be checked.

## Acceptance criteria

- **AC1** — `bun run verify` passes (typecheck + lint:tw + lint:css + unit tests) after all upgrades
- **AC2** — `bun run dev:web` starts without errors; the app renders on localhost:8081
- **AC3** — `rsbuild build` (web target) succeeds; `dist/web/index.html` exists
- **AC4** — `bun run build:desktop:web` succeeds; `dist/index.html` exists and the bundle contains `__TAURI_INTERNALS__` (not the web stub)
- **AC5** — React Compiler is active: the terminal shows no compiler errors during dev; at most benign warnings about Rules-of-React violations (each triaged)
- **AC6** — The desktop Tauri build (`cargo check` + `bun run build:desktop`) completes without new errors
- **AC7** — No runtime regressions: auth flow, workspace loading, task list render, and settings modal all work in dev

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `bun run verify` (CI gate) | AC1 | typecheck, custom TW lint, stylelint, and all unit tests pass |
| Manual: `bun run dev:web` → load localhost:8081 | AC2, AC5, AC7 | dev server boots, app renders, no compiler errors in terminal |
| Manual: `rsbuild build` (web) | AC3 | production web build succeeds |
| Manual: `bun run build:desktop:web` | AC4 | desktop frontend build targets dist/ with real Tauri APIs |
| Manual: `cargo check` in src-tauri/ | AC6 | Rust side compiles cleanly |
| Manual: sign in → load tasks → open settings | AC7 | core flows work under compiler-optimized rendering |

## Assumptions & technical decisions

1. **React 19.2.8 is a hygiene bump only.** Every patch from 19.2.1–19.2.8 is RSC security hardening / perf — irrelevant to Moduo's CSR/Tauri app. The bump keeps Dependabot quiet and stays current. No client-side feature delta. → verified against GitHub releases page (Jul 2026)

2. **Rsbuild 2.x is required for the native Rust-based React Compiler path.** The Babel-based path (plugin-babel) works on 1.x but is slower. The native path (`pluginReact({ reactCompiler: true })`) requires Rsbuild 2.1.0+. Rsbuild 2.0 upgraded to Rspack 2.x underneath. Our config is minimal (one plugin + aliases + defines), so migration surface is small. The 2.0 migration guide must be consulted during build. → [Rsbuild React docs](https://rsbuild.dev/guide/framework/react#react-compiler)

3. **React Compiler v1.0 is stable and production-ready.** Released Oct 7, 2025. Battle-tested at Meta (Quest Store: ~12% faster loads, 2.5× faster interactions). Compatible with React 17+ (we're on 19.2). Exact version pinned (`--save-exact`) per React team advice for apps with thin test coverage. → [react.dev/blog/2025/10/07/react-compiler-1](https://react.dev/blog/2025/10/07/react-compiler-1)

4. **Known library compatibility:** Framer Motion 12, Lexical, TanStack Router, Radix UI, Yjs, XYFlow — all widely used with no reported React Compiler incompatibilities. Legend State's `use$` is compiler-incompatible, but Legend State is not installed yet (adoption planned separately). Subframe (third-party component lib) — unverified; compiler warnings will surface any issues.

5. **react-scan is NOT included in this block.** It's a diagnostic tool, not a dependency. Adding it separately keeps this block focused on the upgrade itself. It can be added in a follow-up if desired.

6. **tsgo (TypeScript native port) is NOT included in this block.** It's a separate optimization (10× faster typecheck) that pairs well with this upgrade but is independently valuable. Recommended as the next step.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| 1 | Upgrade deps + enable compiler + verify | React 19.2.8, Rsbuild 2.1.8, React Compiler active, all gates green | AC1–AC7 | — |

Single block. All three changes are tightly coupled (Rsbuild 2.1 unlocks the compiler; the compiler needs React 19.x; the verify gate proves nothing broke). Splitting them would leave intermediate broken states.

## Out of scope

- react-scan addition (diagnostic tool, separate block)
- tsgo / TypeScript native typecheck (separate optimization)
- Biome linter adoption (separate toolchain improvement)
- Code splitting / lazy compilation (separate Rsbuild optimization)
- Legend State adoption (separate state-layer work)
- Vitest parallelism fix (separate config change)
- Rust release profile optimization (separate build config)

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty** — every technical unknown is researched and recorded under *Assumptions & technical decisions*.
- [x] **Data model** — N/A (no data-model changes).
- [x] For a **module feature** — N/A (toolchain upgrade, not a module feature).
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [x] **Design constraints acknowledged** — N/A (no UI changes).
- [x] **Manual-test surfaces identified** for the session wrap-up checklist.

**Ready to execute.**

## Open questions

- (none)
