# Architecture Notes

Last reviewed: 4:05 PM 14th May 2026.

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

- `apps/app/src/lib/sync/`: the Tasks v3 shared store (TV-D11a): one per person and workspace, a device copy in IndexedDB `moduo-sync`, delta sync by `updated_at`, Realtime merge.
- `apps/app/src/features/chat/store/`: the Chat v2 store (CV-3): device copy in IndexedDB `moduo-chat` (`messages` + one `meta` record per person and workspace), outbox, presence, typing.
- `apps/app/src/features/chat/markup-v2/`: Chat v2's stored message form (parse, serialize, canonical blocks, mentions, the Lexical bridge).
- `apps/app/src/lib/runtime.web.notes-live.ts`: a note's live channel (NR-7): each person listens on a private `notes-live:<uid>` topic the server writes to; clients send nothing over Realtime.

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

The email frontend uses `email-workspace.tsx` as the orchestration layer and delegates rendering/model details to focused modules:

- `model/email-types.ts`: shared email DTOs and local UI model types.
- `model/email-cache.ts`: in-memory account/list cache state and folder constants.
- `utils/email-format.ts`: date formatting helpers.
- `utils/email-html.ts`: sanitized email HTML iframe document construction.
- `ui/email-account-sidebar.tsx`: connected account and folder navigation.
- `ui/email-compose-panel.tsx`: compose overlay.
- `ui/email-connection-setup.tsx`: mailbox provider selection and credential form.
- `ui/email-message-detail.tsx`: selected message header/body rendering.
- `ui/email-message-list.tsx`: list, loading, empty, error, and retry states.
- `ui/email-workspace.tsx`: runtime calls, effects, cache orchestration, and feature shell composition.

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
- `flags.rs`: optimistic flag updates and flag outbox flushing.
- `graph_outbox.rs`: email-to-graph outbox queueing.
- `model.rs`: command DTOs and persisted email data shapes.
- `parsing.rs`: MIME/header/date parsing helpers.
- `realtime.rs`: IDLE worker supervision and sync de-duplication.
- `send_commands.rs`: email send Tauri handler and account send-status updates.
- `smtp.rs`: SMTP send path.
- `storage.rs`: Redb/KV email persistence helpers.
- `sync.rs`: folder/envelope synchronization.

Keep adding command submodules by behavior, then re-export only where Tauri registration requires a stable path.

## TypeScript Boundaries

Use strict typing and small modules first. If build times or ownership boundaries become a problem, TypeScript project references are the next step because they enforce logical separation and support incremental builds.

Reference: https://www.typescriptlang.org/docs/handbook/project-references.html

## React Clean Code

Components and hooks should keep rendering pure. Move non-rendering work into effects, event handlers, pure helpers, or feature model modules so React can reason about component output predictably.

Reference: https://react.dev/reference/rules/components-and-hooks-must-be-pure
