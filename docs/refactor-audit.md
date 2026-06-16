# Refactor Audit

Last updated: 4:05 PM CET May 14, 2026.

## Objective

Deeply analyze the codebase, improve clean-code boundaries, organize the project tree, and split oversized files into smaller modules using current React, TypeScript, TanStack Router, and Tauri conventions.

## Completed Structural Changes

- App router moved behind `src/app/router`, with `src/router.tsx` kept as a compatibility re-export.
- Source alias simplified so `@/*` resolves to `src/*`; old `@/src/*` imports were removed.
- Workspace provider split into feature-owned context and mapper modules:
  - `src/features/workspaces/workspace-context.ts`
  - `src/features/workspaces/workspace-mappers.ts`
- Email frontend split into model/cache/HTML utility modules:
  - `src/features/email/model/email-types.ts`
  - `src/features/email/model/email-cache.ts`
  - `src/features/email/utils/email-html.ts`
- Plan workspace helpers extracted into `src/features/plan/ui/plan-workspace-helpers.tsx`.
- Mindmap Mermaid import/layout parser extracted into `src/features/mindmap/ui/mermaid-import.ts`.
- Notes sidebar row/header components extracted into `src/features/notes/ui/notes-sidebar.tsx`.
- App chrome menu prop contract extracted into `src/components/app/app-chrome-menu-types.ts`.
- App chrome menu sections extracted into:
  - `src/components/app/app-chrome-grid-menu.tsx`
  - `src/components/app/app-chrome-tasks-menu.tsx`
  - `src/components/app/app-chrome-mindmap-menu.tsx`
  - `src/components/app/app-chrome-brainstorm-menu.tsx`
- Tauri email command constants and models extracted into:
  - `src-tauri/src/commands/email/constants.rs`
  - `src-tauri/src/commands/email/model.rs`
- Tauri email graph outbox extracted into `src-tauri/src/commands/email/graph_outbox.rs`.
- Tauri email account command handlers extracted into `src-tauri/src/commands/email/account_commands.rs`, while preserving Tauri command names through the `commands::email::account_commands` path.
- Tauri email account/provider configuration extracted into `src-tauri/src/commands/email/account_config.rs`.
- Tauri email body fetching/cache construction extracted into `src-tauri/src/commands/email/body_fetch.rs`.
- Tauri email SMTP sending extracted into `src-tauri/src/commands/email/smtp.rs`.
- Tauri email send command handler extracted into `src-tauri/src/commands/email/send_commands.rs`.
- Tauri email realtime IDLE worker supervision extracted into `src-tauri/src/commands/email/realtime.rs`.
- Email compose panel and date formatting extracted into:
  - `src/features/email/ui/email-compose-panel.tsx`
  - `src/features/email/utils/email-format.ts`
- Email selected-message detail view extracted into `src/features/email/ui/email-message-detail.tsx`.
- Email account connection/setup flow extracted into `src/features/email/ui/email-connection-setup.tsx`.
- Email account/folder sidebar extracted into `src/features/email/ui/email-account-sidebar.tsx`.
- Email message list, loading, empty, and retry states extracted into `src/features/email/ui/email-message-list.tsx`.
- Plan task/event creation panels extracted into `src/features/plan/ui/plan-create-panels.tsx`.
- Mindmap edge style helpers extracted into `src/features/mindmap/ui/edge-style.ts`.
- Mindmap edge style menu extracted into `src/features/mindmap/ui/edge-style-menu.tsx`.
- Mindmap empty/loading canvas states extracted into `src/features/mindmap/ui/mindmap-empty-state.tsx`.

## Verification Gates

- `bun run typecheck`: passed.
- `bun run test`: passed, 6 files and 13 tests.
- `cargo check`: passed.

Known residual warnings from `cargo check`:

- Dependency warning: `imap-proto v0.10.2` future incompatibility, pulled through `imap = "2.4.1"` in `src-tauri/Cargo.toml`. `cargo report future-incompatibilities --id 1` reports newer `imap-proto` releases are available; resolving this safely should be handled as an IMAP dependency upgrade/test pass rather than a mechanical refactor.

Latest verification run on May 14, 2026:

- `bun run typecheck`: passed.
- `bun run test`: passed, 6 files and 13 tests.
- `cargo check`: passed, with only the `imap-proto v0.10.2` dependency future-compat warning.

## Current Hotspots

Line-count scan after the current pass:

- `src/features/mindmap/ui/mindmap-workspace.tsx`: 1136 lines.
- `src-tauri/src/store_redb/mod.rs`: 1105 lines.
- `src/features/notes/ui/NotesSplitView.tsx`: 880 lines.
- `src-tauri/src/commands/calendar.rs`: 867 lines.
- `src/features/plan/ui/link-view.tsx`: 761 lines.
- `src/features/tasks/hooks/use-tasks.ts`: 757 lines.
- `src-tauri/src/commands/email/realtime.rs`: 757 lines.
- `src/features/notes/editor/plugins/SlashCommandPlugin.tsx`: 742 lines.
- `src/features/email/ui/email-workspace.tsx`: 680 lines.
- `src/features/calendar/hooks/use-calendar.ts`: 677 lines.
- `src-tauri/src/commands/auth.rs`: 659 lines.
- `src/features/plan/ui/plan-workspace.tsx`: 644 lines.
- `src-tauri/src/commands/integrations.rs`: 638 lines.
- `src-tauri/src/commands/workspace.rs`: 627 lines.
- `src/features/notes/sync/sync-engine.ts`: 624 lines.

## Recommended Next Splits

- `src-tauri/src/commands/email/realtime.rs`: if continuing later, split IDLE cycle execution from worker topology/supervision.
- `src-tauri/src/commands/email.rs`: if continuing later, split remaining envelope/body, flags, activity, and mailbox status command handlers.
- `src/features/email/ui/email-workspace.tsx`: continue extracting state/effect orchestration where a domain hook would reduce coupling.
- `src/features/mindmap/ui/mindmap-workspace.tsx`: split canvas persistence effects and import/export controls.
- `src/features/plan/ui/plan-workspace.tsx`: continue separating workspace orchestration from task relation/context-menu logic.
- `src-tauri/src/store_redb/mod.rs`: split table/keyspace helpers by domain or storage family.
- `src/features/notes/ui/NotesSplitView.tsx`: move clipboard/external-link helpers and context-menu builders out of the main split view.
- Large hooks such as `use-tasks.ts`, `use-calendar.ts`, and `use-timetracking.ts`: separate command adapters, derived selectors, and optimistic state transitions.

## Completion Status

The objective is partially complete. The project tree is cleaner and several large files now delegate to domain modules, but enough oversized modules remain that the entire-codebase organization goal should stay active.

## Prompt-to-Artifact Audit

Explicit objective requirements and current evidence:

- Deeply analyze the codebase: evidenced by `docs/architecture.md`, this audit file, and repeated hotspot scans across `src/features`, `src/components`, `src/providers`, and `src-tauri/src`.
- Incorporate clean code: evidenced by feature-owned modules, command-owned Rust modules, smaller UI components, and compatibility re-exports where public entry points needed stability.
- Improve project file tree organization: evidenced by new `src/app/router`, `src/features/workspaces`, `src/features/email/model`, `src/features/email/utils`, and `src-tauri/src/commands/email/*` module layout.
- Split files smaller: evidenced by reductions in `email-workspace.tsx`, `app-chrome-menus.tsx`, `src-tauri/src/commands/email.rs`, `plan-workspace.tsx`, `NotesSplitView.tsx`, and `mindmap-workspace.tsx`.
- Follow current React/TypeScript/Tauri conventions as of May 2026: evidenced by route isolation, feature-owned state boundaries, typed props, domain utilities, Tauri blocking I/O isolation, and stable command-name preservation.
- Verify that changes are currently healthy: evidenced by passing `bun run typecheck`, `bun run test`, and `cargo check`.

Unfinished or weakly covered areas:

- The objective says "entire codebase"; current evidence shows broad progress, not exhaustive completion.
- Several hotspot files still exceed 600 lines and should be treated as future targeted refactor work.
- Local Rust warnings have been cleared; only the dependency future-compat warning remains.

## Close-Out Summary

This pass reorganized the project around feature and command boundaries without changing public UI routes or Tauri command names. The main improvements were:

- Frontend routing and workspace context now live behind smaller app/feature modules instead of root-level compatibility files.
- Email UI now separates orchestration from compose, connection setup, account sidebar, message list, message detail, cache, formatting, and HTML sanitization helpers.
- Mindmap UI now separates Mermaid import parsing, edge style helpers, and the edge style menu from the main canvas workspace.
- Plan and notes workspaces now delegate repeated panels/sidebar pieces to focused modules.
- App chrome selector menus are split into one section component per domain.
- Tauri email commands now delegate constants, models, account handlers, account config, body fetching, send handling, SMTP transport, graph outbox, and realtime worker supervision to dedicated modules.

Verified at close-out:

- `bun run typecheck`: passed.
- `bun run test`: passed, 6 files and 13 tests.
- `cargo check`: passed, with only the `imap-proto` dependency future-compat warning.

Remaining worthwhile follow-up is targeted, not urgent: split the still-large Tauri realtime worker, Redb store, calendar/tasks hooks, notes split view, and mindmap canvas orchestration when those areas are next touched.
