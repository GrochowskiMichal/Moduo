# Gotchas: UI, routes, Storybook, drag and the dashboard grid

**Compiled away in HV-14b (2026-10-27).** Each of the 227 traps that lived here is now a check, a path rule that loads when you open a matching file, a live-verify recipe, or was deleted as stale (fixed, removed code, or a duplicate). Code comments that say "gotchas/ui.md" point at the topic below.

## Where each topic went

| Topic (old sections) | Now |
| --- | --- |
| React effects, the React Compiler, `useSyncExternalStore` snapshots, memoised rows, long lists | [.claude/rules/ui-react.md](../../.claude/rules/ui-react.md); `lint:ast` rules `sync-snapshot-fresh-value`, `sync-snapshot-ignored`, `state-shadows-window` |
| Radix menus, dialogs, popovers, tooltips, `asChild`, cmdk, focus return, keys, hotkey scopes, portals bubbling, screen-reader names | [.claude/rules/ui-radix.md](../../.claude/rules/ui-radix.md); `useReturnFocus` |
| Scrollbars, `.pane-scroll`, flex and grid sizing, `overflow`, sticky, state fills, accent wrappers, motion tokens, small caps, measuring computed style | [.claude/rules/ui-css.md](../../.claude/rules/ui-css.md); `lint:tw`, `lint:css`, `global-css.test.ts`, `eyebrow.test.tsx`, `lint:ast` `primitive-size-class-overridden` |
| dnd-kit (`event.delta` includes auto-scroll, one page context, collision per surface, activators), hand-rolled pointer engines, file drops | [.claude/rules/ui-drag.md](../../.claude/rules/ui-drag.md); `lint:ast` `dnd-context-without-sensors`; `useFileDropGuard` |
| Tasks: place and selection, deep links, the List, Board, Timeline, saved views, bulk writes, the detail panel, the plan controller | [.claude/rules/tasks-ui.md](../../.claude/rules/tasks-ui.md) |
| Home dashboard: data context, layout persistence, pager, widgets | [.claude/rules/dashboard.md](../../.claude/rules/dashboard.md) |
| Routes and app chrome, sign-out order, landing redirect, boot remounts, Settings sections offline, the undo toast grammar | [.claude/rules/app-shell.md](../../.claude/rules/app-shell.md); `lint:ast` `webview-origin`, `toast-literal-duration`; `lazySection`, `undoToast` |
| The chat stream, composer, notices, export | [.claude/rules/chat-ui.md](../../.claude/rules/chat-ui.md) |
| Unit tests in jsdom (act, provider mocks, Lexical in tests, missing DOM APIs) | [.claude/rules/tests-dom.md](../../.claude/rules/tests-dom.md) |
| E2E and visual specs, the shared dev workspace, waits and locators | [.claude/rules/e2e.md](../../.claude/rules/e2e.md) |
| Storybook aliases and harnesses | [.claude/rules/storybook.md](../../.claude/rules/storybook.md) |
| Live-verifying in the Browser pane (shared and hidden pane, Radix looking stuck open, throttled rAF, screenshots force progress, synthetic input recipes) | [.claude/skills/s2/live-verify.md](../../.claude/skills/s2/live-verify.md) |
| Legacy tables, restores by stamp | [.claude/rules/migrations-legacy.md](../../.claude/rules/migrations-legacy.md) |

## Adding a trap

Put it where it will be seen at the moment it matters: a `lint:ast` rule (`tools/ast-grep/rules/`) or a test when the wrong code has a shape; otherwise one line in the matching `.claude/rules/*.md`, or a comment at the trap itself. A rule that names a file and a symbol in it (`` `path` `symbol` ``) fails `lint:rules` once the symbol is gone. Add an entry here only when none of those fits.
