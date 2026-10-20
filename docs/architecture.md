# Architecture Notes

Last reviewed: 2026-10-20.

## Current Direction

Moduo is organized as a React/TypeScript frontend with a Tauri/Rust backend. Keep boundaries vertical where the app has domain behavior, and keep shared primitives horizontal only when they are genuinely reused across features.

## Workspaces

Since PLAT-2 (2026-10-17) the repo is a Bun workspace run by Turborepo (`turbo.json`). Run scripts from the root; `bun run verify` runs every package's checks.

- `apps/app` (`@moduo/app`): the Rsbuild SPA for web and desktop (`src/`, `public/`, `index.html`, `rsbuild.config.ts`, `rstest.*`). Its own `tsconfig.json` keeps the `@/*`, `@contracts/*` and `@email/*` aliases.
- `apps/desktop` (`@moduo/desktop`): the Tauri shell. `src-tauri/` lives inside it, and the Tauri CLI runs from `apps/desktop`; `beforeBuildCommand` builds the app's desktop bundle (`apps/app/dist`).
- `apps/landing` (`@moduo/landing`): the static marketing site.
- `apps/storybook` (`@moduo/storybook`): Storybook for the app's stories (`.storybook/`).
- `supabase/` (`@moduo/backend`): migrations and Edge Functions, plus their Rstest suite (`supabase/rstest.config.ts`). It stays at the root because the Supabase CLI expects it there.
- `e2e/` (`@moduo/e2e`): Playwright configs and specs (`e2e/tests`, `e2e/billing`, …).
- Root tooling: `scripts/` (with its own `scripts/rstest.config.ts`), `tools/`, `tsconfig.base.json` (shared compiler options).

Paths in docs written before 2026-10-17 are pre-move: `src/` is now `apps/app/src/`, `src-tauri/` is `apps/desktop/src-tauri/`, `tests/` is `e2e/tests/`.

## Frontend Tree

- `apps/app/src/app`: application composition such as router creation and other app-level wiring.
- `apps/app/src/routes`: route/page adapters. These should stay thin and delegate feature behavior to `apps/app/src/features`.
- `apps/app/src/features/<feature>`: vertical slices for domain UI, hooks, storage, model types, and feature-local utilities.
- `apps/app/src/components/ui`: reusable design-system primitives with no domain knowledge.
- `apps/app/src/components/app`: reusable app shell/chrome components.
- `apps/app/src/lib`: cross-feature runtime adapters and platform services.
- `apps/app/src/styles`: global tokens and stylesheet entry points.

Shared data pieces (added 2026-10-17):

- `apps/app/src/lib/sync/kernel/`: the shared offline-sync kernel (2026-10-20): stamps, one IndexedDB opener, keyset deltas with lookback, the strictly-newer landing rule and delete marks, op-keyed overlays, a persisted outbox (`fifo-drop-on-refusal` or `hold-failed-for-retry`), and a per-person store registry. Tasks and Chat run on it; Notes uses its IndexedDB, network and registry parts only (it syncs Yjs documents, not rows). The rules it encodes are in `docs/gotchas/supabase.md` (sync section).
- `apps/app/src/lib/sync/store.ts`: the Tasks shared store (TV-D11a) on that kernel: one per person and workspace, a device copy in IndexedDB `moduo-sync`, delta sync by `updated_at`, Realtime merge.
- `apps/app/src/features/chat/store/`: the Chat v2 store (CV-3) on that kernel: device copy in IndexedDB `moduo-chat` (`messages` + one `meta` record per person and workspace), outbox, presence, typing.
- `apps/app/src/features/chat/markup-v2/`: Chat v2's stored message form (parse, serialize, canonical blocks, mentions, the Lexical bridge).
- `apps/app/src/lib/runtime.web.notes-live.ts`: a note's live channel (NR-7): each person listens on a private `notes-live:<uid>` topic the server writes to; clients send nothing over Realtime.

### Tasks data and commands

How a surface reads and writes Tasks (since 2026-10-20):

- `features/tasks/selectors.ts`: pure selectors over the store's snapshot, cached on the identity of their input arrays (`liveTasksOf`, `byIdOf`, `subtasksByParentOf`, … and `tasksDataOf` for the whole set). Every page that shows a workspace shares their results.
- `features/tasks/commands/`: `createTaskCommands(ctx)`, one stable set of commands per store, runtime, workspace and person, grouped by aggregate (`task`, `status`, `queue`, `time`, `projects`, `bulk`, …). A command reads the store when it runs (`ctx.data()`), so it never changes identity and an Undo closure never sees stale rows.
- `features/tasks/write-plan.ts`: `planTaskWrite`, the one place that decides a task write (refusals, status mapping, recurrence, queue-follow, subtask-follow, `dueOn`). Single, drop and bulk edits all call it.
- `features/tasks/tasks-context.tsx`: `<TasksProvider>` (one per page) and the narrow hooks a component uses: `useTaskCommands()`, `useTasksSelector(…)`, `useTaskById(id)`, `useTasksStatus()`. A selector must return a cached value; never build a new array or object inside it.
- `features/tasks/ui/plan/`: the Tasks page as a controller (`useTasksPlanController`, a chain of small hooks) and a layout. The place lives in the URL (`?place=`, `resolveEntryPlace`); deep links go through one state machine (`deep-link.ts`).
- Tests render through `features/tasks/testing/` (`renderWithTasks`, `renderTasksHook`, `fakeTasksRuntime`).

Prefer `@/` imports for source-root imports. The alias resolves to `src`, so use `@/components/ui/button` rather than the older `@/src/components/ui/button`.

## Feature Slices

Use this internal layout when a feature grows beyond a single component:

- `ui`: React components and Storybook stories.
- `model`: feature types, constants, cache shape, and pure state helpers.
- `hooks`: feature-specific React hooks.
- `storage` or `sync`: persistence and replication code.
- `utils`: pure helpers that are not part of the public model.

Keep route files and page adapters small. When a workspace crosses a few hundred lines, extract pure model/cache/helpers first, then split UI panels by responsibility.

### Email Feature Module Map

`features/email/` keeps its pure rules at the top level (`threads.ts`, `classify.ts`, `compose.ts`, `convert.ts`, `snooze.ts`, `followup.ts`, `search.ts`, `undo-send.ts`, `history-depth.ts`, each with its test), the module hook and its helpers in `hooks/` (`use-email-module.ts` orchestrates runtime calls and optimistic triage), shared types in `model/email-types.ts`, and the screen in `ui/` (`email-page-view.tsx` composes the rail, thread list, reader, compose and the detail panel; `email-html.ts` builds the sandboxed message iframe, `email-format.ts` formats dates).

## Router

TanStack Router supports both code-based and file-based routing. This project currently keeps code-based routing but isolates it under `apps/app/src/app/router`, so the route tree can later move toward generated/file-based routing without coupling that decision to `main.tsx`.

Reference: https://tanstack.com/router/latest/docs/routing/file-based-routing

## Tauri Backend

Keep `apps/desktop/src-tauri/src/commands` as the Tauri command boundary. Large command modules should delegate to sibling modules for constants, parsing, storage, connection, sync, and flag handling. Tauri's own project structure keeps the Rust application under `apps/desktop/src-tauri` while the frontend remains a normal web app build.

Reference: https://v2.tauri.app/start/project-structure/

### Email Command Module Map

The email command boundary now keeps Tauri command registration stable while delegating implementation to focused modules:

- `account_commands.rs`: account list/connect/disconnect Tauri handlers.
- `account_config.rs`: provider normalization, account IDs, credential lookup, mailbox selection, and connection validation.
- `body_fetch.rs`: message body cache miss fetches.
- `connection.rs`: blocking IMAP connection setup.
- `constants.rs`: email command constants.
- `attachments.rs`: received-attachment metadata, save to disk, compose file picker (EM-7).
- `flags.rs`: optimistic flag updates and flag outbox flushing.
- `model.rs`: command DTOs and persisted email data shapes.
- `oauth.rs`: Gmail sign-in and the XOAUTH2 token lifecycle (EM-2).
- `ops.rs`: the triage op outbox: archive, move, delete (EM-5).
- `parsing.rs`: MIME/header/date parsing helpers.
- `realtime.rs`: IDLE worker supervision and sync de-duplication.
- `search.rs`: hybrid local and server search (EM-9).
- `secrets.rs`: account secrets in the OS keychain, never in redb or the cloud.
- `send_commands.rs`: email send Tauri handler and account send-status updates.
- `smtp.rs`: SMTP send path.
- `snooze.rs`: the snooze engine, a server-side `Moduo/Snoozed` mailbox (EM-6).
- `storage.rs`: Redb/KV email persistence helpers.
- `sync.rs`: folder/envelope synchronization.

Keep adding command submodules by behavior, then re-export only where Tauri registration requires a stable path.

## TypeScript Boundaries

Use strict typing and small modules first. If build times or ownership boundaries become a problem, TypeScript project references are the next step because they enforce logical separation and support incremental builds.

Reference: https://www.typescriptlang.org/docs/handbook/project-references.html

## React Clean Code

Components and hooks should keep rendering pure. Move non-rendering work into effects, event handlers, pure helpers, or feature model modules so React can reason about component output predictably.

Reference: https://react.dev/reference/rules/components-and-hooks-must-be-pure
