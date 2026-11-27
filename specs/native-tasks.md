# Spec: Native desktop app on GPUI — Tasks (NT)

> Status: **Approved** (Mike, 2026-11-28) · Owner: mike · Related: `specs/native-foundation.md` (first), `.design/tasks-polish/BRIEF.md`, `.design/tasks-v3/REPLAN.md`, `.claude/rules/tasks-ui.md`

## Scope

Tasks is the first module in the native app (`apps/native`, see `specs/native-foundation.md` for the app, its primitives and its shell). This spec delivers two things. First the data core in Rust, with no UI in it: the contracts, the offline-sync kernel, the Tasks store on SQLite, the Realtime client, the write rules and the commands, each proved by the vectors of the TypeScript tests it ports. Then Tasks itself, one surface at a time, from a read-only list to the Timeline, until the native Tasks does what the React Tasks does.

Two gates sit inside it. **Gate A** comes early, as soon as a 10,000-task list scrolls and moves by keyboard: native and Tauri are measured on the same data and Mike decides whether the port goes on. **Gate B** closes the spec: a parity sweep against the React Tasks as it is by then, and the same measurements on the whole module.

The backend does not change: the native app calls the tables and server functions the web app calls, as the signed-in person.

## Product behavior & UX

The React Tasks is the reference for layout, wording, states, keys and drop rules; its design sources are `.design/tasks-polish/BRIEF.md` and `.design/tasks-v3/REPLAN.md` (§K everyday views, §J Timeline and Focus). What a person can do grows block by block; the order is the *Execution blocks* table. Three things differ from React on purpose until a later spec replaces them:

- **Description.** It shows as formatted text and is edited as its Markdown source in a plain text box (the stored form is Markdown already). References and dates show as their chips when reading and as their `moduo://` links while editing. The rich editor arrives with the editor work (spec 3 and Notes).
- **Capture tokens.** Typing "pay rent fri #home" is parsed as in React, but the recognised parts show as pills under the field, not inline in the text.
- **Comments.** Plain text with links. The @mention menu is not there yet, so a comment written in the native app mentions nobody.

States every list surface has: loading (skeleton), from the device copy while syncing, empty place, no match for the filter, offline, "Not up to date", truncated ("Showing N of M"), and no access ("Tasks unavailable").

Sync status in the top bar, in this order of precedence: "Offline · N waiting to sync", "Offline", "Not up to date" (a press reloads), "N waiting to sync", nothing.

## Edge cases

- Two saves land in the same millisecond, or Realtime and a read spell the same time differently: stamps compare in microseconds as text.
- An answer to my write arrives older than the row I already hold: it does not overwrite; my own Realtime echo is ignored.
- A row is deleted while a read that started earlier is still on its way: the row stays deleted.
- A write is refused by the server: only that write's optimistic change rolls back, with a toast carrying the server's words.
- The app goes offline mid-write: the write joins the queue in front of later writes for the same task; status changes for one task always send in order.
- A queued create is resent: no second task appears.
- Access to a project is taken away: its tasks disappear without a reload; a newly shared project appears.
- A project or a saved view in the remembered place is gone: the app opens Inbox.
- A task opened by id or handle is not in the list yet: "gone" is said only once the rest has loaded.
- A folded group holds the task being opened: the group opens.
- A drop on a sorted list: refused, with the "sorted" note; nothing moves.
- A subtask is still saving when its parent moves: the move is refused as "still saving".
- More than 5,000 open tasks: the truncation strip shows and search asks the server.
- Sign-out with writes waiting: a warning; the writes survive the sign-out and send after the next sign-in by the same person.
- The device copy is from an older app version: it is dropped, the queue is kept.
- The clock or time zone changes while the app is open: "today" and due marks follow.

## Acceptance criteria

- **AC1** — A change made in the web or Tauri app shows in the native app within seconds without a reload, and the other way round, for every table Tasks shows.
- **AC2** — Offline, the app opens on the device copy; a new task or a status change made offline shows at once, counts in "N waiting to sync" and is sent in order when the connection returns; a refused write rolls back alone and says why.
- **AC3** — No row is lost, duplicated or brought back: a newer row is never overwritten by an older answer, a deleted row stays deleted, a resend never creates a second row.
- **AC4** — Rows the person loses access to disappear and newly shared rows appear, without a reload.
- **AC5** — Closed vocabularies and row shapes come from `supabase/functions/_shared/contracts/`; a change there without a matching Rust change fails a test.
- **AC6** — Every write follows the web app's rules: refusals (no edit right, deleted, still saving, archived), status mapping, recurrence on completion, the queue following status, subtasks following their parent.
- **AC7** — The list shows each place (Inbox, Upcoming, My tasks, All, a project, a saved view) with the React columns, grouping, folds and sticky group headers, and stays smooth with 10,000 tasks.
- **AC8** — Every key in the React Tasks keymap does the same thing in the native list, board, Timeline, Focus and detail pane.
- **AC9** — One cursor and one multi-selection, as in React: click, ⇧-click range, ⌘-click toggle, ⇧J and ⇧K, ⌘A; the detail pane follows the cursor; a task opened by id or handle is revealed in its place.
- **AC10** — The detail pane shows and edits title, status, assignee, team, level, tags, project and section, dates, sessions, reminders, estimate, repeat, subtasks, description, waiting and blockers, comments and activity.
- **AC11** — A task can be added from the list (c), from anywhere in Tasks (⌘N) and into the queue, with dates, people, tags, project and repeat parsed from the typed text as in React.
- **AC12** — Display (grouping, sort, columns), filters, search (/ and F) and saved views behave as in React and persist the same way.
- **AC13** — Drag and drop follows the React rules: reorder and nest in manual order only, change the group's field across groups, move to a project or the queue from the rail, move a whole selection as one change, Board columns and lanes; each drop offers one Undo.
- **AC14** — Projects, areas, sections and statuses can be created, renamed, coloured, reordered, archived and deleted; Trash restores and deletes for good.
- **AC15** — Upcoming, Inbox triage, Board, Focus (Today) and Timeline exist with their React behaviour.
- **AC16** — Time tracking, the time report, repeat rules with their history, waiting and blockers work as in React.
- **AC17** — Every destructive or bulk action offers Undo once; Undo restores only what is still in the changed state.
- **AC18** — The top bar shows the sync status in the wording and order given above.
- **AC19** — Sign-out removes the person's device copy and keeps their queued writes; another person signing in never sees the first person's rows.
- **AC20** — Gate A: cold start, memory, scroll frame time and key-to-paint latency are measured for native and Tauri on the same 10,000-task workspace, written down, and Mike's go or stop is recorded before NT-17 starts.
- **AC21** — Gate B: every React Tasks surface has a native counterpart or is listed as different on purpose, and the Gate A measurements are repeated on the finished module.
- **AC22** — Templates, import, export, the full-page task and the welcome dialog exist with their React behaviour.

## Tests that prove them

Paths are under `apps/native/crates/`. "Ported from" names the TypeScript test whose cases become the Rust cases one to one; its count is the number of cases today.

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `tasks-store/tests/live.rs` · ported from `features/tasks/live.test.ts` (18) and `realtime.test.ts` (2) | AC1 | a Realtime message becomes the right row change, per table |
| `realtime/tests/protocol.rs` · "join, heartbeat, rejoin and resync after a drop" · "a refreshed token is pushed to open channels" | AC1 | the socket survives sleep and network changes |
| `tasks-store/tests/store.rs` · ported from `lib/sync/store.test.ts` (43) | AC1, AC2, AC3, AC4, AC19 | the store's reads, echoes, rollbacks, offline queue, one-person copy, tombstones, grant feed and search |
| `tasks-store/tests/order.rs` · ported from `lib/sync/store.order.test.ts` (6) | AC2 | status writes for one task leave in order |
| `sync-kernel/tests/kernel.rs` · ported from `lib/sync/kernel/kernel.test.ts` (21), `stamps.test.ts` (8), `delta-cursor.test.ts` (4) | AC3 | stamps, landing, delete marks, overlays, deltas |
| `sync-kernel/tests/outbox_model.rs` · ported from `lib/sync/outbox.property.test.ts` (4) with proptest | AC2, AC3 | random sequences of writes, failures and reconnects never lose or double a write |
| `tasks-store/tests/device_copy.rs` · "a copy round-trips" · "an older version keeps only the queue" · "a wipe keeps waiting writes" | AC2, AC19 | the SQLite copy |
| `tasks-store/tests/access.rs` · "ids no longer returned are dropped" · "a grant-feed change triggers the right check" | AC4 | access loss and gain |
| `contracts/tests/drift.rs` · "every vocabulary equals tasks-native.json" · "every row parses the schema's example" | AC5 | Rust and the contracts agree |
| `scripts/native/export-contracts.test.ts` · "the committed tasks-native.json matches the contracts" | AC5 | a contract edit without a fresh export fails verify |
| `tasks-core/tests/write_plan.rs` · ported from `features/tasks/write-plan.test.ts` (26) | AC6 | the one place that decides a write |
| `tasks-core/tests/recurrence.rs` · ported from `recurrence-engine.test.ts` (12), `recurrence-zones.test.ts` (9), `repeat.509-4.test.ts` (7), `repeat-history.test.ts` (4) | AC6, AC16 | next occurrences equal the server's |
| `tasks-core/tests/positions.rs` · ported from `helpers.test.ts` (6), `reorder.test.ts` (21), `order.test.ts` (5), `subtask-order.test.ts` (2), `project-order.test.ts` (5) | AC6, AC13 | position keys sort and fit between neighbours exactly as in TypeScript |
| `tasks-core/tests/queue.rs` · ported from `queue.test.ts` (13); `derived.rs` from `derived.test.ts` (8); `model.rs` from `model.test.ts` (18), `subtasks.test.ts` (14), `status-groups.test.ts` (6), `check-off.test.ts` (10) | AC6 | the pure rules under the commands |
| `tasks-commands/tests/*.rs` · ported from the nine files in `features/tasks/commands/*.test.ts` (30) | AC6, AC17 | commands against the fake server |
| `tasks-ui/tests/list.rs` · "each place shows its rows" · "grouping, folds and the sticky header" · "10,000 rows build only what is visible" | AC7 | the list |
| `tasks-ui/tests/columns.rs` · ported from `row-layout.test.ts` (26) | AC7 | columns fit and titles give way first |
| `tasks-ui/tests/keys_list.rs`, `keys_board.rs`, `keys_timeline.rs`, `keys_focus.rs` · one case per key in the keymap | AC8 | each key's action |
| `tasks-core/tests/selection.rs` · ported from `selection.test.ts` (13); `tasks-ui/tests/plan_state.rs` · ported from `ui/plan/deep-link.test.ts` and `default-view.test.ts` (24) plus "the fold reset keeps the opened task's group open" | AC9 | cursor, multi-selection, place, backstop, opening by id |
| `tasks-ui/tests/detail.rs` · "each property edits and saves" · "gone and private states"; `description.rs` · "Markdown round-trips byte for byte when unchanged" | AC10 | the detail pane |
| `tasks-core/tests/capture_parser.rs` · ported from `parse/capture-parser.test.ts` (44), `paste-list.test.ts` (7) | AC11 | typed text becomes fields |
| `tasks-ui/tests/capture.rs` · "c, cmd-N and add to queue create the task in the right place" | AC11 | the three ways in |
| `tasks-core/tests/filters.rs` · ported from `filters.test.ts` (35); `display.rs` from `display.test.ts` (38); `views.rs` from `views.test.ts` (16); `tasks-ui/tests/views.rs` · "save, open, change and delete a view" | AC12 | display, filters, views |
| `tasks-core/tests/drops.rs` · ported from `dnd/drop-mode.test.ts` (43), `board-drop.test.ts` (14), `rail-drop.test.ts` (13), `drop-write.test.ts` (7), `multi-drop.test.ts` (4) | AC13, AC17 | what a drop means, from pointer and rects |
| `tasks-ui/tests/drag.rs` · "reorder, nest, cross-group, rail, multi" with simulated pointer moves | AC13 | the gesture layer calls the planner with the right hover |
| `tasks-ui/tests/projects.rs` · "create, rename, colour, reorder, archive, delete, restore" · "statuses editor" | AC14 | structure |
| `tasks-ui/tests/upcoming.rs`, `inbox.rs`, `board.rs`, `focus.rs`, `timeline.rs` · one happy path and the view's own rules each | AC15 | the other views |
| `tasks-core/tests/time.rs` · ported from `time-report.test.ts` (21); `tasks-ui/tests/time.rs` · "track, edit, report" | AC16 | time |
| `tasks-commands/tests/undo.rs` · "Undo restores only rows still in the changed state" · "Undo raises no second Undo" | AC17 | the Undo model |
| `app/tests/sync_status.rs` · "the five states in order" | AC18 | top-bar wording |
| `tasks-store/tests/store.rs` · the "copy is one person's" section (7) | AC19 | no leak between people |
| Manual, written to `docs/decisions/desktop-release.md`: Gate A numbers and Mike's call (NT-16) | AC20 | the port continues on evidence |
| Manual: the parity table and Gate B numbers in the PR of NT-51 | AC21 | nothing was forgotten |
| `tasks-ui/tests/templates.rs`, `import.rs`, `misc.rs` · one happy path each | AC22 | the remaining surfaces |

## Assumptions & technical decisions

1. **Crates, none of the first six with GPUI in it:** `moduo-contracts`, `moduo-sync-kernel`, `moduo-realtime`, `moduo-tasks-store`, `moduo-tasks-core`, `moduo-tasks-commands`, then `moduo-tasks-ui`. Rejected: one Tasks crate (the pure rules could not be tested without a window).
2. **The TypeScript tests are the specification.** A port block copies the cases first and writes code until they pass; a case that cannot be ported is listed in the PR with the reason. The React code keeps running in production, so its tests stay the oracle.
3. **Contracts: TypeScript exports, Rust includes** (the pattern of `mail-local.json` and of the token export). `scripts/native/export-contracts.ts` writes `supabase/functions/_shared/contracts/tasks-native.json` (vocabulary arrays and the row schemas through `z.toJSONSchema`); Rust enums and serde rows are written by hand and a drift test compares them with the JSON. Rule 4 holds: the vocabulary still lives once. Rejected: generating Rust types (unreadable output for 19 row types).
4. **Device copy in SQLite** (`rusqlite`, bundled), one file per person in the data folder: a row table per synced table (id, workspace, stamp as text, JSON), cursors, the outbox, a meta row; written by throttle, not debounce. The multi-tab merging of the web outbox is dropped: one process owns the file, and a second launch focuses the first (foundation NF-6).
5. **Realtime by hand** on `tokio-tungstenite`: the Phoenix protocol the web client speaks, the same channel and topic names, resync on every rejoin.
6. **Positions and recurrence.** Position keys are our own base-36 scheme (`features/tasks/helpers.ts:40-177`), ported by hand. Recurrence uses the `rrule` crate if all 32 ported cases pass with it; if one fails, the engine is written by hand for the subset the app writes (`parse/recurrence.ts` presets and custom rules). The crate has had no release since April 2025.
7. **One plan state machine.** Place, cursor, multi-selection, deep link and backstop live in one entity with pure reducers, not in a chain of hooks; the rules of `.claude/rules/tasks-ui.md:10-17` become its tests. The React chain exists to tame effect order, which is not a problem here.
8. **Rows are drawn from facts.** The list entity builds each row from a small value, with no entity per row; panes that do not depend on the list are cached. GPUI redraws a whole entity when it is notified.
9. **Store API:** an immutable snapshot behind an `Arc`, replaced on change, with a subscription; selectors memoise on the identity of their input `Arc`s (the Rust form of `derived.ts`'s WeakMap).
10. **Undo** stays an inverse closure shown in a toast, per command; there is no undo stack.
11. **Drag** is resolved from the raw pointer and the rects measured at that moment, never from accumulated deltas (`.claude/rules/ui-drag.md`); the planners in `features/tasks/dnd/` are pure and port as they are.
12. **Description, capture tokens and comments** are the three reduced surfaces named under *Product behavior*, until the editor work lands. The description is stored as Markdown, so editing the source loses nothing.
13. **Folds and the few Tasks preferences that follow the person** need one synced preference domain; NT-19 ports just that from `lib/prefs-sync.ts`.
14. **Measurements** use the existing seed (`scripts/perf/seed-tasks-10k.ts`) on the local stack and release builds of both apps. No threshold decides by itself: the numbers go to Mike.
15. **No backend change**, as in the foundation.
16. **Natural-language dates** in capture are ported from our own parser and its 44 cases; if it leans on `chrono-node`, the cases the tests cover are implemented by hand. No low-download port crate.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| NT-1 | Contracts export and vocabularies | `tasks-native.json`, staleness test, `moduo-contracts` enums and rows, drift test | AC5 | NF-1 |
| NT-2 | Task model and row mappers | `model.ts` and `task-rows.ts` in Rust | AC5, AC6 | NT-1 |
| NT-3 | Sync kernel | stamps, deltas, landing, overlays, outbox, collection, registry | AC3 | NF-1 |
| NT-4 | Device copy on SQLite | per-person file, tables, cursors, outbox, meta, wipe | AC2, AC19 | NT-3 |
| NT-5 | Tasks reads | the 19 sources, keyset reads, deltas, tombstones, ids, grant feed, search | AC1, AC4 | NT-2, NT-3, NF-25 |
| NT-6 | Tasks store: reads | hydrate, full and delta read, snapshot, access check, 24 h re-read | AC1, AC3, AC4 | NT-4, NT-5 |
| NT-7 | Realtime | Phoenix client, the Tasks channels, live changes into the store | AC1 | NT-6 |
| NT-8 | Tasks store: writes and sync status | overlays, outbox, offline, ordered status writes, top-bar status, sign-out hook | AC2, AC3, AC18, AC19 | NT-7 |
| NT-9 | Tasks core: order, statuses, selectors | positions, reorder, statuses, check-off, derived data | AC6 | NT-2 |
| NT-10 | Tasks core: write plan, queue, recurrence | `planTaskWrite`, queue rules, the recurrence engine | AC6, AC16 | NT-9 |
| NT-11 | Task op calls | the task, status and queue server functions, typed | AC6 | NT-5 |
| NT-12 | Commands: task and status | create, write, patch, delete, restore, done, status, with Undo | AC6, AC17 | NT-8, NT-10, NT-11 |
| NT-13 | List: read-only rows | a flat list of All with the row, its cells and column fit | AC7 | NT-6, NF-17, NF-23 |
| NT-14 | Tasks frame, rail and place | three panes, the fixed places and projects, place state and memory | AC7, AC9 | NT-13, NF-19, NF-30 |
| NT-15 | Cursor, keys, states | cursor, movement keys, scroll follows, skeleton and empty states | AC8, AC9 | NT-14, NF-28 |
| NT-16 | Gate A: measure against Tauri | numbers on 10,000 tasks, Mike's go or stop | AC20 | NT-15, NT-7 |
| NT-17 | Check off, rename, delete | Space, x, e, ⌘⌫ with Undo | AC8, AC17 | NT-16, NT-12, NF-15 |
| NT-18 | Grouping, sticky headers, folds | group by any field, fold, show more | AC7 | NT-15 |
| NT-19 | Synced preferences for Tasks | one preference domain, last write wins | AC7, AC12 | NT-18, NF-30 |
| NT-20 | Detail pane: read | title, properties, crumbs, done lines, gone and private states | AC10 | NT-15 |
| NT-21 | Properties: status, people, level, tags, project | editing from the pane and the row cells | AC10 | NT-20, NT-17 |
| NT-22 | Dates, schedule, estimate | due, schedule, estimate pickers and the s, d, b keys | AC8, AC10 | NT-21, NF-20 |
| NT-23 | Sessions and reminders | work sessions and reminders on a task | AC10 | NT-22 |
| NT-24 | Subtasks | show, add, check, reorder, nest by key | AC8, AC10 | NT-20, NT-17 |
| NT-25 | Description | formatted reading, Markdown editing, fold | AC10 | NT-20 |
| NT-26 | Comments and activity | the feed, post and edit a comment | AC10 | NT-20, NF-21 |
| NT-27 | Quick add | c, ⌘N, add to queue | AC11 | NT-17 |
| NT-28 | Capture parsing and pills | parsed dates, people, tags, project, repeat, pasted lists | AC11 | NT-27, NT-22 |
| NT-29 | Display and sort | grouping, sort, columns per place; the sorted note | AC12 | NT-18, NT-19, NF-21 |
| NT-30 | Filters and search | filter dimensions, / and F, no-match state, server search | AC12 | NT-29 |
| NT-31 | Multi-selection and bulk | range and toggle selection, the bulk panel and keys | AC9, AC17 | NT-21 |
| NT-32 | List drag: reorder and nest | the drag layer and the list planner | AC13 | NT-18, NT-24 |
| NT-33 | Cross-group, rail and multi drag | group field changes, rail drops, whole-selection drags, ⌥⇧ arrows | AC13, AC17 | NT-32, NT-31 |
| NT-34 | Projects and areas | create, rename, colour, reorder, archive, delete; archived view | AC14 | NT-14, NT-33 |
| NT-35 | Project panel and statuses | overview, sections, the statuses editor | AC14 | NT-34 |
| NT-36 | Upcoming | day buckets and rescheduling keys | AC15 | NT-18, NT-22 |
| NT-37 | Inbox triage | file, decline, duplicate, snooze | AC15 | NT-18, NT-34 |
| NT-38 | Board: read and keys | columns, lanes, cards, board keys | AC8, AC15 | NT-29 |
| NT-39 | Board drag | cards across columns and lanes | AC13 | NT-38, NT-33 |
| NT-40 | Focus | queue, Now card, Up next, hand-off | AC8, AC15 | NT-17, NT-27 |
| NT-41 | Time | tracking, Pomodoro, entries, report | AC16 | NT-40 |
| NT-42 | Repeat | rules, history, the move dialog | AC16 | NT-22, NT-10 |
| NT-43 | Waiting, blockers, linked | waiting, blocked by, blocks, linked items | AC10, AC16 | NT-24 |
| NT-44 | Saved views | save, open, change, order | AC12 | NT-30 |
| NT-45 | Open by id or handle | the deep-link machine, reveal, gone | AC9 | NT-15, NT-18 |
| NT-46 | Timeline: read and keys | rows, marks, scale, zoom, keys | AC8, AC15 | NT-29 |
| NT-47 | Timeline: editing | drag, resize, dependencies, no-date drops | AC13, AC15 | NT-46, NT-33 |
| NT-48 | Templates | list, editor, apply, save as template | AC22 | NT-35 |
| NT-49 | Trash, full page, export, welcome, agent marks | the remaining small surfaces | AC14, AC22 | NT-35 |
| NT-50 | Import | the importers and their dialog | AC22 | NT-34 |
| NT-51 | Gate B: parity sweep and measurements | the parity table, drift fixes, final numbers | AC21 | NT-36, NT-37, NT-39, NT-41, NT-42, NT-43, NT-44, NT-45, NT-47, NT-48, NT-49, NT-50 |

## Block briefs

### NT-1 · Contracts export and vocabularies

- **Goal:** A script exports the Tasks vocabularies and row schemas to `tasks-native.json`; the `moduo-contracts` crate has matching Rust enums and serde rows, and tests fail when either side drifts.
- **Acceptance criteria:** AC5 — closed vocabularies and row shapes come from `supabase/functions/_shared/contracts/`; a change there without a matching Rust change fails a test.
- **Tests:** `scripts/native/export-contracts.test.ts` · "the committed tasks-native.json matches the contracts"; `crates/contracts/tests/drift.rs` · "every vocabulary equals tasks-native.json" · "every row parses the schema's example" · "an unknown value parses as the lax fallback where the contract has one".
- **Start here:**
  - Pattern: `scripts/mail/export-contracts.ts:1-12` → `supabase/functions/_shared/contracts/mail-local.json`, read in Rust by `apps/desktop/src-tauri/src/mail/contracts.rs:2,56`, kept fresh by `mail.test.ts:20`.
  - Vocabularies (`supabase/functions/_shared/contracts/vocabularies.ts`, pattern at :1-23): TASK_STATUSES :72, TASK_STATUS_CATEGORIES :116, open and closed :167-169, time :208-231, PROJECT_STATES :324, TASK_REMINDER_KINDS :339, RECURRENCE_MODES :356, AGENT_SESSION_STATES :417, TASK_WAITING_KINDS :464, ACCESS_CHANGE_RESOURCES :483, SYNC_TOMBSTONE_TABLES :503, ENERGY and PRIORITY :517-521, RELATION_KINDS :540, TASKS_ROLES :1604, TASK_VIEW_* :1632-1655, ATTACHMENT_STATUSES :1686. Helpers to port: :137-196 (`normalizeTaskStatusCategory`, `taskStatusWord`, `taskCategoryOf`, `isOpenTask` …).
  - Rows: `supabase/functions/_shared/contracts/rows.ts` (`taskRowSchema` :42, others :96-443, :578); JSON Schema through `z.toJSONSchema(schema, {target: "draft-7"})` as `mcp-tool-args.ts:509` does.
  - Rust: one enum per vocabulary with `parse` (strict) and `normalize` (lax), serde `rename_all` to the wire words; row structs with every optional column as `Option` and unknown fields ignored. Timestamps stay `String`.
  - Add `native:contracts` to the root scripts; the staleness test runs in `bun test scripts`.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `.claude/rules/contracts.md:9` (a vocabulary change moves the array, the zod enum and the Postgres CHECK together).
- **Traps:**
  - Rule 4: the vocabulary lives once, in the contracts folder. The Rust enum is a checked copy; never add a value in Rust first.
  - Columns can be absent before their migration (`rows.ts:325`): absent and null are different in the schema, the same in Rust (`None`).
  - No GPUI in this crate: it tests with plain `cargo test`.
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Models and mappers (NT-2). Vocabularies of other modules.

### NT-2 · Task model and row mappers

- **Goal:** The Tasks domain types and the mapping between server rows and them exist in Rust, with the patch-to-wire functions and the local-day helpers.
- **Acceptance criteria:** AC5 (its part) — rows map to models exactly as in TypeScript. AC6 (its part) — a patch turns into the same columns and op fields.
- **Tests:** `crates/contracts/tests/task_rows.rs` · ported from `apps/app/src/lib/task-rows.local-day.test.ts` (5) and `task-rows.structure.test.ts` (8); `crates/tasks-core/tests/model.rs` · ported from `apps/app/src/features/tasks/model.test.ts` (18).
- **Start here:**
  - Models: `apps/app/src/features/tasks/model.ts` (Task, Bucket, Tag, statuses, structure types; project description at :255-258).
  - Mappers in `apps/app/src/lib/task-rows.ts` (812 lines): `taskRowToModel` :448, completions :501, statuses :516, bucket :534, area :577, section :592, team :607, member :622, session :633, reminder :669, waiting :685, agent session :701, tag :748, tag link :762, comment mark :775, attachment mark :794, queue :342.
  - Patch to wire: `TaskFieldPatch` :139, `editableTaskFields` :202, `taskPatchToColumns` :215, `taskPatchToOpFields` :248, `taskCreateOpInput` :276.
  - Days: `localDayOf` :88, `taskDueDay` :103, `withDueOn` :115, `dueOnToLocalInstant` :127. Use `jiff` civil dates and the device time zone.
  - Bundle shape the store will hold: `TasksModuleBundle` (`apps/app/src/lib/sync/store.ts:203-215`) and `SyncRows` (`apps/app/src/lib/sync/types.ts:59-84`).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - A due day is a calendar day; it never passes through UTC.
  - A patch distinguishes "not set" from "set to nothing": model it as `Option<Option<T>>` or a three-state enum, never a plain `Option`.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - No GPUI in this crate: it tests with plain `cargo test`.
- **Not in this block:** Any network or store code.

### NT-3 · Sync kernel

- **Goal:** The `moduo-sync-kernel` crate is the Rust twin of the shared kernel: stamps, keyset deltas with lookback, the landing rule and delete marks, op-keyed overlays, the outbox and its two policies, the synced collection, and the per-person registry.
- **Acceptance criteria:** AC3 — no row is lost, duplicated or brought back: a newer row is never overwritten by an older answer, a deleted row stays deleted, a resend never creates a second row.
- **Tests:** `crates/sync-kernel/tests/kernel.rs` · ported from `apps/app/src/lib/sync/kernel/kernel.test.ts` (21), `stamps.test.ts` (8), `delta-cursor.test.ts` (4); `crates/sync-kernel/tests/outbox_model.rs` · ported from `apps/app/src/lib/sync/outbox.property.test.ts` (4) with `proptest`.
- **Start here:**
  - Under `apps/app/src/lib/sync/kernel/`: `stamps.ts` (114 lines; parse :22-38, missing-stamp modes :66-75, `stampMinus` :49), `delta.ts` (155; `readDelta` :46-68, `keysetAfter` :85, `deltaCursor` :136), `landing.ts` (175; `lands` :24-34, `LandedRows` :44-170), `overlay.ts` (116; `withOverlays` :59, `openWrite` :92), `outbox.ts` (228; `Outbox` :23, `drainOutbox` :173, `Backoff` :211), `collection.ts` (228), `registry.ts` (268); and `apps/app/src/lib/sync/network.ts` (35).
  - Rules in one line each: stamps compare in microseconds and travel as text; a read or an op answer lands unless the held row is strictly newer; a Realtime row lands only if strictly newer; a delete leaves a mark for 60 s so a read already on its way cannot bring the row back; a refusal drops only its own overlays; the outbox sends the head only and stops on a network error.
  - Storage is a trait here (`CopyStore`); the SQLite one is NT-4. The file headers of each kernel file state the trap it exists for: keep them as doc comments.
  - Add `apps/native/crates/sync-kernel/**`, `tasks-store/**` and `realtime/**` to `TIER2` in `scripts/ci/tier.ts:33-71` and to `tier.test.ts`.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/data.md:7` (2026-10-24, a task's status writes leave one at a time, in order).
- **Traps:**
  - Never carry a stamp as a date type; two saves can share a millisecond (`stamps.ts:2-5`).
  - Drop the multi-tab parts of the outbox (`adopt`, `merged`, `goneElsewhere`, `outbox.ts:119-156`) and say so in the PR; port everything else as it is.
  - A missing session is not a sign-out (`registry.ts:11-15`).
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - No GPUI in this crate: it tests with plain `cargo test`.
  - Sync, store and auth code is Tier 2: run the `validator` subagent before merging.
- **Not in this block:** SQLite (NT-4), any Tasks table (NT-5).

### NT-4 · Device copy on SQLite

- **Goal:** The kernel's `CopyStore` is implemented on SQLite: one file per person, rows per synced table, cursors, the outbox and a meta row, with a throttled writer and a wipe that keeps waiting writes.
- **Acceptance criteria:** AC2 (its part) — offline, the app opens on the device copy. AC19 — sign-out removes the person's device copy and keeps their queued writes; another person never sees the first person's rows.
- **Tests:** `crates/tasks-store/tests/device_copy.rs` · "a copy round-trips" · "an older version keeps only the queue" · "a wipe keeps waiting writes" · "two people on one device have separate files" · "a crash between writes leaves the last complete copy" · "writes are throttled, not delayed forever".
- **Start here:**
  - Web copy to mirror: `apps/app/src/lib/sync/cache.ts` (272 lines): record `CachedWorkspace` :34-44 (`v: 6`, `tables: {name: {rows, cursor}}`, `restLoaded`, `fullReadAt`, `outbox`), key `user:workspace`, read-modify-write in one transaction :57-63.
  - Version rule: a copy from another version keeps only the outbox (`apps/app/src/lib/sync/store.ts:693-699`). Throttle: `persistMs = 800` (`store.ts:358-367`, comment at :725-731).
  - Schema: `rows(tbl, workspace_id, id, stamp, json, PRIMARY KEY(tbl, workspace_id, id))`, `cursors(tbl, workspace_id, cursor)`, `outbox(workspace_id, seq INTEGER, entry_id, json)`, `meta(workspace_id, rest_loaded, full_read_at, version)`. File: `<data>/people/<user_id>/tasks.db`, WAL mode.
  - `rusqlite` with the `bundled` feature (the desktop crate's choice, `apps/desktop/src-tauri/Cargo.toml:46`); calls run on a dedicated thread, never on GPUI's main thread.
  - Changed rows only: the collection reports what it touched (`collection.ts:85`, `takeTouched`); write those, not the whole table.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - The web copy rewrites 10 MB per save; do not copy that. Upsert touched rows in one transaction.
  - A wipe on sign-out deletes rows, cursors and meta and leaves the outbox (`apps/app/src/lib/sync/kernel/registry.ts:7-10`).
  - The file holds customer data: it lives only in the data folder, never in the repo or a log.
  - No GPUI in this crate: it tests with plain `cargo test`.
  - Sync, store and auth code is Tier 2: run the `validator` subagent before merging.
- **Not in this block:** What is read from the server (NT-5).

### NT-5 · Tasks reads

- **Goal:** Typed reads for the 19 synced tables on `moduo-supabase`: whole, open-then-rest, delta by keyset, tombstones for hard-delete tables, the id list for the access check, the grant feed, and server search.
- **Acceptance criteria:** AC1 (its part) and AC4 (its part) — the reads the store needs return the same rows, pages and cursors as the web client's.
- **Tests:** `crates/tasks-store/tests/reads.rs` · ported from `apps/app/src/lib/runtime.web.test.ts` (17) and `runtime.web.tasks.509-1.variant.test.ts` (3) where they cover reads · "a delta pages by stamp then id and reads one row past the cap" · "rows and tombstones share one cursor that stops at the earlier cut" · "the first grant-feed read takes only the newest stamp".
- **Start here:**
  - Sources: `apps/app/src/lib/runtime.web.tasks.ts:267-433` (`SYNC_SOURCES`: table, select list, filters; attachments are filtered at :425-433; comments read four columns only).
  - Keyset: `readByKey` :440-482 (page size, the cap + 1 trick); `syncReadTable` :487-561 (parts `open` and `rest` at :521-529, delta at :542, caps :532-536); `syncIds` :563-583; tombstones :585-656; grant feed :666-722; search rpc `tasks_search` :727-743.
  - Caps: `apps/app/src/lib/paged-select.ts:22-74` (`PGRST_MAX_ROWS = 1000`, `READ_CAPS`).
  - Input and result types: `apps/app/src/lib/sync/types.ts:97-149`.
  - Every read is filtered by workspace and not retried (:495-505). Tests use the fake server of foundation NF-25.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Rows you lose access to never appear in a delta; that is what `syncIds` and the grant feed are for (`apps/app/src/lib/sync/store.ts:22-27`).
  - Sharing changes bump no stamp, so the five small tables are always read whole (`store.ts:253-264`).
  - Only the signed-in person's connection, ever (rules 10 and 11: no service role, no writes to the schema).
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - No GPUI in this crate: it tests with plain `cargo test`.
- **Not in this block:** Writes (NT-11). Time entries, templates, views and agent reads: with their surfaces.

### NT-6 · Tasks store: reads

- **Goal:** The `moduo-tasks-store` crate holds one store per person and workspace: it hydrates from the device copy, reads from the server in two phases or by delta, checks access, and publishes an immutable snapshot.
- **Acceptance criteria:** AC1 (its part), AC3 (its part), AC4 — rows the person loses access to disappear and newly shared rows appear, without a reload.
- **Tests:** `crates/tasks-store/tests/store.rs` · from `apps/app/src/lib/sync/store.test.ts` the sections delta (4), echo (1), TS-3a (2), delete stays (3), copy is one person's (7), no-stamp sharing (3), honest copy (4), tombstones (3), grant feed (4), search (2), archived (1); `crates/tasks-store/tests/access.rs` · "ids no longer returned are dropped" · "a grant-feed change triggers the right check".
- **Start here:**
  - In `apps/app/src/lib/sync/store.ts` (2,299 lines): snapshot :157-215; tables and phases :252-306; timing :358-367; hydrate :689-723; choosing the read :846-899; full read `readFirst` :998-1066 (open tasks land and mark loaded before the rest arrives); delta `readChanges` :1069-1092; access check :1101-1157; grant feed :1180-1286; search :1288-1330.
  - Snapshot API (assumption 9): `Arc<Snapshot>` swapped on change, `subscribe()` gives a watch channel; flags `loaded`, `from_cache`, `rest_loaded`, `offline`, `pending`, `sync_error`, `truncated`.
  - A full re-read every 24 h (`fullReadMs`) because a delta never re-reads a row changed without a new stamp (:350-353).
  - Registry and lifecycle come from the kernel (NT-3); the copy from NT-4; reads from NT-5.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/data.md:33` (2026-10-20, TS-R1: the list's first screen paints first).
- **Traps:**
  - The TanStack mirror (`apps/app/src/lib/sync/tanstack/`) is React-only: do not port it.
  - "Not in the list" is not "gone" until `rest_loaded`.
  - The store file is large: split by concern (hydrate, read, access, search) to keep each file under 32 KB.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - No GPUI in this crate: it tests with plain `cargo test`.
  - Sync, store and auth code is Tier 2: run the `validator` subagent before merging.
- **Not in this block:** Realtime (NT-7), writes (NT-8).

### NT-7 · Realtime

- **Goal:** A `moduo-realtime` crate speaks Supabase Realtime (Phoenix channels over a websocket), and the Tasks store subscribes to its channels and lands live changes.
- **Acceptance criteria:** AC1 — a change made in the web or Tauri app shows in the native app within seconds without a reload, and the other way round, for every table Tasks shows.
- **Tests:** `crates/realtime/tests/protocol.rs` · "join, heartbeat, rejoin and resync after a drop" · "a refreshed token is pushed to open channels" · "a closed socket reconnects with backoff"; `crates/tasks-store/tests/live.rs` · ported from `apps/app/src/features/tasks/live.test.ts` (18) and `realtime.test.ts` (2).
- **Start here:**
  - Channels: `apps/app/src/features/tasks/realtime.ts:101-143` — main `tasks-db:<ws>:<self>` with `postgres_changes {event:"*", schema:"public", table, filter:"workspace_id=eq.<ws>"}` per table; one side channel per side table (:123); the access channel on `access_changes` inserts (:136-143); every re-subscribe after the first emits `resync` (:112-116).
  - Tables: `apps/app/src/features/tasks/live.ts:64-93` (`LIVE_TABLES`, `LIVE_SIDE_TABLES` and why side tables get their own channel, :82-86); parsing `parseLiveChange` :143.
  - Routing into the store: `apps/app/src/lib/sync/store.ts:1483-1510` (`onLive`) and the map at :315-333: another workspace's row is ignored, a delete forgets, an upsert lands with the live rule, any bucket change triggers a resync.
  - Protocol: connect to `wss://<project>/realtime/v1/websocket?apikey=…&vsn=1.0.0`, `phx_join` with the config and `access_token`, `heartbeat` every 25 s, `access_token` message on refresh, `phx_leave`. Read `@supabase/realtime-js` in `node_modules` for the exact frames before writing a line.
  - `tokio-tungstenite`; tests run against an in-process websocket server that plays the frames.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - A channel naming a table that is not published reports subscribed and delivers nothing (`live.ts:82-86`).
  - A delete carries only the old primary key and reaches everyone; an update reaches only those who can still see the row (`.claude/rules/supabase-access.md:34`).
  - After sleep or a network change the socket is silently dead: rely on the heartbeat timeout, then rejoin and resync.
  - No GPUI in this crate: it tests with plain `cargo test`.
  - Sync, store and auth code is Tier 2: run the `validator` subagent before merging.
- **Not in this block:** Presence, broadcast, Chat's channels.

### NT-8 · Tasks store: writes and sync status

- **Goal:** The store takes writes: optimistic overlays, answers, the persisted outbox with offline handling, ordered status writes. The top bar shows the sync status and sign-out knows about waiting writes.
- **Acceptance criteria:** AC2 — offline, a new task or a status change shows at once, counts in "N waiting to sync" and is sent in order when the connection returns; a refused write rolls back alone and says why. AC18 — the status wording and order. AC19 (its part) — sign-out keeps queued writes.
- **Tests:** `crates/tasks-store/tests/store.rs` · from `apps/app/src/lib/sync/store.test.ts` the sections rollback (2), offline (5), outbox order (1); `crates/tasks-store/tests/order.rs` · ported from `store.order.test.ts` (6); `crates/app/tests/sync_status.rs` · "the five states in order".
- **Start here:**
  - In `apps/app/src/lib/sync/store.ts`: outbox entries :124-143 (`create` with an optional queue add, `status`); `begin` :1516, `answer` :1538, `sendStatus` :1708-1760, `enqueue` :1766 (`pushBefore` at :1777-1779), `sendCreate` :1827-1860, `flush` :1872 (holds an entry while a live status write for its task is in flight, :1879-1888), refusal :1906-1918, `send` :1932-1958; a late write after the store stopped :1786-1807.
  - Ordering helpers: `apps/app/src/lib/sync/status-turns.ts` (67 lines), `status-order.ts` (46). Backoff 3 s doubling to 20 s (:473).
  - Status element: `apps/app/src/components/app/sync-status.tsx:26-67` (wording and order at :36-52); it goes into the slot foundation NF-29 left in the top bar and holds the store open for the session.
  - Register the store as `DeviceData` (foundation NF-31): `waiting()` and `wipe(user, keep_waiting)`.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/data.md:7` (2026-10-24, status writes in order; a late write goes to the person's next store).
- **Traps:**
  - A resend must never make a second row: creates go through the idempotent `tasks_op_create` with the entry's own id.
  - An echo of my own write lands under the overlay; the overlay is dropped only when the answer arrives.
  - A refused write is a toast with the server's words, not a retry.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - Sync, store and auth code is Tier 2: run the `validator` subagent before merging.
- **Not in this block:** The commands that call the store (NT-12).

### NT-9 · Tasks core: order, statuses, selectors

- **Goal:** The first half of the pure `moduo-tasks-core` crate: position keys, reorder helpers, status sets and keys, check-off rules and the memoised selectors.
- **Acceptance criteria:** AC6 (its part) — position keys, status mapping and derived data equal the TypeScript ones for every ported case.
- **Tests:** `crates/tasks-core/tests/positions.rs` · ported from `helpers.test.ts` (6), `reorder.test.ts` (21), `order.test.ts` (5), `subtask-order.test.ts` (2), `project-order.test.ts` (5); `derived.rs` from `derived.test.ts` (8); `statuses.rs` from `status-groups.test.ts` (6), `check-off.test.ts` (10), `subtasks.test.ts` (14). All under `apps/app/src/features/tasks/`.
- **Start here:**
  - Positions: `apps/app/src/features/tasks/helpers.ts:40-177` (width 10, step 2^20, `encodePos` :48, `decodePos` :51, `midpointFraction` :64, `endPosition` :98, `positionsAfter` :120, `positionsBefore` :150, `betweenPositions` :177). The spike has a first port: `git show FETCH_HEAD:apps/gpui-spike/src/model.rs` after `git fetch origin pull/841/head`.
  - Order: `reorder.ts:16,47`, `order.ts:31` (`hasManualOrder`), `subtask-order.ts:13`, `sidebar.ts:151`.
  - Statuses: `statuses.ts` (243 lines; `statusKeyOf` :26, `statusKeyCategory` :55, `firstStatusOf`, `optimisticStatus`, `statusSetFor`); `check-off.ts` (179).
  - Selectors: `derived.ts` (360 lines; `liveTasksOf` :113, `statusesForBucketOf` :139, `subtasksByParentOf` :182, `blockedTaskIdsOf` :196, `myQueueEntriesOf` :273, `queuedTasksOf` :287, `tasksDataOf` :304). Memoise on `Arc` pointer identity of the inputs.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Position strings must be byte-identical to TypeScript's: both apps write the same column.
  - A selector returns the same `Arc` while its inputs are the same; building a new list on every call defeats the list's redraw check.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - No GPUI in this crate: it tests with plain `cargo test`.
- **Not in this block:** Write plan, queue, recurrence (NT-10).

### NT-10 · Tasks core: write plan, queue, recurrence

- **Goal:** The second half of `moduo-tasks-core`: `plan_task_write`, the queue rules and the recurrence engine.
- **Acceptance criteria:** AC6 — every write follows the web app's rules: refusals (no edit right, deleted, still saving, archived), status mapping, recurrence on completion, the queue following status, subtasks following their parent. AC16 (its part) — next occurrences equal the server's.
- **Tests:** `crates/tasks-core/tests/write_plan.rs` · ported from `write-plan.test.ts` (26); `queue.rs` from `queue.test.ts` (13); `recurrence.rs` from `recurrence-engine.test.ts` (12), `recurrence-zones.test.ts` (9), `repeat.509-4.test.ts` (7), `repeat-history.test.ts` (4). All under `apps/app/src/features/tasks/`.
- **Start here:**
  - Write plan: `apps/app/src/features/tasks/write-plan.ts` (498 lines): result types :73-147, `queueFollowOf` :149-166, children :176, still-saving refusal :245-253, `planTaskWrite` :317, project move with subtasks :436-441.
  - Queue: `apps/app/src/features/tasks/queue.ts` (`queueMove` :106, positions :134).
  - Recurrence: `recurrence-engine.ts` (231 lines; floating time "exactly like the server's `tasks__rrule_next_in`", :9-17; `toRRule` :39, `occurrencesBetween` :92, `recurrenceOnStatusChange`), `parse/recurrence.ts` (71; presets), `repeat.ts` (239), `repeat-history.ts` (50).
  - Crate rule (assumption 6): try `rrule` 0.14; if any of the 32 cases fails, write the engine by hand for the rules the app produces.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:1971` (2026-10-13, TV-D12 recurrence) and `:2612` (2026-10-10, TV-D8 server ops and recurrence).
- **Traps:**
  - Floating time: a repeat at 9:00 stays 9:00 across a clock change; the zone cases in `recurrence-zones.test.ts` are the proof.
  - On done, my own queue row stays on show until the next reload (`write-plan.ts:149-166`).
  - A repeating parent keeps its subtasks open when it completes.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - No GPUI in this crate: it tests with plain `cargo test`.
- **Not in this block:** Commands (NT-12). Drop planners (NT-32).

### NT-11 · Task op calls

- **Goal:** Typed calls for the server functions that write tasks, statuses and the queue, on `moduo-supabase`.
- **Acceptance criteria:** AC6 (its part) — each call sends the arguments the web client sends and maps the answer rows to models.
- **Tests:** `crates/tasks-store/tests/ops.rs` · ported from `apps/app/src/lib/runtime.web.single-ops.test.ts` (7), `runtime.web.upserts.test.ts` (4) and the write cases of `runtime.web.test.ts` · "each op posts the web client's argument names".
- **Start here:**
  - Port contract: `apps/app/src/lib/runtime.types.tasks.ts:109-371` (signatures and doc comments).
  - Implementations in `apps/app/src/lib/runtime.web.tasks.ts`: helpers `taskOpRpc` :98-103, `queueOpRpc` :113-116; `tasks_op_create` :802/:960; `tasks_op_update` :755 (update, op update, delete at :1045-1084); statuses `project_statuses_op_create|update|delete` :971-994; queue `tasks_op_queue_add|remove|reorder|move_to_end` :1335-1358; `tasks_op_assign` :1490, `tasks_op_claim` :1498, `tasks_op_set_status` :1480, `tasks_op_reschedule` :1502, `tasks_op_unschedule` :1511, `tasks_op_skip_occurrence` :1518, `tasks_op_move_occurrence` :1528, `tasks_op_history` :1538, `tasks_op_catch_up` :1587; tags :1098-1172; relations :1255-1279; `seedInbox` :137-160.
  - The spike called three of these with `ureq` (`git show FETCH_HEAD:apps/gpui-spike/src/api.rs` after `git fetch origin pull/841/head`).
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Argument names are `p_*` and must match exactly; capture them from the TypeScript, never guess.
  - Below the minimum build these calls are refused by the gate in `moduo-supabase`; surface its message unchanged.
  - These run as the signed-in person against the existing functions: nothing here deploys or alters the backend (rule 11).
  - No GPUI in this crate: it tests with plain `cargo test`.
- **Not in this block:** Structure, sessions, reminders, waiting, time, templates, views and import ops: each arrives with its surface block.

### NT-12 · Commands: task and status

- **Goal:** The `moduo-tasks-commands` crate has the command context and the first two groups: task (create, write, patch, delete, restore, subtask, parent, blockers) and status (set, toggle done, mark done, archive), each with its Undo.
- **Acceptance criteria:** AC6 (its part) — commands run through the write plan. AC17 — every destructive or bulk action offers Undo once; Undo restores only what is still in the changed state.
- **Tests:** `crates/tasks-commands/tests/task.rs` · ported from `task.509-2.test.ts` (4), `task-commands.capture-saving.test.ts` (6), `task-move.733.test.ts` (4), `task-reorder.509-2.test.ts` (2), `task.822-1.variant.test.ts` (1); `undo.rs` · "Undo restores only rows still in the changed state" · "Undo raises no second Undo". Sources under `apps/app/src/features/tasks/commands/`.
- **Start here:**
  - Under `apps/app/src/features/tasks/commands/`: `context.ts` (82 lines; `Finished = {count, undo}` :39, peers :74-82), `index.ts` (`createTaskCommands` :33), `shared.ts` (441; `applyOp`, `sendNewTask`, `chainTaskOp`, `stillSaving`, `statusBack` :56, queue follow :174-191), `task.ts` (723; exports :706-722), `status.ts` (187; `finishOpenSubtasks` :27-43, exports :176-186).
  - A command reads the store when it runs, so an Undo closure never holds stale rows (`docs/architecture.md`, "Tasks data and commands").
  - Toasts and Undo are UI: the crate takes a `Notifier` trait (`toast`, `undo_toast`); `moduo-app` implements it with the toast host of foundation NF-15; tests use a recorder.
  - Tests run against the fake server (foundation NF-25) and a real store.
- **Decisions that apply:** the two 2026-11-28 entries NF-1 adds: `docs/decisions/toolchain.md` "GPUI comes from crates.io, exactly pinned" and `docs/decisions/desktop-release.md` "A native macOS app on GPUI lives in apps/native".
- **Traps:**
  - Bulk and multi-step commands never throw part-way: collect refusals and report them once (`.claude/rules/tasks-ui.md:26`).
  - Undo compares the exact `key|statusId` (`tasks-ui.md:22`).
  - A write on a row that is still saving is refused as "still saving", not queued behind it.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Queue, schedule, projects, structure, activity, time, tags and bulk commands: with their surfaces.

### NT-13 · List: read-only rows

- **Goal:** A new `moduo-tasks-ui` crate shows the All place as a flat, read-only, virtualised list: the task row with its status glyph, title, handle, project, date and counts, in columns that fit the width.
- **Acceptance criteria:** AC7 (its part) — rows show the React columns and stay smooth with 10,000 tasks; titles give way first when narrow.
- **Tests:** `crates/tasks-ui/tests/columns.rs` · ported from `apps/app/src/features/tasks/row-layout.test.ts` (26); `crates/tasks-ui/tests/list.rs` · "10,000 rows build only what is visible" · "a row shows glyph, title, project, date and counts from its facts" · "a changed task redraws its row only".
- **Start here:**
  - Row: `apps/app/src/features/tasks/ui/task-row.tsx:148` (755 lines; view parts only), facts in `apps/app/src/features/tasks/ui/row-facts.ts` (224 lines).
  - Cells: `apps/app/src/features/tasks/ui/task-row-cells.tsx` (`StatusGlyph` :62, `HandleCell` :172, `DateCell` :307, `LateFixes` :492); meta `apps/app/src/features/tasks/ui/task-meta.tsx` (`TaskCounts` :99, `DateMark` :224, `BlockedMarker` :32).
  - Columns: `apps/app/src/features/tasks/row-layout.ts` (`rowColumns` :152, `columnWidths` :253, `fitColumns` :332).
  - List host: `apps/app/src/features/tasks/ui/task-list-view.tsx:342` (2,311 lines; estimates :311, the virtual stack at :2223). Use `VirtualStack` and `Row` from `moduo-ui` (foundation NF-23, NF-17).
  - Data: the store snapshot (NT-6) through `tasksDataOf` (NT-9). The spike's `tasks_view.rs` (924 lines, `git show FETCH_HEAD:apps/gpui-spike/src/tasks_view.rs` after `git fetch origin pull/841/head`) is a working rough cut.
  - Design: `.design/tasks-polish/BRIEF.md:141-163` (stable row grid, subtask indent with a guide).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/data.md:33` (2026-10-20, TS-R1: the first screen paints first).
- **Traps:**
  - Rows take facts and id callbacks, never the store or the project list (`.claude/rules/ui-react.md`, "Long lists").
  - GPUI redraws a whole entity on `cx.notify()`: keep rows and cells plain elements built from facts, and give a primitive its own entity only when it holds state (open, draft, focus).
  - One date grammar everywhere and "late" in words (`docs/decisions/tasks.md:5`, 2026-11-26).
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Any interaction (NT-15, NT-17), grouping (NT-18), other places (NT-14).

### NT-14 · Tasks frame, rail and place

- **Goal:** Tasks fills the three-panel shell: a rail with Inbox, Focus, Upcoming, My tasks, All and the projects (read-only), a centre that switches by place, an empty right pane. The place is one state, remembered per workspace.
- **Acceptance criteria:** AC7 (its part) — the list shows each place. AC9 (its part) — the app reopens on the last place; a place that is gone falls back to Inbox.
- **Tests:** `crates/tasks-ui/tests/plan_state.rs` · ported from `apps/app/src/features/tasks/default-view.test.ts` (24) and `ui/plan/use-plan-place.test.tsx` · "a pick shows before the data confirms it" · "a saved view survives until the server has answered"; `crates/tasks-core/tests/sidebar.rs` · ported from `sidebar.test.ts` (23); `crates/tasks-ui/tests/list.rs` · "each place shows its rows".
- **Start here:**
  - Layout: `apps/app/src/features/tasks/ui/plan/tasks-plan-layout.tsx:27,96`; centre switch `apps/app/src/features/tasks/ui/plan/plan-body.tsx:53` (cases :111-197).
  - Rail: `apps/app/src/features/tasks/ui/bucket-rail.tsx:246` (1,429 lines); rows Inbox :483, Focus :513, Upcoming :525, My tasks :534, All :567, areas and projects :625-673; constants :75-80; groups from `apps/app/src/features/tasks/sidebar.ts:81` (`sidebarGroups`). Footer links: `apps/app/src/components/app/sidebar-footer.tsx`.
  - Place: `apps/app/src/features/tasks/default-view.ts` (`resolveDefaultSelection` :82, `remembersPlace` :117, `resolveEntryPlace` :158, reopenable scopes :60); hook `apps/app/src/features/tasks/ui/plan/use-plan-place.ts:50-119`; place values in `apps/app/src/features/tasks/search.ts:11-57`.
  - Start the single `PlanState` entity here (assumption 7): fields place, pending pick, remembered place; reducers are pure functions in `moduo-tasks-core`.
  - Module table row and panels: foundation NF-29, NF-30. Rail rows: `NavRow` (NF-19).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:52` (2026-10-20, the place has one source) and `:32` (controller and layout).
- **Traps:**
  - There is no address bar: `PlanState.place` is the one source every entry point writes (`.claude/rules/tasks-ui.md:10`).
  - `view:<id>` is not a place; the centre reads the place, the rail highlight reads the selection (`tasks-ui.md:14`).
  - A new workspace's Inbox does not exist until first opened: wait for it (`tasks-ui.md:17`).
  - No permission (`permissions.tasks = none`): no tab, and "Tasks unavailable" (`apps/app/src/routes/pages/tasks-page.tsx:91-118`).
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Editing projects (NT-34), Focus and Upcoming content (NT-40, NT-36), saved views in the rail (NT-44).

### NT-15 · Cursor, keys, states

- **Goal:** The list has a cursor that follows clicks and the movement keys, scrolls into view and drives the right pane's selection; loading, empty and truncated states exist.
- **Acceptance criteria:** AC8 (its part) — ↓ j, ↑ k move the cursor; Esc clears. AC9 (its part) — one cursor; when the selected task leaves the list the backstop picks a neighbour.
- **Tests:** `crates/tasks-ui/tests/keys_list.rs` · "down, j, up, k move; the list scrolls to the cursor" · "a key from a field or a menu is ignored"; `crates/tasks-core/tests/selection.rs` · the cursor and backstop cases of `apps/app/src/features/tasks/selection.test.ts` (13); `crates/tasks-ui/tests/states.rs` · "skeleton, empty place, truncated strip".
- **Start here:**
  - Keys: `apps/app/src/features/tasks/ui/list-keys.ts:90` (`listKeyAction`; movement :109-112, :132-135; `isRowControl` :65; portaled surfaces ignored :82); handler `apps/app/src/features/tasks/ui/task-list-view.tsx:1264`, focus back to the list :1290; runner `apps/app/src/features/tasks/ui/row-keys.ts:54`.
  - Cursor and backstop: `apps/app/src/features/tasks/ui/plan/use-plan-selection.tsx:45`, `apps/app/src/features/tasks/ui/plan/use-plan-cursor.tsx:16,75`, `apps/app/src/features/tasks/selection.ts:161` (`backstopPick`).
  - States: `apps/app/src/features/tasks/ui/task-view-states.tsx` (skeletons :55-81, no match :103, empty scope :134), `apps/app/src/features/tasks/ui/view-empty-states.tsx:14-84`, truncation `apps/app/src/components/app/truncation-notice.tsx`.
  - Bind the keys through the registry (foundation NF-28) in a `tasks` scope; the list container holds focus and shows quiet focus.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:3883` (2026-10-08, TV-Q1: the list leaves modified keys alone; a row's buttons keep Space and Enter).
- **Traps:**
  - The cursor has one owner, `PlanState`; the list reports gestures and never keeps its own copy (the React app has two owners and a crash history, `.claude/rules/tasks-ui.md:12`).
  - Never clear the selection to show a project.
  - Timeline and Focus may keep nothing selected: the backstop is opt-in per view (`tasks-ui.md:13`).
  - Rows take facts and id callbacks, never the store or the project list (`.claude/rules/ui-react.md`, "Long lists").
- **Not in this block:** Keys that change data (NT-17 on). Multi-selection (NT-31).

### NT-16 · Gate A: measure against Tauri

- **Goal:** Native and Tauri Tasks are measured on the same 10,000-task workspace, the numbers are written down, and Mike decides whether the port goes on.
- **Acceptance criteria:** AC20 — cold start, memory, scroll frame time and key-to-paint latency are measured for native and Tauri on the same 10,000-task workspace, written down, and Mike's go or stop is recorded before NT-17 starts.
- **Tests:** Manual, recorded as a dated entry in `docs/decisions/desktop-release.md` and in the PR. `crates/tasks-ui/benches/list.rs` (new) prints frame times for a scripted scroll and 200 cursor moves.
- **Start here:**
  - Data: `scripts/perf/seed-tasks-10k.ts` on the local stack (`bun run local:up`); the web measurement to mirror is `e2e/tests/perf/tasks-10k.spec.ts`.
  - Builds: `cargo run --release -p moduo-app` against the local backend, and a release Tauri build of the same commit (`bun run build:desktop`).
  - Measure, three runs each, median: (1) cold start to the first list frame (a timestamp logged at process start and at first paint; for Tauri, process start to the list's first commit); (2) resident memory after load and after scrolling the whole list (`footprint <pid>`); (3) frame time, median and 95th percentile, for a scripted scroll top to bottom; (4) key to paint for 200 ↓ presses; (5) binary and bundle size.
  - Baselines already on file: `docs/local/perf-stack-audit-2026-10.md` §1 (personal notes, if present).
  - Write the table and one paragraph of reading; send it to Mike in the report under ❓ Needs you.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - The local stack is shared (rule 13): seed into your own workspace, never reset, never delete another session's rows.
  - Compare like with like: both apps on the device copy (second launch), both in release mode, same window size, on battery or on power for both.
  - This block ends with a report, not a verdict. If Mike stops the port, the remaining blocks are closed, not built.
- **Not in this block:** Optimising either app. Any feature work.

### NT-17 · Check off, rename, delete

- **Goal:** The first writes from the list: Space or x completes and reopens, e or a double press edits the title in place, ⌘⌫ deletes, each with its Undo toast; the context menu offers the same.
- **Acceptance criteria:** AC8 (its part) — Space, x, e, ⌘⌫ do what they do in React. AC17 (its part) — delete and done offer Undo once.
- **Tests:** `crates/tasks-ui/tests/keys_list.rs` · "Space and x toggle done" · "e edits in place; Enter saves; Esc restores" · "cmd-backspace deletes and Undo restores" · "a row button keeps its own Space and Enter"; `crates/tasks-ui/tests/context_menu.rs` · "the menu acts on the pressed row".
- **Start here:**
  - Keys: `apps/app/src/features/tasks/ui/list-keys.ts:100,117,136,138`; runner `apps/app/src/features/tasks/ui/row-keys.ts:54`.
  - Row pieces: `apps/app/src/features/tasks/ui/task-row.tsx:637` (`TitleEditor`), the complete toggle (foundation NF-9), `apps/app/src/features/tasks/ui/task-context-menu.tsx:37,53` (`activateTask`).
  - Rules: `apps/app/src/features/tasks/check-off.ts` (NT-9). Commands: `toggleDone`, `patchTask`, `deleteTask`, `restoreTask` (NT-12).
  - Toast host and Undo: foundation NF-15, wired through the `Notifier` of NT-12.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:3883` (2026-10-08, TV-Q1).
- **Traps:**
  - A completed repeating task comes back as its next occurrence; the row must not flash away and back (the write plan returns what to show).
  - Finishing a parent offers to finish its open subtasks (`apps/app/src/features/tasks/commands/status.ts:27-43`).
  - A read-only build or a person without edit rights sees the controls disabled with the reason on hover.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Status menu and other properties (NT-21).

### NT-18 · Grouping, sticky headers, folds

- **Goal:** The list groups by status, priority, assignee, section or project with sticky headers, fold and unfold, "Show more", the backlog line and "Add section"; → and ← expand and collapse subtasks.
- **Acceptance criteria:** AC7 — grouping, folds and sticky group headers as in React.
- **Tests:** `crates/tasks-core/tests/grouping.rs` · the grouping cases of `apps/app/src/features/tasks/helpers.test.ts`; `folds.rs` from `folds.test.ts` (3); `crates/tasks-ui/tests/list.rs` · "grouping, folds and the sticky header" · "a fold reset keeps the selected task's group open" · "right and left expand and collapse subtasks".
- **Start here:**
  - Grouping: `apps/app/src/features/tasks/helpers.ts:366` (`GroupBy`), :467 (`groupTasks`); list wiring `apps/app/src/features/tasks/ui/task-list-view.tsx:457-631`, headers :1867-1942, sticky indexes :1814.
  - Header parts: `apps/app/src/features/tasks/ui/task-list-parts.tsx` (`groupMark` :45, `ListGroupHeader` :78, `ShowMoreLine` :182, `BacklogLine` :214, `AddSectionLine` :252). Primitive: `GroupHeader` (foundation NF-17).
  - Folds: `apps/app/src/features/tasks/folds.ts:18-42` (keys and read/write). Keep them in the device preferences for now; NT-19 makes them follow the person.
  - Subtask expand keys: `apps/app/src/features/tasks/ui/list-keys.ts:113-116`.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - No grouping is `group_by = none`, or a later drop writes a section called "all" (`.claude/rules/tasks-ui.md:20`).
  - A deep link into a folded group opens it; the collapse reset keeps the selected task's group open (`tasks-ui.md:16`).
  - The sticky header is the overlay of `VirtualStack`; it must take the same press and menu as the in-flow one.
  - Rows take facts and id callbacks, never the store or the project list (`.claude/rules/ui-react.md`, "Long lists").
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Choosing the grouping (the Display menu, NT-29); until then the default per place.

### NT-19 · Synced preferences for Tasks

- **Goal:** The preference domain Tasks uses follows the person across devices: folds, the Tasks sidebar and inbox settings and the display choices are read from and written to `user_preferences`, last write wins.
- **Acceptance criteria:** AC7 (its part) and AC12 (its part) — folds and display choices persist the way React's do, across devices.
- **Tests:** `crates/app/tests/prefs_sync.rs` · "a newer server value replaces the local one" · "a newer local value is pushed" · "an offline change is pushed on reconnect" · "another person's local value is never pushed" · "stamps compare as instants, not as text".
- **Start here:**
  - Engine: `apps/app/src/lib/prefs-sync.ts` (590 lines; the rules in its header :1-30; metadata keys :59-65, :117).
  - Port contract: `apps/app/src/lib/runtime.types.preferences.ts:14-73` (read `user_preferences`, write through rpc `prefs_op_set`).
  - What Tasks keeps there: `apps/app/src/lib/preferences.ts:250-302` (`tasksSidebar`, `tasksInbox`, `tasksOnboarding`, `tasksFolds`).
  - Local side: the `DeviceStore` and `preferences.json` of foundation NF-30; add the sync metadata (owner, write time, dirty) beside the value.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Only the `preferences` domain here. Appearance, focus, calendar and email domains come with Settings (spec 4).
  - The server keeps the newer stamp on every write; never "fix" a refusal by resending.
  - A value belongs to the person who wrote it: on a different sign-in the local copy is replaced, not pushed.
  - Nothing here changes the table or the function (rule 11).
- **Not in this block:** A Settings screen.

### NT-20 · Detail pane: read

- **Goal:** Selecting a task shows it in the right pane: header with crumbs, title, the property rows, done and won't-do lines, and the empty, gone and private states. Nothing edits yet.
- **Acceptance criteria:** AC10 (its part) — the detail pane shows title, status, assignee, team, level, tags, project and section, and dates. AC9 (its part) — the pane follows the cursor.
- **Tests:** `crates/tasks-ui/tests/detail.rs` · "the pane follows the cursor" · "gone and private states" · "an empty selection shows the hint" · "properties with no value are offered under Add property".
- **Start here:**
  - Panel: `apps/app/src/features/tasks/ui/task-detail-panel.tsx:115` (669 lines; body :129, properties :258, description slot :272, feed slot :325, header :334, title :457, done line :523, won't-do :546, private :565, gone :586, empty :637).
  - Header: `apps/app/src/features/tasks/ui/task-detail-header.tsx:101` (crumbs :344, :431; queue button :521, shown disabled until NT-40).
  - Properties: `apps/app/src/features/tasks/ui/task-detail-properties.tsx:100` (read paths), `apps/app/src/features/tasks/detail-properties.ts`, `apps/app/src/features/tasks/ui/add-property-line.tsx`.
  - Pane frame and what it shows: `apps/app/src/features/tasks/ui/plan/plan-panels.tsx:28`, `apps/app/src/features/tasks/ui/plan/use-plan-panel-state.tsx:13`, `apps/app/src/features/tasks/panel-views.ts:50,83`.
  - Primitives: `PropertyRow`, `DetailTitle`, `EmptyState`, `Avatar` (foundation NF-17, NF-8, NF-18).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Four pixels of side padding so focus rings are not clipped (`.claude/rules/tasks-ui.md:35`).
  - "Gone" only once the rest of the tasks has loaded.
  - The pane is its own entity reading one task by id; a list redraw must not redraw it and the other way round (GPUI redraws a whole entity on `cx.notify()`: keep rows and cells plain elements built from facts, and give a primitive its own entity only when it holds state (open, draft, focus).)
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Editing (NT-21 to NT-26).

### NT-21 · Properties: status, people, level, tags, project

- **Goal:** Status, assignee, team, level, tags, project and section can be changed from the detail pane, from the row cells and by key (⇧S, b).
- **Acceptance criteria:** AC10 (its part) — the pane edits status, assignee, team, level, tags, project and section. AC8 (its part) — ⇧S opens the status menu, b the project picker.
- **Tests:** `crates/tasks-ui/tests/detail.rs` · "each property edits and saves" · "a status of another project's set is mapped by category" · "a new tag is created by name and attached"; `crates/tasks-ui/tests/keys_list.rs` · "shift-S and b open their pickers on the cursor row".
- **Start here:**
  - Rows: `apps/app/src/features/tasks/ui/task-detail-properties.tsx` (status :273, assignee :306, team :432, level :483, tags :546).
  - Row cells: `apps/app/src/features/tasks/ui/task-row-cells.tsx:212` (`ProjectMenu`); keys `apps/app/src/features/tasks/ui/list-keys.ts:128,142`.
  - Commands to add to `moduo-tasks-commands`: `apps/app/src/features/tasks/commands/tags.ts` (53 lines) and the assign path (rpc `tasks_op_assign`, `tasks_op_claim` from NT-11); status goes through `setTaskStatus` (NT-12).
  - Pickers are `Command` inside `Popover` (foundation NF-16, NF-11); people and teams come from the workspace members (foundation NF-27) and the store's teams.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:3827` (2026-10-08, TV-T1: one tag store; a tag can be created by name before its task exists).
- **Traps:**
  - A menu item that opens a picker runs after the menu closed.
  - Moving to another project maps the status by category and carries the subtasks; the write plan decides, the UI does not.
  - Project writes join the project's chain before waiting (`.claude/rules/tasks-ui.md:27`).
  - Copy wording, order and states from the React source named above; do not redesign.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Dates (NT-22), repeat (NT-42).

### NT-22 · Dates, schedule, estimate

- **Goal:** Due day and time, the scheduled time and the estimate can be set from the pane, from the row's date cell and by key (s, d).
- **Acceptance criteria:** AC10 (its part) — dates and estimate edit and save. AC8 (its part) — s opens schedule, d opens due on the cursor row.
- **Tests:** `crates/tasks-ui/tests/dates.rs` · "due day, due time, schedule and estimate each save" · "clearing a date saves nothing-set, not today" · "late fixes offer today and tomorrow" · "s and d open on the cursor row".
- **Start here:**
  - Pickers: `apps/app/src/features/tasks/ui/task-detail-pickers.tsx` (1,350 lines): `DueTimeValue` :84, `EstimateValue` :666. Row cell: `apps/app/src/features/tasks/ui/task-row-cells.tsx:307` (`DateCell`), :492 (`LateFixes`). Keys: `apps/app/src/features/tasks/ui/row-keys.ts:96-103`, `apps/app/src/features/tasks/ui/list-keys.ts:142-147`.
  - Commands: `apps/app/src/features/tasks/commands/schedule.ts` (121 lines; exports :113-120) with rpc `tasks_op_reschedule` and `tasks_op_unschedule` (NT-11).
  - Primitive: `DateField` and `Calendar` (foundation NF-20). Day maths: the helpers of NT-2.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Rows placed by their scheduled time move through `scheduleTaskAt`, not a plain patch (`.claude/rules/tasks-ui.md:23`).
  - A due day is a calendar day in the person's zone.
  - Split the pickers file: one Rust file per picker.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Sessions and reminders (NT-23), repeat (NT-42).

### NT-23 · Sessions and reminders

- **Goal:** A task's work sessions and reminders can be added, changed and removed from the pane, with the "restore reminders" offer.
- **Acceptance criteria:** AC10 (its part) — sessions and reminders edit and save.
- **Tests:** `crates/tasks-ui/tests/sessions.rs` · "add, change and remove a session" · "add and remove a reminder" · "removing the due date offers to restore its reminders"; `crates/tasks-store/tests/ops.rs` · "session and reminder ops post the web client's arguments".
- **Start here:**
  - UI: `apps/app/src/features/tasks/ui/task-detail-pickers.tsx` `SessionsValue` :164, `ReminderValue` :487.
  - Commands: `apps/app/src/features/tasks/commands/activity.ts` (259 lines; exports :248-258: sessions, reminders, waiting, restore).
  - Ops in `apps/app/src/lib/runtime.web.structure.ts`: sessions :676-721 (`tasks_op_session_add|update|remove`), reminders :731-762 (`tasks_op_reminder_add|remove`, `tasks_op_reminders_restore`). Rows already sync (NT-6: `task_sessions`, `task_reminders`).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:1971` (2026-10-13, TV-D12 reminders).
- **Traps:**
  - Reminder kinds are a closed vocabulary (NT-1).
  - A reminder fires from the server; the app only stores it.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Waiting (NT-43). Notifications themselves (spec 5).

### NT-24 · Subtasks

- **Goal:** Subtasks show under their parent in the list and in the pane; they can be added, checked off, reordered in the pane, and nested or un-nested by key.
- **Acceptance criteria:** AC10 (its part) — subtasks show, add, check and reorder. AC8 (its part) — > nests under the row above, < un-nests.
- **Tests:** `crates/tasks-ui/tests/subtasks.rs` · "add, check, reorder in the pane" · "greater-than nests and less-than un-nests" · "a parent shows its count and progress" · "deleting a parent promotes its subtasks".
- **Start here:**
  - Pane: `apps/app/src/features/tasks/ui/task-detail-collections.tsx` `SubtasksSection` :61, `SubtaskRow` :186 (its own sortable list, :126, :208).
  - Keys: `apps/app/src/features/tasks/ui/list-keys.ts:122-125`. Order: `apps/app/src/features/tasks/subtask-order.ts` (NT-9). Commands: `addSubtask`, `setTaskParent` (NT-12).
  - Reorder in the pane with the ⌥⇧ arrows now; pointer drag arrives with the drag layer (NT-32).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - One level of subtasks in the list, indented with a guide (`.design/tasks-polish/BRIEF.md:141-163`).
  - A subtask that is still saving blocks a move of its parent.
  - Rows take facts and id callbacks, never the store or the project list (`.claude/rules/ui-react.md`, "Long lists").
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Dragging subtasks (NT-32).

### NT-25 · Description

- **Goal:** A task's description shows as formatted text with a fold after about eight lines, and is edited as its Markdown source in a text box.
- **Acceptance criteria:** AC10 (its part) — the description shows and edits. Product difference on purpose: Markdown source editing until the rich editor exists.
- **Tests:** `crates/tasks-ui/tests/description.rs` · "Markdown round-trips byte for byte when unchanged" · "the fold counts the references it hides" · "blur saves, Esc restores"; `crates/tasks-core/tests/description_markdown.rs` · the reading cases of `supabase/functions/_shared/description-markdown.test.ts`.
- **Start here:**
  - React: `apps/app/src/features/tasks/ui/task-description.tsx:29` (160 lines; `hiddenCounts` :21, the fold rule in the header :1-6).
  - The dialect, written once: `supabase/functions/_shared/description-markdown.ts`; the editor's transformers `apps/app/src/features/spine/editor/description-markdown.ts:1-16` (bold, italic, strike, inline code, fenced code, links, three list kinds, quotes; references and dates as `moduo://` links; no headings).
  - Reading: parse that dialect into styled runs (GPUI `StyledText` with runs, or the kit's Markdown view if it can be restricted to the dialect); a `moduo://` link draws as a chip with the item's title.
  - Editing: `Textarea` (foundation NF-10) on the stored string; save through `patchTask`.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:209` (2026-10-15, one description editor, stored as Markdown).
- **Traps:**
  - Never re-serialise: what is saved is exactly what the person typed, and an untouched description saves nothing.
  - The React editor escapes some characters on save (`description-markdown.ts`, `escapeMarkdownText`); the source box does not, so a description edited natively can read differently in React. List what does in the PR.
  - Pasted or dropped files attach to the task in React (:38); not here yet.
- **Not in this block:** The rich editor, mentions, file paste (spec 3).

### NT-26 · Comments and activity

- **Goal:** The pane's feed shows the activity trail and comments with the All and Comments switch, and a composer posts, edits and deletes the person's own comments.
- **Acceptance criteria:** AC10 (its part) — comments and activity show; a comment can be posted and edited. Product difference on purpose: no @mention menu.
- **Tests:** `crates/tasks-core/tests/activity.rs` · ported from `apps/app/src/features/tasks/activity.test.ts` (13); `crates/tasks-ui/tests/feed.rs` · "runs of changes fold between comments" · "post, edit, delete my comment" · "the thread re-reads when the store sees a comment of this task change".
- **Start here:**
  - React: `apps/app/src/features/tasks/ui/task-feed.tsx:128` (721 lines; header :1-25 explains the folding; `EntityFeed` :208, `ChangeFeed` :372, `TrailLine` :463, `MergedLine` :511, `FeedEvent` :570, `CommentItem` :592); models `apps/app/src/features/tasks/feed.ts` (292), `apps/app/src/features/tasks/activity.ts`.
  - Calls: activity from `module_activity` (`apps/app/src/lib/runtime.web.tasks.ts:1608`); comments through the spine port, `apps/app/src/lib/runtime.types.spine.ts:133-180` (`listComments`, `addComment`, `editComment`) and its web implementation (the `comments_op_*` functions).
  - The store already carries comment marks (id, entity, stamps) to know when to re-read.
  - Primitive: `Feed` (foundation NF-21).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Deleted comments and other people's edits arrive live: re-read the thread on the store's comment stamp, not on a timer.
  - Reactions are not ported (the primitive is out of scope): show existing ones read-only as text counts or hide them; say which in the PR.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Mentions, reactions, attachments in comments.

### NT-27 · Quick add

- **Goal:** A task can be added with c from the list, ⌘N from anywhere in Tasks and "add to queue", into the place being looked at, with title and project; Enter adds and keeps the field for the next one.
- **Acceptance criteria:** AC11 (its part) — a task can be added from the list (c), from anywhere in Tasks (⌘N) and into the queue.
- **Tests:** `crates/tasks-ui/tests/capture.rs` · "c, cmd-N and add to queue create the task in the right place" · "Enter adds and stays; Esc closes and keeps the draft" · "a task added offline shows at once and waits to sync"; `crates/tasks-commands/tests/task.rs` · the create cases of `task-commands.capture-saving.test.ts`.
- **Start here:**
  - React: `apps/app/src/features/tasks/capture/task-capture.tsx:221` (2,105 lines; keys :1639, :1884, :2077), `capture-create.ts` (466), `capture-draft.ts` (251). Port the core path only: field, target place, create.
  - Where a new task lands ("here"): the capture request carries the place, section and parent (`docs/decisions/tasks.md:2168`, U14-1).
  - Commands: `createTask` (NT-12), `createQueuedTask` / `captureToQueue` from `apps/app/src/features/tasks/commands/queue.ts:324-336`.
  - Key `c`: `apps/app/src/features/tasks/ui/list-keys.ts:140`; ⌘N: registry `new-item` (foundation NF-28), scoped to Tasks for now.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:2168` (2026-10-11, TV-U14 Capture v3).
- **Traps:**
  - A created row is temporary until the server answers; writes on it are "still saving".
  - The global capture (⌘⇧K) and its type switch belong to the spine (spec 5).
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Parsing the text (NT-28).

### NT-28 · Capture parsing and pills

- **Goal:** Text typed into quick add is parsed as in React (dates, times, people, tags, project, priority, repeat, subtasks, pasted lists) and the recognised parts show as removable pills under the field.
- **Acceptance criteria:** AC11 — dates, people, tags, project and repeat are parsed from the typed text as in React. Product difference on purpose: pills under the field, not inline tokens.
- **Tests:** `crates/tasks-core/tests/capture_parser.rs` · ported from `apps/app/src/features/tasks/parse/capture-parser.test.ts` (44) and `parse/paste-list.test.ts` (7); `crates/tasks-ui/tests/capture.rs` · "a pill removes its part from the result and leaves the words" · "a pasted list offers one task per line".
- **Start here:**
  - Parser: `apps/app/src/features/tasks/parse/` (4 files, 1,077 lines). Check first whether it calls `chrono-node`: if it does, implement by hand the date phrases the 44 cases cover (assumption 16).
  - Pills and menus: `apps/app/src/features/tasks/capture/capture-pills.tsx` (558 lines), `capture-menus.ts` (455); the inline token node (`token-node.tsx`, `title-editor.tsx`) is what this block does not port.
  - Primitives: `Chip` and `PickerPill` (foundation NF-18).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:2168` (2026-10-11, TV-U14 Capture v3).
- **Traps:**
  - Parsing is pure and lives in `moduo-tasks-core`.
  - "#" opens the tag menu in React and is why descriptions have no headings; here "#word" is parsed on space.
  - Dates resolve in the person's zone at the moment of typing.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
- **Not in this block:** Inline tokens and the @ and # menus inside the text (spec 3).

### NT-29 · Display and sort

- **Goal:** The view header has the Display menu (grouping, sort, columns, density of the list) per place, the view switch, and the "sorted" line that explains why a manual drag is off.
- **Acceptance criteria:** AC12 (its part) — Display behaves as in React and persists the same way.
- **Tests:** `crates/tasks-core/tests/display.rs` · ported from `apps/app/src/features/tasks/display.test.ts` (38); `crates/tasks-ui/tests/header.rs` · "a choice applies at once and is remembered per place" · "the sorted line offers Back to manual" · "the view switch offers List, Board, Timeline".
- **Start here:**
  - Model: `apps/app/src/features/tasks/display.ts` (724 lines; `tasksDisplayControls` :538, `orderTasks` :697). Hook: `apps/app/src/features/tasks/ui/use-tasks-display.tsx:63`.
  - Header: `apps/app/src/features/tasks/ui/plan-view-header.tsx:56` (`SortedOrderLine` :159, `ViewSwitcher` :192). Toolbar grammar: title and count, Search · Filter · Display, the view switch, one primary.
  - Primitive: `DisplayMenu`, `Toolbar`, `SegmentedControl` (foundation NF-21, NF-13). Persistence: NT-19.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:2693` (2026-10-10, TV-U4: reorder only under Order by: Manual).
- **Traps:**
  - Board and Timeline entries in the switch are shown disabled until NT-38 and NT-46.
  - Copy wording, order and states from the React source named above; do not redesign.
  - Only `moduo-ui` may name `gpui_kit`, and no colour or pixel literal for a design value lives outside `moduo-tokens` (`apps/native/tests/boundaries.rs`).
- **Not in this block:** Filters (NT-30).

### NT-30 · Filters and search

- **Goal:** The filter bar with the Tasks dimensions, the search field (/), the filter key (F), the no-match state, and server search when the device does not hold everything.
- **Acceptance criteria:** AC12 (its part) — filters and search behave as in React.
- **Tests:** `crates/tasks-core/tests/filters.rs` · ported from `apps/app/src/features/tasks/filters.test.ts` (35) and `search.test.ts` (34); `crates/tasks-ui/tests/filters.rs` · "slash focuses search; F opens the filter menu" · "no match offers to clear" · "search asks the server when the copy is truncated".
- **Start here:**
  - Hook: `apps/app/src/features/tasks/ui/use-tasks-filters.tsx:426` (694 lines; dimensions :267, toolbar keys :375-382). Model: `apps/app/src/features/tasks/filters.ts:215` (`filterTasks`).
  - Search field: `apps/app/src/features/tasks/ui/task-search-field.tsx` (108 lines). Server search: the store's search (NT-6) over rpc `tasks_search`; the copy alone is enough when everything is loaded and nothing was truncated.
  - No match: `apps/app/src/features/tasks/ui/task-view-states.tsx:103`. Primitive: `FilterBar` (foundation NF-21).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Search matches titles and handles (`MOD-142`).
  - A filter never hides the task being opened by id (NT-45).
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Saving a filter as a view (NT-44).

### NT-31 · Multi-selection and bulk

- **Goal:** Several tasks can be selected (⇧-click range, ⌘-click toggle, ⇧J and ⇧K, ⌘A), the right pane becomes the bulk panel, and the bulk keys and menu act on the whole selection with one Undo.
- **Acceptance criteria:** AC9 — one cursor and one multi-selection as in React. AC17 (its part) — a bulk action offers Undo once.
- **Tests:** `crates/tasks-core/tests/selection.rs` · ported from `apps/app/src/features/tasks/selection.test.ts` (13); `crates/tasks-core/tests/bulk.rs` · from `bulk.test.ts` (13); `crates/tasks-commands/tests/bulk.rs` · from `bulk-write.509-2.variant.test.ts` (3), `bulk.capture-saving.test.ts` (5); `crates/tasks-ui/tests/bulk.rs` · "range, toggle, extend and select all" · "each bulk key acts once on all".
- **Start here:**
  - Selection: `apps/app/src/features/tasks/selection.ts` (176 lines; `selectWith` :62, mods :25-30, `extendSelection` :93, `selectAll` :107, `pruneSelection` :117, `inViewOrder` :135); hook `apps/app/src/features/tasks/ui/use-task-selection.ts:35`; keys `apps/app/src/features/tasks/ui/list-keys.ts:99-107`.
  - Bulk: `apps/app/src/features/tasks/ui/use-bulk-actions.tsx:79` (654 lines; keys :213), `bulk-panel.tsx:22`, `bulk-picker.tsx`, `selection-menu.tsx`; pane `apps/app/src/features/tasks/ui/plan/plan-panels.tsx:105`.
  - Commands: `apps/app/src/features/tasks/commands/bulk.ts` (514; exports :513), `bulk-write.ts` (514; refusals :30, pool :61, no second Undo :92).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Bulk work never stops at the first refusal: collect and report (`.claude/rules/tasks-ui.md:26`).
  - Each view passes its visible order with the gesture; the selection keeps no order of its own.
  - While several are selected, single-row keys that make no sense are swallowed (:213).
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
- **Not in this block:** Dragging a selection (NT-33).

### NT-32 · List drag: reorder and nest

- **Goal:** A drag layer for Tasks (press, threshold, overlay, hover resolution, auto-scroll, drop, cancel) and its first use: dragging a list row to reorder in manual order or to nest under another row.
- **Acceptance criteria:** AC13 (its part) — reorder and nest in manual order only; a drop on a sorted list is refused with the sorted note; each drop offers one Undo.
- **Tests:** `crates/tasks-core/tests/drops.rs` · ported from `apps/app/src/features/tasks/dnd/drop-mode.test.ts` (43) and `drop-write.test.ts` (7); `crates/tasks-ui/tests/drag.rs` · "a drag left of the indent reorders, right of it nests" · "Esc cancels and nothing moves" · "the list scrolls near its edges" · "a sorted list shows the note and refuses".
- **Start here:**
  - Planner (pure, port as is): `apps/app/src/features/tasks/dnd/drop-mode.ts` (`NEST_INDENT_PX = 40` :27, `groupAccepts` :78, `resolveListHover` :113, `positionNextTo` :287, `planListDrop` :321); writes and Undo `apps/app/src/features/tasks/dnd/drop-write.ts` (`TaskDropWrite` :20, `undoWrite` :77, `dropLabel` :137).
  - React gesture layer for reference: `apps/app/src/features/tasks/ui/dnd/task-dnd.tsx` (payload :53, targets :75, overlay beside the cursor :130) and the list's wiring `apps/app/src/features/tasks/ui/task-list-view.tsx:1542-1565,2059`.
  - GPUI: `on_drag` with a dragged view, `on_drag_move` for the pointer, `on_drop`; hit-test against row rects recorded during paint. Visuals: `InsertionLine`, `NestPreview`, `DragOverlaySurface`, `SortedNote` (foundation NF-17).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:2693` (2026-10-10, TV-U4 drag and drop).
- **Traps:**
  - Resolve the hover from the raw pointer and the rects measured now, on every move and again at the drop; never from accumulated deltas (`.claude/rules/ui-drag.md:10-21`).
  - The dragged row stays mounted while it is off screen (`VirtualStack` pinned item).
  - The order of writes in one drop: field, then status, then assign.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Other groups, the rail, several rows (NT-33); Board (NT-39).

### NT-33 · Cross-group, rail and multi drag

- **Goal:** A row dropped into another group takes that group's field; a row dropped on a rail row moves to that project, joins the queue or is assigned to me; a whole selection drags as one change; ⌥⇧↑ and ⌥⇧↓ move a row in manual order.
- **Acceptance criteria:** AC13 — change the group's field across groups, move to a project or the queue from the rail, move a whole selection as one change; each drop offers one Undo. AC17 (its part).
- **Tests:** `crates/tasks-core/tests/drops.rs` · ported from `apps/app/src/features/tasks/dnd/rail-drop.test.ts` (13) and `multi-drop.test.ts` (4), plus the group cases of `drop-mode.test.ts`; `crates/tasks-ui/tests/drag.rs` · "cross-group, rail, multi" · "alt-shift arrows step the position" · "a drop on Inbox does nothing and is swallowed".
- **Start here:**
  - Group field: `apps/app/src/features/tasks/dnd/drop-mode.ts:78,254` (`groupAccepts`, `groupFieldPatch`).
  - Rail: `apps/app/src/features/tasks/dnd/rail-drop.ts:59` (`railDropAction`; rules in the header :1-15), row `apps/app/src/features/tasks/ui/dnd/rail-drop-row.tsx:17`.
  - Several rows: `apps/app/src/features/tasks/dnd/multi-drop.ts:24` (the held task's change copied to the selection as one write, one Undo).
  - Keys: `apps/app/src/features/tasks/ui/list-keys.ts:93-96`, `apps/app/src/features/tasks/ui/row-keys.ts:123` (`stepPosition`).
  - One collision order for the page, as React's `appCollision` (`apps/app/src/features/tasks/ui/plan/plan-dnd-host.tsx:63-80`): rail targets by pointer, then the view's own.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:2693` (2026-10-10, TV-U4 drag and drop).
- **Traps:**
  - A project task never goes into Inbox by drag.
  - A drop on a project row carries the subtasks and lands at the end of that project.
  - With no grouping the planner must see `none` (`.claude/rules/tasks-ui.md:20`).
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
- **Not in this block:** Dropping on the panel hub to link (NT-43).

### NT-34 · Projects and areas

- **Goal:** Projects and areas can be created, renamed in place, coloured, moved between areas, reordered by drag, archived, unarchived and deleted from the rail; the archived-projects view exists.
- **Acceptance criteria:** AC14 (its part) — projects and areas can be created, renamed, coloured, reordered, archived and deleted.
- **Tests:** `crates/tasks-core/tests/sidebar.rs` · the order cases of `apps/app/src/features/tasks/sidebar.test.ts` (23); `crates/tasks-commands/tests/projects.rs` · ported from `projects.645-2.variant.test.ts` (3) and `apps/app/src/lib/runtime.web.structure.test.ts` (15); `crates/tasks-ui/tests/projects.rs` · "create, rename, colour, reorder, archive, delete, restore".
- **Start here:**
  - Rail: `apps/app/src/features/tasks/ui/bucket-rail.tsx:246-673`, sortable project row :1028, drop monitor :1131; order `apps/app/src/features/tasks/sidebar.ts:121` (`projectOrderDrop`).
  - Dialogs and views: `apps/app/src/features/tasks/ui/delete-bucket-dialog.tsx` (269), `archived-projects-view.tsx` (134), `project-choices.tsx` (167).
  - Commands: `apps/app/src/features/tasks/commands/projects.ts` (597; exports :581-596), `structure.ts` (323; exports :311-322).
  - Ops in `apps/app/src/lib/runtime.web.structure.ts`: areas :334-361, projects :375-468 (`projects_op_create|update|move|file|delete`).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:3883` (2026-10-08: a deleted project hides at once and the server delete runs when the Undo toast closes).
- **Traps:**
  - Project writes join `chainProjectOp` before waiting (`.claude/rules/tasks-ui.md:27`).
  - Dropping a project on another area's project moves it into that area.
  - The Inbox cannot be renamed, archived or deleted.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** The project panel (NT-35). Sharing a project.

### NT-35 · Project panel and statuses

- **Goal:** A project opens in the right pane with its overview (progress, dates, state, description, sections), and the statuses of a project can be edited in a dialog.
- **Acceptance criteria:** AC14 (its part) — sections and statuses can be created, renamed, reordered and deleted; a project's fields edit.
- **Tests:** `crates/tasks-ui/tests/projects.rs` · "the panel shows progress and sections" · "statuses editor: add, rename, reorder within a category, delete with a replacement" · "drift triage lists what needs a decision".
- **Start here:**
  - Panel: `apps/app/src/features/tasks/ui/project-panel.tsx:122` (785 lines), `project-overview-parts.tsx` (425), `use-project-overview-data.ts` (196); pane wiring `apps/app/src/features/tasks/ui/plan/plan-panels.tsx:172,222`.
  - Dialogs: `apps/app/src/features/tasks/ui/statuses-dialog.tsx` (294), `drift-triage-dialog.tsx` (186).
  - Commands: sections and project fields in `apps/app/src/features/tasks/commands/structure.ts` and `projects.ts`; statuses in `status.ts:176-186`. Ops: sections `apps/app/src/lib/runtime.web.structure.ts:558-599`; statuses (NT-11).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Five fixed status categories; names inside them are per project.
  - Deleting a status needs a replacement for its tasks.
  - A project's description is plain text (`apps/app/src/features/tasks/model.ts:255-258`).
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Templates (NT-48), teams and sharing.

### NT-36 · Upcoming

- **Goal:** The Upcoming place shows tasks in day buckets, and ⌥← / ⌥→ move the cursor task a day (a week with ⇧).
- **Acceptance criteria:** AC15 (its part) — Upcoming exists with its React behaviour.
- **Tests:** `crates/tasks-core/tests/upcoming.rs` · ported from `apps/app/src/features/tasks/upcoming.test.ts` (10); `crates/tasks-ui/tests/upcoming.rs` · "day buckets, overdue first" · "alt-arrows reschedule by a day, with shift by a week" · "the empty state".
- **Start here:**
  - View: `apps/app/src/features/tasks/ui/upcoming-view.tsx:70` (354 lines; keys :258). Model: `apps/app/src/features/tasks/upcoming.ts` (350). Empty: `apps/app/src/features/tasks/ui/view-empty-states.tsx:14`.
  - Rows and headers are the list's (NT-13, NT-18); dates from NT-22.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Buckets follow the device's day; at midnight they shift.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** A calendar grid (the Calendar module).

### NT-37 · Inbox triage

- **Goal:** The Inbox offers its triage actions with keys: file into a project, decline, mark duplicate, snooze.
- **Acceptance criteria:** AC15 (its part) — Inbox triage exists with its React behaviour.
- **Tests:** `crates/tasks-core/tests/inbox.rs` · ported from `apps/app/src/features/tasks/inbox-triage.test.ts` (8); `crates/tasks-ui/tests/inbox.rs` · "file, decline, duplicate and snooze each act and offer Undo" · "the cursor moves to the next item".
- **Start here:**
  - View: `apps/app/src/features/tasks/ui/inbox-view.tsx:100` (800 lines; dialogs :593, :647, :698, :755). Model: `apps/app/src/features/tasks/inbox-triage.ts` (211).
  - Dialogs use `Command` in `Dialog` (foundation NF-16, NF-14). The bottom bar's mode row for triage (`apps/app/src/components/app/bottom-bar-mode.ts`) goes into the centre slot of the bottom bar.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - The Inbox of a new workspace appears on first open.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Email-to-task and other inbox sources.

### NT-38 · Board: read and keys

- **Goal:** The Board view shows columns by status, section or another field, optional lanes, and cards; the list keys work, with ← and → moving between columns.
- **Acceptance criteria:** AC15 (its part) — Board exists. AC8 (its part) — the board keys.
- **Tests:** `crates/tasks-core/tests/board.rs` · ported from `apps/app/src/features/tasks/board-columns.test.ts` (20); `crates/tasks-ui/tests/keys_board.rs` · one case per board key; `crates/tasks-ui/tests/board.rs` · "columns, lanes, counts and folds" · "a column with 400 cards builds only what is visible".
- **Start here:**
  - View: `apps/app/src/features/tasks/ui/task-board-view.tsx:220` (1,454 lines; column :1195, lanes :1300, keys :861), `board-parts.tsx` (339), card `task-card.tsx:103` (472).
  - Model: `apps/app/src/features/tasks/board-columns.ts` (`buildBoardColumns` :157, `buildBoardLanes` :699). Keys: `apps/app/src/features/tasks/ui/board-keys.ts:26` (`moveInGrid` :71; ⌥⇧←/→ :31-34).
  - Primitive: `ItemCard`, `GroupHeader`, one `VirtualStack` per column (virtual from 40 cards).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Board is "Linear-quiet": the whole card is the drag handle later, so no separate handle now (`.design/tasks-polish/BRIEF.md:141-163`).
  - Fold keys differ from the list's (`apps/app/src/features/tasks/folds.ts:23`).
  - Rows take facts and id callbacks, never the store or the project list (`.claude/rules/ui-react.md`, "Long lists").
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Dragging cards (NT-39).

### NT-39 · Board drag

- **Goal:** Cards drag within a column, to another column and to another lane, with the board's rules.
- **Acceptance criteria:** AC13 (its part) — Board columns and lanes follow the React drop rules.
- **Tests:** `crates/tasks-core/tests/drops.rs` · ported from `apps/app/src/features/tasks/dnd/board-drop.test.ts` (14); `crates/tasks-ui/tests/drag.rs` · "a card takes the column's field and the lane's" · "an area column takes nothing" · "reorder only in manual order".
- **Start here:**
  - Planner: `apps/app/src/features/tasks/dnd/board-drop.ts` (rules in the header :1-12, `targetAccepts` :85, `planBoardDrop` :148). React wiring: `apps/app/src/features/tasks/ui/task-board-view.tsx:740,820,1218,1422`.
  - The drag layer is NT-32's; add column and lane targets and a closest-corner choice among cards.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:2693` (2026-10-10, TV-U4 drag and drop).
- **Traps:**
  - A project task never goes into the Inbox column; project lanes never move a project.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
- **Not in this block:** Timeline drags (NT-47).

### NT-40 · Focus

- **Goal:** The Focus place (Today): my queue, the Now card, Up next with reorder, the hand-off and between states, the queue toggle on rows (q) and in the detail header, and "Focus on this" (⇧F).
- **Acceptance criteria:** AC15 (its part) — Focus exists with its React behaviour. AC8 (its part) — the Focus keys (⏎, Esc, C, S, W, ⇧F) and q.
- **Tests:** `crates/tasks-core/tests/focus.rs` · ported from `apps/app/src/features/tasks/focus-screen.test.ts` (39); `crates/tasks-ui/tests/keys_focus.rs` · one case per key; `crates/tasks-ui/tests/focus.rs` · "done takes the next from the queue" · "skip moves to the end" · "the empty states".
- **Start here:**
  - View: `apps/app/src/features/tasks/ui/focus-view.tsx:140` (keys :528), `focus-now-card.tsx` (566), `focus-up-next.tsx` (333; reorder :151, :285), `focus-between.tsx`, `focus-hand-off.tsx`, `focus-empty-state.tsx`, `in-flight-panel.tsx`; toggle `apps/app/src/features/tasks/ui/queue-toggle.tsx:121`.
  - Model: `apps/app/src/features/tasks/focus-screen.ts` (502), `queue.ts` (NT-10). Commands: `apps/app/src/features/tasks/commands/queue.ts` (337; exports :324-336).
  - Keys in the registry: `apps/app/src/lib/hotkeys/registry.ts:130-135`.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:3900` (2026-10-07, a personal Queue; Focus as a queue run) and `:1494` (2026-10-13, Focus screen v3).
- **Traps:**
  - Focus may keep nothing selected (`.claude/rules/tasks-ui.md:13`).
  - A queue op's answer replaces the whole queue slice (kernel `replaceSlice`).
  - The Focus session chip in the top bar and the Focus module itself are spec 10.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Pomodoro (NT-41), Soundspace.

### NT-41 · Time

- **Goal:** Time can be tracked on a task (start, stop, add, edit, remove), the Pomodoro runs in Focus, and the time report sheet shows and exports totals.
- **Acceptance criteria:** AC16 (its part) — time tracking and the time report work as in React.
- **Tests:** `crates/tasks-core/tests/time.rs` · ported from `apps/app/src/features/tasks/time-report.test.ts` (21); `crates/tasks-commands/tests/time.rs` · from `time.822-1.variant.test.ts` (2) and `apps/app/src/lib/runtime.web.time.test.ts` (6); `crates/tasks-ui/tests/time.rs` · "track, edit, report".
- **Start here:**
  - UI: `apps/app/src/features/tasks/ui/task-time-entries.tsx:38` (247), `time-report-sheet.tsx:69` (369), `client-time-report.tsx` (145); Pomodoro `apps/app/src/features/tasks/ui/focus-view.tsx:893`.
  - Commands: `apps/app/src/features/tasks/commands/time.ts` (246; exports :236-245). Calls: `apps/app/src/lib/runtime.web.tasks.ts:1369-1457` (`tasks_op_track_time`, `tasks_time_totals`, `task_time_entries`, `tasks_time_report`).
  - Time entries are read on demand, not kept in the store.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - A running timer survives a restart: its start is on the server.
  - Phase alerts and sounds belong to Focus (spec 10); a silent Pomodoro here.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Sharing a report with a client by link, beyond showing the existing action.

### NT-42 · Repeat

- **Goal:** A task's repeat can be set from presets or a custom rule, its history is shown, and moving one occurrence asks "this one or all".
- **Acceptance criteria:** AC16 (its part) — repeat rules with their history work as in React.
- **Tests:** `crates/tasks-ui/tests/repeat.rs` · "each preset writes its rule" · "custom: every N, weekdays, monthly by day" · "history lists past cycles" · "moving an occurrence offers this one or the series"; the engine's cases are NT-10's.
- **Start here:**
  - UI: `apps/app/src/features/tasks/ui/task-detail-pickers.tsx` `RepeatValue` :879, `RepeatHistory` :986, `CustomRepeat` :1128; `repeat-move-dialog.tsx` (62).
  - Model: `apps/app/src/features/tasks/repeat.ts`, `repeat-history.ts`, `parse/recurrence.ts:6-67`. Commands: `skipOccurrence`, `moveOccurrence`, `taskHistory` (`apps/app/src/features/tasks/commands/schedule.ts:113-120`).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:1971` (2026-10-13, TV-D12 recurrence a to h).
- **Traps:**
  - Two modes (after completion, on schedule) are a closed vocabulary (NT-1).
  - The server computes the next occurrence; the client's engine only predicts what to show.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Repeat in capture text (NT-28 parses it).

### NT-43 · Waiting, blockers, linked

- **Goal:** The pane's Waiting, Blocked by, Blocks and Linked sections: add and remove waiting marks and blockers, show linked items, and link by dropping a task on the pane.
- **Acceptance criteria:** AC10 (its part) and AC16 (its part) — waiting and blockers work as in React.
- **Tests:** `crates/tasks-ui/tests/relations.rs` · "add and remove a waiting mark" · "pick a blocker; a blocked task shows its marker in the list" · "a cycle is refused" · "dropping a task on the pane links it once".
- **Start here:**
  - UI: `apps/app/src/features/tasks/ui/task-detail-collections.tsx` `WaitingSection` :273, `BlockedBySection` :398, `BlocksSection` :430, `BlockerPicker` :488, `LinkedSection` :545; hub drop `apps/app/src/features/tasks/ui/plan/plan-dnd-host.tsx:66`.
  - Commands: `addBlocker`, `removeBlocker` (NT-12), `addWaiting`, `removeWaiting` (`apps/app/src/features/tasks/commands/activity.ts`). Ops: `task_relations` (NT-11), waiting `apps/app/src/lib/runtime.web.structure.ts:772-797`.
  - Links are the spine's: list them read-only through its port (`apps/app/src/lib/runtime.types.spine.ts`) and create a task-to-task link only.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Guard "already linked" before creating a link (`.claude/rules/ui-drag.md`).
  - Reference chips and previews for other modules arrive with those modules.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Linking notes, events, emails, contacts.

### NT-44 · Saved views

- **Goal:** The current place with its display and filters can be saved as a view, opened from the rail, changed, renamed, reordered and deleted.
- **Acceptance criteria:** AC12 (its part) — saved views behave as in React.
- **Tests:** `crates/tasks-core/tests/views.rs` · ported from `apps/app/src/features/tasks/views.test.ts` (16); `crates/tasks-ui/tests/views.rs` · "save, open, change and delete a view" · "a changed view offers Save and Reset".
- **Start here:**
  - UI: `apps/app/src/features/tasks/ui/use-saved-views.tsx:40` (286), `saved-view-parts.tsx:28,121` (214). Model: `apps/app/src/features/tasks/views.ts:44-262` (`viewPlace` :44).
  - Ops: `apps/app/src/lib/runtime.web.views.ts:57-91` (`task_views_op_create|update|move`); rows already sync (`task_views`).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - `view:<id>` is not a place (`.claude/rules/tasks-ui.md:14`).
  - A view that is gone falls back to Inbox once the server has answered.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
- **Not in this block:** Sharing a view.

### NT-45 · Open by id or handle

- **Goal:** A task can be opened by id or handle (`MOD-142`) from inside the app: the place snaps to its project, its group unfolds, the row is revealed, and "gone" or "private" is said when that is the truth.
- **Acceptance criteria:** AC9 (its part) — a task opened by id or handle is revealed in its place.
- **Tests:** `crates/tasks-ui/tests/plan_state.rs` · ported from `apps/app/src/features/tasks/ui/plan/deep-link.test.ts` · "the fold reset keeps the opened task's group open" · "gone only after the rest has loaded" · "a failed handle lookup retries after 30 s".
- **Start here:**
  - Machine (pure, port as is into `PlanState`): `apps/app/src/features/tasks/ui/plan/deep-link.ts` (diagram :10-16, phases :27-47, events :79-89, commands :91-101, reducer :119, `evaluate` :180, retry :25). Hook: `apps/app/src/features/tasks/ui/plan/use-task-deep-link.ts:46,77`.
  - An app action `OpenEntity { kind, id | handle }` is the one entry (React: the `moduo:entity:open` event, `apps/app/src/components/app/app-chrome.tsx:254-326`). Search results (NT-30) are its first caller.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:52` (2026-10-20) and `:2612` (2026-10-10, handles).
- **Traps:**
  - There is no URL scheme in either desktop app; do not register one here.
  - Linkable includes archived projects and tasks (`.claude/rules/tasks-ui.md:15`).
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
- **Not in this block:** Opening from system notifications (spec 5).

### NT-46 · Timeline: read and keys

- **Goal:** The Timeline view: rows with a name column, marks on a time scale, header, today line, zoom, folds, the no-date panel, and its keys.
- **Acceptance criteria:** AC15 (its part) — Timeline exists. AC8 (its part) — the Timeline keys.
- **Tests:** `crates/tasks-core/tests/timeline.rs` · ported from `apps/app/src/features/tasks/timeline-rows.test.ts` (19), `timeline-scale.test.ts` (21), `timeline-keys.test.ts` (6); `crates/tasks-ui/tests/keys_timeline.rs` · one case per key; `crates/tasks-ui/tests/timeline.rs` · "2,000 rows build only what is visible" · "today is in view on open".
- **Start here:**
  - View: `apps/app/src/features/tasks/ui/task-timeline-view.tsx:167` (keys bound :625, rows :818); parts `timeline-row.tsx` (576), `timeline-marks.tsx` (718), `timeline-header.tsx` (214), `timeline-toolbar.tsx` (91), `timeline-no-date-panel.tsx` (169), `use-timeline-viewport.ts` (230).
  - Model: `apps/app/src/features/tasks/timeline-rows.ts` (727), `timeline-scale.ts` (405), `timeline-keys.ts`; runner `apps/app/src/features/tasks/ui/timeline-key-handler.ts:83`.
  - Draw the track with a GPUI `canvas` (grid, marks, today line) and plain elements for the name column; rows through `VirtualStack` with the header as scroll margin.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:953` (2026-10-13, TV-TL1 Timeline rebuild).
- **Traps:**
  - Reveal finds the mark, not the row (`.claude/rules/tasks-ui.md:30-32`).
  - Timeline may keep nothing selected.
  - The seed for load: `scripts/perf/seed-timeline-2k.ts`.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
  - Every `.rs` file stays under 32 KB (`scripts/ci/ratchets.ts:32`).
- **Not in this block:** Editing on the track (NT-47).

### NT-47 · Timeline: editing

- **Goal:** Marks can be dragged and resized, dependencies are drawn, no-date tasks drop onto days, and the date keys (⌥←/→, ⇧D, d, t) write.
- **Acceptance criteria:** AC13 (its part) and AC15 (its part) — Timeline edits follow the React rules, each with one Undo.
- **Tests:** `crates/tasks-core/tests/timeline.rs` · ported from `apps/app/src/features/tasks/timeline-drag.test.ts` (11); `crates/tasks-ui/tests/timeline.rs` · "drag moves, an edge resizes" · "a click after a drag is swallowed" · "a no-date task takes the day under the pointer" · "dependency lines follow their marks".
- **Start here:**
  - Pointer engine (hand-rolled in React too): `apps/app/src/features/tasks/ui/use-timeline-canvas.ts:94` (458), `timeline-drag-store.ts:37` (122), `apps/app/src/features/tasks/timeline-drag.ts` (229); writes `apps/app/src/features/tasks/ui/use-timeline-writes.tsx` (357); dependencies `timeline-deps-layer.tsx` (330); drop `use-timeline-drop.tsx:33` (160).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:767` (2026-10-13, TV-TL2 Timeline interactions).
- **Traps:**
  - A drag starts only on the track and has three exits: release, cancel, and "no button is down any more".
  - The day comes from the raw pointer at the drop.
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
- **Not in this block:** Timeline for other modules.

### NT-48 · Templates

- **Goal:** The Templates place: list, the template editor, save a task or a project as a template, apply a template, duplicate a project.
- **Acceptance criteria:** AC22 (its part) — templates exist with their React behaviour.
- **Tests:** `crates/tasks-store/tests/ops.rs` · ported from `apps/app/src/lib/runtime.web.templates.test.ts` (5); `crates/tasks-ui/tests/templates.rs` · "save a task as a template and apply it" · "edit a project template" · "duplicate a project".
- **Start here:**
  - UI: `apps/app/src/features/tasks/templates/ui/templates-view.tsx:24` (163), `template-editor.tsx` (661), `template-dialogs.tsx` (430), `use-template-actions.tsx` (440).
  - Ops: `apps/app/src/lib/runtime.web.templates.ts:139-310` (`task_templates`, `project_templates`, `*_op_save|apply|starter`, `templates_op_update`, `projects_op_duplicate`). Template kinds are a closed vocabulary (NT-1).
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Templates are read on demand, not synced by the store.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Starter templates' content.

### NT-49 · Trash, full page, export, welcome, agent marks

- **Goal:** The remaining small surfaces: Recently deleted (restore, delete for good), the full-page task with its keys, the export menu, the welcome dialog, and the agent mark and session panel on a task.
- **Acceptance criteria:** AC14 (its part) — Trash restores and deletes for good. AC22 (its part) — export, the full-page task and the welcome dialog exist.
- **Tests:** `crates/tasks-core/tests/trash.rs` · ported from `apps/app/src/features/tasks/trash.test.ts` (5); `crates/tasks-ui/tests/misc.rs` · "restore and delete for good" · "Enter opens the full page; Esc, cmd-[ and J, K work" · "export writes the visible list as CSV" · "the welcome shows once".
- **Start here:**
  - Trash: `apps/app/src/features/tasks/ui/recently-deleted-view.tsx` (194); ops `apps/app/src/lib/runtime.web.structure.ts:482-534`.
  - Full page: `apps/app/src/features/tasks/ui/task-full-page.tsx:28,50`; keys `apps/app/src/lib/hotkeys/registry.ts:127-129`.
  - Export: `apps/app/src/features/tasks/ui/view-export-menu.tsx` (192), `apps/app/src/features/tasks/list-export.ts`; save with a native save panel.
  - Welcome: `apps/app/src/features/tasks/ui/tasks-welcome-dialog.tsx` (314), `use-tasks-welcome.ts` (212).
  - Agents: `apps/app/src/features/tasks/ui/task-agent-session.tsx:37` (319), row mark `apps/app/src/features/tasks/ui/task-row.tsx:721`; calls `apps/app/src/lib/runtime.web.agents.ts:117-152`.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Deleting for good cannot be undone: an AlertDialog, never a toast.
  - A native file dialog must not block the main thread.
  - Copy wording, order and states from the React source named above; do not redesign.
- **Not in this block:** Import (NT-50).

### NT-50 · Import

- **Goal:** Tasks can be imported from the supported files through the import dialog, with progress and Undo of a whole import.
- **Acceptance criteria:** AC22 (its part) — import exists with its React behaviour.
- **Tests:** `crates/tasks-core/tests/importers.rs` · the cases of the tests under `apps/app/src/features/tasks/importers/`, one to one; `crates/tasks-ui/tests/import.rs` · "pick a file, map it, import, undo the import".
- **Start here:**
  - Importers: `apps/app/src/features/tasks/importers/` (11 files, 2,188 lines) and `importers/ui/` (3 files, 900 lines).
  - Calls: `apps/app/src/lib/runtime.web.agents.ts:220-370` (`import_rows`, `imports_op_begin|project_create|section_create|finish|undo`, `tasks_op_create_with`). Import vocabularies: `supabase/functions/_shared/contracts/vocabularies.ts:434-448`.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`); `docs/decisions/tasks.md:3345` (2026-10-10, switching: which sources and in what order).
- **Traps:**
  - An import of thousands of rows runs in the background with a progress strip; closing the dialog does not stop it.
  - Old ids stay findable (the decision above).
  - Copy the test cases first, one to one, then write code until they pass; a case that cannot be ported is listed in the PR with its reason.
- **Not in this block:** Import through the connector (it is server-side already).

### NT-51 · Gate B: parity sweep and measurements

- **Goal:** The native Tasks is compared with the React Tasks as it is on that day: every surface, key and rule either matches or is written down as different on purpose; what drifted since its block is fixed; the Gate A measurements are repeated.
- **Acceptance criteria:** AC21 — every React Tasks surface has a native counterpart or is listed as different on purpose, and the Gate A measurements are repeated on the finished module.
- **Tests:** Manual, in the PR: the parity table (surface, key or rule · same or different · reason) and the numbers. A dated entry in `docs/decisions/desktop-release.md` records the result. `bun run native:check` is green.
- **Start here:**
  - Drift: `git log --stat <first NT commit>..origin/mike -- apps/app/src/features/tasks apps/app/src/lib/sync supabase/functions/_shared/contracts`; every changed test file is re-ported.
  - Walk the surface table of this spec's blocks NT-13 to NT-50 with both apps side by side on the same workspace; walk the keymap (`apps/app/src/lib/hotkeys/registry.ts:125-135`, `apps/app/src/features/tasks/ui/list-keys.ts`, `board-keys.ts`, `apps/app/src/features/tasks/timeline-keys.ts`).
  - Known differences to confirm or close: description source editing (NT-25), capture pills (NT-28), no mention menu and no reactions (NT-26), links to other modules (NT-43).
  - Measurements: the method of NT-16, plus the Board with 400 cards a column and the Timeline with 2,000 rows.
- **Decisions that apply:** the foundation's two 2026-11-28 entries (`docs/decisions/toolchain.md`, `docs/decisions/desktop-release.md`).
- **Traps:**
  - Differences that a person would feel go to Maciej under ❓ Needs you; do not decide them here.
  - This block may spawn fix blocks; add them to this spec's table rather than growing the PR.
- **Not in this block:** The next module.

## Out of scope

- The rich text editor, inline capture tokens, the @mention menu and reactions (the editor spike and Notes).
- The global capture (⌘⇧K), command palette, global search, notifications and the shortcuts sheet (Spine).
- Links from a task to notes, events, emails and contacts, and their reference previews (with each module).
- The Focus module's session chip, sounds and phase alerts; Soundspace.
- Sharing projects, teams and members management, billing.
- File attachments on tasks (upload, preview); the rows are counted, not opened.
- Any change to the React app, the Tauri app or the backend, apart from the contracts export script and its test.
- Bundling, signing and updating the native app; Windows and Linux.

---

## Definition-of-Ready gate

> **/s2 must not start a block until this is all true.**

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty**: every technical unknown is decided under *Assumptions & technical decisions*; where a crate's behaviour could not be proved ahead (`rrule`, the date parser), the rule that decides is written down.
- [x] **Data model is named and Supabase-first**: the existing Tasks tables and server functions, listed in the briefs; no new tables, columns or migrations. The device copy is a cache of those rows.
- [x] **Module feature items**: spine wiring, MCP tools and the dashboard widget are unchanged, because the module and its backend are the existing ones; what the native app does not yet show of the spine is listed under *Out of scope*.
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [x] **Every block has a brief** of at most 3 KB that stands alone (*Block briefs*).
- [x] **Design constraints acknowledged**: tokens only and primitives only through `moduo-ui` (foundation AC2, AC8); the Tasks design sources are cited in the briefs.
- [x] **Manual-test surfaces identified**: `bun run native:dev` on the local stack beside `bun run dev:web` on the same workspace; each brief says what to try.

Ready to execute, each NT block once the blocks it depends on have landed.

## Open questions

- [x] (none)
