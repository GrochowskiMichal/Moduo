---
paths: ["apps/app/src/**/*.test.tsx", "apps/app/src/**/*.test.ts", "apps/app/rstest.setup.ts"]
incident: "An un-awaited act broke the next test instead of its own (TV-T1), and a provider mock with a fresh identity per render hung rstest at 100% CPU (2026-10-15)"
expires: 2027-01-31
---

# App unit tests (rstest + jsdom)

Compiled from the UI and notes gotchas (HV-14b).

- `act(() => api.fn())` becomes an un-awaited async act the day `fn` returns a promise, and breaks the next test: write `act(() => { api.fn(); })` or `await act(async () => …)`. To find the culprit, pair the failing test with each earlier one by `--testNamePattern`.
- A mocked provider value keeps one identity (`rs.hoisted`), as the real provider does; a fresh object per render loops an effect and hangs the runner. Run a new test file under a timeout.
- jest-dom matchers run but aren't typed: use plain assertions (`getBy*` already throws).
- jsdom has no layout, no `:focus-visible`, no custom property resolution, no `Range.getBoundingClientRect`, no `DragEvent` or `ClipboardEvent`, and `document.hasFocus()` is false mid-blur. Stub what the code reads (named `class DragEvent extends Event {}` on `globalThis`; Lexical tells events apart by class name) and measure the rest in a browser.
- Driving a rendered Lexical editor: wait for the seed (`await act(async () => setTimeout 0)`), give it a DOM caret and a Lexical selection (`editor.update(() => $getRoot().selectEnd(), { discrete: true })`), and settle after each key (`apps/app/src/features/spine/editor/entity-text-editor.test.tsx`). A headless `dispatchCommand` outside an update commits asynchronously: flush with an empty discrete update.
- `KeyboardEventInit` has no `keyCode`: set it with `Object.defineProperty`.
- A `scrollTop` write inside `requestAnimationFrame` fires its `scroll` event a frame later: dispatch `new Event("scroll")` yourself.
- A keyboard drag started in a test is cancelled (Escape on `document`) before cleanup; folds are reset with `resetFoldsForTests()`.
- A source-scanning guard test reads string literals the way the parser does (comments skipped), or parses with TypeScript; one quote regex over a file reads an apostrophe in a comment as a string. `apps/app/src/global-css.test.ts` reads comments too: don't quote `pane-scroll` in one.
